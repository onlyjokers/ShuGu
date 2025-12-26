/**
 * Purpose: Node media finish pulse bus.
 *
 * This provides a tiny in-memory bridge between UI media playback (e.g. VideoPlayer) and the
 * node graph runtime so `load-video-*` nodes can emit a one-tick "Finish" pulse when the
 * actual media element completes.
 */

type FinishPulse = { pending: boolean; updatedAt: number };

const finishPulsesByNodeId = new Map<string, FinishPulse>();
const MAX_AGE_MS = 10 * 60 * 1000;

function prune(now: number): void {
  for (const [nodeId, entry] of finishPulsesByNodeId.entries()) {
    if (now - entry.updatedAt > MAX_AGE_MS) finishPulsesByNodeId.delete(nodeId);
  }
}

export function reportNodeMediaFinish(nodeId: string): void {
  const id = typeof nodeId === 'string' ? nodeId.trim() : '';
  if (!id) return;
  const now = Date.now();
  prune(now);
  finishPulsesByNodeId.set(id, { pending: true, updatedAt: now });
}

export function consumeNodeMediaFinishPulse(nodeId: string): boolean {
  const id = typeof nodeId === 'string' ? nodeId.trim() : '';
  if (!id) return false;
  const now = Date.now();
  prune(now);
  const entry = finishPulsesByNodeId.get(id);
  if (!entry?.pending) return false;
  entry.pending = false;
  entry.updatedAt = now;
  finishPulsesByNodeId.set(id, entry);
  return true;
}

export function clearNodeMediaFinish(nodeId?: string): void {
  if (typeof nodeId === 'string' && nodeId.trim()) {
    finishPulsesByNodeId.delete(nodeId.trim());
    return;
  }
  finishPulsesByNodeId.clear();
}

