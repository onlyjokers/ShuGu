/**
 * Protocol Version
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Message types for categorizing different kinds of messages
 */
export type MessageType = 'control' | 'data' | 'media' | 'system' | 'plugin';

/**
 * Base message structure for all messages in the system
 */
export interface BaseMessage {
    /** Server timestamp when message was processed */
    serverTimestamp: number;
    /** Client timestamp when message was sent (optional) */
    clientTimestamp?: number;
    /** Type of message */
    type: MessageType;
    /** Protocol version */
    version: typeof PROTOCOL_VERSION;
}

/**
 * Target selector for specifying message recipients
 */
export type TargetSelector =
    | { mode: 'all' }
    | { mode: 'clientIds'; ids: string[] }
    | { mode: 'group'; groupId: string };

/**
 * Control actions that can be sent to clients
 */
export type ControlAction =
    | 'flashlight'
    | 'screenColor'
    | 'screenBrightness'
    | 'vibrate'
    | 'playSound'
    | 'stopSound'
    | 'visualSceneSwitch'
    | 'setDataReportingRate'
    | 'custom';

/**
 * Flashlight mode configuration
 */
export interface FlashlightPayload {
    mode: 'off' | 'on' | 'blink';
    /** Blink frequency in Hz (for blink mode) */
    frequency?: number;
    /** Duty cycle 0-1 (for blink mode) */
    dutyCycle?: number;
}

/**
 * Screen color payload
 */
export interface ScreenColorPayload {
    color: string; // CSS color string
    opacity?: number;
}

/**
 * Vibration pattern payload
 */
export interface VibratePayload {
    /** Vibration pattern in ms [vibrate, pause, vibrate, ...] */
    pattern: number[];
    /** Number of times to repeat the pattern */
    repeat?: number;
}

/**
 * Sound playback payload
 */
export interface PlaySoundPayload {
    url: string;
    volume?: number;
    loop?: boolean;
    fadeIn?: number;
}

/**
 * Visual scene switch payload
 */
export interface VisualSceneSwitchPayload {
    sceneId: string;
    transition?: 'immediate' | 'fade';
    transitionDuration?: number;
}

/**
 * Data reporting rate configuration
 */
export interface DataReportingRatePayload {
    sensorHz?: number;
    audioHz?: number;
    enabled?: boolean;
}

/**
 * Union type for all control payloads
 */
export type ControlPayload =
    | FlashlightPayload
    | ScreenColorPayload
    | VibratePayload
    | PlaySoundPayload
    | VisualSceneSwitchPayload
    | DataReportingRatePayload
    | Record<string, unknown>;

/**
 * Control message sent from manager to control client behavior
 */
export interface ControlMessage extends BaseMessage {
    type: 'control';
    from: 'manager';
    target: TargetSelector;
    action: ControlAction;
    /** Server timestamp when the action should be executed (for sync) */
    executeAt?: number;
    payload: ControlPayload;
}

/**
 * Sensor types for data messages
 */
export type SensorType = 'gyro' | 'accel' | 'orientation' | 'mic' | 'camera' | 'custom';

/**
 * Gyroscope data
 */
export interface GyroData {
    alpha: number;
    beta: number;
    gamma: number;
}

/**
 * Accelerometer data
 */
export interface AccelData {
    x: number;
    y: number;
    z: number;
    includesGravity: boolean;
}

/**
 * Orientation data
 */
export interface OrientationData {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean;
}

/**
 * Audio features from microphone
 */
export interface MicAudioFeatures {
    /** RMS volume level 0-1 */
    volume: number;
    /** Low frequency energy */
    lowEnergy?: number;
    /** High frequency energy */
    highEnergy?: number;
    /** Estimated BPM */
    bpm?: number;
    /** Mel spectrogram data (optional, only when requested) */
    melSpectrogram?: number[];
}

/**
 * Sensor data payload union type
 */
export type SensorPayload =
    | GyroData
    | AccelData
    | OrientationData
    | MicAudioFeatures
    | Record<string, unknown>;

/**
 * Sensor data message from client to server/manager
 */
export interface SensorDataMessage extends BaseMessage {
    type: 'data';
    from: 'client';
    clientId: string;
    sensorType: SensorType;
    payload: SensorPayload;
}

/**
 * Media types
 */
export type MediaType = 'audio' | 'video';

/**
 * Media metadata message for synchronized playback
 */
export interface MediaMetaMessage extends BaseMessage {
    type: 'media';
    from: 'manager';
    target: TargetSelector;
    mediaType: MediaType;
    url: string;
    /** Server timestamp when playback should start */
    executeAt: number;
    options?: {
        loop?: boolean;
        volume?: number;
        autoplay?: boolean;
    };
}

/**
 * Plugin IDs
 */
export type AudioPluginId = 'mel-spectrogram' | 'audio-splitter' | string;
export type VisualPluginId = 'box-scene' | 'mel-scene' | string;
export type PluginId = AudioPluginId | VisualPluginId;

/**
 * Plugin commands
 */
export type PluginCommand = 'init' | 'start' | 'stop' | 'configure';

/**
 * Plugin control message
 */
export interface PluginControlMessage extends BaseMessage {
    type: 'plugin';
    from: 'manager';
    target: TargetSelector;
    pluginId: PluginId;
    command: PluginCommand;
    payload?: Record<string, unknown>;
}

/**
 * System message types
 */
export type SystemAction =
    | 'clientRegistered'
    | 'clientList'
    | 'clientJoined'
    | 'clientLeft'
    | 'error'
    | 'ping'
    | 'pong';

/**
 * Client info for client list
 */
export interface ClientInfo {
    clientId: string;
    connectedAt: number;
    userAgent?: string;
    group?: string;
    selected?: boolean;
}

/**
 * System message for connection management
 */
export interface SystemMessage extends BaseMessage {
    type: 'system';
    action: SystemAction;
    payload: {
        clientId?: string;
        clients?: ClientInfo[];
        error?: string;
        serverTimestamp?: number;
        clientTimestamp?: number;
    };
}

/**
 * Union type of all message types
 */
export type Message =
    | ControlMessage
    | SensorDataMessage
    | MediaMetaMessage
    | PluginControlMessage
    | SystemMessage;

/**
 * Socket.io event names
 */
export const SOCKET_EVENTS = {
    // Main message event
    MSG: 'msg',
    // Time sync events
    TIME_PING: 'time:ping',
    TIME_PONG: 'time:pong',
    // Connection events
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    CONNECT_ERROR: 'connect_error',
    RECONNECT: 'reconnect',
} as const;

/**
 * Connection roles
 */
export type ConnectionRole = 'manager' | 'client';
