/**
 * Purpose: Unit test for logic-not node definition (boolean NOT gate).
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

test('logic-not inverts boolean input', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-not');
  assert.ok(def, 'expected logic-not definition');

  const context = { nodeId: 'n1', time: 0, deltaTime: 0 };

  assert.deepEqual(def.process({ in: true }, {}, context), { out: false });
  assert.deepEqual(def.process({ in: false }, {}, context), { out: true });
});

