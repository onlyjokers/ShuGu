/**
 * Purpose: Parse and validate Local Media Service configuration from environment variables.
 *
 * Local Media serves files from the server machine (ideally the same machine as Manager),
 * without uploading to the Asset Service.
 */

import * as path from 'node:path';
import * as os from 'node:os';

export type LocalMediaKind = 'audio' | 'image' | 'video';

export type LocalMediaConfig = {
  roots: string[];
  maxListFiles: number;
  maxListDepth: number;
};

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  const asInt = Math.floor(raw);
  return asInt > 0 ? asInt : fallback;
}

function parseRoots(value: unknown): string[] {
  const raw = parseOptionalString(value);
  if (!raw) return [];
  const parts = raw
    .split(/[;,]/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const resolved = parts.map((p) => path.resolve(p));
  return Array.from(new Set(resolved));
}

export function readLocalMediaConfig(): LocalMediaConfig {
  const roots = (() => {
    const parsed = parseRoots(process.env.LOCAL_MEDIA_ROOTS);
    if (parsed.length > 0) return parsed;

    const home = os.homedir();
    const defaults = [
      path.resolve(process.cwd(), 'data', 'local-media'),
      path.join(home, 'Downloads'),
      path.join(home, 'Movies'),
      path.join(home, 'Pictures'),
      path.join(home, 'Desktop'),
    ];
    return Array.from(new Set(defaults.map((p) => path.resolve(p))));
  })();

  return {
    roots,
    maxListFiles: parsePositiveInt(process.env.LOCAL_MEDIA_MAX_LIST_FILES, 2000),
    maxListDepth: parsePositiveInt(process.env.LOCAL_MEDIA_MAX_LIST_DEPTH, 6),
  };
}

