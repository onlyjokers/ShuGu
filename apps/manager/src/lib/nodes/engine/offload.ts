/**
 * Purpose: Node offload heuristics.
 */

export const shouldComputeWhileOffloaded = (type: string): boolean => {
  const t = String(type ?? '');
  if (!t) return false;
  if (t.startsWith('logic-')) return true;
  return false;
};
