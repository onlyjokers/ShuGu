/**
 * Purpose: Merge control payloads for batch updates without using `any`.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function mergeControlPayload(prev: unknown, next: unknown): unknown {
  if (isObject(prev) && isObject(next)) {
    return { ...prev, ...next };
  }
  return next;
}
