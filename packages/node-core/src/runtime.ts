import type { Connection, GraphState, NodeInstance, ProcessContext } from './types.js';
import type { NodeRegistry } from './registry.js';

const DEFAULT_TICK_INTERVAL_MS = 33;

export type NodeRuntimeWatchdogInfo = {
  reason: 'compile-error' | 'sink-burst' | 'oscillation';
  message: string;
  diagnostics?: Record<string, unknown>;
};

type RuntimeOverride = {
  value: unknown;
  updatedAt: number;
  ttlMs?: number;
};

type RuntimeOverridesByKind = {
  input: Map<string, RuntimeOverride>;
  config: Map<string, RuntimeOverride>;
};

export class NodeRuntime {
  private nodes = new Map<string, NodeInstance>();
  private connections: Connection[] = [];
  private executionOrder: NodeInstance[] = [];
  private needsRecompile = true;

  private timer: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS;
  private lastTickTime = 0;
  private onTick: ((info: { durationMs: number; time: number }) => void) | null = null;
  private onWatchdog: ((info: NodeRuntimeWatchdogInfo) => void) | null = null;
  private isNodeEnabled: ((nodeId: string) => boolean) | null = null;

  // Remote overrides (manager-driven) that take precedence over connections and local inputs.
  // Overrides are NOT written into node.inputValues / node.config so TTL expiry restores base values.
  private overridesByNode = new Map<string, RuntimeOverridesByKind>();

  // Safety watchdogs (keep very lightweight for mobile).
  private maxSinkValuesPerTick = 200;
  private sinkValuesThisTick = 0;

  private oscillation = {
    enabled: true,
    windowSize: 10,
    minAlternatingLength: 6,
    windowMs: 1000,
  };
  private sinkSignatureHistory = new Map<string, { at: number; signature: string }[]>();

  constructor(
    private registry: NodeRegistry,
    options?: {
      tickIntervalMs?: number;
      onTick?: (info: { durationMs: number; time: number }) => void;
      onWatchdog?: (info: NodeRuntimeWatchdogInfo) => void;
      isNodeEnabled?: (nodeId: string) => boolean;
      watchdog?: {
        maxSinkValuesPerTick?: number;
        oscillation?: {
          enabled?: boolean;
          windowSize?: number;
          minAlternatingLength?: number;
          windowMs?: number;
        };
      };
    }
  ) {
    if (typeof options?.tickIntervalMs === 'number' && Number.isFinite(options.tickIntervalMs)) {
      this.tickIntervalMs = Math.max(1, Math.floor(options.tickIntervalMs));
    }
    this.onTick = options?.onTick ?? null;
    this.onWatchdog = options?.onWatchdog ?? null;
    this.isNodeEnabled = options?.isNodeEnabled ?? null;

    const maxSink = options?.watchdog?.maxSinkValuesPerTick;
    if (typeof maxSink === 'number' && Number.isFinite(maxSink) && maxSink > 0) {
      this.maxSinkValuesPerTick = Math.floor(maxSink);
    }

    const osc = options?.watchdog?.oscillation;
    if (osc) {
      if (typeof osc.enabled === 'boolean') this.oscillation.enabled = osc.enabled;
      if (
        typeof osc.windowSize === 'number' &&
        Number.isFinite(osc.windowSize) &&
        osc.windowSize >= 4
      ) {
        this.oscillation.windowSize = Math.floor(osc.windowSize);
      }
      if (
        typeof osc.minAlternatingLength === 'number' &&
        Number.isFinite(osc.minAlternatingLength) &&
        osc.minAlternatingLength >= 4
      ) {
        this.oscillation.minAlternatingLength = Math.floor(osc.minAlternatingLength);
      }
      if (typeof osc.windowMs === 'number' && Number.isFinite(osc.windowMs) && osc.windowMs > 0) {
        this.oscillation.windowMs = Math.floor(osc.windowMs);
      }
    }
  }

