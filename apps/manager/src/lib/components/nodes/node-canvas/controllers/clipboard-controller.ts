/**
 * Purpose: Clipboard (copy/paste) handling for NodeCanvas.
 */

import { get } from 'svelte/store';
import type { Connection as EngineConnection, GraphState, NodeInstance } from '$lib/nodes/types';
import type { GraphViewAdapter } from '../adapters';
import type { GroupController } from './group-controller';

export type ClipboardController = {
  copySelectedNodes: () => boolean;
  pasteCopiedNodes: () => boolean;
};

export type CreateClipboardControllerOptions = {
  getContainer: () => HTMLDivElement | null;
  nodeEngine: any;
  adapter: GraphViewAdapter;
  getGraphState: () => GraphState;
  getNodeCount: () => number;
  getSelectedNodeId: () => string;
  setSelectedNode: (nodeId: string) => void;
  groupController: GroupController;
  getLastPointerClient: () => { x: number; y: number };
  computeGraphPosition: (clientX: number, clientY: number) => { x: number; y: number };
  generateId: () => string;
};

export function createClipboardController(opts: CreateClipboardControllerOptions): ClipboardController {
  const {
    getContainer,
    nodeEngine,
    adapter,
    getGraphState,
    getNodeCount,
    getSelectedNodeId,
    setSelectedNode,
    groupController,
    getLastPointerClient,
    computeGraphPosition,
    generateId,
  } = opts;

  let clipboardNodes: NodeInstance[] = [];
  // Track internal connections so paste can restore them.
  let clipboardConnections: EngineConnection[] = [];
  let clipboardPasteIndex = 0;

  const cloneNodeInstance = (
    node: NodeInstance,
    positionOverride?: { x: number; y: number } | null
  ): NodeInstance => ({
    id: String(node.id),
    type: node.type,
    position: {
      x: Number(positionOverride?.x ?? node.position?.x ?? 0),
      y: Number(positionOverride?.y ?? node.position?.y ?? 0),
    },
    config: { ...(node.config ?? {}) },
    inputValues: { ...(node.inputValues ?? {}) },
    outputValues: { ...(node.outputValues ?? {}) },
  });

  const collectCopySelection = (): { nodes: NodeInstance[]; ids: string[] } => {
    const selected = get(groupController.groupSelectionNodeIds);
    const selectedNodeId = String(getSelectedNodeId() ?? '');
    const ids =
      selected.size > 0
        ? Array.from(selected).map(String)
        : selectedNodeId
          ? [selectedNodeId]
          : [];
    if (ids.length === 0) return { nodes: [], ids: [] };

    const graphState = getGraphState();
    const nodeById = new Map((graphState.nodes ?? []).map((node) => [String(node.id), node]));
    const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as NodeInstance[];

    return {
      nodes: nodes.map((node) => cloneNodeInstance(node, adapter.getNodePosition(String(node.id)))),
      ids,
    };
  };

  const collectCopyConnections = (ids: string[]): EngineConnection[] => {
    const set = new Set(ids.map(String));
    const state = getGraphState();
    return (state.connections ?? [])
      .filter((c) => set.has(String(c.sourceNodeId)) && set.has(String(c.targetNodeId)))
      .map((c) => ({
        id: String(c.id),
        sourceNodeId: String(c.sourceNodeId),
        sourcePortId: String(c.sourcePortId),
        targetNodeId: String(c.targetNodeId),
        targetPortId: String(c.targetPortId),
      }));
  };

  const copySelectedNodes = () => {
    const { nodes, ids } = collectCopySelection();
    if (nodes.length === 0) return false;
    clipboardNodes = nodes;
    clipboardConnections = collectCopyConnections(ids);
    clipboardPasteIndex = 0;
    return true;
  };

  const computePasteAnchor = () => {
    const container = getContainer();
    if (!container) {
      const count = getNodeCount();
      return { x: 120 + count * 10, y: 120 + count * 6 };
    }
    const rect = container.getBoundingClientRect();
    const pointer = getLastPointerClient();
    const within =
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom;
    if (within) return computeGraphPosition(pointer.x, pointer.y);
    return computeGraphPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const pasteCopiedNodes = () => {
    if (clipboardNodes.length === 0) return false;

    const anchor = computePasteAnchor();
    const positions = clipboardNodes.map((node) => node.position);
    const minX = Math.min(...positions.map((p) => p.x));
    const minY = Math.min(...positions.map((p) => p.y));
    const maxX = Math.max(...positions.map((p) => p.x));
    const maxY = Math.max(...positions.map((p) => p.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nudge = clipboardPasteIndex * 28;
    const offsetX = anchor.x - centerX + nudge;
    const offsetY = anchor.y - centerY + nudge;

    const newIds: string[] = [];
    const idMap = new Map<string, string>();
    for (const node of clipboardNodes) {
      const newId = generateId();
      const position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
      const newNode: NodeInstance = {
        id: newId,
        type: node.type,
        position,
        config: { ...(node.config ?? {}) },
        inputValues: { ...(node.inputValues ?? {}) },
        outputValues: { ...(node.outputValues ?? {}) },
      };
      nodeEngine.addNode(newNode);
      groupController.autoAddNodeToGroupFromPosition(newId, position);
      newIds.push(newId);
      idMap.set(String(node.id), newId);
    }

    if (clipboardConnections.length > 0 && idMap.size > 0) {
      for (const conn of clipboardConnections) {
        const sourceNodeId = idMap.get(String(conn.sourceNodeId));
        const targetNodeId = idMap.get(String(conn.targetNodeId));
        if (!sourceNodeId || !targetNodeId) continue;
        const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
        const engineConn: EngineConnection = {
          id: connId,
          sourceNodeId,
          sourcePortId: String(conn.sourcePortId),
          targetNodeId,
          targetPortId: String(conn.targetPortId),
        };
        nodeEngine.addConnection(engineConn);
      }
    }

    clipboardPasteIndex += 1;

    if (newIds.length === 1) {
      groupController.clearSelection();
      setSelectedNode(newIds[0] ?? '');
    } else if (newIds.length > 1) {
      groupController.groupSelectionNodeIds.set(new Set(newIds));
      groupController.scheduleHighlight();
      groupController.requestFramesUpdate();
    }

    return true;
  };

  return { copySelectedNodes, pasteCopiedNodes };
}
