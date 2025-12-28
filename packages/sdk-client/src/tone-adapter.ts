/**
 * Purpose: Tone.js-backed audio runtime for node graph (oscillator + effects + granular).
 */
import type { Connection, NodeInstance, NodeRegistry, ProcessContext } from '@shugu/node-core';
import type { ClientSDK } from './client-sdk.js';
import { consumeNodeMediaFinishPulse, toneAudioEngine } from '@shugu/multimedia-core';

type ToneModule = typeof import('tone');

type LoopEvent = {
  time: number;
  frequency?: number;
  amplitude?: number;
};

type ParsedLoop = {
  events: LoopEvent[];
  loopLengthSeconds: number;
  startAtServerTimeMs?: number;
};

type ToneAdapterDeps = {
  sdk?: ClientSDK;
  resolveAssetRef?: (ref: string) => string;
};

type ToneAdapterHandle = {
  disposeNode: (nodeId: string) => void;
  disposeAll: () => void;
  syncActiveNodes: (
    activeNodeIds: Set<string>,
    nodes: NodeInstance[],
    connections: Connection[]
  ) => void;
};

type TransportStartState = {
  started: boolean;
  scheduledAtMs: number | null;
  cancel?: () => void;
};

type ToneBus = {
  name: string;
  input: any;
};

type EffectWrapper = {
  input: any;
  output: any;
  effect: any;
  wetParam?: any;
  setWet?: (value: number) => void;
  dispose: () => void;
};

type ToneEffectKind = 'tone-delay' | 'tone-reverb' | 'tone-pitch' | 'tone-resonator';
type ToneNodeKind =
  | ToneEffectKind
  | 'tone-osc'
  | 'audio-data'
  | 'tone-granular'
  | 'load-audio-from-assets'
  | 'load-audio-from-local';

type ToneEffectInstance = {
  nodeId: string;
  kind: ToneEffectKind;
  bus: string;
  order: number;
  enabled: boolean;
  wiredExternally: boolean;
  wrapper: EffectWrapper;
  lastParams: Record<string, number | string | boolean | null>;
  pendingGenerate?: boolean;
};

type ToneOscInstance = {
  osc: any;
  gain: any;
  loop: any | null;
  loopKey: string | null;
  loopDefaults: { frequency: number; amplitude: number } | null;
  bus: string;
  lastFrequency: number | null;
  lastAmplitude: number | null;
  lastWaveform: string | null;
  lastLoopLength: number | null;
};

type ToneGranularInstance = {
  nodeId: string;
  player: any;
  gain: any;
  bus: string;
  enabled: boolean;
  lastUrl: string | null;
  lastParams: Record<string, number | string | boolean | null>;
};

type TonePlayerInstance = {
  nodeId: string;
  player: any;
  gain: any;
  bus: string;
  enabled: boolean;
  started: boolean;
  startedAt: number;
  startOffsetSec: number;
  startDurationSec: number | null;
  pausedOffsetSec: number | null;
  autostarted: boolean;
  lastTrigger: boolean;
  loading: boolean;
  ended: boolean;
  endedReported: boolean;
  // Set before calling `player.stop()` so `onstop` can distinguish manual stops from natural ends.
  manualStopPending: boolean;
  // Latest desired URL for this player (resolved asset URL). Used to detect config changes.
  lastUrl: string | null;
  // URL that `player.buffer` currently corresponds to (when known).
  loadedUrl: string | null;
  // URL that most recently failed to load (avoid retrying every tick).
  failedUrl: string | null;
  // Async loading state for the *current* load attempt. See `requestTonePlayerLoad`.
  loadSeq: number;
  loadController: AbortController | null;
  loadingUrl: string | null;
  lastClip: { startSec: number; endSec: number; loop: boolean; reverse: boolean } | null;
  lastCursorSec: number | null;
  lastParams: Record<string, number | string | boolean | null>;
};

type ToneLfoInstance = {
  nodeId: string;
  lfo: any;
  enabled: boolean;
  started: boolean;
  lastParams: Record<string, number | string | boolean | null>;
};

type AudioDataInstance = {
  nodeId: string;
  input: any;
  output: any;
  analyser: AnalyserNode;
  timeData: Float32Array<ArrayBuffer>;
  freqData: Uint8Array;
  energyHistory: { t: number; e: number }[];
  lastBeatAt: number;
  beatIntervals: number[];
  bpm: number;
  lastConfig: {
    enabled: boolean;
    fftSize: number;
    smoothing: number;
    lowCutoffHz: number;
    highCutoffHz: number;
    detectBPM: boolean;
  };
};

const DEFAULT_RAMP_SECONDS = 0.05;
const MIN_TONE_DELAY_TIME_SECONDS = 0.001;
const DEFAULT_STEP_SECONDS = 0.25;
const DEFAULT_BUS = 'main';
const AUDIO_NODE_KINDS = new Set<ToneNodeKind>([
  'tone-osc',
  'audio-data',
  'tone-delay',
  'tone-resonator',
  'tone-pitch',
  'tone-reverb',
  'tone-granular',
  'load-audio-from-assets',
  'load-audio-from-local',
]);
const AUDIO_INPUT_PORTS = new Map<ToneNodeKind, string[]>([
  ['audio-data', ['in']],
  ['tone-delay', ['in']],
  ['tone-resonator', ['in']],
  ['tone-pitch', ['in']],
  ['tone-reverb', ['in']],
]);
const AUDIO_OUTPUT_PORTS = new Map<ToneNodeKind, string[]>([
  ['tone-osc', ['value']],
  ['audio-data', ['out']],
  ['tone-delay', ['out']],
  ['tone-resonator', ['out']],
  ['tone-pitch', ['out']],
  ['tone-reverb', ['out']],
  ['tone-granular', ['value']],
  ['load-audio-from-assets', ['ref']],
  ['load-audio-from-local', ['ref']],
]);

let toneModule: ToneModule | null = null;
let masterGain: any | null = null;
const transportState: TransportStartState = { started: false, scheduledAtMs: null };

const oscInstances = new Map<string, ToneOscInstance>();
const effectInstances = new Map<string, ToneEffectInstance>();
const granularInstances = new Map<string, ToneGranularInstance>();
const playerInstances = new Map<string, TonePlayerInstance>();
const lfoInstances = new Map<string, ToneLfoInstance>();
const audioDataInstances = new Map<string, AudioDataInstance>();
const buses = new Map<string, ToneBus>();
let latestGraphNodesById = new Map<string, NodeInstance>();
let latestAudioConnections: Connection[] = [];
let latestExplicitNodeIds = new Set<string>();
let latestExplicitEffectIds = new Set<string>();
let latestToneLfoConnections: Connection[] = [];
let latestToneLfoDesiredTargets = new Set<string>();
let latestToneLfoActiveTargets = new Set<string>();

type VideoFinishState = {
  signature: string;
  lastPlay: boolean;
  finished: boolean;
  updatedAt: number;
};

const videoFinishStates = new Map<string, VideoFinishState>();
const VIDEO_FINISH_MAX_AGE_MS = 10 * 60 * 1000;

function pruneVideoFinishStates(now: number): void {
  for (const [nodeId, entry] of videoFinishStates.entries()) {
    if (now - entry.updatedAt > VIDEO_FINISH_MAX_AGE_MS) videoFinishStates.delete(nodeId);
  }
}

function videoFinishSignatureFromRef(ref: unknown): string {
  if (typeof ref !== 'string') return '';
  const trimmed = ref.trim();
  if (!trimmed) return '';

  const hashIndex = trimmed.indexOf('#');
  const baseUrl = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const paramsRaw = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';
  if (!paramsRaw) return baseUrl;

  try {
    const params = new URLSearchParams(paramsRaw);
    const t = params.get('t') ?? '';
    const p = params.get('p') ?? '';
    const loop = params.get('loop') ?? '';
    const rev = params.get('rev') ?? '';
    return `${baseUrl}#t=${t}&p=${p}&loop=${loop}&rev=${rev}`;
  } catch {
    return baseUrl;
  }
}

function toneLfoTargetKey(nodeId: string, portId: string): string {
  return `${nodeId}|${portId}`;
}

function isToneLfoTargetActive(nodeId: string, portId: string): boolean {
  return latestToneLfoActiveTargets.has(toneLfoTargetKey(nodeId, portId));
}

function toNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  return Math.max(0, toNumber(value, fallback));
}

function toToneDelayTimeSeconds(value: unknown, fallback: number): number {
  // Safety: Tone delay time must always be > 0.
  return Math.max(MIN_TONE_DELAY_TIME_SECONDS, toNumber(value, fallback));
}

function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const num = Number(normalized);
    if (Number.isFinite(num)) return num > 0;
    return fallback;
  }
  if (typeof value === 'number') return value > 0;
  return fallback;
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
  if (s.startsWith('displayfile:')) return ensureLocalMediaKindQuery(s, kind);

  if (s.startsWith('localfile:')) return ensureLocalMediaKindQuery(s, kind);

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

  if (!isAbsoluteFilePath(s)) return '';
  return ensureLocalMediaKindQuery(`localfile:${s}`, kind);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(min)) return value;
  if (!Number.isFinite(max)) return value;
  return Math.max(min, Math.min(max, value));
}

function toAssetVolumeGain(value: unknown): number {
  // UI Volume is a relative control in [-1, 2]:
  // -1 => mute, 0 => normal (gain=1), 2 => max (gain=2), >2 => linear gain up to 100.
  const v = clamp(toNumber(value, 0), -1, 100);
  if (v <= -1) return 0;
  if (v < 0) return 1 + v;
  if (v <= 2) return 1 + v / 2;
  return v;
}

