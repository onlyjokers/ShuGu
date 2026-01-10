import { get, writable } from 'svelte/store';

import type { ScreenColorPayload } from '@shugu/protocol';

export type StreamableAction =
  | 'screenColor'
  | 'asciiMode'
  | 'asciiResolution'
  | 'flashlight';

export type StreamPayloads = {
  screenColor: ScreenColorPayload;
  asciiMode: { enabled: boolean };
  asciiResolution: { cellSize: number };
  flashlight: { mode: 'off' | 'on' | 'blink'; frequency?: number; dutyCycle?: number };
};

export type StreamSenders = {
  [K in StreamableAction]: (payload: StreamPayloads[K], executeAt?: number) => void;
};

export const streamEnabled = writable(false);
export const sampleRateFps = writable(30); // configurable via UI

const drafts = new Map<StreamableAction, StreamPayloads[StreamableAction]>();
const lastSent = new Map<StreamableAction, StreamPayloads[StreamableAction]>();

let loopHandle: ReturnType<typeof setInterval> | null = null;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function setDraft<K extends StreamableAction>(action: K, payload: StreamPayloads[K]): void {
  drafts.set(action, payload);
}

export function clearDrafts(): void {
  drafts.clear();
}

export function clearLastSent(): void {
  lastSent.clear();
}

export function stopStreamLoop(): void {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

export function startStreamLoop(params: {
  senders: StreamSenders;
  getExecuteAt: () => number | undefined;
  hasSelection: () => boolean;
}): void {
  stopStreamLoop();

  const intervalMs = Math.max(5, Math.round(1000 / Math.max(1, get(sampleRateFps))));

  loopHandle = setInterval(() => {
    if (!params.hasSelection()) return;

    drafts.forEach((payload, action) => {
      const prev = lastSent.get(action);
      if (!deepEqual(prev, payload)) {
        params.senders[action](payload as never, params.getExecuteAt());
        lastSent.set(action, payload);
      }
    });
  }, intervalMs);
}
