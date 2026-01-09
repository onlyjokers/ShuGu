/**
 * Purpose: Shared helpers for manager-only Group Port nodes (e.g. `group-activate`).
 */

import type { GraphState, NodeInstance } from '$lib/nodes/types';

export const GROUP_ACTIVATE_NODE_TYPE = 'group-activate';

export const isGroupPortNodeType = (type: string) => type === GROUP_ACTIVATE_NODE_TYPE;

export const groupIdFromNode = (node: NodeInstance): string => {
  const raw = (node.config as any)?.groupId;
  return typeof raw === 'string' ? raw : raw ? String(raw) : '';
};

export const buildGroupPortIndex = (state: GraphState) => {
  const byGroupId = new Map<string, { activateId?: string }>();

  for (const node of state.nodes ?? []) {
    const type = String(node.type ?? '');
    if (!isGroupPortNodeType(type)) continue;
    const groupId = groupIdFromNode(node);
    if (!groupId) continue;

    const entry = byGroupId.get(groupId) ?? {};
    if (type === GROUP_ACTIVATE_NODE_TYPE && !entry.activateId) entry.activateId = String(node.id);
    byGroupId.set(groupId, entry);
  }

  return byGroupId;
};