function loopKeyOf(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function isAudioNodeKind(type: string): type is ToneNodeKind {
  return AUDIO_NODE_KINDS.has(type as ToneNodeKind);
}

function isEffectKind(type: string): type is ToneEffectKind {
  return (
    type === 'tone-delay' ||
    type === 'tone-reverb' ||
    type === 'tone-pitch' ||
    type === 'tone-resonator'
  );
}

function isToneLfoConnection(conn: Connection, nodesById: Map<string, NodeInstance>): boolean {
  const source = nodesById.get(conn.sourceNodeId);
  const target = nodesById.get(conn.targetNodeId);
  if (!source || !target) return false;
  if (source.type !== 'tone-lfo') return false;
  if (conn.sourcePortId !== 'value') return false;
  // LFO connections are control-rate (number) on the graph, but executed as audio-rate modulation in Tone.
  return true;
}

function isAudioConnection(
  conn: Connection,
  nodesById: Map<string, NodeInstance>,
  registry: NodeRegistry | null
): boolean {
  const source = nodesById.get(conn.sourceNodeId);
  const target = nodesById.get(conn.targetNodeId);
  if (!source || !target) return false;

  // Prefer port typing from the single source of truth (node registry definitions).
  // If ports are explicitly typed as `audio`, treat it as an audio connection.
  if (registry) {
    const sourceDef = registry.get(source.type);
    const targetDef = registry.get(target.type);
    const outPort = sourceDef?.outputs?.find((p) => p.id === conn.sourcePortId);
    const inPort = targetDef?.inputs?.find((p) => p.id === conn.targetPortId);
    if (outPort?.type === 'audio' && inPort?.type === 'audio') return true;
  }

  // Fallback for older graphs/definitions: use a conservative allowlist.
  if (!isAudioNodeKind(source.type) || !isAudioNodeKind(target.type)) return false;
  const sourcePorts = AUDIO_OUTPUT_PORTS.get(source.type);
  const targetPorts = AUDIO_INPUT_PORTS.get(target.type);
  if (!sourcePorts || !targetPorts) return false;
  return sourcePorts.includes(conn.sourcePortId) && targetPorts.includes(conn.targetPortId);
}

function updateAudioGraphSnapshot(
  registry: NodeRegistry | null,
  nodes: NodeInstance[],
  connections: Connection[]
): void {
  latestGraphNodesById = new Map(nodes.map((node) => [node.id, node]));
  const nextConnections = Array.isArray(connections) ? connections : [];
  latestAudioConnections = nextConnections.filter((conn) =>
    isAudioConnection(conn, latestGraphNodesById, registry)
  );
  latestToneLfoConnections = nextConnections.filter((conn) =>
    isToneLfoConnection(conn, latestGraphNodesById)
  );
  latestToneLfoDesiredTargets = new Set(
    latestToneLfoConnections.map((conn) =>
      toneLfoTargetKey(String(conn.targetNodeId), String(conn.targetPortId))
    )
  );

  latestExplicitNodeIds = new Set();
  latestExplicitEffectIds = new Set();
  for (const conn of latestAudioConnections) {
    latestExplicitNodeIds.add(conn.sourceNodeId);
    latestExplicitNodeIds.add(conn.targetNodeId);
    const source = latestGraphNodesById.get(conn.sourceNodeId);
    const target = latestGraphNodesById.get(conn.targetNodeId);
    if (source && isEffectKind(source.type)) latestExplicitEffectIds.add(source.id);
    if (target && isEffectKind(target.type)) latestExplicitEffectIds.add(target.id);
  }
}

function getAudioOutputNode(nodeId: string): any | null {
  const osc = oscInstances.get(nodeId);
  if (osc?.gain) return osc.gain;
  const audioData = audioDataInstances.get(nodeId);
  if (audioData?.output) return audioData.output;
  const granular = granularInstances.get(nodeId);
  if (granular?.gain) return granular.gain;
  const player = playerInstances.get(nodeId);
  if (player?.gain) return player.gain;
  const effect = effectInstances.get(nodeId);
  if (effect?.wrapper?.output) return effect.wrapper.output;
  return null;
}

function getAudioInputNode(nodeId: string): any | null {
  const audioData = audioDataInstances.get(nodeId);
  if (audioData?.input) return audioData.input;
  const effect = effectInstances.get(nodeId);
  if (effect?.wrapper?.input) return effect.wrapper.input;
  return null;
}

function resolveToneLfoDestination(targetNodeId: string, targetPortId: string): any | null {
  const target = latestGraphNodesById.get(targetNodeId);
  if (!target) return null;

  if (target.type === 'tone-delay') {
    const inst = effectInstances.get(targetNodeId);
    if (!inst || !inst.enabled) return null;
    if (targetPortId === 'wet') return inst.wrapper.wetParam ?? null;
    if (targetPortId === 'time') return inst.wrapper.effect?.delayTime ?? null;
    if (targetPortId === 'feedback') return inst.wrapper.effect?.feedback ?? null;
    return null;
  }

  if (target.type === 'tone-resonator') {
    const inst = effectInstances.get(targetNodeId);
    if (!inst || !inst.enabled) return null;
    if (targetPortId === 'wet') return inst.wrapper.wetParam ?? null;
    if (targetPortId === 'delayTime') return inst.wrapper.effect?.delayTime ?? null;
    return null;
  }

  if (target.type === 'tone-reverb' || target.type === 'tone-pitch') {
    const inst = effectInstances.get(targetNodeId);
    if (!inst || !inst.enabled) return null;
    if (targetPortId === 'wet') return inst.wrapper.wetParam ?? null;
    return null;
  }

  return null;
}

function applyToneLfoWiring(): void {
  if (!toneModule || !toneAudioEngine.isEnabled()) {
    latestToneLfoActiveTargets = new Set();
    return;
  }

  for (const inst of lfoInstances.values()) {
    try {
      inst.lfo.disconnect();
    } catch {
      // ignore
    }
  }

  const nextActiveTargets = new Set<string>();
  for (const conn of latestToneLfoConnections) {
    const inst = lfoInstances.get(conn.sourceNodeId);
    if (!inst || !inst.enabled || !inst.started) continue;

    const destination = resolveToneLfoDestination(conn.targetNodeId, conn.targetPortId);
    if (!destination) continue;

    try {
      inst.lfo.connect(destination);
      nextActiveTargets.add(toneLfoTargetKey(conn.targetNodeId, conn.targetPortId));
    } catch (error) {
      console.warn('[tone-adapter] lfo connect failed', conn, error);
    }
  }

  latestToneLfoActiveTargets = nextActiveTargets;
}

function reconnectSourcesToBus(): void {
  if (!toneModule) return;
  for (const inst of oscInstances.values()) {
    const bus = getOrCreateBus(inst.bus);
    try {
      inst.gain.disconnect();
    } catch {
      // ignore
    }
    try {
      inst.gain.connect(bus.input);
    } catch {
      // ignore
    }
  }
  for (const inst of granularInstances.values()) {
    const bus = getOrCreateBus(inst.bus);
    try {
      inst.gain.disconnect();
    } catch {
      // ignore
    }
    try {
      inst.gain.connect(bus.input);
    } catch {
      // ignore
    }
  }
  for (const inst of playerInstances.values()) {
    const bus = getOrCreateBus(inst.bus);
    try {
      inst.gain.disconnect();
    } catch {
      // ignore
    }
    try {
      inst.gain.connect(bus.input);
    } catch {
      // ignore
    }
  }
}

// Rebuild explicit audio connections from the last deployed graph snapshot.
function applyGraphWiring(): boolean {
  if (!toneModule) return false;
  if (!toneAudioEngine.isEnabled()) return false;
  if (latestAudioConnections.length === 0) return true;

  for (const inst of effectInstances.values()) {
    inst.wiredExternally = latestExplicitEffectIds.has(inst.nodeId);
  }

  for (const bus of buses.keys()) {
    rebuildBusChain(bus);
  }

  let missing = false;
  const outgoingCounts = new Map<string, number>();

  for (const nodeId of latestExplicitNodeIds) {
    const output = getAudioOutputNode(nodeId);
    if (!output) {
      missing = true;
      continue;
    }
    try {
      output.disconnect();
    } catch {
      // ignore
    }
  }

  for (const conn of latestAudioConnections) {
    const output = getAudioOutputNode(conn.sourceNodeId);
    if (!output) {
      missing = true;
      continue;
    }

    const target = latestGraphNodesById.get(conn.targetNodeId);
    if (target?.type === 'audio-out') {
      ensureMasterGain();
      try {
        output.connect(masterGain ?? toneModule.Destination);
        outgoingCounts.set(conn.sourceNodeId, (outgoingCounts.get(conn.sourceNodeId) ?? 0) + 1);
      } catch (error) {
        missing = true;
        console.warn('[tone-adapter] audio connect to audio-out failed', error);
      }
      continue;
    }

    const input = getAudioInputNode(conn.targetNodeId);
    if (!input) {
      missing = true;
      continue;
    }
    try {
      output.connect(input);
      outgoingCounts.set(conn.sourceNodeId, (outgoingCounts.get(conn.sourceNodeId) ?? 0) + 1);
    } catch (error) {
      missing = true;
      console.warn('[tone-adapter] audio connect failed', error);
    }
  }

  ensureMasterGain();
  for (const nodeId of latestExplicitNodeIds) {
    if ((outgoingCounts.get(nodeId) ?? 0) > 0) continue;
    const output = getAudioOutputNode(nodeId);
    if (!output) {
      missing = true;
      continue;
    }
    try {
      output.connect(masterGain ?? toneModule.Destination);
    } catch (error) {
      missing = true;
      console.warn('[tone-adapter] audio connect to master failed', error);
    }
  }

  return !missing;
}

// Mark the audio graph as dirty and rebuild if Tone is ready.
function scheduleGraphWiring(): void {
  if (!toneModule || !toneAudioEngine.isEnabled()) {
    latestToneLfoActiveTargets = new Set();
    return;
  }

  if (latestAudioConnections.length > 0) {
    applyGraphWiring();
  } else {
    for (const inst of effectInstances.values()) inst.wiredExternally = false;
    reconnectSourcesToBus();
    for (const bus of buses.keys()) rebuildBusChain(bus);
  }

  applyToneLfoWiring();
}

async function ensureTone(): Promise<ToneModule> {
  if (toneModule) return toneModule;
  const tone = (await toneAudioEngine.ensureLoaded()) as unknown as ToneModule;
  toneModule = (toneAudioEngine.getToneModule() as unknown as ToneModule | null) ?? tone;
  return tone;
}

function ensureMasterGain(): void {
  if (!toneModule || masterGain) return;
  const gain = new toneModule.Gain({ gain: 1 });
  gain.connect(toneModule.Destination);
  masterGain = gain;
}

function getOrCreateBus(name: string): ToneBus {
  const key = name.trim() || DEFAULT_BUS;
  let bus = buses.get(key);
  if (!bus) {
    ensureMasterGain();
    const input = new toneModule!.Gain({ gain: 1 });
    bus = { name: key, input };
    buses.set(key, bus);
    try {
      input.connect(masterGain ?? toneModule!.Destination);
    } catch {
      // ignore
    }
  }
  return bus;
}

function rebuildBusChain(busName: string): void {
  if (!toneModule) return;
  ensureMasterGain();

  const bus = getOrCreateBus(busName);
  try {
    bus.input.disconnect();
  } catch {
    // ignore
  }

  const effects = Array.from(effectInstances.values())
    .filter((inst) => inst.bus === busName && !inst.wiredExternally)
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.nodeId.localeCompare(b.nodeId)));

  let tail = bus.input;
  for (const effect of effects) {
    // Important: don't disconnect `wrapper.input` here. Some wrappers (e.g. tone-resonator) use an input
    // Gain node that is internally wired to dry/wet paths; disconnecting it would tear down that internal
    // wiring and silence the effect chain.
    try {
      effect.wrapper.output.disconnect();
    } catch {
      // ignore
    }
    try {
      tail.connect(effect.wrapper.input);
      tail = effect.wrapper.output;
    } catch (error) {
      console.warn('[tone-adapter] effect chain connect failed', error);
    }
  }

  try {
    tail.connect(masterGain ?? toneModule.Destination);
  } catch (error) {
    console.warn('[tone-adapter] bus connect failed', error);
  }
}

function startTransportNow(): void {
  if (!toneModule || transportState.started) return;
  try {
    toneModule.Transport.start();
    transportState.started = true;
    transportState.scheduledAtMs = null;
    if (transportState.cancel) {
      transportState.cancel();
      transportState.cancel = undefined;
    }
  } catch (error) {
    console.warn('[tone-adapter] transport start failed', error);
  }
}

function ensureTransportStart(deps: ToneAdapterDeps, startAtServerTimeMs?: number): void {
  if (!toneModule || transportState.started) return;

  if (typeof startAtServerTimeMs === 'number' && Number.isFinite(startAtServerTimeMs)) {
    if (transportState.scheduledAtMs && transportState.scheduledAtMs <= startAtServerTimeMs) {
      return;
    }
    if (transportState.cancel) {
      transportState.cancel();
      transportState.cancel = undefined;
      transportState.scheduledAtMs = null;
    }

    if (deps.sdk) {
      const scheduled = deps.sdk.scheduleAt(startAtServerTimeMs, () => startTransportNow());
      transportState.cancel = scheduled.cancel;
      transportState.scheduledAtMs = startAtServerTimeMs;
      return;
    }

    const delay = Math.max(0, startAtServerTimeMs - Date.now());
    const timeoutId = setTimeout(() => startTransportNow(), delay);
    transportState.cancel = () => clearTimeout(timeoutId);
    transportState.scheduledAtMs = startAtServerTimeMs;
    return;
  }

  startTransportNow();
}

function maybeStopTransport(): void {
  if (!toneModule || !transportState.started) return;
  const hasLoop = Array.from(oscInstances.values()).some((inst) => inst.loop);
  if (hasLoop) return;
  try {
    toneModule.Transport.stop();
  } catch (error) {
    console.warn('[tone-adapter] transport stop failed', error);
  }
  transportState.started = false;
  transportState.scheduledAtMs = null;
  if (transportState.cancel) {
    transportState.cancel();
    transportState.cancel = undefined;
  }
}

function parseLoopPattern(
  raw: unknown,
  defaults: { frequency: number; amplitude: number }
): ParsedLoop | null {
  if (raw == null) return null;

  let value: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = trimmed;
      }
    } else {
      value = trimmed;
    }
  }

  if (Array.isArray(value)) {
    return parseLoopArray(value, defaults, DEFAULT_STEP_SECONDS);
  }

  if (typeof value === 'object' && value) {
    return parseLoopObject(value as Record<string, unknown>, defaults);
  }

  if (typeof value === 'string') {
    return parseLoopString(value, defaults, DEFAULT_STEP_SECONDS);
  }

  return null;
}

function parseLoopString(
  value: string,
  defaults: { frequency: number; amplitude: number },
  stepSeconds: number
): ParsedLoop | null {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const events: LoopEvent[] = tokens.map((token, index) => ({
    time: index * stepSeconds,
    amplitude: toNumber(token, defaults.amplitude),
  }));
  return { events, loopLengthSeconds: tokens.length * stepSeconds };
}

