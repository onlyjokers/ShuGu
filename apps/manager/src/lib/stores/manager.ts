/**
 * Manager store - wraps the SDK and provides reactive state for Svelte
 */
import { writable, derived, get } from 'svelte/store';
import { ManagerSDK, type ManagerState, type ManagerSDKConfig } from '@shugu/sdk-manager';
import type { SensorDataMessage, ClientInfo, ScreenColorPayload } from '@shugu/protocol';

import { parameterRegistry } from '../parameters/registry';
import { registerDefaultControlParameters } from '../parameters/presets';

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

    // Seed registry-based control parameters early so MIDI/AutoUI/Project restore can see them.
    registerDefaultControlParameters();

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
    parameterRegistry.clear();
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
export function flashlight(mode: 'off' | 'on' | 'blink', options?: { frequency?: number; dutyCycle?: number }, toAll = false, executeAt?: number): void {
    sdk?.flashlight(mode, options, toAll, executeAt);
}

export function vibrate(pattern: number[], repeat?: number, toAll = false, executeAt?: number): void {
    sdk?.vibrate(pattern, repeat, toAll, executeAt);
}

export function modulateSound(
    options: {
        frequency?: number;
        duration?: number;
        volume?: number;
        waveform?: 'sine' | 'square' | 'sawtooth' | 'triangle';
        modFrequency?: number;
        modDepth?: number;
        attack?: number;
        release?: number;
    },
    toAll = false,
    executeAt?: number
): void {
    sdk?.modulateSound(options, toAll, executeAt);
}

export function modulateSoundUpdate(
    options: {
        frequency?: number;
        volume?: number;
        waveform?: 'sine' | 'square' | 'sawtooth' | 'triangle';
        modFrequency?: number;
        modDepth?: number;
        durationMs?: number;
    },
    toAll = false,
    executeAt?: number
): void {
    sdk?.modulateSoundUpdate(options, toAll, executeAt);
}

export function screenColor(
    colorOrPayload: string | ScreenColorPayload,
    opacity?: number,
    toAll = false,
    executeAt?: number
): void {
    const payload: ScreenColorPayload = typeof colorOrPayload === 'string'
        ? { color: colorOrPayload, opacity, mode: 'solid' }
        : colorOrPayload;

    sdk?.screenColor(payload, toAll, executeAt);
}

export function playSound(url: string, options?: { volume?: number; loop?: boolean }, toAll = false, executeAt?: number): void {
    sdk?.playSound(url, options, toAll, executeAt);
}

export function playMedia(
    url: string,
    options?: {
        mediaType?: 'audio' | 'video';
        volume?: number;
        loop?: boolean;
        muted?: boolean;
        fadeIn?: number;
    },
    toAll = false,
    executeAt?: number
): void {
    sdk?.playMedia(url, options, toAll, executeAt);
}

export function stopMedia(toAll = false): void {
    sdk?.stopMedia(toAll);
}

export function stopSound(toAll = false): void {
    sdk?.stopSound(toAll);
}

export function interruptMedia(toAll = false): void {
    // Stop video/audio/media streams and hide images
    stopMedia(toAll);
    stopSound(toAll);
    hideImage(toAll);
}

export function showImage(
    url: string,
    options?: { duration?: number },
    toAll = false,
    executeAt?: number
): void {
    sdk?.showImage(url, options, toAll, executeAt);
}

export function hideImage(toAll = false): void {
    sdk?.hideImage(toAll);
}

export function switchScene(sceneId: string, toAll = false, executeAt?: number): void {
    sdk?.switchScene(sceneId, toAll, executeAt);
}

export function asciiMode(enabled: boolean, toAll = false, executeAt?: number): void {
    sdk?.asciiMode(enabled, toAll, executeAt);
}

export function asciiResolution(cellSize: number, toAll = false, executeAt?: number): void {
    sdk?.asciiResolution(cellSize, toAll, executeAt);
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
