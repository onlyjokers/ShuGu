/**
 * Purpose: Unit tests for visual effect chain nodes + effect layer player.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NodeRegistry,
  NodeRuntime,
  registerDefaultNodeDefinitions,
} from '../dist-node-core/index.js';

function buildRegistry({ onCommand } = {}) {
  const registry = new NodeRegistry();
  registerDefaultNodeDefinitions(registry, {
    getClientId: () => null,
    getAllClientIds: () => [],
    getSelectedClientIds: () => [],
    getLatestSensor: () => null,
    getSensorForClientId: () => null,
    executeCommand: onCommand ?? (() => {}),
    executeCommandForClientId: () => {},
  });
  return registry;
}

function nodeInstance(id, type, overrides = {}) {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    config: {},
    inputValues: {},
    outputValues: {},
    ...overrides,
  };
}

test('effect-ascii appends {type:\"ascii\"} to the chain', () => {
  const registry = buildRegistry();
  const def = registry.get('effect-ascii');
  assert.ok(def, 'expected effect-ascii definition');

  const context = { nodeId: 'n1', time: 0, deltaTime: 0 };
  const out = def.process({ in: [], resolution: 13 }, {}, context);
  assert.deepEqual(out, { out: [{ type: 'ascii', cellSize: 13 }] });
});

test('effect-out sends visualEffects and clears on stop', () => {
  const sent = [];
  const registry = buildRegistry({
    onCommand: (cmd) => sent.push(cmd),
  });

  const runtime = new NodeRuntime(registry);
  runtime.loadGraph({
    nodes: [
      nodeInstance('fx', 'effect-ascii', { inputValues: { resolution: 9 } }),
      nodeInstance('out', 'effect-out'),
    ],
    connections: [
      {
        id: 'c1',
        sourceNodeId: 'fx',
        sourcePortId: 'out',
        targetNodeId: 'out',
        targetPortId: 'in',
      },
    ],
  });
  runtime.compileNow();

  // Start so sinks run (NodeRuntime skips sinks when timer is null).
  runtime.start();
  // Manually tick once (private in TS, accessible in JS).
  runtime.tick();

  assert.ok(sent.length >= 1);
  assert.deepEqual(sent[0], {
    action: 'visualEffects',
    payload: { effects: [{ type: 'ascii', cellSize: 9 }] },
  });

  runtime.stop();

  assert.ok(sent.length >= 2, 'expected a clear command on stop');
  assert.deepEqual(sent[sent.length - 1], {
    action: 'visualEffects',
    payload: { effects: [] },
  });
});