function parseLoopArray(
  values: unknown[],
  defaults: { frequency: number; amplitude: number },
  stepSeconds: number
): ParsedLoop | null {
  if (values.length === 0) return null;

  const allNumbers = values.every(
    (item) => typeof item === 'number' || (typeof item === 'string' && item.trim() !== '')
  );
  if (allNumbers) {
    const events = values.map((item, index) => ({
      time: index * stepSeconds,
      amplitude: toNumber(item, defaults.amplitude),
    }));
    return { events, loopLengthSeconds: values.length * stepSeconds };
  }

  const events: LoopEvent[] = [];
  let maxTime = 0;
  values.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const time = resolveEventTime(record, index, stepSeconds);
    if (time == null) return;
    const frequency = resolveFrequency(record, defaults.frequency);
    const amplitude = resolveAmplitude(record, defaults.amplitude);
    events.push({ time, frequency, amplitude });
    if (time > maxTime) maxTime = time;
  });

  if (events.length === 0) return null;
  return { events, loopLengthSeconds: maxTime + stepSeconds };
}

function parseLoopObject(
  value: Record<string, unknown>,
  defaults: { frequency: number; amplitude: number }
): ParsedLoop | null {
  const tempo = toNumber(value.tempo, 120);
  const stepBeats = toNumber(value.stepBeats ?? value.step, 0.25);
  const stepMs = toNumber(value.stepMs, 0);
  const stepSeconds = stepMs > 0 ? stepMs / 1000 : (60 / tempo) * stepBeats;

  const startAtServerTimeMs = toNumber(
    value.startAtServerTimeMs ?? value.startAt ?? value.executeAt ?? value.startAtServerTime,
    NaN
  );

  const eventsSource = Array.isArray(value.steps)
    ? value.steps
    : Array.isArray(value.events)
      ? value.events
      : null;

  if (!eventsSource) return null;

  const parsed = parseLoopArray(eventsSource, defaults, stepSeconds);
  if (!parsed) return null;

  const loopLengthMs = toNumber(value.loopLengthMs, 0);
  const loopLengthSeconds = toNumber(value.loopLengthSeconds ?? value.loopLength, 0);
  const resolvedLoopLength =
    loopLengthMs > 0
      ? loopLengthMs / 1000
      : loopLengthSeconds > 0
        ? loopLengthSeconds
        : parsed.loopLengthSeconds;

  return {
    events: parsed.events,
    loopLengthSeconds: Math.max(resolvedLoopLength, 0.01),
    startAtServerTimeMs: Number.isFinite(startAtServerTimeMs) ? startAtServerTimeMs : undefined,
  };
}

function resolveEventTime(
  record: Record<string, unknown>,
  index: number,
  stepSeconds: number
): number | null {
  if (typeof record.timeMs === 'number') return record.timeMs / 1000;
  if (typeof record.time === 'number') return record.time;
  if (typeof record.timeSeconds === 'number') return record.timeSeconds;
  if (typeof record.step === 'number') return record.step * stepSeconds;
  if (typeof record.index === 'number') return record.index * stepSeconds;
  return index * stepSeconds;
}

function resolveFrequency(record: Record<string, unknown>, fallback: number): number | undefined {
  if (typeof record.frequency === 'number') return record.frequency;
  if (typeof record.freq === 'number') return record.freq;
  if (typeof record.pitch === 'number') return record.pitch;
  return fallback;
}

function resolveAmplitude(record: Record<string, unknown>, fallback: number): number | undefined {
  if (typeof record.amplitude === 'number') return record.amplitude;
  if (typeof record.amp === 'number') return record.amp;
  if (typeof record.velocity === 'number') return record.velocity;
  return fallback;
}

function createOscInstance(
  nodeId: string,
  frequency: number,
  amplitude: number,
  waveform: string,
  busName: string
): ToneOscInstance {
  if (!toneModule) throw new Error('Tone module is not loaded');
  ensureMasterGain();

  const bus = getOrCreateBus(busName);
  const osc = new toneModule.Oscillator({ frequency, type: waveform } as any);
  const gain = new toneModule.Gain({ gain: amplitude });
  osc.connect(gain);
  gain.connect(bus.input);
  osc.start();

  const instance: ToneOscInstance = {
    osc,
    gain,
    loop: null,
    loopKey: null,
    loopDefaults: null,
    bus: bus.name,
    lastFrequency: frequency,
    lastAmplitude: amplitude,
    lastWaveform: waveform,
    lastLoopLength: null,
  };

  oscInstances.set(nodeId, instance);
  scheduleGraphWiring();
  return instance;
}

function createToneLfoInstance(
  nodeId: string,
  params: { frequencyHz: number; min: number; max: number; amplitude: number; waveform: string }
): ToneLfoInstance {
  if (!toneModule) throw new Error('Tone module is not loaded');

  const min = Math.min(params.min, params.max);
  const max = Math.max(params.min, params.max);
  const lfo = new toneModule.LFO({
    frequency: params.frequencyHz,
    min,
    max,
    type: params.waveform,
  } as any);

  try {
    lfo.amplitude.value = params.amplitude;
  } catch {
    // ignore
  }

  const instance: ToneLfoInstance = {
    nodeId,
    lfo,
    enabled: true,
    started: false,
    lastParams: { ...params, min, max, enabled: true },
  };

  try {
    lfo.start();
    instance.started = true;
  } catch {
    // ignore
  }

  lfoInstances.set(nodeId, instance);
  scheduleGraphWiring();
  return instance;
}

function updateToneLfoInstance(
  instance: ToneLfoInstance,
  params: {
    frequencyHz: number;
    min: number;
    max: number;
    amplitude: number;
    waveform: string;
    enabled: boolean;
  }
): void {
  const min = Math.min(params.min, params.max);
  const max = Math.max(params.min, params.max);

  const prevEnabled = instance.enabled;
  instance.enabled = params.enabled;

  if (!params.enabled && prevEnabled) {
    try {
      instance.lfo.stop();
    } catch {
      // ignore
    }
    instance.started = false;
    scheduleGraphWiring();
    instance.lastParams = { ...instance.lastParams, ...params, min, max };
    return;
  }

  if (!params.enabled) {
    instance.lastParams = { ...instance.lastParams, ...params, min, max };
    return;
  }

  if (instance.lastParams.waveform !== params.waveform) {
    try {
      instance.lfo.type = params.waveform;
    } catch {
      // ignore
    }
  }

  if (instance.lastParams.frequencyHz !== params.frequencyHz) {
    try {
      instance.lfo.frequency.rampTo(params.frequencyHz, DEFAULT_RAMP_SECONDS);
    } catch {
      try {
        instance.lfo.frequency.value = params.frequencyHz;
      } catch {
        // ignore
      }
    }
  }

  if (instance.lastParams.min !== min) {
    try {
      instance.lfo.min = min;
    } catch {
      // ignore
    }
  }

  if (instance.lastParams.max !== max) {
    try {
      instance.lfo.max = max;
    } catch {
      // ignore
    }
  }

  if (instance.lastParams.amplitude !== params.amplitude) {
    try {
      instance.lfo.amplitude.rampTo(params.amplitude, DEFAULT_RAMP_SECONDS);
    } catch {
      try {
        instance.lfo.amplitude.value = params.amplitude;
      } catch {
        // ignore
      }
    }
  }

  if (!instance.started) {
    try {
      instance.lfo.start();
      instance.started = true;
      scheduleGraphWiring();
    } catch {
      // ignore
    }
  }

  if (prevEnabled !== params.enabled) {
    scheduleGraphWiring();
  }

  instance.lastParams = { ...instance.lastParams, ...params, min, max };
}

function updateLoop(
  instance: ToneOscInstance,
  parsed: ParsedLoop,
  deps: ToneAdapterDeps,
  startAtServerTimeMs?: number
): void {
  if (!toneModule) return;

  if (!instance.loop) {
    instance.loop = new toneModule.Part((time: number, event: LoopEvent) => {
      if (!instance.osc || !instance.gain) return;
      if (typeof event.frequency === 'number' && Number.isFinite(event.frequency)) {
        instance.osc.frequency.setValueAtTime(event.frequency, time);
      }
      if (typeof event.amplitude === 'number' && Number.isFinite(event.amplitude)) {
        instance.gain.gain.setValueAtTime(event.amplitude, time);
      }
    }, []);
    instance.loop.loop = true;
  }

  const loop = instance.loop;
  loop.clear();
  parsed.events.forEach((event) => loop.add(event.time, event));
  loop.loopStart = 0;
  loop.loopEnd = parsed.loopLengthSeconds;
  instance.lastLoopLength = parsed.loopLengthSeconds;

  if (!loop.state || loop.state !== 'started') {
    if (transportState.started) {
      loop.start(toneModule.Transport.seconds);
    } else {
      loop.start(0);
    }
  }

  ensureTransportStart(deps, startAtServerTimeMs ?? parsed.startAtServerTimeMs);
}

function disposeLoop(instance: ToneOscInstance): void {
  if (!instance.loop) return;
  try {
    instance.loop.stop();
    instance.loop.dispose();
  } catch {
    // ignore dispose errors
  }
  instance.loop = null;
  instance.loopKey = null;
  instance.lastLoopLength = null;
}

function createDelayEffect(time: number, feedback: number, wet: number): EffectWrapper {
  const effect = new toneModule!.FeedbackDelay({
    delayTime: toToneDelayTimeSeconds(time, MIN_TONE_DELAY_TIME_SECONDS),
    feedback,
    wet,
  });
  const setWet = (value: number) => effect.wet.rampTo(value, DEFAULT_RAMP_SECONDS);
  return {
    input: effect,
    output: effect,
    effect,
    wetParam: effect.wet,
    setWet,
    dispose: () => effect.dispose(),
  };
}

function createReverbEffect(decay: number, preDelay: number, wet: number): EffectWrapper {
  const effect = new toneModule!.Reverb({ decay, preDelay, wet });
  const setWet = (value: number) => effect.wet.rampTo(value, DEFAULT_RAMP_SECONDS);
  return {
    input: effect,
    output: effect,
    effect,
    wetParam: effect.wet,
    setWet,
    dispose: () => effect.dispose(),
  };
}

function createPitchEffect(
  pitch: number,
  windowSize: number,
  delayTime: number,
  feedback: number,
  wet: number
): EffectWrapper {
  const effect = new toneModule!.PitchShift({ pitch, windowSize, delayTime, feedback, wet });
  const setWet = (value: number) => effect.wet.rampTo(value, DEFAULT_RAMP_SECONDS);
  return {
    input: effect,
    output: effect,
    effect,
    wetParam: effect.wet,
    setWet,
    dispose: () => effect.dispose(),
  };
}

function createResonatorEffect(
  delayTime: number,
  resonance: number,
  dampening: number,
  wet: number
): EffectWrapper {
  const input = new toneModule!.Gain({ gain: 1 });
  const comb = new toneModule!.LowpassCombFilter({ delayTime, resonance, dampening });
  const crossfade = new toneModule!.CrossFade({ fade: wet });
  input.connect(crossfade.a);
  input.connect(comb);
  comb.connect(crossfade.b);
  const setWet = (value: number) => crossfade.fade.rampTo(value, DEFAULT_RAMP_SECONDS);
  return {
    input,
    output: crossfade,
    effect: comb,
    wetParam: crossfade.fade,
    setWet,
    dispose: () => {
      input.dispose();
      comb.dispose();
      crossfade.dispose();
    },
  };
}

function createEffectInstance(
  kind: ToneEffectKind,
  params: Record<string, number>,
  bus: string,
  order: number,
  enabled: boolean,
  nodeId: string
): ToneEffectInstance {
  const safeParams: Record<string, number> = { ...params };
  let wrapper: EffectWrapper;
  switch (kind) {
    case 'tone-delay': {
      safeParams.time = toToneDelayTimeSeconds(params.time, 0.25);
      safeParams.feedback = clamp(params.feedback, 0, 1);
      safeParams.wet = clamp(params.wet, 0, 1);
      wrapper = createDelayEffect(safeParams.time, safeParams.feedback, safeParams.wet);
      break;
    }
    case 'tone-reverb':
      wrapper = createReverbEffect(params.decay, params.preDelay, clamp(params.wet, 0, 1));
      break;
    case 'tone-pitch':
      wrapper = createPitchEffect(
        params.pitch,
        params.windowSize,
        params.delayTime,
        clamp(params.feedback, 0, 1),
        clamp(params.wet, 0, 1)
      );
      break;
    case 'tone-resonator':
      wrapper = createResonatorEffect(
        params.delayTime,
        clamp(params.resonance, 0, 1),
        params.dampening,
        clamp(params.wet, 0, 1)
      );
      break;
  }

  const instance: ToneEffectInstance = {
    nodeId,
    kind,
    bus,
    order,
    enabled,
    wiredExternally: false,
    wrapper,
    lastParams: { ...safeParams, bus, order, enabled },
  };

  if (!enabled && wrapper.setWet) {
    wrapper.setWet(0);
  }

  effectInstances.set(nodeId, instance);
  rebuildBusChain(bus);
  scheduleGraphWiring();
  return instance;
}

