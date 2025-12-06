/**
 * Client store - wraps the SDK and provides reactive state for Svelte
 */
import { writable, derived, get } from 'svelte/store';
import {
    ClientSDK,
    SensorManager,
    FlashlightController,
    ScreenController,
    VibrationController,
    SoundPlayer,
    WakeLockController,
    type ClientState,
    type ClientSDKConfig
} from '@shugu/sdk-client';
import type {
    ControlMessage,
    PluginControlMessage,
    FlashlightPayload,
    ScreenColorPayload,
    VibratePayload,
    PlaySoundPayload,
    VisualSceneSwitchPayload
} from '@shugu/protocol';

// SDK and controller instances
let sdk: ClientSDK | null = null;
let sensorManager: SensorManager | null = null;
let flashlightController: FlashlightController | null = null;
let screenController: ScreenController | null = null;
let vibrationController: VibrationController | null = null;
let soundPlayer: SoundPlayer | null = null;
let wakeLockController: WakeLockController | null = null;

// Core state store
export const state = writable<ClientState>({
    status: 'disconnected',
    clientId: null,
    timeSync: {
        offset: 0,
        samples: [],
        maxSamples: 10,
        initialized: false,
        lastSyncTime: 0,
    },
    error: null,
});

// Permission states
export const permissions = writable<{
    microphone: 'pending' | 'granted' | 'denied';
    motion: 'pending' | 'granted' | 'denied';
    camera: 'pending' | 'granted' | 'denied';
    wakeLock: 'pending' | 'granted' | 'denied';
}>({
    microphone: 'pending',
    motion: 'pending',
    camera: 'pending',
    wakeLock: 'pending',
});

// Latency in ms (smooth average)
export const latency = writable<number>(0);

// Current visual scene
export const currentScene = writable<string>('box-scene');

// Audio stream for plugins
export const audioStream = writable<MediaStream | null>(null);

// Derived stores
export const connectionStatus = derived(state, ($state) => $state.status);
export const clientId = derived(state, ($state) => $state.clientId);

/**
 * Initialize and connect to server
 */
export async function initialize(config: ClientSDKConfig): Promise<void> {
    // Initialize SDK
    sdk = new ClientSDK(config);

    // Subscribe to state changes
    sdk.onStateChange((newState) => {
        state.set(newState);
    });

    // Subscribe to control messages
    sdk.onControl(handleControlMessage);
    sdk.onPluginControl(handlePluginControlMessage);

    // Initialize controllers
    flashlightController = new FlashlightController();
    screenController = new ScreenController();
    vibrationController = new VibrationController();
    soundPlayer = new SoundPlayer();
    wakeLockController = new WakeLockController();
    sensorManager = new SensorManager({ throttleMs: 100 });

    // Connect to server
    sdk.connect();
}

/**
 * Request all permissions
 */
export async function requestPermissions(): Promise<void> {
    // Request microphone
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream.set(stream);
        permissions.update(p => ({ ...p, microphone: 'granted' }));

        // Initialize sound player with user gesture
        await soundPlayer?.init();
    } catch (error) {
        console.warn('[Permissions] Microphone denied:', error);
        permissions.update(p => ({ ...p, microphone: 'denied' }));
    }

    // Request motion sensors
    if (sensorManager) {
        const result = await sensorManager.requestPermissions();
        permissions.update(p => ({ ...p, motion: result.granted ? 'granted' : 'denied' }));
        if (result.granted) {
            sensorManager.start();
            setupSensorReporting();
        }
    }

    // Request wake lock
    if (wakeLockController) {
        const success = await wakeLockController.request();
        permissions.update(p => ({ ...p, wakeLock: success ? 'granted' : 'denied' }));
    }

    // Initialize flashlight (camera)
    if (flashlightController) {
        const success = await flashlightController.init();
        permissions.update(p => ({ ...p, camera: success ? 'granted' : 'denied' }));
    }
}

/**
 * Set up sensor data reporting to server
 */
