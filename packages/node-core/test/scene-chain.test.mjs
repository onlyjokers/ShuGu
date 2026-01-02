/**
 * Purpose: Unit tests for visual scene chain nodes + scene layer player.
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

test('scene-box appends {type:\"box\"} to the chain', () => {
  const registry = buildRegistry();
  const def = registry.get('scene-box');
  assert.ok(def, 'expected scene-box definition');

  const context = { nodeId: 'n1', time: 0, deltaTime: 0 };
  const out = def.process({ in: [] }, {}, context);
  assert.deepEqual(out, { out: [{ type: 'box' }] });
});

test('scene-out sends visualScenes and clears on stop', () => {
  const sent = [];
  const registry = buildRegistry({
    onCommand: (cmd) => sent.push(cmd),
  });

  const runtime = new NodeRuntime(registry);
  runtime.loadGraph({
    nodes: [
      nodeInstance('box', 'scene-box'),
      nodeInstance('cam', 'scene-front-camera'),
      nodeInstance('out', 'scene-out'),
    ],
    connections: [
      {
        id: 'c1',
        sourceNodeId: 'box',
        sourcePortId: 'out',
        targetNodeId: 'cam',
        targetPortId: 'in',
      },
      {
        id: 'c2',
        sourceNodeId: 'cam',
        sourcePortId: 'out',
        targetNodeId: 'out',
        targetPortId: 'in',
      },
    ],
  });
  runtime.compileNow();

  runtime.start();
  runtime.tick();

  assert.ok(sent.length >= 1);
  assert.deepEqual(sent[0], {
    action: 'visualScenes',
    payload: { scenes: [{ type: 'box' }, { type: 'frontCamera' }] },
  });

  runtime.stop();

  assert.ok(sent.length >= 2, 'expected a clear command on stop');
  assert.deepEqual(sent[sent.length - 1], {
    action: 'visualScenes',
    payload: { scenes: [] },
  });
});

