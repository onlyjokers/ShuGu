/**
 * NodeEngine - Headless Singleton for Node Graph Execution (Manager)
 *
 * Wraps @shugu/node-core's NodeRuntime and keeps Manager-only concerns here:
 * - Svelte stores for UI observation
 * - Local loop detection + deployment/offload bookkeeping
 * - Parameter registry modulation cleanup
 */
import { get, writable, type Writable } from 'svelte/store';
import { PROTOCOL_VERSION } from '@shugu/protocol';
import { NodeRuntime } from '@shugu/node-core';

import type { Connection, GraphState, NodeInstance } from './types';
import { nodeRegistry } from './registry';
import { parameterRegistry } from '../parameters/registry';

export type LocalLoop = {
  id: string;
  nodeIds: string[];
  connectionIds: string[];
  requiredCapabilities: string[];
  clientsInvolved: string[]; // list of client-node ids (usually one)
};

const TICK_INTERVAL = 33; // ~30 FPS

class NodeEngineClass {
  private runtime: NodeRuntime;

  // Nodes that are offloaded to the client runtime (skip execution + sinks on manager)
  private offloadedNodeIds = new Set<string>();
  private deployedLoopIds = new Set<string>();
  private disabledNodeIds = new Set<string>();

  // Stores for UI observation
  public graphState: Writable<GraphState> = writable({ nodes: [], connections: [] });
  public isRunning: Writable<boolean> = writable(false);
  public lastError: Writable<string | null> = writable(null);
  // Emits on every tick so the UI can render live values without forcing full graphState updates.
  public tickTime: Writable<number> = writable(0);
  public localLoops: Writable<LocalLoop[]> = writable([]);
  public deployedLoops: Writable<string[]> = writable([]);

  constructor() {
    this.runtime = new NodeRuntime(nodeRegistry, {
      tickIntervalMs: TICK_INTERVAL,
      isNodeEnabled: (nodeId) =>
        !this.offloadedNodeIds.has(nodeId) && !this.disabledNodeIds.has(nodeId),
      onTick: ({ time }) => {
        this.tickTime.set(time);
      },
      onWatchdog: (info) => {
        const message = info?.message ? String(info.message) : 'watchdog triggered';
        console.warn('[NodeEngine] watchdog triggered:', info?.reason, message, info?.diagnostics);
        this.lastError.set(message);
        this.isRunning.set(false);
      },
    });

    this.syncGraphState();
    this.updateLocalLoops();
  }

  // ========== Graph Manipulation ==========

  addNode(node: NodeInstance): void {
    const snapshot = this.runtime.exportGraph();
    const next: GraphState = {
      nodes: [
        ...snapshot.nodes,
        {
          ...node,
          config: { ...(node.config ?? {}) },
          inputValues: { ...(node.inputValues ?? {}) },
          outputValues: { ...(node.outputValues ?? {}) },
        },
      ],
      connections: [...snapshot.connections],
    };

    this.runtime.loadGraph(next);
    this.syncGraphState();
    this.updateLocalLoops();
  }

  removeNode(nodeId: string): void {
    const snapshot = this.runtime.exportGraph();
    const next: GraphState = {
      nodes: snapshot.nodes.filter((n) => n.id !== nodeId),
      connections: snapshot.connections.filter(
        (c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId
      ),
    };

    this.runtime.loadGraph(next);
    this.syncGraphState();
    this.updateLocalLoops();

    // Clear any modulation offsets contributed by this node
    const sourceId = `node-${nodeId}`;
    parameterRegistry.list().forEach((param) => param.clearModulation?.(sourceId, 'NODE'));
  }

  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = this.runtime.getNode(nodeId);
    if (!node) return;
    node.config = { ...node.config, ...config };
    this.syncGraphState();
  }

  updateNodeInputValue(nodeId: string, portId: string, value: unknown): void {
    const node = this.runtime.getNode(nodeId);
    if (!node) return;
    node.inputValues[portId] = value;
    // Avoid syncing graph state on every knob turn; graphState holds live references anyway.
  }

  updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    const node = this.runtime.getNode(nodeId);
    if (!node) return;
    node.position = position;
    // Don't sync graph state for position-only changes (performance)
  }

  addConnection(connection: Connection): boolean {
    const snapshot = this.runtime.exportGraph();

    // Check for duplicate
    const exists = snapshot.connections.some(
      (c) =>
        c.sourceNodeId === connection.sourceNodeId &&
        c.sourcePortId === connection.sourcePortId &&
        c.targetNodeId === connection.targetNodeId &&
        c.targetPortId === connection.targetPortId
    );
    if (exists) return false;

    // Type guard: ensure port types are compatible
    const sourceNode = snapshot.nodes.find((n) => n.id === connection.sourceNodeId);
    const targetNode = snapshot.nodes.find((n) => n.id === connection.targetNodeId);
    if (!sourceNode || !targetNode) return false;

    const sourceDef = nodeRegistry.get(sourceNode.type);
    const targetDef = nodeRegistry.get(targetNode.type);
    const sourcePort = sourceDef?.outputs.find((p) => p.id === connection.sourcePortId);
    const targetPort = targetDef?.inputs.find((p) => p.id === connection.targetPortId);

    if (!sourcePort || !targetPort) return false;
    const sourceType = sourcePort.type ?? 'any';
    const targetType = targetPort.type ?? 'any';
    const typeMismatch = sourceType !== 'any' && targetType !== 'any' && sourceType !== targetType;
    if (typeMismatch) {
      this.lastError.set(
        `Type mismatch: ${sourceType} -> ${targetType} (${sourceNode.id}:${sourcePort.id} → ${targetNode.id}:${targetPort.id})`
      );
      return false;
    }

    const next: GraphState = {
      nodes: snapshot.nodes,
      connections: [...snapshot.connections, connection],
    };

    // Validate cycles without mutating the live runtime first.
    try {
      const validator = new NodeRuntime(nodeRegistry);
      validator.loadGraph(next);
      validator.compileNow();
    } catch (err) {
      this.lastError.set(err instanceof Error ? err.message : 'Connection failed');
      return false;
    }

    this.runtime.loadGraph(next);
    this.runtime.compileNow();
    this.lastError.set(null);
    this.syncGraphState();
    this.updateLocalLoops();
    return true;
  }

  removeConnection(connectionId: string): void {
    const snapshot = this.runtime.exportGraph();
    const next: GraphState = {
      nodes: snapshot.nodes,
      connections: snapshot.connections.filter((c) => c.id !== connectionId),
    };

    this.runtime.loadGraph(next);
    this.syncGraphState();
    this.updateLocalLoops();
  }

  getNode(nodeId: string): NodeInstance | undefined {
    return this.runtime.getNode(nodeId);
  }

  // ========== Lifecycle ==========

  start(): void {
    this.runtime.setTickIntervalMs(TICK_INTERVAL);
    this.runtime.start();
    this.isRunning.set(true);
    console.log('[NodeEngine] Started');
  }

  stop(): void {
    this.runtime.stop();
    this.isRunning.set(false);
    console.log('[NodeEngine] Stopped');
  }

  clear(): void {
    this.stop();
    this.runtime.clear();
    this.offloadedNodeIds.clear();
    this.deployedLoopIds.clear();
    this.disabledNodeIds.clear();
    this.syncGraphState();
    this.updateLocalLoops();

    // Reset all node-origin modulation
    parameterRegistry.list().forEach((param) => param.clearModulation?.(undefined, 'NODE'));
  }

  // ========== Serialization ==========

  private syncGraphState(): void {
    this.graphState.set(this.runtime.getGraphRef());
  }

  loadGraph(state: GraphState): void {
    const sanitized: GraphState = {
      nodes: (state.nodes ?? []).map((node) => ({
        ...node,
        config: { ...(node.config ?? {}) },
        inputValues: { ...(node.inputValues ?? {}) },
        outputValues: {}, // reset runtime outputs
      })),
      connections: [...(state.connections ?? [])],
    };

    this.runtime.loadGraph(sanitized);
    this.offloadedNodeIds.clear();
    this.deployedLoopIds.clear();
    this.disabledNodeIds.clear();
    this.syncGraphState();
    this.updateLocalLoops();

    // Existing node modulations may no longer apply to new graph; clear them
    parameterRegistry.list().forEach((param) => param.clearModulation?.(undefined, 'NODE'));
  }

  exportGraph(): GraphState {
    return get(this.graphState);
  }

  // ========== Group / Disable Nodes ==========

  setNodesDisabled(nodeIds: string[], disabled: boolean): void {
    const ids = Array.isArray(nodeIds) ? nodeIds : [];
    for (const id of ids) {
      if (!id) continue;
      if (disabled) this.disabledNodeIds.add(id);
      else this.disabledNodeIds.delete(id);
    }
  }

  clearDisabledNodes(): void {
    this.disabledNodeIds.clear();
  }

  getDisabledNodeIds(): string[] {
    return Array.from(this.disabledNodeIds);
  }

  // ========== Local Loop Detection / Export ==========

  private updateLocalLoops(): void {
    try {
      const loops = this.detectLocalClientLoops();
      this.localLoops.set(loops);

      // If a loop vanished, clear its offload flags.
      const ids = new Set(loops.map((l) => l.id));
      for (const deployedId of Array.from(this.deployedLoopIds)) {
        if (!ids.has(deployedId)) {
          this.deployedLoopIds.delete(deployedId);
        }
      }

      // Rebuild offloaded nodes set from deployed loops.
      this.offloadedNodeIds.clear();
      for (const loop of loops) {
        if (!this.deployedLoopIds.has(loop.id)) continue;
        for (const nid of loop.nodeIds) this.offloadedNodeIds.add(nid);
      }
      this.deployedLoops.set(Array.from(this.deployedLoopIds));
    } catch (err) {
      console.warn('[NodeEngine] detectLocalClientLoops failed:', err);
      this.localLoops.set([]);
      this.offloadedNodeIds.clear();
      this.deployedLoopIds.clear();
      this.deployedLoops.set([]);
    }
  }

  private detectLocalClientLoops(): LocalLoop[] {
    const { nodes, connections } = this.runtime.getGraphRef();
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const conn of connections) {
      const outs = adj.get(conn.sourceNodeId) ?? [];
      outs.push(conn.targetNodeId);
      adj.set(conn.sourceNodeId, outs);
    }

    const isClient = (id: string) => nodeById.get(id)?.type === 'client-object';
    const isClientSensors = (id: string) => nodeById.get(id)?.type === 'proc-client-sensors';

    const indexById = new Map<string, number>();
    const lowById = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    let index = 0;
    const sccs: string[][] = [];

    const strongconnect = (v: string) => {
      indexById.set(v, index);
      lowById.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of adj.get(v) ?? []) {
        if (!indexById.has(w)) {
          strongconnect(w);
          lowById.set(v, Math.min(lowById.get(v)!, lowById.get(w)!));
        } else if (onStack.has(w)) {
          lowById.set(v, Math.min(lowById.get(v)!, indexById.get(w)!));
        }
      }

      if (lowById.get(v) === indexById.get(v)) {
        const component: string[] = [];
        while (stack.length > 0) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === v) break;
        }
        sccs.push(component);
      }
    };

    for (const n of nodes) {
      if (!indexById.has(n.id)) strongconnect(n.id);
    }

    const capabilityForNodeType = (type: string | undefined): string | null => {
      if (!type) return null;
      if (type === 'proc-client-sensors') return 'sensors';
      if (type === 'proc-flashlight') return 'flashlight';
      if (type === 'proc-screen-color') return 'screen';
      if (type === 'proc-synth-update') return 'sound';
      if (type === 'proc-scene-switch') return 'visual';
      return null;
    };

    const hashString = (input: string) => {
      let hash = 0;
      for (let i = 0; i < input.length; i++) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
      }
      return hash.toString(36);
    };

    const loops: LocalLoop[] = [];
    for (const component of sccs) {
      if (component.length === 0) continue;
      const nodeSet = new Set(component);

      // Single node SCC must have a self-loop to be a cycle.
      if (component.length === 1) {
        const only = component[0];
        const hasSelf = connections.some((c) => c.sourceNodeId === only && c.targetNodeId === only);
        if (!hasSelf) continue;
      }

      const clientNodes = component.filter(isClient);
      if (clientNodes.length !== 1) continue;
      const hasSensors = component.some(isClientSensors);
      if (!hasSensors) continue;

      const connIds = connections
        .filter((c) => nodeSet.has(c.sourceNodeId) && nodeSet.has(c.targetNodeId))
        .map((c) => c.id);

      const caps = new Set<string>();
      for (const nid of component) {
        const cap = capabilityForNodeType(nodeById.get(nid)?.type);
        if (cap) caps.add(cap);
      }

      const key = component.slice().sort().join(',');
      const loopId = `loop:${clientNodes[0]}:${hashString(key)}`;

      loops.push({
        id: loopId,
        nodeIds: component.slice(),
        connectionIds: connIds,
        requiredCapabilities: Array.from(caps),
        clientsInvolved: clientNodes,
      });
    }

    // Stable ordering for UI.
    loops.sort((a, b) => a.id.localeCompare(b.id));
    return loops;
  }

  /**
   * Mark a detected loop as deployed (manager will stop executing that subgraph).
   */
  markLoopDeployed(loopId: string, deployed: boolean): void {
    if (deployed) this.deployedLoopIds.add(loopId);
    else this.deployedLoopIds.delete(loopId);
    this.updateLocalLoops();
  }

  /**
   * Export a minimal loop subgraph for client-side execution.
   * Throws if the loop contains node types outside the client whitelist.
   */
  exportGraphForLoop(loopId: string): {
    graph: Pick<GraphState, 'nodes' | 'connections'>;
    meta: {
      loopId: string;
      requiredCapabilities: string[];
      tickIntervalMs: number;
      protocolVersion: typeof PROTOCOL_VERSION;
      executorVersion: string;
    };
  } {
    const loop = get(this.localLoops).find((l) => l.id === loopId);
    if (!loop) throw new Error(`Loop not found: ${loopId}`);

    const allowedNodeTypes = new Set([
      'client-object',
      'proc-client-sensors',
      'math',
      'lfo',
      'number',
      'proc-flashlight',
      'proc-screen-color',
      'proc-synth-update',
      'proc-scene-switch',
    ]);

    const nodes: GraphState['nodes'] = [];
    for (const id of loop.nodeIds) {
      const node = this.runtime.getNode(id);
      if (!node) continue;
      if (!allowedNodeTypes.has(node.type)) {
        throw new Error(`Loop contains non-deployable node type: ${node.type}`);
      }
      nodes.push({
        id: node.id,
        type: node.type,
        position: node.position,
        config: { ...(node.config ?? {}) },
        inputValues: { ...(node.inputValues ?? {}) },
        outputValues: {}, // stripped
      });
    }

    const nodeSet = new Set(nodes.map((n) => n.id));
    const { connections } = this.runtime.getGraphRef();
    const loopConnections = connections.filter(
      (c) => nodeSet.has(c.sourceNodeId) && nodeSet.has(c.targetNodeId)
    );

    return {
      graph: { nodes, connections: loopConnections },
      meta: {
        loopId,
        requiredCapabilities: loop.requiredCapabilities,
        tickIntervalMs: TICK_INTERVAL,
        protocolVersion: PROTOCOL_VERSION,
        executorVersion: 'node-executor-v1',
      },
    };
  }
}

// Singleton instance
export const nodeEngine = new NodeEngineClass();
