/**
 * Client store - wraps the SDK and provides reactive state for Svelte
 */
import { writable, derived, get } from 'svelte/store';
import {
  ClientSDK,
  SensorManager,
  FlashlightController,
  ScreenController,
  VibrationController,
  ToneSoundPlayer,
  ToneModulatedSoundPlayer,
  WakeLockController,
  NodeExecutor,
  type NodeCommand,
  type ClientState,
  type ClientSDKConfig,
  type ClientIdentity,
} from '@shugu/sdk-client';
import {
  MultimediaCore,
  toneAudioEngine,
  type MediaEngineState,
  type MediaFit,
} from '@shugu/multimedia-core';
import type {
  ControlMessage,
  PluginControlMessage,
  ControlAction,
  ControlPayload,
  ControlBatchPayload,
  FlashlightPayload,
  ScreenColorPayload,
  VibratePayload,
  PlaySoundPayload,
  PlayMediaPayload,
  ShowImagePayload,
  ModulateSoundPayload,
  VisualSceneSwitchPayload,
  VisualSceneBoxPayload,
  VisualSceneMelPayload,
  VisualSceneFrontCameraPayload,
  VisualSceneBackCameraPayload,
  VisualSceneLayerItem,
  VisualScenesPayload,
  ConvolutionPayload,
  VisualEffect,
  VisualEffectsPayload,
} from '@shugu/protocol';

// SDK and controller instances
let sdk: ClientSDK | null = null;
let sensorManager: SensorManager | null = null;
let flashlightController: FlashlightController | null = null;
let screenController: ScreenController | null = null;
let vibrationController: VibrationController | null = null;
let toneSoundPlayer: ToneSoundPlayer | null = null;
let toneModulatedSoundPlayer: ToneModulatedSoundPlayer | null = null;
let wakeLockController: WakeLockController | null = null;
let nodeExecutor: NodeExecutor | null = null;
let multimediaCore: MultimediaCore | null = null;
let mediaUnsub: (() => void) | null = null;

// Core state store
export const state = writable<ClientState>({
  status: 'disconnected',
  clientId: null,
  timeSync: {
    offset: 0,
    samples: [],
    maxSamples: 10,
    initialized: false,
    lastSyncTime: 0,
  },
  error: null,
});

// Permission states
export const permissions = writable<{
  microphone: 'pending' | 'granted' | 'denied';
  motion: 'pending' | 'granted' | 'denied';
  camera: 'pending' | 'granted' | 'denied';
  wakeLock: 'pending' | 'granted' | 'denied';
  geolocation: 'pending' | 'granted' | 'denied' | 'unavailable' | 'unsupported';
}>({
  microphone: 'pending',
  motion: 'pending',
  camera: 'pending',
  wakeLock: 'pending',
  geolocation: 'pending',
});

// Latency in ms (smooth average)
export const latency = writable<number>(0);

// Current visual scene (legacy, kept for backward compatibility)
export const currentScene = writable<string>('box-scene');

// Independent scene enabled states (for multi-scene support)
export const boxSceneEnabled = writable<boolean>(true);
export const melSceneEnabled = writable<boolean>(false);
export const frontCameraEnabled = writable<boolean>(false);
export const backCameraEnabled = writable<boolean>(false);

// Visual scene layer applied on top of the visual layer (first -> last).
// Default keeps the legacy behavior (Box scene enabled by default).
export const visualScenes = writable<VisualSceneLayerItem[]>([{ type: 'box' }]);

function buildLegacyVisualScenes(): VisualSceneLayerItem[] {
  const scenes: VisualSceneLayerItem[] = [];

  if (get(boxSceneEnabled)) scenes.push({ type: 'box' });
  if (get(melSceneEnabled)) scenes.push({ type: 'mel' });

  // Camera is mutually exclusive; prefer the currently enabled one.
  if (get(frontCameraEnabled)) {
    scenes.push({ type: 'frontCamera' });
  } else if (get(backCameraEnabled)) {
    scenes.push({ type: 'backCamera' });
  }

  return scenes;
}

function syncLegacyVisualScenes(): void {
  visualScenes.set(buildLegacyVisualScenes());
}

function normalizeVisualScenesPayload(payload: unknown): VisualSceneLayerItem[] {
  const raw = payload && typeof payload === 'object' ? (payload as any).scenes : null;
  if (!Array.isArray(raw)) return [];

  const limited = raw.slice(0, 12);
  const out: VisualSceneLayerItem[] = [];

  for (const item of limited) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof (item as any).type === 'string' ? String((item as any).type) : '';
    if (type === 'box') {
      out.push({ type: 'box' });
      continue;
    }
    if (type === 'mel') {
      out.push({ type: 'mel' });
      continue;
    }
    if (type === 'frontCamera') {
      out.push({ type: 'frontCamera' });
      continue;
    }
    if (type === 'backCamera') {
      out.push({ type: 'backCamera' });
    }
  }

  // De-duplicate scene types, keeping the last occurrence so ordering is preserved.
  const deduped: VisualSceneLayerItem[] = [];
  const seen = new Set<string>();
  for (let i = out.length - 1; i >= 0; i--) {
    const entry = out[i]!;
    if (seen.has(entry.type)) continue;
    seen.add(entry.type);
    deduped.push(entry);
  }
  deduped.reverse();

  // Camera is mutually exclusive; keep only the last camera item if both appear.
  const lastCameraIndex = (() => {
    for (let i = deduped.length - 1; i >= 0; i--) {
      const t = deduped[i]!.type;
      if (t === 'frontCamera' || t === 'backCamera') return i;
    }
    return -1;
  })();

  if (lastCameraIndex >= 0) {
    const keep = deduped[lastCameraIndex]!.type;
    return deduped.filter((s) =>
      s.type === 'frontCamera' || s.type === 'backCamera' ? s.type === keep : true
    );
  }

  return deduped;
}

function syncVisualScenesToLegacyStores(scenes: VisualSceneLayerItem[]): void {
  const list = Array.isArray(scenes) ? scenes : [];
  const types = new Set(list.map((s) => s.type));

  boxSceneEnabled.set(types.has('box'));
  melSceneEnabled.set(types.has('mel'));

  const lastCamera = (() => {
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]!.type;
      if (t === 'frontCamera' || t === 'backCamera') return t;
    }
    return null;
  })();

  const front = lastCamera === 'frontCamera';
  const back = lastCamera === 'backCamera';
  frontCameraEnabled.set(front);
  backCameraEnabled.set(back);

  if (front) {
    startCameraStream('user');
  } else if (back) {
    startCameraStream('environment');
  } else {
    stopCameraStream();
  }
}

// Camera stream state
export type CameraFacing = 'user' | 'environment' | null;
export const cameraStream = writable<MediaStream | null>(null);
export const cameraFacing = writable<CameraFacing>(null);

// ASCII post-processing toggle (default on)
export const asciiEnabled = writable<boolean>(true);