function updateEffectInstance(
  instance: ToneEffectInstance,
  nextParams: Record<string, number>,
  bus: string,
  order: number,
  enabled: boolean
): void {
  const prevBus = instance.bus;
  const prevOrder = instance.order;
  const prevEnabled = instance.enabled;

  instance.bus = bus;
  instance.order = order;
  instance.enabled = enabled;

  if (bus !== prevBus || order !== prevOrder) {
    rebuildBusChain(prevBus);
    rebuildBusChain(bus);
    scheduleGraphWiring();
  }

  if (enabled !== prevEnabled) {
    scheduleGraphWiring();
  }

  const applyWet = (value: number) => {
    if (instance.wrapper.setWet) {
      instance.wrapper.setWet(enabled ? value : 0);
    }
  };

  switch (instance.kind) {
    case 'tone-delay': {
      const effect = instance.wrapper.effect;
      const time = toToneDelayTimeSeconds(nextParams.time, 0.25);
      const feedback = clamp(nextParams.feedback, 0, 1);
      const wet = clamp(nextParams.wet, 0, 1);
      if (instance.lastParams.time !== time && !isToneLfoTargetActive(instance.nodeId, 'time')) {
        effect.delayTime.rampTo(time, DEFAULT_RAMP_SECONDS);
      }
      if (
        instance.lastParams.feedback !== feedback &&
        !isToneLfoTargetActive(instance.nodeId, 'feedback')
      ) {
        effect.feedback.rampTo(feedback, DEFAULT_RAMP_SECONDS);
      }
      if (
        (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) &&
        (!isToneLfoTargetActive(instance.nodeId, 'wet') || !enabled)
      ) {
        applyWet(wet);
      }
      instance.lastParams = { ...instance.lastParams, ...nextParams, time, feedback, wet, enabled };
      break;
    }
    case 'tone-reverb': {
      const effect = instance.wrapper.effect;
      const decay = nextParams.decay;
      const preDelay = nextParams.preDelay;
      const wet = clamp(nextParams.wet, 0, 1);
      if (instance.lastParams.decay !== decay) effect.decay = decay;
      if (instance.lastParams.preDelay !== preDelay) effect.preDelay = preDelay;
      if (
        !instance.pendingGenerate &&
        (instance.lastParams.decay !== decay || instance.lastParams.preDelay !== preDelay)
      ) {
        instance.pendingGenerate = true;
        void effect
          .generate()
          .catch((error: unknown) => {
            console.warn('[tone-adapter] reverb generate failed', error);
          })
          .finally(() => {
            instance.pendingGenerate = false;
          });
      }
      if (
        (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) &&
        (!isToneLfoTargetActive(instance.nodeId, 'wet') || !enabled)
      ) {
        applyWet(wet);
      }
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
    case 'tone-pitch': {
      const effect = instance.wrapper.effect;
      const pitch = nextParams.pitch;
      const windowSize = nextParams.windowSize;
      const delayTime = nextParams.delayTime;
      const feedback = clamp(nextParams.feedback, 0, 1);
      const wet = clamp(nextParams.wet, 0, 1);
      if (instance.lastParams.pitch !== pitch) effect.pitch = pitch;
      if (instance.lastParams.windowSize !== windowSize) effect.windowSize = windowSize;
      if (instance.lastParams.delayTime !== delayTime) effect.delayTime = delayTime;
      if (instance.lastParams.feedback !== feedback) effect.feedback = feedback;
      if (
        (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) &&
        (!isToneLfoTargetActive(instance.nodeId, 'wet') || !enabled)
      ) {
        applyWet(wet);
      }
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
    case 'tone-resonator': {
      const comb = instance.wrapper.effect;
      const delayTime = nextParams.delayTime;
      const resonance = clamp(nextParams.resonance, 0, 1);
      const dampening = nextParams.dampening;
      const wet = clamp(nextParams.wet, 0, 1);
      if (
        instance.lastParams.delayTime !== delayTime &&
        !isToneLfoTargetActive(instance.nodeId, 'delayTime')
      ) {
        comb.delayTime.rampTo(delayTime, DEFAULT_RAMP_SECONDS);
      }
      if (instance.lastParams.resonance !== resonance) comb.resonance = resonance;
      if (instance.lastParams.dampening !== dampening) comb.dampening = dampening;
      if (
        (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) &&
        (!isToneLfoTargetActive(instance.nodeId, 'wet') || !enabled)
      ) {
        applyWet(wet);
      }
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
  }
}

function createGranularInstance(
  nodeId: string,
  url: string,
  busName: string,
  params: Record<string, number | boolean>
): ToneGranularInstance {
  const bus = getOrCreateBus(busName);
  const gain = new toneModule!.Gain({ gain: params.volume as number });
  const player = new toneModule!.GrainPlayer({
    url,
    loop: params.loop as boolean,
    grainSize: params.grainSize as number,
    overlap: params.overlap as number,
    playbackRate: params.playbackRate as number,
    detune: params.detune as number,
    onload: () => {
      if (params.enabled) {
        try {
          player.start();
        } catch {
          // ignore
        }
      }
    },
  });

  player.connect(gain);
  gain.connect(bus.input);

  const instance: ToneGranularInstance = {
    nodeId,
    player,
    gain,
    bus: bus.name,
    enabled: Boolean(params.enabled),
    lastUrl: url,
    lastParams: { ...params },
  };

  if (instance.enabled) {
    try {
      player.start();
    } catch {
      // ignore
    }
  }

  granularInstances.set(nodeId, instance);
  rebuildBusChain(bus.name);
  scheduleGraphWiring();
  return instance;
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) return error.name === 'AbortError' || error.message.includes('AbortError');
  return String(error).includes('AbortError');
}

/**
 * Ensure Tone.Player loads are serialized and cancelable.
 *
 * ToneAudioBuffer.load (used by Tone.Player.load) does `fetch(url)` without AbortSignal support,
 * so rapid URL switching can accumulate concurrent downloads/decodes and stall the main thread.
 *
 * Strategy:
 * - Keep a single in-flight load per nodeId.
 * - Abort the fetch stage when a newer URL arrives (best-effort).
 * - Never apply stale load results (URL/seq checks).
 */
function requestTonePlayerLoad(instance: TonePlayerInstance): void {
  if (!toneModule) return;
  if (instance.loading) return;
  const url = instance.lastUrl;
  if (!url) return;
  if (instance.loadedUrl === url) return;
  if (instance.failedUrl === url) return;
  void startTonePlayerLoad(instance, url);
}

async function startTonePlayerLoad(instance: TonePlayerInstance, url: string): Promise<void> {
  if (!toneModule) return;

  const seq = instance.loadSeq + 1;
  instance.loadSeq = seq;
  instance.loading = true;
  instance.loadingUrl = url;
  instance.failedUrl = null;

  try {
    instance.loadController?.abort();
  } catch {
    // ignore
  }
  const controller = new AbortController();
  instance.loadController = controller;

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`GET failed (${res.status})`);

    const arrayBuffer = await res.arrayBuffer();
    if (controller.signal.aborted) return;

    const audioBuffer = await toneModule.getContext().decodeAudioData(arrayBuffer);
    if (controller.signal.aborted) return;

    const current = playerInstances.get(instance.nodeId);
    if (!current || current.loadSeq !== seq) return;
    if (current.lastUrl !== url) return;

    current.player.buffer = audioBuffer;
    current.loadedUrl = url;
    current.failedUrl = null;
  } catch (error: unknown) {
    if (isAbortError(error)) return;
    const current = playerInstances.get(instance.nodeId);
    if (current && current.loadSeq === seq && current.lastUrl === url) {
      current.failedUrl = url;
    }
    console.warn('[tone-adapter] player load failed', { url }, error);
  } finally {
    const current = playerInstances.get(instance.nodeId);
    if (current && current.loadSeq === seq) {
      current.loading = false;
      current.loadingUrl = null;
      current.loadController = null;

      // If URL changed while we were loading, kick the next load (no concurrency).
      requestTonePlayerLoad(current);
    }
  }
}

function createPlayerInstance(
  nodeId: string,
  busName: string,
  params: Record<string, number | boolean>
): TonePlayerInstance {
  const bus = getOrCreateBus(busName);
  const gain = new toneModule!.Gain({ gain: params.volume as number });
  const playbackRate = toNonNegativeNumber(params.playbackRate, 1);
  const player = new toneModule!.Player({
    loop: params.loop as boolean,
    playbackRate,
    detune: params.detune as number,
    autostart: false,
  } as any);

  player.connect(gain);
  gain.connect(bus.input);

  const instance: TonePlayerInstance = {
    nodeId,
    player,
    gain,
    bus: bus.name,
    enabled: Boolean(params.enabled),
    started: false,
    startedAt: 0,
    startOffsetSec: 0,
    startDurationSec: null,
    pausedOffsetSec: null,
    autostarted: false,
    lastTrigger: false,
    loading: false,
    loadingUrl: null,
    loadSeq: 0,
    loadController: null,
    ended: false,
    endedReported: false,
    manualStopPending: false,
    lastUrl: null,
    loadedUrl: null,
    failedUrl: null,
    lastClip: null,
    lastCursorSec: null,
    lastParams: { ...params, playbackRate },
  };

  player.onstop = () => {
    const inst = playerInstances.get(nodeId);
    if (!inst) return;
    if (inst.manualStopPending) {
      inst.manualStopPending = false;
      return;
    }
    if (inst.ended) return;
    if (inst.lastParams.loop) return;
    if (!inst.enabled) return;

    inst.ended = true;
    inst.started = false;
    inst.startedAt = 0;

    const reverse = Boolean(inst.lastParams.reverse ?? false);
    if (
      typeof inst.startDurationSec === 'number' &&
      Number.isFinite(inst.startDurationSec) &&
      inst.startDurationSec >= 0
    ) {
      const endPos = reverse
        ? inst.startOffsetSec - inst.startDurationSec
        : inst.startOffsetSec + inst.startDurationSec;
      inst.pausedOffsetSec = Number.isFinite(endPos) ? Math.max(0, endPos) : inst.pausedOffsetSec;
    }

    inst.startOffsetSec = 0;
    inst.startDurationSec = null;
  };

  playerInstances.set(nodeId, instance);
  rebuildBusChain(bus.name);
  scheduleGraphWiring();
  return instance;
}

// Audio analysis tap for patch audio connections (rms/peak/bands/centroid/bpm).
const AUDIO_DATA_FFT_SIZES = [512, 1024, 2048, 4096, 8192] as const;

function normalizeAudioDataConfig(config: Record<string, unknown>): AudioDataInstance['lastConfig'] {
  const enabled = toBoolean(config.enabled, true);
  const requestedFftSize = toNumber(config.fftSize, 2048);
  const fftSize = (() => {
    let best: number = AUDIO_DATA_FFT_SIZES[0];
    let bestDiff = Math.abs(best - requestedFftSize);
    for (const size of AUDIO_DATA_FFT_SIZES) {
      const diff = Math.abs(size - requestedFftSize);
      if (diff < bestDiff) {
        best = size;
        bestDiff = diff;
      }
    }
    return best;
  })();
  const smoothing = clamp(toNumber(config.smoothing, 0.2), 0, 0.99);
  const lowRaw = clamp(toNumber(config.lowCutoffHz, 300), 20, 20000);
  const highRaw = clamp(toNumber(config.highCutoffHz, 3000), 20, 20000);
  const lowCutoffHz = Math.min(lowRaw, highRaw);
  const highCutoffHz = Math.max(lowRaw, highRaw);
  const detectBPM = toBoolean(config.detectBPM, true);
  return { enabled, fftSize, smoothing, lowCutoffHz, highCutoffHz, detectBPM };
}

