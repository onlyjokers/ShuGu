/**
 * Purpose: Shared types for the server-side Asset Service (records, kinds, persistence shape).
 */

export type AssetKind = 'audio' | 'image' | 'video';

export type AssetRecord = {
  id: string; // UUIDv4
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string; // hex
  originalName: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  durationMs?: number;
  width?: number;
  height?: number;
};

export type StoredAssetRecord = AssetRecord & {
  storageBackend: 'localfs';
  storageKey: string; // currently sha256 (used to locate file on disk)
};

export type AssetIndexFile = {
  version: 1;
  assets: StoredAssetRecord[];
};

