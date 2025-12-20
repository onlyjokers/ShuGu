/**
 * Purpose: Compute MIDI activity highlight state for node/connection graphs.
 */
import type { Connection, GraphState } from '$lib/nodes/types';

export type MidiHighlightState = {
  nodeIds: Set<string>;
  connectionIds: Set<string>;
  inputPortsByNode: Map<string, Set<string>>;
  outputPortsByNode: Map<string, Set<string>>;
};

export type MidiHighlightOptions = {
  event: { type: string; normalized?: number; isPress?: boolean };
  graph: GraphState;
  disabledNodeIds: Set<string>;
  selectedInputId: string | null;
  sourceNodeTypes: Set<string>;
  traversalStopNodeTypes: Set<string>;
  midiSourceMatchesEvent: (source: unknown, event: unknown, selectedInputId: string | null) => boolean;
};

export function computeMidiHighlightState(opts: MidiHighlightOptions): MidiHighlightState | null {
  const {
    event,
    graph,
    disabledNodeIds,
    selectedInputId,
    sourceNodeTypes,
    traversalStopNodeTypes,
    midiSourceMatchesEvent,
  } = opts;

  const nodeTypeById = new Map((graph.nodes ?? []).map((n) => [String(n.id), String(n.type)]));
  const sourceNodeIds = (graph.nodes ?? [])
    .filter((n) => sourceNodeTypes.has(String(n.type)))
    .filter((n) => midiSourceMatchesEvent((n.config as any)?.source, event, selectedInputId))
    .map((n) => String(n.id))
    .filter((id) => !disabledNodeIds.has(id));

  if (sourceNodeIds.length === 0) return null;

  const outsByNode = new Map<string, Connection[]>();
  for (const c of graph.connections ?? []) {
    const src = String(c.sourceNodeId);
    const list = outsByNode.get(src) ?? [];
    list.push(c);
    outsByNode.set(src, list);
  }

  const nextNodeIds = new Set<string>();
  const nextConnIds = new Set<string>();
  const nextInputsByNode = new Map<string, Set<string>>();
  const nextOutputsByNode = new Map<string, Set<string>>();

  const queue: string[] = [];
  const visited = new Set<string>();
  for (const id of sourceNodeIds) {
    nextNodeIds.add(id);
    queue.push(id);
    visited.add(id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const conn of outsByNode.get(nodeId) ?? []) {
      const connId = String(conn.id);
      const targetNodeId = String(conn.targetNodeId);
      const sourcePortId = String(conn.sourcePortId);
      const targetPortId = String(conn.targetPortId);
      const targetType = nodeTypeById.get(targetNodeId) ?? '';
      const targetDisabled = disabledNodeIds.has(targetNodeId);
      const stopAtTarget = traversalStopNodeTypes.has(targetType);

      if (targetDisabled) continue;

      nextConnIds.add(connId);

      const outSet = nextOutputsByNode.get(nodeId) ?? new Set<string>();
      outSet.add(sourcePortId);
      nextOutputsByNode.set(nodeId, outSet);

      if (!stopAtTarget) {
        nextNodeIds.add(targetNodeId);

        const inSet = nextInputsByNode.get(targetNodeId) ?? new Set<string>();
        inSet.add(targetPortId);
        nextInputsByNode.set(targetNodeId, inSet);

        if (!visited.has(targetNodeId)) {
          visited.add(targetNodeId);
          queue.push(targetNodeId);
        }
      }
    }
  }

  return {
    nodeIds: nextNodeIds,
    connectionIds: nextConnIds,
    inputPortsByNode: nextInputsByNode,
    outputPortsByNode: nextOutputsByNode,
  };
}