function setupSensorReporting(): void {
    if (!sensorManager) return;

    sensorManager.onOrientation((data) => {
        sdk?.sendSensorData('orientation', data);
    });

    sensorManager.onGyro((data) => {
        sdk?.sendSensorData('gyro', data);
    });

    sensorManager.onAccel((data) => {
        sdk?.sendSensorData('accel', data);
    });
}

/**
 * Handle control messages from manager
 */
function handleControlMessage(message: ControlMessage): void {
    const executeAction = () => {
        switch (message.action) {
            case 'flashlight':
                flashlightController?.setMode(message.payload as FlashlightPayload);
                break;

            case 'screenColor':
                screenController?.setColor(message.payload as ScreenColorPayload);
                break;

            case 'screenBrightness':
                const brightness = (message.payload as { brightness: number }).brightness;
                screenController?.setBrightness(brightness);
                break;

            case 'vibrate':
                vibrationController?.vibrate(message.payload as VibratePayload);
                break;

            case 'playSound':
                soundPlayer?.play(message.payload as PlaySoundPayload);
                break;

            case 'stopSound':
                soundPlayer?.stop();
                break;

            case 'visualSceneSwitch':
                const scenePayload = message.payload as VisualSceneSwitchPayload;
                currentScene.set(scenePayload.sceneId);
                break;

            case 'setDataReportingRate':
                const ratePayload = message.payload as { sensorHz?: number };
                if (sensorManager && ratePayload.sensorHz) {
                    sensorManager.setThrottleMs(1000 / ratePayload.sensorHz);
                }
                break;

            case 'setSensorState':
                const sensorStatePayload = message.payload as { active: boolean };
                if (sensorManager) {
                    if (sensorStatePayload.active) {
                        sensorManager.start();
                    } else {
                        sensorManager.stop();
                    }
                }
                break;
            
            case 'ping':
                // Echo back for latency measurement
                 if (sdk && message.id) {
                    // We can just log it or maybe send a pong if we had a protocol for it. 
                    // But actually, the plan mentioned "Latency Monitoring: Add measureLatency() function that sends a ping".
                    // The server -> client ping isn't the main goal, it's measuring latency.
                    // Let's stick to the plan: "Add measureLatency() function that sends a ping and updates a new latency store."
                    // But wait, this is handleControlMessage. The server might send a ping? 
                    // Actually the plan said "latency tracking (ping/pong or timestamp diff) in messages." 
                    // and "Add measureLatency() function that sends a ping".
                    // So we need to add that function to this file.
                 }
                 break;

            default:
                console.log('[Client] Unknown action:', message.action);
        }
    };

    // Schedule if executeAt is specified
    if (message.executeAt && sdk) {
        const { cancel, delay } = sdk.scheduleAt(message.executeAt, executeAction);
        if (delay < 0) {
            // Already past, execute immediately
            executeAction();
        }
    } else {
        executeAction();
    }
}

/**
 * Handle plugin control messages
 */
function handlePluginControlMessage(message: PluginControlMessage): void {
    console.log('[Client] Plugin control:', message.pluginId, message.command);
    // Plugin control is handled by AudioPipeline component
}

/**
 * Disconnect and cleanup
 */
export function disconnect(): void {
    sdk?.disconnect();
    sdk = null;

    sensorManager?.stop();
    sensorManager = null;

    flashlightController?.destroy();
    flashlightController = null;

    screenController?.destroy();
    screenController = null;

    soundPlayer?.destroy();
    soundPlayer = null;

    wakeLockController?.release();
    wakeLockController = null;

    // Stop audio stream
    const stream = get(audioStream);
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        audioStream.set(null);
    }
}

/**
 * Get SDK for plugin access
 */
export function getSDK(): ClientSDK | null {
    return sdk;
}

/**
 * Get sound player for audio context access
 */
export function getSoundPlayer(): SoundPlayer | null {
    return soundPlayer;
}

/**
 * Measure round-trip latency
 */
export async function measureLatency(): Promise<number> {
    if (!sdk) return 0;
    
    try {
        const rtt = await sdk.ping();
        latency.set(rtt);
        return rtt;
    } catch (e) {
        console.warn('[Client] Latency check failed:', e);
        return 0;
    }
}
