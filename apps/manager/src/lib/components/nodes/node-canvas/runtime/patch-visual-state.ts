/**
 * Purpose: Patch runtime visual/offload state helpers.
 */

import type { GraphState } from '$lib/nodes/types';
import type { GraphViewAdapter } from '../adapters/graph-view-adapter';

type NodeEngineLike = {
  setPatchOffloadedNodeIds(nodeIds: string[]): void;
};

type DeployedPatchLike = { nodeIds: Set<string> };

type DeployedPatchByClientIdLike = Map<string, DeployedPatchLike>;

export interface CreatePatchVisualStateOptions {
  nodeEngine: NodeEngineLike;
  adapter: GraphViewAdapter;
  getGraphState: () => GraphState;
}

export const createPatchVisualState = (opts: CreatePatchVisualStateOptions) => {
  const { nodeEngine, adapter, getGraphState } = opts;

  const getDeployedPatchNodeIds = (
    deployedPatchByClientId: DeployedPatchByClientIdLike
  ): Set<string> => {
    const out = new Set<string>();
    for (const patch of deployedPatchByClientId.values()) {
      for (const id of patch.nodeIds) out.add(id);
    }
    return out;
  };

  const applyStoppedHighlights = async (running: boolean) => {
    const stopped = !running;
    const state = getGraphState();
    for (const node of state.nodes ?? []) {
      const id = String(node.id ?? '');
      if (!id) continue;
      const prev = adapter.getNodeVisualState(id);
      if (Boolean(prev?.stopped) !== stopped) await adapter.setNodeVisualState(id, { stopped });
    }
  };

  const applyPatchHighlights = async (patchNodeIds: Set<string>) => {
    const ids = patchNodeIds ?? new Set<string>();
    const state = getGraphState();
    for (const node of state.nodes ?? []) {
      const id = String(node.id ?? '');
      if (!id) continue;
      const deployedPatch = ids.has(id);
      const prev = adapter.getNodeVisualState(id);
      if (Boolean(prev?.deployedPatch) !== deployedPatch) {
        await adapter.setNodeVisualState(id, { deployedPatch });
      }
    }
  };

  const syncPatchOffloadState = (patchNodeIds: Set<string>) => {
    nodeEngine.setPatchOffloadedNodeIds(Array.from(patchNodeIds ?? []));
  };

  const syncPatchVisualState = (deployedPatchByClientId: DeployedPatchByClientIdLike) => {
    const nodeIds = getDeployedPatchNodeIds(deployedPatchByClientId);
    syncPatchOffloadState(nodeIds);
    void applyPatchHighlights(nodeIds);
  };

  return {
    getDeployedPatchNodeIds,
    applyStoppedHighlights,
    applyPatchHighlights,
    syncPatchOffloadState,
    syncPatchVisualState,
  };
};
