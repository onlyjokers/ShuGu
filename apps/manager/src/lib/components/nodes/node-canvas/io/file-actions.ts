/**
 * Purpose: Import/export actions for node graphs and MIDI templates.
 */
import { nodeRegistry } from '$lib/nodes';
import type { Connection, GraphState, NodeInstance } from '$lib/nodes/types';
import type { NodeGroup } from '../controllers/group-controller';
import {
  exportMidiTemplateFile,
  instantiateMidiBindings,
  parseMidiTemplateFile,
} from '$lib/features/midi/midi-templates';

type FileActionsOptions = {
  nodeEngine: {
    exportGraph: () => GraphState;
    addNode: (node: NodeInstance) => void;
    addConnection: (connection: Connection) => boolean;
    updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  };
  getImportGraphInput: () => HTMLInputElement | null;
  getImportTemplatesInput: () => HTMLInputElement | null;
  getNodeGroups: () => NodeGroup[];
  appendNodeGroups: (groups: NodeGroup[]) => void;
  onSelectNodeIds?: (nodeIds: string[]) => void;
  getViewportCenterGraphPos: () => { x: number; y: number };
};

type NodeGraphFileV1 = { version: 1; kind: 'node-graph'; graph: GraphState };
type NodeGraphFileV2 = { version: 2; kind: 'node-graph'; graph: GraphState; groups: NodeGroup[] };

const downloadJson = (payload: unknown, filename: string) => {
  if (typeof document === 'undefined') return;
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function coerceGraphNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseNodeGroups(value: unknown): NodeGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: NodeGroup[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    const parentIdRaw = item.parentId;
    const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null;
    const nodeIdsRaw = Array.isArray(item.nodeIds) ? item.nodeIds : [];
    const nodeIds = nodeIdsRaw.map((v) => String(v)).filter(Boolean);
    const disabled = Boolean(item.disabled);
    groups.push({ id, parentId, name, nodeIds, disabled });
  }
  return groups;
}

type ParsedNodeGraphFile = { graph: GraphState; groups: NodeGroup[] };

const parseNodeGraphFile = (payload: unknown): ParsedNodeGraphFile | null => {
  if (!payload || typeof payload !== 'object') return null;
  const wrapped = payload as any;
  if (wrapped.kind === 'node-graph' && (wrapped.version === 1 || wrapped.version === 2) && wrapped.graph) {
    const graph = wrapped.graph as any;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) return null;
    return { graph: graph as GraphState, groups: parseNodeGroups(wrapped.groups) };
  }

  const raw = payload as any;
  if (Array.isArray(raw.nodes) && Array.isArray(raw.connections)) {
    return { graph: raw as GraphState, groups: parseNodeGroups(raw.groups) };
  }

  return null;
};

function defaultNodeConfig(type: string): Record<string, unknown> {
  const def = nodeRegistry.get(type);
  const config: Record<string, unknown> = {};
  for (const field of def?.configSchema ?? []) config[field.key] = field.defaultValue;
  return config;
}

function generateId(prefix: string): string {
  const token = crypto.randomUUID?.() ?? Date.now();
  return prefix.endsWith(':') ? `${prefix}${token}` : `${prefix}-${token}`;
}