  setTickIntervalMs(ms: number): void {
    if (!Number.isFinite(ms)) return;
    const next = Math.max(1, Math.floor(ms));
    if (next === this.tickIntervalMs) return;
    this.tickIntervalMs = next;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  loadGraph(state: Pick<GraphState, 'nodes' | 'connections'>): void {
    this.nodes.clear();
    for (const node of state.nodes ?? []) {
      if (!this.registry.get(node.type)) {
        throw new Error(`unknown node type: ${node.type}`);
      }
      this.nodes.set(node.id, {
        ...node,
        config: { ...(node.config ?? {}) },
        inputValues: { ...(node.inputValues ?? {}) },
        outputValues: { ...(node.outputValues ?? {}) },
      });
    }
    const nodeIds = new Set(this.nodes.keys());
    const nextConnections: Connection[] = [];
    for (const conn of state.connections ?? []) {
      if (!nodeIds.has(conn.sourceNodeId) || !nodeIds.has(conn.targetNodeId)) {
        throw new Error(`invalid connection: ${conn.id}`);
      }

      const sourceNode = this.nodes.get(conn.sourceNodeId);
      const targetNode = this.nodes.get(conn.targetNodeId);
      const sourceDef = sourceNode ? this.registry.get(sourceNode.type) : undefined;
      const targetDef = targetNode ? this.registry.get(targetNode.type) : undefined;
      const sourcePort = sourceDef?.outputs.find((p) => p.id === conn.sourcePortId);
      const targetPort = targetDef?.inputs.find((p) => p.id === conn.targetPortId);
      if (!sourcePort || !targetPort) continue;

      nextConnections.push(conn);
    }
    this.connections = nextConnections;
    this.executionOrder = [];
    this.needsRecompile = true;
    this.lastTickTime = 0;
    this.overridesByNode.clear();
    this.sinkSignatureHistory.clear();
  }

  getNode(nodeId: string): NodeInstance | undefined {
    return this.nodes.get(nodeId);
  }

  getGraphRef(): GraphState {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: [...this.connections],
    };
  }

  exportGraph(): GraphState {
    return {
      nodes: Array.from(this.nodes.values()).map((n) => ({ ...n })),
      connections: [...this.connections],
    };
  }

  compileNow(): void {
    if (!this.needsRecompile) return;
    this.compile();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.stop();
    this.nodes.clear();
    this.connections = [];
    this.executionOrder = [];
    this.needsRecompile = true;
    this.lastTickTime = 0;
    this.overridesByNode.clear();
    this.sinkSignatureHistory.clear();
  }

  applyOverride(
    nodeId: string,
    kind: 'input' | 'config',
    key: string,
    value: unknown,
    ttlMs?: number
  ): void {
    if (!nodeId || !key) return;
    const entry = this.overridesByNode.get(nodeId) ?? {
      input: new Map<string, RuntimeOverride>(),
      config: new Map<string, RuntimeOverride>(),
    };
    const bucket = kind === 'config' ? entry.config : entry.input;
    bucket.set(key, {
      value,
      updatedAt: Date.now(),
      ttlMs:
        typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
          ? Math.floor(ttlMs)
          : undefined,
    });
    this.overridesByNode.set(nodeId, entry);
  }

  removeOverride(nodeId: string, kind: 'input' | 'config', key: string): void {
    const entry = this.overridesByNode.get(nodeId);
    if (!entry) return;
    const bucket = kind === 'config' ? entry.config : entry.input;
    bucket.delete(key);
    if (entry.input.size === 0 && entry.config.size === 0) {
      this.overridesByNode.delete(nodeId);
    }
  }

  clearOverrides(): void {
    this.overridesByNode.clear();
  }

  private compile(): void {
    const nodes = Array.from(this.nodes.values());
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      outEdges.set(node.id, []);
    }

