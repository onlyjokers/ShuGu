/**
 * JSON Node Specs (Manager)
 *
 * Node metadata (ports, config fields, constraints) lives in JSON files under this folder.
 * Add a new `*.json` file to add a node to the Manager Node Graph.
 *
 * Runtime behavior is selected via `runtime.kind`. This keeps node UI/constraints data-driven
 * while still using safe, built-in runtimes (no `eval`).
 */
import { get } from 'svelte/store';
import {
  targetClients,
  type ControlAction,
  type ControlPayload,
  type SensorDataMessage,
} from '@shugu/protocol';

import { nodeRegistry } from '../registry';
import type { ConfigField, NodeDefinition, NodePort, ProcessContext } from '../types';
import { parameterRegistry } from '$lib/parameters/registry';
import { getSDK, sensorData, state, selectClients } from '$lib/stores/manager';
import { midiNodeBridge, type MidiSource } from '$lib/features/midi/midi-node-bridge';
import { mapRangeWithOptions } from '$lib/features/midi/midi-math';

type WhenOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
type WhenSource = 'input' | 'config' | 'payload';
type WhenCondition = { source: WhenSource; key: string; op: WhenOp; value: string | number | boolean };

type ClampSpec = { min?: number; max?: number };

type CommandFieldMapping =
  | { kind: 'literal'; value: unknown; when?: WhenCondition }
  | {
      kind: 'number';
      inputKey?: string;
      configKey?: string;
      default?: number;
      clamp?: ClampSpec;
      omitIfZero?: boolean;
      when?: WhenCondition;
    }
  | {
      kind: 'string';
      inputKey?: string;
      configKey?: string;
      default?: string;
      when?: WhenCondition;
    }
  | {
      kind: 'enumFromFuzzy';
      inputKey: string;
      options: string[];
      configKey?: string;
      default?: string;
      when?: WhenCondition;
    }
  | {
      kind: 'enumFromThreshold';
      inputKey: string;
      threshold: number;
      whenTrue: string;
      whenFalse: string;
      configKey?: string;
      default?: string;
      when?: WhenCondition;
    };

type CommandRuntime = {
  kind: 'command';
  command: {
    action: ControlAction;
    clientInput?: string; // default: 'client'
    output?: string; // default: 'cmd'
    payload: Record<string, CommandFieldMapping>;
  };
};

type NodeRuntime =
  | { kind: 'client-object' }
  | { kind: 'proc-client-sensors' }
  | { kind: 'param-get' }
  | { kind: 'param-set' }
  | { kind: 'number' }
  | { kind: 'math' }
  | { kind: 'lfo' }
  | { kind: 'midi-fuzzy' }
  | { kind: 'midi-boolean' }
  | { kind: 'midi-map' }
  | { kind: 'midi-color-map' }
  | { kind: 'manager-select-clients-range' }
  | { kind: 'manager-select-clients-object' }
  | CommandRuntime;

