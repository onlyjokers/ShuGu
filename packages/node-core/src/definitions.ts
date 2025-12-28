import type { ControlAction, ControlPayload, SensorPayload, SensorType } from '@shugu/protocol';

import type { NodeDefinition } from './types.js';
import type { NodeRegistry } from './registry.js';

export type NodeCommand = {
  action: ControlAction;
  payload: ControlPayload;
  executeAt?: number;
};

export type LatestSensorDataLike = {
  sensorType: SensorType;
  payload: SensorPayload;
  serverTimestamp: number;
  clientTimestamp: number;
};

export type ClientSensorMessage = {
  sensorType: SensorType;
  payload: SensorPayload;
  serverTimestamp: number;
  clientTimestamp: number;
};

export type ClientObject = {
  clientId: string;
  sensors?: ClientSensorMessage | null;
};

export type ClientObjectDeps = {
  getClientId: () => string | null;
  /**
   * Manager-side list of all available clientIds (for client selection inputs).
   * Client-side implementations may return `[selfClientId]` (or `[]` when offline).
   */
  getAllClientIds?: () => string[];
  /**
   * Manager-side selected clientIds (fallback when the node has no explicit selection).
   */
  getSelectedClientIds?: () => string[];
  /**
   * Client-side convenience (single local client).
   * Prefer `getSensorForClientId` when available.
   */
  getLatestSensor?: () => LatestSensorDataLike | null;
  /**
   * Manager-side (or multi-client) lookup.
   */
  getSensorForClientId?: (clientId: string) => LatestSensorDataLike | null;
  /**
   * Manager-side lookup for per-client uploaded images (e.g. screenshots).
   */
  getImageForClientId?: (clientId: string) => unknown;
  /**
   * Client-side convenience (single local client).
   * Prefer `executeCommandForClientId` when available.
   */
  executeCommand: (cmd: NodeCommand) => void;
  /**
   * Manager-side (or multi-client) routing.
   */
  executeCommandForClientId?: (clientId: string, cmd: NodeCommand) => void;
};

type ClientSelectionState = {
  availableKey: string;
  random: boolean;
  stableRandomOrder: string[];
};

const clientSelectionStateByNodeId = new Map<string, ClientSelectionState>();

function hashStringDjb2(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const next = Math.floor(n);
  return Math.max(min, Math.min(max, next));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value >= 0.5 : false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (!s) return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
    return true;
  }
  return false;
}

function coerceBooleanOr(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return coerceBoolean(value);
}

function coerceAssetVolumeGain(value: unknown): number {
  // UI Volume is a relative control in [-1, 2]:
  // -1 => mute, 0 => normal (gain=1), 2 => max (gain=2), >2 => linear gain up to 100.
  const raw = typeof value === 'string' ? Number(value) : Number(value);
  const v = Number.isFinite(raw) ? Math.max(-1, Math.min(100, raw)) : 0;
  if (v <= -1) return 0;
  if (v < 0) return 1 + v;
  if (v <= 2) return 1 + v / 2;
  return v;
}

type LocalMediaKind = 'audio' | 'image' | 'video';

function ensureLocalMediaKindQuery(ref: string, kind: LocalMediaKind): string {
  const hashIndex = ref.indexOf('#');
  const hash = hashIndex >= 0 ? ref.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;

  const qIndex = withoutHash.indexOf('?');
  if (qIndex < 0) return `${withoutHash}?kind=${kind}${hash}`;

  const base = withoutHash.slice(0, qIndex);
  const search = withoutHash.slice(qIndex + 1);
  try {
    const params = new URLSearchParams(search);
    if (!params.has('kind')) params.set('kind', kind);
    return `${base}?${params.toString()}${hash}`;
  } catch {
    const joiner = withoutHash.endsWith('?') || withoutHash.endsWith('&') ? '' : '&';
    return `${withoutHash}${joiner}kind=${kind}${hash}`;
  }
}

function isAbsoluteFilePath(filePath: string): boolean {
  const s = filePath.trim();
  if (!s) return false;
  if (s.startsWith('/')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('\\\\')) return true;
  return false;
}

function normalizeLocalMediaRef(raw: unknown, kind: LocalMediaKind): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';

  // Display-local file reference (registered via Manager↔Display local bridge).
  if (s.startsWith('displayfile:')) {
    return ensureLocalMediaKindQuery(s, kind);
  }

  if (s.startsWith('localfile:')) {
    return ensureLocalMediaKindQuery(s, kind);
  }

  const shuguLocalPrefix = 'shugu://local-file/';
  if (s.startsWith(shuguLocalPrefix)) {
    const encoded = s.slice(shuguLocalPrefix.length).trim();
    if (!encoded) return '';
    try {
      const decoded = decodeURIComponent(encoded);
      if (!decoded.trim()) return '';
      return ensureLocalMediaKindQuery(`localfile:${decoded.trim()}`, kind);
    } catch {
      return ensureLocalMediaKindQuery(`localfile:${encoded}`, kind);
    }
  }

  // Local nodes must never fetch remote assets; accept only absolute local paths.
  if (!isAbsoluteFilePath(s)) return '';
  return ensureLocalMediaKindQuery(`localfile:${s}`, kind);
}

function formatAnyPreview(value: unknown): string {
  const MAX_LEN = 160;

  const clamp = (raw: string): string => {
    const singleLine = raw.replace(/\s+/g, ' ').trim();
    if (!singleLine) return '--';
    if (singleLine.length <= MAX_LEN) return singleLine;
    return `${singleLine.slice(0, MAX_LEN - 1)}…`;
  };

  if (value === undefined) return '--';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--';
    const rounded = Math.round(value * 1000) / 1000;
    return clamp(String(rounded));
  }
  if (typeof value === 'string') return clamp(value);

  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return clamp(json);
  } catch {
    // ignore
  }

  try {
    return clamp(String(value));
  } catch {
    return '--';
  }
}

function buildStableRandomOrder(nodeId: string, clients: string[]): string[] {
  const keyed = clients.map((id) => ({ id, score: hashStringDjb2(`${nodeId}|${id}`) }));
  keyed.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return keyed.map((k) => k.id);
}

function selectClientIdsForNode(
  nodeId: string,
  clients: string[],
  options: { index: unknown; range: unknown; random: unknown }
): { index: number; selectedIds: string[] } {
  const total = clients.length;
  if (total === 0) return { index: 1, selectedIds: [] };

  const index = clampInt(options.index, 1, 1, total);
  const range = clampInt(options.range, 1, 1, total);
  const random = coerceBoolean(options.random);

  const availableKey = clients.join('|');
  const prev = clientSelectionStateByNodeId.get(nodeId);
  const needRebuild =
    !prev ||
    prev.availableKey !== availableKey ||
    prev.random !== random ||
    prev.stableRandomOrder.length !== total;

  const state: ClientSelectionState = needRebuild
    ? {
        availableKey,
        random,
        stableRandomOrder: random ? buildStableRandomOrder(nodeId, clients) : clients.slice(),
      }
    : prev;

  if (needRebuild) clientSelectionStateByNodeId.set(nodeId, state);

  const ordered = state.random ? state.stableRandomOrder : clients;
  const start = index - 1;
  const selected: string[] = [];
  for (let i = 0; i < range; i += 1) {
    selected.push(ordered[(start + i) % total]);
  }
  return { index, selectedIds: selected };
}

export function registerDefaultNodeDefinitions(
  registry: NodeRegistry,
  deps: ClientObjectDeps
): void {
  registry.register(createClientObjectNode(deps));
  registry.register(createCmdAggregatorNode());
  registry.register(createClientSensorsProcessorNode());
  registry.register(createMathNode());
  registry.register(createLogicAddNode());
  registry.register(createLogicMultipleNode());
  registry.register(createLogicSubtractNode());
  registry.register(createLogicDivideNode());
  registry.register(createLogicNotNode());
  registry.register(createLogicAndNode());
  registry.register(createLogicOrNode());
  registry.register(createLogicNandNode());
  registry.register(createLogicNorNode());
  registry.register(createLogicXorNode());
  registry.register(createLogicIfNode());
  registry.register(createLogicForNode());
  registry.register(createLogicSleepNode());
  registry.register(createShowAnythingNode());
  registry.register(createNoteNode());
  registry.register(createNumberNode());
  registry.register(createStringNode());
  registry.register(createBoolNode());
  registry.register(createNumberStabilizerNode());
  // Tone.js audio nodes (client runtime overrides these definitions).
  registry.register(createToneLFONode());
  registry.register(createToneOscNode());
  registry.register(createToneDelayNode());
  registry.register(createToneResonatorNode());
  registry.register(createTonePitchNode());
  registry.register(createToneReverbNode());
  registry.register(createToneGranularNode());
  registry.register(createAudioDataNode());
  // Media playback helpers.
  registry.register(createLoadAudioFromAssetsNode());
  registry.register(createLoadAudioFromLocalNode());
  registry.register(createLoadImageFromAssetsNode());
  registry.register(createLoadImageFromLocalNode());
  registry.register(createLoadVideoFromAssetsNode());
  registry.register(createLoadVideoFromLocalNode());
  registry.register(createPlayMediaNode());
  // Patch root sinks (Max/MSP style).
  registry.register(createAudioOutNode());
  registry.register(createImageOutNode(deps));
  registry.register(createVideoOutNode(deps));
  registry.register(createFlashlightProcessorNode());
  registry.register(createShowImageProcessorNode());
  registry.register(createPushImageUploadNode());
  registry.register(createScreenColorProcessorNode());
  registry.register(createSynthUpdateProcessorNode());
  registry.register(createAsciiEffectProcessorNode());
  registry.register(createConvolutionEffectProcessorNode());
  registry.register(createSceneSwitchProcessorNode());
}

// Audio tap: passes audio through while exposing real-time analysis data on the client runtime.
function createAudioDataNode(): NodeDefinition {
  return {
    type: 'audio-data',
    label: 'Audio Data',
    category: 'Audio',
    inputs: [{ id: 'in', label: 'In', type: 'audio', kind: 'sink' }],
    outputs: [
      { id: 'out', label: 'Out', type: 'audio', kind: 'sink' },
      { id: 'rms', label: 'RMS', type: 'number' },
      { id: 'peak', label: 'Peak', type: 'number' },
      { id: 'low', label: 'Low', type: 'number' },
      { id: 'mid', label: 'Mid', type: 'number' },
      { id: 'high', label: 'High', type: 'number' },
      { id: 'centroidHz', label: 'Centroid (Hz)', type: 'number' },
      { id: 'bpm', label: 'BPM', type: 'number' },
      { id: 'beat', label: 'Beat', type: 'boolean' },
    ],
    configSchema: [
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
      {
        key: 'fftSize',
        label: 'FFT Size',
        type: 'select',
        defaultValue: '2048',
        options: [
          { value: '512', label: '512' },
          { value: '1024', label: '1024' },
          { value: '2048', label: '2048' },
          { value: '4096', label: '4096' },
          { value: '8192', label: '8192' },
        ],
      },
      { key: 'smoothing', label: 'Smoothing', type: 'number', defaultValue: 0.2, min: 0, max: 0.99, step: 0.01 },
      { key: 'lowCutoffHz', label: 'Low Cutoff (Hz)', type: 'number', defaultValue: 300, min: 20, max: 20000, step: 10 },
      { key: 'highCutoffHz', label: 'High Cutoff (Hz)', type: 'number', defaultValue: 3000, min: 20, max: 20000, step: 10 },
      { key: 'detectBPM', label: 'Detect BPM', type: 'boolean', defaultValue: true },
    ],
    process: (inputs) => ({
      out: (inputs.in as number) ?? 0,
      rms: 0,
      peak: 0,
      low: 0,
      mid: 0,
      high: 0,
      centroidHz: 0,
      bpm: 0,
      beat: false,
    }),
  };
}

type LoadAudioTimelineState = {
  signature: string;
  lastPlay: boolean;
  lastCursorSec: number | null;
  startedFromSec: number | null;
  progressedSec: number;
  ended: boolean;
};

const loadAudioTimelineState = new Map<string, LoadAudioTimelineState>();

