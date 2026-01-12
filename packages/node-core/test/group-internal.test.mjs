/**
 * Purpose: Unit tests for internal Group helper node definitions.
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

test('group-gate: returns boolean active (boolean-only)', () => {
  const registry = buildRegistry();
  const def = registry.get('group-gate');
  assert.ok(def, 'expected group-gate definition');

  assert.deepEqual(def.process({ active: true }, {}, context), { active: true });
  assert.deepEqual(def.process({ active: false }, {}, context), { active: false });
  assert.deepEqual(def.process({ active: 0 }, {}, context), { active: true });
  assert.deepEqual(def.process({}, {}, context), { active: true });
});

test('group-proxy: forwards input to out', () => {
  const registry = buildRegistry();
  const def = registry.get('group-proxy');
  assert.ok(def, 'expected group-proxy definition');

  assert.deepEqual(def.process({ in: 1 }, {}, context), { out: 1 });
  assert.deepEqual(def.process({ in: { foo: 'bar' } }, {}, context), { out: { foo: 'bar' } });
  assert.deepEqual(def.process({}, {}, context), { out: undefined });
});

