/**
 * Purpose: Compile/flatten Custom Nodes for deployable patch export.
 *
 * Phase 2.5 decision: deploy to client must not require the client to "know" Custom Node types.
 * We expand Custom Node instances into their internal subgraphs and then remove editor-only
 * boundary nodes (e.g. `group-proxy`) so the resulting graph contains only standard node types.
 */
import type { GraphState, NodeInstance } from '$lib/nodes/types';
import { readCustomNodeState } from './instance';
import type { CustomNodeDefinition } from './types';

type Connection = GraphState['connections'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const cloneGraphForCompile = (graph: GraphState): GraphState => {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const connections = Array.isArray(graph?.connections) ? graph.connections : [];
  return {
    nodes: nodes.map((n: any) => ({ ...n, outputValues: {} })),
    connections: connections.map((c: any) => ({ ...c })),
  };
};

const connectionKey = (c: {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}) => `${c.sourceNodeId}|${c.sourcePortId}|${c.targetNodeId}|${c.targetPortId}`;

const dedupeConnections = (connections: Connection[]): Connection[] => {
  const seen = new Set<string>();
  const out: Connection[] = [];
  for (const c of connections ?? []) {
    const key = connectionKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
};

const materializeInternalNodeId = (customNodeId: string, internalNodeId: string): string => {
  return `cn:${String(customNodeId ?? '')}:${String(internalNodeId ?? '')}`;
};

const isCustomNodeInstance = (node: NodeInstance): boolean => {
  if (!node) return false;
  const cfg = isRecord(node.config) ? node.config : {};
  return Boolean(readCustomNodeState(cfg));
};

function definitionById(definitions: CustomNodeDefinition[]): Map<string, CustomNodeDefinition> {
  const map = new Map<string, CustomNodeDefinition>();
  for (const def of definitions ?? []) {
    const id = String(def?.definitionId ?? '');
    if (id) map.set(id, def);
  }
  return map;
}

export function expandCustomNodesForCompile(graph: GraphState, definitions: CustomNodeDefinition[]): GraphState {
  const byId = definitionById(definitions);
  let current = cloneGraphForCompile(graph);

  // Expand iteratively so nested custom nodes (produced by materialization) are expanded too.
  for (let step = 0; step < 64; step += 1) {
    const nodes = Array.isArray(current.nodes) ? current.nodes : [];
    const connections = Array.isArray(current.connections) ? current.connections : [];
    const customNodes = nodes.filter(isCustomNodeInstance);
    if (customNodes.length === 0) return current;

    const customIds = new Set(customNodes.map((n) => String((n as any).id ?? '')).filter(Boolean));
    const remainingNodes = nodes.filter((n) => !customIds.has(String((n as any).id ?? '')));

    const incomingByTarget = new Map<string, Connection[]>();
    const outgoingBySource = new Map<string, Connection[]>();
    for (const c of connections) {
      const src = String((c as any).sourceNodeId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      if (!src || !tgt) continue;
      const inc = incomingByTarget.get(tgt) ?? [];
      inc.push(c as any);
      incomingByTarget.set(tgt, inc);
      const out = outgoingBySource.get(src) ?? [];
      out.push(c as any);
      outgoingBySource.set(src, out);
    }

    const nextNodes: GraphState['nodes'] = [...remainingNodes];
    const nextConnections: GraphState['connections'] = connections.filter((c) => {
      const src = String((c as any).sourceNodeId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      return !(customIds.has(src) || customIds.has(tgt));
    });

    for (const node of customNodes) {
      const instanceId = String((node as any).id ?? '');
      const state = readCustomNodeState((node as any)?.config ?? {}) as any;
      if (!instanceId || !state) continue;
      const def = byId.get(String(state.definitionId ?? '')) ?? null;
      if (!def) {
        throw new Error(
          `[custom-node-flatten] missing definition for ${String(state.definitionId ?? '')}`
        );
      }

      const internalGraph = state.internal as GraphState;
      const internalNodes = Array.isArray(internalGraph?.nodes) ? internalGraph.nodes : [];
      const internalConnections = Array.isArray(internalGraph?.connections) ? internalGraph.connections : [];

      for (const inner of internalNodes as any[]) {
        const innerId = String((inner as any).id ?? '');
        const type = String((inner as any).type ?? '');
        if (!innerId || !type) continue;
        nextNodes.push({
          ...inner,
          id: materializeInternalNodeId(instanceId, innerId),
          outputValues: {},
        } as any);
      }

      for (const c of internalConnections as any[]) {
        const src = String((c as any).sourceNodeId ?? '');
        const srcPort = String((c as any).sourcePortId ?? '');
        const tgt = String((c as any).targetNodeId ?? '');
        const tgtPort = String((c as any).targetPortId ?? '');
        if (!src || !srcPort || !tgt || !tgtPort) continue;
        nextConnections.push({
          ...c,
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: materializeInternalNodeId(instanceId, src),
          targetNodeId: materializeInternalNodeId(instanceId, tgt),
          sourcePortId: srcPort,
          targetPortId: tgtPort,
        } as any);
      }

      const portByKey = new Map<string, any>();
      for (const p of def.ports ?? []) {
        const key = String((p as any)?.portKey ?? '');
        if (!key) continue;
        portByKey.set(key, p);
      }

      for (const c of incomingByTarget.get(instanceId) ?? []) {
        const src = String((c as any).sourceNodeId ?? '');
        const srcPort = String((c as any).sourcePortId ?? '');
        const tgtPort = String((c as any).targetPortId ?? '');
        if (!src || !srcPort || !tgtPort) continue;
        if (tgtPort === 'gate') continue; // manager-only gate signal

        const port = portByKey.get(tgtPort) ?? null;
        if (!port || String((port as any).side) !== 'input') continue;
        const bindingNodeId = String((port as any)?.binding?.nodeId ?? '');
        const bindingPortId = String((port as any)?.binding?.portId ?? '');
        if (!bindingNodeId || !bindingPortId) continue;

        nextConnections.push({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: src,
          sourcePortId: srcPort,
          targetNodeId: materializeInternalNodeId(instanceId, bindingNodeId),
          targetPortId: bindingPortId,
        } as any);
      }

      for (const c of outgoingBySource.get(instanceId) ?? []) {
        const tgt = String((c as any).targetNodeId ?? '');
        const tgtPort = String((c as any).targetPortId ?? '');
        const srcPort = String((c as any).sourcePortId ?? '');
        if (!tgt || !tgtPort || !srcPort) continue;

        const port = portByKey.get(srcPort) ?? null;
        if (!port || String((port as any).side) !== 'output') continue;
        const bindingNodeId = String((port as any)?.binding?.nodeId ?? '');
        const bindingPortId = String((port as any)?.binding?.portId ?? '');
        if (!bindingNodeId || !bindingPortId) continue;

        nextConnections.push({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: materializeInternalNodeId(instanceId, bindingNodeId),
          sourcePortId: bindingPortId,
          targetNodeId: tgt,
          targetPortId: tgtPort,
        } as any);
      }
    }

    current = {
      nodes: nextNodes,
      connections: dedupeConnections(nextConnections as any),
    };
  }

  // If we somehow didn't converge, abort instead of returning a partial graph that still contains custom nodes.
  throw new Error('[custom-node-flatten] exceeded max expansion depth (possible cycle or corrupt graph).');
}

export function stripGroupProxyNodes(graph: GraphState): GraphState {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const connections = Array.isArray(graph?.connections) ? graph.connections : [];

  const proxyIds = new Set(
    nodes
      .filter((n: any) => String((n as any).type ?? '') === 'group-proxy')
      .map((n: any) => String((n as any).id ?? ''))
      .filter(Boolean)
  );
  if (proxyIds.size === 0) return graph;

  const incomingByTarget = new Map<string, Connection[]>();
  const outgoingBySource = new Map<string, Connection[]>();
  for (const c of connections as any[]) {
    const src = String((c as any).sourceNodeId ?? '');
    const tgt = String((c as any).targetNodeId ?? '');
    if (!src || !tgt) continue;
    const inc = incomingByTarget.get(tgt) ?? [];
    inc.push(c as any);
    incomingByTarget.set(tgt, inc);
    const out = outgoingBySource.get(src) ?? [];
    out.push(c as any);
    outgoingBySource.set(src, out);
  }

  const nextNodes = nodes.filter((n: any) => !proxyIds.has(String((n as any).id ?? '')));
  const keptConnections = connections.filter((c: any) => {
    const src = String((c as any).sourceNodeId ?? '');
    const tgt = String((c as any).targetNodeId ?? '');
    return !(proxyIds.has(src) || proxyIds.has(tgt));
  });

  const rewired: Connection[] = [...keptConnections] as any;

  for (const proxyId of proxyIds) {
    const incoming = (incomingByTarget.get(proxyId) ?? []).filter(
      (c) => String((c as any).targetPortId ?? '') === 'in'
    );
    const outgoing = (outgoingBySource.get(proxyId) ?? []).filter(
      (c) => String((c as any).sourcePortId ?? '') === 'out'
    );

    for (const inc of incoming) {
      const srcNodeId = String((inc as any).sourceNodeId ?? '');
      const srcPortId = String((inc as any).sourcePortId ?? '');
      if (!srcNodeId || !srcPortId) continue;
      for (const out of outgoing) {
        const tgtNodeId = String((out as any).targetNodeId ?? '');
        const tgtPortId = String((out as any).targetPortId ?? '');
        if (!tgtNodeId || !tgtPortId) continue;
        rewired.push({
          id: `bypass:${proxyId}:${String((inc as any).id ?? '')}->${String((out as any).id ?? '')}`,
          sourceNodeId: srcNodeId,
          sourcePortId: srcPortId,
          targetNodeId: tgtNodeId,
          targetPortId: tgtPortId,
        } as any);
      }
    }
  }

  return { nodes: nextNodes as any, connections: dedupeConnections(rewired) as any };
}

export function compileGraphForPatch(state: GraphState, definitions: CustomNodeDefinition[]): GraphState {
  const expanded = expandCustomNodesForCompile(state, definitions);
  return stripGroupProxyNodes(expanded);
}
