import { io, Socket } from 'socket.io-client';
import {
    Message,
    ControlMessage,
    PluginControlMessage,
    SystemMessage,
    SensorDataMessage,
    MediaMetaMessage,
    ClientInfo,
    SOCKET_EVENTS,
    isSensorDataMessage,
    isSystemMessage,
    createControlMessage,
    createPluginControlMessage,
    createMediaMetaMessage,
    createTimePing,
    processTimePong,
    createTimeSyncState,
    updateTimeSyncState,
    getServerTime,
    TimeSyncState,
    TimePongData,
    TargetSelector,
    ControlAction,
    ControlPayload,
    ScreenColorPayload,
    PluginId,
    PluginCommand,
    MediaType,
    targetAll,
    targetClients,
} from '@shugu/protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ManagerState {
    status: ConnectionStatus;
    managerId: string | null;
    clients: ClientInfo[];
    selectedClientIds: string[];
    timeSync: TimeSyncState;
    error: string | null;
}

export type MessageHandler<T = Message> = (message: T) => void;

/**
 * Configuration for ManagerSDK
 */
export interface ManagerSDKConfig {
    serverUrl: string;
    autoReconnect?: boolean;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
    timeSyncInterval?: number;
}

/**
 * Manager SDK for managing Socket.io connection and controlling clients
 */
export class ManagerSDK {
    private socket: Socket | null = null;
    private config: Required<ManagerSDKConfig>;
    private state: ManagerState;
    private stateListeners: Set<(state: ManagerState) => void> = new Set();
    private sensorDataHandlers: Set<MessageHandler<SensorDataMessage>> = new Set();
    private timeSyncIntervalId: ReturnType<typeof setInterval> | null = null;

    constructor(config: ManagerSDKConfig) {
        this.config = {
            serverUrl: config.serverUrl,
            autoReconnect: config.autoReconnect ?? true,
            reconnectionAttempts: config.reconnectionAttempts ?? 10,
            reconnectionDelay: config.reconnectionDelay ?? 1000,
            timeSyncInterval: config.timeSyncInterval ?? 5000,
        };

        this.state = {
            status: 'disconnected',
            managerId: null,
            clients: [],
            selectedClientIds: [],
            timeSync: createTimeSyncState(),
            error: null,
        };
    }

    /**
     * Connect to the server
     */
    connect(): void {
        if (this.socket?.connected) return;

        this.updateState({ status: 'connecting', error: null });

        this.socket = io(this.config.serverUrl, {
            query: { role: 'manager' },
            // Use polling first for better compatibility, then upgrade to websocket
            transports: ['polling', 'websocket'],
            // Increase timeouts
            timeout: 20000,
            // Reconnection settings
            reconnection: this.config.autoReconnect,
            reconnectionAttempts: this.config.reconnectionAttempts,
            reconnectionDelay: this.config.reconnectionDelay,
            reconnectionDelayMax: 5000,
            // Force new connection
            forceNew: true,
        });

        this.setupSocketListeners();
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        this.stopTimeSync();
        this.socket?.disconnect();
        this.socket = null;
        this.updateState({
            status: 'disconnected',
            managerId: null,
            clients: [],
        });
    }

    /**
     * Get current state
     */
    getState(): ManagerState {
        return { ...this.state };
    }

    /**
     * Subscribe to state changes
     */
    onStateChange(listener: (state: ManagerState) => void): () => void {
        this.stateListeners.add(listener);
        // Immediately call with current state
        listener(this.getState());
        return () => this.stateListeners.delete(listener);
    }

    /**
     * Subscribe to sensor data from clients
     */
    onSensorData(handler: MessageHandler<SensorDataMessage>): () => void {
        this.sensorDataHandlers.add(handler);
        return () => this.sensorDataHandlers.delete(handler);
    }

    /**
     * Select clients
     */
    selectClients(clientIds: string[]): void {
        this.updateState({ selectedClientIds: clientIds });
        // Notify server of selection
        this.socket?.emit('select:clients', { clientIds });
    }

    /**
     * Select all clients
     */
    selectAll(): void {
        const allIds = this.state.clients.map(c => c.clientId);
        this.selectClients(allIds);
    }

    /**
     * Clear selection
     */
    clearSelection(): void {
        this.selectClients([]);
    }

    /**
     * Send control message to target
     */
    sendControl(
        target: TargetSelector,
        action: ControlAction,
        payload: ControlPayload,
        executeAt?: number
    ): void {
        if (!this.socket?.connected) return;
        const message = createControlMessage(target, action, payload, executeAt);
        this.socket.emit(SOCKET_EVENTS.MSG, message);
    }

    /**
     * Send control to selected clients
     */
    sendControlToSelected(
        action: ControlAction,
        payload: ControlPayload,
        executeAt?: number
    ): void {
        if (this.state.selectedClientIds.length === 0) return;
        this.sendControl(
            targetClients(this.state.selectedClientIds),
            action,
            payload,
            executeAt
        );
    }

