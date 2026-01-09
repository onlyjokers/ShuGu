/**
 * Purpose: Maintain manager-only Group Port nodes (ensure they exist, align them to frames, and sync runtime active gates).
 */

import { get } from 'svelte/store';
import type { NodeInstance } from '$lib/nodes/types';
import type { GraphViewAdapter } from '../adapters';
import type { GroupController } from './group-controller';
import {
  buildGroupPortIndex,
  groupIdFromNode,
  isGroupPortNodeType,
  GROUP_ACTIVATE_NODE_TYPE,
} from '../utils/group-port-utils';

export type GroupPortNodesController = {
  ensureGroupPortNodes: () => void;
  scheduleAlign: () => void;
  updateRuntimeActives: () => void;
  removeGroupPortNodesForGroupIds: (groupIds: string[]) => number;
  disassembleGroupAndPorts: (groupId: string) => void;
  destroy: () => void;
};

export type CreateGroupPortNodesControllerOptions = {
  nodeEngine: any;
  nodeRegistry: any;
  adapter: GraphViewAdapter;
  groupController: GroupController;
  getNodeCount: () => number;
  generateId: () => string;
};

export function createGroupPortNodesController(
  opts: CreateGroupPortNodesControllerOptions
): GroupPortNodesController {
  const { nodeEngine, nodeRegistry, adapter, groupController, getNodeCount, generateId } = opts;

  let alignRaf = 0;

  const computeGroupNodeBounds = (group: any, state: { nodes: any[] }) => {
    const ids = Array.isArray(group?.nodeIds) ? group.nodeIds.map(String).filter(Boolean) : [];
    if (ids.length === 0) return null;

    const nodeById = new Map((state.nodes ?? []).map((n) => [String(n.id), n]));

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const id of ids) {
      const node = nodeById.get(id);
      if (!node) continue;
      const x = Number(node.position?.x ?? 0);
      const y = Number(node.position?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const ok =
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxY);
    if (!ok) return null;

    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  };

  const addGroupPortNode = (type: string, groupId: string, position: { x: number; y: number }) => {
    const def = nodeRegistry.get(type);
    if (!def) return '';

    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) config[field.key] = field.defaultValue;
    config.groupId = groupId;

    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position,
      config,
      inputValues: {},
      outputValues: {},
    };

    nodeEngine.addNode(newNode);
    return newNode.id;
  };

  const ensureGroupPortNodes = () => {
    const groups = get(groupController.nodeGroups);
    if (groups.length === 0) return;

    const state = nodeEngine.exportGraph();
    const index = buildGroupPortIndex(state);

    for (const group of groups) {
      const groupId = String(group?.id ?? '');
      if (!groupId) continue;
      const existing = index.get(groupId) ?? {};
      if (existing.activateId) continue;

      const bounds = computeGroupNodeBounds(group, state);
      const count = getNodeCount();
      const baseX = bounds ? bounds.centerX : 120 + count * 10;
      const baseY = bounds ? bounds.centerY : 120 + count * 6;
      const leftX = bounds ? bounds.minX : baseX;

      if (!existing.activateId) {
        addGroupPortNode(GROUP_ACTIVATE_NODE_TYPE, groupId, { x: leftX - 140, y: baseY - 20 });
      }
    }
  };

  const alignGroupPortNodes = () => {
    const frames = get(groupController.groupFrames);
    if (frames.length === 0) return;

    const state = nodeEngine.exportGraph();
    const index = buildGroupPortIndex(state);

    groupController.beginProgrammaticTranslate();
    try {
      for (const frame of frames) {
        const groupId = String(frame.group?.id ?? '');
        if (!groupId) continue;
        const ports = index.get(groupId);
        if (!ports) continue;

        const centerY = frame.top + frame.height / 2;

        if (ports.activateId) {
          const nodeId = String(ports.activateId);
          const b = adapter.getNodeBounds(nodeId);
          const w = b ? b.right - b.left : 72;
          const h = b ? b.bottom - b.top : 40;
          // Place the Activate port fully outside the Group frame (to the left) with a small gap,
          // instead of straddling the frame edge.
          const gap = 18;
          const desiredX = frame.left - w - gap;
          const desiredY = centerY - h / 2;
          const cur = adapter.getNodePosition(nodeId);
          if (!cur || Math.abs(cur.x - desiredX) > 1 || Math.abs(cur.y - desiredY) > 1) {
            adapter.setNodePosition(nodeId, desiredX, desiredY);
          }
        }
      }
    } finally {
      groupController.endProgrammaticTranslate();
    }
  };

  const scheduleAlign = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (alignRaf) return;
    alignRaf = requestAnimationFrame(() => {
      alignRaf = 0;
      alignGroupPortNodes();
    });
  };

  const updateRuntimeActives = () => {
    const groups = get(groupController.nodeGroups);
    if (groups.length === 0) return;

    const state = nodeEngine.exportGraph();
    const activeByGroupId = new Map<string, boolean>();

    for (const node of state.nodes ?? []) {
      if (String(node.type) !== GROUP_ACTIVATE_NODE_TYPE) continue;
      const groupId = groupIdFromNode(node);
      if (!groupId) continue;
      const raw = (node.outputValues as any)?.active;
      activeByGroupId.set(groupId, typeof raw === 'boolean' ? raw : true);
    }

    groupController.setRuntimeActiveByGroupId(activeByGroupId);
  };

  const removeGroupPortNodesForGroupIds = (groupIds: string[]): number => {
    const ids = new Set((groupIds ?? []).map((id) => String(id)).filter(Boolean));
    if (ids.size === 0) return 0;

    let removed = 0;
    const state = nodeEngine.exportGraph();
    for (const node of state.nodes ?? []) {
      const type = String(node.type ?? '');
      if (!isGroupPortNodeType(type)) continue;
      const groupId = groupIdFromNode(node);
      if (!groupId || !ids.has(groupId)) continue;
      nodeEngine.removeNode(String(node.id));
      removed += 1;
    }

    return removed;
  };

  const disassembleGroupAndPorts = (groupId: string) => {
    const rootId = String(groupId ?? '');
    if (!rootId) return;

    const groupsSnapshot = get(groupController.nodeGroups);
    const toRemove = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || toRemove.has(id)) continue;
      toRemove.add(id);
      for (const g of groupsSnapshot) {
        if (String(g.parentId ?? '') === id) stack.push(String(g.id));
      }
    }

    groupController.disassembleGroup(rootId);
    removeGroupPortNodesForGroupIds(Array.from(toRemove));
  };

  const destroy = () => {
    if (alignRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(alignRaf);
    alignRaf = 0;
  };

  return {
    ensureGroupPortNodes,
    scheduleAlign,
    updateRuntimeActives,
    removeGroupPortNodesForGroupIds,
    disassembleGroupAndPorts,
    destroy,
  };
}

