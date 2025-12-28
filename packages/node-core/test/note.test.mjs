/**
 * Purpose: Unit test for note node definition (no-op node with persisted text config).
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

test('note has no ports and no outputs', () => {
  const registry = buildRegistry();
  const def = registry.get('note');
  assert.ok(def, 'expected note definition');

  assert.deepEqual(def.inputs, []);
  assert.deepEqual(def.outputs, []);
  assert.deepEqual(def.configSchema, [{ key: 'text', label: 'Text', type: 'string', defaultValue: '' }]);

  const context = { nodeId: 'n1', time: 0, deltaTime: 0 };
  assert.deepEqual(def.process({}, { text: 'hello' }, context), {});
});

