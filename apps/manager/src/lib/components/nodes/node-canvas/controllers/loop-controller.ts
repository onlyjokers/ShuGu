/**
 * Purpose: Loop frames, deployment state, and executor log handling for NodeCanvas.
 */
import { get, writable, type Writable } from 'svelte/store';
import type { LocalLoop } from '$lib/nodes';
import { sensorData } from '$lib/stores/manager';
import type { GraphState } from '$lib/nodes/types';
import { readAreaTransform, unionBounds } from '../utils/view-utils';
import {
  createLoopActions,
  loopHasDisabledNodes,
  updateExecutorStatus,
  type DeployPendingEntry,
  type ExecutorClientStatus,
  type ExecutorLogEntry,
  type ExecutorStatusMap,
  type LoopActions,
  type ManagerSdkLike,
} from './loop-helpers';

export type LoopFrame = { loop: LocalLoop; left: number; top: number; width: number; height: number };

type LoopControllerOptions = {
  nodeEngine: {
    localLoops: Writable<LocalLoop[]>;
    deployedLoops: Writable<string[]>;
    markLoopDeployed: (loopId: string, deployed: boolean) => void;
    exportGraphForLoop: (loopId: string) => any;
  };
  getSDK: () => ManagerSdkLike | null;
  isRunning: () => boolean;
  getGraphState: () => GraphState;
  getAreaPlugin: () => any;
  getNodeMap: () => Map<string, any>;
  getConnectionMap: () => Map<string, any>;
  getGroupDisabledNodeIds: () => Set<string>;
  isSyncingGraph: () => boolean;
  onDeployTimeout: (loopId: string) => void;
  onDeployError: (message: string) => void;
  onDeployMissingClient: () => void;
  onMissingSdk: () => void;
  onLoopVanished: (loopId: string, clientId: string) => void;
  onLoopFrameReady: (loop: LocalLoop) => void;
};

export type LoopController = {
  localLoops: Writable<LocalLoop[]>;
  deployedLoopIds: Writable<Set<string>>;
  loopFrames: Writable<LoopFrame[]>;
  executorStatusByClient: Writable<ExecutorStatusMap>;
  showExecutorLogs: Writable<boolean>;
  logsClientId: Writable<string>;
  deployedNodeIds: Writable<Set<string>>;
  deployedConnIds: Writable<Set<string>>;
  localLoopConnIds: Writable<Set<string>>;
  loopActions: LoopActions;
  isLoopDeploying: (loopId: string) => boolean;
  loopHasDisabledNodes: (loop: LocalLoop) => boolean;
  toggleLoopLogs: (loop: LocalLoop) => void;
  requestFramesUpdate: () => void;
  applyHighlights: () => Promise<void>;
  scheduleHighlight: () => void;
  destroy: () => void;
};

