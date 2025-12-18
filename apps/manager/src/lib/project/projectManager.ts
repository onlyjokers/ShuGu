import { browser } from '$app/environment';
import { nodeEngine } from '$lib/nodes';
import type { GraphState } from '$lib/nodes/types';
import { parameterRegistry } from '$lib/parameters/registry';
import { minimapPreferences, type MinimapPreferences } from './uiState';
import { get } from 'svelte/store';

const STORAGE_KEY = 'shugu-project-v1';

interface ProjectSnapshot {
  version: 1;
  savedAt: number;
  graph: GraphState;
  parameters: ReturnType<typeof parameterRegistry.snapshot>;
  ui?: {
    minimap?: MinimapPreferences;
  };
}

function safeGetStorage(): Storage | null {
  if (!browser) return null;
  try {
    return window.localStorage;
  } catch (err) {
    console.warn('[ProjectManager] localStorage unavailable', err);
    return null;
  }
}

function buildSnapshot(): ProjectSnapshot {
  return {
    version: 1,
    savedAt: Date.now(),
    graph: nodeEngine.exportGraph(),
    parameters: parameterRegistry.snapshot(),
    ui: { minimap: get(minimapPreferences) },
  };
}

export function saveLocalProject(reason = 'auto'): void {
  const storage = safeGetStorage();
  if (!storage) return;
  const snapshot = buildSnapshot();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[ProjectManager] Failed to save project', reason, err);
  }
}

export function loadLocalProject(): boolean {
  const storage = safeGetStorage();
  if (!storage) return false;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return false;

  try {
    const snapshot = JSON.parse(raw) as ProjectSnapshot;
    if (snapshot?.graph) {
      nodeEngine.loadGraph(snapshot.graph);
    }

    if (snapshot?.parameters?.length) {
      for (const p of snapshot.parameters) {
        const param = parameterRegistry.get(p.path);
        if (param) {
          // Restore base value
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (param as any).setValue?.(p.baseValue, 'SYSTEM');

          // Restore modulation offsets if present
          if (p.modulators) {
            Object.entries(p.modulators).forEach(([sourceId, offset]) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (param as any).setModulation?.(sourceId, offset, 'SYSTEM');
            });
          }
        }
      }
    }

    const mini = snapshot?.ui?.minimap;
    if (
      mini &&
      typeof mini === 'object' &&
      typeof (mini as any).x === 'number' &&
      typeof (mini as any).y === 'number' &&
      typeof (mini as any).size === 'number'
    ) {
      minimapPreferences.set({
        x: Number((mini as any).x),
        y: Number((mini as any).y),
        size: Number((mini as any).size),
      });
    }
    return true;
  } catch (err) {
    console.warn('[ProjectManager] Failed to load project', err);
    return false;
  }
}

let unsubscribeGraph: (() => void) | null = null;
let unsubscribeUi: (() => void) | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(intervalMs = 1000): void {
  const storage = safeGetStorage();
  if (!storage) return;

  // Throttle via simple timer instead of debouncing every graph update.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      saveLocalProject('graph-change');
      pending = false;
    }, intervalMs);
  };

  unsubscribeGraph?.();
  unsubscribeGraph = nodeEngine.graphState.subscribe(() => schedule());

  unsubscribeUi?.();
  unsubscribeUi = minimapPreferences.subscribe(() => schedule());

  intervalHandle && clearInterval(intervalHandle);
  intervalHandle = setInterval(() => saveLocalProject('interval'), intervalMs * 5);
}

export function stopAutoSave(): void {
  unsubscribeGraph?.();
  unsubscribeGraph = null;
  unsubscribeUi?.();
  unsubscribeUi = null;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
