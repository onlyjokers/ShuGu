/**
 * Purpose: Patch export helpers (Max/MSP style).
 *
 * Exports a subgraph rooted at an output sink node (e.g. `audio-out`).
 * This is used to deploy a "patch" to the client without relying on loop detection.
 */

import type { GraphState } from './types';
import type { NodeRegistry } from '@shugu/node-core';

export type PatchExportResult = {
  rootNodeId: string;
  graph: Pick<GraphState, 'nodes' | 'connections'>;
  assetRefs: string[];
};

function normalizeAssetRef(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('asset:')) {
    const id = s.slice('asset:'.length).trim().split(/[?#]/)[0]?.trim() ?? '';
    return id ? `asset:${id}` : null;
  }
  const p = 'shugu://asset/';
  if (s.startsWith(p)) {
    const id = s.slice(p.length).trim().split(/[?#]/)[0]?.trim() ?? '';
    return id ? `asset:${id}` : null;
  }
  return null;
}

function collectAssetRefs(value: unknown, out: string[], seen: Set<string>): void {
  if (typeof value === 'string') {
    const normalized = normalizeAssetRef(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, out, seen);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const v of Object.values(value as Record<string, unknown>)) collectAssetRefs(v, out, seen);
}

export function exportGraphForPatch(
  state: GraphState,
  opts: { rootType?: string; nodeRegistry?: NodeRegistry } = {}
): PatchExportResult {
  const rootType = opts.rootType ?? 'audio-out';
  const registry = opts.nodeRegistry ?? null;
  const nodes = (state.nodes ?? []).slice();
  const connections = (state.connections ?? []).slice();
  const byId = new Map(nodes.map((n) => [String(n.id), n]));

  const normalizeAssetPickerValue = (raw: unknown): string | null => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return normalizeAssetRef(trimmed) ?? `asset:${trimmed}`;
  };

  const isManagerOnlyNodeType = (type: string): boolean => type.startsWith('midi-');

  const roots = nodes.filter((n) => n.type === rootType);
  if (roots.length === 0) {
    throw new Error(`No patch root node found (${rootType}). Add an "${rootType}" node first.`);
  }
  if (roots.length > 1) {
    throw new Error(`Multiple patch root nodes found (${rootType}). Keep only one for deploy.`);
  }
  const root = roots[0]!;

  const incomingByTarget = new Map<string, { sourceNodeId: string; targetPortId: string }[]>();
  for (const c of connections) {
    const targetNodeId = String(c.targetNodeId);
    const list = incomingByTarget.get(targetNodeId) ?? [];
    list.push({ sourceNodeId: String(c.sourceNodeId), targetPortId: String(c.targetPortId) });
    incomingByTarget.set(targetNodeId, list);
  }
  for (const list of incomingByTarget.values()) {
    list.sort(
      (a, b) => a.targetPortId.localeCompare(b.targetPortId) || a.sourceNodeId.localeCompare(b.sourceNodeId)
    );
  }

  const shouldTraverse = (targetNodeId: string, targetPortId: string): boolean => {
    if (!registry) return true;
    const node = nodes.find((n) => String(n.id) === String(targetNodeId));
    if (!node) return true;
    const def = registry.get(String(node.type));
    const port = def?.inputs?.find((p) => String(p.id) === String(targetPortId));
    const type = (port?.type ?? 'any') as string;
    // Patch deploy only follows signal/control-rate dependencies (audio/number/etc).
    // Manager-only routing (client) and command sinks must be excluded from the deployed patch.
    if (type === 'client' || type === 'command') return false;
    return true;
  };

  const keep = new Set<string>();
  const visit = (nodeId: string) => {
    const id = String(nodeId);
    if (!id || keep.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    // MIDI nodes are manager-only control sources (WebMIDI lives in manager, not client).
    // They must not be exported to the client patch; their outputs are forwarded as overrides instead.
    if (isManagerOnlyNodeType(String(node.type))) return;
    keep.add(id);
    const incoming = incomingByTarget.get(id) ?? [];
    for (const inc of incoming) {
      if (!shouldTraverse(id, inc.targetPortId)) continue;
      visit(inc.sourceNodeId);
    }
  };
  visit(String(root.id));

  const keptNodes = nodes.filter((n) => keep.has(String(n.id)));
  const keptNodeIds = new Set(keptNodes.map((n) => String(n.id)));
  const keptConnections = connections.filter(
    (c) => keptNodeIds.has(String(c.sourceNodeId)) && keptNodeIds.has(String(c.targetNodeId))
  );

  // Stable ordering for deterministic deploy signatures.
  keptNodes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  keptConnections.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const assetRefs: string[] = [];
  const seen = new Set<string>();
  for (const n of keptNodes) {
    // Include asset-picker config fields which may store bare assetIds (not prefixed refs).
    if (registry) {
      const def = registry.get(String(n.type));
      for (const field of def?.configSchema ?? []) {
        if ((field as any)?.type !== 'asset-picker') continue;
        const key = String((field as any).key ?? '');
        if (!key) continue;
        const normalized = normalizeAssetPickerValue((n.config as any)?.[key]);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          assetRefs.push(normalized);
        }
      }
    }

    collectAssetRefs(n.config ?? null, assetRefs, seen);
    collectAssetRefs(n.inputValues ?? null, assetRefs, seen);
  }

  return {
    rootNodeId: String(root.id),
    graph: { nodes: keptNodes, connections: keptConnections },
    assetRefs,
  };
}
