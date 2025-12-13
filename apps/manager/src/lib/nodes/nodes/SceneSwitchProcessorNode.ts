/**
 * SceneSwitchProcessorNode
 * Builds a `visualSceneSwitch` control command from config.
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const SceneSwitchProcessorNode: NodeDefinition = {
  type: 'proc-scene-switch',
  label: 'Visual Scene',
  category: 'Processors',
  inputs: [
    { id: 'client', label: 'Client', type: 'client' },
    { id: 'index', label: 'Index', type: 'number' },
  ],
  outputs: [{ id: 'cmd', label: 'Cmd', type: 'command' }],
  configSchema: [
    {
      key: 'sceneId',
      label: 'Scene',
      type: 'select',
      defaultValue: 'box-scene',
      options: [
        { value: 'box-scene', label: '3D Box' },
        { value: 'mel-scene', label: 'Mel Spectrogram' },
      ],
    },
  ],
  process: (inputs, config) => {
    const client = inputs.client as any;
    if (!client?.clientId) return { cmd: null };

    const sceneId =
      typeof inputs.index === 'number'
        ? (inputs.index as number) >= 0.5
          ? 'mel-scene'
          : 'box-scene'
        : String(config.sceneId ?? 'box-scene');
    return {
      cmd: {
        action: 'visualSceneSwitch',
        payload: { sceneId },
      },
    };
  },
};

nodeRegistry.register(SceneSwitchProcessorNode);

export default SceneSwitchProcessorNode;
