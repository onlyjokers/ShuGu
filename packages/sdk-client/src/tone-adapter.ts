/**
 * Purpose: Tone.js-backed audio runtime for node graph (oscillator + effects + granular).
 */
import type { Connection, NodeInstance, NodeRegistry, ProcessContext } from '@shugu/node-core';
import type { ClientSDK } from './client-sdk.js';
import { toneAudioEngine } from '@shugu/multimedia-core';

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
  setWet?: (value: number) => void;
  dispose: () => void;
};

type ToneEffectKind = 'tone-delay' | 'tone-reverb' | 'tone-pitch' | 'tone-resonator';
type ToneNodeKind = ToneEffectKind | 'tone-osc' | 'tone-granular' | 'tone-player';

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
  lastUrl: string | null;
  lastClip: { startSec: number; endSec: number; loop: boolean; reverse: boolean } | null;
  lastCursorSec: number | null;
  lastParams: Record<string, number | string | boolean | null>;
};

const DEFAULT_RAMP_SECONDS = 0.05;
const DEFAULT_STEP_SECONDS = 0.25;
const DEFAULT_BUS = 'main';
const AUDIO_NODE_KINDS = new Set<ToneNodeKind>([
  'tone-osc',
  'tone-delay',
  'tone-resonator',
  'tone-pitch',
  'tone-reverb',
  'tone-granular',
  'tone-player',
]);
const AUDIO_INPUT_PORTS = new Map<ToneNodeKind, string[]>([
  ['tone-delay', ['in']],
  ['tone-resonator', ['in']],
  ['tone-pitch', ['in']],
  ['tone-reverb', ['in']],
]);
const AUDIO_OUTPUT_PORTS = new Map<ToneNodeKind, string[]>([
  ['tone-osc', ['value']],
  ['tone-delay', ['out']],
  ['tone-resonator', ['out']],
  ['tone-pitch', ['out']],
  ['tone-reverb', ['out']],
  ['tone-granular', ['value']],
  ['tone-player', ['value']],
]);

let toneModule: ToneModule | null = null;
let masterGain: any | null = null;
const transportState: TransportStartState = { started: false, scheduledAtMs: null };

const oscInstances = new Map<string, ToneOscInstance>();
const effectInstances = new Map<string, ToneEffectInstance>();
const granularInstances = new Map<string, ToneGranularInstance>();
const playerInstances = new Map<string, TonePlayerInstance>();
const buses = new Map<string, ToneBus>();
let latestGraphNodesById = new Map<string, NodeInstance>();
let latestAudioConnections: Connection[] = [];
let latestExplicitNodeIds = new Set<string>();
let latestExplicitEffectIds = new Set<string>();

function toNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(min)) return value;
  if (!Number.isFinite(max)) return value;
  return Math.max(min, Math.min(max, value));
}

type ToneClipParams = {
  baseUrl: string;
  startSec: number;
  endSec: number;
  loop: boolean | null;
  play: boolean | null;
  reverse: boolean | null;
  cursorSec: number | null;
};

function parseToneClipParams(raw: string): ToneClipParams {
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
    };
  }

  const baseUrl = trimmed.slice(0, hashIndex).trim();
  const hash = trimmed.slice(hashIndex + 1);
  const params = new URLSearchParams(hash);

  const tRaw = params.get('t');
  let startSec = 0;
  let endSec = -1;
  if (tRaw !== null) {
    const parts = tRaw.split(',');
    const startCandidate = parts[0]?.trim() ?? '';
    const endCandidate = parts[1]?.trim() ?? '';
    startSec = toNumber(startCandidate, 0);
    if (parts.length > 1) {
      endSec = endCandidate ? toNumber(endCandidate, -1) : -1;
    }
  }

  const loopRaw = params.get('loop');
  const playRaw = params.get('play');
  const reverseRaw = params.get('rev');
  const cursorRaw = params.get('p');

  return {
    baseUrl,
    startSec: Number.isFinite(startSec) ? startSec : 0,
    endSec: Number.isFinite(endSec) ? endSec : -1,
    loop: loopRaw === null ? null : toBoolean(loopRaw, false),
    play: playRaw === null ? null : toBoolean(playRaw, true),
    reverse: reverseRaw === null ? null : toBoolean(reverseRaw, false),
    cursorSec: cursorRaw === null ? null : toNumber(cursorRaw, -1),
  };
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
  const granular = granularInstances.get(nodeId);
  if (granular?.gain) return granular.gain;
  const player = playerInstances.get(nodeId);
  if (player?.gain) return player.gain;
  const effect = effectInstances.get(nodeId);
  if (effect?.wrapper?.output) return effect.wrapper.output;
  return null;
}