function computeLoadAudioFinished(opts: {
  nodeId: string;
  signature: string;
  play: boolean;
  loop: boolean;
  reverse: boolean;
  playbackRate: number;
  clipStart: number;
  clipEnd: number; // -1 means open-ended (unknown duration).
  cursorSec: number | null;
  deltaTimeMs: number;
}): boolean {
  const state: LoadAudioTimelineState = loadAudioTimelineState.get(opts.nodeId) ?? {
    signature: '',
    lastPlay: false,
    lastCursorSec: null,
    startedFromSec: null,
    progressedSec: 0,
    ended: false,
  };

  const settingsChanged = opts.signature !== state.signature;
  if (settingsChanged) {
    state.signature = opts.signature;
    state.lastCursorSec = null;
    state.startedFromSec = null;
    state.progressedSec = 0;
    state.ended = false;
  }

  const playActive = Boolean(opts.play);
  const playRising = playActive && !state.lastPlay;

  if (!playActive) {
    // Match client runtime: Play=false clears Finish, but keep playhead progress for resume.
    state.ended = false;
    state.lastPlay = false;
    loadAudioTimelineState.set(opts.nodeId, state);
    return false;
  }

  const resolvedClipEnd = opts.clipEnd >= 0 ? Math.max(opts.clipStart, opts.clipEnd) : null;
  const cursorClamped = (() => {
    if (opts.cursorSec === null) return null;
    const base = Math.max(opts.clipStart, opts.cursorSec);
    if (resolvedClipEnd !== null) return Math.min(resolvedClipEnd, base);
    return base;
  })();

  const cursorChanged = (() => {
    if (cursorClamped === null) {
      return state.lastCursorSec !== null;
    }
    if (state.lastCursorSec === null) return true;
    return Math.abs(cursorClamped - state.lastCursorSec) > 0.005;
  })();

  if (cursorChanged) {
    state.lastCursorSec = cursorClamped;
    state.startedFromSec = cursorClamped;
    state.progressedSec = 0;
    state.ended = false;
  } else {
    state.lastCursorSec = cursorClamped;
  }

  if (state.ended && playRising) {
    state.startedFromSec = cursorClamped;
    state.progressedSec = 0;
    state.ended = false;
  }

  if (opts.loop) {
    state.ended = false;
    state.lastPlay = true;
    loadAudioTimelineState.set(opts.nodeId, state);
    return false;
  }

  if (state.startedFromSec === null) {
    const fallbackStart =
      opts.reverse && resolvedClipEnd !== null ? resolvedClipEnd : Math.max(0, opts.clipStart);
    state.startedFromSec = cursorClamped ?? fallbackStart;
    state.progressedSec = 0;
    state.ended = false;
  }

  if (resolvedClipEnd === null) {
    // Without an explicit end, we cannot infer the full media duration on the manager.
    state.ended = false;
    state.lastPlay = true;
    loadAudioTimelineState.set(opts.nodeId, state);
    return false;
  }

  const startPos = clampNumber(state.startedFromSec, opts.clipStart, resolvedClipEnd);
  const durationSec = opts.reverse
    ? Math.max(0, startPos - opts.clipStart)
    : Math.max(0, resolvedClipEnd - startPos);

  const rateRaw = Math.abs(opts.playbackRate);
  const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1;
  const dtSec = Number.isFinite(opts.deltaTimeMs) ? Math.max(0, opts.deltaTimeMs) / 1000 : 0;

  if (durationSec <= 0) {
    state.ended = true;
  } else if (state.lastPlay) {
    state.progressedSec = Math.min(durationSec, state.progressedSec + dtSec * rate);
    if (state.progressedSec >= durationSec) {
      state.ended = true;
    }
  }

  state.lastPlay = true;
  loadAudioTimelineState.set(opts.nodeId, state);
  return state.ended;
}

