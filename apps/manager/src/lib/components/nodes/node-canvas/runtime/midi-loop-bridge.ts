/**
 * Purpose: MIDI bridge support for loop-deployed graphs.
 */

import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type {
  CoerceForPortType,
  ComputeMidiBridgeRoutes,
  MidiBridgeRoute,
  SignatureForValue,
} from './midi-bridge';
import type { SendNodeExecutorPluginControl } from './node-executor-transport';

type NodeEngineLike = {
  getNode(nodeId: string): { outputValues?: Record<string, unknown> } | undefined;
};

type LoopControllerLike = {
  deployedLoopIds: Readable<Set<string>>;
  localLoops: Readable<unknown[]>;
  loopActions: {
    getLoopClientId(loop: unknown): string | null;
  };
};

type NodeOverride = {
  nodeId: string;
  kind: 'input' | 'config';
  portId: string;
  value?: unknown;
  ttlMs?: number;
};

type MidiLoopBridgeTarget = { loopId: string; clientId: string; nodeIds: Set<string> };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

export interface MidiLoopBridge {
  clearState(): void;
  markDirty(): void;
  onLoopDeployListChanged(): void;
  onTick(): void;
}

export interface CreateMidiLoopBridgeOptions {
  loopController: LoopControllerLike | null;
  isRunningStore: Readable<boolean>;
  nodeEngine: NodeEngineLike;
  computeMidiBridgeRoutes: ComputeMidiBridgeRoutes;
  coerceForPortType: CoerceForPortType;
  signatureForValue: SignatureForValue;
  sendNodeExecutorPluginControl: SendNodeExecutorPluginControl;
}

export const createMidiLoopBridge = (opts: CreateMidiLoopBridgeOptions): MidiLoopBridge => {
  const {
    loopController,
    isRunningStore,
    nodeEngine,
    computeMidiBridgeRoutes,
    coerceForPortType,
    signatureForValue,
    sendNodeExecutorPluginControl,
  } = opts;

  let routesByLoopId = new Map<string, MidiBridgeRoute[]>();
  let activeKeysByLoopId = new Map<string, Set<string>>();
  let lastSignatureByClientKey = new Map<string, string>();
  let lastSendAt = 0;
  let dirty = true;

  const midiLoopBridgeClientKey = (
    clientId: string,
    loopId: string,
    nodeId: string,
    portId: string
  ) => `${clientId}|${loopId}|${nodeId}|${portId}`;

  const clearState = () => {
    routesByLoopId = new Map();
    activeKeysByLoopId = new Map();
    lastSignatureByClientKey = new Map();
    dirty = true;
  };

  const markDirty = () => {
    dirty = true;
  };

  const getTargets = (): MidiLoopBridgeTarget[] => {
    if (!loopController) return [];

    const deployed = get(loopController.deployedLoopIds);
    if (!deployed || deployed.size === 0) return [];

    const loops = get(loopController.localLoops) ?? [];
    const targets: MidiLoopBridgeTarget[] = [];

    for (const loop of loops) {
      const record = asRecord(loop);
      const loopId = String(record?.id ?? '');
      if (!loopId || !deployed.has(loopId)) continue;

      const clientId = loopController.loopActions.getLoopClientId(loop);
      if (!clientId) continue;

      const nodeIdsRaw = Array.isArray(record?.nodeIds) ? record.nodeIds : [];
      const nodeIds = new Set(nodeIdsRaw.map((id) => String(id)).filter(Boolean));
      if (nodeIds.size === 0) continue;

      targets.push({ loopId, clientId: String(clientId), nodeIds });
    }

    targets.sort(
      (a, b) => a.loopId.localeCompare(b.loopId) || a.clientId.localeCompare(b.clientId)
    );
    return targets;
  };

  const syncRoutes = () => {
    const targets = getTargets();
    if (targets.length === 0) {
      clearState();
      return;
    }

    const activeLoopIds = new Set(targets.map((t) => t.loopId));
    for (const loopId of Array.from(routesByLoopId.keys())) {
      if (activeLoopIds.has(loopId)) continue;
      routesByLoopId.delete(loopId);
      activeKeysByLoopId.delete(loopId);
    }

    for (const target of targets) {
      const { routes, keys } = computeMidiBridgeRoutes(target.nodeIds);
      routesByLoopId.set(target.loopId, routes);

      const prev = activeKeysByLoopId.get(target.loopId) ?? new Set<string>();
      const next = new Set(keys);
      const toRemove = Array.from(prev).filter((k) => !next.has(k));

      if (toRemove.length > 0) {
        const overrides = toRemove.map((k) => {
          const [nodeId, portId] = k.split('|');
          return { nodeId, kind: 'input', portId };
        });

        sendNodeExecutorPluginControl(String(target.clientId), 'override-remove', {
          loopId: target.loopId,
          overrides,
        });

        for (const k of toRemove) {
          const [nodeId, portId] = k.split('|');
          lastSignatureByClientKey.delete(
            midiLoopBridgeClientKey(target.clientId, target.loopId, nodeId, portId)
          );
        }
      }

      activeKeysByLoopId.set(target.loopId, next);
    }

    dirty = false;
  };

  const onTick = () => {
    if (!get(isRunningStore)) return;

    const targets = getTargets();
    if (targets.length === 0) return;

    if (dirty) syncRoutes();

    const now = Date.now();
    if (now - lastSendAt < 30) return;
    lastSendAt = now;

    for (const target of targets) {
      const routes = routesByLoopId.get(target.loopId) ?? [];
      if (routes.length === 0) continue;

      const overrides: NodeOverride[] = [];
      const removals: NodeOverride[] = [];
      const activeKeys = activeKeysByLoopId.get(target.loopId) ?? new Set<string>();

      for (const route of routes) {
        const sourceNode = nodeEngine.getNode(route.sourceNodeId);
        const raw = sourceNode?.outputValues?.[route.sourcePortId];
        const coerced = coerceForPortType(raw, route.targetType);

        const key = midiLoopBridgeClientKey(
          target.clientId,
          target.loopId,
          route.targetNodeId,
          route.targetPortId
        );

        if (coerced === undefined) {
          if (activeKeys.has(route.key)) {
            activeKeys.delete(route.key);
            lastSignatureByClientKey.delete(key);
            removals.push({
              nodeId: route.targetNodeId,
              kind: 'input',
              portId: route.targetPortId,
            });
          }
          continue;
        }

        const sig = signatureForValue(coerced, route.targetType);
        const prevSig = lastSignatureByClientKey.get(key);
        if (prevSig === sig) {
          activeKeys.add(route.key);
          continue;
        }

        lastSignatureByClientKey.set(key, sig);
        activeKeys.add(route.key);
        overrides.push({
          nodeId: route.targetNodeId,
          kind: 'input',
          portId: route.targetPortId,
          value: coerced,
        });
      }

      activeKeysByLoopId.set(target.loopId, activeKeys);

      if (removals.length > 0) {
        sendNodeExecutorPluginControl(String(target.clientId), 'override-remove', {
          loopId: target.loopId,
          overrides: removals,
        });
      }

      if (overrides.length > 0) {
        sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
          loopId: target.loopId,
          overrides,
        });
      }
    }
  };

  const onLoopDeployListChanged = () => {
    dirty = true;
    lastSignatureByClientKey = new Map();
    activeKeysByLoopId = new Map();
  };

  return { clearState, markDirty, onLoopDeployListChanged, onTick };
};
