/**
 * ParamSetNode - Writes a value to a parameter in the Registry
 * 
 * Supports DUAL-MODE:
 * - REMOTE: Sets base value (UI slider moves)
 * - MODULATION: Sets offset only (only effective bar moves)
 */
import type { NodeDefinition, ProcessContext } from '../types';
import { parameterRegistry } from '../../parameters/registry';
import { nodeRegistry } from '../registry';

const ParamSetNode: NodeDefinition = {
  type: 'param-set',
  label: 'Set Parameter',
  category: 'Parameters',
  inputs: [
    { id: 'value', label: 'Value', type: 'number', defaultValue: 0 },
    { id: 'bypass', label: 'Bypass', type: 'boolean', defaultValue: false },
  ],
  outputs: [
    { id: 'value', label: 'Pass Through', type: 'number' },
  ],
  configSchema: [
    { key: 'path', label: 'Parameter', type: 'param-path', defaultValue: '' },
    { 
      key: 'mode', 
      label: 'Mode', 
      type: 'select', 
      defaultValue: 'REMOTE',
      options: [
        { value: 'REMOTE', label: 'Remote (Control Base)' },
        { value: 'MODULATION', label: 'Modulation (Add Offset)' },
      ]
    },
  ],
  process: (inputs, config, context: ProcessContext) => {
    const path = config.path as string;
    const mode = config.mode as 'REMOTE' | 'MODULATION';
    const value = inputs.value as number ?? 0;
    const bypass = inputs.bypass as boolean ?? false;
    
    if (!path || bypass) {
      return { value };
    }
    
    const param = parameterRegistry.get<number>(path);
    if (!param) {
      return { value };
    }
    
    if (mode === 'REMOTE') {
      // REMOTE: Set base value (UI slider handle moves)
      param.setValue(value, 'NODE');
    } else {
      // MODULATION: Add offset (only effective bar moves)
      // Calculate offset as difference from current base
      const offset = value - param.baseValue;
      param.setModulation(`node-${context.nodeId}`, offset, 'NODE');
    }
    
    return { value };
  },
};

// Auto-register
nodeRegistry.register(ParamSetNode);

export default ParamSetNode;