function createAudioDataInstance(
  nodeId: string,
  config: AudioDataInstance['lastConfig']
): AudioDataInstance | null {
  if (!toneModule) return null;
  const raw: AudioContext | null = (toneModule as any).getContext?.().rawContext ?? null;
  if (!raw) return null;

  const input = new toneModule.Gain({ gain: 1 });
  const output = new toneModule.Gain({ gain: 1 });
  input.connect(output);

  const analyser = raw.createAnalyser();
  analyser.fftSize = config.fftSize;
  analyser.smoothingTimeConstant = config.smoothing;
  try {
    input.connect(analyser as any);
  } catch {
    // ignore
  }

  const instance: AudioDataInstance = {
    nodeId,
    input,
    output,
    analyser,
    timeData: new Float32Array(analyser.fftSize) as unknown as Float32Array<ArrayBuffer>,
    freqData: new Uint8Array(analyser.frequencyBinCount),
    energyHistory: [],
    lastBeatAt: 0,
    beatIntervals: [],
    bpm: 0,
    lastConfig: { ...config },
  };

  audioDataInstances.set(nodeId, instance);
  scheduleGraphWiring();
  return instance;
}

function updateAudioDataInstance(instance: AudioDataInstance, config: AudioDataInstance['lastConfig']): void {
  const prev = instance.lastConfig;
  instance.lastConfig = { ...config };

  if (prev.fftSize !== config.fftSize) {
    try {
      instance.analyser.fftSize = config.fftSize;
      instance.timeData = new Float32Array(instance.analyser.fftSize) as unknown as Float32Array<ArrayBuffer>;
      instance.freqData = new Uint8Array(instance.analyser.frequencyBinCount);
    } catch {
      // ignore
    }
  }

  if (prev.smoothing !== config.smoothing) {
    try {
      instance.analyser.smoothingTimeConstant = config.smoothing;
    } catch {
      // ignore
    }
  }

  if (prev.detectBPM !== config.detectBPM || (!prev.enabled && config.enabled)) {
    instance.energyHistory = [];
    instance.beatIntervals = [];
    instance.lastBeatAt = 0;
    instance.bpm = 0;
  }

  if (!config.enabled) {
    instance.energyHistory = [];
    instance.beatIntervals = [];
    instance.lastBeatAt = 0;
    instance.bpm = 0;
  }
}

