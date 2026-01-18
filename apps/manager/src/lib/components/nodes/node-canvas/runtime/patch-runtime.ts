/**
 * Purpose: Patch deployment + runtime override orchestration for NodeCanvas (manager-only runtime layer).
 */

import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type {
  Connection,
  GraphState,
  NodeDefinition,
  NodeInstance,
  NodePort,
} from '$lib/nodes/types';
import type { GraphViewAdapter } from '../adapters/graph-view-adapter';
import { buildStableRandomOrder, clampInt, coerceBoolean, toFiniteNumber } from './client-utils';
import { createNodeExecutorTransport } from './node-executor-transport';
import { createPatchVisualState } from './patch-visual-state';
import { createMidiBridge } from './midi-bridge';
import { createMidiLoopBridge } from './midi-loop-bridge';

type AnyRecord = Record<string, unknown>;

type PatchPayload = {
  graph: Pick<GraphState, 'nodes' | 'connections'>;
  meta: {
    loopId: string;
    requiredCapabilities: string[];
    tickIntervalMs: number;
    protocolVersion: string;
    executorVersion: string;
  };
  assetRefs: string[];
};

const asRecord = (value: unknown): AnyRecord | null =>
  value && typeof value === 'object' ? (value as AnyRecord) : null;

type NodeRegistryLike = {
  get(type: string): NodeDefinition | undefined;
};

type NodeEngineLike = {
  getNode(nodeId: string): NodeInstance | undefined;
  getLastComputedInputs(nodeId: string): Record<string, unknown> | null;
  exportGraphForPatchFromRootNodeIds(rootNodeIds: string[]): PatchPayload;
  lastError: Readable<string | null> & { set(value: string | null): void };
  setPatchOffloadedNodeIds(nodeIds: string[]): void;
  getTimeRangePlayheadSec(nodeId: string): number | null;
};

type ManagerStateLike = { clients?: unknown[]; selectedClientIds?: unknown[] };

type DisplayTransportLike = {
  getAvailability: () => {
    route: string;
    hasLocalSession: boolean;
    hasLocalReady: boolean;
    hasRemoteDisplay: boolean;
  };
  sendPlugin: (
    pluginId: string,
    command: string,
    payload?: Record<string, unknown>,
    options?: { forceServer?: boolean; localOnly?: boolean }
  ) => {
    route: string;
    hasLocalSession: boolean;
    hasLocalReady: boolean;
    hasRemoteDisplay: boolean;
  };
};

type SdkLike = {
  sendPluginControl: (
    target: { mode: 'clientIds'; ids: string[] },
    pluginName: string,
    command: string,
    payload: unknown
  ) => void;
};

type LoopControllerLike = {
  deployedLoopIds: Readable<Set<string>>;
  localLoops: Readable<unknown[]>;
  loopActions: {
    getLoopClientId(loop: unknown): string | null;
    getDeployedLoopForNode(nodeId: string): { id: string } | null;
  };
};

type ExecutorStatusLike = { loopId?: unknown; running?: unknown };
type WritableLike<T> = { set(value: T): void; subscribe: (run: (v: T) => void) => () => void };

export type SendNodeOverrideFn = (
  nodeId: string,
  kind: 'input' | 'config',
  portId: string,
  value: unknown
) => void;

type DeployedPatch = {
  patchId: string;
  nodeIds: Set<string>;
  topologySignature: string;
  deployedAt: number;
};

type PatchRoot = { id: string; type: string };

type PatchDeploymentPlan = {
  selectedRoots: PatchRoot[];
  rootIdsByClientId: Map<string, string[]>;
  targetClientIds: string[];
  planKey: string;
};

export interface PatchRuntime {
  onTick(): void;
  onGraphStateChanged(): void;
  onLoopDeployListChanged(): void;
  onGroupDisabledChanged(disabled: Set<string>): void;
  onRunningChanged(running: boolean): void;
  scheduleReconcile(reason: string): void;
  stopAllDeployedPatches(): void;
  clearMidiLoopBridgeState(): void;
  syncPatchVisualState(): void;
  applyStoppedHighlights(running: boolean): Promise<void>;
  toggleExecutorLogs(): void;
  sendNodeOverride: SendNodeOverrideFn;
  destroy(): void;
}