function createLoadAudioFromAssetsNode(): NodeDefinition {
  return {
    type: 'load-audio-from-assets',
    label: 'Load Audio From Remote',
    category: 'Assets',
    inputs: [
      { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
      { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
      {
        id: 'cursorSec',
        label: 'Cursor (s)',
        type: 'number',
        defaultValue: -1,
        min: -1,
        step: 0.01,
      },
      { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
      { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      {
        id: 'volume',
        label: 'Volume',
        type: 'number',
        defaultValue: 0,
        min: -1,
        max: 100,
        step: 0.01,
      },
      { id: 'bus', label: 'Bus', type: 'string' },
    ],
    outputs: [
      { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
      { id: 'ended', label: 'Finish', type: 'boolean' },
    ],
    configSchema: [
      {
        key: 'assetId',
        label: 'Audio Asset',
        type: 'asset-picker',
        assetKind: 'audio',
        defaultValue: '',
      },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      {
        key: 'timeline',
        label: 'Timeline',
        type: 'time-range',
        defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
        min: 0,
        step: 0.01,
      },
    ],
    process: (inputs, config, context) => {
      const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
      const play = coerceBoolean(inputs.play);
      const loop = coerceBoolean(inputs.loop);
      const reverse = coerceBoolean(inputs.reverse);
      const playbackRate = coerceNumber(inputs.playbackRate ?? config.playbackRate, 1);

      const clipStart = Math.max(0, coerceNumber(inputs.startSec, 0));
      const clipEndRaw = coerceNumber(inputs.endSec, -1);
      const clipEnd =
        Number.isFinite(clipEndRaw) && clipEndRaw >= 0 ? Math.max(clipStart, clipEndRaw) : -1;

      const cursorRaw = coerceNumber(inputs.cursorSec, -1);
      const cursorSec =
        Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.max(0, cursorRaw) : null;

      if (!assetId) {
        loadAudioTimelineState.delete(context.nodeId);
        return { ref: 0, ended: false };
      }

      // Manager-side simulation: the actual audio playback is implemented on the client runtime.
      // Emit a best-effort Finish state based on the configured clip and playback controls.
      const signature = [
        assetId,
        Math.round(clipStart * 1000) / 1000,
        Math.round(clipEnd * 1000) / 1000,
        loop ? 1 : 0,
        reverse ? 1 : 0,
      ].join('|');

      const ended = computeLoadAudioFinished({
        nodeId: context.nodeId,
        signature,
        play,
        loop,
        reverse,
        playbackRate,
        clipStart,
        clipEnd,
        cursorSec,
        deltaTimeMs: context.deltaTime,
      });

      return { ref: play ? 1 : 0, ended };
    },
  };
}

function createLoadAudioFromLocalNode(): NodeDefinition {
  return {
    type: 'load-audio-from-local',
    label: 'Load Audio From Local(Display only)',
    category: 'Assets',
    inputs: [
      { id: 'asset', label: 'Asset', type: 'string', defaultValue: '' },
      { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
      { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
      {
        id: 'cursorSec',
        label: 'Cursor (s)',
        type: 'number',
        defaultValue: -1,
        min: -1,
        step: 0.01,
      },
      { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
      { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      {
        id: 'volume',
        label: 'Volume',
        type: 'number',
        defaultValue: 0,
        min: -1,
        max: 100,
        step: 0.01,
      },
      { id: 'bus', label: 'Bus', type: 'string' },
    ],
    outputs: [
      { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
      { id: 'ended', label: 'Finish', type: 'boolean' },
    ],
    configSchema: [
      {
        key: 'assetPath',
        label: 'Audio Asset',
        type: 'local-asset-picker',
        assetKind: 'audio',
        defaultValue: '',
      },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      {
        key: 'timeline',
        label: 'Timeline',
        type: 'time-range',
        defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
        min: 0,
        step: 0.01,
      },
    ],
    process: (inputs, config, context) => {
      const asset =
        typeof inputs.asset === 'string' && inputs.asset.trim()
          ? inputs.asset.trim()
          : typeof (config as any).assetPath === 'string'
            ? String((config as any).assetPath).trim()
            : '';
      const play = coerceBoolean(inputs.play);
      const loop = coerceBoolean(inputs.loop);
      const reverse = coerceBoolean(inputs.reverse);
      const playbackRate = coerceNumber(inputs.playbackRate ?? config.playbackRate, 1);

      const clipStart = Math.max(0, coerceNumber(inputs.startSec, 0));
      const clipEndRaw = coerceNumber(inputs.endSec, -1);
      const clipEnd =
        Number.isFinite(clipEndRaw) && clipEndRaw >= 0 ? Math.max(clipStart, clipEndRaw) : -1;

      const cursorRaw = coerceNumber(inputs.cursorSec, -1);
      const cursorSec =
        Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.max(0, cursorRaw) : null;

      if (!asset) {
        loadAudioTimelineState.delete(context.nodeId);
        return { ref: 0, ended: false };
      }

      const signature = [
        asset,
        Math.round(clipStart * 1000) / 1000,
        Math.round(clipEnd * 1000) / 1000,
        loop ? 1 : 0,
        reverse ? 1 : 0,
      ].join('|');

      const ended = computeLoadAudioFinished({
        nodeId: context.nodeId,
        signature,
        play,
        loop,
        reverse,
        playbackRate,
        clipStart,
        clipEnd,
        cursorSec,
        deltaTimeMs: context.deltaTime,
      });

      // Client runtime may override this for real playback. Manager-side stays as a best-effort sim.
      return { ref: play ? 1 : 0, ended };
    },
  };
}

function createLoadImageFromAssetsNode(): NodeDefinition {
  return {
    type: 'load-image-from-assets',
    label: 'Load Image From Remote',
    category: 'Assets',
    inputs: [],
    outputs: [{ id: 'ref', label: 'Image Out', type: 'image', kind: 'sink' }],
    configSchema: [
      {
        key: 'assetId',
        label: 'Image Asset',
        type: 'asset-picker',
        assetKind: 'image',
        defaultValue: '',
      },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        defaultValue: 'contain',
        options: [
          { value: 'contain', label: 'Contain' },
          { value: 'fit-screen', label: 'Fit Screen' },
          { value: 'cover', label: 'Cover' },
          { value: 'fill', label: 'Fill' },
        ],
      },
    ],
    process: (_inputs, config) => {
      const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
      const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
      const fit =
        fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
      const fitHash = fit !== 'contain' ? `#fit=${fit}` : '';
      return { ref: assetId ? `asset:${assetId}${fitHash}` : '' };
    },
  };
}

function createLoadImageFromLocalNode(): NodeDefinition {
  return {
    type: 'load-image-from-local',
    label: 'Load Image From Local(Display only)',
    category: 'Assets',
    inputs: [{ id: 'asset', label: 'Asset', type: 'string', defaultValue: '' }],
    outputs: [{ id: 'ref', label: 'Image Out', type: 'image', kind: 'sink' }],
    configSchema: [
      {
        key: 'assetPath',
        label: 'Image Asset',
        type: 'local-asset-picker',
        assetKind: 'image',
        defaultValue: '',
      },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        defaultValue: 'contain',
        options: [
          { value: 'contain', label: 'Contain' },
          { value: 'fit-screen', label: 'Fit Screen' },
          { value: 'cover', label: 'Cover' },
          { value: 'fill', label: 'Fill' },
        ],
      },
    ],
    process: (inputs, config) => {
      const baseUrl =
        typeof inputs.asset === 'string' && inputs.asset.trim()
          ? inputs.asset.trim()
          : typeof (config as any).assetPath === 'string'
            ? String((config as any).assetPath).trim()
            : '';
      const baseRef = baseUrl ? normalizeLocalMediaRef(baseUrl, 'image') : '';
      const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
      const fit =
        fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
      const fitHash = fit !== 'contain' ? `#fit=${fit}` : '';
      if (!baseRef) return { ref: '' };
      if (!fitHash) return { ref: baseRef };
      const hashIndex = baseRef.indexOf('#');
      if (hashIndex < 0) return { ref: `${baseRef}${fitHash}` };
      const withoutHash = baseRef.slice(0, hashIndex);
      const params = new URLSearchParams(baseRef.slice(hashIndex + 1));
      params.set('fit', fit);
      return { ref: `${withoutHash}#${params.toString()}` };
    },
  };
}

// Tracks playback progress for `load-video-from-assets` / `load-video-from-local` timeline simulation.
type LoadVideoTimelineState = {
  signature: string;
  lastPlay: boolean;
  accumulatedMs: number;
};

const loadVideoTimelineState = new Map<string, LoadVideoTimelineState>();

function createLoadVideoFromAssetsNode(): NodeDefinition {
  return {
    type: 'load-video-from-assets',
    label: 'Load Video From Remote',
    category: 'Assets',
    inputs: [
      { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
      { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
      {
        id: 'cursorSec',
        label: 'Cursor (s)',
        type: 'number',
        defaultValue: -1,
        min: -1,
        step: 0.01,
      },
      { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
      { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { id: 'muted', label: 'Mute', type: 'boolean', defaultValue: true },
    ],
    outputs: [
      { id: 'ref', label: 'Video Out', type: 'video', kind: 'sink' },
      { id: 'ended', label: 'Finish', type: 'boolean' },
    ],
    configSchema: [
      {
        key: 'assetId',
        label: 'Video Asset',
        type: 'asset-picker',
        assetKind: 'video',
        defaultValue: '',
      },
      {
        key: 'timeline',
        label: 'Timeline',
        type: 'time-range',
        defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
        min: 0,
        step: 0.01,
      },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        defaultValue: 'contain',
        options: [
          { value: 'contain', label: 'Contain' },
          { value: 'fit-screen', label: 'Fit Screen' },
          { value: 'cover', label: 'Cover' },
          { value: 'fill', label: 'Fill' },
        ],
      },
    ],
    process: (inputs, config, context) => {
      const assetId = typeof config.assetId === 'string' ? config.assetId.trim() : '';
      const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
      const fit =
        fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
      const startSecRaw = inputs.startSec;
      const endSecRaw = inputs.endSec;
      const cursorSecRaw = inputs.cursorSec;
      const startSec =
        typeof startSecRaw === 'number' && Number.isFinite(startSecRaw) ? startSecRaw : 0;
      const endSec = typeof endSecRaw === 'number' && Number.isFinite(endSecRaw) ? endSecRaw : -1;
      const cursorSec =
        typeof cursorSecRaw === 'number' && Number.isFinite(cursorSecRaw) ? cursorSecRaw : -1;

      const loopRaw = inputs.loop;
      const loop = typeof loopRaw === 'number' ? loopRaw >= 0.5 : Boolean(loopRaw);
      const playRaw = inputs.play;
      const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
      const reverseRaw = inputs.reverse;
      const reverse = typeof reverseRaw === 'number' ? reverseRaw >= 0.5 : Boolean(reverseRaw);
      const mutedRaw = inputs.muted;
      const muted = typeof mutedRaw === 'number' ? mutedRaw >= 0.5 : Boolean(mutedRaw);
      const volumeGain = Math.round(coerceAssetVolumeGain(inputs.volume) * 100) / 100;
      const mutedEffective = muted || volumeGain <= 0;

      const startClamped = Math.max(0, startSec);
      const endClamped = endSec >= 0 ? Math.max(startClamped, endSec) : -1;
      const tValue = endClamped >= 0 ? `${startClamped},${endClamped}` : `${startClamped},`;

      const cursorClamped = cursorSec >= 0 ? Math.max(startClamped, cursorSec) : -1;
      const cursorForPlayback =
        cursorClamped >= 0
          ? endClamped >= 0
            ? Math.min(endClamped, cursorClamped)
            : cursorClamped
          : null;
      const positionParam = cursorForPlayback !== null ? `&p=${cursorForPlayback}` : '';
      const nodeParam = context?.nodeId ? `&node=${encodeURIComponent(String(context.nodeId))}` : '';
      const fitParam = fit !== 'contain' ? `&fit=${fit}` : '';

      const refBase = assetId
        ? `asset:${assetId}#t=${tValue}&loop=${loop ? 1 : 0}&play=${play ? 1 : 0}&rev=${reverse ? 1 : 0}&vol=${volumeGain}&muted=${mutedEffective ? 1 : 0}${positionParam}${nodeParam}`
        : '';

      const refWithFit = fitParam ? `${refBase}${fitParam}` : refBase;

      if (!assetId) {
        loadVideoTimelineState.delete(context.nodeId);
        return { ref: '', ended: false };
      }

      const qSec = (value: number): number => Math.round(value * 100) / 100;
      const signature = [
        assetId,
        qSec(startClamped),
        qSec(endClamped),
        qSec(cursorForPlayback ?? -1),
        loop ? 1 : 0,
        reverse ? 1 : 0,
      ].join('|');

      const prevState = loadVideoTimelineState.get(context.nodeId);
      const state: LoadVideoTimelineState = prevState ?? {
        signature: '',
        lastPlay: false,
        accumulatedMs: 0,
      };

      const settingsChanged = signature !== state.signature;
      if (settingsChanged) {
        state.signature = signature;
        state.accumulatedMs = 0;
      }

      const playActive = play;
      const playRising = playActive && !state.lastPlay;

      let durationSec: number | null = null;
      if (!loop) {
        if (reverse) {
          const startPos = cursorForPlayback ?? (endClamped >= 0 ? endClamped : startClamped);
          durationSec = Math.max(0, startPos - startClamped);
        } else if (endClamped >= 0) {
          const startPos = cursorForPlayback ?? startClamped;
          durationSec = Math.max(0, endClamped - startPos);
        }
      }

      const durationMs = durationSec !== null ? durationSec * 1000 : null;
      const atEdgeBefore = !loop && durationMs !== null && state.accumulatedMs >= durationMs;

      if (atEdgeBefore && playRising) {
        state.accumulatedMs = 0;
      }

      const dtMs =
        typeof context.deltaTime === 'number' && Number.isFinite(context.deltaTime)
          ? Math.max(0, context.deltaTime)
          : 0;

      if (!loop && durationMs !== null && playActive) {
        if (durationMs <= 0) {
          state.accumulatedMs = durationMs;
        } else if (state.lastPlay) {
          state.accumulatedMs += dtMs;
          if (state.accumulatedMs >= durationMs) {
            state.accumulatedMs = durationMs;
          }
        }
      }

      state.lastPlay = playActive;
      loadVideoTimelineState.set(context.nodeId, state);

      const ended = !loop && durationMs !== null && state.accumulatedMs >= durationMs;
      return { ref: refWithFit, ended };
    },
    onDisable: (_inputs, _config, context) => {
      // Reset manager-side timeline state so `Finish` doesn't stay latched across stop/start.
      loadVideoTimelineState.delete(context.nodeId);
    },
  };
}

function createLoadVideoFromLocalNode(): NodeDefinition {
  return {
    type: 'load-video-from-local',
    label: 'Load Video From Local(Display only)',
    category: 'Assets',
    inputs: [
      { id: 'asset', label: 'Asset', type: 'string', defaultValue: '' },
      { id: 'startSec', label: 'Start (s)', type: 'number', defaultValue: 0, min: 0, step: 0.01 },
      { id: 'endSec', label: 'End (s)', type: 'number', defaultValue: -1, min: -1, step: 0.01 },
      {
        id: 'cursorSec',
        label: 'Cursor (s)',
        type: 'number',
        defaultValue: -1,
        min: -1,
        step: 0.01,
      },
      { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { id: 'play', label: 'Play', type: 'boolean', defaultValue: true },
      { id: 'reverse', label: 'Reverse', type: 'boolean', defaultValue: false },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { id: 'muted', label: 'Mute', type: 'boolean', defaultValue: true },
    ],
    outputs: [
      { id: 'ref', label: 'Video Out', type: 'video', kind: 'sink' },
      { id: 'ended', label: 'Finish', type: 'boolean' },
    ],
    configSchema: [
      {
        key: 'assetPath',
        label: 'Video Asset',
        type: 'local-asset-picker',
        assetKind: 'video',
        defaultValue: '',
      },
      {
        key: 'timeline',
        label: 'Timeline',
        type: 'time-range',
        defaultValue: { startSec: 0, endSec: -1, cursorSec: -1 },
        min: 0,
        step: 0.01,
      },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        defaultValue: 'contain',
        options: [
          { value: 'contain', label: 'Contain' },
          { value: 'fit-screen', label: 'Fit Screen' },
          { value: 'cover', label: 'Cover' },
          { value: 'fill', label: 'Fill' },
        ],
      },
    ],
    process: (inputs, config, context) => {
      const assetUrl =
        typeof inputs.asset === 'string' && inputs.asset.trim()
          ? inputs.asset.trim()
          : typeof (config as any).assetPath === 'string'
            ? String((config as any).assetPath).trim()
            : '';
      const localRef = assetUrl ? normalizeLocalMediaRef(assetUrl, 'video') : '';
      const fitRaw = typeof config.fit === 'string' ? config.fit.trim().toLowerCase() : '';
      const fit =
        fitRaw === 'cover' || fitRaw === 'fill' || fitRaw === 'fit-screen' ? fitRaw : 'contain';
      const startSecRaw = inputs.startSec;
      const endSecRaw = inputs.endSec;
      const cursorSecRaw = inputs.cursorSec;
      const startSec =
        typeof startSecRaw === 'number' && Number.isFinite(startSecRaw) ? startSecRaw : 0;
      const endSec = typeof endSecRaw === 'number' && Number.isFinite(endSecRaw) ? endSecRaw : -1;
      const cursorSec =
        typeof cursorSecRaw === 'number' && Number.isFinite(cursorSecRaw) ? cursorSecRaw : -1;

      const loopRaw = inputs.loop;
      const loop = typeof loopRaw === 'number' ? loopRaw >= 0.5 : Boolean(loopRaw);
      const playRaw = inputs.play;
      const play = typeof playRaw === 'number' ? playRaw >= 0.5 : Boolean(playRaw);
      const reverseRaw = inputs.reverse;
      const reverse = typeof reverseRaw === 'number' ? reverseRaw >= 0.5 : Boolean(reverseRaw);
      const mutedRaw = inputs.muted;
      const muted = typeof mutedRaw === 'number' ? mutedRaw >= 0.5 : Boolean(mutedRaw);
      const volumeGain = Math.round(coerceAssetVolumeGain(inputs.volume) * 100) / 100;
      const mutedEffective = muted || volumeGain <= 0;

      const startClamped = Math.max(0, startSec);
      const endClamped = endSec >= 0 ? Math.max(startClamped, endSec) : -1;
      const tValue = endClamped >= 0 ? `${startClamped},${endClamped}` : `${startClamped},`;

      const cursorClamped = cursorSec >= 0 ? Math.max(startClamped, cursorSec) : -1;
      const cursorForPlayback =
        cursorClamped >= 0
          ? endClamped >= 0
            ? Math.min(endClamped, cursorClamped)
            : cursorClamped
          : null;
      const positionParam = cursorForPlayback !== null ? `&p=${cursorForPlayback}` : '';
      const nodeParam = context?.nodeId ? `&node=${encodeURIComponent(String(context.nodeId))}` : '';
      const fitParam = fit !== 'contain' ? `&fit=${fit}` : '';

      const baseUrl = (() => {
        if (!localRef) return '';
        const hashIndex = localRef.indexOf('#');
        return hashIndex >= 0 ? localRef.slice(0, hashIndex) : localRef;
      })();

      const refBase = baseUrl
        ? `${baseUrl}#t=${tValue}&loop=${loop ? 1 : 0}&play=${play ? 1 : 0}&rev=${reverse ? 1 : 0}&vol=${volumeGain}&muted=${mutedEffective ? 1 : 0}${positionParam}${nodeParam}`
        : '';

      const refWithFit = fitParam ? `${refBase}${fitParam}` : refBase;

      if (!baseUrl) {
        loadVideoTimelineState.delete(context.nodeId);
        return { ref: '', ended: false };
      }

      const qSec = (value: number): number => Math.round(value * 100) / 100;
      const signature = [
        baseUrl,
        qSec(startClamped),
        qSec(endClamped),
        qSec(cursorForPlayback ?? -1),
        loop ? 1 : 0,
        reverse ? 1 : 0,
      ].join('|');

      const prevState = loadVideoTimelineState.get(context.nodeId);
      const state: LoadVideoTimelineState = prevState ?? {
        signature: '',
        lastPlay: false,
        accumulatedMs: 0,
      };

      const settingsChanged = signature !== state.signature;
      if (settingsChanged) {
        state.signature = signature;
        state.accumulatedMs = 0;
      }

      const playActive = play;
      const playRising = playActive && !state.lastPlay;

      let durationSec: number | null = null;
      if (!loop) {
        if (reverse) {
          const startPos = cursorForPlayback ?? (endClamped >= 0 ? endClamped : startClamped);
          durationSec = Math.max(0, startPos - startClamped);
        } else if (endClamped >= 0) {
          const startPos = cursorForPlayback ?? startClamped;
          durationSec = Math.max(0, endClamped - startPos);
        }
      }

      const durationMs = durationSec !== null ? durationSec * 1000 : null;
      const atEdgeBefore = !loop && durationMs !== null && state.accumulatedMs >= durationMs;

      if (atEdgeBefore && playRising) {
        state.accumulatedMs = 0;
      }

      const dtMs =
        typeof context.deltaTime === 'number' && Number.isFinite(context.deltaTime)
          ? Math.max(0, context.deltaTime)
          : 0;

      if (!loop && durationMs !== null && playActive) {
        if (durationMs <= 0) {
          state.accumulatedMs = durationMs;
        } else if (state.lastPlay) {
          state.accumulatedMs += dtMs;
          if (state.accumulatedMs >= durationMs) {
            state.accumulatedMs = durationMs;
          }
        }
      }

      state.lastPlay = playActive;
      loadVideoTimelineState.set(context.nodeId, state);

      const ended = !loop && durationMs !== null && state.accumulatedMs >= durationMs;
      return { ref: refWithFit, ended };
    },
    onDisable: (_inputs, _config, context) => {
      // Reset manager-side timeline state so `Finish` doesn't stay latched across stop/start.
      loadVideoTimelineState.delete(context.nodeId);
    },
  };
}

function createAudioOutNode(): NodeDefinition {
  return {
    type: 'audio-out',
    label: 'Audio Patch to Client',
    category: 'Media',
    inputs: [{ id: 'in', label: 'In', type: 'audio', kind: 'sink' }],
    outputs: [
      // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
      // This output is not part of the exported client patch subgraph.
      { id: 'cmd', label: 'Deploy', type: 'command' },
    ],
    configSchema: [],
    process: () => ({}),
  };
}

function createImageOutNode(deps: ClientObjectDeps): NodeDefinition {
  const resolveUrl = (raw: unknown): string => {
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object' && typeof (item as any).url === 'string') {
          const url = String((item as any).url).trim();
          if (url) return url;
        }
      }
      return '';
    }
    if (raw && typeof raw === 'object' && typeof (raw as any).url === 'string') {
      return String((raw as any).url).trim();
    }
    return '';
  };

  const hide = () => {
    deps.executeCommand({ action: 'hideImage', payload: {} });
  };

  return {
    type: 'image-out',
    label: 'Image to Client',
    category: 'Media',
    inputs: [{ id: 'in', label: 'In', type: 'image', kind: 'sink' }],
    outputs: [
      // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
      // This output is not part of the exported client patch subgraph.
      { id: 'cmd', label: 'Deploy', type: 'command' },
    ],
    configSchema: [],
    process: () => ({}),
    onSink: (inputs) => {
      const url = resolveUrl(inputs.in);
      if (!url) {
        hide();
        return;
      }
      deps.executeCommand({ action: 'showImage', payload: { url } });
    },
    onDisable: () => {
      hide();
    },
  };
}

function createVideoOutNode(deps: ClientObjectDeps): NodeDefinition {
  const resolveUrl = (raw: unknown): string => {
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object' && typeof (item as any).url === 'string') {
          const url = String((item as any).url).trim();
          if (url) return url;
        }
      }
      return '';
    }
    if (raw && typeof raw === 'object' && typeof (raw as any).url === 'string') {
      return String((raw as any).url).trim();
    }
    return '';
  };

  const parseMutedFromUrl = (url: string): boolean | null => {
    const trimmed = url.trim();
    if (!trimmed) return null;

    const index = trimmed.indexOf('#');
    const paramsRaw = index >= 0 ? trimmed.slice(index + 1) : '';
    if (!paramsRaw) return null;

    const params = new URLSearchParams(paramsRaw);
    const value = params.get('muted');
    if (value === null) return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const n = Number(normalized);
    if (Number.isFinite(n)) return n >= 0.5;
    return null;
  };

  const parseVolumeFromUrl = (url: string): number | null => {
    const trimmed = url.trim();
    if (!trimmed) return null;

    const index = trimmed.indexOf('#');
    const paramsRaw = index >= 0 ? trimmed.slice(index + 1) : '';
    if (!paramsRaw) return null;

    const params = new URLSearchParams(paramsRaw);
    const value = params.get('vol') ?? params.get('volume');
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  };

  const stop = () => {
    deps.executeCommand({ action: 'stopMedia', payload: {} });
  };

  return {
    type: 'video-out',
    label: 'Video to Client',
    category: 'Media',
    inputs: [{ id: 'in', label: 'In', type: 'video', kind: 'sink' }],
    outputs: [
      // Manager-only routing: connect to `client-object(in)` to indicate patch target(s).
      // This output is not part of the exported client patch subgraph.
      { id: 'cmd', label: 'Deploy', type: 'command' },
    ],
    configSchema: [],
    process: () => ({}),
    onSink: (inputs) => {
      const url = resolveUrl(inputs.in);
      if (!url) {
        stop();
        return;
      }
      const muted = parseMutedFromUrl(url);
      const volume = parseVolumeFromUrl(url);
      deps.executeCommand({
        action: 'playMedia',
        payload: {
          url,
          mediaType: 'video',
          ...(volume === null ? {} : { volume }),
          ...(muted === null ? {} : { muted }),
        },
      });
    },
    onDisable: () => {
      stop();
    },
  };
}

function createClientObjectNode(deps: ClientObjectDeps): NodeDefinition {
  return {
    type: 'client-object',
    label: 'Client',
    category: 'Objects',
    inputs: [
      { id: 'index', label: 'Index', type: 'number', defaultValue: 1, min: 1, step: 1 },
      { id: 'range', label: 'Range', type: 'number', defaultValue: 1, min: 1, step: 1 },
      { id: 'random', label: 'Random', type: 'boolean', defaultValue: false },
      { id: 'in', label: 'In', type: 'command', kind: 'sink' },
    ],
    outputs: [
      { id: 'out', label: 'Out', type: 'client' },
      { id: 'indexOut', label: 'Index Out', type: 'number' },
      { id: 'imageOut', label: 'Image Out', type: 'image' },
    ],
    configSchema: [{ key: 'clientId', label: 'Clients', type: 'client-picker', defaultValue: '' }],
    process: (inputs, config, context) => {
      const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';

      const available = deps.getAllClientIds?.() ?? [];
      const selection = selectClientIdsForNode(context.nodeId, available, {
        index: inputs.index,
        range: inputs.range,
        random: inputs.random,
      });

      const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
      const primaryClientId =
        selection.selectedIds[0] ?? fallbackSelected[0] ?? deps.getClientId() ?? configured;

      const latest = primaryClientId
        ? (deps.getSensorForClientId?.(primaryClientId) ?? deps.getLatestSensor?.() ?? null)
        : (deps.getLatestSensor?.() ?? null);
      const sensors: ClientSensorMessage | null = latest
        ? {
            sensorType: latest.sensorType,
            payload: latest.payload,
            serverTimestamp: latest.serverTimestamp,
            clientTimestamp: latest.clientTimestamp,
          }
        : null;
      const out: ClientObject = { clientId: primaryClientId, sensors };

      const imageOut =
        typeof deps.getImageForClientId === 'function' && primaryClientId
          ? deps.getImageForClientId(primaryClientId)
          : null;
      return { out, indexOut: selection.index, imageOut };
    },
    onSink: (inputs, config, context) => {
      const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';

      const available = deps.getAllClientIds?.() ?? [];
      const selection = selectClientIdsForNode(context.nodeId, available, {
        index: (inputs as any).index,
        range: (inputs as any).range,
        random: (inputs as any).random,
      });

      const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
      const fallbackSingle = deps.getClientId() ?? configured;
      const targets =
        selection.selectedIds.length > 0
          ? selection.selectedIds
          : fallbackSelected.length > 0
            ? fallbackSelected
            : fallbackSingle
              ? [fallbackSingle]
              : [];
      if (targets.length === 0) return;

      const raw = inputs.in;
      const commands = (Array.isArray(raw) ? raw : [raw]) as unknown[];
      for (const cmd of commands) {
        if (!cmd || typeof cmd !== 'object') continue;
        const action = (cmd as any).action as ControlAction | undefined;
        if (!action) continue;
        const next: NodeCommand = {
          action,
          payload: ((cmd as any).payload ?? {}) as ControlPayload,
          executeAt: (cmd as any).executeAt as number | undefined,
        };

        for (const clientId of targets) {
          if (!clientId) continue;
          if (deps.executeCommandForClientId) deps.executeCommandForClientId(clientId, next);
          else deps.executeCommand(next);
        }
      }
    },
    onDisable: (inputs, config, context) => {
      const configured = typeof config.clientId === 'string' ? String(config.clientId) : '';

      const available = deps.getAllClientIds?.() ?? [];
      const selection = selectClientIdsForNode(context.nodeId, available, {
        index: (inputs as any).index,
        range: (inputs as any).range,
        random: (inputs as any).random,
      });

      const fallbackSelected = deps.getSelectedClientIds?.() ?? [];
      const fallbackSingle = deps.getClientId() ?? configured;
      const targets =
        selection.selectedIds.length > 0
          ? selection.selectedIds
          : fallbackSelected.length > 0
            ? fallbackSelected
            : fallbackSingle
              ? [fallbackSingle]
              : [];
      if (targets.length === 0) return;

      const send = (clientId: string, cmd: NodeCommand) => {
        if (!clientId) return;
        if (deps.executeCommandForClientId) deps.executeCommandForClientId(clientId, cmd);
        else deps.executeCommand(cmd);
      };

      const cleanupCommands: NodeCommand[] = [
        { action: 'stopSound', payload: {} },
        { action: 'stopMedia', payload: {} },
        { action: 'hideImage', payload: {} },
        { action: 'flashlight', payload: { mode: 'off' } },
        { action: 'screenColor', payload: { color: '#000000', opacity: 0, mode: 'solid' } },
      ];

      for (const clientId of targets) {
        for (const cmd of cleanupCommands) send(clientId, cmd);
      }
    },
  };
}

function createCmdAggregatorNode(): NodeDefinition {
  const maxInputs = 8;
  const inputs = Array.from({ length: maxInputs }, (_, idx) => {
    const n = idx + 1;
    return { id: `in${n}`, label: `In ${n}`, type: 'command' } as const;
  });

  const flattenCommands = (value: unknown, out: unknown[]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) flattenCommands(item, out);
      return;
    }
    out.push(value);
  };

  return {
    type: 'cmd-aggregator',
    label: 'Cmd Aggregator',
    category: 'Objects',
    inputs: [...inputs],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [],
    process: (nodeInputs) => {
      const cmds: unknown[] = [];
      for (const port of inputs) {
        flattenCommands(nodeInputs[port.id], cmds);
      }
      return { cmd: cmds.length > 0 ? cmds : null };
    },
  };
}

function createClientSensorsProcessorNode(): NodeDefinition {
  const toFiniteNumber = (value: unknown, fallback = 0): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    type: 'proc-client-sensors',
    label: 'Client Sensors',
    category: 'Processors',
    inputs: [{ id: 'client', label: 'Client', type: 'client' }],
    outputs: [
      { id: 'accelX', label: 'Accel X', type: 'number' },
      { id: 'accelY', label: 'Accel Y', type: 'number' },
      { id: 'accelZ', label: 'Accel Z', type: 'number' },
      { id: 'gyroA', label: 'Gyro α', type: 'number' },
      { id: 'gyroB', label: 'Gyro β', type: 'number' },
      { id: 'gyroG', label: 'Gyro γ', type: 'number' },
      { id: 'micVol', label: 'Mic Vol', type: 'number' },
      { id: 'micLow', label: 'Mic Low', type: 'number' },
      { id: 'micHigh', label: 'Mic High', type: 'number' },
      { id: 'micBpm', label: 'Mic BPM', type: 'number' },
    ],
    configSchema: [],
    process: (inputs) => {
      const client = inputs.client as any;
      const msg = client?.sensors as any;

      const out = {
        accelX: 0,
        accelY: 0,
        accelZ: 0,
        gyroA: 0,
        gyroB: 0,
        gyroG: 0,
        micVol: 0,
        micLow: 0,
        micHigh: 0,
        micBpm: 0,
      };

      if (!msg || typeof msg !== 'object') return out;

      const payload = msg.payload ?? {};
      switch (msg.sensorType) {
        case 'accel':
          out.accelX = toFiniteNumber(payload.x);
          out.accelY = toFiniteNumber(payload.y);
          out.accelZ = toFiniteNumber(payload.z);
          break;
        case 'gyro':
        case 'orientation':
          out.gyroA = toFiniteNumber(payload.alpha);
          out.gyroB = toFiniteNumber(payload.beta);
          out.gyroG = toFiniteNumber(payload.gamma);
          break;
        case 'mic':
          out.micVol = toFiniteNumber(payload.volume);
          out.micLow = toFiniteNumber(payload.lowEnergy);
          out.micHigh = toFiniteNumber(payload.highEnergy);
          out.micBpm = toFiniteNumber(payload.bpm);
          break;
      }

      return out;
    },
  };
}

function createMathNode(): NodeDefinition {
  return {
    type: 'math',
    label: 'Math',
    category: 'Logic',
    inputs: [
      { id: 'a', label: 'A', type: 'number', defaultValue: 0 },
      { id: 'b', label: 'B', type: 'number', defaultValue: 0 },
      { id: 'operation', label: 'Operation', type: 'string' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'number' }],
    configSchema: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'select',
        defaultValue: '+',
        options: [
          { value: '+', label: 'Add (+)' },
          { value: '-', label: 'Subtract (-)' },
          { value: '*', label: 'Multiply (×)' },
          { value: '/', label: 'Divide (÷)' },
          { value: 'min', label: 'Min' },
          { value: 'max', label: 'Max' },
          { value: 'mod', label: 'Modulo (%)' },
          { value: 'pow', label: 'Power (^)' },
        ],
      },
    ],
    process: (inputs, config) => {
      const a = (inputs.a as number) ?? 0;
      const b = (inputs.b as number) ?? 0;
      const op = (() => {
        const fromInput = inputs.operation;
        if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim();
        return String(config.operation ?? '+');
      })();

      let result: number;
      switch (op) {
        case '+':
          result = a + b;
          break;
        case '-':
          result = a - b;
          break;
        case '*':
          result = a * b;
          break;
        case '/':
          result = b !== 0 ? a / b : 0;
          break;
        case 'min':
          result = Math.min(a, b);
          break;
        case 'max':
          result = Math.max(a, b);
          break;
        case 'mod':
          result = b !== 0 ? a % b : 0;
          break;
        case 'pow':
          result = Math.pow(a, b);
          break;
        default:
          result = a + b;
      }

      return { result };
    },
  };
}