// ASCII resolution (cell size in pixels)
export const asciiResolution = writable<number>(11);

export type ConvolutionPreset =
  | 'blur'
  | 'gaussianBlur'
  | 'sharpen'
  | 'edge'
  | 'emboss'
  | 'sobelX'
  | 'sobelY'
  | 'custom';

export type ConvolutionState = {
  enabled: boolean;
  preset: ConvolutionPreset;
  kernel: number[] | null;
  mix: number;
  bias: number;
  normalize: boolean;
  scale: number;
};

// Convolution post-processing config
export const convolution = writable<ConvolutionState>({
  enabled: false,
  preset: 'sharpen',
  kernel: null,
  mix: 1,
  bias: 0,
  normalize: true,
  scale: 0.5,
});

// Visual post-processing chain applied on top of the visual layer (first -> last).
// Default keeps the legacy behavior (ASCII on by default).
export const visualEffects = writable<VisualEffect[]>([{ type: 'ascii', cellSize: 11 }]);

function buildLegacyVisualEffects(): VisualEffect[] {
  const effects: VisualEffect[] = [];

  const conv = get(convolution);
  if (conv?.enabled) {
    effects.push({
      type: 'convolution',
      preset: conv.preset,
      ...(Array.isArray(conv.kernel) && conv.kernel.length === 9 ? { kernel: conv.kernel } : {}),
      mix: conv.mix,
      bias: conv.bias,
      normalize: conv.normalize,
      scale: conv.scale,
    });
  }

  const asciiOn = Boolean(get(asciiEnabled));
  if (asciiOn) {
    effects.push({
      type: 'ascii',
      cellSize: clampNumber(get(asciiResolution), 11, 1, 100),
    });
  }

  return effects;
}

function syncLegacyVisualEffects(): void {
  visualEffects.set(buildLegacyVisualEffects());
}

function normalizeVisualEffectsPayload(payload: unknown): VisualEffect[] {
  const raw = payload && typeof payload === 'object' ? (payload as any).effects : null;
  if (!Array.isArray(raw)) return [];
  const limited = raw.slice(0, 12);
  const out: VisualEffect[] = [];

  for (const item of limited) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof (item as any).type === 'string' ? String((item as any).type) : '';
    if (type === 'ascii') {
      const cellSize = clampNumber((item as any).cellSize, 11, 1, 100);
      out.push({ type: 'ascii', cellSize: Math.round(cellSize) });
      continue;
    }
    if (type === 'convolution') {
      const preset =
        typeof (item as any).preset === 'string' ? String((item as any).preset) : undefined;
      const kernel = Array.isArray((item as any).kernel)
        ? (item as any).kernel
            .map((n: unknown) => (typeof n === 'number' ? n : Number(n)))
            .filter((n: number) => Number.isFinite(n))
            .slice(0, 9)
        : undefined;

      out.push({
        type: 'convolution',
        ...(preset ? { preset: preset as any } : {}),
        ...(kernel && kernel.length === 9 ? { kernel } : {}),
        mix: clampNumber((item as any).mix, 1, 0, 1),
        bias: clampNumber((item as any).bias, 0, -1, 1),
        normalize: typeof (item as any).normalize === 'boolean' ? (item as any).normalize : true,
        scale: clampNumber((item as any).scale, 0.5, 0.1, 1),
      });
    }
  }

  return out;
}

function syncVisualEffectsToLegacyStores(effects: VisualEffect[]): void {
  const list = Array.isArray(effects) ? effects : [];
  const firstAscii = list.find((e) => e.type === 'ascii') as
    | Extract<VisualEffect, { type: 'ascii' }>
    | undefined;
  const firstConv = list.find((e) => e.type === 'convolution') as
    | Extract<VisualEffect, { type: 'convolution' }>
    | undefined;

  asciiEnabled.set(Boolean(firstAscii));
  if (firstAscii) {
    asciiResolution.set(clampNumber(firstAscii.cellSize, 11, 1, 100));
  }

  convolution.update((prev) => {
    const next: ConvolutionState = { ...prev, enabled: Boolean(firstConv) };
    if (!firstConv) return next;

    if (typeof firstConv.preset === 'string') {
      next.preset = firstConv.preset as ConvolutionPreset;
    }

    if (Array.isArray(firstConv.kernel) && firstConv.kernel.length === 9) {
      next.kernel = firstConv.kernel.slice(0, 9);
    } else {
      next.kernel = null;
    }

    next.mix = clampNumber(firstConv.mix, next.mix, 0, 1);
    next.bias = clampNumber(firstConv.bias, next.bias, -1, 1);
    next.normalize =
      typeof firstConv.normalize === 'boolean' ? firstConv.normalize : next.normalize;
    next.scale = clampNumber(firstConv.scale, next.scale, 0.1, 1);

    return next;
  });
}

// Audio stream for plugins
export const audioStream = writable<MediaStream | null>(null);

const AUDIO_ENABLED_STORAGE_KEY = 'shugu-audio-enabled';
const ASSET_READ_TOKEN_STORAGE_KEY = 'shugu-asset-read-token';
const storedAudioEnabled =
  typeof window !== 'undefined' &&
  window.localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY) === 'true';

// Tone.js audio enablement state (requires user gesture to flip to true).
export const audioEnabled = writable<boolean>(storedAudioEnabled);

type ToneReadyPayload = {
  kind: 'tone';
  event: 'ready';
  enabled: boolean;
  error?: string;
  updatedAt: number;
};

// Latest Tone readiness snapshot (used for reconnect + manager-side "Tone Ready gate").
let lastToneReadyPayload: ToneReadyPayload | null = null;

function reportToneReady(payload: ToneReadyPayload): void {
  lastToneReadyPayload = payload;

  try {
    const sdkNow = sdk;
    const connected =
      Boolean(sdkNow?.getState?.().clientId) && sdkNow?.getState?.().status === 'connected';
    if (!connected) return;
    sdkNow?.sendSensorData('custom', payload as any, { trackLatest: false });
  } catch {
    // ignore
  }
}

type MediaClipParams = {
  baseUrl: string;
  startSec: number;
  endSec: number;
  loop: boolean | null;
  play: boolean | null;
  reverse: boolean | null;
  cursorSec: number | null;
  sourceNodeId: string | null;
  fit: MediaFit | null;
  // Image modulation parameters
  scale: number | null;
  offsetX: number | null;
  offsetY: number | null;
  opacity: number | null;
};