export type NodeSpec = {
  type: string;
  label: string;
  category: string;
  inputs: NodePort[];
  outputs: NodePort[];
  configSchema: ConfigField[];
  runtime: NodeRuntime;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNumber(value: number, clamp: ClampSpec | undefined): number {
  let next = value;
  const min = clamp?.min;
  const max = clamp?.max;
  if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

function getString(inputs: Record<string, unknown>, config: Record<string, unknown>, mapping: any): string {
  const fromInput = mapping.inputKey ? inputs[mapping.inputKey] : undefined;
  if (typeof fromInput === 'string' && fromInput !== '') return fromInput;
  const fromConfig = mapping.configKey ? config[mapping.configKey] : undefined;
  if (typeof fromConfig === 'string' && fromConfig !== '') return fromConfig;
  return String(mapping.default ?? '');
}

function getNumber(inputs: Record<string, unknown>, config: Record<string, unknown>, mapping: any): number {
  const fromInput = mapping.inputKey ? inputs[mapping.inputKey] : undefined;
  if (isFiniteNumber(fromInput)) return fromInput;
  const fromConfig = mapping.configKey ? config[mapping.configKey] : undefined;
  if (isFiniteNumber(fromConfig)) return fromConfig;
  const fallback = Number(mapping.default ?? 0);
  return Number.isFinite(fallback) ? fallback : 0;
}

function getEnumFromFuzzy(inputs: Record<string, unknown>, config: Record<string, unknown>, mapping: any): string {
  const options = Array.isArray(mapping.options) ? (mapping.options as string[]) : [];
  const fallback = mapping.configKey ? config[mapping.configKey] : undefined;
  const fallbackStr =
    typeof fallback === 'string' && fallback ? fallback : typeof mapping.default === 'string' ? mapping.default : '';

  const raw = inputs[mapping.inputKey];
  if (!isFiniteNumber(raw) || options.length === 0) {
    if (fallbackStr && options.includes(fallbackStr)) return fallbackStr;
    return fallbackStr || options[0] || '';
  }

  const clamped = Math.max(0, Math.min(1, raw));
  const idx = Math.min(options.length - 1, Math.floor(clamped * options.length));
  return options[idx] ?? options[0] ?? fallbackStr;
}

function getEnumFromThreshold(
  inputs: Record<string, unknown>,
  config: Record<string, unknown>,
  mapping: any
): string {
  const raw = inputs[mapping.inputKey];
  if (isFiniteNumber(raw)) return raw >= Number(mapping.threshold ?? 0) ? mapping.whenTrue : mapping.whenFalse;

  const fallback = mapping.configKey ? config[mapping.configKey] : undefined;
  if (typeof fallback === 'string' && fallback) return fallback;
  if (typeof mapping.default === 'string') return mapping.default;
  return mapping.whenFalse;
}

function whenMatches(
  when: WhenCondition | undefined,
  inputs: Record<string, unknown>,
  config: Record<string, unknown>,
  payload: Record<string, unknown>
): boolean {
  if (!when) return true;

  const left =
    when.source === 'input'
      ? inputs[when.key]
      : when.source === 'config'
        ? config[when.key]
        : payload[when.key];

  const right = when.value;

  const cmp = () => {
    switch (when.op) {
      case 'eq':
        return left === right;
      case 'ne':
        return left !== right;
      case 'gt':
        return Number(left) > Number(right);
      case 'gte':
        return Number(left) >= Number(right);
      case 'lt':
        return Number(left) < Number(right);
      case 'lte':
        return Number(left) <= Number(right);
    }
  };

  try {
    return Boolean(cmp());
  } catch {
    return false;
  }
}

function evalCommandMapping(
  mapping: CommandFieldMapping,
  inputs: Record<string, unknown>,
  config: Record<string, unknown>,
  payload: Record<string, unknown>
): unknown {
  if (!whenMatches(mapping.when, inputs, config, payload)) return undefined;

  switch (mapping.kind) {
    case 'literal':
      return mapping.value;
    case 'string':
      return getString(inputs, config, mapping);
    case 'number': {
      const raw = getNumber(inputs, config, mapping);
      const clamped = clampNumber(raw, mapping.clamp);
      if (mapping.omitIfZero && clamped <= 0) return undefined;
      return clamped;
    }
    case 'enumFromFuzzy':
      return getEnumFromFuzzy(inputs, config, mapping);
    case 'enumFromThreshold':
      return getEnumFromThreshold(inputs, config, mapping);
  }
}

function createCommandProcess(runtime: CommandRuntime): NodeDefinition['process'] {
  const clientInput = runtime.command.clientInput ?? 'client';
  const outKey = runtime.command.output ?? 'cmd';

  return (inputs, config) => {
    const client = inputs[clientInput] as any;
    if (!client?.clientId) return { [outKey]: null };

    const payload: Record<string, unknown> = {};
    const entries = Object.entries(runtime.command.payload ?? {});

    // Phase 1: conditions that do not depend on other computed payload fields.
    for (const [key, mapping] of entries) {
      const when = (mapping as any).when as WhenCondition | undefined;
      if (when?.source === 'payload') continue;
      const value = evalCommandMapping(mapping, inputs, config, payload);
      if (value !== undefined) payload[key] = value;
    }

    // Phase 2: payload-dependent conditions (e.g. include `frequency` only when `mode === "blink"`).
    for (const [key, mapping] of entries) {
      const when = (mapping as any).when as WhenCondition | undefined;
      if (when?.source !== 'payload') continue;
      const value = evalCommandMapping(mapping, inputs, config, payload);
      if (value !== undefined) payload[key] = value;
    }

    return {
      [outKey]: {
        action: runtime.command.action,
        payload: payload as ControlPayload,
      },
    };
  };
}

function createDefinition(spec: NodeSpec): NodeDefinition {
  const base: Omit<NodeDefinition, 'process' | 'onSink'> = {
    type: spec.type,
    label: spec.label,
    category: spec.category,
    inputs: spec.inputs ?? [],
    outputs: spec.outputs ?? [],
    configSchema: spec.configSchema ?? [],
  };

  switch (spec.runtime.kind) {
    case 'client-object': {
      return {
        ...base,
        process: (_inputs, config) => {
          const clientId = String((config.clientId ?? '') as string);
          const sensors: SensorDataMessage | undefined = clientId ? get(sensorData).get(clientId) : undefined;
          return { out: { clientId, sensors } };
        },
        onSink: (inputs, config) => {
          const clientId = String((config.clientId ?? '') as string);
          if (!clientId) return;

          const sdk = getSDK();
          if (!sdk) return;

          const raw = inputs.in;
          const commands = (Array.isArray(raw) ? raw : [raw]) as unknown[];
          for (const cmd of commands) {
            if (!cmd || typeof cmd !== 'object') continue;
            const action = (cmd as any).action as ControlAction | undefined;
            const payload = (cmd as any).payload as ControlPayload | undefined;
            const executeAt = (cmd as any).executeAt as number | undefined;
            if (!action) continue;
            sdk.sendControl(targetClients([clientId]), action, payload ?? {}, executeAt);
          }
        },
      };
    }
    case 'proc-client-sensors': {
      return {
        ...base,
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
              out.accelX = Number(payload.x ?? 0);
              out.accelY = Number(payload.y ?? 0);
              out.accelZ = Number(payload.z ?? 0);
              break;
            case 'gyro':
            case 'orientation':
              out.gyroA = Number(payload.alpha ?? 0);
              out.gyroB = Number(payload.beta ?? 0);
              out.gyroG = Number(payload.gamma ?? 0);
              break;
            case 'mic':
              out.micVol = Number(payload.volume ?? 0);
              out.micLow = Number(payload.lowEnergy ?? 0);
              out.micHigh = Number(payload.highEnergy ?? 0);
              out.micBpm = Number(payload.bpm ?? 0);
              break;
          }
          return out;
        },
      };
    }
    case 'param-get': {
      return {
        ...base,
        process: (_inputs, config) => {
          const path = String(config.path ?? '');
          if (!path) return { value: 0 };
          const param = parameterRegistry.get<number>(path);
          if (!param) return { value: 0 };
          return { value: param.effectiveValue };
        },
      };
    }
    case 'param-set': {
      return {
        ...base,
        process: (inputs, config, context: ProcessContext) => {
          const path = String(config.path ?? '');
          const mode = String(config.mode ?? 'REMOTE') as 'REMOTE' | 'MODULATION';
          const value = (inputs.value as number) ?? 0;
          const bypass = (inputs.bypass as boolean) ?? false;

          if (!path || bypass) return { value };

          const param = parameterRegistry.get<number>(path);
          if (!param) return { value };

          if (mode === 'REMOTE') {
            param.setValue(value, 'NODE');
          } else {
            const offset = value - param.baseValue;
            param.setModulation(`node-${context.nodeId}`, offset, 'NODE');
          }

          return { value };
        },
      };
    }
    case 'number': {
      return {
        ...base,
        process: (_inputs, config) => ({ value: (config.value as number) ?? 0 }),
      };
    }
    case 'math': {
      return {
        ...base,
        process: (inputs, config) => {
          const a = (inputs.a as number) ?? 0;
          const b = (inputs.b as number) ?? 0;
          const op = String(config.operation ?? '+');

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
    case 'lfo': {
      return {
        ...base,
        process: (inputs, config, context: ProcessContext) => {
          const frequency = (inputs.frequency as number) ?? 1;
          const amplitude = (inputs.amplitude as number) ?? 1;
          const offset = (inputs.offset as number) ?? 0;
          const waveform = String(config.waveform ?? 'sine');

          const phase = (context.time / 1000) * frequency * 2 * Math.PI;
          let normalized: number;
          switch (waveform) {
            case 'sine':
              normalized = (Math.sin(phase) + 1) / 2;
              break;
            case 'square':
              normalized = Math.sin(phase) >= 0 ? 1 : 0;
              break;
            case 'triangle':
              normalized = Math.abs(((context.time / 1000) * frequency * 2) % 2 - 1);
              break;
            case 'sawtooth':
              normalized = ((context.time / 1000) * frequency) % 1;
              break;
            default:
              normalized = (Math.sin(phase) + 1) / 2;
          }

          return { value: offset + normalized * amplitude };
        },
      };
    }
    case 'midi-fuzzy': {
      return {
        ...base,
        process: (_inputs, config) => {
          const source = (config.source ?? null) as MidiSource | null;
          const normalized = midiNodeBridge.getNormalized(source);
          return { value: normalized ?? 0 };
        },
      };
    }
    case 'midi-boolean': {
      return {
        ...base,
        process: (_inputs, config) => {
          const source = (config.source ?? null) as MidiSource | null;
          const thresholdRaw = Number(config.threshold ?? 0.5);
          const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 0.5;

          const event = midiNodeBridge.getEvent(source);
          if (!event) return { value: false };

          if (event.type === 'note') return { value: Boolean(event.isPress) };
          return { value: event.normalized >= threshold };
        },
      };
    }
    case 'midi-map': {
      return {
        ...base,
        process: (inputs, config) => {
          const value = typeof inputs.in === 'number' ? (inputs.in as number) : null;
          if (value === null || !Number.isFinite(value)) return { out: null };

          const min = Number(config.min ?? 0);
          const max = Number(config.max ?? 1);
          const invert = Boolean(config.invert);
          const round = Boolean(config.round);

          const mapped = mapRangeWithOptions(value, min, max, invert);
          return { out: round ? Math.round(mapped) : mapped };
        },
      };
    }
    case 'midi-color-map': {
      type Rgb = { r: number; g: number; b: number };

      const clamp01 = (v: number): number => {
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(1, v));
      };

      const parseHexColor = (value: unknown): Rgb | null => {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        const hex = raw.startsWith('#') ? raw.slice(1) : raw;

        const isShort = hex.length === 3;
        const isFull = hex.length === 6;
        if (!isShort && !isFull) return null;
        if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

        const full = isShort ? hex.split('').map((c) => c + c).join('') : hex;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        if (![r, g, b].every((n) => Number.isFinite(n))) return null;
        return { r, g, b };
      };

      const toHex = ({ r, g, b }: Rgb): string => {
        const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
        return (
          '#' +
          [cl(r), cl(g), cl(b)]
            .map((n) => n.toString(16).padStart(2, '0'))
            .join('')
            .toLowerCase()
        );
      };

      const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

      return {
        ...base,
        process: (inputs, config) => {
          const raw = typeof inputs.in === 'number' ? (inputs.in as number) : 0;
          const invert = Boolean(config.invert);
          const t = invert ? 1 - clamp01(raw) : clamp01(raw);

          const fromRaw = config.from ?? '#6366f1';
          const toRaw = config.to ?? '#ffffff';
          const from = parseHexColor(fromRaw) ?? parseHexColor('#6366f1');
          const to = parseHexColor(toRaw) ?? parseHexColor('#ffffff');
          if (!from || !to) return { out: null };

          const out: Rgb = { r: lerp(from.r, to.r, t), g: lerp(from.g, to.g, t), b: lerp(from.b, to.b, t) };
          return { out: toHex(out) };
        },
      };
    }
    case 'manager-select-clients-range': {
      const selectionEqual = (a: string[], b: string[]) =>
        a.length === b.length && a.every((id, idx) => id === b[idx]);

      const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

      return {
        ...base,
        process: () => ({}),
        onSink: (inputs) => {
          const raw = (inputs as any).in;
          const value = Array.isArray(raw) ? raw[0] : raw;
          const n = Number(value);
          if (!Number.isFinite(n)) return;

          const clients = get(state).clients.map((c: any) => String(c.clientId ?? ''));
          const list = clients.filter(Boolean);
          if (list.length === 0) return;

          const t = clamp01(n);
          const count = Math.min(list.length, Math.floor(t * (list.length + 1)));
          const next = list.slice(0, count);
          const current = get(state).selectedClientIds.map(String);
          if (selectionEqual(current, next)) return;
          selectClients(next);
        },
      };
    }
    case 'manager-select-clients-object': {
      const selectionEqual = (a: string[], b: string[]) =>
        a.length === b.length && a.every((id, idx) => id === b[idx]);

      const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

      return {
        ...base,
        process: () => ({}),
        onSink: (inputs) => {
          const raw = (inputs as any).in;
          const value = Array.isArray(raw) ? raw[0] : raw;
          const n = Number(value);
          if (!Number.isFinite(n)) return;

          const clients = get(state).clients.map((c: any) => String(c.clientId ?? ''));
          const list = clients.filter(Boolean);
          if (list.length === 0) return;

          const t = clamp01(n);
          const idx = Math.min(list.length - 1, Math.floor(t * list.length));
          const next = [list[idx]!];
          const current = get(state).selectedClientIds.map(String);
          if (selectionEqual(current, next)) return;
          selectClients(next);
        },
      };
    }
    case 'command': {
      return {
        ...base,
        process: createCommandProcess(spec.runtime),
      };
    }
  }
}

function loadSpecs(): NodeSpec[] {
  const modules = import.meta.glob('./*.json', { eager: true }) as Record<string, { default: NodeSpec }>;
  const specs: NodeSpec[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    const spec = mod?.default;
    if (!spec || typeof spec !== 'object') continue;
    if (!spec.type || !spec.label || !spec.category) continue;
    if (!spec.runtime || typeof (spec as any).runtime?.kind !== 'string') continue;
    specs.push(spec);
  }

  // Stable order for debugging/determinism.
  specs.sort((a, b) => a.type.localeCompare(b.type));
  return specs;
}

// Register on import.
for (const spec of loadSpecs()) {
  try {
    nodeRegistry.register(createDefinition(spec));
  } catch (err) {
    console.warn('[node-specs] failed to register', spec?.type, err);
  }
}
