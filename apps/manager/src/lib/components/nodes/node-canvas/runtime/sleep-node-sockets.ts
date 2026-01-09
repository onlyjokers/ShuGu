/**
 * Purpose: Keep the `logic-sleep` node output socket type in sync with its wired input.
 */

import type { GraphState, PortType } from '$lib/nodes/types';

type NodeRegistryLike = {
  get(type: string): { outputs?: { id: string; type?: PortType }[] } | undefined;
};

type AnyAreaPlugin = { update(kind: 'node', nodeId: string): Promise<void> } | null;

export type SleepOutputType = { type: PortType; hasInput: boolean };

export interface SleepNodeSocketSync {
  resolveSleepOutputType(nodeId: string): SleepOutputType;
  syncSleepNodeSockets(state: GraphState): Promise<void>;
}

export interface CreateSleepNodeSocketSyncOptions {
  getGraphState: () => GraphState;
  nodeRegistry: NodeRegistryLike;
  sockets: Record<string, unknown>;
  getAreaPlugin: () => AnyAreaPlugin;
  getNodeMap: () => Map<string, any>;
}

export function createSleepNodeSocketSync(opts: CreateSleepNodeSocketSyncOptions): SleepNodeSocketSync {
  const { getGraphState, nodeRegistry, sockets, getAreaPlugin, getNodeMap } = opts;

  const getOutputPortType = (nodeId: string, portId: string): PortType => {
    const state = getGraphState();
    const node = (state.nodes ?? []).find((n) => String(n.id) === String(nodeId));
    if (!node) return 'any';
    const def = nodeRegistry.get(String((node as any).type));
    const port = def?.outputs?.find((p) => p.id === portId);
    return (port?.type ?? 'any') as PortType;
  };

  const resolveSleepOutputType = (nodeId: string): SleepOutputType => {
    const state = getGraphState();
    const conn = (state.connections ?? []).find(
      (c) => String((c as any).targetNodeId) === String(nodeId) && String((c as any).targetPortId) === 'input'
    );
    if (!conn) return { type: 'any', hasInput: false };
    return {
      type: getOutputPortType(String((conn as any).sourceNodeId), String((conn as any).sourcePortId)),
      hasInput: true,
    };
  };

  const syncSleepNodeSockets = async (state: GraphState) => {
    const areaPlugin = getAreaPlugin();
    if (!areaPlugin) return;
    const nodes = state.nodes ?? [];
    if (nodes.length === 0) return;

    const nodeMap = getNodeMap();
    for (const node of nodes) {
      if (String((node as any).type) !== 'logic-sleep') continue;
      const reteNode = nodeMap.get(String((node as any).id));
      const output = reteNode?.outputs?.output;
      if (!reteNode || !output) continue;

      const { type, hasInput } = resolveSleepOutputType(String((node as any).id));
      const nextSocket = (sockets as any)[type] ?? (sockets as any).any;
      const nextDisabled = !hasInput;
      const prevSocket = output.socket;
      const prevDisabled = Boolean(output.disabled);

      if (prevSocket !== nextSocket || prevDisabled !== nextDisabled) {
        output.socket = nextSocket;
        output.disabled = nextDisabled;
        await areaPlugin.update('node', String((node as any).id));
      }
    }
  };

  return { resolveSleepOutputType, syncSleepNodeSockets };
}