function createLogicAddNode(): NodeDefinition {
  return {
    type: 'logic-add',
    label: 'Add',
    category: 'Logic',
    inputs: [
      { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    outputs: [
      { id: 'number', label: 'Number', type: 'number' },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    configSchema: [],
    process: (inputs) => {
      const raw = inputs.number;
      const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
      return {
        // Add 1 to the number input on every pass, regardless of which port triggered upstream.
        number: (Number.isFinite(numberValue) ? numberValue : 0) + 1,
        any: inputs.any,
      };
    },
  };
}

function createLogicMultipleNode(): NodeDefinition {
  return {
    type: 'logic-multiple',
    label: 'Multiple',
    category: 'Logic',
    inputs: [
      { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    outputs: [
      { id: 'number', label: 'Number', type: 'number' },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    configSchema: [],
    process: (inputs) => {
      const raw = inputs.number;
      const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
      return {
        number: (Number.isFinite(numberValue) ? numberValue : 0) * 1,
        any: inputs.any,
      };
    },
  };
}

function createLogicSubtractNode(): NodeDefinition {
  return {
    type: 'logic-subtract',
    label: 'Subtract',
    category: 'Logic',
    inputs: [
      { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    outputs: [
      { id: 'number', label: 'Number', type: 'number' },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    configSchema: [],
    process: (inputs) => {
      const raw = inputs.number;
      const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
      return {
        number: (Number.isFinite(numberValue) ? numberValue : 0) - 1,
        any: inputs.any,
      };
    },
  };
}

function createLogicDivideNode(): NodeDefinition {
  return {
    type: 'logic-divide',
    label: 'Divide',
    category: 'Logic',
    inputs: [
      { id: 'number', label: 'Number', type: 'number', defaultValue: 0 },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    outputs: [
      { id: 'number', label: 'Number', type: 'number' },
      { id: 'any', label: 'Any', type: 'any' },
    ],
    configSchema: [],
    process: (inputs) => {
      const raw = inputs.number;
      const numberValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw ?? 0);
      return {
        number: (Number.isFinite(numberValue) ? numberValue : 0) / 1,
        any: inputs.any,
      };
    },
  };
}

// Gate: invert a boolean (NOT gate).
function createLogicNotNode(): NodeDefinition {
  return {
    type: 'logic-not',
    label: 'NOT',
    category: 'Gate',
    inputs: [{ id: 'in', label: 'In', type: 'boolean', defaultValue: false }],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: !coerceBoolean(inputs.in) }),
  };
}

function createLogicAndNode(): NodeDefinition {
  return {
    type: 'logic-and',
    label: 'AND',
    category: 'Gate',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean', defaultValue: false },
      { id: 'b', label: 'B', type: 'boolean', defaultValue: false },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: coerceBoolean(inputs.a) && coerceBoolean(inputs.b) }),
  };
}

function createLogicOrNode(): NodeDefinition {
  return {
    type: 'logic-or',
    label: 'OR',
    category: 'Gate',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean', defaultValue: false },
      { id: 'b', label: 'B', type: 'boolean', defaultValue: false },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: coerceBoolean(inputs.a) || coerceBoolean(inputs.b) }),
  };
}

function createLogicXorNode(): NodeDefinition {
  return {
    type: 'logic-xor',
    label: 'XOR',
    category: 'Gate',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean', defaultValue: false },
      { id: 'b', label: 'B', type: 'boolean', defaultValue: false },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: coerceBoolean(inputs.a) !== coerceBoolean(inputs.b) }),
  };
}

function createLogicNandNode(): NodeDefinition {
  return {
    type: 'logic-nand',
    label: 'NAND',
    category: 'Gate',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean', defaultValue: false },
      { id: 'b', label: 'B', type: 'boolean', defaultValue: false },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: !(coerceBoolean(inputs.a) && coerceBoolean(inputs.b)) }),
  };
}