function remapImportedGroups(sourceGroups: NodeGroup[], nodeIdMap: Map<string, string>) {
  const kept: NodeGroup[] = [];
  for (const group of sourceGroups) {
    const id = String(group.id ?? '');
    if (!id) continue;
    const name = typeof group.name === 'string' ? group.name : String(group.name ?? '');
    const parentId = group.parentId ? String(group.parentId) : null;
    const nodeIds = (group.nodeIds ?? [])
      .map((nid) => nodeIdMap.get(String(nid)))
      .filter(Boolean) as string[];
    const uniqueNodeIds = Array.from(new Set(nodeIds));
    if (uniqueNodeIds.length === 0) continue;
    kept.push({ id, parentId, name, nodeIds: uniqueNodeIds, disabled: Boolean(group.disabled) });
  }

  if (kept.length === 0) return { groups: [] as NodeGroup[], groupIdMap: new Map<string, string>() };

  const groupIdMap = new Map<string, string>();
  for (const group of kept) groupIdMap.set(String(group.id), generateId('group:'));

  const remapped: NodeGroup[] = kept.map((group) => ({
    id: groupIdMap.get(String(group.id)) ?? generateId('group:'),
    parentId:
      group.parentId && groupIdMap.has(String(group.parentId))
        ? groupIdMap.get(String(group.parentId))!
        : null,
    name: String(group.name ?? ''),
    nodeIds: (group.nodeIds ?? []).map(String),
    disabled: Boolean(group.disabled),
  }));

  // Ensure parent groups include all descendant nodes so disabled propagation and bounds match expectations.
  const byId = new Map(remapped.map((g) => [String(g.id), g] as const));
  const childrenByParent = new Map<string, string[]>();
  for (const g of remapped) {
    if (!g.parentId) continue;
    const pid = String(g.parentId);
    const list = childrenByParent.get(pid) ?? [];
    list.push(String(g.id));
    childrenByParent.set(pid, list);
  }

  const visiting = new Set<string>();
  const computeUnion = (id: string): Set<string> => {
    if (visiting.has(id)) return new Set();
    visiting.add(id);
    const group = byId.get(id);
    const base = new Set((group?.nodeIds ?? []).map(String));
    for (const childId of childrenByParent.get(id) ?? []) {
      const childUnion = computeUnion(String(childId));
      for (const nid of childUnion) base.add(nid);
    }
    if (group) group.nodeIds = Array.from(base);
    visiting.delete(id);
    return base;
  };

  for (const g of remapped) {
    if (g.parentId) continue;
    computeUnion(String(g.id));
  }

  return { groups: remapped, groupIdMap };
}

