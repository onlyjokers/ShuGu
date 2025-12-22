/**
 * Purpose: Parse and validate Asset Service configuration from environment variables.
 */

import * as path from 'node:path';

export type AssetServiceConfig = {
  dataDir: string;
  dbPath: string;
  maxBytes: number;
  publicBaseUrl: string | null;
  readToken: string | null;
  writeToken: string | null;
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

export function readAssetServiceConfig(): AssetServiceConfig {
  const dataDir =
    parseOptionalString(process.env.ASSET_DATA_DIR) ??
    path.resolve(process.cwd(), 'data', 'assets');

  const dbPath =
    parseOptionalString(process.env.ASSET_DB_PATH) ?? path.join(dataDir, 'assets-index.json');

  const publicBaseUrl = parseOptionalString(process.env.ASSET_PUBLIC_BASE_URL)?.replace(/\/+$/, '') ?? null;

  return {
    dataDir,
    dbPath,
    maxBytes: parsePositiveInt(process.env.ASSET_MAX_BYTES, 500 * 1024 * 1024),
    publicBaseUrl,
    readToken: parseOptionalString(process.env.ASSET_READ_TOKEN),
    writeToken: parseOptionalString(process.env.ASSET_WRITE_TOKEN),
  };
}

