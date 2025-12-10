/**
 * NodeEngine - Headless Singleton for Node Graph Execution
 * 
 * Key Features:
 * - Survives UI lifecycle (tab switches)
 * - Compile-Run separation for O(N) tick performance
 * - Cycle detection in compile phase
 */
import { writable, get, type Writable } from 'svelte/store';
import type { NodeInstance, Connection, NodeDefinition, ProcessContext, GraphState } from './types';
import { nodeRegistry } from './registry';

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

  // ========== Graph Manipulation ==========

  addNode(node: NodeInstance): void {
    this.nodes.set(node.id, node);
    this.syncGraphState();
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
  }

  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.config = { ...node.config, ...config };
      this.syncGraphState();
    }
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

    // Temporarily add connection to check for cycles
    this.connections.push(connection);
    
    try {
      this.compile();
      this.syncGraphState();
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
      const definition = nodeRegistry.get(node.type);
      if (!definition) continue;

      // Gather inputs from connected outputs
      const inputs: Record<string, unknown> = {};
      for (const port of definition.inputs) {
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
    this.syncGraphState();
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
      this.nodes.set(node.id, { ...node, inputValues: {}, outputValues: {} });
    }
    this.connections = [...state.connections];
    this.needsRecompile = true;
    this.syncGraphState();
  }

  exportGraph(): GraphState {
    return get(this.graphState);
  }
}

// Singleton instance
export const nodeEngine = new NodeEngineClass();
