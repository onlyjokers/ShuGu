/**
 * Purpose: Shared helpers for NodeCanvas runtime controllers (client selection, patch routing).
 */

export const clampInt = (value: number, min: number, max: number) => {
  const next = Math.floor(value);
  return Math.max(min, Math.min(max, next));
};

export const toFiniteNumber = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const coerceBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
  return fallback;
};

const hashStringDjb2 = (value: string): number => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
};

export const buildStableRandomOrder = (nodeId: string, clients: string[]) => {
  const keyed = clients.map((id) => ({ id, score: hashStringDjb2(`${nodeId}|${id}`) }));
  keyed.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return keyed.map((k) => k.id);
};

