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
  ModulatedSoundPlayer,
  WakeLockController,
  NodeExecutor,
  enableToneAudio,
  type NodeCommand,
  type ClientState,
  type ClientSDKConfig,
  type ClientIdentity,
} from '@shugu/sdk-client';
import type {
  ControlMessage,
  PluginControlMessage,
  ControlAction,
  ControlPayload,
  FlashlightPayload,
  ScreenColorPayload,
  VibratePayload,
  PlaySoundPayload,
  PlayMediaPayload,
  ShowImagePayload,
  ModulateSoundPayload,
  VisualSceneSwitchPayload,
} from '@shugu/protocol';

// SDK and controller instances
let sdk: ClientSDK | null = null;
let sensorManager: SensorManager | null = null;
let flashlightController: FlashlightController | null = null;
let screenController: ScreenController | null = null;
let vibrationController: VibrationController | null = null;
let soundPlayer: SoundPlayer | null = null;
let modulatedSoundPlayer: ModulatedSoundPlayer | null = null;
let wakeLockController: WakeLockController | null = null;
let nodeExecutor: NodeExecutor | null = null;

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
  geolocation: 'pending' | 'granted' | 'denied' | 'unavailable' | 'unsupported';
}>({
  microphone: 'pending',
  motion: 'pending',
  camera: 'pending',
  wakeLock: 'pending',
  geolocation: 'pending',
});

// Latency in ms (smooth average)
export const latency = writable<number>(0);

// Current visual scene
export const currentScene = writable<string>('box-scene');

// ASCII post-processing toggle (default on)
export const asciiEnabled = writable<boolean>(true);

// ASCII resolution (cell size in pixels)
export const asciiResolution = writable<number>(11);

// Audio stream for plugins
export const audioStream = writable<MediaStream | null>(null);

const AUDIO_ENABLED_STORAGE_KEY = 'shugu-audio-enabled';
const storedAudioEnabled =
  typeof window !== 'undefined' &&
  window.localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY) === 'true';

// Tone.js audio enablement state (requires user gesture to flip to true).
export const audioEnabled = writable<boolean>(storedAudioEnabled);

// Video playback state
export const videoState = writable<{
  url: string | null;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  volume: number;
}>({
  url: null,
  playing: false,
  muted: true,
  loop: false,
  volume: 1,
});

// Image display state
export const imageState = writable<{
  url: string | null;
  visible: boolean;
  duration: number | undefined;
}>({
  url: null,
  visible: false,
  duration: undefined,
});

// Derived stores
export const connectionStatus = derived(state, ($state) => $state.status);
export const clientId = derived(state, ($state) => $state.clientId);

const DEVICE_ID_STORAGE_KEY = 'shugu-device-id';
const INSTANCE_ID_STORAGE_KEY = 'shugu-client-instance-id';
const CLIENT_ID_STORAGE_KEY = 'shugu-client-id';

function createRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function getOrCreateStorageId(storage: Storage, key: string, prefix: string): string {
  const existing = storage.getItem(key);
  if (existing && existing.trim()) return existing;
  const id = createRandomId(prefix);
  storage.setItem(key, id);
  return id;
}

function getOrCreateClientIdentity(): ClientIdentity | null {
  if (typeof window === 'undefined') return null;

  const deviceId = getOrCreateStorageId(window.localStorage, DEVICE_ID_STORAGE_KEY, 'c_');
  const instanceId = getOrCreateStorageId(window.sessionStorage, INSTANCE_ID_STORAGE_KEY, 'i_');

  const storedClientId = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  const clientId = storedClientId && storedClientId.trim() ? storedClientId : deviceId;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);

  return { deviceId, instanceId, clientId };
}

function persistAssignedClientId(assignedClientId: string): void {
  if (typeof window === 'undefined') return;
  if (!assignedClientId) return;
  const current = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (current === assignedClientId) return;
  window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, assignedClientId);
}

/**
 * Initialize and connect to server
 */
export function initialize(config: ClientSDKConfig, options?: { autoConnect?: boolean }): void {
  const identity = getOrCreateClientIdentity();

  // Initialize SDK
  sdk = new ClientSDK({
    ...config,
    identity: config.identity ?? identity ?? undefined,
  });

  // Subscribe to state changes
  sdk.onStateChange((newState) => {
    state.set(newState);
    if (newState.clientId) {
      persistAssignedClientId(newState.clientId);
    }
  });

  // Subscribe to control messages
  sdk.onControl(handleControlMessage);
  sdk.onPluginControl(handlePluginControlMessage);

  // Initialize controllers
  flashlightController = new FlashlightController();
  screenController = new ScreenController();
  vibrationController = new VibrationController();
  soundPlayer = new SoundPlayer();
  modulatedSoundPlayer = new ModulatedSoundPlayer();
  wakeLockController = new WakeLockController();
  sensorManager = new SensorManager({ throttleMs: 100 });
  nodeExecutor = new NodeExecutor(
    sdk,
    (cmd: NodeCommand) => executeControl(cmd.action, cmd.payload, cmd.executeAt),
    {
      canRunCapability: (capability) => {
        const p = get(permissions);
        if (capability === 'flashlight') return p.camera === 'granted';
        if (capability === 'sensors') return p.motion === 'granted' || p.microphone === 'granted';
        if (capability === 'sound') {
          const hasAudioContext =
            typeof window !== 'undefined' &&
            Boolean((window as any).AudioContext || (window as any).webkitAudioContext);
          return hasAudioContext;
        }
        return true;
      },
    }
  );

  if (options?.autoConnect !== false) {
    sdk.connect();
  }
}

