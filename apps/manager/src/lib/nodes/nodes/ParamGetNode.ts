/**
 * ParamGetNode - Reads a parameter value from the Registry
 */
import type { NodeDefinition } from '../types';
import { parameterRegistry } from '../../parameters/registry';
import { nodeRegistry } from '../registry';

const ParamGetNode: NodeDefinition = {
  type: 'param-get',
  label: 'Get Parameter',
  category: 'Parameters',
  inputs: [],
  outputs: [
    { id: 'value', label: 'Value', type: 'number' },
  ],
  configSchema: [
    { key: 'path', label: 'Parameter', type: 'param-path', defaultValue: '' },
  ],
  process: (_inputs, config) => {
    const path = config.path as string;
    if (!path) return { value: 0 };
    
    const param = parameterRegistry.get<number>(path);
    if (!param) return { value: 0 };
    
    return { value: param.effectiveValue };
  },
};

// Auto-register
nodeRegistry.register(ParamGetNode);

export default ParamGetNode;