function createLogicNorNode(): NodeDefinition {
  return {
    type: 'logic-nor',
    label: 'NOR',
    category: 'Gate',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean', defaultValue: false },
      { id: 'b', label: 'B', type: 'boolean', defaultValue: false },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'boolean' }],
    configSchema: [],
    process: (inputs) => ({ out: !(coerceBoolean(inputs.a) || coerceBoolean(inputs.b)) }),
  };
}

function createLogicIfNode(): NodeDefinition {
  return {
    type: 'logic-if',
    label: 'if',
    category: 'Logic',
    inputs: [
      { id: 'input', label: 'input', type: 'boolean', defaultValue: false },
      { id: 'condition', label: 'condition', type: 'boolean', defaultValue: false },
    ],
    outputs: [
      { id: 'false', label: 'false', type: 'boolean' },
      { id: 'true', label: 'true', type: 'boolean' },
    ],
    configSchema: [],
    process: (inputs) => {
      const value = coerceBoolean(inputs.input);
      const condition = coerceBoolean(inputs.condition);
      return {
        true: condition ? value : false,
        false: condition ? false : value,
      };
    },
  };
}

type LogicForState = {
  running: boolean;
  current: number;
  start: number;
  end: number;
  nextEmitAt: number;
  lastRunSignal: boolean;
};

const logicForState = new Map<string, LogicForState>();

function createLogicForNode(): NodeDefinition {
  return {
    type: 'logic-for',
    label: 'for',
    category: 'Logic',
    inputs: [
      { id: 'run', label: 'start', type: 'boolean', defaultValue: false },
      { id: 'start', label: 'from', type: 'number', defaultValue: 1, min: 1, step: 1 },
      { id: 'end', label: 'to', type: 'number', defaultValue: 1, min: 1, step: 1 },
      { id: 'wait', label: 'wait (ms)', type: 'number', defaultValue: 0, min: 0, step: 10 },
    ],
    outputs: [
      { id: 'index', label: 'index', type: 'number' },
      { id: 'running', label: 'running', type: 'boolean' },
      { id: 'loopEnd', label: 'loop end', type: 'boolean' },
    ],
    configSchema: [],
    process: (inputs, _config, context) => {
      const run = coerceBoolean(inputs.run);
      const startRaw = inputs.start;
      const endRaw = inputs.end;
      const waitRaw = inputs.wait;

      const startValue =
        typeof startRaw === 'number' && Number.isFinite(startRaw)
          ? startRaw
          : Number(startRaw ?? 1);
      const endValue =
        typeof endRaw === 'number' && Number.isFinite(endRaw) ? endRaw : Number(endRaw ?? 1);

      const start = Math.round(Number.isFinite(startValue) ? startValue : 1);
      const end = Math.round(Number.isFinite(endValue) ? endValue : 1);

      const clampedStart = Math.max(1, start);
      const clampedEnd = Math.max(clampedStart, end);

      const prev = logicForState.get(context.nodeId);
      const state: LogicForState = prev ?? {
        running: false,
        current: clampedStart,
        start: clampedStart,
        end: clampedEnd,
        nextEmitAt: context.time,
        lastRunSignal: false,
      };

      const waitParsed = typeof waitRaw === 'number' ? waitRaw : Number(waitRaw ?? 0);
      const waitMs = Number.isFinite(waitParsed) ? Math.max(0, waitParsed) : 0;

      // Allow editing range while idle; keep running range stable once started.
      if (!state.running && (state.start !== clampedStart || state.end !== clampedEnd)) {
        state.start = clampedStart;
        state.end = clampedEnd;
        state.current = clampedStart;
      }

      const rising = run && !state.lastRunSignal;
      state.lastRunSignal = run;

      if (rising && !state.running) {
        state.running = true;
        state.start = clampedStart;
        state.end = clampedEnd;
        state.current = clampedStart;
        state.nextEmitAt = context.time;
      }

      if (!state.running) {
        logicForState.set(context.nodeId, state);
        return { running: false, loopEnd: false };
      }

      if (context.time < state.nextEmitAt) {
        logicForState.set(context.nodeId, state);
        return { running: true, loopEnd: false };
      }

      const out = state.current;
      const done = out >= state.end;
      if (done) {
        state.running = false;
        state.current = state.start;
        logicForState.set(context.nodeId, state);
        return { index: out, running: false, loopEnd: true };
      }

      state.current = out + 1;
      state.nextEmitAt = context.time + waitMs;
      logicForState.set(context.nodeId, state);
      return { index: out, running: true, loopEnd: false };
    },
  };
}

type LogicSleepState = {
  queue: { time: number; value: unknown }[];
  lastOutput: unknown;
};

// Sleep node keeps a small time queue to delay signals by the configured milliseconds.
const logicSleepState = new Map<string, LogicSleepState>();

function createLogicSleepNode(): NodeDefinition {
  return {
    type: 'logic-sleep',
    label: 'Sleep',
    category: 'Logic',
    inputs: [
      { id: 'input', label: 'input', type: 'any' },
      { id: 'sleepTimeMs', label: 'sleep time (ms)', type: 'number', defaultValue: 0 },
    ],
    outputs: [{ id: 'output', label: 'output', type: 'any' }],
    configSchema: [],
    process: (inputs, _config, context) => {
      const rawDelay = inputs.sleepTimeMs;
      const parsed = typeof rawDelay === 'number' ? rawDelay : Number(rawDelay ?? 0);
      const delayMs = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

      const state = logicSleepState.get(context.nodeId) ?? {
        queue: [],
        lastOutput: undefined,
      };

      state.queue.push({ time: context.time, value: inputs.input });

      const targetTime = context.time - delayMs;
      while (state.queue.length > 0 && state.queue[0].time <= targetTime) {
        const item = state.queue.shift();
        if (item) state.lastOutput = item.value;
      }

      logicSleepState.set(context.nodeId, state);
      return { output: state.lastOutput };
    },
  };
}

function createShowAnythingNode(): NodeDefinition {
  return {
    type: 'show-anything',
    label: 'Show Anything',
    category: 'Other',
    inputs: [{ id: 'in', label: 'In', type: 'any' }],
    outputs: [{ id: 'value', label: 'Value', type: 'string' }],
    configSchema: [],
    process: (inputs) => ({ value: formatAnyPreview(inputs.in) }),
  };
}

function createNoteNode(): NodeDefinition {
  return {
    type: 'note',
    label: 'Note',
    category: 'Other',
    inputs: [],
    outputs: [],
    configSchema: [{ key: 'text', label: 'Text', type: 'string', defaultValue: '' }],
    process: () => ({}),
  };
}