function computeTemplateOffset(nodes: GraphState['nodes'], anchor: { x: number; y: number }) {
  const positions = (nodes ?? [])
    .map((n) => ({
      x: coerceGraphNumber((n as any)?.position?.x, 0),
      y: coerceGraphNumber((n as any)?.position?.y, 0),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (positions.length === 0) return { dx: 0, dy: 0 };

  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxX = Math.max(...positions.map((p) => p.x));
  const maxY = Math.max(...positions.map((p) => p.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { dx: anchor.x - centerX, dy: anchor.y - centerY };
}

export function createFileActions(opts: FileActionsOptions) {
  const exportGraph = () => {
    const raw = opts.nodeEngine.exportGraph();
    const graph: GraphState = {
      nodes: (raw.nodes ?? []).map((n) => ({ ...n, outputValues: {} })),
      connections: (raw.connections ?? []).map((c) => ({ ...c })),
    };
    const groups = (opts.getNodeGroups?.() ?? []).map((g) => ({
      id: String(g.id),
      parentId: g.parentId ? String(g.parentId) : null,
      name: String(g.name ?? ''),
      nodeIds: (g.nodeIds ?? []).map((id) => String(id)).filter(Boolean),
      disabled: Boolean(g.disabled),
    }));
    const file: NodeGraphFileV2 = { version: 2, kind: 'node-graph', graph, groups };
    downloadJson(file, 'shugu-node-graph.json');
  };

  const importGraph = () => {
    opts.getImportGraphInput()?.click?.();
  };

  const handleImportGraphChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    const parsedFile = parseNodeGraphFile(parsed);
    if (!parsedFile) {
      alert('Unsupported graph format.');
      return;
    }

    const ok = confirm('Import graph from file? This will add nodes to the current graph.');
    if (!ok) return;

    const anchor = opts.getViewportCenterGraphPos();
    const sourceGraph = parsedFile.graph;
    const sourceNodes = Array.isArray(sourceGraph.nodes) ? sourceGraph.nodes : [];
    const sourceConnections = Array.isArray(sourceGraph.connections) ? sourceGraph.connections : [];

    // Compute the import offset from nodes we can actually import. Otherwise a single invalid/outlier node
    // (unknown type) can skew the bounds and push imported nodes far away from the viewport.
    const importableNodes = sourceNodes.filter((node) => {
      const type = String((node as any)?.type ?? '');
      return Boolean(type && nodeRegistry.get(type));
    });
    const { dx, dy } = computeTemplateOffset(importableNodes, anchor);
    const nodeIdMap = new Map<string, string>();
    const importedNodeIds: string[] = [];

    let importedNodes = 0;
    let skippedNodes = 0;

    for (const node of sourceNodes) {
      const oldId = String((node as any)?.id ?? '');
      const type = String((node as any)?.type ?? '');
      if (!type || !nodeRegistry.get(type)) {
        skippedNodes += 1;
        continue;
      }

      const newId = generateId('node');
      const x = coerceGraphNumber((node as any)?.position?.x, 0) + dx;
      const y = coerceGraphNumber((node as any)?.position?.y, 0) + dy;

      const cfg = isRecord((node as any)?.config) ? ((node as any).config as Record<string, unknown>) : {};
      const inputValues = isRecord((node as any)?.inputValues)
        ? ({ ...(node as any).inputValues } as Record<string, unknown>)
        : {};

      const instance: NodeInstance = {
        id: newId,
        type,
        position: { x, y },
        config: { ...defaultNodeConfig(type), ...cfg },
        inputValues,
        outputValues: {},
      };

      try {
        opts.nodeEngine.addNode(instance);
      } catch {
        skippedNodes += 1;
        continue;
      }

      if (oldId) nodeIdMap.set(oldId, newId);
      importedNodeIds.push(newId);
      importedNodes += 1;
    }

    let importedConnections = 0;
    let skippedConnections = 0;

    for (const c of sourceConnections) {
      const sourceNodeId = nodeIdMap.get(String((c as any)?.sourceNodeId ?? ''));
      const targetNodeId = nodeIdMap.get(String((c as any)?.targetNodeId ?? ''));
      if (!sourceNodeId || !targetNodeId) {
        skippedConnections += 1;
        continue;
      }

      const conn: Connection = {
        id: generateId('conn'),
        sourceNodeId,
        sourcePortId: String((c as any)?.sourcePortId ?? ''),
        targetNodeId,
        targetPortId: String((c as any)?.targetPortId ?? ''),
      };

      const ok = opts.nodeEngine.addConnection(conn);
      if (ok) importedConnections += 1;
      else skippedConnections += 1;
    }

    const { groups: importedGroups, groupIdMap } = remapImportedGroups(parsedFile.groups, nodeIdMap);

    // Keep group port nodes (Group Activate / Group Bridge) wired to the remapped group IDs *before* appending
    // groups, so the auto "ensureGroupPortNodes" hook doesn't create duplicates.
    if (groupIdMap.size > 0) {
      for (const node of sourceNodes) {
        const type = String((node as any)?.type ?? '');
        if (type !== 'group-activate' && type !== 'group-bridge') continue;
        const oldNodeId = String((node as any)?.id ?? '');
        const newNodeId = nodeIdMap.get(oldNodeId);
        if (!newNodeId) continue;
        const oldGroupId = String(((node as any)?.config as any)?.groupId ?? '');
        const nextGroupId = groupIdMap.get(oldGroupId);
        if (!nextGroupId) continue;
        opts.nodeEngine.updateNodeConfig(newNodeId, { groupId: nextGroupId });
      }
    }

    if (importedGroups.length > 0) opts.appendNodeGroups(importedGroups);

    const skippedGroups = Math.max(0, parsedFile.groups.length - importedGroups.length);

    if (importedNodeIds.length > 0) opts.onSelectNodeIds?.(importedNodeIds);

    const groupSuffix = parsedFile.groups.length
      ? `\nGroups: ${importedGroups.length} imported, ${skippedGroups} skipped`
      : '';
    alert(
      `Nodes: ${importedNodes} imported, ${skippedNodes} skipped\nConnections: ${importedConnections} imported, ${skippedConnections} skipped${groupSuffix}`
    );
  };

  const exportTemplates = () => {
    const file = exportMidiTemplateFile(opts.nodeEngine.exportGraph());
    downloadJson(file, 'shugu-midi-templates.json');
  };

  const importTemplates = () => {
    opts.getImportTemplatesInput()?.click?.();
  };

  const handleImportTemplatesChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    const templates = parseMidiTemplateFile(parsed);
    if (!templates) {
      alert('Unsupported template format (expected version: 1).');
      return;
    }

    const created = instantiateMidiBindings(templates, { anchor: opts.getViewportCenterGraphPos() });
    if (created.length > 0) {
      const nodeIds = new Set<string>();
      for (const binding of created) {
        nodeIds.add(String(binding.midiNodeId));
        nodeIds.add(String(binding.mapNodeId));
        nodeIds.add(String(binding.targetNodeId));
      }
      opts.onSelectNodeIds?.(Array.from(nodeIds));
    }
    alert(`Imported ${created.length} template(s).`);
  };

  return {
    exportGraph,
    importGraph,
    handleImportGraphChange,
    exportTemplates,
    importTemplates,
    handleImportTemplatesChange,
  };
}