export interface CreatePatchRuntimeOptions {
  nodeEngine: NodeEngineLike;
  nodeRegistry: NodeRegistryLike;
  adapter: GraphViewAdapter;
  isRunningStore: Readable<boolean>;
  getGraphState: () => GraphState;
  groupDisabledNodeIds: Readable<Set<string>>;
  executorStatusByClient: Readable<Map<string, ExecutorStatusLike>>;
  showExecutorLogs: WritableLike<boolean>;
  logsClientId: WritableLike<string>;
  loopController: LoopControllerLike | null;
  managerState: Readable<ManagerStateLike>;
  displayTransport: DisplayTransportLike;
  getSDK: () => SdkLike | null;
  ensureDisplayLocalFilesRegisteredFromValue: (value: unknown) => void;
}

export function createPatchRuntime(opts: CreatePatchRuntimeOptions): PatchRuntime {
  const {
    nodeEngine,
    nodeRegistry,
    adapter,
    isRunningStore,
    getGraphState,
    groupDisabledNodeIds,
    executorStatusByClient,
    showExecutorLogs,
    logsClientId,
    loopController,
    managerState,
    displayTransport,
    getSDK,
    ensureDisplayLocalFilesRegisteredFromValue,
  } = opts;

  const OVERRIDE_TTL_MS = 1500;
  const PATCH_RUNTIME_TARGETS_CHECK_INTERVAL_MS = 200;
  const LOCAL_DISPLAY_TARGET_ID = 'local:display';

  const clientIdsInOrder = () =>
    (get(managerState).clients ?? [])
      .map((client) => {
        const record = asRecord(client);
        return record ? String(record.clientId ?? '') : '';
      })
      .filter(Boolean);

  const audienceClientIdsInOrder = () =>
    (get(managerState).clients ?? [])
      .filter((client) => {
        const record = asRecord(client);
        return String(record?.group ?? '') !== 'display';
      })
      .map((client) => {
        const record = asRecord(client);
        return record ? String(record.clientId ?? '') : '';
      })
      .filter(Boolean);

  const isLocalDisplayTarget = (id: string): boolean => id === LOCAL_DISPLAY_TARGET_ID;

  const isDisplayTarget = (id: string): boolean => {
    if (isLocalDisplayTarget(id)) return true;
    const clients = get(managerState).clients ?? [];
    return clients.some((client) => {
      const record = asRecord(client);
      if (!record) return false;
      return String(record.clientId ?? '') === id && String(record.group ?? '') === 'display';
    });
  };

  let patchPendingCommitByKey = new Map<string, ReturnType<typeof setTimeout>>();
  let deployedPatchByClientId = new Map<string, DeployedPatch>();
  let patchDeployTimer: ReturnType<typeof setTimeout> | null = null;
  let patchLastPlanKey = '';
  let patchRuntimeTargetsLastCheckAt = 0;

  const { sendNodeExecutorPluginControl } = createNodeExecutorTransport({
    displayTransport,
    getSDK,
    ensureDisplayLocalFilesRegisteredFromValue,
    isDisplayTarget,
    isLocalDisplayTarget,
  });

  const patchVisualState = createPatchVisualState({ nodeEngine, adapter, getGraphState });

  const getDeployedPatchNodeIds = (): Set<string> =>
    patchVisualState.getDeployedPatchNodeIds(deployedPatchByClientId);

  const applyStoppedHighlights = patchVisualState.applyStoppedHighlights;

  const applyPatchHighlights = patchVisualState.applyPatchHighlights;

  const syncPatchOffloadState = patchVisualState.syncPatchOffloadState;

  const syncPatchVisualState = () => patchVisualState.syncPatchVisualState(deployedPatchByClientId);

  const midiBridge = createMidiBridge({
    nodeEngine,
    nodeRegistry,
    isRunningStore,
    getGraphState,
    getDeployedPatchByClientId: () => deployedPatchByClientId,
    sendNodeExecutorPluginControl,
  });

  const midiLoopBridge = createMidiLoopBridge({
    loopController,
    isRunningStore,
    nodeEngine: {
      getNode: (nodeId) => {
        const node = nodeEngine.getNode(nodeId);
        return node
          ? { outputValues: node.outputValues as Record<string, unknown> | undefined }
          : undefined;
      },
    },
    computeMidiBridgeRoutes: midiBridge.computeMidiBridgeRoutes,
    coerceForPortType: midiBridge.coerceForPortType,
    signatureForValue: midiBridge.signatureForValue,
    sendNodeExecutorPluginControl,
  });

  const computeTopologySignature = (payload: Pick<GraphState, 'nodes' | 'connections'>): string => {
    const nodes = (payload.nodes ?? []).map((node) => ({
      id: String(node.id),
      type: String(node.type),
    }));
    nodes.sort((a, b) => a.id.localeCompare(b.id));

    const connections = (payload.connections ?? []).map((conn) => ({
      s: String(conn.sourceNodeId),
      sp: String(conn.sourcePortId),
      t: String(conn.targetNodeId),
      tp: String(conn.targetPortId),
    }));
    connections.sort((a, b) => {
      const sa = `${a.s}:${a.sp}->${a.t}:${a.tp}`;
      const sb = `${b.s}:${b.sp}->${b.t}:${b.tp}`;
      return sa.localeCompare(sb);
    });

    return JSON.stringify({ nodes, connections });
  };

  const isBypassableWhenDisabled = (nodeId: string): boolean => {
    const node = nodeEngine.getNode(String(nodeId));
    if (!node) return false;

    const def = nodeRegistry.get(String(node.type));
    if (!def) return false;

    const inputs: NodePort[] = Array.isArray(def.inputs) ? def.inputs : [];
    const outputs: NodePort[] = Array.isArray(def.outputs) ? def.outputs : [];

    const isSafeType = (type: unknown) => String(type) !== 'command' && String(type) !== 'client';

    const inPort = inputs.find((p) => String(p?.id ?? '') === 'in') ?? null;
    const outPort = outputs.find((p) => String(p?.id ?? '') === 'out') ?? null;
    if (
      inPort &&
      outPort &&
      String(inPort.type) === String(outPort.type) &&
      isSafeType(inPort.type)
    ) {
      return true;
    }

    if (inputs.length === 1 && outputs.length === 1) {
      const onlyIn = inputs[0];
      const onlyOut = outputs[0];
      if (String(onlyIn?.type ?? '') === String(onlyOut?.type ?? '') && isSafeType(onlyIn?.type)) {
        return true;
      }
    }

    const sinkInputs = inputs.filter((p) => p?.kind === 'sink');
    const sinkOutputs = outputs.filter((p) => p?.kind === 'sink');
    if (sinkInputs.length === 1 && sinkOutputs.length === 1) {
      const onlyIn = sinkInputs[0];
      const onlyOut = sinkOutputs[0];
      if (String(onlyIn?.type ?? '') === String(onlyOut?.type ?? '') && isSafeType(onlyIn?.type)) {
        return true;
      }
    }

    return false;
  };

  const applyTimeRangePlayheadsToPatchPayload = (payload: PatchPayload) => {
    const nodes = payload?.graph?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) return;

    for (const node of nodes) {
      const type = String(node?.type ?? '');
      if (type !== 'load-audio-from-assets' && type !== 'load-video-from-assets') continue;
      const nodeId = String(node?.id ?? '');
      if (!nodeId) continue;
      const playheadSec = nodeEngine.getTimeRangePlayheadSec(nodeId);
      if (playheadSec === null) continue;

      node.inputValues = { ...(node.inputValues ?? {}), cursorSec: playheadSec };
    }
  };

  const resolvePatchDeploymentPlan = (): PatchDeploymentPlan | null => {
    const patchRootTypes = new Set([
      'audio-out',
      'image-out',
      'video-out',
      'effect-out',
      'scene-out',
    ]);
    const disabled = get(groupDisabledNodeIds);
    const state = getGraphState();
    const roots = (state.nodes ?? [])
      .filter((node) => patchRootTypes.has(String(node.type ?? '')))
      .map((node) => ({ id: String(node.id ?? ''), type: String(node.type ?? '') }))
      .filter((n) => Boolean(n.id));
    const enabledRoots = roots.filter((root) => !disabled.has(root.id));
    if (enabledRoots.length === 0) return null;

    const connectedAll = new Set(clientIdsInOrder());
    const connectedAudience = new Set(audienceClientIdsInOrder());

    const connections: Connection[] = state.connections ?? [];

    const activeRoots = enabledRoots.filter((root) =>
      connections.some(
        (c) => String(c.sourceNodeId) === root.id && String(c.sourcePortId) === 'cmd'
      )
    );

    const formatRootList = (items: { id: string; type: string }[]) =>
      items
        .map((r) => `${r.type}:${r.id}`)
        .sort()
        .join(', ');

    const selectedRoots = (() => {
      if (enabledRoots.length === 1) return enabledRoots;
      if (activeRoots.length >= 1) return activeRoots;
      nodeEngine.lastError.set(
        `Multiple patch roots found (${formatRootList(enabledRoots)}). Connect Deploy on one or more roots (or delete the others).`
      );
      return null;
    })();

    if (!selectedRoots) return null;

    const outgoingBySourceKey = new Map<string, Connection[]>();
    for (const c of connections) {
      const key = `${String(c.sourceNodeId)}:${String(c.sourcePortId)}`;
      const list = outgoingBySourceKey.get(key) ?? [];
      list.push(c);
      outgoingBySourceKey.set(key, list);
    }

    const typeById = new Map<string, string>();
    for (const n of state.nodes ?? []) {
      const id = String(n?.id ?? '');
      if (!id) continue;
      typeById.set(id, String(n?.type ?? ''));
    }

    const getCommandOutputPorts = (type: string): string[] => {
      const def = nodeRegistry.get(String(type));
      const ports = def?.outputs ?? [];
      return ports.filter((p) => String(p.type) === 'command').map((p) => String(p.id));
    };

    const isCommandInputPort = (type: string, portId: string): boolean => {
      const def = nodeRegistry.get(String(type));
      const port = (def?.inputs ?? []).find((p) => String(p.id) === String(portId));
      return Boolean(port) && String(port?.type ?? '') === 'command';
    };

    const resolveClientId = (nodeId: string, outputPortId: string) => {
      const runtimeNode = nodeEngine.getNode(nodeId);
      const runtimeOut = asRecord(runtimeNode?.outputValues?.[outputPortId]);
      const fromOut =
        typeof runtimeOut?.clientId === 'string' ? String(runtimeOut.clientId).trim() : '';
      const config = asRecord(runtimeNode?.config);
      const fromConfig = typeof config?.clientId === 'string' ? String(config.clientId).trim() : '';
      return fromOut || fromConfig;
    };

    const resolveClientNodeTargets = (nodeId: string): string[] => {
      const runtimeNode = nodeEngine.getNode(nodeId);
      if (!runtimeNode) return [];
      const computed = nodeEngine.getLastComputedInputs(nodeId);
      const isPortConnected = (portId: string) =>
        connections.some(
          (c) =>
            String(c.targetNodeId) === String(nodeId) && String(c.targetPortId) === String(portId)
        );
      const getEffectiveInput = (portId: 'index' | 'range' | 'random'): unknown => {
        const connected = isPortConnected(portId);
        if (connected && computed && Object.prototype.hasOwnProperty.call(computed, portId)) {
          return computed[portId];
        }
        const inputValues = runtimeNode.inputValues as Record<string, unknown> | undefined;
        return inputValues?.[portId];
      };

      const clients = audienceClientIdsInOrder();
      const total = clients.length;
      if (total === 0) return [];

      const randomRaw = getEffectiveInput('random');
      const random = coerceBoolean(randomRaw, false);
      const ordered = random ? buildStableRandomOrder(nodeId, clients) : clients;

      const primaryId = resolveClientId(nodeId, 'out');
      const indexRaw = getEffectiveInput('index');
      const indexCandidate = toFiniteNumber(indexRaw, Number.NaN);
      const indexFromInput = Number.isFinite(indexCandidate)
        ? clampInt(indexCandidate, 1, total)
        : null;
      const indexFromPrimary = primaryId ? ordered.indexOf(primaryId) + 1 : 0;
      const index = indexFromInput ?? (indexFromPrimary > 0 ? indexFromPrimary : 1);

      const rangeRaw = getEffectiveInput('range');
      const rangeCandidate = toFiniteNumber(rangeRaw, 1);
      const range = clampInt(rangeCandidate, 1, total);

      const ids: string[] = [];
      const start = index - 1;
      for (let i = 0; i < range; i += 1) {
        ids.push(ordered[(start + i) % total]);
      }
      return ids;
    };

    const resolveTargetsForRoot = (rootId: string): string[] => {
      const routedClientNodeIds: string[] = [];
      const routedClientNodeIdSet = new Set<string>();
      let hasDisplayTarget = false;

      const queue: { nodeId: string; portId: string }[] = [{ nodeId: rootId, portId: 'cmd' }];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const next = queue.shift()!;
        const visitKey = `${next.nodeId}:${next.portId}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        const outgoing = outgoingBySourceKey.get(visitKey) ?? [];
        for (const c of outgoing) {
          const targetNodeId = String(c?.targetNodeId ?? '');
          if (!targetNodeId) continue;
          const targetPortId = String(c?.targetPortId ?? '');

          const targetType = typeById.get(targetNodeId) ?? '';
          if (!targetType) continue;
          if (!isCommandInputPort(targetType, targetPortId)) continue;

          if (targetType === 'display-object') {
            hasDisplayTarget = true;
            continue;
          }

          if (targetType === 'client-object') {
            if (!routedClientNodeIdSet.has(targetNodeId)) {
              routedClientNodeIdSet.add(targetNodeId);
              routedClientNodeIds.push(targetNodeId);
            }
            continue;
          }

          for (const outPortId of getCommandOutputPorts(targetType)) {
            queue.push({ nodeId: targetNodeId, portId: outPortId });
          }
        }
      }

      const out: string[] = [];
      const seen = new Set<string>();

      for (const nodeId of routedClientNodeIds) {
        const ids = resolveClientNodeTargets(nodeId);
        for (const id of ids) {
          if (!id || !connectedAudience.has(id) || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }

      if (hasDisplayTarget) {
        const availability = displayTransport.getAvailability();
        if (availability.hasLocalSession && !seen.has(LOCAL_DISPLAY_TARGET_ID)) {
          seen.add(LOCAL_DISPLAY_TARGET_ID);
          out.push(LOCAL_DISPLAY_TARGET_ID);
        }

        const displayIds = (get(managerState).clients ?? [])
          .filter((client) => {
            const record = asRecord(client);
            return String(record?.group ?? '') === 'display';
          })
          .map((client) => {
            const record = asRecord(client);
            return record ? String(record.clientId ?? '') : '';
          })
          .filter((id) => Boolean(id) && connectedAll.has(id));

        for (const id of displayIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }

      return out;
    };

    const rootIdSetByClientId = new Map<string, Set<string>>();
    for (const root of selectedRoots) {
      const targets = resolveTargetsForRoot(root.id);
      for (const targetId of targets) {
        const set = rootIdSetByClientId.get(targetId) ?? new Set<string>();
        set.add(root.id);
        rootIdSetByClientId.set(targetId, set);
      }
    }

    if (rootIdSetByClientId.size === 0) return null;

    const rootIdsByClientId = new Map<string, string[]>();
    for (const [clientId, set] of rootIdSetByClientId.entries()) {
      rootIdsByClientId.set(clientId, Array.from(set).sort());
    }

    const targetClientIds: string[] = [];
    const seenTargets = new Set<string>();

    if (rootIdsByClientId.has(LOCAL_DISPLAY_TARGET_ID)) {
      targetClientIds.push(LOCAL_DISPLAY_TARGET_ID);
      seenTargets.add(LOCAL_DISPLAY_TARGET_ID);
    }

    for (const id of clientIdsInOrder()) {
      if (!rootIdsByClientId.has(id) || seenTargets.has(id)) continue;
      seenTargets.add(id);
      targetClientIds.push(id);
    }

    const leftovers = Array.from(rootIdsByClientId.keys())
      .filter((id) => !seenTargets.has(id))
      .sort();
    for (const id of leftovers) {
      seenTargets.add(id);
      targetClientIds.push(id);
    }

    const prevError = get(nodeEngine.lastError);
    if (
      typeof prevError === 'string' &&
      (prevError.startsWith('Multiple patch roots found') ||
        prevError.startsWith('Multiple active patch roots found') ||
        prevError.startsWith('Multiple active patch roots have different targets'))
    ) {
      nodeEngine.lastError.set(null);
    }

    const planKey = Array.from(rootIdsByClientId.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clientId, rootIds]) => `${clientId}=${rootIds.join(',')}`)
      .join('|');

    return { selectedRoots, rootIdsByClientId, targetClientIds, planKey };
  };

  const resolvePatchTargetClientIds = (): string[] =>
    resolvePatchDeploymentPlan()?.targetClientIds ?? [];

  const stopAndRemovePatchOnClient = (clientId: string, patchId: string) => {
    const id = String(clientId ?? '');
    const loopId = String(patchId ?? '');
    if (!id || !loopId) return;
    sendNodeExecutorPluginControl(id, 'stop', { loopId });
    sendNodeExecutorPluginControl(id, 'remove', { loopId });
  };

  const stopAllDeployedPatches = () => {
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      stopAndRemovePatchOnClient(clientId, patch.patchId);
    }
    deployedPatchByClientId = new Map();
    patchLastPlanKey = '';
    midiBridge.clearState();
    syncPatchOffloadState(new Set());
    void applyPatchHighlights(new Set());
  };

  const reconcilePatchDeployment = (reason: string) => {
    if (!get(isRunningStore)) {
      stopAllDeployedPatches();
      return;
    }

    if (!getSDK()) return;

    const plan = resolvePatchDeploymentPlan();
    patchLastPlanKey = plan?.planKey ?? '';
    if (!plan || plan.targetClientIds.length === 0) {
      if (deployedPatchByClientId.size > 0) stopAllDeployedPatches();
      return;
    }

    const localOnlyNodeTypes = new Set([
      'load-audio-from-local',
      'load-image-from-local',
      'load-video-from-local',
    ]);
    const disabled = get(groupDisabledNodeIds);
    const statusMap = get(executorStatusByClient);

    const desiredByClientId = new Map<
      string,
      {
        patchId: string;
        nodeIds: Set<string>;
        topologySignature: string;
        payload: PatchPayload;
      }
    >();
    const desiredNodeIds = new Set<string>();
    const retainedClientIds = new Set<string>();

    const groupsByRootKey = new Map<string, { rootIds: string[]; clientIds: string[] }>();
    for (const [clientId, rootIds] of plan.rootIdsByClientId.entries()) {
      const key = rootIds.join('|');
      const group = groupsByRootKey.get(key) ?? { rootIds, clientIds: [] };
      group.clientIds.push(String(clientId));
      groupsByRootKey.set(key, group);
    }

    for (const group of groupsByRootKey.values()) {
      let payload: PatchPayload;
      try {
        payload = nodeEngine.exportGraphForPatchFromRootNodeIds(group.rootIds);
      } catch (err) {
        nodeEngine.lastError.set(err instanceof Error ? err.message : 'Export patch failed');
        for (const clientId of group.clientIds) retainedClientIds.add(String(clientId));
        continue;
      }

      let targets = group.clientIds.slice();
      const applyLocalOnlyTargetFilter = () => {
        const isLocalOnlyPatch = (payload?.graph?.nodes ?? []).some((node) =>
          localOnlyNodeTypes.has(String(node?.type ?? ''))
        );
        if (!isLocalOnlyPatch) return true;

        const displayTargets = targets.filter((id) => isDisplayTarget(id));
        if (displayTargets.length === 0) {
          nodeEngine.lastError.set(
            'Load * From Local(Display only) requires a Display target (connect Deploy to Display).'
          );
          return false;
        }
        targets = displayTargets;
        return true;
      };

      if (!applyLocalOnlyTargetFilter() || targets.length === 0) continue;

      let nodeIds = new Set((payload?.graph?.nodes ?? []).map((node) => String(node.id)));
      let hasDisabledNodes = Array.from(nodeIds).some((id) => disabled.has(id));

      if (hasDisabledNodes && group.rootIds.length > 1) {
        const enabledRoots: string[] = [];
        for (const rootId of group.rootIds) {
          try {
            const rootPayload = nodeEngine.exportGraphForPatchFromRootNodeIds([rootId]);
            const rootNodeIds = new Set(
              (rootPayload?.graph?.nodes ?? []).map((node) => String(node.id))
            );
            const rootHasDisabled = Array.from(rootNodeIds).some((id) => disabled.has(id));
            if (!rootHasDisabled) enabledRoots.push(rootId);
          } catch (err) {
            void err;
          }
        }

        if (enabledRoots.length === 0) {
          nodeEngine.lastError.set(
            'Patch contains disabled nodes; enable them or remove from deploy.'
          );
          continue;
        }

        try {
          payload = nodeEngine.exportGraphForPatchFromRootNodeIds(enabledRoots);
        } catch (err) {
          nodeEngine.lastError.set(err instanceof Error ? err.message : 'Export patch failed');
          continue;
        }

        targets = group.clientIds.slice();
        if (!applyLocalOnlyTargetFilter() || targets.length === 0) continue;

        nodeIds = new Set((payload?.graph?.nodes ?? []).map((node) => String(node.id)));
        hasDisabledNodes = Array.from(nodeIds).some((id) => disabled.has(id));
      }

      if (hasDisabledNodes) {
        nodeEngine.lastError.set(
          'Patch contains disabled nodes; enable them or remove from deploy.'
        );
        continue;
      }

      const topologySignature = computeTopologySignature(payload.graph);
      const patchId = String(payload?.meta?.loopId ?? '');

      applyTimeRangePlayheadsToPatchPayload(payload);

      for (const nodeId of nodeIds) desiredNodeIds.add(nodeId);
      for (const clientId of targets) {
        desiredByClientId.set(String(clientId), { patchId, nodeIds, topologySignature, payload });
      }
    }

    for (const clientId of retainedClientIds) {
      const deployed = deployedPatchByClientId.get(clientId);
      if (!deployed) continue;
      for (const nodeId of deployed.nodeIds) desiredNodeIds.add(nodeId);
    }

    if (desiredByClientId.size === 0) {
      if (retainedClientIds.size === 0) {
        if (deployedPatchByClientId.size > 0) stopAllDeployedPatches();
      } else {
        syncPatchOffloadState(desiredNodeIds);
        void applyPatchHighlights(desiredNodeIds);
        const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
        if (first) midiBridge.syncRoutes(first.patchId, desiredNodeIds);
      }
      return;
    }

    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      if (desiredByClientId.has(clientId) || retainedClientIds.has(clientId)) continue;
      stopAndRemovePatchOnClient(clientId, patch.patchId);
      deployedPatchByClientId.delete(clientId);
    }

    let didDeploy = false;
    for (const [clientId, desired] of desiredByClientId.entries()) {
      const deployed = deployedPatchByClientId.get(clientId) ?? null;
      const status = statusMap.get(clientId) ?? null;
      const statusLoopId = status?.loopId ? String(status.loopId) : '';
      const statusRunning = status?.running === false;

      const needDeploy =
        !deployed ||
        deployed.patchId !== desired.patchId ||
        deployed.topologySignature !== desired.topologySignature ||
        (statusLoopId && statusLoopId !== desired.patchId);

      if (!needDeploy) {
        if (statusLoopId === desired.patchId && statusRunning) {
          sendNodeExecutorPluginControl(String(clientId), 'start', { loopId: desired.patchId });
        }

        deployedPatchByClientId.set(String(clientId), {
          patchId: desired.patchId,
          nodeIds: desired.nodeIds,
          topologySignature: desired.topologySignature,
          deployedAt: deployed?.deployedAt ?? Date.now(),
        });
        continue;
      }

      if (!didDeploy) {
        midiBridge.resetAfterDeploy();
        didDeploy = true;
      }

      sendNodeExecutorPluginControl(String(clientId), 'deploy', desired.payload);
      sendNodeExecutorPluginControl(String(clientId), 'start', { loopId: desired.patchId });

      deployedPatchByClientId.set(String(clientId), {
        patchId: desired.patchId,
        nodeIds: desired.nodeIds,
        topologySignature: desired.topologySignature,
        deployedAt: Date.now(),
      });
    }

    const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
    syncPatchOffloadState(desiredNodeIds);
    void applyPatchHighlights(desiredNodeIds);
    if (first) midiBridge.syncRoutes(first.patchId, desiredNodeIds);
    console.log('[patch] reconciled', {
      reason,
      targets: Array.from(desiredByClientId.keys()).sort(),
    });
  };

  const scheduleReconcile = (reason: string) => {
    if (patchDeployTimer) clearTimeout(patchDeployTimer);
    patchDeployTimer = setTimeout(() => {
      patchDeployTimer = null;
      reconcilePatchDeployment(reason);
    }, 320);
  };

  const sendNodeOverride: SendNodeOverrideFn = (nodeId, kind, portId, value) => {
    if (!nodeId || !portId) return;

    const state = getGraphState();
    const node = (state.nodes ?? []).find((n) => String(n.id) === String(nodeId));
    if (
      node &&
      String(node.type ?? '') === 'client-object' &&
      kind === 'config' &&
      portId === 'clientId'
    )
      return;

    const loop = loopController?.loopActions.getDeployedLoopForNode(nodeId);
    if (loop) {
      const loopId = String(loop?.id ?? '');
      const deployedClientId = (() => {
        const statusMap = get(executorStatusByClient);
        for (const [cid, status] of statusMap.entries()) {
          if (String(status?.loopId ?? '') === loopId) return String(cid);
        }
        return '';
      })();

      const clientId = deployedClientId || loopController?.loopActions.getLoopClientId(loop);
      if (!clientId) return;

      sendNodeExecutorPluginControl(clientId, 'override-set', {
        loopId,
        overrides: [{ nodeId, kind, portId, value, ttlMs: OVERRIDE_TTL_MS }],
      });

      const key = `${clientId}|${loopId}|${nodeId}|${kind}|${portId}`;
      const existing = patchPendingCommitByKey.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        patchPendingCommitByKey.delete(key);
        sendNodeExecutorPluginControl(clientId, 'override-set', {
          loopId,
          overrides: [{ nodeId, kind, portId, value }],
        });
      }, 420);
      patchPendingCommitByKey.set(key, timer);
      return;
    }

    const nodeKey = String(nodeId);
    const patchTargets: { clientId: string; patch: DeployedPatch }[] = [];
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      if (patch.nodeIds.has(nodeKey)) patchTargets.push({ clientId, patch });
    }
    if (patchTargets.length === 0) return;

    for (const target of patchTargets) {
      sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
        loopId: target.patch.patchId,
        overrides: [{ nodeId, kind, portId, value, ttlMs: OVERRIDE_TTL_MS }],
      });

      const key = `${target.clientId}|${target.patch.patchId}|${nodeId}|${kind}|${portId}`;
      const existing = patchPendingCommitByKey.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        patchPendingCommitByKey.delete(key);
        sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
          loopId: target.patch.patchId,
          overrides: [{ nodeId, kind, portId, value }],
        });
      }, 420);
      patchPendingCommitByKey.set(key, timer);
    }
  };

  const toggleExecutorLogs = () => {
    const show = get(showExecutorLogs);
    const current = get(logsClientId);
    const patchTargets = resolvePatchTargetClientIds();
    const selected = (get(managerState).selectedClientIds ?? []).map(String).filter(Boolean);
    const targetId = patchTargets[0] ?? selected[0] ?? clientIdsInOrder()[0] ?? '';
    if (!targetId) return;

    if (show && current === targetId) {
      showExecutorLogs.set(false);
      return;
    }
    logsClientId.set(targetId);
    showExecutorLogs.set(true);
  };

  const clearMidiLoopBridgeState = () => midiLoopBridge.clearState();

  const onTick = () => {
    midiBridge.onTick();
    midiLoopBridge.onTick();

    if (!get(isRunningStore)) return;
    if (patchDeployTimer) return;
    const now = Date.now();
    if (now - patchRuntimeTargetsLastCheckAt < PATCH_RUNTIME_TARGETS_CHECK_INTERVAL_MS) return;
    patchRuntimeTargetsLastCheckAt = now;

    const planKey = resolvePatchDeploymentPlan()?.planKey ?? '';
    if (planKey !== patchLastPlanKey) scheduleReconcile('runtime-target-change');
  };

  const onGraphStateChanged = () => {
    scheduleReconcile('graph-change');
    midiLoopBridge.markDirty();

    const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
    if (first) midiBridge.syncRoutes(first.patchId, getDeployedPatchNodeIds());
  };

  const onLoopDeployListChanged = () => {
    midiLoopBridge.onLoopDeployListChanged();
  };

  const onGroupDisabledChanged = (disabled: Set<string>) => {
    let didStop = false;
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      const disabledInPatch = Array.from(patch.nodeIds).filter((id) => disabled.has(id));
      const shouldStop =
        disabledInPatch.length > 0 && !disabledInPatch.every((id) => isBypassableWhenDisabled(id));
      if (!shouldStop) continue;

      stopAndRemovePatchOnClient(clientId, patch.patchId);
      deployedPatchByClientId.delete(clientId);
      midiBridge.pruneClient(clientId, patch.patchId);
      didStop = true;
    }

    if (didStop) syncPatchVisualState();
    scheduleReconcile('group-gate');
  };

  const onRunningChanged = (running: boolean) => {
    void applyStoppedHighlights(Boolean(running));
    if (!running) {
      stopAllDeployedPatches();
      midiLoopBridge.clearState();
    }
  };

  const destroy = () => {
    if (patchDeployTimer) clearTimeout(patchDeployTimer);
    for (const timer of patchPendingCommitByKey.values()) clearTimeout(timer);
    patchPendingCommitByKey.clear();
    stopAllDeployedPatches();
    midiLoopBridge.clearState();
  };

  return {
    onTick,
    onGraphStateChanged,
    onLoopDeployListChanged,
    onGroupDisabledChanged,
    onRunningChanged,
    scheduleReconcile,
    stopAllDeployedPatches,
    clearMidiLoopBridgeState,
    syncPatchVisualState,
    applyStoppedHighlights,
    toggleExecutorLogs,
    sendNodeOverride,
    destroy,
  };
}
