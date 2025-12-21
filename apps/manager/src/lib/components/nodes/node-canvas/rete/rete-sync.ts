/**
 * Purpose: Sync the node engine graph into the Rete editor view.
 */
import { ClassicPreset, type NodeEditor } from 'rete';
import type { AreaPlugin } from 'rete-area-plugin';
import type { NodeRegistry } from '@shugu/node-core';
import type { Connection as EngineConnection, GraphState, NodeInstance } from '$lib/nodes/types';

type AnyAreaPlugin = AreaPlugin<any, any>;

type GraphSyncOptions = {
  editor: NodeEditor<any> | null;
  areaPlugin: AnyAreaPlugin | null;
  nodeMap: Map<string, any>;
  connectionMap: Map<string, any>;
  nodeRegistry: NodeRegistry;
  buildReteNode: (instance: NodeInstance) => any;
  nodeLabel: (node: NodeInstance) => string;
  applyMidiMapRangeConstraints: (
    state: { nodes: NodeInstance[]; connections: EngineConnection[] },
    areaPlugin: AnyAreaPlugin | null,
    nodeMap: Map<string, any>
  ) => Promise<void>;
  setGraphState: (state: GraphState) => void;
  setNodeCount: (count: number) => void;
  getSelectedNodeId: () => string;
  onAfterSync: () => void;
  isSyncingRef: { value: boolean };
};

export type GraphSyncController = {
  schedule: (state: { nodes: NodeInstance[]; connections: EngineConnection[] }) => Promise<void> | null;
};

export function createGraphSync(opts: GraphSyncOptions): GraphSyncController {
  let queuedGraphState: { nodes: NodeInstance[]; connections: EngineConnection[] } | null = null;
  let syncLoop: Promise<void> | null = null;

  const syncGraph = async (state: { nodes: NodeInstance[]; connections: EngineConnection[] }) => {
    if (!opts.editor || !opts.areaPlugin) return;

    opts.isSyncingRef.value = true;
    try {
      opts.setGraphState(state);
      opts.setNodeCount(state.nodes.length);

      const engineNodeIds = new Set(state.nodes.map((n) => n.id));
      const engineConnIds = new Set(state.connections.map((c) => c.id));

      for (const n of state.nodes) {
        let reteNode = opts.nodeMap.get(n.id);
        if (!reteNode) {
          const existing = opts.editor.getNode(n.id);
          if (existing) {
            reteNode = existing;
            opts.nodeMap.set(n.id, reteNode);
          } else {
            reteNode = opts.buildReteNode(n);
            await opts.editor.addNode(reteNode);
            opts.nodeMap.set(n.id, reteNode);
            if (n.id === opts.getSelectedNodeId()) {
              reteNode.selected = true;
              await opts.areaPlugin.update('node', n.id);
            }
          }
        } else {
          const nextLabel = opts.nodeLabel(n);
          if (reteNode.label !== nextLabel) {
            reteNode.label = nextLabel;
            await opts.areaPlugin.update('node', reteNode.id);
          }
        }
        await opts.areaPlugin.translate(reteNode.id, { x: n.position.x, y: n.position.y });
      }

      for (const c of state.connections) {
        if (opts.connectionMap.has(c.id)) continue;
        const existing = opts.editor.getConnection(c.id);
        if (existing) {
          opts.connectionMap.set(c.id, existing);
          continue;
        }
        const src = opts.nodeMap.get(c.sourceNodeId);
        const tgt = opts.nodeMap.get(c.targetNodeId);
        if (!src || !tgt) continue;
        const conn: any = new ClassicPreset.Connection(src, c.sourcePortId, tgt, c.targetPortId);
        conn.id = c.id;
        await opts.editor.addConnection(conn);
        opts.connectionMap.set(c.id, conn);
      }

      for (const conn of opts.editor.getConnections()) {
        const id = String((conn as any).id);
        if (engineConnIds.has(id)) continue;
        try {
          await opts.editor.removeConnection(id);
        } catch {
          // ignore
        }
        opts.connectionMap.delete(id);
      }

      for (const node of opts.editor.getNodes()) {
        const id = String((node as any).id);
        if (engineNodeIds.has(id)) continue;
        try {
          await opts.editor.removeNode(id);
        } catch {
          // ignore
        }
        opts.nodeMap.delete(id);
      }

      const connectedInputs = new Set<string>();
      for (const c of state.connections) connectedInputs.add(`${c.targetNodeId}:${c.targetPortId}`);

      for (const n of state.nodes) {
        const reteNode = opts.nodeMap.get(n.id);
        if (!reteNode) continue;
        const def = opts.nodeRegistry.get(n.type);
        let updated = false;
        for (const port of def?.inputs ?? []) {
          const input = reteNode?.inputs?.[port.id];
          const control = input?.control as any;
          if (!control) continue;
          const nextReadonly = connectedInputs.has(`${n.id}:${port.id}`);
          if (Boolean(control.readonly) !== nextReadonly) {
            control.readonly = nextReadonly;
            updated = true;
          }
        }
        if (updated) await opts.areaPlugin.update('node', n.id);
      }

      await opts.applyMidiMapRangeConstraints(state, opts.areaPlugin, opts.nodeMap);
    } finally {
      opts.isSyncingRef.value = false;
      opts.onAfterSync();
    }
  };

  const schedule = (state: { nodes: NodeInstance[]; connections: EngineConnection[] }) => {
    queuedGraphState = state;
    if (syncLoop) return syncLoop;
    syncLoop = (async () => {
      while (queuedGraphState) {
        const next = queuedGraphState;
        queuedGraphState = null;
        try {
          await syncGraph(next);
        } catch (err) {
          console.error('[NodeCanvas] syncGraph failed', err);
        }
      }
    })().finally(() => {
      syncLoop = null;
    });
    return syncLoop;
  };

  return { schedule };
}
