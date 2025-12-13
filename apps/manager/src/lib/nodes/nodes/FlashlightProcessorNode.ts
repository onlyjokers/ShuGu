/**
 * FlashlightProcessorNode
 * Builds a `flashlight` control command from config.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const FlashlightProcessorNode: NodeDefinition = {
  type: 'proc-flashlight',
  label: 'Flashlight',
  category: 'Processors',
  inputs: [
    { id: 'client', label: 'Client', type: 'client' },
    { id: 'frequencyHz', label: 'Freq', type: 'number' },
    { id: 'dutyCycle', label: 'Duty', type: 'number' },
  ],
  outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
  configSchema: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      defaultValue: 'blink',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
        { value: 'blink', label: 'Blink' },
      ],
    },
    { key: 'frequencyHz', label: 'Frequency (Hz)', type: 'number', defaultValue: 2 },
    { key: 'dutyCycle', label: 'Duty Cycle', type: 'number', defaultValue: 0.5 },
  ],
  process: (inputs, config) => {
    const client = inputs.client as any;
    if (!client?.clientId) return { cmd: null };

    const mode = String(config.mode ?? 'blink');
    if (mode === 'blink') {
      const freq =
        typeof inputs.frequencyHz === 'number'
          ? (inputs.frequencyHz as number)
          : Number(config.frequencyHz ?? 2);
      const duty =
        typeof inputs.dutyCycle === 'number'
          ? (inputs.dutyCycle as number)
          : Number(config.dutyCycle ?? 0.5);
      return {
        cmd: {
          action: 'flashlight',
          payload: {
            mode: 'blink',
            frequency: freq,
            dutyCycle: duty,
          },
        },
      };
    }

    return {
      cmd: {
        action: 'flashlight',
        payload: { mode },
      },
    };
  },
};

nodeRegistry.register(FlashlightProcessorNode);

export default FlashlightProcessorNode;
