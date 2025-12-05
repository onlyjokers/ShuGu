/**
 * Manager store - wraps the SDK and provides reactive state for Svelte
 */
import { writable, derived, get } from 'svelte/store';
import { ManagerSDK, type ManagerState, type ManagerSDKConfig } from '@shugu/sdk-manager';
import type { SensorDataMessage, ClientInfo } from '@shugu/protocol';

// SDK instance
let sdk: ManagerSDK | null = null;

// Core state store
export const state = writable<ManagerState>({
    status: 'disconnected',
    managerId: null,
    clients: [],
    selectedClientIds: [],
    timeSync: {
        offset: 0,
        samples: [],
        maxSamples: 10,
        initialized: false,
        lastSyncTime: 0,
    },
    error: null,
});

// Sensor data store (latest data from each client)
export const sensorData = writable<Map<string, SensorDataMessage>>(new Map());

// Derived stores
export const connectionStatus = derived(state, ($state) => $state.status);
export const clients = derived(state, ($state) => $state.clients);
export const selectedClients = derived(state, ($state) =>
    $state.clients.filter(c => $state.selectedClientIds.includes(c.clientId))
);
export const timeOffset = derived(state, ($state) => $state.timeSync.offset);
export const serverTime = derived(state, ($state) =>
    Date.now() + $state.timeSync.offset
);

/**
 * Initialize and connect to server
 */
export function connect(config: ManagerSDKConfig): void {
    if (sdk) {
        sdk.disconnect();
    }

    sdk = new ManagerSDK(config);

    // Subscribe to state changes
    sdk.onStateChange((newState) => {
        state.set(newState);
    });

    // Subscribe to sensor data
    sdk.onSensorData((data) => {
        sensorData.update(map => {
            map.set(data.clientId, data);
            return new Map(map);
        });
    });

    sdk.connect();
}

/**
 * Disconnect from server
 */
export function disconnect(): void {
    sdk?.disconnect();
    sdk = null;
    sensorData.set(new Map());
}

/**
 * Select clients by ID
 */
export function selectClients(clientIds: string[]): void {
    sdk?.selectClients(clientIds);
}

/**
 * Toggle client selection
 */
export function toggleClientSelection(clientId: string): void {
    const currentState = get(state);
    const isSelected = currentState.selectedClientIds.includes(clientId);

    if (isSelected) {
        selectClients(currentState.selectedClientIds.filter(id => id !== clientId));
    } else {
        selectClients([...currentState.selectedClientIds, clientId]);
    }
}

/**
 * Select all clients
 */
export function selectAllClients(): void {
    sdk?.selectAll();
}

/**
 * Clear all selection
 */
export function clearSelection(): void {
    sdk?.clearSelection();
}

// Control actions
export function flashlight(mode: 'off' | 'on' | 'blink', options?: { frequency?: number; dutyCycle?: number }, toAll = false): void {
    sdk?.flashlight(mode, options, toAll);
}

export function vibrate(pattern: number[], repeat?: number, toAll = false): void {
    sdk?.vibrate(pattern, repeat, toAll);
}

export function screenColor(color: string, opacity?: number, toAll = false): void {
    sdk?.screenColor(color, opacity, toAll);
}

export function playSound(url: string, options?: { volume?: number; loop?: boolean }, toAll = false): void {
    sdk?.playSound(url, options, toAll);
}

export function switchScene(sceneId: string, toAll = false): void {
    sdk?.switchScene(sceneId, toAll);
}

export function sendPluginControl(
    pluginId: string,
    command: 'init' | 'start' | 'stop' | 'configure',
    payload?: Record<string, unknown>,
    toAll = false
): void {
    if (!sdk) return;
    const currentState = get(state);
    const target = toAll
        ? { mode: 'all' as const }
        : { mode: 'clientIds' as const, ids: currentState.selectedClientIds };
    sdk.sendPluginControl(target, pluginId, command, payload);
}

/**
 * Get SDK instance (for advanced usage)
 */
export function getSDK(): ManagerSDK | null {
    return sdk;
}
