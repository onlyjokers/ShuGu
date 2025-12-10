/**
 * MathNode - Basic math operations
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const MathNode: NodeDefinition = {
  type: 'math',
  label: 'Math',
  category: 'Math',
  inputs: [
    { id: 'a', label: 'A', type: 'number', defaultValue: 0 },
    { id: 'b', label: 'B', type: 'number', defaultValue: 0 },
  ],
  outputs: [
    { id: 'result', label: 'Result', type: 'number' },
  ],
  configSchema: [
    { 
      key: 'operation', 
      label: 'Operation', 
      type: 'select', 
      defaultValue: '+',
      options: [
        { value: '+', label: 'Add (+)' },
        { value: '-', label: 'Subtract (-)' },
        { value: '*', label: 'Multiply (×)' },
        { value: '/', label: 'Divide (÷)' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
        { value: 'mod', label: 'Modulo (%)' },
        { value: 'pow', label: 'Power (^)' },
      ]
    },
  ],
  process: (inputs, config) => {
    const a = inputs.a as number ?? 0;
    const b = inputs.b as number ?? 0;
    const op = config.operation as string;
    
    let result: number;
    switch (op) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/': result = b !== 0 ? a / b : 0; break;
      case 'min': result = Math.min(a, b); break;
      case 'max': result = Math.max(a, b); break;
      case 'mod': result = b !== 0 ? a % b : 0; break;
      case 'pow': result = Math.pow(a, b); break;
      default: result = a + b;
    }
    
    return { result };
  },
};

// Auto-register
nodeRegistry.register(MathNode);

export default MathNode;