    /**
     * Send control to all clients
     */
    sendControlToAll(
        action: ControlAction,
        payload: ControlPayload,
        executeAt?: number
    ): void {
        this.sendControl(targetAll(), action, payload, executeAt);
    }

    /**
     * Send plugin control message
     */
    sendPluginControl(
        target: TargetSelector,
        pluginId: PluginId,
        command: PluginCommand,
        payload?: Record<string, unknown>
    ): void {
        if (!this.socket?.connected) return;
        const message = createPluginControlMessage(target, pluginId, command, payload);
        this.socket.emit(SOCKET_EVENTS.MSG, message);
    }

    /**
     * Send media message
     */
    sendMedia(
        target: TargetSelector,
        mediaType: MediaType,
        url: string,
        executeAt: number,
        options?: MediaMetaMessage['options']
    ): void {
        if (!this.socket?.connected) return;
        const message = createMediaMetaMessage(target, mediaType, url, executeAt, options);
        this.socket.emit(SOCKET_EVENTS.MSG, message);
    }

    /**
     * Get current server time
     */
    getServerTime(): number {
        return getServerTime(this.state.timeSync);
    }

    /**
     * Get time offset
     */
    getOffset(): number {
        return this.state.timeSync.offset;
    }

    /**
     * Schedule execution at future server time
     */
    scheduleAt(delayMs: number): number {
        return this.getServerTime() + delayMs;
    }

    // Convenience methods for common actions

    /**
     * Control flashlight on all or selected clients
     */
    flashlight(mode: 'off' | 'on' | 'blink', options?: { frequency?: number; dutyCycle?: number }, toAll = false, executeAt?: number): void {
        const payload = { mode, ...options };
        if (toAll) {
            this.sendControlToAll('flashlight', payload, executeAt);
        } else {
            this.sendControlToSelected('flashlight', payload, executeAt);
        }
    }

    /**
     * Control vibration
     */
    vibrate(pattern: number[], repeat?: number, toAll = false, executeAt?: number): void {
        const payload = { pattern, repeat };
        if (toAll) {
            this.sendControlToAll('vibrate', payload, executeAt);
        } else {
            this.sendControlToSelected('vibrate', payload, executeAt);
        }
    }

    /**
     * Play synthesized modulation tone on clients
     */
    modulateSound(
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
        const payload = { ...options };
        if (toAll) {
            this.sendControlToAll('modulateSound', payload, executeAt);
        } else {
            this.sendControlToSelected('modulateSound', payload, executeAt);
        }
    }

    /**
     * Update synthesized tone parameters without restarting playback
     */
    modulateSoundUpdate(
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
        const payload = { ...options };
        if (toAll) {
            this.sendControlToAll('modulateSoundUpdate', payload, executeAt);
        } else {
            this.sendControlToSelected('modulateSoundUpdate', payload, executeAt);
        }
    }

    /**
     * Control screen color
     */
    screenColor(payload: { color: string; opacity?: number } | ScreenColorPayload, toAll = false, executeAt?: number): void {
        const normalized: ScreenColorPayload = 'mode' in payload || Array.isArray((payload as ScreenColorPayload).cycleColors)
            ? { mode: 'solid', opacity: 1, ...(payload as ScreenColorPayload) }
            : { color: (payload as { color: string }).color, opacity: (payload as { opacity?: number }).opacity, mode: 'solid' };

        normalized.color = normalized.color ?? '#ffffff';
        normalized.mode = normalized.mode ?? 'solid';
        normalized.opacity = normalized.opacity ?? 1;

        if (toAll) {
            this.sendControlToAll('screenColor', normalized, executeAt);
        } else {
            this.sendControlToSelected('screenColor', normalized, executeAt);
        }
    }

    /**
     * Play sound on clients
     */
    playSound(url: string, options?: { volume?: number; loop?: boolean }, toAll = false, executeAt?: number): void {
        const payload = { url, ...options };
        if (toAll) {
            this.sendControlToAll('playSound', payload, executeAt);
        } else {
            this.sendControlToSelected('playSound', payload, executeAt);
        }
    }

    /**
     * Play media (audio or video) on clients
     */
    playMedia(
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
        const payload = { url, ...options };
        if (toAll) {
            this.sendControlToAll('playMedia', payload, executeAt);
        } else {
            this.sendControlToSelected('playMedia', payload, executeAt);
        }
    }

    /**
     * Stop all media on clients
     */
    stopMedia(toAll = false): void {
        if (toAll) {
            this.sendControlToAll('stopMedia', {});
        } else {
            this.sendControlToSelected('stopMedia', {});
        }
    }

    stopSound(toAll = false): void {
        if (toAll) {
            this.sendControlToAll('stopSound', {});
        } else {
            this.sendControlToSelected('stopSound', {});
        }
    }

