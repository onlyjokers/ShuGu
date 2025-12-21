/**
 * Purpose: MIDI activity highlights for the node canvas.
 */
import { get } from 'svelte/store';
import type { GraphState } from '$lib/nodes/types';
import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
import { midiNodeBridge, midiSourceMatchesEvent } from '$lib/features/midi/midi-node-bridge';
import { computeMidiHighlightState } from './midi-highlight';

export type MidiHighlightController = {
  start: () => void;
  stop: () => void;
  scheduleHighlight: () => void;
  applyHighlights: () => Promise<void>;
  clearHighlights: () => void;
};

type MidiHighlightControllerOptions = {
  getGraphState: () => GraphState;
  getGroupDisabledNodeIds: () => Set<string>;
  getNodeMap: () => Map<string, any>;
  getConnectionMap: () => Map<string, any>;
  getAreaPlugin: () => any;
  isSyncingGraph: () => boolean;
};

const MIDI_HIGHLIGHT_TTL_MS = 180;
const midiSourceNodeTypes = new Set(['midi-fuzzy', 'midi-boolean']);
const midiTraversalStopNodeTypes = new Set(['client-object']);

export function createMidiHighlightController(opts: MidiHighlightControllerOptions): MidiHighlightController {
  let midiUnsub: (() => void) | null = null;
  let midiHighlightTimeout: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let applyInProgress = false;
  let applyAgain = false;
  let pendingEvent: MidiEvent | null = null;
  let midiHighlightDirty = false;
  let midiActiveNodeIds = new Set<string>();
  let midiActiveConnIds = new Set<string>();
  let midiActiveInputPortsByNode = new Map<string, Set<string>>();
  let midiActiveOutputPortsByNode = new Map<string, Set<string>>();

  // Snapshot of what we last applied to the Rete models (used to avoid scanning the whole canvas).
  let appliedNodeIds = new Set<string>();
  let appliedConnIds = new Set<string>();
  let appliedInputPortsByNode = new Map<string, Set<string>>();
  let appliedOutputPortsByNode = new Map<string, Set<string>>();

  const cancelScheduledApply = () => {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    }
    rafId = null;
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
  };

  const scheduleApply = () => {
    if (rafId !== null || timeoutId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      // Best-effort fallback (should not happen in the NodeCanvas runtime).
      timeoutId = setTimeout(() => {
        timeoutId = null;
        void applyHighlights();
      }, 16);
      return;
    }

    rafId = requestAnimationFrame(() => {
      rafId = null;
      void applyHighlights();
    });
  };

  const clearHighlights = () => {
    midiActiveNodeIds = new Set();
    midiActiveConnIds = new Set();
    midiActiveInputPortsByNode = new Map();
    midiActiveOutputPortsByNode = new Map();
    scheduleHighlight();
  };

  const scheduleHighlight = () => {
    midiHighlightDirty = true;
    if (!opts.isSyncingGraph()) scheduleApply();
  };

  const applyHighlights = async () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin) return;
    if (opts.isSyncingGraph()) return;

    if (applyInProgress) {
      applyAgain = true;
      return;
    }

    if (!midiHighlightDirty && !pendingEvent) return;

    applyInProgress = true;
    applyAgain = false;

    try {
      // Coalesce multiple MIDI events into a single highlight update per animation frame.
      const event = pendingEvent;
      pendingEvent = null;

      if (event) {
        const selectedInputId = get(midiService.selectedInputId) || null;
        const graph = opts.getGraphState();
        const disabledNodeIds = opts.getGroupDisabledNodeIds();

        const result = computeMidiHighlightState({
          event,
          graph,
          disabledNodeIds,
          selectedInputId,
          sourceNodeTypes: midiSourceNodeTypes,
          traversalStopNodeTypes: midiTraversalStopNodeTypes,
          midiSourceMatchesEvent: midiSourceMatchesEvent as any,
        });

        if (result) {
          midiActiveNodeIds = result.nodeIds;
          midiActiveConnIds = result.connectionIds;
          midiActiveInputPortsByNode = result.inputPortsByNode;
          midiActiveOutputPortsByNode = result.outputPortsByNode;
          midiHighlightDirty = true;
        }
      }

      if (!midiHighlightDirty) return;
      midiHighlightDirty = false;

      // Only touch nodes/connections that are impacted by the diff.
      const affectedNodeIds = new Set<string>();
      const pushNodeIds = (ids: Iterable<string>) => {
        for (const id of ids) affectedNodeIds.add(id);
      };
      pushNodeIds(appliedNodeIds);
      pushNodeIds(midiActiveNodeIds);
      pushNodeIds(appliedInputPortsByNode.keys());
      pushNodeIds(midiActiveInputPortsByNode.keys());
      pushNodeIds(appliedOutputPortsByNode.keys());
      pushNodeIds(midiActiveOutputPortsByNode.keys());

      const nodeMap = opts.getNodeMap();
      for (const id of affectedNodeIds) {
        const node = nodeMap.get(id);
        if (!node) continue;

        const nextActive = midiActiveNodeIds.has(id);
        const nextInputs = Array.from(midiActiveInputPortsByNode.get(id) ?? []).sort();
        const nextOutputs = Array.from(midiActiveOutputPortsByNode.get(id) ?? []).sort();

        const prevActive = Boolean((node as any).active);
        const prevInputs = ((node as any).activeInputs ?? []) as string[];
        const prevOutputs = ((node as any).activeOutputs ?? []) as string[];

        let changed = false;
        if (prevActive !== nextActive) {
          (node as any).active = nextActive;
          changed = true;
        }
        if (prevInputs.length !== nextInputs.length || prevInputs.some((v, i) => v !== nextInputs[i])) {
          (node as any).activeInputs = nextInputs;
          changed = true;
        }
        if (prevOutputs.length !== nextOutputs.length || prevOutputs.some((v, i) => v !== nextOutputs[i])) {
          (node as any).activeOutputs = nextOutputs;
          changed = true;
        }

        if (changed) await areaPlugin.update('node', id);
      }

      const affectedConnIds = new Set<string>();
      const pushConnIds = (ids: Iterable<string>) => {
        for (const id of ids) affectedConnIds.add(id);
      };
      pushConnIds(appliedConnIds);
      pushConnIds(midiActiveConnIds);

      const connectionMap = opts.getConnectionMap();
      for (const id of affectedConnIds) {
        const conn = connectionMap.get(id);
        if (!conn) continue;

        const nextActive = midiActiveConnIds.has(id);
        if (Boolean((conn as any).active) !== nextActive) {
          (conn as any).active = nextActive;
          await areaPlugin.update('connection', id);
        }
      }

      appliedNodeIds = midiActiveNodeIds;
      appliedConnIds = midiActiveConnIds;
      appliedInputPortsByNode = midiActiveInputPortsByNode;
      appliedOutputPortsByNode = midiActiveOutputPortsByNode;
    } finally {
      applyInProgress = false;

      // If something arrived mid-apply, schedule another frame (avoid stuck dirty state).
      if (applyAgain || midiHighlightDirty || pendingEvent) scheduleApply();
    }
  };

  const handleMidiActivity = (event: MidiEvent) => {
    const selectedInputId = get(midiService.selectedInputId) || null;
    const graph = opts.getGraphState();
    const disabledNodeIds = opts.getGroupDisabledNodeIds();

    // Quick reject: only track MIDI activity that actually maps to a MIDI source node in the graph.
    const matched = (graph.nodes ?? [])
      .filter((n) => midiSourceNodeTypes.has(String(n.type)))
      .filter((n) => !disabledNodeIds.has(String(n.id)))
      .some((n) => midiSourceMatchesEvent((n.config as any)?.source, event, selectedInputId));

    if (!matched) return;

    pendingEvent = event;
    scheduleHighlight();

    if (midiHighlightTimeout) clearTimeout(midiHighlightTimeout);
    midiHighlightTimeout = setTimeout(() => clearHighlights(), MIDI_HIGHLIGHT_TTL_MS);
  };

  const start = () => {
    midiNodeBridge.init();
    midiUnsub = midiService.onMessage((event) => handleMidiActivity(event));
  };

  const stop = () => {
    midiUnsub?.();
    midiUnsub = null;
    if (midiHighlightTimeout) clearTimeout(midiHighlightTimeout);
    midiHighlightTimeout = null;
    cancelScheduledApply();
    pendingEvent = null;
    applyAgain = false;
  };

  return {
    start,
    stop,
    scheduleHighlight,
    applyHighlights,
    clearHighlights,
  };
}
