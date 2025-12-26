/**
 * Purpose: Unit test for logic-for node definition (finite loop with start trigger + wait).
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

test('logic-for runs once per rising edge and respects wait', () => {
  const registry = buildRegistry();
  const def = registry.get('logic-for');
  assert.ok(def, 'expected logic-for definition');

  const context = { nodeId: 'for1', time: 0, deltaTime: 0 };

  // Idle (no start trigger).
  assert.deepEqual(def.process({ run: false, start: 1, end: 3, wait: 10 }, {}, context), {
    running: false,
    loopEnd: false,
  });

  // Rising edge triggers first emission immediately.
  assert.deepEqual(def.process({ run: true, start: 1, end: 3, wait: 10 }, {}, context), {
    index: 1,
    running: true,
    loopEnd: false,
  });

  // Waiting between steps.
  context.time = 5;
  assert.deepEqual(def.process({ run: true, start: 1, end: 3, wait: 10 }, {}, context), {
    running: true,
    loopEnd: false,
  });

  // Step 2.
  context.time = 10;
  assert.deepEqual(def.process({ run: true, start: 1, end: 3, wait: 10 }, {}, context), {
    index: 2,
    running: true,
    loopEnd: false,
  });

  // Step 3 ends the run (running flips false; loopEnd pulses true).
  context.time = 20;
  assert.deepEqual(def.process({ run: true, start: 1, end: 3, wait: 10 }, {}, context), {
    index: 3,
    running: false,
    loopEnd: true,
  });

  // Holding run=true does not restart.
  context.time = 30;
  assert.deepEqual(def.process({ run: true, start: 1, end: 3, wait: 10 }, {}, context), {
    running: false,
    loopEnd: false,
  });

  // Drop and raise run again to restart.
  context.time = 31;
  assert.deepEqual(def.process({ run: false, start: 1, end: 2, wait: 0 }, {}, context), {
    running: false,
    loopEnd: false,
  });
  context.time = 32;
  assert.deepEqual(def.process({ run: true, start: 1, end: 2, wait: 0 }, {}, context), {
    index: 1,
    running: true,
    loopEnd: false,
  });
});
