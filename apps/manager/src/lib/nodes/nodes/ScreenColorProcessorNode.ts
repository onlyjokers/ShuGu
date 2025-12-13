/**
 * ScreenColorProcessorNode
 * Builds a `screenColor` control command from config.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const ScreenColorProcessorNode: NodeDefinition = {
  type: 'proc-screen-color',
  label: 'Screen Color',
  category: 'Processors',
  inputs: [
    { id: 'client', label: 'Client', type: 'client' },
    { id: 'frequencyHz', label: 'Freq', type: 'number' },
    { id: 'maxOpacity', label: 'Max', type: 'number' },
    { id: 'minOpacity', label: 'Min', type: 'number' },
  ],
  outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
  configSchema: [
    { key: 'primary', label: 'Primary', type: 'string', defaultValue: '#6366f1' },
    { key: 'secondary', label: 'Secondary', type: 'string', defaultValue: '#ffffff' },
    { key: 'maxOpacity', label: 'Max Opacity', type: 'number', defaultValue: 1 },
    { key: 'minOpacity', label: 'Min Opacity', type: 'number', defaultValue: 0 },
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
      ],
    },
    { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 1.5 },
  ],
  process: (inputs, config) => {
    const client = inputs.client as any;
    if (!client?.clientId) return { cmd: null };

    const primary = String(config.primary ?? '#6366f1');
    const secondary = String(config.secondary ?? '#ffffff');
    const maxOpacity =
      typeof inputs.maxOpacity === 'number'
        ? (inputs.maxOpacity as number)
        : Number(config.maxOpacity ?? 1);
    const minOpacity =
      typeof inputs.minOpacity === 'number'
        ? (inputs.minOpacity as number)
        : Number(config.minOpacity ?? 0);
    const waveform = String(config.waveform ?? 'sine');
    const frequencyHz =
      typeof inputs.frequencyHz === 'number'
        ? (inputs.frequencyHz as number)
        : Number(config.frequencyHz ?? 1.5);

    return {
      cmd: {
        action: 'screenColor',
        payload: {
          mode: 'modulate',
          color: primary,
          secondaryColor: secondary,
          opacity: maxOpacity,
          minOpacity,
          maxOpacity,
          frequencyHz,
          waveform,
        },
      },
    };
  },
};

nodeRegistry.register(ScreenColorProcessorNode);

export default ScreenColorProcessorNode;