export function connectToServer(): void {
  sdk?.connect();
}

/**
 * Disconnect socket only (keep SDK + controllers alive).
 * Useful for treating "background/lock screen" as offline without losing app state.
 */
export function disconnectFromServer(): void {
  sdk?.disconnect();
}

/**
 * Request all permissions
 */
export async function requestPermissions(): Promise<void> {
  // Kick off permission prompts synchronously (before the first await) so iOS can show them.
  // Some browser APIs require being triggered within the same user gesture stack.
  const motionPermissionPromise = sensorManager
    ? sensorManager.requestPermissions()
    : Promise.resolve({ granted: false, error: 'Sensor manager not initialized' });

  let microphonePromise: Promise<MediaStream>;
  if (navigator.mediaDevices?.getUserMedia) {
    microphonePromise = navigator.mediaDevices.getUserMedia({ audio: true });
  } else {
    microphonePromise = Promise.reject(new Error('mediaDevices.getUserMedia is not supported'));
  }

  const soundInitPromise = soundPlayer
    ? soundPlayer.init().catch((error) => {
        console.warn('[Permissions] Sound player init failed:', error);
      })
    : Promise.resolve();

  const [motionResult, microphoneResult] = await Promise.allSettled([
    motionPermissionPromise,
    microphonePromise,
  ]);

  // Handle motion sensors
  if (motionResult.status === 'fulfilled') {
    permissions.update((p) => ({
      ...p,
      motion: motionResult.value.granted ? 'granted' : 'denied',
    }));
    if (motionResult.value.granted && sensorManager) {
      sensorManager.start();
      setupSensorReporting();
    } else if (!motionResult.value.granted) {
      console.warn('[Permissions] Motion/orientation denied:', motionResult.value.error);
    }
  } else {
    console.warn(
      '[Permissions] Motion/orientation permission request failed:',
      motionResult.reason
    );
    permissions.update((p) => ({ ...p, motion: 'denied' }));
  }

  // Handle microphone
  if (microphoneResult.status === 'fulfilled') {
    audioStream.set(microphoneResult.value);
    permissions.update((p) => ({ ...p, microphone: 'granted' }));
  } else {
    console.warn('[Permissions] Microphone denied:', microphoneResult.reason);
    permissions.update((p) => ({ ...p, microphone: 'denied' }));
  }

  await soundInitPromise;

  // Request wake lock
  if (wakeLockController) {
    const success = await wakeLockController.request();
    permissions.update((p) => ({ ...p, wakeLock: success ? 'granted' : 'denied' }));
  }

  // Initialize flashlight (camera)
  if (flashlightController) {
    const success = await flashlightController.init();
    permissions.update((p) => ({ ...p, camera: success ? 'granted' : 'denied' }));
  }
}

function persistAudioEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUDIO_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

/**
 * Enable Tone.js audio (must be called from a user gesture).
 */
export async function enableAudio(): Promise<{ enabled: boolean; error?: string } | null> {
  const result = await enableToneAudio();
  if (!result) return null;
  audioEnabled.set(result.enabled);
  persistAudioEnabled(result.enabled);
  return result;
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
  executeControl(message.action, message.payload, message.executeAt);
}

