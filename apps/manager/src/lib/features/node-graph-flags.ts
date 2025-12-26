/**
 * Node Graph Feature Flags
 *
 * Runtime and URL-based feature flags for Node Graph improvements.
 * Allows switching between renderers and controlling performance optimizations.
 *
 * Usage:
 *   - URL params: ?ng_renderer=xyflow&ng_shadows=off&ng_perf=on（XYFlow 已弃用，需要删除；ng_perf 会将性能信息输出到 console）
 *   - Or toggle via the DEV UI in NodeCanvasToolbar
 */
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export type RendererType = 'rete' | 'xyflow';

interface NodeGraphFlags {
  /** Which renderer to use: 'rete' (current) or 'xyflow' (new) */
  renderer: RendererType;
  /** Whether edge drop-shadows are enabled (performance impact) */
  edgeShadows: boolean;
  /** Whether to show live port values (can impact performance) */
  liveValues: boolean;
  /** Whether to log performance info to the console */
  perfConsole: boolean;
}

const DEFAULT_FLAGS: NodeGraphFlags = {
  renderer: 'rete',
  edgeShadows: false,  // OFF by default for performance (Step 1.1 - shadows removed)
  liveValues: true,
  perfConsole: false,
};

/**
 * Parse URL search params to extract feature flags.
 */
function parseUrlFlags(): Partial<NodeGraphFlags> {
  if (!browser) return {};

  const params = new URLSearchParams(window.location.search);
  const flags: Partial<NodeGraphFlags> = {};

  const renderer = params.get('ng_renderer');
  if (renderer === 'rete' || renderer === 'xyflow') {
    flags.renderer = renderer;
  }

  const shadows = params.get('ng_shadows');
  if (shadows === 'on') flags.edgeShadows = true;
  if (shadows === 'off') flags.edgeShadows = false;

  const live = params.get('ng_live');
  if (live === 'on') flags.liveValues = true;
  if (live === 'off') flags.liveValues = false;

  const perf = params.get('ng_perf');
  if (perf === 'on') flags.perfConsole = true;
  if (perf === 'off') flags.perfConsole = false;

  return flags;
}

/**
 * Try to load stored flags from localStorage.
 */
function loadStoredFlags(): Partial<NodeGraphFlags> {
  if (!browser) return {};

  try {
    const raw = localStorage.getItem('node-graph-flags-v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const flags: Partial<NodeGraphFlags> = {};

    if (parsed.renderer === 'rete' || parsed.renderer === 'xyflow') {
      flags.renderer = parsed.renderer;
    }
    if (typeof parsed.edgeShadows === 'boolean') {
      flags.edgeShadows = parsed.edgeShadows;
    }
    if (typeof parsed.liveValues === 'boolean') {
      flags.liveValues = parsed.liveValues;
    }
    if (typeof parsed.perfConsole === 'boolean') {
      flags.perfConsole = parsed.perfConsole;
    } else if (typeof parsed.perfOverlay === 'boolean') {
      // Back-compat: perfOverlay was the old key used by the debug overlay.
      flags.perfConsole = parsed.perfOverlay;
    }

    return flags;
  } catch {
    return {};
  }
}

/**
 * Save flags to localStorage.
 */
function saveStoredFlags(flags: NodeGraphFlags): void {
  if (!browser) return;

  try {
    localStorage.setItem('node-graph-flags-v1', JSON.stringify(flags));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Initialize feature flags from defaults, localStorage, and URL params.
 * Priority: URL params > localStorage > defaults
 */
function initializeFlags(): NodeGraphFlags {
  const stored = loadStoredFlags();
  const url = parseUrlFlags();

  return {
    ...DEFAULT_FLAGS,
    ...stored,
    ...url,
  };
}

// Create writable store with initialized flags
const flagsStore = writable<NodeGraphFlags>(initializeFlags());

// Subscribe to changes and persist to localStorage
if (browser) {
  flagsStore.subscribe((flags) => {
    saveStoredFlags(flags);
  });
}

// Derived stores for individual flags
export const nodeGraphRenderer = derived(flagsStore, ($flags) => $flags.renderer);
export const nodeGraphEdgeShadows = derived(flagsStore, ($flags) => $flags.edgeShadows);
export const nodeGraphLiveValues = derived(flagsStore, ($flags) => $flags.liveValues);
export const nodeGraphPerfConsole = derived(flagsStore, ($flags) => $flags.perfConsole);

// Update functions
export function setRenderer(renderer: RendererType): void {
  flagsStore.update((flags) => ({ ...flags, renderer }));
}

export function setEdgeShadows(enabled: boolean): void {
  flagsStore.update((flags) => ({ ...flags, edgeShadows: enabled }));
}

export function setLiveValues(enabled: boolean): void {
  flagsStore.update((flags) => ({ ...flags, liveValues: enabled }));
}

export function setPerfConsole(enabled: boolean): void {
  flagsStore.update((flags) => ({ ...flags, perfConsole: enabled }));
}

export function togglePerfConsole(): void {
  flagsStore.update((flags) => ({ ...flags, perfConsole: !flags.perfConsole }));
}

export function toggleEdgeShadows(): void {
  flagsStore.update((flags) => ({ ...flags, edgeShadows: !flags.edgeShadows }));
}

// Export full store for advanced usage
export const nodeGraphFlags = {
  subscribe: flagsStore.subscribe,
  get: () => get(flagsStore),
  set: (flags: Partial<NodeGraphFlags>) => {
    flagsStore.update((current) => ({ ...current, ...flags }));
  },
  reset: () => {
    flagsStore.set(DEFAULT_FLAGS);
  },
};