    for (const conn of this.connections) {
      const targetNode = nodeMap.get(conn.targetNodeId);
      if (targetNode) {
        const def = this.registry.get(targetNode.type);
        const port = def?.inputs.find((p) => p.id === conn.targetPortId);
        if (port?.kind === 'sink') continue;
      }

      inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) ?? 0) + 1);
      const outs = outEdges.get(conn.sourceNodeId) ?? [];
      if (!outs.includes(conn.targetNodeId)) outs.push(conn.targetNodeId);
      outEdges.set(conn.sourceNodeId, outs);
    }

    const queue: string[] = [];
    const result: NodeInstance[] = [];

    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node) result.push(node);
      for (const target of outEdges.get(id) ?? []) {
        const next = (inDegree.get(target) ?? 1) - 1;
        inDegree.set(target, next);
        if (next === 0) queue.push(target);
      }
    }

    if (result.length !== nodes.length) {
      throw new Error('Cycle detected in compute graph (sink edges are allowed).');
    }

    this.executionOrder = result;
    this.needsRecompile = false;
  }

  private expireOverrides(now: number): void {
    if (this.overridesByNode.size === 0) return;
    for (const [nodeId, entry] of this.overridesByNode.entries()) {
      const clean = (bucket: Map<string, RuntimeOverride>) => {
        for (const [key, ov] of bucket.entries()) {
          if (!ov.ttlMs) continue;
          if (now - ov.updatedAt > ov.ttlMs) bucket.delete(key);
        }
      };
      clean(entry.input);
      clean(entry.config);
      if (entry.input.size === 0 && entry.config.size === 0) {
        this.overridesByNode.delete(nodeId);
      }
    }
  }

  private getInputOverride(nodeId: string, key: string): RuntimeOverride | null {
    const entry = this.overridesByNode.get(nodeId);
    if (!entry) return null;
    const ov = entry.input.get(key);
    return ov ?? null;
  }

  private getEffectiveConfig(
    nodeId: string,
    base: Record<string, unknown>,
    now: number
  ): Record<string, unknown> {
    const entry = this.overridesByNode.get(nodeId);
    if (!entry || entry.config.size === 0) return base;

    const next: Record<string, unknown> = { ...base };
    for (const [key, ov] of entry.config.entries()) {
      if (ov.ttlMs && now - ov.updatedAt > ov.ttlMs) continue;
      next[key] = ov.value;
    }
    return next;
  }

  private countSinkValues(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (Array.isArray(value)) return value.length;
    return 1;
  }

  private commandSignature(value: unknown): string | null {
    const signatureFor = (cmd: any): string | null => {
      if (!cmd || typeof cmd !== 'object') return null;
      const action = typeof cmd.action === 'string' ? cmd.action : '';
      if (!action) return null;
      const payload: any = cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {};

      const parts: string[] = [`a=${action}`];
      if (typeof payload.mode === 'string' && payload.mode) parts.push(`mode=${payload.mode}`);
      if (typeof payload.waveform === 'string' && payload.waveform)
        parts.push(`wave=${payload.waveform}`);
      if (typeof payload.sceneId === 'string' && payload.sceneId)
        parts.push(`scene=${payload.sceneId}`);
      if (typeof payload.transition === 'string' && payload.transition)
        parts.push(`trans=${payload.transition}`);

      if (action === 'flashlight' && payload.mode === 'blink') {
        const q = (n: unknown) =>
          typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
        const freq = q(payload.frequency);
        const duty = q(payload.dutyCycle);
        if (freq !== undefined) parts.push(`f=${freq}`);
        if (duty !== undefined) parts.push(`d=${duty}`);
      }

      return parts.join(',');
    };

    if (Array.isArray(value)) {
      const items = value as unknown[];
      const sigs = items
        .slice(0, 3)
        .map((v) => signatureFor(v as any))
        .filter(Boolean) as string[];
      if (sigs.length === 0) return null;
      const extra = items.length > 3 ? `+${items.length - 3}` : '';
      return `arr(${sigs.join('|')})${extra}`;
    }

    return signatureFor(value as any);
  }

  private recordSinkSignature(
    key: string,
    signature: string,
    now: number
  ): NodeRuntimeWatchdogInfo | null {
    const history = this.sinkSignatureHistory.get(key) ?? [];
    const next = [...history, { at: now, signature }].slice(-this.oscillation.windowSize);
    this.sinkSignatureHistory.set(key, next);

    if (!this.oscillation.enabled) return null;
    if (next.length < this.oscillation.minAlternatingLength) return null;

    const isAlternating = (slice: { at: number; signature: string }[]) => {
      const uniq = new Set(slice.map((e) => e.signature));
      if (uniq.size !== 2) return false;
      for (let i = 1; i < slice.length; i++) {
        if (slice[i].signature === slice[i - 1].signature) return false;
      }
      for (let i = 2; i < slice.length; i++) {
        if (slice[i].signature !== slice[i - 2].signature) return false;
      }
      const span = slice[slice.length - 1].at - slice[0].at;
      return span >= 0 && span <= this.oscillation.windowMs;
    };

    for (let len = next.length; len >= this.oscillation.minAlternatingLength; len--) {
      const slice = next.slice(-len);
      if (!isAlternating(slice)) continue;
      const a = slice[0]?.signature ?? '';
      const b = slice[1]?.signature ?? '';
      return {
        reason: 'oscillation',
        message: `oscillation detected (${len} alternating changes)`,
        diagnostics: { key, a, b, length: len, windowMs: this.oscillation.windowMs },
      };
    }

    return null;
  }

  private triggerWatchdog(info: NodeRuntimeWatchdogInfo): void {
    try {
      this.onWatchdog?.(info);
    } catch {
      // ignore
    }
    this.stop();
  }

  private tick(): void {
    const t0 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const now = Date.now();
    this.sinkValuesThisTick = 0;
    this.expireOverrides(now);

    if (this.needsRecompile) {
      try {
        this.compile();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[NodeRuntime] compile error', err);
        this.triggerWatchdog({
          reason: 'compile-error',
          message,
          diagnostics: { error: message },
        });
        const t1 =
          typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        this.onTick?.({ durationMs: t1 - t0, time: now });
        return;
      }
    }

    const deltaTime = this.lastTickTime > 0 ? now - this.lastTickTime : this.tickIntervalMs;
    this.lastTickTime = now;

    const context: ProcessContext = { nodeId: '', time: now, deltaTime };

    // Compute pass
    for (const node of this.executionOrder) {
      if (this.isNodeEnabled && !this.isNodeEnabled(node.id)) continue;
      const def = this.registry.get(node.type);
      if (!def) continue;

      const inputs: Record<string, unknown> = {};
      for (const port of def.inputs) {
        if (port.kind === 'sink') continue;

        const ov = this.getInputOverride(node.id, port.id);
        if (ov && (!ov.ttlMs || now - ov.updatedAt <= ov.ttlMs)) {
          inputs[port.id] = ov.value;
          continue;
        }

        const conn = this.connections.find(
          (c) => c.targetNodeId === node.id && c.targetPortId === port.id
        );
        if (conn) {
          const sourceNode = this.nodes.get(conn.sourceNodeId);
          inputs[port.id] = sourceNode ? sourceNode.outputValues[conn.sourcePortId] : undefined;
          continue;
        }

        inputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
        node.inputValues[port.id] = inputs[port.id];
      }

      context.nodeId = node.id;
      try {
        const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
        const outputs = def.process(inputs, effectiveConfig, context);
        node.outputValues = outputs;
      } catch (err) {
        console.error(`[NodeRuntime] process error in ${node.type} (${node.id})`, err);
      }
    }

    // Sink pass
    for (const node of this.executionOrder) {
      if (this.isNodeEnabled && !this.isNodeEnabled(node.id)) continue;
      const def = this.registry.get(node.type);
      if (!def?.onSink) continue;

      const sinkInputs: Record<string, unknown> = {};
      for (const conn of this.connections) {
        if (conn.targetNodeId !== node.id) continue;
        const port = def.inputs.find((p) => p.id === conn.targetPortId);
        if (!port || port.kind !== 'sink') continue;

        const sourceNode = this.nodes.get(conn.sourceNodeId);
        if (!sourceNode) continue;
        const value = sourceNode.outputValues[conn.sourcePortId];

        const prev = sinkInputs[conn.targetPortId];
        if (prev === undefined) sinkInputs[conn.targetPortId] = value;
        else if (Array.isArray(prev)) prev.push(value);
        else sinkInputs[conn.targetPortId] = [prev, value];
      }

      if (Object.keys(sinkInputs).length === 0) continue;

      let changed = false;
      for (const [portId, next] of Object.entries(sinkInputs)) {
        if (!this.deepEqual(node.inputValues[portId], next)) changed = true;
        node.inputValues[portId] = next;
      }
      if (!changed) continue;

      // Count sink values for a simple burst watchdog.
      for (const value of Object.values(sinkInputs)) {
        this.sinkValuesThisTick += this.countSinkValues(value);
      }
      if (this.sinkValuesThisTick > this.maxSinkValuesPerTick) {
        this.triggerWatchdog({
          reason: 'sink-burst',
          message: `sink burst exceeded budget (${this.sinkValuesThisTick} > ${this.maxSinkValuesPerTick})`,
          diagnostics: {
            maxSinkValuesPerTick: this.maxSinkValuesPerTick,
            sinkValuesThisTick: this.sinkValuesThisTick,
            nodeId: node.id,
          },
        });
        break;
      }

      // Oscillation watchdog (only for command-like sinks).
      if (this.oscillation.enabled) {
        for (const [portId, value] of Object.entries(sinkInputs)) {
          const signature = this.commandSignature(value);
          if (!signature) continue;
          const key = `${node.id}:${portId}`;
          const watchdog = this.recordSinkSignature(key, signature, now);
          if (watchdog) {
            this.triggerWatchdog(watchdog);
            break;
          }
        }
      }

      if (!this.timer) break;

      context.nodeId = node.id;
      try {
        const effectiveConfig = this.getEffectiveConfig(node.id, node.config, now);
        def.onSink(sinkInputs, effectiveConfig, context);
      } catch (err) {
        console.error(`[NodeRuntime] sink error in ${node.type} (${node.id})`, err);
      }

      if (!this.timer) break;
    }

    const t1 =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.onTick?.({ durationMs: t1 - t0, time: now });
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return false;
  }
}
