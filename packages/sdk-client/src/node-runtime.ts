import type { Connection, GraphState, NodeInstance, ProcessContext } from './node-types.js';
import type { NodeRegistry } from './node-registry.js';

const DEFAULT_TICK_INTERVAL_MS = 33;

export class NodeRuntime {
    private nodes = new Map<string, NodeInstance>();
    private connections: Connection[] = [];
    private executionOrder: NodeInstance[] = [];
    private needsRecompile = true;

    private timer: ReturnType<typeof setInterval> | null = null;
    private tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS;
    private lastTickTime = 0;
    private onTick: ((info: { durationMs: number; time: number }) => void) | null = null;

    constructor(
        private registry: NodeRegistry,
        options?: { tickIntervalMs?: number; onTick?: (info: { durationMs: number; time: number }) => void }
    ) {
        if (typeof options?.tickIntervalMs === 'number' && Number.isFinite(options.tickIntervalMs)) {
            this.tickIntervalMs = Math.max(1, Math.floor(options.tickIntervalMs));
        }
        this.onTick = options?.onTick ?? null;
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
                outputValues: {},
            });
        }
        const nodeIds = new Set(this.nodes.keys());
        this.connections = [...(state.connections ?? [])];
        for (const conn of this.connections) {
            if (!nodeIds.has(conn.sourceNodeId) || !nodeIds.has(conn.targetNodeId)) {
                throw new Error(`invalid connection: ${conn.id}`);
            }
        }
        this.executionOrder = [];
        this.needsRecompile = true;
        this.lastTickTime = 0;
    }

    exportGraph(): GraphState {
        return {
            nodes: Array.from(this.nodes.values()).map((n) => ({ ...n })),
            connections: [...this.connections],
        };
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

    private tick(): void {
        const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (this.needsRecompile) {
            this.compile();
        }

        const now = Date.now();
        const deltaTime = this.lastTickTime > 0 ? now - this.lastTickTime : this.tickIntervalMs;
        this.lastTickTime = now;

        const context: ProcessContext = { nodeId: '', time: now, deltaTime };

        // Compute pass
        for (const node of this.executionOrder) {
            const def = this.registry.get(node.type);
            if (!def) continue;

            const inputs: Record<string, unknown> = {};
            for (const port of def.inputs) {
                if (port.kind === 'sink') continue;
                const conn = this.connections.find(
                    (c) => c.targetNodeId === node.id && c.targetPortId === port.id
                );
                if (conn) {
                    const sourceNode = this.nodes.get(conn.sourceNodeId);
                    inputs[port.id] = sourceNode ? sourceNode.outputValues[conn.sourcePortId] : undefined;
                } else {
                    inputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
                    node.inputValues[port.id] = inputs[port.id];
                }
            }

            context.nodeId = node.id;
            try {
                const outputs = def.process(inputs, node.config, context);
                node.outputValues = outputs;
            } catch (err) {
                console.error(`[NodeRuntime] process error in ${node.type} (${node.id})`, err);
            }
        }

        // Sink pass
        for (const node of this.executionOrder) {
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

            context.nodeId = node.id;
            try {
                def.onSink(sinkInputs, node.config, context);
            } catch (err) {
                console.error(`[NodeRuntime] sink error in ${node.type} (${node.id})`, err);
            }
        }

        const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
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