function parseMediaClipParams(raw: string): MediaClipParams {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      baseUrl: '',
      startSec: 0,
      endSec: -1,
      loop: null,
      play: null,
      reverse: null,
      cursorSec: null,
      sourceNodeId: null,
      fit: null,
      scale: null,
      offsetX: null,
      offsetY: null,
      opacity: null,
    };
  }

  const hashIndex = trimmed.indexOf('#');
  if (hashIndex < 0) {
    return {
      baseUrl: trimmed,
      startSec: 0,
      endSec: -1,
      loop: null,
      play: null,
      reverse: null,
      cursorSec: null,
      sourceNodeId: null,
      fit: null,
      scale: null,
      offsetX: null,
      offsetY: null,
      opacity: null,
    };
  }

  const baseUrl = trimmed.slice(0, hashIndex).trim();
  const hash = trimmed.slice(hashIndex + 1);
  const params = new URLSearchParams(hash);

  const toNumber = (value: string | null, fallback: number): number => {
    if (value == null) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const toBoolean = (value: string | null, fallback: boolean): boolean => {
    if (value == null) return fallback;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const n = Number(normalized);
    if (Number.isFinite(n)) return n >= 0.5;
    return fallback;
  };

  const tRaw = params.get('t');
  let startSec = 0;
  let endSec = -1;
  if (tRaw !== null) {
    const parts = tRaw.split(',');
    const startCandidate = parts[0]?.trim() ?? '';
    const endCandidate = parts[1]?.trim() ?? '';
    startSec = toNumber(startCandidate || null, 0);
    if (parts.length > 1) {
      endSec = endCandidate ? toNumber(endCandidate, -1) : -1;
    }
  }

  const loopRaw = params.get('loop');
  const playRaw = params.get('play');
  const reverseRaw = params.get('rev');
  const cursorRaw = params.get('p');
  const nodeRaw = params.get('node');
  const fitRaw = params.get('fit');

  const cursorParsed = cursorRaw === null ? null : toNumber(cursorRaw, -1);
  const cursorSec =
    cursorParsed !== null && Number.isFinite(cursorParsed) && cursorParsed >= 0
      ? cursorParsed
      : null;

  const fit = (() => {
    if (fitRaw === null) return null;
    const normalized = fitRaw.trim().toLowerCase();
    if (normalized === 'fit-screen' || normalized === 'fitscreen' || normalized === 'fullscreen')
      return 'fit-screen';
    if (normalized === 'cover') return 'cover';
    if (normalized === 'fill' || normalized === 'stretch') return 'fill';
    if (normalized === 'contain') return 'contain';
    return null;
  })();

  // Parse image modulation parameters
  const scaleRaw = params.get('scale');
  const offsetXRaw = params.get('offsetX');
  const offsetYRaw = params.get('offsetY');
  const opacityRaw = params.get('opacity');

  const scale = scaleRaw === null ? null : toNumber(scaleRaw, 1);
  const offsetX = offsetXRaw === null ? null : toNumber(offsetXRaw, 0);
  const offsetY = offsetYRaw === null ? null : toNumber(offsetYRaw, 0);
  const opacity = opacityRaw === null ? null : toNumber(opacityRaw, 1);

  return {
    baseUrl,
    startSec: Number.isFinite(startSec) ? startSec : 0,
    endSec: Number.isFinite(endSec) ? endSec : -1,
    loop: loopRaw === null ? null : toBoolean(loopRaw, false),
    play: playRaw === null ? null : toBoolean(playRaw, true),
    reverse: reverseRaw === null ? null : toBoolean(reverseRaw, false),
    cursorSec,
    sourceNodeId: typeof nodeRaw === 'string' && nodeRaw.trim() ? nodeRaw.trim() : null,
    fit,
    scale,
    offsetX,
    offsetY,
    opacity,
  };
}

// Video playback state
export const videoState = writable<{
  url: string | null;
  sourceNodeId: string | null;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  volume: number;
  startSec: number;
  endSec: number;
  cursorSec: number;
  reverse: boolean;
  fit: MediaFit;
}>({
  url: null,
  sourceNodeId: null,
  playing: false,
  muted: true,
  loop: false,
  volume: 1,
  startSec: 0,
  endSec: -1,
  cursorSec: -1,
  reverse: false,
  fit: 'contain',
});

// Image display state
export const imageState = writable<{
  url: string | null;
  visible: boolean;
  duration: number | undefined;
  fit: MediaFit;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}>({
  url: null,
  visible: false,
  duration: undefined,
  fit: 'contain',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
});

// Derived stores
export const connectionStatus = derived(state, ($state) => $state.status);
export const clientId = derived(state, ($state) => $state.clientId);

/**
 * Start camera stream with specified facing mode
 */
async function startCameraStream(facingMode: 'user' | 'environment'): Promise<void> {
  // Stop any existing stream first
  stopCameraStream();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false,
    });
    cameraStream.set(stream);
    cameraFacing.set(facingMode);
    console.log(`[Camera] Started ${facingMode} camera`);
  } catch (error) {
    console.error('[Camera] Failed to start camera:', error);
    cameraStream.set(null);
    cameraFacing.set(null);
  }
}

/**
 * Stop camera stream and release resources
 */
function stopCameraStream(): void {
  const stream = get(cameraStream);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    cameraStream.set(null);
    cameraFacing.set(null);
    console.log('[Camera] Stopped camera');
  }
}

const DEVICE_ID_STORAGE_KEY = 'shugu-device-id';
const INSTANCE_ID_STORAGE_KEY = 'shugu-client-instance-id';
const CLIENT_ID_STORAGE_KEY = 'shugu-client-id';

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function getOrCreateStorageId(storage: Storage, key: string, prefix: string): string {
  const existing = storage.getItem(key);
  if (existing && existing.trim()) return existing;
  const id = createRandomId(prefix);
  storage.setItem(key, id);
  return id;
}

function getOrCreateClientIdentity(): ClientIdentity | null {
  if (typeof window === 'undefined') return null;

  const deviceId = getOrCreateStorageId(window.localStorage, DEVICE_ID_STORAGE_KEY, 'c_');
  const instanceId = getOrCreateStorageId(window.sessionStorage, INSTANCE_ID_STORAGE_KEY, 'i_');

  const storedClientId = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  const clientId = storedClientId && storedClientId.trim() ? storedClientId : deviceId;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);

  return { deviceId, instanceId, clientId };
}

function persistAssignedClientId(assignedClientId: string): void {
  if (typeof window === 'undefined') return;
  if (!assignedClientId) return;
  const current = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (current === assignedClientId) return;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, assignedClientId);
}

/**
 * Start asset preloading early, before the user clicks Enter.
 * This initializes MultimediaCore independently of the full SDK initialization.
 * Call this from onMount in +page.svelte.
 */
export function startEarlyPreload(serverUrl: string): void {
  if (multimediaCore) return; // Already initialized

  const assetReadToken =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(ASSET_READ_TOKEN_STORAGE_KEY)
      : null;

  multimediaCore = new MultimediaCore({
    serverUrl,
    assetReadToken,
    autoStart: true,
    concurrency: 10,
  });

  console.log('[Client] Early preload started');
}

/**
 * Get the MultimediaCore instance (for external access).
 */
export function getMultimediaCore(): MultimediaCore | null {
  return multimediaCore;
}

/**
 * Initialize and connect to server
 */
