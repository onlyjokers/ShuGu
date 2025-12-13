/**
 * ClientObjectNode
 * Represents a single connected client as an "Object" with:
 * - Output: client info (id + latest sensor snapshot)
 * - Input (sink): control commands to send to that client
 */
import { get } from 'svelte/store';
import { targetClients, type ControlAction, type ControlPayload, type SensorDataMessage } from '@shugu/protocol';

import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';
import { getSDK, sensorData } from '$lib/stores/manager';

export type NodeCommand = {
  action: ControlAction;
  payload: ControlPayload;
  executeAt?: number;
};

export type ClientObject = {
  clientId: string;
  sensors?: SensorDataMessage;
};

const ClientObjectNode: NodeDefinition = {
  type: 'client-object',
  label: 'Client',
  category: 'Objects',
  inputs: [{ id: 'in', label: 'In', type: 'command', kind: 'sink' }],
  outputs: [{ id: 'out', label: 'Out', type: 'client' }],
  configSchema: [],
  process: (_inputs, config) => {
    const clientId = String((config.clientId ?? '') as string);
    const sensors = clientId ? get(sensorData).get(clientId) : undefined;
    const out: ClientObject = { clientId, sensors };
    return { out };
  },
  onSink: (inputs, config) => {
    const clientId = String((config.clientId ?? '') as string);
    if (!clientId) return;

    const sdk = getSDK();
    if (!sdk) return;

    const raw = inputs.in;
    const commands = (Array.isArray(raw) ? raw : [raw]) as unknown[];

    for (const cmd of commands) {
      if (!cmd || typeof cmd !== 'object') continue;
      const action = (cmd as any).action as ControlAction | undefined;
      const payload = (cmd as any).payload as ControlPayload | undefined;
      const executeAt = (cmd as any).executeAt as number | undefined;
      if (!action) continue;
      sdk.sendControl(targetClients([clientId]), action, payload ?? {}, executeAt);
    }
  },
};

nodeRegistry.register(ClientObjectNode);

export default ClientObjectNode;