const TONE_LFO_WAVEFORM_OPTIONS = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

function createToneLFONode(): NodeDefinition {
  return {
    type: 'tone-lfo',
    label: 'Tone LFO',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'number', defaultValue: 1 },
      {
        id: 'frequencyHz',
        label: 'Freq (Hz)',
        type: 'number',
        defaultValue: 1,
        min: 0,
        step: 0.01,
      },
      { id: 'min', label: 'Min', type: 'number', defaultValue: 0, step: 0.01 },
      { id: 'max', label: 'Max', type: 'number', defaultValue: 1, step: 0.01 },
      {
        id: 'amplitude',
        label: 'Depth',
        type: 'number',
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      { id: 'waveform', label: 'Waveform', type: 'string' },
      { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    configSchema: [
      {
        key: 'frequencyHz',
        label: 'Freq (Hz)',
        type: 'number',
        defaultValue: 1,
        min: 0,
        step: 0.01,
      },
      { key: 'min', label: 'Min', type: 'number', defaultValue: 0, step: 0.01 },
      { key: 'max', label: 'Max', type: 'number', defaultValue: 1, step: 0.01 },
      {
        key: 'amplitude',
        label: 'Depth',
        type: 'number',
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: 'waveform',
        label: 'Waveform',
        type: 'select',
        defaultValue: 'sine',
        options: TONE_LFO_WAVEFORM_OPTIONS as unknown as { value: string; label: string }[],
      },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs, config, context) => {
      const scaleRaw = inputs.in;
      const scale =
        typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) ? (scaleRaw as number) : 1;
      const frequencyHz =
        typeof inputs.frequencyHz === 'number'
          ? (inputs.frequencyHz as number)
          : Number(config.frequencyHz ?? 1);
      const min = typeof inputs.min === 'number' ? (inputs.min as number) : Number(config.min ?? 0);
      const max = typeof inputs.max === 'number' ? (inputs.max as number) : Number(config.max ?? 1);
      const amplitudeRaw =
        typeof inputs.amplitude === 'number'
          ? (inputs.amplitude as number)
          : Number(config.amplitude ?? 1);
      const amplitude = Number.isFinite(amplitudeRaw) ? Math.max(0, Math.min(1, amplitudeRaw)) : 1;

      const enabledRaw = inputs.enabled;
      const enabled =
        typeof enabledRaw === 'number'
          ? enabledRaw >= 0.5
          : typeof enabledRaw === 'boolean'
            ? enabledRaw
            : Boolean(config.enabled ?? true);

      const waveform = (() => {
        const v = inputs.waveform;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return String(config.waveform ?? 'sine');
      })();

      const scaledMin = min * scale;
      const scaledMax = max * scale;

      if (!enabled) return { value: scaledMin };

      const freq = Number.isFinite(frequencyHz) ? Math.max(0, frequencyHz) : 1;
      const phase = (context.time / 1000) * freq * 2 * Math.PI;

      let normalized: number;
      switch (waveform) {
        case 'sine':
          normalized = (Math.sin(phase) + 1) / 2;
          break;
        case 'square':
          normalized = Math.sin(phase) >= 0 ? 1 : 0;
          break;
        case 'triangle':
          normalized = Math.abs((((context.time / 1000) * freq * 2) % 2) - 1);
          break;
        case 'sawtooth':
          normalized = ((context.time / 1000) * freq) % 1;
          break;
        default:
          normalized = (Math.sin(phase) + 1) / 2;
      }

      const centered = 0.5 + (normalized - 0.5) * amplitude;
      const value = scaledMin + centered * (scaledMax - scaledMin);
      return { value };
    },
  };
}

// Value-box style nodes: editable constants that also pass through connected inputs.
function createNumberNode(): NodeDefinition {
  return {
    type: 'number',
    label: 'Number',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'number' }],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'number', defaultValue: 0 }],
    process: (inputs, config) => {
      const fromInput = inputs.value;
      if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return { value: fromInput };
      const fallback = Number(config.value ?? 0);
      return { value: Number.isFinite(fallback) ? fallback : 0 };
    },
  };
}

function createStringNode(): NodeDefinition {
  return {
    type: 'string',
    label: 'String',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'string' }],
    outputs: [{ id: 'value', label: 'Value', type: 'string' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'string', defaultValue: '' }],
    process: (inputs, config) => {
      const fromInput = inputs.value;
      if (typeof fromInput === 'string') return { value: fromInput };
      const fallback = config.value;
      return { value: typeof fallback === 'string' ? fallback : '' };
    },
  };
}

function createBoolNode(): NodeDefinition {
  return {
    type: 'bool',
    label: 'Bool',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
    outputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'boolean', defaultValue: false }],
    process: (inputs, config) => {
      if (inputs.value !== undefined) return { value: coerceBoolean(inputs.value) };
      return { value: coerceBoolean(config.value) };
    },
  };
}

type StabilizerState = {
  value: number;
  target: number;
  startValue: number;
  startTime: number;
  durationMs: number;
};

const stabilizerState = new Map<string, StabilizerState>();

function createNumberStabilizerNode(): NodeDefinition {
  return {
    type: 'number-stabilizer',
    label: 'Number Stabilizer',
    category: 'Logic',
    inputs: [
      { id: 'in', label: 'In', type: 'number', defaultValue: 0 },
      { id: 'smoothing', label: 'Smoothing', type: 'number' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'number' }],
    configSchema: [
      {
        key: 'smoothing',
        label: 'Smoothing',
        type: 'number',
        defaultValue: 0.2,
        min: 0,
        max: 2000,
        step: 10,
      },
    ],
    process: (inputs, config, context) => {
      const raw = inputs.in;
      const smoothingFromInput = inputs.smoothing;
      const smoothingRaw =
        typeof smoothingFromInput === 'number'
          ? smoothingFromInput
          : Number(config.smoothing ?? 0.2);
      const smoothingFinite = Number.isFinite(smoothingRaw) ? smoothingRaw : 0.2;
      // Backward-compat: if smoothing <= 1, treat it as normalized smoothing (0..1),
      // otherwise interpret it as an explicit duration in ms.
      const durationMs =
        smoothingFinite <= 1
          ? 50 + Math.max(0, Math.min(1, smoothingFinite)) * 950
          : Math.max(0, smoothingFinite);

      const inputValue = typeof raw === 'number' && Number.isFinite(raw) ? (raw as number) : 0;

      const prev = stabilizerState.get(context.nodeId);
      if (!prev) {
        const initial: StabilizerState = {
          value: inputValue,
          target: inputValue,
          startValue: inputValue,
          startTime: context.time,
          durationMs,
        };
        stabilizerState.set(context.nodeId, initial);
        return { out: initial.value };
      }

      if (inputValue !== prev.target || durationMs !== prev.durationMs) {
        prev.startValue = prev.value;
        prev.target = inputValue;
        prev.startTime = context.time;
        prev.durationMs = durationMs;
      }

      const elapsed = Math.max(0, context.time - prev.startTime);
      const t = prev.durationMs <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / prev.durationMs));
      prev.value = prev.startValue + (prev.target - prev.startValue) * t;
      stabilizerState.set(context.nodeId, prev);
      return { out: prev.value };
    },
  };
}

