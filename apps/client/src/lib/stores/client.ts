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
import { MultimediaCore, toneAudioEngine, type MediaEngineState } from '@shugu/multimedia-core';
import type {
  ControlMessage,
  PluginControlMessage,
  ControlAction,
  ControlPayload,
  type ControlBatchPayload,
  FlashlightPayload,
  ScreenColorPayload,
  VibratePayload,
  PlaySoundPayload,
  PlayMediaPayload,
  ShowImagePayload,
  ModulateSoundPayload,
  VisualSceneSwitchPayload,
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

// Current visual scene
export const currentScene = writable<string>('box-scene');

// ASCII post-processing toggle (default on)
export const asciiEnabled = writable<boolean>(true);

// ASCII resolution (cell size in pixels)
export const asciiResolution = writable<number>(11);

// Audio stream for plugins
export const audioStream = writable<MediaStream | null>(null);

const AUDIO_ENABLED_STORAGE_KEY = 'shugu-audio-enabled';
const ASSET_READ_TOKEN_STORAGE_KEY = 'shugu-asset-read-token';
const storedAudioEnabled =
  typeof window !== 'undefined' &&
  window.localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY) === 'true';

// Tone.js audio enablement state (requires user gesture to flip to true).
export const audioEnabled = writable<boolean>(storedAudioEnabled);

type MediaClipParams = {
  baseUrl: string;
  startSec: number;
  endSec: number;
  loop: boolean | null;
  play: boolean | null;
  reverse: boolean | null;
  cursorSec: number | null;
};

function parseMediaClipParams(raw: string): MediaClipParams {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { baseUrl: '', startSec: 0, endSec: -1, loop: null, play: null, reverse: null, cursorSec: null };
  }

  const hashIndex = trimmed.indexOf('#');
  if (hashIndex < 0) {
    return { baseUrl: trimmed, startSec: 0, endSec: -1, loop: null, play: null, reverse: null, cursorSec: null };
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

  const cursorParsed = cursorRaw === null ? null : toNumber(cursorRaw, -1);
  const cursorSec =
    cursorParsed !== null && Number.isFinite(cursorParsed) && cursorParsed >= 0 ? cursorParsed : null;

  return {
    baseUrl,
    startSec: Number.isFinite(startSec) ? startSec : 0,
    endSec: Number.isFinite(endSec) ? endSec : -1,
    loop: loopRaw === null ? null : toBoolean(loopRaw, false),
    play: playRaw === null ? null : toBoolean(playRaw, true),
    reverse: reverseRaw === null ? null : toBoolean(reverseRaw, false),
    cursorSec,
  };
}

// Video playback state
export const videoState = writable<{
  url: string | null;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  volume: number;
  startSec: number;
  endSec: number;
  cursorSec: number;
  reverse: boolean;
}>({
  url: null,
  playing: false,
  muted: true,
  loop: false,
  volume: 1,
  startSec: 0,
  endSec: -1,
  cursorSec: -1,
  reverse: false,
});

// Image display state
export const imageState = writable<{
  url: string | null;
  visible: boolean;
  duration: number | undefined;
}>({
  url: null,
  visible: false,
  duration: undefined,
});

// Derived stores
export const connectionStatus = derived(state, ($state) => $state.status);
export const clientId = derived(state, ($state) => $state.clientId);

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
      if (!snapshot) return;
      try {
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
  const assetReadToken =
    typeof window !== 'undefined' ? window.localStorage.getItem(ASSET_READ_TOKEN_STORAGE_KEY) : null;
  multimediaCore = new MultimediaCore({
    serverUrl: config.serverUrl,
    assetReadToken,
    autoStart: true,
    concurrency: 4,
  });

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
      const connected = Boolean(sdk?.getState?.().clientId) && sdk?.getState?.().status === 'connected';
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
  const result = await toneAudioEngine.start();
  audioEnabled.set(result.enabled);
  persistAudioEnabled(result.enabled);
  return result;
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
  executeControl(message.action, message.payload, message.executeAt);
}

function isControlBatchPayload(payload: ControlPayload): payload is ControlBatchPayload {
  if (!payload || typeof payload !== 'object') return false;
  if ((payload as any).kind !== 'control-batch') return false;
  return Array.isArray((payload as any).items);
}

