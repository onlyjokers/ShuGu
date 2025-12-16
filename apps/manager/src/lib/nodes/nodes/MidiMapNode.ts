/**
 * MidiMapNode
 * Maps a fuzzy (0..1) signal into an output numeric range.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';
import { mapRangeWithOptions } from '$lib/features/midi/midi-math';

const MidiMapNode: NodeDefinition = {
  type: 'midi-map',
  label: 'Numeral Mapping',
  category: 'MIDI',
  inputs: [{ id: 'in', label: 'In', type: 'fuzzy' }],
  outputs: [{ id: 'out', label: 'Out', type: 'number' }],
  configSchema: [
    { key: 'min', label: 'Min', type: 'number', defaultValue: 0 },
    { key: 'max', label: 'Max', type: 'number', defaultValue: 1 },
    { key: 'invert', label: 'Invert', type: 'boolean', defaultValue: false },
    { key: 'round', label: 'Round', type: 'boolean', defaultValue: false },
  ],
  process: (inputs, config) => {
    const value = typeof inputs.in === 'number' ? (inputs.in as number) : null;
    if (value === null || !Number.isFinite(value)) return { out: null };

    const min = Number(config.min ?? 0);
    const max = Number(config.max ?? 1);
    const invert = Boolean(config.invert);
    const round = Boolean(config.round);

    const mapped = mapRangeWithOptions(value, min, max, invert);
    return { out: round ? Math.round(mapped) : mapped };
  },
};

nodeRegistry.register(MidiMapNode);

export default MidiMapNode;
