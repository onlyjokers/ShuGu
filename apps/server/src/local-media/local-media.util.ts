/**
 * Purpose: Helpers for identifying media kinds/mime types and performing safe path checks.
 */

import * as path from 'node:path';
import type { LocalMediaKind } from './local-media.config.js';

const AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.aif',
  '.aiff',
  '.opus',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

export function classifyKindByExt(filePath: string): LocalMediaKind | null {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function guessMimeType(filePath: string, kind: LocalMediaKind | null): string {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === 'audio') {
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.wav') return 'audio/wav';
    if (ext === '.ogg') return 'audio/ogg';
    if (ext === '.m4a') return 'audio/mp4';
    if (ext === '.aac') return 'audio/aac';
    if (ext === '.flac') return 'audio/flac';
    if (ext === '.opus') return 'audio/opus';
    return 'audio/*';
  }
  if (kind === 'image') {
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.bmp') return 'image/bmp';
    if (ext === '.svg') return 'image/svg+xml';
    return 'image/*';
  }
  if (kind === 'video') {
    if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mov') return 'video/quicktime';
    return 'video/*';
  }
  return 'application/octet-stream';
}

export function isPathInsideRoots(filePath: string, roots: string[]): boolean {
  const normalized = path.resolve(filePath);
  return roots.some((root) => {
    const r = path.resolve(root);
    if (normalized === r) return true;
    const rel = path.relative(r, normalized);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

