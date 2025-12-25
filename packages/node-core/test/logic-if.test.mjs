/**
 * Purpose: Unit test for logic-if node definition (boolean router).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeRegistry, registerDefaultNodeDefinitions } from '../dist-node-core/index.js';

function buildRegistry() {
  const registry = new NodeRegistry();
  registerDefaultNodeDefinitions(registry, {
    getClientId: () => null,
    getAllClientIds: () => [],
    getSelectedClientIds: () => [],
    getLatestSensor: () => null,
    getSensorForClientId: () => null,
    executeCommand: () => {},
    executeCommandForClientId: () => {},
  });
  return registry;
}

test('logic-if routes boolean input based on condition', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-if');
  assert.ok(def, 'expected logic-if definition');

  const context = { nodeId: 'if1', time: 0, deltaTime: 0 };

  assert.deepEqual(def.process({ input: true, condition: true }, {}, context), { true: true, false: false });
  assert.deepEqual(def.process({ input: true, condition: false }, {}, context), { true: false, false: true });
  assert.deepEqual(def.process({ input: false, condition: true }, {}, context), { true: false, false: false });

  // Coercion: numbers behave like numeric booleans (>= 0.5).
  assert.deepEqual(def.process({ input: 1, condition: 0 }, {}, context), { true: false, false: true });
});

