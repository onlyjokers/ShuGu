/**
 * Purpose: Small parsing/normalization helpers shared by Tone adapter modules.
 */

import { MIN_TONE_DELAY_TIME_SECONDS } from './state.js';

export function toNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function toNonNegativeNumber(value: unknown, fallback: number): number {
  return Math.max(0, toNumber(value, fallback));
}

export function toToneDelayTimeSeconds(value: unknown, fallback: number): number {
  // Safety: Tone delay time must always be > 0.
  return Math.max(MIN_TONE_DELAY_TIME_SECONDS, toNumber(value, fallback));
}

export function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const num = Number(normalized);
    if (Number.isFinite(num)) return num > 0;
    return fallback;
  }
  if (typeof value === 'number') return value > 0;
  return fallback;
}

type LocalMediaKind = 'audio' | 'image' | 'video';

function ensureLocalMediaKindQuery(ref: string, kind: LocalMediaKind): string {
  const hashIndex = ref.indexOf('#');
  const hash = hashIndex >= 0 ? ref.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;

  const qIndex = withoutHash.indexOf('?');
  if (qIndex < 0) return `${withoutHash}?kind=${kind}${hash}`;

  const base = withoutHash.slice(0, qIndex);
  const search = withoutHash.slice(qIndex + 1);
  try {
    const params = new URLSearchParams(search);
    if (!params.has('kind')) params.set('kind', kind);
    return `${base}?${params.toString()}${hash}`;
  } catch {
    const joiner = withoutHash.endsWith('?') || withoutHash.endsWith('&') ? '' : '&';
    return `${withoutHash}${joiner}kind=${kind}${hash}`;
  }
}

function isAbsoluteFilePath(filePath: string): boolean {
  const s = filePath.trim();
  if (!s) return false;
  if (s.startsWith('/')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('\\\\')) return true;
  return false;
}

export function normalizeLocalMediaRef(raw: unknown, kind: LocalMediaKind): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';

  // Display-local file reference (registered via Manager↔Display local bridge).
  if (s.startsWith('displayfile:')) return ensureLocalMediaKindQuery(s, kind);

  if (s.startsWith('localfile:')) return ensureLocalMediaKindQuery(s, kind);

  const shuguLocalPrefix = 'shugu://local-file/';
  if (s.startsWith(shuguLocalPrefix)) {
    const encoded = s.slice(shuguLocalPrefix.length).trim();
    if (!encoded) return '';
    try {
      const decoded = decodeURIComponent(encoded);
      if (!decoded.trim()) return '';
      return ensureLocalMediaKindQuery(`localfile:${decoded.trim()}`, kind);
    } catch {
      return ensureLocalMediaKindQuery(`localfile:${encoded}`, kind);
    }
  }

  if (!isAbsoluteFilePath(s)) return '';
  return ensureLocalMediaKindQuery(`localfile:${s}`, kind);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(min)) return value;
  if (!Number.isFinite(max)) return value;
  return Math.max(min, Math.min(max, value));
}

export function toAssetVolumeGain(value: unknown): number {
  // UI Volume is a relative control in [-1, 2]:
  // -1 => mute, 0 => normal (gain=1), 2 => max (gain=2), >2 => linear gain up to 100.
  const v = clamp(toNumber(value, 0), -1, 100);
  if (v <= -1) return 0;
  if (v < 0) return 1 + v;
  if (v <= 2) return 1 + v / 2;
  return v;
}

export function loopKeyOf(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}
