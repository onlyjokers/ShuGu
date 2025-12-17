/**
 * NodeEngine - Headless Singleton for Node Graph Execution
 * 
 * Key Features:
 * - Survives UI lifecycle (tab switches)
 * - Compile-Run separation for O(N) tick performance
 * - Cycle detection in compile phase
 */
import { writable, get, type Writable } from 'svelte/store';
import type { NodeInstance, Connection, ProcessContext, GraphState } from './types';
import { nodeRegistry } from './registry';
import { parameterRegistry } from '../parameters/registry';
import { PROTOCOL_VERSION } from '@shugu/protocol';

export type LocalLoop = {
  id: string;
  nodeIds: string[];
  connectionIds: string[];
  requiredCapabilities: string[];
  clientsInvolved: string[]; // list of client-node ids (usually one)
};

const TICK_INTERVAL = 33; // ~30 FPS

class NodeEngineClass {
  // Graph State
  private nodes = new Map<string, NodeInstance>();
  private connections: Connection[] = [];
  
  // Execution Cache (compiled)
  private executionOrder: NodeInstance[] = [];
  private needsRecompile = true;
  
  // Runtime
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickTime = 0;
  
  // Stores for UI observation
  public graphState: Writable<GraphState> = writable({ nodes: [], connections: [] });
  public isRunning: Writable<boolean> = writable(false);
  public lastError: Writable<string | null> = writable(null);
  // Emits on every tick so the UI can render live values without forcing full graphState updates.
  public tickTime: Writable<number> = writable(0);
  public localLoops: Writable<LocalLoop[]> = writable([]);
  public deployedLoops: Writable<string[]> = writable([]);

  // Nodes that are offloaded to the client runtime (skip execution + sinks on manager)
  private offloadedNodeIds = new Set<string>();
  private deployedLoopIds = new Set<string>();

  // ========== Graph Manipulation ==========

  addNode(node: NodeInstance): void {
    this.nodes.set(node.id, node);
    this.syncGraphState();
    this.updateLocalLoops();
  }

