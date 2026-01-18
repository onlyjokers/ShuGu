/**
 * Purpose: Detect deployable client sensor loops in the manager graph.
 */

import type { GraphState } from '../types';
import type { LocalLoop } from '../engine';
import { capabilityForNodeType } from './capabilities';
import { hashString } from './hash';

export const detectLocalClientLoops = (
  graph: Pick<GraphState, 'nodes' | 'connections'>
): LocalLoop[] => {
  const nodes = graph.nodes ?? [];
  const connections = graph.connections ?? [];

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const conn of connections) {
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

  const loops: LocalLoop[] = [];
  for (const component of sccs) {
    if (component.length === 0) continue;
    const nodeSet = new Set(component);

    if (component.length === 1) {
      const only = component[0];
      const hasSelf = connections.some((c) => c.sourceNodeId === only && c.targetNodeId === only);
      if (!hasSelf) continue;
    }

    const clientNodes = component.filter(isClient);
    if (clientNodes.length !== 1) continue;
    const hasSensors = component.some(isClientSensors);
    if (!hasSensors) continue;

    const connIds = connections
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

  loops.sort((a, b) => a.id.localeCompare(b.id));
  return loops;
};