function createToneOscNode(): NodeDefinition {
  return {
    type: 'tone-osc',
    label: 'Tone Osc',
    category: 'Audio',
    inputs: [
      { id: 'frequency', label: 'Freq', type: 'number', defaultValue: 440 },
      { id: 'amplitude', label: 'Amp', type: 'number', defaultValue: 1 },
      { id: 'waveform', label: 'Waveform', type: 'string' },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
      { id: 'loop', label: 'Loop (pattern)', type: 'string' },
    ],
    outputs: [{ id: 'value', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      {
        key: 'waveform',
        label: 'Waveform',
        type: 'select',
        defaultValue: 'sine',
        options: [
          { value: 'sine', label: 'Sine' },
          { value: 'square', label: 'Square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'sawtooth', label: 'Sawtooth' },
        ],
      },
      {
        key: 'bus',
        label: 'Bus',
        type: 'string',
        defaultValue: 'main',
      },
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        defaultValue: false,
      },
      {
        key: 'loop',
        label: 'Loop (pattern)',
        type: 'string',
        defaultValue: '',
      },
    ],
    process: (inputs, config) => {
      const ampInput = Number(inputs.amplitude ?? 0);
      const enabledRaw = inputs.enabled;
      const enabled =
        typeof enabledRaw === 'number'
          ? enabledRaw >= 0.5
          : (enabledRaw ?? config.enabled ?? false);
      const value = enabled ? ampInput : 0;
      return { value };
    },
  };
}

function createToneDelayNode(): NodeDefinition {
  return {
    type: 'tone-delay',
    label: 'Tone Delay',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
      { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
      { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'order', label: 'Order', type: 'number' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
      { key: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
      { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 10 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs) => ({ out: (inputs.in as number) ?? 0 }),
  };
}

function createToneResonatorNode(): NodeDefinition {
  return {
    type: 'tone-resonator',
    label: 'Tone Resonator',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
      { id: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0.08 },
      { id: 'resonance', label: 'Resonance', type: 'number', defaultValue: 0.6 },
      { id: 'dampening', label: 'Dampening', type: 'number', defaultValue: 3000 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.4 },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'order', label: 'Order', type: 'number' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0.08 },
      { key: 'resonance', label: 'Resonance', type: 'number', defaultValue: 0.6 },
      { key: 'dampening', label: 'Dampening (Hz)', type: 'number', defaultValue: 3000 },
      { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.4 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 20 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs) => ({ out: (inputs.in as number) ?? 0 }),
  };
}

function createTonePitchNode(): NodeDefinition {
  return {
    type: 'tone-pitch',
    label: 'Tone Pitch',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
      { id: 'pitch', label: 'Pitch (st)', type: 'number', defaultValue: 0 },
      { id: 'windowSize', label: 'Window', type: 'number', defaultValue: 0.1 },
      { id: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0 },
      { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'order', label: 'Order', type: 'number' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'pitch', label: 'Pitch (st)', type: 'number', defaultValue: 0 },
      { key: 'windowSize', label: 'Window', type: 'number', defaultValue: 0.1 },
      { key: 'delayTime', label: 'Delay (s)', type: 'number', defaultValue: 0 },
      { key: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0 },
      { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 30 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs) => ({ out: (inputs.in as number) ?? 0 }),
  };
}

function createToneReverbNode(): NodeDefinition {
  return {
    type: 'tone-reverb',
    label: 'Tone Reverb',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
      { id: 'decay', label: 'Decay (s)', type: 'number', defaultValue: 1.6 },
      { id: 'preDelay', label: 'PreDelay (s)', type: 'number', defaultValue: 0.01 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'order', label: 'Order', type: 'number' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'decay', label: 'Decay (s)', type: 'number', defaultValue: 1.6 },
      { key: 'preDelay', label: 'PreDelay (s)', type: 'number', defaultValue: 0.01 },
      { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 40 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs) => ({ out: (inputs.in as number) ?? 0 }),
  };
}

function createToneGranularNode(): NodeDefinition {
  return {
    type: 'tone-granular',
    label: 'Tone Granular',
    category: 'Audio',
    inputs: [
      { id: 'url', label: 'URL', type: 'string' },
      { id: 'gate', label: 'Gate', type: 'number', defaultValue: 0 },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
      { id: 'loop', label: 'Loop', type: 'boolean' },
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { id: 'grainSize', label: 'Grain (s)', type: 'number', defaultValue: 0.2 },
      { id: 'overlap', label: 'Overlap (s)', type: 'number', defaultValue: 0.1 },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0.6 },
      { id: 'bus', label: 'Bus', type: 'string' },
    ],
    outputs: [{ id: 'value', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'url', label: 'Audio URL', type: 'string', defaultValue: '' },
      { key: 'loop', label: 'Loop', type: 'boolean', defaultValue: true },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { key: 'grainSize', label: 'Grain (s)', type: 'number', defaultValue: 0.2 },
      { key: 'overlap', label: 'Overlap (s)', type: 'number', defaultValue: 0.1 },
      { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0.6 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
    ],
    process: (inputs, config) => {
      const volume =
        typeof inputs.volume === 'number'
          ? (inputs.volume as number)
          : Number(config.volume ?? 0.6);
      return { value: volume };
    },
  };
}

const playMediaTriggerState = new Map<string, boolean>();
const playMediaCommandCache = new Map<string, { signature: string; cmd: NodeCommand | null }>();

function createPlayMediaNode(): NodeDefinition {
  const resolveUrl = (
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    key: string
  ): string => {
    const fromInput = inputs[key];
    if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim();
    const fromConfig = config[key];
    if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
    return '';
  };

  return {
    type: 'play-media',
    label: 'Play Media',
    category: 'Audio',
    inputs: [
      { id: 'audioUrl', label: 'Audio', type: 'string' },
      { id: 'imageUrl', label: 'Image', type: 'string' },
      { id: 'videoUrl', label: 'Video', type: 'string' },
      { id: 'trigger', label: 'Trigger', type: 'number' },
      {
        id: 'volume',
        label: 'Volume',
        type: 'number',
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      { id: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { id: 'fadeIn', label: 'Fade In (ms)', type: 'number', defaultValue: 0, min: 0, step: 10 },
      { id: 'muted', label: 'Video Muted', type: 'boolean', defaultValue: true },
      {
        id: 'imageDuration',
        label: 'Image Duration (ms)',
        type: 'number',
        defaultValue: 0,
        min: 0,
        step: 100,
      },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'audioUrl', label: 'Audio URL', type: 'string', defaultValue: '' },
      { key: 'imageUrl', label: 'Image URL', type: 'string', defaultValue: '' },
      { key: 'videoUrl', label: 'Video URL', type: 'string', defaultValue: '' },
      {
        key: 'volume',
        label: 'Volume',
        type: 'number',
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      { key: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { key: 'fadeIn', label: 'Fade In (ms)', type: 'number', defaultValue: 0, min: 0, step: 10 },
      { key: 'muted', label: 'Video Muted', type: 'boolean', defaultValue: true },
      {
        key: 'imageDuration',
        label: 'Image Duration (ms)',
        type: 'number',
        defaultValue: 0,
        min: 0,
        step: 100,
      },
    ],
    process: (inputs, config, context) => {
      const triggerRaw = inputs.trigger;
      const hasTrigger = triggerRaw !== undefined && triggerRaw !== null;
      const triggerActive =
        typeof triggerRaw === 'number' ? triggerRaw >= 0.5 : Boolean(triggerRaw);

      if (hasTrigger) {
        const prev = playMediaTriggerState.get(context.nodeId) ?? false;
        playMediaTriggerState.set(context.nodeId, triggerActive);
        if (!triggerActive || prev) return {};
      }
      const forceSend = hasTrigger;

      const imageUrl = resolveUrl(inputs, config, 'imageUrl');
      const videoUrl = resolveUrl(inputs, config, 'videoUrl');
      const audioUrl = resolveUrl(inputs, config, 'audioUrl');

      const volumeRaw =
        typeof inputs.volume === 'number' ? inputs.volume : Number(config.volume ?? 1);
      const volume = Number.isFinite(volumeRaw) ? Math.max(0, Math.min(1, volumeRaw)) : 1;
      const loop = typeof inputs.loop === 'boolean' ? inputs.loop : Boolean(config.loop ?? false);
      const fadeInRaw =
        typeof inputs.fadeIn === 'number' ? inputs.fadeIn : Number(config.fadeIn ?? 0);
      const fadeIn = Number.isFinite(fadeInRaw) ? Math.max(0, fadeInRaw) : 0;
      const muted =
        typeof inputs.muted === 'boolean' ? inputs.muted : Boolean(config.muted ?? true);
      const imageDurationRaw =
        typeof inputs.imageDuration === 'number'
          ? inputs.imageDuration
          : Number(config.imageDuration ?? 0);
      const imageDuration =
        Number.isFinite(imageDurationRaw) && imageDurationRaw > 0 ? imageDurationRaw : undefined;

      let cmd: NodeCommand | null = null;

      if (imageUrl) {
        cmd = {
          action: 'showImage',
          payload: {
            url: imageUrl,
            duration: imageDuration,
          },
        };
      } else if (videoUrl) {
        cmd = {
          action: 'playMedia',
          payload: {
            url: videoUrl,
            mediaType: 'video',
            volume,
            loop,
            fadeIn,
            muted,
          },
        };
      } else if (audioUrl) {
        cmd = {
          action: 'playMedia',
          payload: {
            url: audioUrl,
            mediaType: 'audio',
            volume,
            loop,
            fadeIn,
          },
        };
      }

      if (!cmd) {
        playMediaCommandCache.set(context.nodeId, { signature: '', cmd: null });
        return { cmd: null };
      }

      const signature = (() => {
        try {
          return JSON.stringify(cmd);
        } catch {
          return String(cmd.action ?? '');
        }
      })();

      if (forceSend) {
        playMediaCommandCache.set(context.nodeId, { signature, cmd });
        return { cmd };
      }

      const cached = playMediaCommandCache.get(context.nodeId);
      if (!cached || cached.signature !== signature) {
        playMediaCommandCache.set(context.nodeId, { signature, cmd });
        return { cmd };
      }

      // Reuse the cached command object to avoid deepEqual JSON stringify on large payloads.
      return { cmd: cached.cmd };
    },
  };
}

const FLASHLIGHT_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
  { value: 'blink', label: 'Blink' },
] as const satisfies { value: string; label: string }[];

const pushImageUploadTriggerState = new Map<string, boolean>();

function createPushImageUploadNode(): NodeDefinition {
  const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  return {
    type: 'proc-push-image-upload',
    label: 'Push Image Upload',
    category: 'Processors',
    inputs: [{ id: 'trigger', label: 'Trigger', type: 'number', defaultValue: 0, min: 0, max: 1, step: 1 }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        defaultValue: 'image/jpeg',
        options: [
          { value: 'image/jpeg', label: 'JPEG' },
          { value: 'image/png', label: 'PNG' },
          { value: 'image/webp', label: 'WebP' },
        ],
      },
      { key: 'quality', label: 'Quality', type: 'number', defaultValue: 0.85, min: 0.1, max: 1, step: 0.01 },
      { key: 'maxWidth', label: 'Max Width', type: 'number', defaultValue: 960, min: 128, step: 1 },
    ],
    process: (inputs, config, context) => {
      const triggerRaw = inputs.trigger;
      const triggerActive = typeof triggerRaw === 'number' ? triggerRaw >= 0.5 : Boolean(triggerRaw);

      const prev = pushImageUploadTriggerState.get(context.nodeId) ?? false;
      pushImageUploadTriggerState.set(context.nodeId, triggerActive);
      if (!triggerActive || prev) return {};

      const formatRaw = typeof config.format === 'string' ? config.format.trim().toLowerCase() : '';
      const format =
        formatRaw === 'image/png' || formatRaw === 'image/webp' || formatRaw === 'image/jpeg'
          ? formatRaw
          : 'image/jpeg';

      const qualityRaw = Number(config.quality ?? 0.85);
      const quality = Number.isFinite(qualityRaw) ? clampNumber(qualityRaw, 0.1, 1) : 0.85;

      const maxWidthRaw = Number(config.maxWidth ?? 960);
      const maxWidth = Number.isFinite(maxWidthRaw) ? Math.max(128, Math.floor(maxWidthRaw)) : 960;

      const cmd: NodeCommand = {
        action: 'custom',
        payload: {
          kind: 'push-image-upload',
          format,
          quality,
          maxWidth,
        } as any,
      };

      return { cmd };
    },
  };
}

const showImageCommandCache = new Map<string, { signature: string; cmd: NodeCommand }>();

function createShowImageProcessorNode(): NodeDefinition {
  const resolveUrl = (raw: unknown): string => {
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object' && typeof (item as any).url === 'string') {
          const url = String((item as any).url).trim();
          if (url) return url;
        }
      }
      return '';
    }
    if (raw && typeof raw === 'object' && typeof (raw as any).url === 'string') {
      return String((raw as any).url).trim();
    }
    return '';
  };

  const toFiniteNumber = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    type: 'proc-show-image',
    label: 'Show Image',
    category: 'Processors',
    inputs: [{ id: 'in', label: 'In', type: 'image' }],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'durationMs', label: 'Duration (ms)', type: 'number', defaultValue: 0, min: 0, step: 1 },
    ],
    process: (inputs, config, context) => {
      const url = resolveUrl(inputs.in);
      const durationRaw = toFiniteNumber(config.durationMs, 0);
      const durationMs = Math.max(0, Math.floor(durationRaw));
      const signature = `${url}|${durationMs}`;

      const cached = showImageCommandCache.get(context.nodeId);
      if (cached && cached.signature === signature) return { cmd: cached.cmd };

      const cmd: NodeCommand = url
        ? {
            action: 'showImage',
            payload: { url, ...(durationMs > 0 ? { duration: durationMs } : {}) } as any,
          }
        : { action: 'hideImage', payload: {} };

      showImageCommandCache.set(context.nodeId, { signature, cmd });
      return { cmd };
    },
    onDisable: (_inputs, _config, context) => {
      showImageCommandCache.delete(context.nodeId);
    },
  };
}

