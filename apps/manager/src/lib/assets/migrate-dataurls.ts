/**
 * Purpose: Migrate legacy DataURL blobs inside a graph snapshot into Asset Service refs.
 *
 * This avoids huge base64 strings living inside the graph JSON.
 * - Finds `data:*;base64,...` strings in node `config` and `inputValues`
 * - Uploads to Asset Service (write-token protected)
 * - Replaces with `asset:<id>`
 *
 * Notes:
 * - This is manager-only and runs in the browser.
 * - Upload dedupe is handled server-side via sha256.
 */

import type { GraphState } from '$lib/nodes/types';
import { nodeEngine } from '$lib/nodes';

export type MigrateProgress =
  | { kind: 'scan'; totalFound: number }
  | { kind: 'upload'; index: number; total: number; mimeType: string; bytesApprox: number }
  | { kind: 'replace'; replaced: number }
  | { kind: 'done'; replaced: number; uploaded: number; skipped: number }
  | { kind: 'error'; message: string };

type DataUrlInfo = { dataUrl: string; mimeType: string; bytesApprox: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function buildUrl(serverUrl: string, path: string): string | null {
  const baseRaw = serverUrl.trim();
  if (!baseRaw) return null;
  try {
    const base = baseRaw.endsWith('/') ? baseRaw : `${baseRaw}/`;
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

function parseDataUrl(raw: string): DataUrlInfo | null {
  const s = raw.trim();
  if (!s.startsWith('data:')) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const header = s.slice(5, comma); // after "data:"
  const body = s.slice(comma + 1);
  const isBase64 = /;base64/i.test(header);
  if (!isBase64) return null;
  const mimeType = header.split(';')[0]?.trim() || 'application/octet-stream';
  const bytesApprox = Math.floor((body.length * 3) / 4);
  return { dataUrl: s, mimeType, bytesApprox };
}

function dataUrlToFile(info: DataUrlInfo, nameHint: string): File {
  const comma = info.dataUrl.indexOf(',');
  const base64 = info.dataUrl.slice(comma + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], nameHint, { type: info.mimeType });
}

function inferAssetKind(mimeType: string): 'audio' | 'image' | 'video' | null {
  const t = mimeType.toLowerCase();
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  return null;
}

function findDataUrls(value: unknown, out: DataUrlInfo[], dedupe: Set<string>): void {
  if (typeof value === 'string') {
    const info = parseDataUrl(value);
    if (info && !dedupe.has(info.dataUrl)) {
      dedupe.add(info.dataUrl);
      out.push(info);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) findDataUrls(item, out, dedupe);
    return;
  }
  if (!isRecord(value)) return;
  for (const v of Object.values(value)) findDataUrls(v, out, dedupe);
}

function replaceDataUrls(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return map.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => replaceDataUrls(v, map));
  }
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) next[k] = replaceDataUrls(v, map);
  return next;
}

async function uploadDataUrl(
  serverUrl: string,
  writeToken: string,
  info: DataUrlInfo,
  nameHint: string
): Promise<string> {
  const url = buildUrl(serverUrl, 'api/assets');
  if (!url) throw new Error('Missing or invalid Server URL.');
  if (!writeToken) throw new Error('Missing Asset Write Token.');

  const file = dataUrlToFile(info, nameHint);
  const formData = new FormData();
  formData.set('file', file);
  formData.set('originalName', file.name);
  const kind = inferAssetKind(file.type);
  if (kind) formData.set('kind', kind);

  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${writeToken}` }, body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
  }
  const json = (await res.json()) as any;
  const assetId = String(json?.asset?.id ?? '');
  if (!assetId) throw new Error('Upload succeeded but response is missing asset.id');
  return assetId;
}

export async function migrateCurrentGraphDataUrls(opts: {
  serverUrl: string;
  writeToken: string;
  onProgress?: (p: MigrateProgress) => void;
  confirmBytesThreshold?: number;
}): Promise<{ replaced: number; uploaded: number; skipped: number }> {
  const onProgress = opts.onProgress ?? (() => undefined);
  const graph = nodeEngine.exportGraph();
  const found: DataUrlInfo[] = [];
  const dedupe = new Set<string>();

  for (const n of graph.nodes ?? []) {
    findDataUrls(n?.config ?? null, found, dedupe);
    findDataUrls(n?.inputValues ?? null, found, dedupe);
  }
  onProgress({ kind: 'scan', totalFound: found.length });
  if (found.length === 0) return { replaced: 0, uploaded: 0, skipped: 0 };

  const totalBytes = found.reduce((acc, f) => acc + (f.bytesApprox ?? 0), 0);
  const threshold = Math.max(1, Math.floor(opts.confirmBytesThreshold ?? 50 * 1024 * 1024));
  if (totalBytes >= threshold) {
    const ok = confirm(
      `This will upload ~${Math.round(totalBytes / (1024 * 1024))}MB of embedded DataURLs to Asset Service. Continue?`
    );
    if (!ok) return { replaced: 0, uploaded: 0, skipped: found.length };
  }

  const map = new Map<string, string>();
  let uploaded = 0;
  let skipped = 0;

  for (let i = 0; i < found.length; i += 1) {
    const info = found[i];
    onProgress({ kind: 'upload', index: i + 1, total: found.length, mimeType: info.mimeType, bytesApprox: info.bytesApprox });
    try {
      const nameHint = `migrated-${i + 1}`;
      const assetId = await uploadDataUrl(opts.serverUrl, opts.writeToken, info, nameHint);
      map.set(info.dataUrl, `asset:${assetId}`);
      uploaded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ kind: 'error', message });
      throw err;
    }
  }

  // Apply replacements back into the graph snapshot.
  const nextGraph: GraphState = {
    nodes: (graph.nodes ?? []).map((n) => ({
      ...n,
      config: replaceDataUrls(n.config ?? {}, map) as any,
      inputValues: replaceDataUrls(n.inputValues ?? {}, map) as any,
      outputValues: {}, // runtime state reset
    })),
    connections: [...(graph.connections ?? [])],
  };
  nodeEngine.loadGraph(nextGraph);

  let replaced = 0;
  for (const v of map.values()) if (v.startsWith('asset:')) replaced += 1;
  onProgress({ kind: 'replace', replaced });

  onProgress({ kind: 'done', replaced, uploaded, skipped });
  return { replaced, uploaded, skipped };
}