    /**
     * Show image on clients
     */
    showImage(url: string, options?: { duration?: number }, toAll = false, executeAt?: number): void {
        const payload = { url, ...options };
        if (toAll) {
            this.sendControlToAll('showImage', payload, executeAt);
        } else {
            this.sendControlToSelected('showImage', payload, executeAt);
        }
    }

    /**
     * Hide image on clients
     */
    hideImage(toAll = false): void {
        if (toAll) {
            this.sendControlToAll('hideImage', {});
        } else {
            this.sendControlToSelected('hideImage', {});
        }
    }

    /**
     * Switch visual scene
     */
    switchScene(sceneId: string, toAll = false, executeAt?: number): void {
        const payload = { sceneId };
        if (toAll) {
            this.sendControlToAll('visualSceneSwitch', payload, executeAt);
        } else {
            this.sendControlToSelected('visualSceneSwitch', payload, executeAt);
        }
    }

    /**
     * Toggle ASCII post effect on clients
     */
    asciiMode(enabled: boolean, toAll = false, executeAt?: number): void {
        const payload = { enabled };
        if (toAll) {
            this.sendControlToAll('asciiMode', payload, executeAt);
        } else {
            this.sendControlToSelected('asciiMode', payload, executeAt);
        }
    }

    /**
     * Adjust ASCII resolution on clients (cell size in px)
     */
    asciiResolution(cellSize: number, toAll = false, executeAt?: number): void {
        const payload = { cellSize };
        if (toAll) {
            this.sendControlToAll('asciiResolution', payload, executeAt);
        } else {
            this.sendControlToSelected('asciiResolution', payload, executeAt);
        }
    }

    private setupSocketListeners(): void {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('[SDK Manager] Connected');
            this.updateState({ status: 'connected', error: null });
            this.startTimeSync();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[SDK Manager] Disconnected:', reason);
            this.stopTimeSync();
            this.updateState({ status: 'disconnected' });
        });

        this.socket.on('connect_error', (error) => {
            console.error('[SDK Manager] Connection error:', error.message);
            this.updateState({ status: 'error', error: error.message });
        });

        this.socket.io.on('reconnect_attempt', () => {
            this.updateState({ status: 'reconnecting' });
        });

        this.socket.io.on('reconnect', () => {
            console.log('[SDK Manager] Reconnected');
            this.updateState({ status: 'connected', error: null });
        });

        // Handle messages
        this.socket.on(SOCKET_EVENTS.MSG, (message: Message) => {
            this.handleMessage(message);
        });

        // Handle time sync pong
        this.socket.on(SOCKET_EVENTS.TIME_PONG, (data: TimePongData) => {
            const result = processTimePong(data);
            const newTimeSync = updateTimeSyncState(this.state.timeSync, result);
            this.updateState({ timeSync: newTimeSync });
        });
    }

    private handleMessage(message: Message): void {
        if (isSensorDataMessage(message)) {
            // Dispatch sensor data to handlers
            this.sensorDataHandlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error('[SDK Manager] Sensor data handler error:', error);
                }
            });
        } else if (isSystemMessage(message)) {
            this.handleSystemMessage(message as SystemMessage);
        }
    }

    private handleSystemMessage(message: SystemMessage): void {
        switch (message.action) {
            case 'clientRegistered':
                if (message.payload.clientId) {
                    this.updateState({ managerId: message.payload.clientId });
                    console.log('[SDK Manager] Registered as:', message.payload.clientId);
                }
                break;
            case 'clientList':
                if (message.payload.clients) {
                    this.updateState({ clients: message.payload.clients });
                }
                break;
            case 'clientJoined':
                console.log('[SDK Manager] Client joined:', message.payload.clientId);
                break;
            case 'clientLeft':
                console.log('[SDK Manager] Client left:', message.payload.clientId);
                // Remove from selection if selected
                const remaining = this.state.selectedClientIds.filter(
                    id => id !== message.payload.clientId
                );
                if (remaining.length !== this.state.selectedClientIds.length) {
                    this.updateState({ selectedClientIds: remaining });
                }
                break;
        }
    }

    private updateState(partial: Partial<ManagerState>): void {
        this.state = { ...this.state, ...partial };
        this.stateListeners.forEach(listener => {
            try {
                listener(this.getState());
            } catch (error) {
                console.error('[SDK Manager] State listener error:', error);
            }
        });
    }

    private startTimeSync(): void {
        // Do immediate sync
        this.doTimeSync();

        // Set up interval
        this.timeSyncIntervalId = setInterval(() => {
            this.doTimeSync();
        }, this.config.timeSyncInterval);
    }

    private stopTimeSync(): void {
        if (this.timeSyncIntervalId) {
            clearInterval(this.timeSyncIntervalId);
            this.timeSyncIntervalId = null;
        }
    }

    private doTimeSync(): void {
        if (!this.socket?.connected) return;
        const pingData = createTimePing();
        this.socket.emit(SOCKET_EVENTS.TIME_PING, pingData);
    }
}
