/**
 * Purpose: Import/export helpers for Phase 2.5 Custom Nodes (`*.shugu-node.json`).
 *
 * Export: pick one definition + recursively include dependency definitions.
 * Import: treat as "copy import" (generate new IDs), rewrite nested references,
 * and regenerate instance-level groupIds inside templates to avoid collisions.
 */
import type { GraphState, NodeInstance } from '$lib/nodes/types';
import { generateCustomNodeGroupId, readCustomNodeState, writeCustomNodeState } from './instance';
import type { CustomNodeInstanceState } from './instance';
import type { CustomNodeDefinition } from './types';
import { customNodeType } from './store';
import { dependenciesForDefinition } from './deps';

export type CustomNodeFileV1 = {
  kind: 'shugu-custom-node';
  version: 1;
  exportedAt: number;
  rootDefinitionId: string;
  definitions: CustomNodeDefinition[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneGraphForFile(graph: GraphState): GraphState {
  return {
    nodes: (graph.nodes ?? []).map((n: any) => ({ ...n, outputValues: {} })),
    connections: (graph.connections ?? []).map((c: any) => ({ ...c })),
  };
}

export function collectDefinitionClosure(
  definitions: CustomNodeDefinition[],
  rootDefinitionId: string
): CustomNodeDefinition[] {
  const byId = new Map(definitions.map((d) => [String(d.definitionId), d] as const));
  const visited = new Set<string>();
  const ordered: CustomNodeDefinition[] = [];

  const stack = [String(rootDefinitionId ?? '')];
  while (stack.length > 0) {
    const id = String(stack.pop() ?? '');
    if (!id || visited.has(id)) continue;
    visited.add(id);

    const def = byId.get(id) ?? null;
    if (!def) continue;
    ordered.push(def);

    for (const dep of dependenciesForDefinition(def)) {
      if (byId.has(dep)) stack.push(dep);
    }
  }

  return ordered;
}

export function buildCustomNodeFile(definitions: CustomNodeDefinition[], rootDefinitionId: string): CustomNodeFileV1 {
  const root = String(rootDefinitionId ?? '');
  const closure = collectDefinitionClosure(definitions, root);

  return {
    kind: 'shugu-custom-node',
    version: 1,
    exportedAt: Date.now(),
    rootDefinitionId: root,
    definitions: closure.map((def) => ({
      definitionId: String(def.definitionId),
      name: String(def.name ?? ''),
      template: cloneGraphForFile(def.template),
      ports: (def.ports ?? []).map((p: any) => ({
        portKey: String(p?.portKey ?? ''),
        side: String(p?.side) === 'input' ? 'input' : ('output' as const),
        label: String(p?.label ?? ''),
        type: String(p?.type ?? 'any') as any,
        pinned: Boolean(p?.pinned),
        y: typeof p?.y === 'number' ? p.y : Number(p?.y ?? 0),
        binding: { nodeId: String(p?.binding?.nodeId ?? ''), portId: String(p?.binding?.portId ?? '') },
      })),
    })),
  };
}

export function parseCustomNodeFile(payload: unknown): CustomNodeFileV1 | null {
  if (!isRecord(payload)) return null;
  if (payload.kind !== 'shugu-custom-node') return null;
  if (payload.version !== 1) return null;

  const rootDefinitionId = typeof payload.rootDefinitionId === 'string' ? payload.rootDefinitionId : '';
  const exportedAt = typeof payload.exportedAt === 'number' ? payload.exportedAt : 0;
  const definitionsRaw = Array.isArray(payload.definitions) ? payload.definitions : [];
  if (!rootDefinitionId || definitionsRaw.length === 0) return null;

  const defs: CustomNodeDefinition[] = [];
  for (const item of definitionsRaw) {
    if (!isRecord(item)) continue;
    const definitionId = typeof item.definitionId === 'string' ? item.definitionId : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!definitionId) continue;

    const templateRaw = isRecord(item.template) ? item.template : null;
    const nodesRaw = Array.isArray(templateRaw?.nodes) ? templateRaw?.nodes : [];
    const connectionsRaw = Array.isArray(templateRaw?.connections) ? templateRaw?.connections : [];
    const template: GraphState = {
      nodes: nodesRaw
        .map((n: any) => ({
          ...n,
          id: String(n?.id ?? ''),
          type: String(n?.type ?? ''),
          position: {
            x: typeof n?.position?.x === 'number' ? n.position.x : Number(n?.position?.x ?? 0),
            y: typeof n?.position?.y === 'number' ? n.position.y : Number(n?.position?.y ?? 0),
          },
          config: isRecord(n?.config) ? (n.config as Record<string, unknown>) : {},
          inputValues: isRecord(n?.inputValues) ? (n.inputValues as Record<string, unknown>) : {},
          outputValues: {},
        }))
        .filter((n: any) => Boolean(n.id && n.type)),
      connections: connectionsRaw
        .map((c: any) => ({
          ...c,
          id: String(c?.id ?? ''),
          sourceNodeId: String(c?.sourceNodeId ?? ''),
          sourcePortId: String(c?.sourcePortId ?? ''),
          targetNodeId: String(c?.targetNodeId ?? ''),
          targetPortId: String(c?.targetPortId ?? ''),
        }))
        .filter((c: any) => Boolean(c.id && c.sourceNodeId && c.targetNodeId && c.sourcePortId && c.targetPortId)),
    };

    const portsRaw = Array.isArray(item.ports) ? item.ports : [];
    const ports = portsRaw
      .map((p: any) => ({
        portKey: String(p?.portKey ?? ''),
        side: String(p?.side) === 'input' ? 'input' : ('output' as const),
        label: String(p?.label ?? ''),
        type: String(p?.type ?? 'any') as any,
        pinned: Boolean(p?.pinned),
        y: typeof p?.y === 'number' ? p.y : Number(p?.y ?? 0),
        binding: { nodeId: String(p?.binding?.nodeId ?? ''), portId: String(p?.binding?.portId ?? '') },
      }))
      .filter((p: any) => Boolean(p.portKey && p.binding?.nodeId && p.binding?.portId));

    defs.push({ definitionId, name, template, ports });
  }

  return {
    kind: 'shugu-custom-node',
    version: 1,
    exportedAt,
    rootDefinitionId,
    definitions: defs,
  };
}

function rewriteGraphDeep(graph: GraphState, idMap: Map<string, string>): GraphState {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const connections = Array.isArray(graph?.connections) ? graph.connections : [];

  const nextNodes: NodeInstance[] = nodes.map((node) => {
    let type = String(node.type ?? '');
    let config: Record<string, unknown> = { ...(node.config ?? {}) };
    const inputValues: Record<string, unknown> = { ...(node.inputValues ?? {}) };

    const state = readCustomNodeState(config);
    if (!state) {
      return { ...node, type, config, inputValues, outputValues: {} };
    }

    const mappedDefinitionId = idMap.get(String(state.definitionId)) ?? '';
    if (!mappedDefinitionId) {
      throw new Error(`[custom-node-io] missing imported dependency definitionId: ${String(state.definitionId)}`);
    }

    const groupId = generateCustomNodeGroupId();
    const internal = rewriteGraphDeep(state.internal, idMap);
    const nextState: CustomNodeInstanceState = {
      ...state,
      definitionId: mappedDefinitionId,
      groupId,
      internal,
    };

    type = customNodeType(mappedDefinitionId);
    config = writeCustomNodeState(config, nextState);

    return { ...node, type, config, inputValues, outputValues: {} };
  });

  return {
    nodes: nextNodes,
    connections: connections.map((c: any) => ({ ...c })),
  };
}

export function remapImportedDefinitions(definitions: CustomNodeDefinition[]): {
  definitions: CustomNodeDefinition[];
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  for (const def of definitions ?? []) {
    const id = String(def.definitionId ?? '');
    if (!id) continue;
    idMap.set(id, crypto.randomUUID?.() ?? `${Date.now()}`);
  }

  const next = (definitions ?? []).map((def) => {
    const oldId = String(def.definitionId ?? '');
    const nextId = idMap.get(oldId) ?? '';
    if (!nextId) throw new Error(`[custom-node-io] missing id mapping for ${oldId}`);

    const template = rewriteGraphDeep(cloneGraphForFile(def.template), idMap);
    const ports = (def.ports ?? []).map((p: any) => ({ ...p, binding: { ...p.binding } }));

    return {
      definitionId: nextId,
      name: String(def.name ?? ''),
      template,
      ports,
    } as CustomNodeDefinition;
  });

  return { definitions: next, idMap };
}

