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
  let midiHighlightDirty = false;
  let midiActiveNodeIds = new Set<string>();
  let midiActiveConnIds = new Set<string>();
  let midiActiveInputPortsByNode = new Map<string, Set<string>>();
  let midiActiveOutputPortsByNode = new Map<string, Set<string>>();

  const clearHighlights = () => {
    midiActiveNodeIds = new Set();
    midiActiveConnIds = new Set();
    midiActiveInputPortsByNode = new Map();
    midiActiveOutputPortsByNode = new Map();
    scheduleHighlight();
  };

  const scheduleHighlight = () => {
    midiHighlightDirty = true;
    if (!opts.isSyncingGraph()) void applyHighlights();
  };

  const applyHighlights = async () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin) return;
    if (!midiHighlightDirty) return;
    midiHighlightDirty = false;

    for (const [id, node] of opts.getNodeMap().entries()) {
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

    for (const [id, conn] of opts.getConnectionMap().entries()) {
      const nextActive = midiActiveConnIds.has(id);
      if (Boolean((conn as any).active) !== nextActive) {
        (conn as any).active = nextActive;
        await areaPlugin.update('connection', id);
      }
    }
  };

  const handleMidiActivity = (event: MidiEvent) => {
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
      midiSourceMatchesEvent,
    });

    if (!result) return;
    midiActiveNodeIds = result.nodeIds;
    midiActiveConnIds = result.connectionIds;
    midiActiveInputPortsByNode = result.inputPortsByNode;
    midiActiveOutputPortsByNode = result.outputPortsByNode;
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
  };

  return {
    start,
    stop,
    scheduleHighlight,
    applyHighlights,
    clearHighlights,
  };
}