function executeControl(action: ControlAction, payload: ControlPayload, executeAt?: number): void {
  const executeAction = (delaySeconds = 0) => {
    if (import.meta.env.DEV && typeof window !== 'undefined' && (window as any).__SHUGU_E2E) {
      const entry = { at: Date.now(), action, payload, executeAt };
      (window as any).__SHUGU_E2E_LAST_COMMAND = entry;
      const list = ((window as any).__SHUGU_E2E_COMMANDS ??= []) as any[];
      list.push(entry);
      if (list.length > 200) list.splice(0, list.length - 200);
    }

    switch (action) {
      case 'flashlight':
        flashlightController?.setMode(payload as FlashlightPayload);
        break;

      case 'screenColor':
        screenController?.setColor(payload as ScreenColorPayload);
        break;

      case 'screenBrightness':
        {
          const brightness = (payload as { brightness: number }).brightness;
          screenController?.setBrightness(brightness);
        }
        break;

      case 'vibrate':
        vibrationController?.vibrate(payload as VibratePayload);
        break;

      case 'modulateSound':
        modulatedSoundPlayer?.play(
          payload as ModulateSoundPayload,
          soundPlayer?.getAudioContext(),
          delaySeconds // Use precise audio scheduling
        );
        break;
      case 'modulateSoundUpdate':
        modulatedSoundPlayer?.update({
          frequency: (payload as ModulateSoundPayload).frequency,
          volume: (payload as ModulateSoundPayload).volume,
          waveform: (payload as ModulateSoundPayload).waveform,
          modFrequency: (payload as ModulateSoundPayload).modFrequency,
          modDepth: (payload as ModulateSoundPayload).modDepth,
          durationMs:
            (payload as any).durationMs ?? (payload as ModulateSoundPayload).duration,
        });
        break;

      case 'playSound':
        soundPlayer?.play(payload as PlaySoundPayload, delaySeconds);
        break;

      case 'playMedia': {
        const mediaPayload = payload as PlayMediaPayload;
        // Check if it's a video by extension or explicit type
        const isVideo =
          mediaPayload.mediaType === 'video' ||
          /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(mediaPayload.url);

        if (isVideo) {
          const current = get(videoState);
          const next = {
            url: mediaPayload.url,
            playing: true,
            muted: mediaPayload.muted ?? true,
            loop: mediaPayload.loop ?? false,
            volume: mediaPayload.volume ?? 1,
          };
          videoState.set(
            current.url === next.url && current.playing
              ? { ...current, ...next }
              : next
          );
        } else {
          // Fallback to audio
          const updated =
            soundPlayer?.update({
              url: mediaPayload.url,
              volume: mediaPayload.volume,
              loop: mediaPayload.loop,
              fadeIn: mediaPayload.fadeIn,
            }) ?? false;
          if (!updated) {
            soundPlayer?.play(
              {
                url: mediaPayload.url,
                volume: mediaPayload.volume,
                loop: mediaPayload.loop,
                fadeIn: mediaPayload.fadeIn,
              },
              delaySeconds
            );
          }
        }
        break;
      }

      case 'stopMedia':
        videoState.set({
          url: null,
          playing: false,
          muted: true,
          loop: false,
          volume: 1,
        });
        soundPlayer?.stop();
        break;

      case 'stopSound':
        soundPlayer?.stop();
        modulatedSoundPlayer?.stop();
        break;

      case 'showImage': {
        const imagePayload = payload as ShowImagePayload;
        imageState.set({
          url: imagePayload.url,
          visible: true,
          duration: imagePayload.duration,
        });
        break;
      }

      case 'hideImage':
        imageState.set({
          url: null,
          visible: false,
          duration: undefined,
        });
        break;

      case 'visualSceneSwitch':
        {
          const scenePayload = payload as VisualSceneSwitchPayload;
          currentScene.set(scenePayload.sceneId);
        }
        break;

      case 'setDataReportingRate':
        {
          const ratePayload = payload as { sensorHz?: number };
          if (sensorManager && ratePayload.sensorHz) {
            sensorManager.setThrottleMs(1000 / ratePayload.sensorHz);
          }
        }
        break;

      case 'setSensorState':
        {
          const sensorStatePayload = payload as { active: boolean };
          if (sensorManager) {
            if (sensorStatePayload.active) {
              sensorManager.start();
            } else {
              sensorManager.stop();
            }
          }
        }
        break;

      case 'asciiMode':
        asciiEnabled.set((payload as { enabled: boolean }).enabled);
        break;

      case 'asciiResolution':
        asciiResolution.set((payload as { cellSize: number }).cellSize);
        break;

      default:
        console.log('[Client] Unknown action:', action);
    }
  };

  if (executeAt && sdk) {
    // Special efficient path for audio: use Web Audio scheduling
    if (action === 'modulateSound' || action === 'playSound') {
      const delayMs = sdk.getDelayUntil(executeAt);
      const delaySeconds = Math.max(0, delayMs / 1000);

      // Execute immediately but pass the Future Delay to the audio engine
      // This bypasses setTimeout jitter
      executeAction(delaySeconds);
    } else {
      // Standard scheduling for visual effects (setTimeout is fine)
      const { delay } = sdk.scheduleAt(executeAt, () => executeAction(0));
      if (delay < 0) {
        // Already past
        executeAction(0);
      }
    }
  } else {
    executeAction(0);
  }
}

/**
 * Handle plugin control messages
 */
function handlePluginControlMessage(message: PluginControlMessage): void {
  console.log('[Client] Plugin control:', message.pluginId, message.command);
  if (message.pluginId === 'node-executor') {
    nodeExecutor?.handlePluginControl(message);
    return;
  }
}

/**
 * Disconnect and cleanup
 */
export function disconnect(): void {
  sdk?.disconnect();
  sdk = null;
  // geolocation is handled by the start gate (page); keep permission state as-is.

  nodeExecutor?.destroy();
  nodeExecutor = null;

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
    stream.getTracks().forEach((track) => track.stop());
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
