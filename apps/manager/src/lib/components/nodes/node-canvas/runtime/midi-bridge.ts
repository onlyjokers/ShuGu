/**
 * Purpose: MIDI bridge that maps MIDI node outputs to remote runtime overrides.
 */

import type { GraphState, NodeDefinition, NodeInstance, PortType } from '$lib/nodes/types';
import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { SendNodeExecutorPluginControl } from './node-executor-transport';

type NodeRegistryLike = {
  get(type: string): NodeDefinition | undefined;
};

type NodeEngineLike = {
  getNode(nodeId: string): NodeInstance | undefined;
};

type DeployedPatch = { patchId: string; nodeIds: Set<string> };

type NodeOverride = {
  nodeId: string;
  kind: 'input' | 'config';
  portId: string;
  value?: unknown;
  ttlMs?: number;
};

export type MidiBridgeRoute = {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  targetType: PortType;
  key: string;
};

export type ComputeMidiBridgeRoutes = (patchNodeIds: Set<string>) => {
  routes: MidiBridgeRoute[];
  keys: Set<string>;
};

export type CoerceForPortType = (value: unknown, type: PortType) => unknown | undefined;

export type SignatureForValue = (value: unknown, type: PortType) => string;

export interface CreateMidiBridgeOptions {
  nodeEngine: NodeEngineLike;
  nodeRegistry: NodeRegistryLike;
  isRunningStore: Readable<boolean>;
  getGraphState: () => GraphState;
  getDeployedPatchByClientId: () => Map<string, DeployedPatch>;
  sendNodeExecutorPluginControl: SendNodeExecutorPluginControl;
}

export interface MidiBridge {
  clearState(): void;
  pruneClient(clientId: string, patchId: string): void;
  syncRoutes(patchId: string, patchNodeIds: Set<string>): void;
  onTick(): void;
  resetAfterDeploy(): void;
  computeMidiBridgeRoutes: ComputeMidiBridgeRoutes;
  coerceForPortType: CoerceForPortType;
  signatureForValue: SignatureForValue;
}