function getAudioInputNode(nodeId: string): any | null {
  const effect = effectInstances.get(nodeId);
  if (effect?.wrapper?.input) return effect.wrapper.input;
  return null;
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
  if (latestAudioConnections.length === 0) return;
  if (!toneModule) return;
  if (!toneAudioEngine.isEnabled()) return;
  applyGraphWiring();
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
    try {
      effect.wrapper.input.disconnect();
    } catch {
      // ignore
    }
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

function parseLoopPattern(raw: unknown, defaults: { frequency: number; amplitude: number }): ParsedLoop | null {
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
  const effect = new toneModule!.FeedbackDelay({ delayTime: time, feedback, wet });
  const setWet = (value: number) => effect.wet.rampTo(value, DEFAULT_RAMP_SECONDS);
  return {
    input: effect,
    output: effect,
    effect,
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
    setWet,
    dispose: () => effect.dispose(),
  };
}

function createResonatorEffect(delayTime: number, resonance: number, dampening: number, wet: number): EffectWrapper {
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
  let wrapper: EffectWrapper;
  switch (kind) {
    case 'tone-delay':
      wrapper = createDelayEffect(params.time, params.feedback, params.wet);
      break;
    case 'tone-reverb':
      wrapper = createReverbEffect(params.decay, params.preDelay, params.wet);
      break;
    case 'tone-pitch':
      wrapper = createPitchEffect(params.pitch, params.windowSize, params.delayTime, params.feedback, params.wet);
      break;
    case 'tone-resonator':
      wrapper = createResonatorEffect(params.delayTime, params.resonance, params.dampening, params.wet);
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
    lastParams: { ...params, bus, order, enabled },
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

  instance.bus = bus;
  instance.order = order;
  instance.enabled = enabled;

  if (bus !== prevBus || order !== prevOrder) {
    rebuildBusChain(prevBus);
    rebuildBusChain(bus);
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
      const time = nextParams.time;
      const feedback = nextParams.feedback;
      const wet = nextParams.wet;
      if (instance.lastParams.time !== time) effect.delayTime.rampTo(time, DEFAULT_RAMP_SECONDS);
      if (instance.lastParams.feedback !== feedback) effect.feedback.rampTo(feedback, DEFAULT_RAMP_SECONDS);
      if (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) applyWet(wet);
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
    case 'tone-reverb': {
      const effect = instance.wrapper.effect;
      const decay = nextParams.decay;
      const preDelay = nextParams.preDelay;
      const wet = nextParams.wet;
      if (instance.lastParams.decay !== decay) effect.decay = decay;
      if (instance.lastParams.preDelay !== preDelay) effect.preDelay = preDelay;
      if (!instance.pendingGenerate &&
        (instance.lastParams.decay !== decay || instance.lastParams.preDelay !== preDelay)) {
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
      if (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) applyWet(wet);
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
    case 'tone-pitch': {
      const effect = instance.wrapper.effect;
      const pitch = nextParams.pitch;
      const windowSize = nextParams.windowSize;
      const delayTime = nextParams.delayTime;
      const feedback = nextParams.feedback;
      const wet = nextParams.wet;
      if (instance.lastParams.pitch !== pitch) effect.pitch = pitch;
      if (instance.lastParams.windowSize !== windowSize) effect.windowSize = windowSize;
      if (instance.lastParams.delayTime !== delayTime) effect.delayTime = delayTime;
      if (instance.lastParams.feedback !== feedback) effect.feedback = feedback;
      if (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) applyWet(wet);
      instance.lastParams = { ...instance.lastParams, ...nextParams, enabled };
      break;
    }
    case 'tone-resonator': {
      const comb = instance.wrapper.effect;
      const delayTime = nextParams.delayTime;
      const resonance = nextParams.resonance;
      const dampening = nextParams.dampening;
      const wet = nextParams.wet;
      if (instance.lastParams.delayTime !== delayTime) comb.delayTime.rampTo(delayTime, DEFAULT_RAMP_SECONDS);
      if (instance.lastParams.resonance !== resonance) comb.resonance = resonance;
      if (instance.lastParams.dampening !== dampening) comb.dampening = dampening;
      if (instance.lastParams.wet !== wet || instance.lastParams.enabled !== enabled) applyWet(wet);
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

function createPlayerInstance(
  nodeId: string,
  url: string,
  busName: string,
  params: Record<string, number | boolean>
): TonePlayerInstance {
  const bus = getOrCreateBus(busName);
  const gain = new toneModule!.Gain({ gain: params.volume as number });
  const player = new toneModule!.Player({
    url,
    loop: params.loop as boolean,
    playbackRate: params.playbackRate as number,
    detune: params.detune as number,
    autostart: false,
    onload: () => {
      const inst = playerInstances.get(nodeId);
      if (!inst) return;
      inst.loading = false;
    },
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
    loading: true,
    lastUrl: url,
    lastClip: null,
    lastCursorSec: null,
    lastParams: { ...params },
  };

  playerInstances.set(nodeId, instance);
  rebuildBusChain(bus.name);
  scheduleGraphWiring();
  return instance;
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
  playerInstances.delete(nodeId);
}

function disposeNodeById(nodeId: string): void {
  disposeOscInstance(nodeId);
  disposeEffectInstance(nodeId);
  disposeGranularInstance(nodeId);
  disposePlayerInstance(nodeId);
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
      const enabled = toBoolean(config.enabled, false);
      const amplitude = enabled ? inputAmplitude : 0;
      const waveform = toString(config.waveform, 'sine');
      const busName = toString(config.bus, DEFAULT_BUS);
      const loopKey = enabled ? loopKeyOf(config.loop) : null;

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
          const parsed = parseLoopPattern(config.loop, { frequency, amplitude });
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

  const effectProcess = (
    kind: ToneEffectKind,
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ProcessContext,
    defaults: Record<string, number>
  ): Record<string, unknown> => {
    const inputValue = toNumber(inputs.in, 0);
    const busName = toString(config.bus, DEFAULT_BUS);
    const order = Math.floor(toNumber(config.order, defaults.order ?? 0));
    const enabled = toBoolean(config.enabled, true);

    const params: Record<string, number> = { ...defaults };
    Object.keys(defaults).forEach((key) => {
      if (key === 'order') return;
      const fromInput = inputs[key];
      const fromConfig = config[key];
      params[key] = toNumber(fromInput ?? fromConfig, defaults[key]);
    });

    if (!toneAudioEngine.isEnabled()) return { out: inputValue };

    if (!toneModule) {
      void ensureTone().catch((error) =>
        console.warn('[tone-adapter] Tone.js load failed', error)
      );
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
      { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
      { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
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
    process: (inputs, config, context) =>
      effectProcess(
        'tone-delay',
        inputs,
        config,
        context,
        { time: 0.25, feedback: 0.35, wet: 0.3, order: 10 }
      ),
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
      effectProcess(
        'tone-resonator',
        inputs,
        config,
        context,
        { delayTime: 0.08, resonance: 0.6, dampening: 3000, wet: 0.4, order: 20 }
      ),
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
      effectProcess(
        'tone-pitch',
        inputs,
        config,
        context,
        { pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0, wet: 0.3, order: 30 }
      ),
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
      effectProcess(
        'tone-reverb',
        inputs,
        config,
        context,
        { decay: 1.6, preDelay: 0.01, wet: 0.3, order: 40 }
      ),
  });

  registry.register({
    type: 'tone-granular',
    label: 'Tone Granular (client)',
    category: 'Audio',
    inputs: [
      { id: 'gate', label: 'Gate', type: 'number', defaultValue: 0 },
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { id: 'grainSize', label: 'Grain (s)', type: 'number', defaultValue: 0.2 },
      { id: 'overlap', label: 'Overlap (s)', type: 'number', defaultValue: 0.1 },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 0.6 },
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
      const urlRaw = toString(config.url, '');
      const url = deps.resolveAssetRef ? deps.resolveAssetRef(urlRaw) : urlRaw;
      const loop = toBoolean(config.loop, true);
      const gate = toNumber(inputs.gate, 0);
      const enabled = toBoolean(config.enabled, false) || gate > 0;
      const busName = toString(config.bus, DEFAULT_BUS);

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

      if (instance.lastParams.playbackRate !== playbackRate) instance.player.playbackRate = playbackRate;
      if (instance.lastParams.detune !== detune) instance.player.detune = detune;
      if (instance.lastParams.grainSize !== grainSize) instance.player.grainSize = grainSize;
      if (instance.lastParams.overlap !== overlap) instance.player.overlap = overlap;
      if (instance.lastParams.loop !== loop) instance.player.loop = loop;
      if (instance.lastParams.volume !== volume) instance.gain.gain.rampTo(volume, DEFAULT_RAMP_SECONDS);

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

  registry.register({
    type: 'tone-player',
    label: 'Tone Player (client)',
    category: 'Audio',
    inputs: [
      { id: 'url', label: 'URL', type: 'string' },
      { id: 'trigger', label: 'Trigger', type: 'number', defaultValue: 0 },
      { id: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { id: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { id: 'volume', label: 'Volume', type: 'number', defaultValue: 1 },
    ],
    outputs: [{ id: 'value', label: 'Out', type: 'audio', kind: 'sink' }],
    configSchema: [
      { key: 'url', label: 'Audio URL', type: 'string', defaultValue: '' },
      { key: 'loop', label: 'Loop', type: 'boolean', defaultValue: false },
      { key: 'autostart', label: 'Autostart', type: 'boolean', defaultValue: false },
      { key: 'playbackRate', label: 'Rate', type: 'number', defaultValue: 1 },
      { key: 'detune', label: 'Detune', type: 'number', defaultValue: 0 },
      { key: 'volume', label: 'Volume', type: 'number', defaultValue: 1 },
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: false },
    ],
    process: (inputs, config, context) => {
      const urlRaw = toString(inputs.url ?? config.url, '');
      const clipParams = parseToneClipParams(urlRaw);
      const baseUrlRaw = clipParams.baseUrl;
      const url = deps.resolveAssetRef ? deps.resolveAssetRef(baseUrlRaw) : baseUrlRaw;
      const triggerRaw = inputs.trigger;
      const triggerActive =
        typeof triggerRaw === 'number' ? triggerRaw >= 0.5 : Boolean(triggerRaw);
      const playbackRate = toNumber(inputs.playbackRate ?? config.playbackRate, 1);
      const detune = toNumber(inputs.detune ?? config.detune, 0);
      const volume = toNumber(inputs.volume ?? config.volume, 1);
      const loop = clipParams.loop ?? toBoolean(config.loop, false);
      const playGate = clipParams.play;
      const reverse = clipParams.reverse ?? false;
      const cursorRequestedRaw = clipParams.cursorSec;
      const cursorRequested =
        typeof cursorRequestedRaw === 'number' && Number.isFinite(cursorRequestedRaw) && cursorRequestedRaw >= 0
          ? cursorRequestedRaw
          : null;
      const enabledConfig = toBoolean(config.enabled, false);
      const enabled = playGate ?? enabledConfig;
      const autostart = playGate !== null ? false : toBoolean(config.autostart, false);
      const busName = toString(config.bus, DEFAULT_BUS);

      if (!toneAudioEngine.isEnabled()) {
        return { value: volume };
      }

      if (!toneModule) {
        void ensureTone().catch((error) =>
          console.warn('[tone-adapter] Tone.js load failed', error)
        );
        return { value: volume };
      }

      if (!url) {
        disposePlayerInstance(context.nodeId);
        return { value: volume };
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
        instance = createPlayerInstance(context.nodeId, url, busName, params);
      }

      if (instance.lastUrl !== url && url) {
        instance.lastUrl = url;
        instance.loading = true;
        instance.autostarted = false;
        instance.started = false;
        instance.startedAt = 0;
        instance.startOffsetSec = 0;
        instance.startDurationSec = null;
        instance.pausedOffsetSec = null;
        instance.lastClip = null;
        instance.lastCursorSec = null;
        try {
          instance.player.stop();
        } catch {
          // ignore
        }
        void instance.player
          .load(url)
          .then(() => {
            instance.loading = false;
          })
          .catch((error: unknown) => {
            instance.loading = false;
            console.warn('[tone-adapter] player load failed', error);
          });
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

      if (instance.lastParams.playbackRate !== playbackRate) instance.player.playbackRate = playbackRate;
      if (instance.lastParams.detune !== detune) instance.player.detune = detune;
      if (instance.lastParams.loop !== loop) instance.player.loop = loop;
      if (instance.lastParams.volume !== volume) instance.gain.gain.rampTo(volume, DEFAULT_RAMP_SECONDS);

      const clipStartRaw = Math.max(0, toNumber(clipParams.startSec, 0));
      const clipEndRaw = toNumber(clipParams.endSec, -1);
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

      const clipStart = bufferDuration !== null ? clamp(clipStartRaw, 0, bufferDuration) : clipStartRaw;
      const clipEnd =
        clipEndCandidate >= 0
          ? bufferDuration !== null
            ? clamp(clipEndCandidate, clipStart, bufferDuration)
            : Math.max(clipStart, clipEndCandidate)
          : -1;

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

      const triggered = triggerActive && !instance.lastTrigger;

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
            const wrapped = ((rel % resolvedClipDuration) + resolvedClipDuration) % resolvedClipDuration;
            pausedOffset = resolvedClipEnd - wrapped;
          } else {
            const rel = rawPos - clipStart;
            const wrapped = ((rel % resolvedClipDuration) + resolvedClipDuration) % resolvedClipDuration;
            pausedOffset = clipStart + wrapped;
          }
        } else if (resolvedClipEnd !== null) {
          pausedOffset = clamp(pausedOffset, clipStart, resolvedClipEnd);
        } else {
          pausedOffset = Math.max(clipStart, pausedOffset);
        }

        instance.pausedOffsetSec = pausedOffset;
        try {
          instance.player.stop();
        } catch {
          // ignore
        }
        instance.started = false;
        instance.startedAt = 0;
        instance.startOffsetSec = 0;
        instance.startDurationSec = null;
      };

      const segmentStart = reverse ? (resolvedClipEnd ?? clipStart) : clipStart;

      const startFromPosition = (pos: number, reason: string) => {
        if (!canStartNow) return;
        applyClipToPlayer();
        const nextPos =
          resolvedClipEnd !== null ? clamp(Math.max(0, pos), clipStart, resolvedClipEnd) : Math.max(clipStart, pos);
        const dur =
          !loop && resolvedClipEnd !== null
            ? reverse
              ? Math.max(0, nextPos - clipStart)
              : Math.max(0, resolvedClipEnd - nextPos)
            : null;
        if (dur !== null && dur <= 0) {
          try {
            instance.player.stop();
          } catch {
            // ignore
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
          if (instance.started) instance.player.stop();
        } catch {
          // ignore
        }

        try {
          if (dur !== null) instance.player.start(undefined, offset, dur);
          else instance.player.start(undefined, offset);
          instance.started = true;
          instance.startedAt = toneModule!.now();
          instance.startOffsetSec = nextPos;
          instance.startDurationSec = dur;
          instance.pausedOffsetSec = null;
        } catch (err) {
          console.warn('[tone-adapter] player start failed', { reason }, err);
        }
      };

      const cursorChanged =
        cursorClamped !== null &&
        (instance.lastCursorSec === null || Math.abs(cursorClamped - instance.lastCursorSec) > 0.005);

      if (playGate !== null) {
        if (!enabled) {
          stopAndMaybePause();
          if (cursorClamped !== null) instance.pausedOffsetSec = cursorClamped;
        } else {
          if (triggered) {
            instance.pausedOffsetSec = null;
            startFromPosition(segmentStart, 'trigger');
          } else if (clipChanged && instance.started) {
            // Switching reverse while playing should keep the current position when possible.
            if (instance.lastClip && instance.lastClip.reverse !== reverse) {
              stopAndMaybePause();
              const resume = instance.pausedOffsetSec ?? segmentStart;
              instance.pausedOffsetSec = null;
              startFromPosition(resume, 'reverse-change');
            } else {
              instance.pausedOffsetSec = null;
              startFromPosition(segmentStart, 'clip-change');
            }
          } else if (cursorChanged) {
            instance.pausedOffsetSec = null;
            startFromPosition(cursorClamped ?? segmentStart, 'seek');
          } else if (!instance.started && !instance.loading) {
            const resumeOffset = instance.pausedOffsetSec ?? cursorClamped ?? segmentStart;
            startFromPosition(resumeOffset, instance.pausedOffsetSec ? 'resume' : cursorClamped ? 'seek-start' : 'start');
          }
        }
      } else {
        if (triggered) {
          instance.pausedOffsetSec = null;
          startFromPosition(segmentStart, 'trigger');
        }

        if (clipChanged && instance.started && !instance.loading) {
          instance.pausedOffsetSec = null;
          startFromPosition(segmentStart, 'clip-change');
        }

        if (cursorChanged && enabled && !instance.loading) {
          instance.pausedOffsetSec = null;
          startFromPosition(cursorClamped ?? segmentStart, 'seek');
        }

        if (!instance.autostarted && autostart && !instance.loading) {
          if (!instance.started) {
            startFromPosition(cursorClamped ?? segmentStart, 'autostart');
          }
          instance.autostarted = true;
        }

        if (enabled && !instance.started && !instance.loading) {
          startFromPosition(cursorClamped ?? segmentStart, 'enabled');
        }

        if (!enabled && instance.enabled) {
          if (instance.started) {
            try {
              instance.player.stop();
            } catch {
              // ignore
            }
            instance.started = false;
            instance.startedAt = 0;
            instance.startOffsetSec = 0;
            instance.startDurationSec = null;
            instance.pausedOffsetSec = null;
          }
        }
      }

      instance.enabled = enabled;
      instance.lastTrigger = triggerActive;
      instance.lastClip = nextClip;
      instance.lastParams = { ...instance.lastParams, ...params, reverse };
      instance.lastCursorSec = cursorClamped;

      return { value: volume };
    },
  });

  const handle: ToneAdapterHandle = {
    disposeNode: (nodeId: string) => {
      disposeNodeById(nodeId);
    },
    disposeAll: () => {
      for (const nodeId of Array.from(oscInstances.keys())) disposeOscInstance(nodeId);
      for (const nodeId of Array.from(effectInstances.keys())) disposeEffectInstance(nodeId);
      for (const nodeId of Array.from(granularInstances.keys())) disposeGranularInstance(nodeId);
      for (const nodeId of Array.from(playerInstances.keys())) disposePlayerInstance(nodeId);
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
      maybeStopTransport();
    },
    syncActiveNodes: (activeNodeIds: Set<string>, nodes: NodeInstance[], connections: Connection[]) => {
      updateAudioGraphSnapshot(registry, nodes ?? [], connections ?? []);
      for (const nodeId of Array.from(oscInstances.keys())) {
        if (!activeNodeIds.has(nodeId)) disposeOscInstance(nodeId);
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

      if (latestAudioConnections.length === 0) {
        for (const inst of effectInstances.values()) inst.wiredExternally = false;
        if (toneModule && toneAudioEngine.isEnabled()) reconnectSourcesToBus();
        for (const bus of buses.keys()) rebuildBusChain(bus);
        return;
      }

      scheduleGraphWiring();
    },
  };

  return handle;
}

export type { ToneAdapterDeps, ToneAdapterHandle };
