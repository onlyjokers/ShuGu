/**
 * Purpose: Regression test for command sink diffing (avoid re-triggering unrelated commands).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeRegistry, NodeRuntime } from '../dist/index.js';

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

function withFakeNow(t, initialNow = 0) {
  const realNow = Date.now;
  let now = initialNow;
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
  });
  return {
    setNow: (next) => {
      now = next;
    },
  };
}

test('command sink receives only changed commands when bundled', (t) => {
  const clock = withFakeNow(t, 0);

  const received = [];
  const registry = new NodeRegistry();
  registry.register({
    type: 'const-screen',
    label: 'Const Screen',
    category: 'Test',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', type: 'command' }],
    configSchema: [],
    process: () => ({ out: { action: 'screenColor', payload: { color: '#ff0000', opacity: 1 } } }),
  });
  registry.register({
    type: 'time-synth',
    label: 'Time Synth',
    category: 'Test',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', type: 'command' }],
    configSchema: [],
    process: (_inputs, _config, context) => ({
      out: { action: 'modulateSoundUpdate', payload: { frequency: context.time } },
    }),
  });
  registry.register({
    type: 'sink',
    label: 'Sink',
    category: 'Test',
    inputs: [{ id: 'in', label: 'In', type: 'command', kind: 'sink' }],
    outputs: [],
    configSchema: [],
    process: () => ({}),
    onSink: (inputs) => {
      const raw = inputs.in;
      const commands = Array.isArray(raw) ? raw : [raw];
      received.push(commands.map((cmd) => (cmd && typeof cmd === 'object' ? cmd.action : null)));
    },
  });

  const runtime = new NodeRuntime(registry);
  runtime.loadGraph({
    nodes: [
      nodeInstance('a', 'const-screen'),
      nodeInstance('b', 'time-synth'),
      nodeInstance('s', 'sink'),
    ],
    connections: [
      { id: 'c1', sourceNodeId: 'a', sourcePortId: 'out', targetNodeId: 's', targetPortId: 'in' },
      { id: 'c2', sourceNodeId: 'b', sourcePortId: 'out', targetNodeId: 's', targetPortId: 'in' },
    ],
  });
  runtime.compileNow();
  // NodeRuntime only invokes onSink when "started" (timer running). For a deterministic unit test
  // we fake a truthy timer instead of relying on real setInterval scheduling.
  runtime.timer = 1;

  clock.setNow(0);
  runtime.tick();
  assert.deepEqual(received[0], ['screenColor', 'modulateSoundUpdate']);

  // Only the synth command changes, so the sink should only receive that one (no screenColor retrigger).
  clock.setNow(10);
  runtime.tick();
  assert.deepEqual(received[1], ['modulateSoundUpdate']);
});