export function initialize(config: ClientSDKConfig, options?: { autoConnect?: boolean }): void {
  const identity = getOrCreateClientIdentity();

  // Initialize SDK
  sdk = new ClientSDK({
    ...config,
    identity: config.identity ?? identity ?? undefined,
  });

  // Subscribe to state changes
  sdk.onStateChange((newState) => {
    state.set(newState);
    if (newState.clientId) {
      persistAssignedClientId(newState.clientId);
    }

    // Ensure readiness is reported after the socket becomes ready (covers the case where
    // MultimediaCore finishes preload before clientId is assigned).
    if (newState.status === 'connected' && newState.clientId) {
      const snapshot = multimediaCore?.getState?.();
      try {
        const tonePayload =
          lastToneReadyPayload ??
          ({
            kind: 'tone',
            event: 'ready',
            enabled: toneAudioEngine.isEnabled(),
            updatedAt: Date.now(),
          } satisfies ToneReadyPayload);
        reportToneReady(tonePayload);

        if (!snapshot) return;
        sdk?.sendSensorData(
          'custom',
          {
            kind: 'multimedia-core',
            event: 'asset-preload',
            status: snapshot.status,
            manifestId: snapshot.manifestId,
            loaded: snapshot.loaded,
            total: snapshot.total,
            error: snapshot.error,
          } as any,
          { trackLatest: false }
        );
      } catch {
        // ignore
      }
    }
  });

  // Subscribe to control messages
  sdk.onControl(handleControlMessage);
  sdk.onPluginControl(handlePluginControlMessage);

  // MultimediaCore: asset resolver + preload/cache + readiness reporting (no UI).
  // Reuse existing instance if startEarlyPreload was called.
  if (!multimediaCore) {
    const assetReadToken =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(ASSET_READ_TOKEN_STORAGE_KEY)
        : null;
    multimediaCore = new MultimediaCore({
      serverUrl: config.serverUrl,
      assetReadToken,
      autoStart: true,
      concurrency: 10,
    });
  }

  mediaUnsub?.();
  mediaUnsub = multimediaCore.media.subscribeState((s: MediaEngineState) => {
    videoState.set(s.video);
    imageState.set(s.image);
  });
  let lastReported = '';
  let lastSentAt = 0;
  multimediaCore.subscribeState((s) => {
    const status =
      s.status === 'ready'
        ? 'ready'
        : s.status === 'error'
          ? 'error'
          : s.status === 'loading'
            ? 'loading'
            : 'idle';
    const payload = {
      kind: 'multimedia-core',
      event: 'asset-preload',
      status,
      manifestId: s.manifestId,
      loaded: s.loaded,
      total: s.total,
      error: s.error,
    };
    const signature = JSON.stringify(payload);
    try {
      const connected =
        Boolean(sdk?.getState?.().clientId) && sdk?.getState?.().status === 'connected';
      // Don't "consume" the state signature until we are actually able to send it.
      if (!connected) return;

      if (signature === lastReported) return;
      sdk?.sendSensorData('custom', payload as any, { trackLatest: false });
      lastReported = signature;
      lastSentAt = Date.now();
    } catch {
      // ignore
    }
  });

  // Initialize controllers
  flashlightController = new FlashlightController();
  screenController = new ScreenController();
  vibrationController = new VibrationController();
  toneSoundPlayer = new ToneSoundPlayer();
  toneModulatedSoundPlayer = new ToneModulatedSoundPlayer();
  wakeLockController = new WakeLockController();
  sensorManager = new SensorManager({ throttleMs: 100 });
  nodeExecutor = new NodeExecutor(
    sdk,
    (cmd: NodeCommand) => executeControl(cmd.action, cmd.payload, cmd.executeAt),
    {
      canRunCapability: (capability) => {
        const p = get(permissions);
        if (capability === 'flashlight') return p.camera === 'granted';
        if (capability === 'sensors') return p.motion === 'granted' || p.microphone === 'granted';
        if (capability === 'sound') {
          const hasAudioContext =
            typeof window !== 'undefined' &&
            Boolean((window as any).AudioContext || (window as any).webkitAudioContext);
          return hasAudioContext;
        }
        return true;
      },
      resolveAssetRef: (ref: string) => multimediaCore?.resolveAssetRef(ref) ?? ref,
      prioritizeFetch: (url: string) => multimediaCore?.prioritizeFetch(url) ?? fetch(url),
    }
  );

  if (options?.autoConnect !== false) {
    sdk.connect();
  }
}

export function connectToServer(): void {
  sdk?.connect();
}

/**
 * Disconnect socket only (keep SDK + controllers alive).
 * Useful for treating "background/lock screen" as offline without losing app state.
 */
export function disconnectFromServer(): void {
  sdk?.disconnect();
}

/**
 * Request all permissions
 */
export async function requestPermissions(): Promise<void> {
  // Kick off permission prompts synchronously (before the first await) so iOS can show them.
  // Some browser APIs require being triggered within the same user gesture stack.
  const motionPermissionPromise = sensorManager
    ? sensorManager.requestPermissions()
    : Promise.resolve({ granted: false, error: 'Sensor manager not initialized' });

  let microphonePromise: Promise<MediaStream>;
  if (navigator.mediaDevices?.getUserMedia) {
    microphonePromise = navigator.mediaDevices.getUserMedia({ audio: true });
  } else {
    microphonePromise = Promise.reject(new Error('mediaDevices.getUserMedia is not supported'));
  }

  const soundInitPromise = enableAudio().catch((error) => {
    console.warn('[Permissions] Tone audio enable failed:', error);
    return null;
  });

  const [motionResult, microphoneResult] = await Promise.allSettled([
    motionPermissionPromise,
    microphonePromise,
  ]);

  // Handle motion sensors
  if (motionResult.status === 'fulfilled') {
    permissions.update((p) => ({
      ...p,
      motion: motionResult.value.granted ? 'granted' : 'denied',
    }));
    if (motionResult.value.granted && sensorManager) {
      sensorManager.start();
      setupSensorReporting();
    } else if (!motionResult.value.granted) {
      console.warn('[Permissions] Motion/orientation denied:', motionResult.value.error);
    }
  } else {
    console.warn(
      '[Permissions] Motion/orientation permission request failed:',
      motionResult.reason
    );
    permissions.update((p) => ({ ...p, motion: 'denied' }));
  }

  // Handle microphone
  if (microphoneResult.status === 'fulfilled') {
    audioStream.set(microphoneResult.value);
    permissions.update((p) => ({ ...p, microphone: 'granted' }));
  } else {
    console.warn('[Permissions] Microphone denied:', microphoneResult.reason);
    permissions.update((p) => ({ ...p, microphone: 'denied' }));
  }

  await soundInitPromise;

  // Request wake lock
  if (wakeLockController) {
    const success = await wakeLockController.request();
    permissions.update((p) => ({ ...p, wakeLock: success ? 'granted' : 'denied' }));
  }

  // Initialize flashlight (camera)
  if (flashlightController) {
    const success = await flashlightController.init();
    permissions.update((p) => ({ ...p, camera: success ? 'granted' : 'denied' }));
  }
}

function persistAudioEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUDIO_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

/**
 * Enable Tone.js audio (must be called from a user gesture).
 */
export async function enableAudio(): Promise<{ enabled: boolean; error?: string } | null> {
  try {
    const result = await toneAudioEngine.start();
    audioEnabled.set(result.enabled);
    persistAudioEnabled(result.enabled);
    reportToneReady({
      kind: 'tone',
      event: 'ready',
      enabled: result.enabled,
      ...(result.error ? { error: result.error } : {}),
      updatedAt: Date.now(),
    });
    return result;
  } catch (err) {
    audioEnabled.set(false);
    persistAudioEnabled(false);
    reportToneReady({
      kind: 'tone',
      event: 'ready',
      enabled: false,
      error: err instanceof Error ? err.message : String(err),
      updatedAt: Date.now(),
    });
    return { enabled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Set up sensor data reporting to server
 */
function setupSensorReporting(): void {
  if (!sensorManager) return;

  sensorManager.onOrientation((data) => {
    sdk?.sendSensorData('orientation', data);
  });

  sensorManager.onGyro((data) => {
    sdk?.sendSensorData('gyro', data);
  });

  sensorManager.onAccel((data) => {
    sdk?.sendSensorData('accel', data);
  });
}

/**
 * Handle control messages from manager
 */
function handleControlMessage(message: ControlMessage): void {
  // Calculate and log message size
  try {
    const messageJson = JSON.stringify(message);
    const messageSizeBytes = new Blob([messageJson]).size;
    const messageSizeKB = (messageSizeBytes / 1024).toFixed(2);
    
    console.log(
      `[Message] Received ${message.action} | Size: ${messageSizeBytes} bytes (${messageSizeKB} KB)`
    );
  } catch (err) {
    console.warn('[Message] Failed to calculate message size:', err);
  }
  
  executeControl(message.action, message.payload, message.executeAt);
}

function isControlBatchPayload(payload: ControlPayload): payload is ControlBatchPayload {
  if (!payload || typeof payload !== 'object') return false;
  if ((payload as any).kind !== 'control-batch') return false;
  return Array.isArray((payload as any).items);
}

type ScreenshotFormat = 'image/jpeg' | 'image/png' | 'image/webp';

type PushImageUploadPayload = {
  kind: 'push-image-upload';
  format?: string;
  quality?: number;
  maxWidth?: number;
  // Manager-side scheduling metadata (optional).
  speed?: number;
  seq?: number;
};

let screenshotUploadInFlight = false;

function normalizeScreenshotFormat(value: unknown): ScreenshotFormat {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'image/png') return 'image/png';
  if (raw === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getFittedDrawParams(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: MediaFit
): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
} {
  if (fit === 'fill') {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }

  if (fit === 'cover') {
    const scale = Math.max(dstW / srcW, dstH / srcH);
    const sw = dstW / scale;
    const sh = dstH / scale;
    const sx = (srcW - sw) / 2;
    const sy = (srcH - sh) / 2;
    return { sx, sy, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }

  const scale =
    fit === 'fit-screen'
      ? Math.min(dstW / srcW, dstH / srcH)
      : Math.min(1, dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const dx = (dstW - dw) / 2;
  const dy = (dstH - dh) / 2;
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
}

async function captureScreenshotDataUrl(opts: {
  format: ScreenshotFormat;
  quality: number;
  maxWidth: number;
}): Promise<
  | {
      ok: true;
      shot: {
        dataUrl: string;
        mime: ScreenshotFormat;
        width: number;
        height: number;
        createdAt: number;
      };
    }
  | { ok: false; reason: string }
> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, reason: 'missing-window-or-document' };
  }

  const container = document.querySelector('.visual-container') as HTMLElement | null;
  if (!container) return { ok: false, reason: 'missing-visual-container' };

  const viewW = container.clientWidth ?? 0;
  const viewH = container.clientHeight ?? 0;
  if (viewW <= 0 || viewH <= 0) return { ok: false, reason: 'visual-container-size-0' };

  const maxWidth = Math.max(128, Math.floor(opts.maxWidth));
  const scale = viewW > maxWidth ? maxWidth / viewW : 1;
  const outW = Math.max(1, Math.floor(viewW * scale));
  const outH = Math.max(1, Math.floor(viewH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'missing-2d-context' };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, outW, outH);

  const effectsActive = (get(visualEffects) ?? []).length > 0;
  const overlay = effectsActive
    ? (container.querySelector('canvas.effect-output') as HTMLCanvasElement | null)
    : null;

  // If a full-frame overlay is active, it already represents what the user sees (effect pipeline).
  if (overlay && overlay.width > 0 && overlay.height > 0) {
    ctx.drawImage(overlay, 0, 0, outW, outH);
  } else {
    const video = container.querySelector('video') as HTMLVideoElement | null;
    const img = container.querySelector('img') as HTMLImageElement | null;

    const drawMedia = () => {
      if (video && get(videoState).url && video.readyState >= 2) {
        const srcW = video.videoWidth || 0;
        const srcH = video.videoHeight || 0;
        if (srcW <= 0 || srcH <= 0) return false;

        const fit = (get(videoState).fit ?? 'contain') as MediaFit;
        const padding = fit === 'contain' ? 24 * scale : 0;
        const dstW = Math.max(0, outW - padding * 2);
        const dstH = Math.max(0, outH - padding * 2);
        if (dstW <= 0 || dstH <= 0) return false;

        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(srcW, srcH, dstW, dstH, fit);
        try {
          ctx.drawImage(video, sx, sy, sw, sh, padding + dx, padding + dy, dw, dh);
          return true;
        } catch {
          return false;
        }
      }

      if (img && get(imageState).visible && get(imageState).url) {
        const srcW = img.naturalWidth || img.clientWidth || 0;
        const srcH = img.naturalHeight || img.clientHeight || 0;
        if (srcW <= 0 || srcH <= 0) return false;

        const fit = (get(imageState).fit ?? 'contain') as MediaFit;
        const padding = fit === 'contain' ? 24 * scale : 0;
        const dstW = Math.max(0, outW - padding * 2);
        const dstH = Math.max(0, outH - padding * 2);
        if (dstW <= 0 || dstH <= 0) return false;

        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(srcW, srcH, dstW, dstH, fit);
        try {
          const stateNow = get(imageState);
          const imgScale = clampNumber(stateNow.scale, 1, 0.1, 10);
          const offsetX = clampNumber(stateNow.offsetX, 0, -10_000, 10_000) * scale;
          const offsetY = clampNumber(stateNow.offsetY, 0, -10_000, 10_000) * scale;
          const opacity = clampNumber(stateNow.opacity, 1, 0, 1);

          const centerX = padding + dx + dw / 2;
          const centerY = padding + dy + dh / 2;
          const scaledW = dw * imgScale;
          const scaledH = dh * imgScale;
          const drawX = centerX - scaledW / 2 + offsetX;
          const drawY = centerY - scaledH / 2 + offsetY;

          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, scaledW, scaledH);
          ctx.restore();
          return true;
        } catch {
          return false;
        }
      }

      // Camera video stream
      const cameraVideo = container.querySelector(
        'video.camera-display'
      ) as HTMLVideoElement | null;
      const camStream = get(cameraStream);
      const frontEnabled = get(frontCameraEnabled);
      const backEnabled = get(backCameraEnabled);
      if (
        cameraVideo &&
        camStream &&
        (frontEnabled || backEnabled) &&
        cameraVideo.readyState >= 2
      ) {
        const srcW = cameraVideo.videoWidth || 0;
        const srcH = cameraVideo.videoHeight || 0;
        if (srcW <= 0 || srcH <= 0) return false;

        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
          srcW,
          srcH,
          outW,
          outH,
          'cover'
        );
        try {
          ctx.save();
          // Apply mirror transform for front camera
          if (frontEnabled) {
            ctx.translate(outW, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(cameraVideo, sx, sy, sw, sh, dx, dy, dw, dh);
          ctx.restore();
          return true;
        } catch {
          return false;
        }
      }

      return false;
    };

    const drewMedia = drawMedia();
    if (!drewMedia) {
      const baseCanvas = Array.from(container.querySelectorAll('canvas')).find(
        (c) => !c.classList.contains('effect-output')
      ) as HTMLCanvasElement | undefined;
      if (baseCanvas && baseCanvas.width > 0 && baseCanvas.height > 0) {
        try {
          ctx.drawImage(baseCanvas, 0, 0, outW, outH);
        } catch {
          // ignore
        }
      }
    }
  }

  const quality = clampNumber(opts.quality, 0.85, 0.1, 1);
  const mime = opts.format;
  const dataUrl = (() => {
    try {
      return mime === 'image/png' ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality);
    } catch {
      // Fallback: default to PNG if the requested format fails.
      try {
        return canvas.toDataURL('image/png');
      } catch {
        return '';
      }
    }
  })();

  if (!dataUrl) return { ok: false, reason: 'toDataURL-failed' };
  return { ok: true, shot: { dataUrl, mime, width: outW, height: outH, createdAt: Date.now() } };
}

// Custom command: capture a client screenshot and upload it to the manager via `sensorType: custom`.
async function handlePushImageUpload(payload: PushImageUploadPayload): Promise<void> {
  const seq = typeof payload?.seq === 'number' && Number.isFinite(payload.seq) ? payload.seq : null;

  if (screenshotUploadInFlight) {
    console.debug('[Client] push-image-upload skipped (inFlight)', { seq });
    return;
  }
  const sdkNow = sdk;
  if (!sdkNow) {
    console.warn('[Client] push-image-upload skipped (missing sdk)', { seq });
    return;
  }

  screenshotUploadInFlight = true;
  try {
    const format = normalizeScreenshotFormat(payload?.format);
    const quality = clampNumber(payload?.quality, 0.85, 0.1, 1);
    const maxWidth = clampNumber(payload?.maxWidth, 960, 128, 4096);

    console.info('[Client] push-image-upload capture start', {
      seq,
      format,
      quality,
      maxWidth,
      speed:
        typeof payload?.speed === 'number' && Number.isFinite(payload.speed) ? payload.speed : null,
    });

    const captured = await captureScreenshotDataUrl({ format, quality, maxWidth });
    if (!captured.ok) {
      console.warn('[Client] push-image-upload capture failed', { seq, reason: captured.reason });
      return;
    }

    const shot = captured.shot;

    sdkNow.sendSensorData(
      'custom',
      {
        kind: 'client-screenshot',
        dataUrl: shot.dataUrl,
        mime: shot.mime,
        width: shot.width,
        height: shot.height,
        createdAt: shot.createdAt,
      } as any,
      { trackLatest: false }
    );

    console.info('[Client] push-image-upload sent', {
      seq,
      mime: shot.mime,
      width: shot.width,
      height: shot.height,
      dataUrlChars: shot.dataUrl.length,
      createdAt: shot.createdAt,
    });
  } catch (err) {
    console.warn('[Client] push-image-upload failed:', err);
  } finally {
    screenshotUploadInFlight = false;
  }
}

function executeControl(action: ControlAction, payload: ControlPayload, executeAt?: number): void {
  // Expand control batches early so we don't schedule the wrapper message (avoid double scheduling).
  if (action === 'custom' && isControlBatchPayload(payload)) {
    const batch = payload as ControlBatchPayload;
    const batchExecuteAt =
      typeof batch.executeAt === 'number' && Number.isFinite(batch.executeAt)
        ? batch.executeAt
        : executeAt;

    for (const raw of batch.items) {
      if (!raw || typeof raw !== 'object') continue;
      const itemAction = (raw as any).action as ControlAction | undefined;
      if (!itemAction) continue;
      const itemPayload = ((raw as any).payload ?? {}) as ControlPayload;
      const itemExecuteAtRaw = (raw as any).executeAt;
      const itemExecuteAt =
        typeof itemExecuteAtRaw === 'number' && Number.isFinite(itemExecuteAtRaw)
          ? itemExecuteAtRaw
          : batchExecuteAt;
      executeControl(itemAction, itemPayload, itemExecuteAt);
    }
    return;
  }

  const executeAction = (delaySeconds = 0) => {
    if (import.meta.env.DEV && typeof window !== 'undefined' && (window as any).__SHUGU_E2E) {
      const entry = { at: Date.now(), action, payload, executeAt };
      (window as any).__SHUGU_E2E_LAST_COMMAND = entry;
      const list = ((window as any).__SHUGU_E2E_COMMANDS ??= []) as any[];
      list.push(entry);
      if (list.length > 200) list.splice(0, list.length - 200);
    }

    switch (action) {
      case 'flashlight':
        flashlightController?.setMode(payload as FlashlightPayload);
        break;

      case 'screenColor':
        screenController?.setColor(payload as ScreenColorPayload);
        break;

      case 'screenBrightness':
        {
          const brightness = (payload as { brightness: number }).brightness;
          screenController?.setBrightness(brightness);
        }
        break;

      case 'vibrate':
        vibrationController?.vibrate(payload as VibratePayload);
        break;

      case 'modulateSound':
        toneModulatedSoundPlayer?.play(payload as ModulateSoundPayload, delaySeconds);
        break;
      case 'modulateSoundUpdate':
        toneModulatedSoundPlayer?.update({
          frequency: (payload as ModulateSoundPayload).frequency,
          volume: (payload as ModulateSoundPayload).volume,
          waveform: (payload as ModulateSoundPayload).waveform,
          modFrequency: (payload as ModulateSoundPayload).modFrequency,
          modDepth: (payload as ModulateSoundPayload).modDepth,
          durationMs: (payload as any).durationMs ?? (payload as ModulateSoundPayload).duration,
        });
        break;

      case 'playSound':
        {
          const soundPayload = payload as PlaySoundPayload;
          const url =
            typeof soundPayload.url === 'string'
              ? (multimediaCore?.resolveAssetRef(soundPayload.url) ?? soundPayload.url)
              : soundPayload.url;
          // Always go through ToneSoundPlayer; it has an internal HTMLAudio fallback path.
          toneSoundPlayer?.play({ ...soundPayload, url }, delaySeconds);
        }
        break;

      case 'playMedia': {
        const mediaPayload = payload as PlayMediaPayload;
        const clip =
          typeof mediaPayload.url === 'string' ? parseMediaClipParams(mediaPayload.url) : null;
        const baseUrl = clip ? clip.baseUrl : mediaPayload.url;
        const resolvedUrl =
          typeof baseUrl === 'string'
            ? (multimediaCore?.resolveAssetRef(baseUrl) ?? baseUrl)
            : baseUrl;
        // Check if it's a video by extension or explicit type
        const resolvedUrlString =
          typeof resolvedUrl === 'string' ? resolvedUrl : String(resolvedUrl ?? '');
        const isVideo =
          mediaPayload.mediaType === 'video' ||
          /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(resolvedUrlString);

        if (isVideo) {
          const loop = clip?.loop ?? mediaPayload.loop ?? false;
          const playing = clip?.play ?? Boolean(resolvedUrlString);
          const startSec = clip ? Math.max(0, clip.startSec) : 0;
          const endSec = clip ? clip.endSec : -1;
          const cursorSec = clip?.cursorSec ?? -1;
          const reverse = clip?.reverse ?? false;
          const fit = clip?.fit ?? null;
          multimediaCore?.media.playVideo({
            url: resolvedUrlString,
            sourceNodeId: clip?.sourceNodeId ?? null,
            muted: mediaPayload.muted ?? true,
            loop,
            volume: mediaPayload.volume ?? 1,
            playing,
            startSec,
            endSec,
            cursorSec,
            reverse,
            ...(fit === null ? {} : { fit }),
          });
        } else {
          // Audio path: prefer ToneSoundPlayer when enabled; fallback to legacy SoundPlayer otherwise.
          const audioPayload = {
            url: resolvedUrl,
            volume: mediaPayload.volume,
            loop: mediaPayload.loop,
            fadeIn: mediaPayload.fadeIn,
          };
          void toneSoundPlayer
            ?.update(audioPayload as any, delaySeconds)
            .then((updated) => {
              if (updated) return;
              return toneSoundPlayer?.play(audioPayload as any, delaySeconds);
            })
            .catch(() => undefined);
        }
        break;
      }

      case 'stopMedia':
        multimediaCore?.media.stopVideo();
        toneSoundPlayer?.stop();
        break;

      case 'stopSound':
        toneSoundPlayer?.stop();
        toneModulatedSoundPlayer?.stop();
        break;

      case 'showImage': {
        const imagePayload = payload as ShowImagePayload;
        const clip =
          typeof imagePayload.url === 'string' ? parseMediaClipParams(imagePayload.url) : null;
        const baseUrl = clip ? clip.baseUrl : imagePayload.url;
        const url =
          typeof baseUrl === 'string'
            ? (multimediaCore?.resolveAssetRef(baseUrl) ?? baseUrl)
            : baseUrl;
        const fit = clip?.fit ?? null;
        const scale = clip?.scale ?? null;
        const offsetX = clip?.offsetX ?? null;
        const offsetY = clip?.offsetY ?? null;
        const opacity = clip?.opacity ?? null;
        multimediaCore?.media.showImage({
          url: String(url ?? ''),
          duration: imagePayload.duration,
          ...(fit === null ? {} : { fit }),
          ...(scale === null ? {} : { scale }),
          ...(offsetX === null ? {} : { offsetX }),
          ...(offsetY === null ? {} : { offsetY }),
          ...(opacity === null ? {} : { opacity }),
        });
        break;
      }

      case 'hideImage':
        multimediaCore?.media.hideImage();
        break;

      case 'visualSceneSwitch':
        {
          const scenePayload = payload as VisualSceneSwitchPayload;
          currentScene.set(scenePayload.sceneId);
          // Also update individual scene states for backward compatibility
          if (scenePayload.sceneId === 'box-scene') {
            boxSceneEnabled.set(true);
            melSceneEnabled.set(false);
          } else if (scenePayload.sceneId === 'mel-scene') {
            boxSceneEnabled.set(false);
            melSceneEnabled.set(true);
          }
          syncLegacyVisualScenes();
        }
        break;

      case 'visualSceneBox':
        {
          const boxPayload = payload as VisualSceneBoxPayload;
          boxSceneEnabled.set(boxPayload.enabled);
          syncLegacyVisualScenes();
        }
        break;

      case 'visualSceneMel':
        {
          const melPayload = payload as VisualSceneMelPayload;
          melSceneEnabled.set(melPayload.enabled);
          syncLegacyVisualScenes();
        }
        break;

      case 'visualSceneFrontCamera':
        {
          const camPayload = payload as VisualSceneFrontCameraPayload;
          frontCameraEnabled.set(camPayload.enabled);
          if (camPayload.enabled) {
            // Stop back camera if it's running
            backCameraEnabled.set(false);
            startCameraStream('user');
          } else {
            // Only stop if no other camera is enabled
            if (!get(backCameraEnabled)) {
              stopCameraStream();
            }
          }
          syncLegacyVisualScenes();
        }
        break;

      case 'visualSceneBackCamera':
        {
          const camPayload = payload as VisualSceneBackCameraPayload;
          backCameraEnabled.set(camPayload.enabled);
          if (camPayload.enabled) {
            // Stop front camera if it's running
            frontCameraEnabled.set(false);
            startCameraStream('environment');
          } else {
            // Only stop if no other camera is enabled
            if (!get(frontCameraEnabled)) {
              stopCameraStream();
            }
          }
          syncLegacyVisualScenes();
        }
        break;

      case 'visualScenes':
        {
          const scenes = normalizeVisualScenesPayload(payload as VisualScenesPayload);
          visualScenes.set(scenes);
          syncVisualScenesToLegacyStores(scenes);
        }
        break;

      case 'setDataReportingRate':
        {
          const ratePayload = payload as { sensorHz?: number };
          if (sensorManager && ratePayload.sensorHz) {
            sensorManager.setThrottleMs(1000 / ratePayload.sensorHz);
          }
        }
        break;

      case 'setSensorState':
        {
          const sensorStatePayload = payload as { active: boolean };
          if (sensorManager) {
            if (sensorStatePayload.active) {
              sensorManager.start();
            } else {
              sensorManager.stop();
            }
          }
        }
        break;

      case 'asciiMode':
        asciiEnabled.set((payload as { enabled: boolean }).enabled);
        syncLegacyVisualEffects();
        break;

      case 'asciiResolution':
        asciiResolution.set((payload as { cellSize: number }).cellSize);
        syncLegacyVisualEffects();
        break;

      case 'visualEffects':
        {
          const effects = normalizeVisualEffectsPayload(payload as VisualEffectsPayload);
          visualEffects.set(effects);
          syncVisualEffectsToLegacyStores(effects);
        }
        break;

      case 'convolution':
        {
          const convPayload = payload as ConvolutionPayload;
          const allowed: ConvolutionPreset[] = [
            'blur',
            'gaussianBlur',
            'sharpen',
            'edge',
            'emboss',
            'sobelX',
            'sobelY',
            'custom',
          ];

          convolution.update((prev) => {
            const next: ConvolutionState = { ...prev };

            if (typeof convPayload.enabled === 'boolean') {
              next.enabled = convPayload.enabled;
            }

            const presetCandidate =
              typeof convPayload.preset === 'string' &&
              allowed.includes(convPayload.preset as ConvolutionPreset)
                ? (convPayload.preset as ConvolutionPreset)
                : null;

            if (presetCandidate) {
              next.preset = presetCandidate;
            }

            if (Array.isArray(convPayload.kernel)) {
              const kernel = convPayload.kernel
                .map((n) => (typeof n === 'number' ? n : Number(n)))
                .filter((n) => Number.isFinite(n))
                .slice(0, 9);
              next.kernel = kernel.length === 9 ? kernel : null;
            } else if (presetCandidate) {
              // Avoid stale kernel overriding preset kernels when the preset changes.
              next.kernel = null;
            }

            if (typeof convPayload.mix === 'number' && Number.isFinite(convPayload.mix)) {
              next.mix = Math.max(0, Math.min(1, convPayload.mix));
            }

            if (typeof convPayload.bias === 'number' && Number.isFinite(convPayload.bias)) {
              next.bias = Math.max(-1, Math.min(1, convPayload.bias));
            }

            if (typeof convPayload.normalize === 'boolean') {
              next.normalize = convPayload.normalize;
            }

            if (typeof convPayload.scale === 'number' && Number.isFinite(convPayload.scale)) {
              next.scale = Math.max(0.1, Math.min(1, convPayload.scale));
            }

            return next;
          });

          syncLegacyVisualEffects();
        }
        break;

      case 'custom':
        {
          const raw = payload as Partial<PushImageUploadPayload> | null;
          if (raw && typeof raw === 'object' && raw.kind === 'push-image-upload') {
            console.info('[Client] push-image-upload requested', {
              seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : null,
              speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : null,
              format: typeof raw.format === 'string' ? raw.format : null,
              quality:
                typeof raw.quality === 'number' && Number.isFinite(raw.quality)
                  ? raw.quality
                  : null,
              maxWidth:
                typeof raw.maxWidth === 'number' && Number.isFinite(raw.maxWidth)
                  ? raw.maxWidth
                  : null,
            });
            void handlePushImageUpload(raw as PushImageUploadPayload);
            break;
          }
          console.log('[Client] Unknown custom payload:', payload);
        }
        break;

      default:
        console.log('[Client] Unknown action:', action);
    }
  };

  if (executeAt && sdk) {
    // Special efficient path for audio: use Web Audio scheduling
    const shouldUseAudioScheduling =
      action === 'modulateSound' ||
      action === 'playSound' ||
      (action === 'playMedia' &&
        (() => {
          const mediaType = (payload as any)?.mediaType;
          if (mediaType === 'video') return false;
          const rawUrl = (payload as any)?.url;
          const url = typeof rawUrl === 'string' ? rawUrl : String(rawUrl ?? '');
          return !/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(url);
        })());

    if (shouldUseAudioScheduling) {
      const delayMs = sdk.getDelayUntil(executeAt);
      const delaySeconds = Math.max(0, delayMs / 1000);

      // Execute immediately but pass the Future Delay to the audio engine
      // This bypasses setTimeout jitter
      executeAction(delaySeconds);
    } else {
      // Standard scheduling for visual effects (setTimeout is fine)
      const { cancel, delay } = sdk.scheduleAt(executeAt, () => executeAction(0));
      if (delay < 0) {
        // Already past: execute immediately and cancel the scheduled callback to avoid double execution.
        cancel();
        executeAction(0);
      }
    }
  } else {
    executeAction(0);
  }
}

/**
 * Handle plugin control messages
 */
function handlePluginControlMessage(message: PluginControlMessage): void {
  // Calculate and log message size
  try {
    const messageJson = JSON.stringify(message);
    const messageSizeBytes = new Blob([messageJson]).size;
    const messageSizeKB = (messageSizeBytes / 1024).toFixed(2);
    
    console.log(
      `[Plugin] ${message.pluginId} ${message.command} | Size: ${messageSizeBytes} bytes (${messageSizeKB} KB)`
    );
  } catch (err) {
    console.log('[Client] Plugin control:', message.pluginId, message.command);
  }
  
  if (message.pluginId === 'node-executor') {
    nodeExecutor?.handlePluginControl(message);
    return;
  }
  if (message.pluginId === 'multimedia-core' && message.command === 'configure') {
    const payload: any = message.payload ?? {};
    const manifestId = typeof payload.manifestId === 'string' ? payload.manifestId : '';
    const assets = Array.isArray(payload.assets) ? payload.assets.map(String) : [];
    const updatedAt =
      typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt)
        ? payload.updatedAt
        : undefined;
    if (!manifestId) return;
    multimediaCore?.setAssetManifest({ manifestId, assets, updatedAt });
    return;
  }
}