function executeControl(action: ControlAction, payload: ControlPayload, executeAt?: number): void {
  // Expand control batches early so we don't schedule the wrapper message (avoid double scheduling).
  if (action === 'custom' && isControlBatchPayload(payload)) {
    const batch = payload as ControlBatchPayload;
    const batchExecuteAt =
      typeof batch.executeAt === 'number' && Number.isFinite(batch.executeAt) ? batch.executeAt : executeAt;

    for (const raw of batch.items) {
      if (!raw || typeof raw !== 'object') continue;
      const itemAction = (raw as any).action as ControlAction | undefined;
      if (!itemAction) continue;
      const itemPayload = ((raw as any).payload ?? {}) as ControlPayload;
      const itemExecuteAtRaw = (raw as any).executeAt;
      const itemExecuteAt =
        typeof itemExecuteAtRaw === 'number' && Number.isFinite(itemExecuteAtRaw) ? itemExecuteAtRaw : batchExecuteAt;
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
          durationMs:
            (payload as any).durationMs ?? (payload as ModulateSoundPayload).duration,
        });
        break;

      case 'playSound':
        {
          const soundPayload = payload as PlaySoundPayload;
          const url =
            typeof soundPayload.url === 'string' ? multimediaCore?.resolveAssetRef(soundPayload.url) ?? soundPayload.url : soundPayload.url;
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
            ? multimediaCore?.resolveAssetRef(baseUrl) ?? baseUrl
            : baseUrl;
        // Check if it's a video by extension or explicit type
        const resolvedUrlString = typeof resolvedUrl === 'string' ? resolvedUrl : String(resolvedUrl ?? '');
        const isVideo =
          mediaPayload.mediaType === 'video' || /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(resolvedUrlString);

        if (isVideo) {
          const loop = clip?.loop ?? mediaPayload.loop ?? false;
          const playing = clip?.play ?? Boolean(resolvedUrlString);
          const startSec = clip ? Math.max(0, clip.startSec) : 0;
          const endSec = clip ? clip.endSec : -1;
          const cursorSec = clip?.cursorSec ?? -1;
          const reverse = clip?.reverse ?? false;
          multimediaCore?.media.playVideo({
            url: resolvedUrlString,
            muted: mediaPayload.muted ?? true,
            loop,
            volume: mediaPayload.volume ?? 1,
            playing,
            startSec,
            endSec,
            cursorSec,
            reverse,
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
        const url =
          typeof imagePayload.url === 'string'
            ? multimediaCore?.resolveAssetRef(imagePayload.url) ?? imagePayload.url
            : imagePayload.url;
        multimediaCore?.media.showImage({
          url: String(url ?? ''),
          duration: imagePayload.duration,
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
        break;

      case 'asciiResolution':
        asciiResolution.set((payload as { cellSize: number }).cellSize);
        break;

      case 'custom':
        console.log('[Client] Unknown custom payload:', payload);
        break;

      default:
        console.log('[Client] Unknown action:', action);
    }
  };

  if (executeAt && sdk) {
    // Special efficient path for audio: use Web Audio scheduling
    if (action === 'modulateSound' || action === 'playSound') {
      const delayMs = sdk.getDelayUntil(executeAt);
      const delaySeconds = Math.max(0, delayMs / 1000);

      // Execute immediately but pass the Future Delay to the audio engine
      // This bypasses setTimeout jitter
      executeAction(delaySeconds);
    } else {
      // Standard scheduling for visual effects (setTimeout is fine)
      const { delay } = sdk.scheduleAt(executeAt, () => executeAction(0));
      if (delay < 0) {
        // Already past
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
  console.log('[Client] Plugin control:', message.pluginId, message.command);
  if (message.pluginId === 'node-executor') {
    nodeExecutor?.handlePluginControl(message);
    return;
  }
  if (message.pluginId === 'multimedia-core' && message.command === 'configure') {
    const payload: any = message.payload ?? {};
    const manifestId = typeof payload.manifestId === 'string' ? payload.manifestId : '';
    const assets = Array.isArray(payload.assets) ? payload.assets.map(String) : [];
    const updatedAt =
      typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt) ? payload.updatedAt : undefined;
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
