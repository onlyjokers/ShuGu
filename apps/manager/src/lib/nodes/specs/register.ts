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
} from '@shugu/protocol';
import { NodeRegistry as CoreNodeRegistry, registerDefaultNodeDefinitions } from '@shugu/node-core';

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
    /** Optional gating: when set, requires `inputs[clientInput].clientId` to be present. */
    clientInput?: string;
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

type CoreRuntimeImpl = Pick<NodeDefinition, 'process' | 'onSink'>;

const coreRuntimeImplByKind: Map<string, CoreRuntimeImpl> = (() => {
  const registry = new CoreNodeRegistry();

  registerDefaultNodeDefinitions(registry, {
    // Manager-side: resolve clientId from node config.
    getClientId: () => null,
    getSensorForClientId: (clientId) => {
      if (!clientId) return null;
      return (get(sensorData).get(clientId) as any) ?? null;
    },
    executeCommand: () => {
      // Manager always routes via executeCommandForClientId.
    },
    executeCommandForClientId: (clientId, cmd) => {
      if (!clientId) return;
      const sdk = getSDK();
      if (!sdk) return;
      sdk.sendControl(targetClients([clientId]), cmd.action, cmd.payload ?? {}, cmd.executeAt);
    },
  });

  const pick = (type: string): CoreRuntimeImpl => {
    const def = registry.get(type);
    if (!def) {
      throw new Error(`[node-specs] missing core runtime impl: ${type}`);
    }
    return { process: def.process, onSink: def.onSink };
  };

  return new Map<string, CoreRuntimeImpl>([
    ['client-object', pick('client-object')],
    ['proc-client-sensors', pick('proc-client-sensors')],
    ['number', pick('number')],
    ['math', pick('math')],
    ['lfo', pick('lfo')],
  ]);
})();

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
  const clientInput = runtime.command.clientInput;
  const outKey = runtime.command.output ?? 'cmd';

  return (inputs, config) => {
    if (clientInput) {
      const client = inputs[clientInput] as any;
      if (!client?.clientId) return { [outKey]: null };
    }

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
    case 'client-object':
    case 'proc-client-sensors':
    case 'number':
    case 'math':
    case 'lfo': {
      const impl = coreRuntimeImplByKind.get(spec.runtime.kind);
      if (!impl) {
        throw new Error(`[node-specs] missing core runtime kind: ${spec.runtime.kind}`);
      }
      return {
        ...base,
        process: impl.process,
        ...(impl.onSink ? { onSink: impl.onSink } : {}),
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
          const invert =
            typeof (inputs as any).invert === 'boolean'
              ? Boolean((inputs as any).invert)
              : Boolean(config.invert);
          const round =
            typeof (inputs as any).round === 'boolean'
              ? Boolean((inputs as any).round)
              : Boolean(config.round);

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
