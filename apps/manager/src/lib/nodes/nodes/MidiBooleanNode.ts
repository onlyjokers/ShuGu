/**
 * MidiBooleanNode
 * Outputs boolean state from a learned MIDI source.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';
import { midiNodeBridge, type MidiSource } from '$lib/features/midi/midi-node-bridge';

const MidiBooleanNode: NodeDefinition = {
  type: 'midi-boolean',
  label: 'Boolean',
  category: 'MIDI',
  inputs: [],
  outputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
  configSchema: [
    { key: 'source', label: 'MIDI', type: 'midi-source', defaultValue: null },
    { key: 'threshold', label: 'Threshold', type: 'number', defaultValue: 0.5 },
  ],
  process: (_inputs, config) => {
    const source = (config.source ?? null) as MidiSource | null;
    const thresholdRaw = Number(config.threshold ?? 0.5);
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 0.5;

    const event = midiNodeBridge.getEvent(source);
    if (!event) return { value: false };

    if (event.type === 'note') return { value: Boolean(event.isPress) };
    return { value: event.normalized >= threshold };
  },
};

nodeRegistry.register(MidiBooleanNode);

export default MidiBooleanNode;

