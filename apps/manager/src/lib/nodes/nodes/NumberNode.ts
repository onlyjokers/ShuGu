/**
 * NumberNode - Constant number value
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const NumberNode: NodeDefinition = {
  type: 'number',
  label: 'Number',
  category: 'Values',
  inputs: [],
  outputs: [
    { id: 'value', label: 'Value', type: 'number' },
  ],
  configSchema: [
    { key: 'value', label: 'Value', type: 'number', defaultValue: 0 },
  ],
  process: (_inputs, config) => {
    return { value: config.value as number ?? 0 };
  },
};

// Auto-register
nodeRegistry.register(NumberNode);

export default NumberNode;