function analyzeAudioDataInstance(
  instance: AudioDataInstance,
  nowMs: number
): {
  rms: number;
  peak: number;
  low: number;
  mid: number;
  high: number;
  centroidHz: number;
  bpm: number;
  beat: boolean;
} {
  let rms = 0;
  let peak = 0;

  try {
    instance.analyser.getFloatTimeDomainData(instance.timeData);
    let sumSquares = 0;
    for (let i = 0; i < instance.timeData.length; i += 1) {
      const v = instance.timeData[i] ?? 0;
      sumSquares += v * v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
    rms = instance.timeData.length > 0 ? Math.sqrt(sumSquares / instance.timeData.length) : 0;
  } catch {
    // ignore
  }

  let low = 0;
  let mid = 0;
  let high = 0;
  let centroidHz = 0;

  try {
    instance.analyser.getByteFrequencyData(instance.freqData as any);
    const binCount = instance.freqData.length;
    const sampleRate = instance.analyser.context?.sampleRate ?? 44100;
    const nyquist = sampleRate / 2;
    const binWidth = binCount > 0 ? nyquist / binCount : 0;

    const lowBinEnd = binWidth > 0 ? Math.floor(instance.lastConfig.lowCutoffHz / binWidth) : 0;
    const highBinStart =
      binWidth > 0 ? Math.floor(instance.lastConfig.highCutoffHz / binWidth) : binCount;

    const lowEnd = Math.max(0, Math.min(binCount, lowBinEnd));
    const highStart = Math.max(0, Math.min(binCount, highBinStart));

    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let lowCount = 0;
    let midCount = 0;
    let highCount = 0;

    let weightedSum = 0;
    let totalMag = 0;

    for (let i = 0; i < binCount; i += 1) {
      const mag = (instance.freqData[i] ?? 0) / 255;
      const freq = i * binWidth;
      weightedSum += freq * mag;
      totalMag += mag;

      if (i < lowEnd) {
        lowSum += mag;
        lowCount += 1;
      } else if (i >= highStart) {
        highSum += mag;
        highCount += 1;
      } else {
        midSum += mag;
        midCount += 1;
      }
    }

    low = lowCount > 0 ? lowSum / lowCount : 0;
    mid = midCount > 0 ? midSum / midCount : 0;
    high = highCount > 0 ? highSum / highCount : 0;
    centroidHz = totalMag > 0 ? weightedSum / totalMag : 0;
  } catch {
    // ignore
  }

  let beat = false;
  let bpm = instance.lastConfig.detectBPM ? instance.bpm : 0;

  if (instance.lastConfig.enabled && instance.lastConfig.detectBPM) {
    const windowMs = 1000;
    instance.energyHistory.push({ t: nowMs, e: low });
    while (instance.energyHistory.length > 0 && instance.energyHistory[0]!.t < nowMs - windowMs) {
      instance.energyHistory.shift();
    }

    if (instance.energyHistory.length >= 10) {
      const avg =
        instance.energyHistory.reduce((sum, item) => sum + item.e, 0) / instance.energyHistory.length;
      const variance =
        instance.energyHistory.reduce((sum, item) => sum + (item.e - avg) ** 2, 0) /
        instance.energyHistory.length;
      const std = Math.sqrt(variance);

      const threshold = avg + 1.3 * std;
      const minBeatInterval = 250; // Max 240 BPM.

      if (low > threshold && nowMs - instance.lastBeatAt > minBeatInterval) {
        beat = true;
        const interval = instance.lastBeatAt > 0 ? nowMs - instance.lastBeatAt : 0;
        instance.lastBeatAt = nowMs;

        if (interval > 0 && interval < 2000) {
          instance.beatIntervals.push(interval);
          if (instance.beatIntervals.length > 8) instance.beatIntervals.shift();

          if (instance.beatIntervals.length >= 3) {
            const avgInterval =
              instance.beatIntervals.reduce((sum, v) => sum + v, 0) / instance.beatIntervals.length;
            let nextBpm = Math.round(60000 / avgInterval);
            if (nextBpm < 60) nextBpm *= 2;
            if (nextBpm > 180) nextBpm = Math.round(nextBpm / 2);
            instance.bpm = nextBpm;
          }
        }
      }
    }

    bpm = instance.bpm;
  }

  return { rms, peak, low, mid, high, centroidHz, bpm, beat };
}

export async function enableToneAudio(): Promise<{ enabled: boolean; error?: string } | null> {
  if (typeof window === 'undefined') return null;
  const result = await toneAudioEngine.start();
  if (result.enabled) {
    await ensureTone();
    ensureMasterGain();
    scheduleGraphWiring();
  }
  return { enabled: result.enabled, error: result.error };
}

export function isToneAudioEnabled(): boolean {
  return toneAudioEngine.isEnabled();
}

export function getToneAudioStatus(): { enabled: boolean; loaded: boolean; error?: string } {
  const status = toneAudioEngine.getStatus();
  // Note: toneModule may be lazily imported; rely on ToneAudioEngine as the source of truth.
  return { enabled: status.enabled, loaded: status.loaded, error: status.error ?? undefined };
}

function disposeOscInstance(nodeId: string): void {
  const inst = oscInstances.get(nodeId);
  if (!inst) return;
  disposeLoop(inst);
  try {
    inst.osc?.stop();
  } catch {
    // ignore
  }
  try {
    inst.osc?.dispose();
  } catch {
    // ignore
  }
  try {
    inst.gain?.dispose();
  } catch {
    // ignore
  }
  oscInstances.delete(nodeId);
  maybeStopTransport();
}

function disposeEffectInstance(nodeId: string): void {
  const inst = effectInstances.get(nodeId);
  if (!inst) return;
  try {
    inst.wrapper.dispose();
  } catch {
    // ignore
  }
  effectInstances.delete(nodeId);
  rebuildBusChain(inst.bus);
}

function disposeGranularInstance(nodeId: string): void {
  const inst = granularInstances.get(nodeId);
  if (!inst) return;
  try {
    inst.player?.stop();
  } catch {
    // ignore
  }
  try {
    inst.player?.dispose();
  } catch {
    // ignore
  }
  try {
    inst.gain?.dispose();
  } catch {
    // ignore
  }
  granularInstances.delete(nodeId);
}

function disposePlayerInstance(nodeId: string): void {
  const inst = playerInstances.get(nodeId);
  if (!inst) return;
  try {
    inst.loadController?.abort();
  } catch {
    // ignore
  }
  inst.loadController = null;
  try {
    inst.manualStopPending = true;
    inst.player?.stop();
  } catch {
    inst.manualStopPending = false;
  }
  try {
    inst.player?.dispose();
  } catch {
    // ignore
  }
  try {
    inst.gain?.dispose();
  } catch {
    // ignore
  }
  playerInstances.delete(nodeId);
}

function disposeToneLfoInstance(nodeId: string): void {
  const inst = lfoInstances.get(nodeId);
  if (!inst) return;
  try {
    inst.lfo?.stop();
  } catch {
    // ignore
  }
  try {
    inst.lfo?.dispose();
  } catch {
    // ignore
  }
  lfoInstances.delete(nodeId);
  scheduleGraphWiring();
}

function disposeAudioDataInstance(nodeId: string): void {
  const inst = audioDataInstances.get(nodeId);
  if (!inst) return;
  try {
    inst.output?.disconnect();
  } catch {
    // ignore
  }
  try {
    inst.input?.disconnect();
  } catch {
    // ignore
  }
  try {
    inst.analyser?.disconnect();
  } catch {
    // ignore
  }
  try {
    inst.output?.dispose();
  } catch {
    // ignore
  }
  try {
    inst.input?.dispose();
  } catch {
    // ignore
  }
  audioDataInstances.delete(nodeId);
  scheduleGraphWiring();
}

function disposeNodeById(nodeId: string): void {
  disposeOscInstance(nodeId);
  disposeAudioDataInstance(nodeId);
  disposeEffectInstance(nodeId);
  disposeGranularInstance(nodeId);
  disposePlayerInstance(nodeId);
  disposeToneLfoInstance(nodeId);
}

export function registerToneClientDefinitions(
  registry: NodeRegistry,
  deps: ToneAdapterDeps = {}
): ToneAdapterHandle {
  registry.register({
    type: 'tone-osc',
    label: 'Tone Osc (client)',
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
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
      { key: 'loop', label: 'Loop (pattern)', type: 'string', defaultValue: '' },
    ],
    process: (inputs, config, context: ProcessContext) => {
      const frequency = toNumber(inputs.frequency ?? config.frequency, 440);
      const inputAmplitude = toNumber(inputs.amplitude ?? config.amplitude, 1);
      const enabled =
        inputs.enabled !== undefined && inputs.enabled !== null
          ? toBoolean(inputs.enabled, false)
          : toBoolean(config.enabled, false);
      const amplitude = enabled ? inputAmplitude : 0;
      const waveform = (() => {
        const v = inputs.waveform;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return toString(config.waveform, 'sine');
      })();
      const busName = (() => {
        const v = inputs.bus;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return toString(config.bus, DEFAULT_BUS);
      })();
      const loopPattern = (() => {
        const v = inputs.loop;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return toString(config.loop, '');
      })();
      const loopKey = enabled ? loopKeyOf(loopPattern) : null;

      if (!toneAudioEngine.isEnabled()) {
        return { value: amplitude };
      }

      if (!toneModule) {
        void ensureTone().catch((error) =>
          console.warn('[tone-adapter] Tone.js load failed', error)
        );
        return { value: amplitude };
      }

      let instance = oscInstances.get(context.nodeId);
      const shouldCreate = enabled || Boolean(loopKey);
      if (!instance) {
        if (!shouldCreate) return { value: amplitude };
        instance = createOscInstance(context.nodeId, frequency, amplitude, waveform, busName);
      }

      if (instance.bus !== busName) {
        instance.bus = busName;
        try {
          instance.gain.disconnect();
        } catch {
          // ignore
        }
        const bus = getOrCreateBus(busName);
        instance.gain.connect(bus.input);
        rebuildBusChain(bus.name);
        scheduleGraphWiring();
      }

      if (instance.lastWaveform !== waveform) {
        try {
          instance.osc.type = waveform;
          instance.lastWaveform = waveform;
        } catch {
          // ignore invalid waveform values
        }
      }

      if (instance.lastFrequency === null || Math.abs(instance.lastFrequency - frequency) > 0.001) {
        instance.osc.frequency.rampTo(frequency, DEFAULT_RAMP_SECONDS);
        instance.lastFrequency = frequency;
      }

      if (instance.lastAmplitude === null || Math.abs(instance.lastAmplitude - amplitude) > 0.001) {
        instance.gain.gain.rampTo(amplitude, DEFAULT_RAMP_SECONDS);
        instance.lastAmplitude = amplitude;
      }

      if (loopKey) {
        const defaultsChanged =
          !instance.loopDefaults ||
          Math.abs(instance.loopDefaults.frequency - frequency) > 0.001 ||
          Math.abs(instance.loopDefaults.amplitude - amplitude) > 0.001;

        if (loopKey !== instance.loopKey || defaultsChanged) {
          const parsed = parseLoopPattern(loopPattern, { frequency, amplitude });
          if (parsed) {
            updateLoop(instance, parsed, deps, toNumber((config as any).loopStartAt, NaN));
            instance.loopKey = loopKey;
            instance.loopDefaults = { frequency, amplitude };
          }
        }
      } else if (instance.loop) {
        disposeLoop(instance);
        instance.loopDefaults = null;
        maybeStopTransport();
      }

      return { value: amplitude };
    },
  });

  registry.register({
    type: 'tone-lfo',
    label: 'Tone LFO (client)',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'number', defaultValue: 1 },
      { id: 'frequencyHz', label: 'Freq (Hz)', type: 'number', defaultValue: 1 },
      { id: 'min', label: 'Min', type: 'number', defaultValue: 0 },
      { id: 'max', label: 'Max', type: 'number', defaultValue: 1 },
      { id: 'amplitude', label: 'Depth', type: 'number', defaultValue: 1 },
      { id: 'waveform', label: 'Waveform', type: 'string' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
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
        options: [
          { value: 'sine', label: 'Sine' },
          { value: 'square', label: 'Square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'sawtooth', label: 'Sawtooth' },
        ],
      },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs, config, context) => {
      const scale = toNumber(inputs.in, 1);
      const frequencyHz = Math.max(0, toNumber(inputs.frequencyHz ?? config.frequencyHz, 1));
      const min = toNumber(inputs.min ?? config.min, 0);
      const max = toNumber(inputs.max ?? config.max, 1);
      const depth = clamp(toNumber(inputs.amplitude ?? config.amplitude, 1), 0, 1);
      const waveform = (() => {
        const v = inputs.waveform;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return toString(config.waveform, 'sine');
      })();
      const enabled =
        inputs.enabled !== undefined && inputs.enabled !== null
          ? toBoolean(inputs.enabled, true)
          : toBoolean(config.enabled, true);

      const scaledMin = min * scale;
      const scaledMax = max * scale;

      if (!enabled) {
        if (lfoInstances.has(context.nodeId)) disposeToneLfoInstance(context.nodeId);
        return { value: scaledMin };
      }

      const phase = (context.time / 1000) * frequencyHz * 2 * Math.PI;

      let normalized: number;
      switch (waveform) {
        case 'sine':
          normalized = (Math.sin(phase) + 1) / 2;
          break;
        case 'square':
          normalized = Math.sin(phase) >= 0 ? 1 : 0;
          break;
        case 'triangle':
          normalized = Math.abs((((context.time / 1000) * frequencyHz * 2) % 2) - 1);
          break;
        case 'sawtooth':
          normalized = ((context.time / 1000) * frequencyHz) % 1;
          break;
        default:
          normalized = (Math.sin(phase) + 1) / 2;
      }

      const centered = 0.5 + (normalized - 0.5) * depth;
      const value = scaledMin + centered * (scaledMax - scaledMin);

      if (!toneAudioEngine.isEnabled()) {
        return { value };
      }

      if (!toneModule) {
        void ensureTone().catch((error) =>
          console.warn('[tone-adapter] Tone.js load failed', error)
        );
        return { value };
      }

      const hasTargets = latestToneLfoConnections.some(
        (conn) => conn.sourceNodeId === context.nodeId
      );
      if (!hasTargets) {
        if (lfoInstances.has(context.nodeId)) disposeToneLfoInstance(context.nodeId);
        return { value };
      }

      const params = {
        frequencyHz,
        min: scaledMin,
        max: scaledMax,
        amplitude: depth,
        waveform,
        enabled: true,
      };
      const instance = lfoInstances.get(context.nodeId);
      if (!instance) {
        createToneLfoInstance(context.nodeId, {
          frequencyHz,
          min: scaledMin,
          max: scaledMax,
          amplitude: depth,
          waveform,
        });
      } else {
        updateToneLfoInstance(instance, params);
      }

      return { value };
    },
  });

  registry.register({
    type: 'audio-data',
    label: 'Audio Data (client)',
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
      {
        key: 'smoothing',
        label: 'Smoothing',
        type: 'number',
        defaultValue: 0.2,
        min: 0,
        max: 0.99,
        step: 0.01,
      },
      {
        key: 'lowCutoffHz',
        label: 'Low Cutoff (Hz)',
        type: 'number',
        defaultValue: 300,
        min: 20,
        max: 20000,
        step: 10,
      },
      {
        key: 'highCutoffHz',
        label: 'High Cutoff (Hz)',
        type: 'number',
        defaultValue: 3000,
        min: 20,
        max: 20000,
        step: 10,
      },
      { key: 'detectBPM', label: 'Detect BPM', type: 'boolean', defaultValue: true },
    ],
    process: (_inputs, config, context) => {
      const empty = {
        out: 0,
        rms: 0,
        peak: 0,
        low: 0,
        mid: 0,
        high: 0,
        centroidHz: 0,
        bpm: 0,
        beat: false,
      };

      if (!toneAudioEngine.isEnabled()) {
        if (audioDataInstances.has(context.nodeId)) disposeAudioDataInstance(context.nodeId);
        return empty;
      }

      if (!toneModule) {
        void ensureTone().catch((error) => console.warn('[tone-adapter] Tone.js load failed', error));
        return empty;
      }

      const hasAudioConnections = latestAudioConnections.some(
        (conn) => conn.sourceNodeId === context.nodeId || conn.targetNodeId === context.nodeId
      );
      if (!hasAudioConnections) {
        if (audioDataInstances.has(context.nodeId)) disposeAudioDataInstance(context.nodeId);
        return empty;
      }

      const nextConfig = normalizeAudioDataConfig(config as Record<string, unknown>);
      let instance = audioDataInstances.get(context.nodeId) ?? null;
      if (!instance) {
        instance = createAudioDataInstance(context.nodeId, nextConfig);
      } else {
        updateAudioDataInstance(instance, nextConfig);
      }

      if (!instance || !nextConfig.enabled) return empty;

      const analyzed = analyzeAudioDataInstance(instance, context.time);
      return { ...empty, ...analyzed };
    },
  });

  const effectProcess = (
    kind: ToneEffectKind,
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ProcessContext,
    defaults: Record<string, number>
  ): Record<string, unknown> => {
    const inputValue = toNumber(inputs.in, 0);
    const busName = (() => {
      const v = inputs.bus;
      if (typeof v === 'string' && v.trim()) return v.trim();
      return toString(config.bus, DEFAULT_BUS);
    })();
    const order = Math.floor(toNumber(inputs.order ?? config.order, defaults.order ?? 0));
    const enabled =
      inputs.enabled !== undefined && inputs.enabled !== null
        ? toBoolean(inputs.enabled, true)
        : toBoolean(config.enabled, true);

    const params: Record<string, number> = { ...defaults };
    Object.keys(defaults).forEach((key) => {
      if (key === 'order') return;
      const fromInput = inputs[key];
      const fromConfig = config[key];
      params[key] = toNumber(fromInput ?? fromConfig, defaults[key]);
    });

    if (!toneAudioEngine.isEnabled()) return { out: inputValue };

    if (!toneModule) {
      void ensureTone().catch((error) => console.warn('[tone-adapter] Tone.js load failed', error));
      return { out: inputValue };
    }

    let instance = effectInstances.get(context.nodeId);
    if (!instance) {
      instance = createEffectInstance(kind, params, busName, order, enabled, context.nodeId);
    } else {
      updateEffectInstance(instance, params, busName, order, enabled);
    }

    return { out: inputValue };
  };

  registry.register({
    type: 'tone-delay',
    label: 'Tone Delay (client)',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'audio', kind: 'sink' },
      { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25, min: MIN_TONE_DELAY_TIME_SECONDS },
      { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35, min: 0, max: 1 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3, min: 0, max: 1 },
      { id: 'bus', label: 'Bus', type: 'string' },
      { id: 'order', label: 'Order', type: 'number' },
      { id: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25, min: MIN_TONE_DELAY_TIME_SECONDS },
      { key: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35, min: 0, max: 1 },
      { key: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3, min: 0, max: 1 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 10 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (inputs, config, context) =>
      effectProcess('tone-delay', inputs, config, context, {
        time: 0.25,
        feedback: 0.35,
        wet: 0.3,
        order: 10,
      }),
  });

  registry.register({
    type: 'tone-resonator',
    label: 'Tone Resonator (client)',
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
    process: (inputs, config, context) =>
      effectProcess('tone-resonator', inputs, config, context, {
        delayTime: 0.08,
        resonance: 0.6,
        dampening: 3000,
        wet: 0.4,
        order: 20,
      }),
  });

  registry.register({
    type: 'tone-pitch',
    label: 'Tone Pitch (client)',
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
    process: (inputs, config, context) =>
      effectProcess('tone-pitch', inputs, config, context, {
        pitch: 0,
        windowSize: 0.1,
        delayTime: 0,
        feedback: 0,
        wet: 0.3,
        order: 30,
      }),
  });

  registry.register({
    type: 'tone-reverb',
    label: 'Tone Reverb (client)',
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
    process: (inputs, config, context) =>
      effectProcess('tone-reverb', inputs, config, context, {
        decay: 1.6,
        preDelay: 0.01,
        wet: 0.3,
        order: 40,
      }),
  });

  registry.register({
    type: 'tone-granular',
    label: 'Tone Granular (client)',
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
    process: (inputs, config, context) => {
      const playbackRate = toNumber(inputs.playbackRate ?? config.playbackRate, 1);
      const detune = toNumber(inputs.detune ?? config.detune, 0);
      const grainSize = toNumber(inputs.grainSize ?? config.grainSize, 0.2);
      const overlap = toNumber(inputs.overlap ?? config.overlap, 0.1);
      const volume = toNumber(inputs.volume ?? config.volume, 0.6);
      const urlRaw = toString(inputs.url ?? config.url, '');
      const url = deps.resolveAssetRef ? deps.resolveAssetRef(urlRaw) : urlRaw;
      const loop =
        inputs.loop !== undefined && inputs.loop !== null
          ? toBoolean(inputs.loop, true)
          : toBoolean(config.loop, true);
      const gate = toNumber(inputs.gate, 0);
      const enabledConfig = toBoolean(config.enabled, false);
      const enabledInput =
        inputs.enabled !== undefined && inputs.enabled !== null
          ? toBoolean(inputs.enabled, enabledConfig)
          : enabledConfig;
      const enabled = enabledInput || gate > 0;
      const busName = (() => {
        const v = inputs.bus;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return toString(config.bus, DEFAULT_BUS);
      })();

      if (!toneAudioEngine.isEnabled()) {
        return { value: volume };
      }

      if (!toneModule) {
        void ensureTone().catch((error) =>
          console.warn('[tone-adapter] Tone.js load failed', error)
        );
        return { value: volume };
      }

      let instance = granularInstances.get(context.nodeId);
      const params = {
        playbackRate,
        detune,
        grainSize,
        overlap,
        volume,
        loop,
        enabled,
      };

      const shouldCreate = enabled && url !== '';
      if (!instance) {
        if (!shouldCreate) return { value: volume };
        instance = createGranularInstance(context.nodeId, url, busName, params);
      }

      if (instance.lastUrl !== url && url) {
        disposeGranularInstance(context.nodeId);
        instance = createGranularInstance(context.nodeId, url, busName, params);
      }

      if (instance.bus !== busName) {
        instance.bus = busName;
        try {
          instance.gain.disconnect();
        } catch {
          // ignore
        }
        const bus = getOrCreateBus(busName);
        instance.gain.connect(bus.input);
        rebuildBusChain(bus.name);
        scheduleGraphWiring();
      }

      if (instance.lastParams.playbackRate !== playbackRate)
        instance.player.playbackRate = playbackRate;
      if (instance.lastParams.detune !== detune) instance.player.detune = detune;
      if (instance.lastParams.grainSize !== grainSize) instance.player.grainSize = grainSize;
      if (instance.lastParams.overlap !== overlap) instance.player.overlap = overlap;
      if (instance.lastParams.loop !== loop) instance.player.loop = loop;
      if (instance.lastParams.volume !== volume)
        instance.gain.gain.rampTo(volume, DEFAULT_RAMP_SECONDS);

      if (instance.enabled !== enabled) {
        instance.enabled = enabled;
        if (enabled) {
          try {
            instance.player.start();
          } catch {
            // ignore
          }
        } else {
          try {
            instance.player.stop();
          } catch {
            // ignore
          }
        }
      }

      instance.lastParams = { ...instance.lastParams, ...params };
      instance.lastUrl = url || instance.lastUrl;

      return { value: volume };
    },
  });

  const registerLoadAudioNode = (opts: {
    type: string;
    label: string;
    inputs: {
      id: string;
      label: string;
      type: string;
      defaultValue?: unknown;
      min?: number;
      max?: number;
      step?: number;
    }[];
    configSchema: {
      key: string;
      label: string;
      type: string;
      defaultValue?: unknown;
      assetKind?: string;
      min?: number;
      max?: number;
      step?: number;
    }[];
    resolveBaseUrlRaw: (inputs: Record<string, unknown>, config: Record<string, unknown>) => string;
    sensorNodeType: string;
  }) => {
    registry.register({
      type: opts.type,
      label: opts.label,
      category: 'Assets',
      inputs: opts.inputs as any,
      outputs: [
        { id: 'ref', label: 'Audio Out', type: 'audio', kind: 'sink' },
        { id: 'ended', label: 'Finish', type: 'boolean' },
      ],
      configSchema: opts.configSchema as any,
      process: (inputs, config, context) => {
        const baseUrlRaw = opts.resolveBaseUrlRaw(inputs, config);
        const url = deps.resolveAssetRef ? deps.resolveAssetRef(baseUrlRaw) : baseUrlRaw;

        const playbackRate = toNonNegativeNumber(inputs.playbackRate ?? config.playbackRate, 1);
        const detune = toNumber(inputs.detune ?? config.detune, 0);
        const volume = toAssetVolumeGain(inputs.volume ?? config.volume);
        const loop = toBoolean(inputs.loop, false);
        const enabled = toBoolean(inputs.play, true);
        const reverse = toBoolean(inputs.reverse, false);

        const cursorRequestedRaw = toNumber(inputs.cursorSec, -1);
        const cursorRequested =
          typeof cursorRequestedRaw === 'number' &&
          Number.isFinite(cursorRequestedRaw) &&
          cursorRequestedRaw >= 0
            ? cursorRequestedRaw
            : null;
        const busName = (() => {
          const v = inputs.bus;
          if (typeof v === 'string' && v.trim()) return v.trim();
          return toString(config.bus, DEFAULT_BUS);
        })();

        const outValue = baseUrlRaw ? (enabled ? 1 : 0) : 0;

        if (!toneAudioEngine.isEnabled()) {
          return { ref: outValue, ended: false };
        }

        if (!toneModule) {
          void ensureTone().catch((error) =>
            console.warn('[tone-adapter] Tone.js load failed', error)
          );
          return { ref: outValue, ended: false };
        }

        if (!url) {
          disposePlayerInstance(context.nodeId);
          return { ref: outValue, ended: false };
        }

        let instance = playerInstances.get(context.nodeId);
        const params = {
          playbackRate,
          detune,
          volume,
          loop,
          enabled,
        };

        if (!instance) {
          instance = createPlayerInstance(context.nodeId, busName, params);
        }

        if (instance.lastUrl !== url && url) {
          const wasStarted = instance.started;
          instance.lastUrl = url;
          instance.loadedUrl = null;
          instance.failedUrl = null;
          instance.autostarted = false;
          instance.started = false;
          instance.startedAt = 0;
          instance.startOffsetSec = 0;
          instance.startDurationSec = null;
          instance.pausedOffsetSec = null;
          instance.lastClip = null;
          instance.lastCursorSec = null;
          instance.ended = false;
          instance.endedReported = false;
          instance.manualStopPending = false;
          try {
            instance.loadController?.abort();
          } catch {
            // ignore
          }
          instance.loadController = null;
          instance.loadingUrl = null;
          try {
            if (wasStarted) instance.manualStopPending = true;
            instance.player.stop();
          } catch {
            instance.manualStopPending = false;
          }
        }

        requestTonePlayerLoad(instance);

        if (instance.bus !== busName) {
          instance.bus = busName;
          try {
            instance.gain.disconnect();
          } catch {
            // ignore
          }
          const bus = getOrCreateBus(busName);
          instance.gain.connect(bus.input);
          rebuildBusChain(bus.name);
          scheduleGraphWiring();
        }

        if (instance.lastParams.playbackRate !== playbackRate)
          instance.player.playbackRate = playbackRate;
        if (instance.lastParams.detune !== detune) instance.player.detune = detune;
        if (instance.lastParams.loop !== loop) instance.player.loop = loop;
        if (instance.lastParams.volume !== volume)
          instance.gain.gain.rampTo(volume, DEFAULT_RAMP_SECONDS);

        const clipStartRaw = Math.max(0, toNumber(inputs.startSec, 0));
        const clipEndRaw = toNumber(inputs.endSec, -1);
        const clipEndCandidate =
          Number.isFinite(clipEndRaw) && clipEndRaw >= 0 ? Math.max(clipStartRaw, clipEndRaw) : -1;

        const bufferDuration = (() => {
          try {
            const dur = instance.player?.buffer?.duration;
            return typeof dur === 'number' && Number.isFinite(dur) && dur > 0 ? dur : null;
          } catch {
            return null;
          }
        })();

        const nowToneSec = toneModule!.now();

        const playbackPositionSec = (opts: {
          clipStart: number;
          resolvedClipEnd: number | null;
          loop: boolean;
          reverse: boolean;
        }): number | null => {
          if (!instance.started) return null;
          const elapsed = instance.startedAt > 0 ? Math.max(0, nowToneSec - instance.startedAt) : 0;
          const direction = opts.reverse ? -1 : 1;
          const rawPos = instance.startOffsetSec + direction * elapsed * playbackRate;
          let position = rawPos;
          const duration =
            opts.resolvedClipEnd !== null ? Math.max(0, opts.resolvedClipEnd - opts.clipStart) : null;
          if (opts.loop && duration !== null && duration > 0 && opts.resolvedClipEnd !== null) {
            if (opts.reverse) {
              const rel = opts.resolvedClipEnd - rawPos;
              const wrapped = ((rel % duration) + duration) % duration;
              position = opts.resolvedClipEnd - wrapped;
            } else {
              const rel = rawPos - opts.clipStart;
              const wrapped = ((rel % duration) + duration) % duration;
              position = opts.clipStart + wrapped;
            }
          } else if (opts.resolvedClipEnd !== null) {
            position = clamp(position, opts.clipStart, opts.resolvedClipEnd);
          } else {
            position = Math.max(opts.clipStart, position);
          }
          return position;
        };

        const activeClip = instance.lastClip;
        const activeResolvedClipEnd =
          activeClip && activeClip.endSec >= 0
            ? activeClip.endSec
            : activeClip && bufferDuration !== null
              ? bufferDuration
              : null;
        const activePlaybackPosSec = activeClip
          ? playbackPositionSec({
              clipStart: activeClip.startSec,
              resolvedClipEnd: activeResolvedClipEnd,
              loop: activeClip.loop,
              reverse: activeClip.reverse,
            })
          : null;

        let clipStart =
          bufferDuration !== null ? clamp(clipStartRaw, 0, bufferDuration) : clipStartRaw;
        let clipEnd =
          clipEndCandidate >= 0
            ? bufferDuration !== null
              ? clamp(clipEndCandidate, clipStart, bufferDuration)
              : Math.max(clipStart, clipEndCandidate)
            : -1;

        if (clipEnd >= 0 && clipEnd < clipStart) clipEnd = clipStart;

        const resolvedClipEnd =
          clipEnd >= 0 ? clipEnd : bufferDuration !== null ? bufferDuration : null;
        const resolvedClipDuration =
          resolvedClipEnd !== null ? Math.max(0, resolvedClipEnd - clipStart) : null;

        const nextClip = { startSec: clipStart, endSec: clipEnd, loop, reverse };
        const clipChanged =
          !instance.lastClip ||
          instance.lastClip.startSec !== nextClip.startSec ||
          instance.lastClip.endSec !== nextClip.endSec ||
          instance.lastClip.loop !== nextClip.loop ||
          instance.lastClip.reverse !== nextClip.reverse;

        if (clipChanged) {
          instance.ended = false;
          instance.endedReported = false;
        }

        const cursorClamped = (() => {
          if (cursorRequested === null) return null;
          const base = Math.max(clipStart, cursorRequested);
          if (resolvedClipEnd !== null) return Math.min(resolvedClipEnd, base);
          return base;
        })();

        const canApplyReverse = !reverse || bufferDuration !== null;
        const canApplyLoopEnd = resolvedClipEnd !== null;
        const canStartNow = !instance.loading && canApplyReverse && (!loop || canApplyLoopEnd);

        const applyClipToPlayer = () => {
          try {
            if (instance.lastParams.reverse !== reverse) instance.player.reverse = reverse;
          } catch {
            // ignore
          }
          try {
            instance.player.loop = loop;
          } catch {
            // ignore
          }

          if (reverse) {
            if (bufferDuration === null) return;
            const endForMap = resolvedClipEnd ?? bufferDuration;
            const loopStart = clamp(bufferDuration - endForMap, 0, bufferDuration);
            const loopEnd = clamp(bufferDuration - clipStart, loopStart, bufferDuration);
            try {
              instance.player.loopStart = loopStart;
            } catch {
              // ignore
            }
            try {
              instance.player.loopEnd = loopEnd;
            } catch {
              // ignore
            }
            return;
          }

          try {
            instance.player.loopStart = clipStart;
          } catch {
            // ignore
          }
          if (resolvedClipEnd !== null) {
            try {
              instance.player.loopEnd = resolvedClipEnd;
            } catch {
              // ignore
            }
          }
        };

        if (!instance.loading) applyClipToPlayer();

        const stopAndMaybePause = () => {
          if (!instance.started) return;
          const now = toneModule!.now();
          const elapsed = instance.startedAt > 0 ? Math.max(0, now - instance.startedAt) : 0;
          const activeReverse = instance.lastClip?.reverse ?? reverse;
          const direction = activeReverse ? -1 : 1;
          const rawPos = instance.startOffsetSec + direction * elapsed * playbackRate;
          let pausedOffset = rawPos;
          if (loop && resolvedClipDuration && resolvedClipDuration > 0 && resolvedClipEnd !== null) {
            if (activeReverse) {
              const rel = resolvedClipEnd - rawPos;
              const wrapped =
                ((rel % resolvedClipDuration) + resolvedClipDuration) % resolvedClipDuration;
              pausedOffset = resolvedClipEnd - wrapped;
            } else {
              const rel = rawPos - clipStart;
              const wrapped =
                ((rel % resolvedClipDuration) + resolvedClipDuration) % resolvedClipDuration;
              pausedOffset = clipStart + wrapped;
            }
          } else if (resolvedClipEnd !== null) {
            pausedOffset = clamp(pausedOffset, clipStart, resolvedClipEnd);
          } else {
            pausedOffset = Math.max(clipStart, pausedOffset);
          }

          instance.pausedOffsetSec = pausedOffset;
          try {
            instance.manualStopPending = true;
            instance.player.stop();
          } catch {
            instance.manualStopPending = false;
          }
          instance.started = false;
          instance.startedAt = 0;
          instance.startOffsetSec = 0;
          instance.startDurationSec = null;
        };

        const segmentStart = reverse ? (resolvedClipEnd ?? clipStart) : clipStart;

        const startFromPosition = (pos: number, reason: string) => {
          if (!canStartNow) return;
          const wasStarted = instance.started;
          instance.ended = false;
          instance.endedReported = false;
          applyClipToPlayer();
          const nextPos =
            resolvedClipEnd !== null
              ? clamp(Math.max(0, pos), clipStart, resolvedClipEnd)
              : Math.max(clipStart, pos);
          const nearEdge = 0.002;
          const noRange =
            !loop &&
            resolvedClipEnd !== null &&
            (resolvedClipDuration !== null && resolvedClipDuration <= nearEdge
              ? true
              : reverse
                ? nextPos <= clipStart + nearEdge
                : nextPos >= resolvedClipEnd - nearEdge);
          if (noRange) {
            try {
              instance.manualStopPending = false;
              if (instance.started) instance.manualStopPending = true;
              instance.player.stop();
            } catch {
              instance.manualStopPending = false;
            }
            instance.started = false;
            instance.startedAt = 0;
            instance.startOffsetSec = 0;
            instance.startDurationSec = null;
            instance.pausedOffsetSec = nextPos;
            return;
          }

          const offset = reverse ? bufferDuration! - nextPos : nextPos;

          try {
            if (instance.started) {
              instance.manualStopPending = true;
              instance.player.stop();
            }
          } catch {
            instance.manualStopPending = false;
          }

          try {
            instance.player.start(undefined, offset);
            instance.started = true;
            instance.startedAt = toneModule!.now();
            instance.startOffsetSec = nextPos;
            instance.startDurationSec = null;
            instance.pausedOffsetSec = null;

            if (!wasStarted && deps.sdk) {
              try {
                deps.sdk.sendSensorData(
                  'custom',
                  {
                    kind: 'node-media',
                    event: 'started',
                    nodeId: context.nodeId,
                    nodeType: opts.sensorNodeType,
                  } as any,
                  { trackLatest: false }
                );
              } catch {
                // ignore
              }
            }
          } catch (err) {
            console.warn('[tone-adapter] player start failed', { reason }, err);
          }
        };

        const cursorChanged =
          cursorClamped !== null &&
          (instance.lastCursorSec === null ||
            Math.abs(cursorClamped - instance.lastCursorSec) > 0.005);

        if (!enabled) {
          stopAndMaybePause();
          instance.ended = false;
          instance.endedReported = false;
          if (cursorClamped !== null) instance.pausedOffsetSec = cursorClamped;
        } else {
          if (clipChanged && instance.started) {
            // Switching reverse while playing should keep the current position when possible.
            if (instance.lastClip && instance.lastClip.reverse !== reverse) {
              stopAndMaybePause();
              const resume = instance.pausedOffsetSec ?? segmentStart;
              instance.pausedOffsetSec = null;
              startFromPosition(resume, 'reverse-change');
            } else {
              instance.pausedOffsetSec = null;
              if (activePlaybackPosSec !== null) {
                if (activePlaybackPosSec < clipStart) {
                  startFromPosition(clipStart, 'clip-range');
                } else if (resolvedClipEnd !== null && activePlaybackPosSec > resolvedClipEnd) {
                  if (loop) startFromPosition(segmentStart, 'clip-range');
                } else {
                  instance.startOffsetSec = activePlaybackPosSec;
                  instance.startedAt = nowToneSec;
                }
              }
            }
          } else if (cursorChanged) {
            instance.pausedOffsetSec = null;
            startFromPosition(cursorClamped ?? segmentStart, 'seek');
          } else if (!instance.started && !instance.loading) {
            if (instance.ended) {
              instance.lastClip = nextClip;
              instance.lastParams = { ...instance.lastParams, ...params, reverse };
              instance.lastCursorSec = cursorClamped;
              instance.enabled = enabled;
              return { ref: outValue, ended: true };
            }
            const resumeOffsetRaw = instance.pausedOffsetSec ?? cursorClamped ?? segmentStart;
            // When resuming from a stopped state, `pausedOffsetSec` may be clamped to the range edge (e.g. End).
            // Starting exactly at the edge results in an immediate stop, which feels like "Play doesn't work".
            const resumeOffset = (() => {
              if (loop || resolvedClipEnd === null) return resumeOffsetRaw;
              const nearEdge = 0.002;
              if (reverse) {
                return resumeOffsetRaw <= clipStart + nearEdge ? segmentStart : resumeOffsetRaw;
              }
              return resumeOffsetRaw >= resolvedClipEnd - nearEdge ? segmentStart : resumeOffsetRaw;
            })();
            const resumeReason =
              instance.pausedOffsetSec !== null
                ? 'resume'
                : cursorClamped !== null
                  ? 'seek-start'
                  : 'start';
            startFromPosition(resumeOffset, resumeReason);
          }
        }

        instance.enabled = enabled;
        instance.lastClip = nextClip;
        instance.lastParams = { ...instance.lastParams, ...params, reverse };
        instance.lastCursorSec = cursorClamped;

        // Fallback: if Tone reports the player stopped but we missed the `onstop` callback,
        // treat it as a finish when Play is still enabled.
        if (enabled && instance.started && !loop && !instance.ended && !instance.manualStopPending) {
          const playerStopped = (() => {
            try {
              return String(instance.player?.state ?? '') === 'stopped';
            } catch {
              return false;
            }
          })();

          if (playerStopped) {
            const fallbackEndPos =
              reverse ? clipStart : resolvedClipEnd ?? bufferDuration ?? instance.pausedOffsetSec;
            if (typeof fallbackEndPos === 'number' && Number.isFinite(fallbackEndPos)) {
              instance.pausedOffsetSec = Math.max(0, fallbackEndPos);
            }
            instance.ended = true;
            instance.started = false;
            instance.startedAt = 0;
            instance.startOffsetSec = 0;
            instance.startDurationSec = null;
          }
        }

        if (
          enabled &&
          instance.started &&
          !loop &&
          resolvedClipEnd !== null &&
          !instance.manualStopPending
        ) {
          const nowPos = playbackPositionSec({
            clipStart,
            resolvedClipEnd,
            loop: false,
            reverse,
          });
          if (nowPos !== null) {
            const nearEdge = 0.002;
            const reachedEnd = reverse
              ? nowPos <= clipStart + nearEdge
              : nowPos >= resolvedClipEnd - nearEdge;
            if (reachedEnd) {
              instance.pausedOffsetSec = reverse ? clipStart : resolvedClipEnd;
              instance.ended = true;
              try {
                instance.player.stop();
              } catch {
                // ignore
              }
              instance.started = false;
              instance.startedAt = 0;
              instance.startOffsetSec = 0;
              instance.startDurationSec = null;
            }
          }
        }

        if (enabled && !loop && instance.ended && !instance.endedReported && deps.sdk) {
          try {
            deps.sdk.sendSensorData(
              'custom',
              {
                kind: 'node-media',
                event: 'ended',
                nodeId: context.nodeId,
                nodeType: opts.sensorNodeType,
              } as any,
              { trackLatest: false }
            );
            instance.endedReported = true;
          } catch {
            // ignore
          }
        }

        return { ref: outValue, ended: instance.ended };
      },
    });
  };

  registerLoadAudioNode({
    type: 'load-audio-from-assets',
    label: 'Load Audio From Remote (client)',
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
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { id: 'bus', label: 'Bus', type: 'string' },
    ],
    configSchema: [
      {
        key: 'assetId',
        label: 'Audio Asset',
        type: 'asset-picker',
        assetKind: 'audio',
        defaultValue: '',
      },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
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
    resolveBaseUrlRaw: (_inputs, config) => {
      const assetRaw = toString((config as any).assetId, '');
      const trimmed = assetRaw.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('asset:') || trimmed.startsWith('shugu://asset/')) return trimmed;
      return `asset:${trimmed}`;
    },
    sensorNodeType: 'load-audio-from-assets',
  });

  registerLoadAudioNode({
    type: 'load-audio-from-local',
    label: 'Load Audio From Local(Display only) (client)',
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
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0, min: -1, max: 100, step: 0.01 },
      { id: 'bus', label: 'Bus', type: 'string' },
    ],
    configSchema: [
      {
        key: 'assetPath',
        label: 'Audio Asset',
        type: 'local-asset-picker',
        assetKind: 'audio',
        defaultValue: '',
      },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1, min: 0 },
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
    resolveBaseUrlRaw: (inputs, config) => {
      const fromInput = toString((inputs as any).asset, '').trim();
      const raw = fromInput || toString((config as any).assetPath, '').trim();
      return raw ? normalizeLocalMediaRef(raw, 'audio') : '';
    },
    sensorNodeType: 'load-audio-from-local',
  });

  const overrideVideoFinishOutput = (type: 'load-video-from-assets' | 'load-video-from-local') => {
    const base = registry.get(type);
    if (!base) return;
    registry.register({
      ...base,
      outputs: base.outputs.map((port) =>
        port.id === 'ended' ? { ...port, label: 'Finish' } : port
      ),
      process: (inputs, config, context) => {
        const baseOut = base.process(inputs, config, context) as Record<string, unknown>;
        const nodeId = context.nodeId;
        const now = Date.now();
        pruneVideoFinishStates(now);

        const signature = videoFinishSignatureFromRef(baseOut?.ref);
        if (!signature) {
          videoFinishStates.delete(nodeId);
          // Drain any pending finish pulses so stale ends don't apply after reloads.
          consumeNodeMediaFinishPulse(nodeId);
          return { ...baseOut, ended: false };
        }

        const existing = videoFinishStates.get(nodeId) ?? {
          signature: '',
          lastPlay: false,
          finished: false,
          updatedAt: now,
        };

        const playActive = toBoolean((inputs as any).play, true);
        const playRising = playActive && !existing.lastPlay;

        const finished = (() => {
          if (signature !== existing.signature) return false;
          if (!playActive || playRising) return false;
          if (consumeNodeMediaFinishPulse(nodeId)) return true;
          return existing.finished;
        })();

        videoFinishStates.set(nodeId, {
          signature,
          lastPlay: playActive,
          finished,
          updatedAt: now,
        });

        return { ...baseOut, ended: finished };
      },
    });
  };

  overrideVideoFinishOutput('load-video-from-assets');
  overrideVideoFinishOutput('load-video-from-local');

  const handle: ToneAdapterHandle = {
    disposeNode: (nodeId: string) => {
      disposeNodeById(nodeId);
    },
    disposeAll: () => {
      for (const nodeId of Array.from(oscInstances.keys())) disposeOscInstance(nodeId);
      for (const nodeId of Array.from(audioDataInstances.keys())) disposeAudioDataInstance(nodeId);
      for (const nodeId of Array.from(effectInstances.keys())) disposeEffectInstance(nodeId);
      for (const nodeId of Array.from(granularInstances.keys())) disposeGranularInstance(nodeId);
      for (const nodeId of Array.from(playerInstances.keys())) disposePlayerInstance(nodeId);
      for (const nodeId of Array.from(lfoInstances.keys())) disposeToneLfoInstance(nodeId);
      for (const bus of buses.values()) {
        try {
          bus.input.disconnect();
        } catch {
          // ignore
        }
        try {
          bus.input.dispose();
        } catch {
          // ignore
        }
      }
      buses.clear();
      latestGraphNodesById = new Map();
      latestAudioConnections = [];
      latestExplicitNodeIds = new Set();
      latestExplicitEffectIds = new Set();
      latestToneLfoConnections = [];
      latestToneLfoDesiredTargets = new Set();
      latestToneLfoActiveTargets = new Set();
      maybeStopTransport();
    },
    syncActiveNodes: (
      activeNodeIds: Set<string>,
      nodes: NodeInstance[],
      connections: Connection[]
    ) => {
      updateAudioGraphSnapshot(registry, nodes ?? [], connections ?? []);

      // Best-effort: reset per-node video Finish state on each deploy.
      const now = Date.now();
      pruneVideoFinishStates(now);
      const activeVideoNodeIds = new Set(
        (nodes ?? [])
          .filter(
            (node) =>
              node.type === 'load-video-from-assets' || node.type === 'load-video-from-local'
          )
          .map((node) => node.id)
      );
      for (const nodeId of Array.from(videoFinishStates.keys())) {
        if (!activeVideoNodeIds.has(nodeId)) videoFinishStates.delete(nodeId);
      }
      for (const nodeId of activeVideoNodeIds) {
        consumeNodeMediaFinishPulse(nodeId);
        videoFinishStates.set(nodeId, {
          signature: '',
          lastPlay: false,
          finished: false,
          updatedAt: now,
        });
      }

      for (const nodeId of Array.from(oscInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeOscInstance(nodeId);
      }
      for (const nodeId of Array.from(audioDataInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeAudioDataInstance(nodeId);
      }
      for (const nodeId of Array.from(effectInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeEffectInstance(nodeId);
      }
      for (const nodeId of Array.from(granularInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeGranularInstance(nodeId);
      }
      for (const nodeId of Array.from(playerInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposePlayerInstance(nodeId);
      }
      for (const nodeId of Array.from(lfoInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeToneLfoInstance(nodeId);
      }

      scheduleGraphWiring();
    },
  };

  return handle;
}

export type { ToneAdapterDeps, ToneAdapterHandle };