  removeNode(nodeId: string): void {
    // Remove node
    this.nodes.delete(nodeId);
    
    // Remove connected edges
    this.connections = this.connections.filter(
      (c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId
    );
    
    this.needsRecompile = true;
    this.syncGraphState();
    this.updateLocalLoops();

    // Clear any modulation offsets contributed by this node
    const sourceId = `node-${nodeId}`;
    parameterRegistry.list().forEach((param) => param.clearModulation?.(sourceId, 'NODE'));
  }

  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.config = { ...node.config, ...config };
      this.syncGraphState();
    }
  }

  updateNodeInputValue(nodeId: string, portId: string, value: unknown): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.inputValues[portId] = value;
    // Avoid syncing graph state on every knob turn; graphState holds live references anyway.
  }

  updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.position = position;
      // Don't sync graph state for position-only changes (performance)
    }
  }

  addConnection(connection: Connection): boolean {
    // Check for duplicate
    const exists = this.connections.some(
      (c) =>
        c.sourceNodeId === connection.sourceNodeId &&
        c.sourcePortId === connection.sourcePortId &&
        c.targetNodeId === connection.targetNodeId &&
        c.targetPortId === connection.targetPortId
    );
    if (exists) return false;

    // Type guard: ensure port types are compatible
    const sourceNode = this.nodes.get(connection.sourceNodeId);
    const targetNode = this.nodes.get(connection.targetNodeId);
    if (!sourceNode || !targetNode) return false;

    const sourceDef = nodeRegistry.get(sourceNode.type);
    const targetDef = nodeRegistry.get(targetNode.type);
    const sourcePort = sourceDef?.outputs.find((p) => p.id === connection.sourcePortId);
    const targetPort = targetDef?.inputs.find((p) => p.id === connection.targetPortId);

    if (!sourcePort || !targetPort) return false;
    const sourceType = sourcePort.type ?? 'any';
    const targetType = targetPort.type ?? 'any';
    const typeMismatch =
      sourceType !== 'any' && targetType !== 'any' && sourceType !== targetType;
    if (typeMismatch) {
      this.lastError.set(
        `Type mismatch: ${sourceType} -> ${targetType} (${sourceNode.id}:${sourcePort.id} → ${targetNode.id}:${targetPort.id})`
      );
      return false;
    }

    // Temporarily add connection to check for cycles
    this.connections.push(connection);
    
    try {
      this.compile();
      this.syncGraphState();
      this.updateLocalLoops();
      return true;
    } catch (err) {
      // Cycle detected, rollback
      this.connections.pop();
      this.lastError.set(err instanceof Error ? err.message : 'Connection failed');
      return false;
    }
  }

  removeConnection(connectionId: string): void {
    this.connections = this.connections.filter((c) => c.id !== connectionId);
    this.needsRecompile = true;
    this.syncGraphState();
    this.updateLocalLoops();
  }

  getNode(nodeId: string): NodeInstance | undefined {
    return this.nodes.get(nodeId);
  }

  // ========== Compile Phase (O(V+E)) ==========

  private compile(): void {
    const nodes = Array.from(this.nodes.values());
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    
    // Build adjacency list (inbound edges for each node)
    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>(); // sourceId -> [targetIds]
    
    for (const node of nodes) {
      inDegree.set(node.id, 0);
      outEdges.set(node.id, []);
    }
    
    for (const conn of this.connections) {
      const targetNode = nodeMap.get(conn.targetNodeId);
      if (targetNode) {
        const targetDef = nodeRegistry.get(targetNode.type);
        const targetPort = targetDef?.inputs.find((p) => p.id === conn.targetPortId);
        // Sink edges do not participate in the execution DAG.
        if (targetPort?.kind === 'sink') continue;
      }

      const currentIn = inDegree.get(conn.targetNodeId) ?? 0;
      inDegree.set(conn.targetNodeId, currentIn + 1);
      
      const outs = outEdges.get(conn.sourceNodeId) ?? [];
      if (!outs.includes(conn.targetNodeId)) {
        outs.push(conn.targetNodeId);
        outEdges.set(conn.sourceNodeId, outs);
      }
    }

    // Kahn's Algorithm
    const queue: string[] = [];
    const result: NodeInstance[] = [];
    
    // Start with nodes that have no incoming edges
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }
    
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) {
        result.push(node);
      }
      
      for (const targetId of outEdges.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(targetId) ?? 1) - 1;
        inDegree.set(targetId, newDegree);
        if (newDegree === 0) {
          queue.push(targetId);
        }
      }
    }

    // Cycle Detection: if we haven't processed all nodes, there's a cycle
    if (result.length !== nodes.length) {
      throw new Error('Cycle detected in node graph! Connection rejected.');
    }

    this.executionOrder = result;
    this.needsRecompile = false;
    this.lastError.set(null);
  }

  // ========== Tick Phase (O(N)) ==========

  private tick(): void {
    if (this.needsRecompile) {
      try {
        this.compile();
      } catch (err) {
        console.error('[NodeEngine] Compile error:', err);
        return;
      }
    }

    const now = Date.now();
    const deltaTime = this.lastTickTime > 0 ? now - this.lastTickTime : TICK_INTERVAL;
    this.lastTickTime = now;

    const context: ProcessContext = {
      nodeId: '',
      time: now,
      deltaTime,
    };

    // Propagate values through the graph
    for (const node of this.executionOrder) {
      if (this.offloadedNodeIds.has(node.id)) continue;
      const definition = nodeRegistry.get(node.type);
      if (!definition) continue;

      // Gather inputs from connected outputs
      const inputs: Record<string, unknown> = {};
      for (const port of definition.inputs) {
        if (port.kind === 'sink') continue;
        // Check for connected output
        const conn = this.connections.find(
          (c) => c.targetNodeId === node.id && c.targetPortId === port.id
        );
        if (conn) {
          const sourceNode = this.nodes.get(conn.sourceNodeId);
          if (sourceNode) {
            inputs[port.id] = sourceNode.outputValues[conn.sourcePortId];
          }
        } else {
          // Use default or stored input value
          inputs[port.id] = node.inputValues[port.id] ?? port.defaultValue;
          // Preserve manual values even if this input becomes connected later.
          // (ComfyUI-style: connecting disables the widget but doesn't overwrite its value.)
          node.inputValues[port.id] = inputs[port.id];
        }
      }

      // Execute node
      context.nodeId = node.id;
      try {
        const outputs = definition.process(inputs, node.config, context);
        node.outputValues = outputs;
      } catch (err) {
        console.error(`[NodeEngine] Error in node ${node.id}:`, err);
      }
    }

    // Deliver sink inputs (side effects) after compute pass
    for (const node of this.executionOrder) {
      if (this.offloadedNodeIds.has(node.id)) continue;
      const definition = nodeRegistry.get(node.type);
      if (!definition?.onSink) continue;

      const sinkInputs: Record<string, unknown> = {};
      for (const conn of this.connections) {
        if (conn.targetNodeId !== node.id) continue;

        const port = definition.inputs.find((p) => p.id === conn.targetPortId);
        if (!port || port.kind !== 'sink') continue;

        const sourceNode = this.nodes.get(conn.sourceNodeId);
        if (!sourceNode) continue;

        const value = sourceNode.outputValues[conn.sourcePortId];
        const prev = sinkInputs[conn.targetPortId];
        if (prev === undefined) {
          sinkInputs[conn.targetPortId] = value;
        } else if (Array.isArray(prev)) {
          prev.push(value);
        } else {
          sinkInputs[conn.targetPortId] = [prev, value];
        }
      }

      if (Object.keys(sinkInputs).length === 0) continue;

      let changed = false;
      for (const [portId, next] of Object.entries(sinkInputs)) {
        if (!this.deepEqual(node.inputValues[portId], next)) {
          changed = true;
        }
        node.inputValues[portId] = next;
      }

      if (!changed) continue;
      context.nodeId = node.id;
      try {
        definition.onSink(sinkInputs, node.config, context);
      } catch (err) {
        console.error(`[NodeEngine] Sink handler error in node ${node.id}:`, err);
      }
    }

    // Notify observers that a new tick has completed (useful for live port value display).
    this.tickTime.set(now);
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

  // ========== Lifecycle ==========

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
    this.isRunning.set(true);
    console.log('[NodeEngine] Started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning.set(false);
    console.log('[NodeEngine] Stopped');
  }

  clear(): void {
    this.stop();
    this.nodes.clear();
    this.connections = [];
    this.executionOrder = [];
    this.needsRecompile = true;
    this.offloadedNodeIds.clear();
    this.deployedLoopIds.clear();
    this.syncGraphState();
    this.updateLocalLoops();

    // Reset all node-origin modulation
    parameterRegistry.list().forEach((param) => param.clearModulation?.(undefined, 'NODE'));
  }

  // ========== Serialization ==========

  private syncGraphState(): void {
    this.graphState.set({
      nodes: Array.from(this.nodes.values()),
      connections: [...this.connections],
    });
  }

  loadGraph(state: GraphState): void {
    this.nodes.clear();
    for (const node of state.nodes) {
      this.nodes.set(node.id, { ...node, inputValues: { ...(node.inputValues ?? {}) }, outputValues: {} });
    }
    this.connections = [...state.connections];
    this.needsRecompile = true;
    this.offloadedNodeIds.clear();
    this.deployedLoopIds.clear();
    this.syncGraphState();
    this.updateLocalLoops();

    // Existing node modulations may no longer apply to new graph; clear them
    parameterRegistry.list().forEach((param) => param.clearModulation?.(undefined, 'NODE'));
  }

  exportGraph(): GraphState {
    return get(this.graphState);
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
    const nodes = Array.from(this.nodes.values());
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const conn of this.connections) {
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
        const hasSelf = this.connections.some((c) => c.sourceNodeId === only && c.targetNodeId === only);
        if (!hasSelf) continue;
      }

      const clientNodes = component.filter(isClient);
      if (clientNodes.length !== 1) continue;
      const hasSensors = component.some(isClientSensors);
      if (!hasSensors) continue;

      const connIds = this.connections
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
      const node = this.nodes.get(id);
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
    const connections = this.connections.filter(
      (c) => nodeSet.has(c.sourceNodeId) && nodeSet.has(c.targetNodeId)
    );

    return {
      graph: { nodes, connections },
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
