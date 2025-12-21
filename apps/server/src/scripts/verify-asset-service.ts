/**
 * Purpose: Offline verification script for Asset Service without opening a network port.
 *
 * Usage (from repo root):
 *   ASSET_READ_TOKEN=dev-read ASSET_WRITE_TOKEN=dev-write \\
 *   ASSET_DATA_DIR=apps/server/.tmp/asset-data \\
 *   ASSET_DB_PATH=apps/server/.tmp/asset-data/assets-index.json \\
 *   node apps/server/dist-local/scripts/verify-asset-service.js
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AssetsService } from '../assets/assets.service.js';
import { parseByteRangeHeader } from '../assets/range.js';

type VerifyResult = {
  ok: boolean;
  details: Record<string, unknown>;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyToTemp(srcPath: string): Promise<string> {
  const base = path.basename(srcPath);
  const tmp = path.join(os.tmpdir(), `shugu-asset-verify-${Date.now()}-${base}`);
  await fs.copyFile(srcPath, tmp);
  return tmp;
}

async function main(): Promise<VerifyResult> {
  const repoRoot = process.cwd();
  const sampleDir = path.join(repoRoot, 'assets');
  const samples = ['audio.wav', 'img.jpg', 'video.mp4'].map((name) => ({
    name,
    path: path.join(sampleDir, name),
  }));

  const service = new AssetsService();
  await service.init();

  const uploaded: Record<string, { id: string; sha256: string; sizeBytes: number }> = {};

  for (const sample of samples) {
    const present = await exists(sample.path);
    if (!present) {
      return {
        ok: false,
        details: { error: `missing sample file: ${sample.path}` },
      };
    }

    const tempPath = await copyToTemp(sample.path);
    const first = await service.uploadFromTempFile({
      tempPath,
      mimeType: 'application/octet-stream',
      originalName: sample.name,
      kind: null,
    });

    const againTemp = await copyToTemp(sample.path);
    const second = await service.uploadFromTempFile({
      tempPath: againTemp,
      mimeType: 'application/octet-stream',
      originalName: sample.name,
      kind: null,
    });

    if (!second.deduped || second.asset.id !== first.asset.id) {
      return {
        ok: false,
        details: {
          error: 'dedupe failed',
          sample: sample.name,
          first: first,
          second: second,
        },
      };
    }

    uploaded[sample.name] = {
      id: first.asset.id,
      sha256: first.asset.sha256,
      sizeBytes: first.asset.sizeBytes,
    };
  }

  const indexExists = await exists(service.config.dbPath);
  if (!indexExists) {
    return { ok: false, details: { error: 'index file not written', dbPath: service.config.dbPath } };
  }

  const rangeSamples = {
    'bytes=0-1023': parseByteRangeHeader('bytes=0-1023', 4096),
    'bytes=1024-': parseByteRangeHeader('bytes=1024-', 4096),
    'bytes=-512': parseByteRangeHeader('bytes=-512', 4096),
    'bytes=4096-4097': parseByteRangeHeader('bytes=4096-4097', 4096),
    'bytes=10-5': parseByteRangeHeader('bytes=10-5', 4096),
  };

  return {
    ok: true,
    details: {
      config: {
        ...service.config,
        readToken: service.config.readToken ? '<set>' : null,
        writeToken: service.config.writeToken ? '<set>' : null,
      },
      uploaded,
      rangeSamples,
    },
  };
}

main()
  .then((result) => {
    const out = JSON.stringify(result, null, 2);
    if (!result.ok) {
      console.error(out);
      process.exitCode = 1;
      return;
    }
    console.log(out);
  })
  .catch((err) => {
    console.error('[verify-asset-service] failed', err);
    process.exitCode = 1;
  });
