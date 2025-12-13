/**
 * ClientSensorsProcessorNode
 * Extracts numeric signals from the latest SensorDataMessage for a client.
 *
 * This enables graphs like:
 *   Client -> Sensors -> Math/LFO -> Flashlight/Screen -> Client
 */
import type { NodeDefinition } from '../types';
import { nodeRegistry } from '../registry';

const ClientSensorsProcessorNode: NodeDefinition = {
  type: 'proc-client-sensors',
  label: 'Client Sensors',
  category: 'Processors',
  inputs: [{ id: 'client', label: 'Client', type: 'client' }],
  outputs: [
    { id: 'accelX', label: 'Accel X', type: 'number' },
    { id: 'accelY', label: 'Accel Y', type: 'number' },
    { id: 'accelZ', label: 'Accel Z', type: 'number' },
    { id: 'gyroA', label: 'Gyro α', type: 'number' },
    { id: 'gyroB', label: 'Gyro β', type: 'number' },
    { id: 'gyroG', label: 'Gyro γ', type: 'number' },
    { id: 'micVol', label: 'Mic Vol', type: 'number' },
    { id: 'micLow', label: 'Mic Low', type: 'number' },
    { id: 'micHigh', label: 'Mic High', type: 'number' },
    { id: 'micBpm', label: 'Mic BPM', type: 'number' },
  ],
  configSchema: [],
  process: (inputs) => {
    const client = inputs.client as any;
    const msg = client?.sensors as any;

    const out = {
      accelX: 0,
      accelY: 0,
      accelZ: 0,
      gyroA: 0,
      gyroB: 0,
      gyroG: 0,
      micVol: 0,
      micLow: 0,
      micHigh: 0,
      micBpm: 0,
    };

    if (!msg || typeof msg !== 'object') return out;

    const payload = msg.payload ?? {};
    switch (msg.sensorType) {
      case 'accel':
        out.accelX = Number(payload.x ?? 0);
        out.accelY = Number(payload.y ?? 0);
        out.accelZ = Number(payload.z ?? 0);
        break;
      case 'gyro':
        out.gyroA = Number(payload.alpha ?? 0);
        out.gyroB = Number(payload.beta ?? 0);
        out.gyroG = Number(payload.gamma ?? 0);
        break;
      case 'mic':
        out.micVol = Number(payload.volume ?? 0);
        out.micLow = Number(payload.lowEnergy ?? 0);
        out.micHigh = Number(payload.highEnergy ?? 0);
        out.micBpm = Number(payload.bpm ?? 0);
        break;
    }

    return out;
  },
};

nodeRegistry.register(ClientSensorsProcessorNode);

export default ClientSensorsProcessorNode;

