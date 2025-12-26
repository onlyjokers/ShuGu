/**
 * Purpose: Unit tests for boolean logic gate node definitions.
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

test('logic-and', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-and');
  assert.ok(def, 'expected logic-and definition');

  assert.deepEqual(def.process({ a: false, b: false }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: true, b: false }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: false, b: true }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: true, b: true }, {}, context), { out: true });
});

test('logic-or', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-or');
  assert.ok(def, 'expected logic-or definition');

  assert.deepEqual(def.process({ a: false, b: false }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: true, b: false }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: false, b: true }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: true, b: true }, {}, context), { out: true });
});

test('logic-xor', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-xor');
  assert.ok(def, 'expected logic-xor definition');

  assert.deepEqual(def.process({ a: false, b: false }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: true, b: false }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: false, b: true }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: true, b: true }, {}, context), { out: false });
});

test('logic-nand', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-nand');
  assert.ok(def, 'expected logic-nand definition');

  assert.deepEqual(def.process({ a: false, b: false }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: true, b: false }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: false, b: true }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: true, b: true }, {}, context), { out: false });
});

test('logic-nor', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-nor');
  assert.ok(def, 'expected logic-nor definition');

  assert.deepEqual(def.process({ a: false, b: false }, {}, context), { out: true });
  assert.deepEqual(def.process({ a: true, b: false }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: false, b: true }, {}, context), { out: false });
  assert.deepEqual(def.process({ a: true, b: true }, {}, context), { out: false });
});