function createFlashlightProcessorNode(): NodeDefinition {
  return {
    type: 'proc-flashlight',
    label: 'Flashlight',
    category: 'Processors',
    inputs: [
      { id: 'active', label: 'Active', type: 'boolean' },
      { id: 'mode', label: 'Mode', type: 'string' },
      { id: 'frequencyHz', label: 'Freq', type: 'number' },
      { id: 'dutyCycle', label: 'Duty', type: 'number' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      // `Active=false` sends a one-shot "off" command so effects can be disabled without stopping the graph.
      { key: 'active', label: 'Active', type: 'boolean', defaultValue: true },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        defaultValue: 'blink',
        options: FLASHLIGHT_MODE_OPTIONS as unknown as { value: string; label: string }[],
      },
      { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 2 },
      { key: 'dutyCycle', label: 'Duty Cycle', type: 'number', defaultValue: 0.5 },
    ],
    process: (inputs, config) => {
      const active = coerceBooleanOr(inputs.active ?? config.active, true);
      if (!active) {
        return { cmd: { action: 'flashlight', payload: { mode: 'off' } } };
      }

      const fallbackMode = String(config.mode ?? 'blink');
      const mode = (() => {
        const v = inputs.mode;
        if (typeof v === 'string' && v) {
          const options = FLASHLIGHT_MODE_OPTIONS.map((o) => o.value);
          return (options as string[]).includes(v) ? v : fallbackMode;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackMode;
        const options = FLASHLIGHT_MODE_OPTIONS.map((o) => o.value);
        const clamped = Math.max(0, Math.min(1, v));
        const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
        return options[idx] ?? fallbackMode;
      })();

      if (mode === 'blink') {
        const freq =
          typeof inputs.frequencyHz === 'number'
            ? (inputs.frequencyHz as number)
            : Number(config.frequencyHz ?? 2);
        const duty =
          typeof inputs.dutyCycle === 'number'
            ? (inputs.dutyCycle as number)
            : Number(config.dutyCycle ?? 0.5);
        return {
          cmd: {
            action: 'flashlight',
            payload: { mode: 'blink', frequency: freq, dutyCycle: duty },
          },
        };
      }

      return { cmd: { action: 'flashlight', payload: { mode } } };
    },
  };
}

const SCREEN_WAVEFORM_OPTIONS = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

function createScreenColorProcessorNode(): NodeDefinition {
  return {
    type: 'proc-screen-color',
    label: 'Screen Color',
    category: 'Processors',
    inputs: [
      { id: 'active', label: 'Active', type: 'boolean' },
      { id: 'primary', label: 'Primary', type: 'color' },
      { id: 'secondary', label: 'Secondary', type: 'color' },
      { id: 'waveform', label: 'Wave', type: 'string' },
      { id: 'frequencyHz', label: 'Freq', type: 'number' },
      { id: 'maxOpacity', label: 'Max', type: 'number' },
      { id: 'minOpacity', label: 'Min', type: 'number' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      // `Active=false` sends a "solid transparent" payload to stop the animation loop and clear the overlay.
      { key: 'active', label: 'Active', type: 'boolean', defaultValue: true },
      { key: 'primary', label: 'Primary', type: 'string', defaultValue: '#6366f1' },
      { key: 'secondary', label: 'Secondary', type: 'string', defaultValue: '#ffffff' },
      { key: 'maxOpacity', label: 'Max Opacity', type: 'number', defaultValue: 1 },
      { key: 'minOpacity', label: 'Min Opacity', type: 'number', defaultValue: 0 },
      {
        key: 'waveform',
        label: 'Waveform',
        type: 'select',
        defaultValue: 'sine',
        options: SCREEN_WAVEFORM_OPTIONS as unknown as { value: string; label: string }[],
      },
      { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 1.5 },
    ],
    process: (inputs, config) => {
      const active = coerceBooleanOr(inputs.active ?? config.active, true);
      if (!active) {
        return {
          cmd: {
            action: 'screenColor',
            payload: { color: 'transparent', opacity: 0, mode: 'solid' },
          },
        };
      }

      const primary =
        typeof inputs.primary === 'string' && inputs.primary
          ? String(inputs.primary)
          : String(config.primary ?? '#6366f1');
      const secondary =
        typeof inputs.secondary === 'string' && inputs.secondary
          ? String(inputs.secondary)
          : String(config.secondary ?? '#ffffff');
      const maxOpacity =
        typeof inputs.maxOpacity === 'number'
          ? (inputs.maxOpacity as number)
          : Number(config.maxOpacity ?? 1);
      const minOpacity =
        typeof inputs.minOpacity === 'number'
          ? (inputs.minOpacity as number)
          : Number(config.minOpacity ?? 0);
      const fallbackWaveform = String(config.waveform ?? 'sine');
      const waveform = (() => {
        const v = inputs.waveform;
        if (typeof v === 'string' && v) {
          const options = SCREEN_WAVEFORM_OPTIONS.map((o) => o.value);
          return (options as string[]).includes(v) ? v : fallbackWaveform;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackWaveform;
        const options = SCREEN_WAVEFORM_OPTIONS.map((o) => o.value);
        const clamped = Math.max(0, Math.min(1, v));
        const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
        return options[idx] ?? fallbackWaveform;
      })();
      const frequencyHz =
        typeof inputs.frequencyHz === 'number'
          ? (inputs.frequencyHz as number)
          : Number(config.frequencyHz ?? 1.5);

      return {
        cmd: {
          action: 'screenColor',
          payload: {
            mode: 'modulate',
            color: primary,
            secondaryColor: secondary,
            opacity: maxOpacity,
            minOpacity,
            maxOpacity,
            frequencyHz,
            waveform,
          },
        },
      };
    },
  };
}

const SYNTH_WAVEFORM_OPTIONS = [
  { value: 'square', label: 'Square' },
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
] as const satisfies { value: string; label: string }[];

function createSynthUpdateProcessorNode(): NodeDefinition {
  return {
    type: 'proc-synth-update',
    label: 'Synth (Update)',
    category: 'Processors',
    inputs: [
      { id: 'active', label: 'Active', type: 'boolean' },
      { id: 'waveform', label: 'Wave', type: 'string' },
      { id: 'frequency', label: 'Freq', type: 'number' },
      { id: 'volume', label: 'Vol', type: 'number' },
      { id: 'modDepth', label: 'Depth', type: 'number' },
      { id: 'modFrequency', label: 'Rate', type: 'number' },
      { id: 'durationMs', label: 'Dur', type: 'number' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      // `Active=false` sends an update with `durationMs=0` so the client can stop the synth immediately.
      { key: 'active', label: 'Active', type: 'boolean', defaultValue: true },
      { key: 'frequency', label: 'Freq (Hz)', type: 'number', defaultValue: 180 },
      { key: 'volume', label: 'Volume', type: 'number', defaultValue: 0.7 },
      {
        key: 'waveform',
        label: 'Waveform',
        type: 'select',
        defaultValue: 'square',
        options: SYNTH_WAVEFORM_OPTIONS as unknown as { value: string; label: string }[],
      },
      { key: 'modDepth', label: 'Wobble Depth', type: 'number', defaultValue: 0 },
      { key: 'modFrequency', label: 'Wobble Rate (Hz)', type: 'number', defaultValue: 12 },
      { key: 'durationMs', label: 'Dur (ms)', type: 'number', defaultValue: 200 },
    ],
    process: (inputs, config) => {
      const active = coerceBooleanOr(inputs.active ?? config.active, true);
      if (!active) {
        return {
          cmd: {
            action: 'modulateSoundUpdate',
            payload: { durationMs: 0 },
          },
        };
      }

      const frequency =
        typeof inputs.frequency === 'number'
          ? (inputs.frequency as number)
          : Number(config.frequency ?? 180);
      const volume =
        typeof inputs.volume === 'number'
          ? (inputs.volume as number)
          : Number(config.volume ?? 0.7);
      const depthRaw =
        typeof inputs.modDepth === 'number'
          ? (inputs.modDepth as number)
          : Number(config.modDepth ?? 0);
      const depth = Math.max(0, Math.min(1, depthRaw));
      const modFrequency =
        typeof inputs.modFrequency === 'number'
          ? (inputs.modFrequency as number)
          : Number(config.modFrequency ?? 12);
      const durationMs =
        typeof inputs.durationMs === 'number'
          ? (inputs.durationMs as number)
          : Number(config.durationMs ?? 200);

      const fallbackWaveform = String(config.waveform ?? 'square');
      const waveform = (() => {
        const v = inputs.waveform;
        if (typeof v === 'string' && v) {
          const options = SYNTH_WAVEFORM_OPTIONS.map((o) => o.value);
          return (options as string[]).includes(v) ? v : fallbackWaveform;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) return fallbackWaveform;
        const options = SYNTH_WAVEFORM_OPTIONS.map((o) => o.value);
        const clamped = Math.max(0, Math.min(1, v));
        const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
        return options[idx] ?? fallbackWaveform;
      })();

      return {
        cmd: {
          action: 'modulateSoundUpdate',
          payload: {
            frequency,
            volume: Math.max(0, Math.min(1, volume)),
            waveform,
            modDepth: depth > 0 ? depth : undefined,
            modFrequency: depth > 0 ? modFrequency : undefined,
            durationMs,
          },
        },
      };
    },
  };
}

function createSceneSwitchProcessorNode(): NodeDefinition {
  return {
    type: 'proc-scene-switch',
    label: 'Visual Scene',
    category: 'Processors',
    inputs: [
      { id: 'index', label: 'Index', type: 'number' },
      { id: 'sceneId', label: 'Scene', type: 'string' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      {
        key: 'sceneId',
        label: 'Scene',
        type: 'select',
        defaultValue: 'box-scene',
        options: [
          { value: 'box-scene', label: '3D Box' },
          { value: 'mel-scene', label: 'Mel Spectrogram' },
        ],
      },
    ],
    process: (inputs, config) => {
      const sceneId = (() => {
        const fromInput = inputs.sceneId;
        if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim();
        const fromIndex = inputs.index;
        if (typeof fromIndex === 'number' && Number.isFinite(fromIndex)) {
          return fromIndex >= 0.5 ? 'mel-scene' : 'box-scene';
        }
        return String(config.sceneId ?? 'box-scene');
      })();

      return {
        cmd: { action: 'visualSceneSwitch', payload: { sceneId } },
      };
    },
  };
}

function createAsciiEffectProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-effect-ascii',
    label: 'Visual Effect-ASCII',
    category: 'Processors',
    inputs: [
      { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
      { id: 'resolution', label: 'Resolution', type: 'number', defaultValue: 11, min: 6, max: 24, step: 1 },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
      { key: 'resolution', label: 'Resolution', type: 'number', defaultValue: 11, min: 6, max: 24, step: 1 },
    ],
    process: (inputs, config) => {
      const enabled = (() => {
        const fromInput = inputs.enabled;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).enabled;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return true;
      })();

      const resolution = (() => {
        const fromInput = inputs.resolution;
        const fromConfig = (config as any).resolution;
        const raw = typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 11);
        const clamped = Number.isFinite(raw) ? Math.max(6, Math.min(24, raw)) : 11;
        return Math.round(clamped);
      })();

      return {
        cmd: [
          { action: 'asciiMode', payload: { enabled } },
          { action: 'asciiResolution', payload: { cellSize: resolution } },
        ],
      };
    },
  };
}

function createConvolutionEffectProcessorNode(): NodeDefinition {
  return {
    type: 'proc-visual-effect-conv',
    label: 'Visual Effect-Conv',
    category: 'Processors',
    inputs: [
      { id: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      { id: 'preset', label: 'Preset', type: 'string' },
      { id: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      { id: 'scale', label: 'Scale', type: 'number', defaultValue: 0.5, min: 0.1, max: 1, step: 0.05 },
      { id: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { id: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { id: 'kernel', label: 'Kernel (3x3)', type: 'string' },
    ],
    outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
    configSchema: [
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      {
        key: 'preset',
        label: 'Preset',
        type: 'select',
        defaultValue: 'sharpen',
        options: [
          { value: 'blur', label: 'Blur' },
          { value: 'gaussianBlur', label: 'Gaussian Blur' },
          { value: 'sharpen', label: 'Sharpen' },
          { value: 'edge', label: 'Edge Detect' },
          { value: 'emboss', label: 'Emboss' },
          { value: 'sobelX', label: 'Sobel X' },
          { value: 'sobelY', label: 'Sobel Y' },
          { value: 'custom', label: 'Custom Kernel' },
        ],
      },
      { key: 'mix', label: 'Mix', type: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01 },
      { key: 'scale', label: 'Scale', type: 'number', defaultValue: 0.5, min: 0.1, max: 1, step: 0.05 },
      { key: 'bias', label: 'Bias', type: 'number', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { key: 'normalize', label: 'Normalize', type: 'boolean', defaultValue: true },
      { key: 'kernel', label: 'Kernel (3x3)', type: 'string', defaultValue: '' },
    ],
    process: (inputs, config) => {
      const enabled = (() => {
        const fromInput = inputs.enabled;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).enabled;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return false;
      })();

      const preset = (() => {
        const allowed = [
          'blur',
          'gaussianBlur',
          'sharpen',
          'edge',
          'emboss',
          'sobelX',
          'sobelY',
          'custom',
        ] as const;

        const fromInput = inputs.preset;
        const fromConfig = (config as any).preset;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : 'sharpen';

        return (allowed as readonly string[]).includes(raw) ? raw : 'sharpen';
      })();

      const mix = (() => {
        const fromInput = inputs.mix;
        const fromConfig = (config as any).mix;
        const raw = typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 1);
        if (!Number.isFinite(raw)) return 1;
        return Math.max(0, Math.min(1, raw));
      })();

      const scale = (() => {
        const fromInput = inputs.scale;
        const fromConfig = (config as any).scale;
        const raw = typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0.5);
        if (!Number.isFinite(raw)) return 0.5;
        return Math.max(0.1, Math.min(1, raw));
      })();

      const bias = (() => {
        const fromInput = inputs.bias;
        const fromConfig = (config as any).bias;
        const raw = typeof fromInput === 'number' ? fromInput : Number(fromInput ?? fromConfig ?? 0);
        if (!Number.isFinite(raw)) return 0;
        return Math.max(-1, Math.min(1, raw));
      })();

      const normalize = (() => {
        const fromInput = inputs.normalize;
        if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return fromInput >= 0.5;
        if (typeof fromInput === 'boolean') return fromInput;
        const fromConfig = (config as any).normalize;
        if (typeof fromConfig === 'number' && Number.isFinite(fromConfig)) return fromConfig >= 0.5;
        if (typeof fromConfig === 'boolean') return fromConfig;
        return true;
      })();

      const kernel = (() => {
        if (preset !== 'custom') return undefined;
        const fromInput = inputs.kernel;
        const fromConfig = (config as any).kernel;
        const raw =
          typeof fromInput === 'string' && fromInput.trim()
            ? fromInput.trim()
            : typeof fromConfig === 'string' && fromConfig.trim()
              ? fromConfig.trim()
              : '';
        if (!raw) return undefined;

        const parts = raw
          .split(/[\s,]+/g)
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 9);
        if (parts.length !== 9) return undefined;
        const parsed = parts.map((p) => Number(p));
        if (parsed.some((n) => !Number.isFinite(n))) return undefined;
        return parsed;
      })();

      return {
        cmd: {
          action: 'convolution',
          payload: {
            enabled,
            preset,
            ...(kernel ? { kernel } : {}),
            mix,
            scale,
            bias,
            normalize,
          },
        },
      };
    },
  };
}
