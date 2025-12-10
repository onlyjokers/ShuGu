/**
 * LFONode - Low Frequency Oscillator
 * Outputs a value between 0 and 1 based on time
 */
import type { NodeDefinition, ProcessContext } from '../types';
import { nodeRegistry } from '../registry';

const LFONode: NodeDefinition = {
  type: 'lfo',
  label: 'LFO',
  category: 'Generators',
  inputs: [
    { id: 'frequency', label: 'Freq (Hz)', type: 'number', defaultValue: 1 },
    { id: 'amplitude', label: 'Amplitude', type: 'number', defaultValue: 1 },
    { id: 'offset', label: 'Offset', type: 'number', defaultValue: 0 },
  ],
  outputs: [
    { id: 'value', label: 'Value', type: 'number' },
  ],
  configSchema: [
    { 
      key: 'waveform', 
      label: 'Waveform', 
      type: 'select', 
      defaultValue: 'sine',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'square', label: 'Square' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'sawtooth', label: 'Sawtooth' },
      ]
    },
  ],
  process: (inputs, config, context: ProcessContext) => {
    const frequency = inputs.frequency as number ?? 1;
    const amplitude = inputs.amplitude as number ?? 1;
    const offset = inputs.offset as number ?? 0;
    const waveform = config.waveform as string ?? 'sine';
    
    // Calculate phase based on time
    const phase = (context.time / 1000) * frequency * 2 * Math.PI;
    
    let normalized: number;
    switch (waveform) {
      case 'sine':
        normalized = (Math.sin(phase) + 1) / 2; // 0 to 1
        break;
      case 'square':
        normalized = Math.sin(phase) >= 0 ? 1 : 0;
        break;
      case 'triangle':
        normalized = Math.abs(((context.time / 1000) * frequency * 2) % 2 - 1);
        break;
      case 'sawtooth':
        normalized = ((context.time / 1000) * frequency) % 1;
        break;
      default:
        normalized = (Math.sin(phase) + 1) / 2;
    }
    
    const value = offset + normalized * amplitude;
    
    return { value };
  },
};

// Auto-register
nodeRegistry.register(LFONode);

export default LFONode;