export const createMidiBridge = (opts: CreateMidiBridgeOptions): MidiBridge => {
  const {
    nodeEngine,
    nodeRegistry,
    isRunningStore,
    getGraphState,
    getDeployedPatchByClientId,
    sendNodeExecutorPluginControl,
  } = opts;

  const isMidiNodeType = (type: string): boolean => type.startsWith('midi-');

  let midiBridgeRoutes: MidiBridgeRoute[] = [];
  let midiBridgeActiveKeysByClientId = new Map<string, Set<string>>();
  let midiBridgeLastSignatureByClientKey = new Map<string, string>();
  let midiBridgeLastSendAt = 0;

  const midiBridgeClientKey = (clientId: string, patchId: string, nodeId: string, portId: string) =>
    `${clientId}|${patchId}|${nodeId}|${portId}`;

  const computeMidiBridgeRoutes = (
    patchNodeIds: Set<string>
  ): { routes: MidiBridgeRoute[]; keys: Set<string> } => {
    const state = getGraphState();
    const nodeById = new Map((state.nodes ?? []).map((n) => [String(n.id), n] as const));
    const routes: MidiBridgeRoute[] = [];
    const keys = new Set<string>();

    for (const c of state.connections ?? []) {
      const targetNodeId = String(c.targetNodeId);
      const targetPortId = String(c.targetPortId);
      if (!patchNodeIds.has(targetNodeId)) continue;

      const sourceNodeId = String(c.sourceNodeId);
      const sourcePortId = String(c.sourcePortId);
      const sourceNode = nodeById.get(sourceNodeId);
      if (!sourceNode) continue;
      if (!isMidiNodeType(String(sourceNode.type))) continue;

      const targetNode = nodeById.get(targetNodeId);
      if (!targetNode) continue;
      const def = nodeRegistry.get(String(targetNode.type));
      const port = def?.inputs?.find((p) => String(p.id) === targetPortId) ?? null;
      if (!port || port.kind === 'sink') continue;
      const targetType = (port.type ?? 'any') as PortType;

      const key = `${targetNodeId}|${targetPortId}`;
      keys.add(key);
      routes.push({
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
        targetType,
        key,
      });
    }

    routes.sort(
      (a, b) => a.key.localeCompare(b.key) || a.sourceNodeId.localeCompare(b.sourceNodeId)
    );

    return { routes, keys };
  };

  const clearState = () => {
    midiBridgeRoutes = [];
    midiBridgeActiveKeysByClientId = new Map();
    midiBridgeLastSignatureByClientKey = new Map();
  };

  const pruneClient = (clientId: string, patchId: string) => {
    const id = String(clientId ?? '');
    const loopId = String(patchId ?? '');
    if (!id || !loopId) return;

    midiBridgeActiveKeysByClientId.delete(id);

    const prefix = `${id}|${loopId}|`;
    for (const key of Array.from(midiBridgeLastSignatureByClientKey.keys())) {
      if (key.startsWith(prefix)) midiBridgeLastSignatureByClientKey.delete(key);
    }
  };

  const coerceForPortType = (value: unknown, type: PortType): unknown | undefined => {
    if (value === undefined || value === null) return undefined;
    if (type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    if (type === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
      return undefined;
    }
    if (type === 'string') return typeof value === 'string' ? value : String(value);
    if (type === 'color') return typeof value === 'string' ? value : undefined;
    return value;
  };

  const signatureForValue = (value: unknown, type: PortType): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return 'nan';
      return `n:${Math.round(n * 1_000_000) / 1_000_000}`;
    }
    if (type === 'boolean') return `b:${Boolean(value)}`;
    if (type === 'string' || type === 'color') return `s:${String(value)}`;
    try {
      return `j:${JSON.stringify(value)}`;
    } catch {
      return `u:${String(value)}`;
    }
  };

  const syncRoutes = (patchId: string, patchNodeIds: Set<string>) => {
    const deployedPatchByClientId = getDeployedPatchByClientId();
    if (!patchId || patchNodeIds.size === 0 || deployedPatchByClientId.size === 0) {
      clearState();
      return;
    }

    const { routes, keys } = computeMidiBridgeRoutes(patchNodeIds);
    midiBridgeRoutes = routes;

    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      const prev = midiBridgeActiveKeysByClientId.get(clientId) ?? new Set<string>();
      const next = new Set(keys);
      const toRemove = Array.from(prev).filter((k) => !next.has(k));
      if (toRemove.length > 0) {
        const overrides = toRemove.map((k) => {
          const [nodeId, portId] = k.split('|');
          return { nodeId, kind: 'input', portId };
        });
        sendNodeExecutorPluginControl(String(clientId), 'override-remove', {
          loopId: patch.patchId,
          overrides,
        });

        for (const k of toRemove) {
          const [nodeId, portId] = k.split('|');
          midiBridgeLastSignatureByClientKey.delete(
            midiBridgeClientKey(clientId, patch.patchId, nodeId, portId)
          );
        }
      }
      midiBridgeActiveKeysByClientId.set(clientId, next);
    }
  };

  const onTick = () => {
    if (!get(isRunningStore)) return;

    if (midiBridgeRoutes.length === 0) return;

    const deployedPatchByClientId = getDeployedPatchByClientId();
    if (deployedPatchByClientId.size === 0) return;

    const now = Date.now();
    if (now - midiBridgeLastSendAt < 30) return;
    midiBridgeLastSendAt = now;

    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      const overrides: NodeOverride[] = [];
      const removals: NodeOverride[] = [];
      const activeKeys = midiBridgeActiveKeysByClientId.get(clientId) ?? new Set<string>();

      for (const route of midiBridgeRoutes) {
        const sourceNode = nodeEngine.getNode(route.sourceNodeId);
        const raw = sourceNode?.outputValues?.[route.sourcePortId];
        const coerced = coerceForPortType(raw, route.targetType);

        const key = midiBridgeClientKey(
          clientId,
          patch.patchId,
          route.targetNodeId,
          route.targetPortId
        );
        if (coerced === undefined) {
          if (activeKeys.has(route.key)) {
            activeKeys.delete(route.key);
            midiBridgeLastSignatureByClientKey.delete(key);
            removals.push({
              nodeId: route.targetNodeId,
              kind: 'input',
              portId: route.targetPortId,
            });
          }
          continue;
        }

        const sig = signatureForValue(coerced, route.targetType);
        const prevSig = midiBridgeLastSignatureByClientKey.get(key);
        if (prevSig === sig) {
          activeKeys.add(route.key);
          continue;
        }

        midiBridgeLastSignatureByClientKey.set(key, sig);
        activeKeys.add(route.key);
        overrides.push({
          nodeId: route.targetNodeId,
          kind: 'input',
          portId: route.targetPortId,
          value: coerced,
        });
      }

      midiBridgeActiveKeysByClientId.set(clientId, activeKeys);

      if (removals.length > 0) {
        sendNodeExecutorPluginControl(String(clientId), 'override-remove', {
          loopId: patch.patchId,
          overrides: removals,
        });
      }

      if (overrides.length > 0) {
        sendNodeExecutorPluginControl(String(clientId), 'override-set', {
          loopId: patch.patchId,
          overrides,
        });
      }
    }
  };

  const resetAfterDeploy = () => {
    midiBridgeLastSignatureByClientKey = new Map();
    midiBridgeActiveKeysByClientId = new Map();
  };

  return {
    clearState,
    pruneClient,
    syncRoutes,
    onTick,
    resetAfterDeploy,
    computeMidiBridgeRoutes,
    coerceForPortType,
    signatureForValue,
  };
};