/**
 * Disconnect and cleanup
 */
export function disconnect(): void {
  sdk?.disconnect();
  sdk = null;
  // geolocation is handled by the start gate (page); keep permission state as-is.

  nodeExecutor?.destroy();
  nodeExecutor = null;

  mediaUnsub?.();
  mediaUnsub = null;

  sensorManager?.stop();
  sensorManager = null;

  flashlightController?.destroy();
  flashlightController = null;

  screenController?.destroy();
  screenController = null;

  toneSoundPlayer?.stop();
  toneSoundPlayer = null;

  toneModulatedSoundPlayer?.stop();
  toneModulatedSoundPlayer = null;

  multimediaCore?.destroy();
  multimediaCore = null;

  wakeLockController?.release();
  wakeLockController = null;

  // Stop audio stream
  const stream = get(audioStream);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    audioStream.set(null);
  }
}

/**
 * Get SDK for plugin access
 */
export function getSDK(): ClientSDK | null {
  return sdk;
}

/**
 * Measure round-trip latency
 */
export async function measureLatency(): Promise<number> {
  if (!sdk) return 0;

  try {
    const rtt = await sdk.ping();
    latency.set(rtt);
    return rtt;
  } catch (e) {
    console.warn('[Client] Latency check failed:', e);
    return 0;
  }
}
