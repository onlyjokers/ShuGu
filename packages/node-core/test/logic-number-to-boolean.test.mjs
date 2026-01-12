/**
 * Purpose: Unit tests for `logic-number-to-boolean` node definition.
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

const context = { nodeId: 'n1', time: 0, deltaTime: 0 };

test('logic-number-to-boolean: >= trigger => true', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-number-to-boolean');
  assert.ok(def, 'expected logic-number-to-boolean definition');

  assert.deepEqual(def.process({ number: 0, trigger: 0.5 }, {}, context), { out: false });
  assert.deepEqual(def.process({ number: 0.5, trigger: 0.5 }, {}, context), { out: true });
  assert.deepEqual(def.process({ number: 1, trigger: 0.5 }, {}, context), { out: true });
});

test('logic-number-to-boolean: non-finite inputs fall back to defaults', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-number-to-boolean');
  assert.ok(def, 'expected logic-number-to-boolean definition');

  assert.deepEqual(def.process({ number: NaN, trigger: 0.5 }, {}, context), { out: false });
  assert.deepEqual(def.process({ number: 1, trigger: NaN }, {}, context), { out: true });
});

