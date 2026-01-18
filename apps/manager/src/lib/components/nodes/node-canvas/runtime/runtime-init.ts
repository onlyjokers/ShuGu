/**
 * Purpose: Centralized runtime wiring for NodeCanvas (patch runtime, client selection, sleep sockets).
 */
import type { SleepNodeSocketSync } from './sleep-node-sockets';
import { createSleepNodeSocketSync } from './sleep-node-sockets';
import type { PatchRuntime } from './patch-runtime';
import { createPatchRuntime } from './patch-runtime';
import type { ClientSelectionBinding } from './client-selection-binding';
import { createClientSelectionBinding } from './client-selection-binding';

type SleepSyncOptions = Parameters<typeof createSleepNodeSocketSync>[0];
type PatchRuntimeOptions = Parameters<typeof createPatchRuntime>[0];
type ClientSelectionOptions = Parameters<typeof createClientSelectionBinding>[0];

type RuntimeInitOptions = {
  nodeEngine: PatchRuntimeOptions['nodeEngine'] & ClientSelectionOptions['nodeEngine'];
  nodeRegistry: PatchRuntimeOptions['nodeRegistry'] & SleepSyncOptions['nodeRegistry'];
  adapter: PatchRuntimeOptions['adapter'];
  getGraphState: PatchRuntimeOptions['getGraphState'] &
    SleepSyncOptions['getGraphState'] &
    ClientSelectionOptions['getGraphState'];
  graphStateStore: ClientSelectionOptions['graphStateStore'];
  isRunningStore: PatchRuntimeOptions['isRunningStore'];
  groupDisabledNodeIds: PatchRuntimeOptions['groupDisabledNodeIds'];
  executorStatusByClient: PatchRuntimeOptions['executorStatusByClient'];
  showExecutorLogs: PatchRuntimeOptions['showExecutorLogs'];
  logsClientId: PatchRuntimeOptions['logsClientId'];
  loopController: PatchRuntimeOptions['loopController'];
  managerState: PatchRuntimeOptions['managerState'] & ClientSelectionOptions['managerState'];
  displayTransport: PatchRuntimeOptions['displayTransport'];
  getSDK: PatchRuntimeOptions['getSDK'];
  ensureDisplayLocalFilesRegisteredFromValue: PatchRuntimeOptions['ensureDisplayLocalFilesRegisteredFromValue'];
  sensorData: ClientSelectionOptions['sensorData'];
  getAreaPlugin: SleepSyncOptions['getAreaPlugin'] & ClientSelectionOptions['getAreaPlugin'];
  getNodeMap: SleepSyncOptions['getNodeMap'] & ClientSelectionOptions['getNodeMap'];
  sockets: SleepSyncOptions['sockets'];
};

export type RuntimeInitResult = {
  sleepNodeSockets: SleepNodeSocketSync;
  patchRuntime: PatchRuntime;
  clientSelectionBinding: ClientSelectionBinding;
};

export const initNodeCanvasRuntime = (opts: RuntimeInitOptions): RuntimeInitResult => {
  const sleepNodeSockets = createSleepNodeSocketSync({
    getGraphState: opts.getGraphState,
    nodeRegistry: opts.nodeRegistry,
    sockets: opts.sockets,
    getAreaPlugin: opts.getAreaPlugin,
    getNodeMap: opts.getNodeMap,
  });

  const patchRuntime = createPatchRuntime({
    nodeEngine: opts.nodeEngine,
    nodeRegistry: opts.nodeRegistry,
    adapter: opts.adapter,
    isRunningStore: opts.isRunningStore,
    getGraphState: opts.getGraphState,
    groupDisabledNodeIds: opts.groupDisabledNodeIds,
    executorStatusByClient: opts.executorStatusByClient,
    showExecutorLogs: opts.showExecutorLogs,
    logsClientId: opts.logsClientId,
    loopController: opts.loopController,
    managerState: opts.managerState,
    displayTransport: opts.displayTransport,
    getSDK: opts.getSDK,
    ensureDisplayLocalFilesRegisteredFromValue: opts.ensureDisplayLocalFilesRegisteredFromValue,
  });

  const clientSelectionBinding = createClientSelectionBinding({
    nodeEngine: opts.nodeEngine,
    graphStateStore: opts.graphStateStore,
    getGraphState: opts.getGraphState,
    managerState: opts.managerState,
    sensorData: opts.sensorData,
    getAreaPlugin: opts.getAreaPlugin,
    getNodeMap: opts.getNodeMap,
    sendNodeOverride: patchRuntime.sendNodeOverride,
  });

  return { sleepNodeSockets, patchRuntime, clientSelectionBinding };
};
