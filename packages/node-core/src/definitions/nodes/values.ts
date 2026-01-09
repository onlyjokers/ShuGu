/**
 * Purpose: Constant/value and display nodes.
 */
import type { NodeDefinition } from '../../types.js';
import { coerceBoolean, formatAnyPreview } from '../utils.js';

export function createShowAnythingNode(): NodeDefinition {
  return {
    type: 'show-anything',
    label: 'Show Anything',
    category: 'Other',
    inputs: [{ id: 'in', label: 'In', type: 'any' }],
    outputs: [{ id: 'value', label: 'Value', type: 'string' }],
    configSchema: [],
    process: (inputs) => ({ value: formatAnyPreview(inputs.in) }),
  };
}

export function createNoteNode(): NodeDefinition {
  return {
    type: 'note',
    label: 'Note',
    category: 'Other',
    inputs: [],
    outputs: [],
    configSchema: [{ key: 'text', label: 'Text', type: 'string', defaultValue: '' }],
    process: () => ({}),
  };
}

// Value-box style nodes: editable constants that also pass through connected inputs.
export function createNumberNode(): NodeDefinition {
  return {
    type: 'number',
    label: 'Number',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'number' }],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'number', defaultValue: 0 }],
    process: (inputs, config) => {
      const fromInput = inputs.value;
      if (typeof fromInput === 'number' && Number.isFinite(fromInput)) return { value: fromInput };
      const fallback = Number(config.value ?? 0);
      return { value: Number.isFinite(fallback) ? fallback : 0 };
    },
  };
}

export function createStringNode(): NodeDefinition {
  return {
    type: 'string',
    label: 'String',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'string' }],
    outputs: [{ id: 'value', label: 'Value', type: 'string' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'string', defaultValue: '' }],
    process: (inputs, config) => {
      const fromInput = inputs.value;
      if (typeof fromInput === 'string') return { value: fromInput };
      const fallback = config.value;
      return { value: typeof fallback === 'string' ? fallback : '' };
    },
  };
}

export function createBoolNode(): NodeDefinition {
  return {
    type: 'bool',
    label: 'Bool',
    category: 'Values',
    inputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
    outputs: [{ id: 'value', label: 'Value', type: 'boolean' }],
    configSchema: [{ key: 'value', label: 'Value', type: 'boolean', defaultValue: false }],
    process: (inputs, config) => {
      if (inputs.value !== undefined) return { value: coerceBoolean(inputs.value) };
      return { value: coerceBoolean(config.value) };
    },
  };
}
