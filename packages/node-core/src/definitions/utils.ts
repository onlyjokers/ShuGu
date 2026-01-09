/**
 * Purpose: Shared helpers for node definitions (coercion, clamping, formatting).
 */

export function hashStringDjb2(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const next = Math.floor(n);
  return Math.max(min, Math.min(max, next));
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function coerceNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value >= 0.5 : false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (!s) return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
    return true;
  }
  return false;
}

export function coerceBooleanOr(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return coerceBoolean(value);
}

export function coerceAssetVolumeGain(value: unknown): number {
  // UI Volume is a relative control in [-1, 2]:
  // -1 => mute, 0 => normal (gain=1), 2 => max (gain=2), >2 => linear gain up to 100.
  const raw = typeof value === 'string' ? Number(value) : Number(value);
  const v = Number.isFinite(raw) ? Math.max(-1, Math.min(100, raw)) : 0;
  if (v <= -1) return 0;
  if (v < 0) return 1 + v;
  if (v <= 2) return 1 + v / 2;
  return v;
}

export function formatAnyPreview(value: unknown): string {
  const MAX_LEN = 160;

  const clamp = (raw: string): string => {
    const singleLine = raw.replace(/\s+/g, ' ').trim();
    if (!singleLine) return '--';
    if (singleLine.length <= MAX_LEN) return singleLine;
    return `${singleLine.slice(0, MAX_LEN - 1)}…`;
  };

  if (value === undefined) return '--';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--';
    const rounded = Math.round(value * 1000) / 1000;
    return clamp(String(rounded));
  }
  if (typeof value === 'string') return clamp(value);

  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return clamp(json);
  } catch {
    // ignore
  }

  try {
    return clamp(String(value));
  } catch {
    return '--';
  }
}
