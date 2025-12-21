/**
 * Purpose: Manager-side asset manifest builder + push to clients.
 *
 * - Scans the current graph for `asset:` references (stable order, first appearance wins).
 * - Debounces updates and pushes a manifest to connected clients via plugin control:
 *   `pluginId: "multimedia-core", command: "configure"`.
 *
 * Notes:
 * - This module is side-effectful by design (subscriptions) and is imported from `apps/manager/src/lib/nodes/index.ts`.
 * - It intentionally avoids storing any auth token inside the graph; tokens live in localStorage/UI config only.
 */
import { get } from 'svelte/store';
import { targetClients } from '@shugu/protocol';

import type { GraphState } from './types';
import { nodeEngine } from './engine';
import { getSDK, state as managerState } from '$lib/stores/manager';

export type AssetManifest = {
  manifestId: string;
  assets: string[];
  updatedAt: number;
};

const MANIFEST_DEBOUNCE_MS = 250;
const PLUGIN_ID = 'multimedia-core';

const sentManifestIdByClient = new Map<string, string>();

function normalizeAssetRef(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  if (s.startsWith('asset:')) {
    const id = s.slice('asset:'.length).trim();
    return id ? `asset:${id}` : null;
  }

  const shuguPrefix = 'shugu://asset/';
  if (s.startsWith(shuguPrefix)) {
    const id = s.slice(shuguPrefix.length).trim();
    return id ? `asset:${id}` : null;
  }

  return null;
}

function hashManifest(assets: string[]): string {
  // Simple deterministic hash (djb2) to avoid bundling crypto; collisions are acceptable for MVP.
  const joined = assets.join('|');
  let hash = 5381;
  for (let i = 0; i < joined.length; i += 1) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) >>> 0;
  }
  return `m1-${assets.length}-${hash.toString(16)}`;
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

  for (const v of Object.values(value as Record<string, unknown>)) {
    collectAssetRefs(v, out, seen);
  }
}

function scanGraphForAssetRefs(graph: GraphState): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const node of graph.nodes ?? []) {
    collectAssetRefs(node?.config ?? null, out, seen);
    collectAssetRefs(node?.inputValues ?? null, out, seen);
  }

  return out;
}

function pushManifestToClientIds(clientIds: string[], manifest: AssetManifest): void {
  const sdk = getSDK();
  if (!sdk) return;

  const ids = clientIds.map(String).filter(Boolean);
  if (ids.length === 0) return;

  sdk.sendPluginControl(targetClients(ids), PLUGIN_ID, 'configure', {
    manifestId: manifest.manifestId,
    assets: manifest.assets,
    updatedAt: manifest.updatedAt,
  });

  for (const id of ids) sentManifestIdByClient.set(id, manifest.manifestId);
}

let latestManifest: AssetManifest | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function recomputeAndMaybePush(graph: GraphState): void {
  const assets = scanGraphForAssetRefs(graph);
  const manifestId = hashManifest(assets);
  const next: AssetManifest = { manifestId, assets, updatedAt: Date.now() };

  if (latestManifest && latestManifest.manifestId === next.manifestId) return;
  latestManifest = next;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const clients = (get(managerState).clients ?? []).map((c: any) => String(c?.clientId ?? '')).filter(Boolean);
    const pending = clients.filter((id) => sentManifestIdByClient.get(id) !== next.manifestId);
    pushManifestToClientIds(pending, next);
  }, MANIFEST_DEBOUNCE_MS);
}

// Keep manifest up-to-date with the graph.
nodeEngine.graphState.subscribe((graph) => {
  recomputeAndMaybePush(graph);
});

// Push manifest to clients that join after the last graph update.
managerState.subscribe(($state) => {
  if (!latestManifest) return;
  const ids = ($state.clients ?? []).map((c: any) => String(c?.clientId ?? '')).filter(Boolean);
  const pending = ids.filter((id) => sentManifestIdByClient.get(id) !== latestManifest?.manifestId);
  if (pending.length === 0) return;
  pushManifestToClientIds(pending, latestManifest);
});

