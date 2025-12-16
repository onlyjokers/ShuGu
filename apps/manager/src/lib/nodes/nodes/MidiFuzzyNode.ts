/**
 * MidiFuzzyNode
 * Outputs a normalized 0..1 "fuzzy" value from a learned MIDI source.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';
import { midiNodeBridge, type MidiSource } from '$lib/features/midi/midi-node-bridge';

const MidiFuzzyNode: NodeDefinition = {
  type: 'midi-fuzzy',
  label: 'Fuzzy',
  category: 'MIDI',
  inputs: [],
  outputs: [{ id: 'value', label: 'Value', type: 'fuzzy' }],
  configSchema: [{ key: 'source', label: 'MIDI', type: 'midi-source', defaultValue: null }],
  process: (_inputs, config) => {
    const source = (config.source ?? null) as MidiSource | null;
    const normalized = midiNodeBridge.getNormalized(source);
    return { value: normalized ?? 0 };
  },
};

nodeRegistry.register(MidiFuzzyNode);

export default MidiFuzzyNode;

