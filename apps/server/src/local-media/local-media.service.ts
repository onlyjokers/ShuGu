/**
 * Purpose: LocalMediaService — validate, list, and stream media files from configured roots.
 */

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { readLocalMediaConfig, type LocalMediaKind } from './local-media.config.js';
import { classifyKindByExt, guessMimeType, isPathInsideRoots } from './local-media.util.js';
import type { LocalMediaFile } from './local-media.types.js';

type ValidatedLocalFile = {
  realPath: string;
  kind: LocalMediaKind;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: number;
  etag: string;
};

function normalizeEtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const noWeak = trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
  const unquoted = noWeak.replace(/^"(.+)"$/, '$1');
  return unquoted || null;
}

function computeEtag(realPath: string, sizeBytes: number, modifiedAt: number): string {
  return createHash('sha1')
    .update(`${realPath}|${sizeBytes}|${modifiedAt}`)
    .digest('hex');
}

function isPathInsideCwd(resolvedPath: string): boolean {
  const rel = path.relative(process.cwd(), resolvedPath);
  if (!rel) return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

@Injectable()
export class LocalMediaService {
  readonly config = readLocalMediaConfig();
  private readonly resolvedRoots: string[] = this.config.roots.map((r) => path.resolve(r));

  constructor() {
    // Ensure repo-local default dir exists (but avoid creating home folders).
    for (const root of this.resolvedRoots) {
      if (!isPathInsideCwd(root)) continue;
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  getRoots(): string[] {
    return this.resolvedRoots.slice();
  }

  parseIfNoneMatch(req: { header: (name: string) => string | undefined }): string | null {
    return normalizeEtag(req.header('if-none-match'));
  }

  async validatePath(
    rawPath: string,
    expectedKind?: LocalMediaKind | null
  ): Promise<ValidatedLocalFile> {
    const input = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!input) throw new BadRequestException('missing path');
    if (!path.isAbsolute(input)) throw new BadRequestException('path must be absolute');

    const resolved = path.resolve(input);
    const realPath = await fsp.realpath(resolved).catch(() => null);
    if (!realPath) throw new NotFoundException('file not found');

    const stat = await fsp.stat(realPath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundException('file not found');

    if (!isPathInsideRoots(realPath, this.resolvedRoots)) {
      throw new ForbiddenException('path is outside LOCAL_MEDIA_ROOTS');
    }

    const kind = classifyKindByExt(realPath);
    if (!kind) throw new BadRequestException('unsupported file type');
    if (expectedKind && kind !== expectedKind) {
      throw new BadRequestException(`expected ${expectedKind}, got ${kind}`);
    }

    const sizeBytes = Math.max(0, stat.size);
    const modifiedAt = stat.mtimeMs ? Number(stat.mtimeMs) : stat.mtime.getTime();
    const etag = computeEtag(realPath, sizeBytes, modifiedAt);

    return {
      realPath,
      kind,
      mimeType: guessMimeType(realPath, kind),
      sizeBytes,
      modifiedAt,
      etag,
    };
  }

  async listFiles(opts: { kind?: LocalMediaKind | null } = {}): Promise<LocalMediaFile[]> {
    const kindFilter = opts.kind ?? null;
    const out: LocalMediaFile[] = [];
    const maxFiles = this.config.maxListFiles;
    const maxDepth = this.config.maxListDepth;

    for (const root of this.resolvedRoots) {
      const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
      while (queue.length && out.length < maxFiles) {
        const next = queue.shift();
        if (!next) break;

        const entries = await fsp.readdir(next.dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (out.length >= maxFiles) break;
          const name = entry.name;
          if (!name || name === '.' || name === '..') continue;
          if (name.startsWith('.')) continue;

          const fullPath = path.join(next.dir, name);
          if (entry.isDirectory()) {
            if (next.depth < maxDepth) queue.push({ dir: fullPath, depth: next.depth + 1 });
            continue;
          }
          if (!entry.isFile()) continue;

          const kind = classifyKindByExt(fullPath);
          if (!kind) continue;
          if (kindFilter && kind !== kindFilter) continue;

          const stat = await fsp.stat(fullPath).catch(() => null);
          if (!stat || !stat.isFile()) continue;

          const sizeBytes = Math.max(0, stat.size);
          const modifiedAt = stat.mtimeMs ? Number(stat.mtimeMs) : stat.mtime.getTime();
          const label = path.relative(root, fullPath) || path.basename(fullPath);

          out.push({
            path: fullPath,
            label,
            kind,
            mimeType: guessMimeType(fullPath, kind),
            sizeBytes,
            modifiedAt,
          });
        }
      }
    }

    out.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return out;
  }
}

