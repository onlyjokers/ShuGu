/**
 * Purpose: Unit test for show-anything node definition (string preview).
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

test('show-anything formats primitive values', () => {
  const registry = buildRegistry();
  const def = registry.get('show-anything');
  assert.ok(def, 'expected show-anything definition');

  const context = { nodeId: 's1', time: 0, deltaTime: 0 };

  assert.deepEqual(def.process({ in: true }, {}, context), { value: 'true' });
  assert.deepEqual(def.process({ in: false }, {}, context), { value: 'false' });
  assert.deepEqual(def.process({ in: 1.23456 }, {}, context), { value: '1.235' });
  assert.deepEqual(def.process({ in: 'hello' }, {}, context), { value: 'hello' });
  assert.deepEqual(def.process({ in: null }, {}, context), { value: 'null' });
  assert.deepEqual(def.process({ in: undefined }, {}, context), { value: '--' });
});