export function createLoopController(opts: LoopControllerOptions): LoopController {
  const localLoops = writable<LocalLoop[]>([]);
  const deployedLoopIds = writable<Set<string>>(new Set());
  const loopFrames = writable<LoopFrame[]>([]);
  const deployedNodeIds = writable<Set<string>>(new Set());
  const deployedConnIds = writable<Set<string>>(new Set());
  const localLoopConnIds = writable<Set<string>>(new Set());
  const localLoopNodeIds = writable<Set<string>>(new Set());

  const executorStatusByClient = writable<ExecutorStatusMap>(new Map());
  const showExecutorLogs = writable(false);
  const logsClientId = writable('');

  let deployPendingByLoopId = new Map<string, DeployPendingEntry>();
  let deployedLoopClientIdByLoopId = new Map<string, string>();

  let loopHighlightDirty = false;
  let loopFramesRaf = 0;
  let loopsUnsub: (() => void) | null = null;
  let deployedLoopsUnsub: (() => void) | null = null;
  let sensorUnsub: (() => void) | null = null;
  const executorLastServerTimestampByClient = new Map<string, number>();

  const loopActions = createLoopActions({
    getSDK: opts.getSDK,
    getGraphState: opts.getGraphState,
    getLocalLoops: () => get(localLoops),
    getDeployedLoopIds: () => get(deployedLoopIds),
    getDeployPendingByLoopId: () => deployPendingByLoopId,
    getDeployedLoopClientIdByLoopId: () => deployedLoopClientIdByLoopId,
    setDeployPendingByLoopId: (next) => (deployPendingByLoopId = next),
    setDeployedLoopClientIdByLoopId: (next) => (deployedLoopClientIdByLoopId = next),
    markLoopDeployed: opts.nodeEngine.markLoopDeployed,
    exportGraphForLoop: opts.nodeEngine.exportGraphForLoop,
    isRunning: opts.isRunning,
    onDeployTimeout: opts.onDeployTimeout,
    onDeployError: opts.onDeployError,
    onDeployMissingClient: opts.onDeployMissingClient,
    onMissingSdk: opts.onMissingSdk,
  });

  const recomputeLoopHighlightSets = () => {
    const loops = get(localLoops);
    const deployedIds = get(deployedLoopIds);
    const localNodes = new Set<string>();
    const localConns = new Set<string>();
    const deployedNodes = new Set<string>();
    const deployedConns = new Set<string>();

    for (const loop of loops) {
      for (const nid of loop.nodeIds) localNodes.add(nid);
      for (const cid of loop.connectionIds) localConns.add(cid);
      if (!deployedIds.has(loop.id)) continue;
      for (const nid of loop.nodeIds) deployedNodes.add(nid);
      for (const cid of loop.connectionIds) deployedConns.add(cid);
    }

    localLoopNodeIds.set(localNodes);
    localLoopConnIds.set(localConns);
    deployedNodeIds.set(deployedNodes);
    deployedConnIds.set(deployedConns);
    scheduleHighlight();
  };

  const scheduleHighlight = () => {
    loopHighlightDirty = true;
    if (!opts.isSyncingGraph()) void applyHighlights();
  };

  const applyHighlights = async () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin) return;
    if (!loopHighlightDirty) return;
    loopHighlightDirty = false;

    const localNodes = get(localLoopNodeIds);
    const deployedNodes = get(deployedNodeIds);
    const localConns = get(localLoopConnIds);
    const deployedConns = get(deployedConnIds);

    for (const [id, node] of opts.getNodeMap().entries()) {
      const nextLocal = localNodes.has(id);
      const nextDeployed = deployedNodes.has(id);
      if (Boolean((node as any).localLoop) !== nextLocal) {
        (node as any).localLoop = nextLocal;
        await areaPlugin.update('node', id);
      }
      if (Boolean((node as any).deployedLoop) !== nextDeployed) {
        (node as any).deployedLoop = nextDeployed;
        await areaPlugin.update('node', id);
      }
    }

    for (const [id, conn] of opts.getConnectionMap().entries()) {
      const nextLocal = localConns.has(id);
      const nextDeployed = deployedConns.has(id);
      if (Boolean((conn as any).localLoop) !== nextLocal) {
        (conn as any).localLoop = nextLocal;
        await areaPlugin.update('connection', id);
      }
      if (Boolean((conn as any).deployedLoop) !== nextDeployed) {
        (conn as any).deployedLoop = nextDeployed;
        await areaPlugin.update('connection', id);
      }
    }
  };

  const computeLoopFrames = () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin?.nodeViews || !areaPlugin?.area) {
      loopFrames.set([]);
      return;
    }

    const t = readAreaTransform(areaPlugin);
    if (!t) {
      loopFrames.set([]);
      return;
    }

    const paddingX = 56;
    const paddingTop = 64;
    const paddingBottom = 64;

    const frames: LoopFrame[] = [];
    for (const loop of get(localLoops)) {
      const bounds = unionBounds(areaPlugin, loop.nodeIds, t);
      if (!bounds) continue;
      const left = bounds.left;
      const top = bounds.top;
      const right = bounds.right;
      const bottom = bounds.bottom;

      const localLeft = left - paddingX;
      const localTop = top - paddingTop;
      const localWidth = right - left + paddingX * 2;
      const localHeight = bottom - top + paddingTop + paddingBottom;

      frames.push({
        loop,
        left: localLeft,
        top: localTop,
        width: localWidth,
        height: localHeight,
      });
    }

    loopFrames.set(frames);
  };

  const requestFramesUpdate = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (loopFramesRaf) return;
    loopFramesRaf = requestAnimationFrame(() => {
      loopFramesRaf = 0;
      computeLoopFrames();
    });
  };

  const toggleLoopLogs = (loop: LocalLoop) => {
    const clientId = loopActions.getLoopClientId(loop);
    if (!clientId) return;
    if (get(showExecutorLogs) && get(logsClientId) === clientId) {
      showExecutorLogs.set(false);
      return;
    }
    logsClientId.set(clientId);
    showExecutorLogs.set(true);
  };

  const loopHasDisabledNodesForLoop = (loop: LocalLoop) => loopHasDisabledNodes(loop, opts.getGroupDisabledNodeIds());

  loopsUnsub = opts.nodeEngine.localLoops.subscribe((loops) => {
    const nextLoops = Array.isArray(loops) ? loops : [];
    const prevLoopIds = new Set(get(localLoops).map((l) => l.id));
    const addedLoops = nextLoops.filter((l) => !prevLoopIds.has(l.id));

    const nextIds = new Set(nextLoops.map((l) => l.id));
    const vanished = get(localLoops).filter((l) => !nextIds.has(l.id));

    for (const loop of vanished) {
      const loopId = loop.id;
      const pending = deployPendingByLoopId.get(loopId);
      if (pending) loopActions.clearLoopDeployPending(loopId);

      const knownClientId = deployedLoopClientIdByLoopId.get(loopId) ?? pending?.clientId ?? '';
      if (!knownClientId) continue;

      const hadDeployment = deployedLoopClientIdByLoopId.has(loopId) || Boolean(pending);
      if (!hadDeployment) continue;

      loopActions.stopAndRemoveLoopById(loopId, knownClientId);
      const next = new Map(deployedLoopClientIdByLoopId);
      next.delete(loopId);
      deployedLoopClientIdByLoopId = next;
      opts.onLoopVanished(loopId, knownClientId);
    }

    localLoops.set(nextLoops);
    recomputeLoopHighlightSets();
    requestFramesUpdate();

    if (addedLoops.length > 0) {
      for (const loop of addedLoops) {
        opts.onLoopFrameReady(loop);
      }
    }
  });

  deployedLoopsUnsub = opts.nodeEngine.deployedLoops.subscribe((ids) => {
    deployedLoopIds.set(new Set(Array.isArray(ids) ? ids : []));
    recomputeLoopHighlightSets();
    requestFramesUpdate();
  });

  sensorUnsub = sensorData.subscribe((map) => {
    for (const [clientId, msg] of map.entries()) {
      const m: any = msg as any;
      if (!m || m.sensorType !== 'custom') continue;
      const payload: any = m.payload ?? {};
      if (payload?.kind !== 'node-executor') continue;

      const serverTs = Number(m.serverTimestamp ?? 0);
      if (!Number.isFinite(serverTs) || serverTs <= 0) continue;
      if (executorLastServerTimestampByClient.get(clientId) === serverTs) continue;
      executorLastServerTimestampByClient.set(clientId, serverTs);

      const event = typeof payload.event === 'string' ? payload.event : 'unknown';
      const loopId = typeof payload.loopId === 'string' ? payload.loopId : null;
      const error = payload.error ? String(payload.error) : null;

      executorStatusByClient.set(
        updateExecutorStatus(get(executorStatusByClient), clientId, {
          at: serverTs,
          event,
          loopId,
          error,
          payload: payload as Record<string, unknown>,
        })
      );

      if (loopId && event === 'removed') {
        const next = new Map(deployedLoopClientIdByLoopId);
        next.delete(loopId);
        deployedLoopClientIdByLoopId = next;
      }

      if (!loopId) continue;
      const pending = deployPendingByLoopId.get(loopId);
      if (!pending) continue;
      if (pending.clientId !== clientId) continue;

      if (event === 'deployed') {
        opts.nodeEngine.markLoopDeployed(loopId, true);
        const next = new Map(deployedLoopClientIdByLoopId);
        next.set(loopId, clientId);
        deployedLoopClientIdByLoopId = next;
        loopActions.clearLoopDeployPending(loopId);
        continue;
      }

      if (event === 'rejected' || event === 'error') {
        loopActions.clearLoopDeployPending(loopId);
        opts.onDeployError(error ?? event);
      }
    }
  });

  return {
    localLoops,
    deployedLoopIds,
    loopFrames,
    executorStatusByClient,
    showExecutorLogs,
    logsClientId,
    deployedNodeIds,
    deployedConnIds,
    localLoopConnIds,
    loopActions,
    isLoopDeploying: loopActions.isLoopDeploying,
    loopHasDisabledNodes: loopHasDisabledNodesForLoop,
    toggleLoopLogs,
    requestFramesUpdate,
    applyHighlights,
    scheduleHighlight,
    destroy: () => {
      loopsUnsub?.();
      deployedLoopsUnsub?.();
      sensorUnsub?.();
      for (const entry of deployPendingByLoopId.values()) {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
      }
      if (loopFramesRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(loopFramesRaf);
      loopFramesRaf = 0;
    },
  };
}
