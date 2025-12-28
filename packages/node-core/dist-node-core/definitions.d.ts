import type { ControlAction, ControlPayload, SensorPayload, SensorType } from '@shugu/protocol';
import type { NodeRegistry } from './registry.js';
export type NodeCommand = {
    action: ControlAction;
    payload: ControlPayload;
    executeAt?: number;
};
export type LatestSensorDataLike = {
    sensorType: SensorType;
    payload: SensorPayload;
    serverTimestamp: number;
    clientTimestamp: number;
};
export type ClientSensorMessage = {
    sensorType: SensorType;
    payload: SensorPayload;
    serverTimestamp: number;
    clientTimestamp: number;
};
export type ClientObject = {
    clientId: string;
    sensors?: ClientSensorMessage | null;
};
export type ClientObjectDeps = {
    getClientId: () => string | null;
    /**
     * Manager-side list of all available clientIds (for client selection inputs).
     * Client-side implementations may return `[selfClientId]` (or `[]` when offline).
     */
    getAllClientIds?: () => string[];
    /**
     * Manager-side selected clientIds (fallback when the node has no explicit selection).
     */
    getSelectedClientIds?: () => string[];
    /**
     * Client-side convenience (single local client).
     * Prefer `getSensorForClientId` when available.
     */
    getLatestSensor?: () => LatestSensorDataLike | null;
    /**
     * Manager-side (or multi-client) lookup.
     */
    getSensorForClientId?: (clientId: string) => LatestSensorDataLike | null;
    /**
     * Manager-side lookup for per-client uploaded images (e.g. screenshots).
     */
    getImageForClientId?: (clientId: string) => unknown;
    /**
     * Client-side convenience (single local client).
     * Prefer `executeCommandForClientId` when available.
     */
    executeCommand: (cmd: NodeCommand) => void;
    /**
     * Manager-side (or multi-client) routing.
     */
    executeCommandForClientId?: (clientId: string, cmd: NodeCommand) => void;
};
export declare function registerDefaultNodeDefinitions(registry: NodeRegistry, deps: ClientObjectDeps): void;
//# sourceMappingURL=definitions.d.ts.map