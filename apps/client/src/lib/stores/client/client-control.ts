/**
 * Client-side control executor for Manager->Client Control and PluginControl messages.
 *
 * This module is deliberately "runtime-agnostic": it receives SDK/controllers via getters so
 * the store entrypoint can own lifecycle concerns (init/disconnect).
 */

import { get } from 'svelte/store';
import type {
  ClientSDK,
  FlashlightController,
  NodeExecutor,
  ScreenController,
  SensorManager,
  ToneModulatedSoundPlayer,
  ToneSoundPlayer,
  VibrationController,
} from '@shugu/sdk-client';
import type { MultimediaCore } from '@shugu/multimedia-core';
import type {
  ControlAction,
  ControlBatchPayload,
  ControlMessage,
  ControlPayload,
  ConvolutionPayload,
  FlashlightPayload,
  ModulateSoundPayload,
  PlayMediaPayload,
  PlaySoundPayload,
  PluginControlMessage,
  ScreenColorPayload,
  ShowImagePayload,
  VibratePayload,
  VisualEffectsPayload,
  VisualSceneBackCameraPayload,
  VisualSceneBoxPayload,
  VisualSceneFrontCameraPayload,
  VisualSceneMelPayload,
  VisualScenesPayload,
  VisualSceneSwitchPayload,
} from '@shugu/protocol';
import { parseMediaClipParams } from './client-media';
import { handlePushImageUpload, type PushImageUploadPayload } from './client-screenshot';
import {
  asciiEnabled,
  asciiResolution,
  backCameraEnabled,
  boxSceneEnabled,
  convolution,
  currentScene,
  frontCameraEnabled,
  melSceneEnabled,
  normalizeVisualEffectsPayload,
  normalizeVisualScenesPayload,
  startCameraStream,
  stopCameraStream,
  syncLegacyVisualEffects,
  syncLegacyVisualScenes,
  syncVisualEffectsToLegacyStores,
  syncVisualScenesToLegacyStores,
  visualEffects,
  visualScenes,
  type ConvolutionPreset,
  type ConvolutionState,
} from './client-visual';

export type ClientControlDeps = {
  getSDK: () => ClientSDK | null;
  getSensorManager: () => SensorManager | null;
  getFlashlightController: () => FlashlightController | null;
  getScreenController: () => ScreenController | null;
  getVibrationController: () => VibrationController | null;
  getToneSoundPlayer: () => ToneSoundPlayer | null;
  getToneModulatedSoundPlayer: () => ToneModulatedSoundPlayer | null;
  getNodeExecutor: () => NodeExecutor | null;
  getMultimediaCore: () => MultimediaCore | null;
};

function isControlBatchPayload(payload: ControlPayload): payload is ControlBatchPayload {
  if (!payload || typeof payload !== 'object') return false;
  if ((payload as any).kind !== 'control-batch') return false;
  return Array.isArray((payload as any).items);
}

export function createClientControlHandlers(deps: ClientControlDeps): {
  handleControlMessage: (message: ControlMessage) => void;
  handlePluginControlMessage: (message: PluginControlMessage) => void;
  executeControl: (action: ControlAction, payload: ControlPayload, executeAt?: number) => void;
} {
  function executeControl(action: ControlAction, payload: ControlPayload, executeAt?: number): void {
    // Expand control batches early so we don't schedule the wrapper message (avoid double scheduling).
    if (action === 'custom' && isControlBatchPayload(payload)) {
      const batch = payload as ControlBatchPayload;
      const batchExecuteAt =
        typeof batch.executeAt === 'number' && Number.isFinite(batch.executeAt)
          ? batch.executeAt
          : executeAt;

      for (const raw of batch.items) {
        if (!raw || typeof raw !== 'object') continue;
        const itemAction = (raw as any).action as ControlAction | undefined;
        if (!itemAction) continue;
        const itemPayload = ((raw as any).payload ?? {}) as ControlPayload;
        const itemExecuteAtRaw = (raw as any).executeAt;
        const itemExecuteAt =
          typeof itemExecuteAtRaw === 'number' && Number.isFinite(itemExecuteAtRaw)
            ? itemExecuteAtRaw
            : batchExecuteAt;
        executeControl(itemAction, itemPayload, itemExecuteAt);
      }
      return;
    }

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
          deps.getFlashlightController()?.setMode(payload as FlashlightPayload);
          break;

        case 'screenColor':
          deps.getScreenController()?.setColor(payload as ScreenColorPayload);
          break;

        case 'screenBrightness':
          {
            const brightness = (payload as { brightness: number }).brightness;
            deps.getScreenController()?.setBrightness(brightness);
          }
          break;

        case 'vibrate':
          deps.getVibrationController()?.vibrate(payload as VibratePayload);
          break;

        case 'modulateSound':
          deps.getToneModulatedSoundPlayer()?.play(payload as ModulateSoundPayload, delaySeconds);
          break;
        case 'modulateSoundUpdate':
          deps.getToneModulatedSoundPlayer()?.update({
            frequency: (payload as ModulateSoundPayload).frequency,
            volume: (payload as ModulateSoundPayload).volume,
            waveform: (payload as ModulateSoundPayload).waveform,
            modFrequency: (payload as ModulateSoundPayload).modFrequency,
            modDepth: (payload as ModulateSoundPayload).modDepth,
            durationMs: (payload as any).durationMs ?? (payload as ModulateSoundPayload).duration,
          });
          break;

        case 'playSound':
          {
            const soundPayload = payload as PlaySoundPayload;
            const multimediaCore = deps.getMultimediaCore();
            const url =
              typeof soundPayload.url === 'string'
                ? (multimediaCore?.resolveAssetRef(soundPayload.url) ?? soundPayload.url)
                : soundPayload.url;
            // Always go through ToneSoundPlayer; it has an internal HTMLAudio fallback path.
            deps.getToneSoundPlayer()?.play({ ...soundPayload, url }, delaySeconds);
          }
          break;

        case 'playMedia': {
          const mediaPayload = payload as PlayMediaPayload;
          const multimediaCore = deps.getMultimediaCore();
          const clip =
            typeof mediaPayload.url === 'string' ? parseMediaClipParams(mediaPayload.url) : null;
          const baseUrl = clip ? clip.baseUrl : mediaPayload.url;
          const resolvedUrl =
            typeof baseUrl === 'string'
              ? (multimediaCore?.resolveAssetRef(baseUrl) ?? baseUrl)
              : baseUrl;
          // Check if it's a video by extension or explicit type
          const resolvedUrlString =
            typeof resolvedUrl === 'string' ? resolvedUrl : String(resolvedUrl ?? '');
          const isVideo =
            mediaPayload.mediaType === 'video' ||
            /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(resolvedUrlString);

          if (isVideo) {
            const loop = clip?.loop ?? mediaPayload.loop ?? false;
            const playing = clip?.play ?? Boolean(resolvedUrlString);
            const startSec = clip ? Math.max(0, clip.startSec) : 0;
            const endSec = clip ? clip.endSec : -1;
            const cursorSec = clip?.cursorSec ?? -1;
            const reverse = clip?.reverse ?? false;
            const fit = clip?.fit ?? null;
            multimediaCore?.media.playVideo({
              url: resolvedUrlString,
              sourceNodeId: clip?.sourceNodeId ?? null,
              muted: mediaPayload.muted ?? true,
              loop,
              volume: mediaPayload.volume ?? 1,
              playing,
              startSec,
              endSec,
              cursorSec,
              reverse,
              ...(fit === null ? {} : { fit }),
            });
          } else {
            // Audio path: prefer ToneSoundPlayer when enabled; fallback to legacy SoundPlayer otherwise.
            const audioPayload = {
              url: resolvedUrl,
              volume: mediaPayload.volume,
              loop: mediaPayload.loop,
              fadeIn: mediaPayload.fadeIn,
            };
            void deps
              .getToneSoundPlayer()
              ?.update(audioPayload as any, delaySeconds)
              .then((updated) => {
                if (updated) return;
                return deps.getToneSoundPlayer()?.play(audioPayload as any, delaySeconds);
              })
              .catch(() => undefined);
          }
          break;
        }

        case 'stopMedia':
          deps.getMultimediaCore()?.media.stopVideo();
          deps.getToneSoundPlayer()?.stop();
          break;

        case 'stopSound':
          deps.getToneSoundPlayer()?.stop();
          deps.getToneModulatedSoundPlayer()?.stop();
          break;

        case 'showImage': {
          const imagePayload = payload as ShowImagePayload;
          const multimediaCore = deps.getMultimediaCore();
          const clip =
            typeof imagePayload.url === 'string' ? parseMediaClipParams(imagePayload.url) : null;
          const baseUrl = clip ? clip.baseUrl : imagePayload.url;
          const url =
            typeof baseUrl === 'string'
              ? (multimediaCore?.resolveAssetRef(baseUrl) ?? baseUrl)
              : baseUrl;
          const fit = clip?.fit ?? null;
          const scale = clip?.scale ?? null;
          const offsetX = clip?.offsetX ?? null;
          const offsetY = clip?.offsetY ?? null;
          const opacity = clip?.opacity ?? null;
          multimediaCore?.media.showImage({
            url: String(url ?? ''),
            duration: imagePayload.duration,
            ...(fit === null ? {} : { fit }),
            ...(scale === null ? {} : { scale }),
            ...(offsetX === null ? {} : { offsetX }),
            ...(offsetY === null ? {} : { offsetY }),
            ...(opacity === null ? {} : { opacity }),
          });
          break;
        }

        case 'hideImage':
          deps.getMultimediaCore()?.media.hideImage();
          break;

        case 'visualSceneSwitch':
          {
            const scenePayload = payload as VisualSceneSwitchPayload;
            currentScene.set(scenePayload.sceneId);
            // Also update individual scene states for backward compatibility
            if (scenePayload.sceneId === 'box-scene') {
              boxSceneEnabled.set(true);
              melSceneEnabled.set(false);
            } else if (scenePayload.sceneId === 'mel-scene') {
              boxSceneEnabled.set(false);
              melSceneEnabled.set(true);
            }
            syncLegacyVisualScenes();
          }
          break;

        case 'visualSceneBox':
          {
            const boxPayload = payload as VisualSceneBoxPayload;
            boxSceneEnabled.set(boxPayload.enabled);
            syncLegacyVisualScenes();
          }
          break;

        case 'visualSceneMel':
          {
            const melPayload = payload as VisualSceneMelPayload;
            melSceneEnabled.set(melPayload.enabled);
            syncLegacyVisualScenes();
          }
          break;

        case 'visualSceneFrontCamera':
          {
            const camPayload = payload as VisualSceneFrontCameraPayload;
            frontCameraEnabled.set(camPayload.enabled);
            if (camPayload.enabled) {
              // Stop back camera if it's running
              backCameraEnabled.set(false);
              void startCameraStream('user');
            } else {
              // Only stop if no other camera is enabled
              if (!get(backCameraEnabled)) {
                stopCameraStream();
              }
            }
            syncLegacyVisualScenes();
          }
          break;

        case 'visualSceneBackCamera':
          {
            const camPayload = payload as VisualSceneBackCameraPayload;
            backCameraEnabled.set(camPayload.enabled);
            if (camPayload.enabled) {
              // Stop front camera if it's running
              frontCameraEnabled.set(false);
              void startCameraStream('environment');
            } else {
              // Only stop if no other camera is enabled
              if (!get(frontCameraEnabled)) {
                stopCameraStream();
              }
            }
            syncLegacyVisualScenes();
          }
          break;

        case 'visualScenes':
          {
            const scenes = normalizeVisualScenesPayload(payload as VisualScenesPayload);
            visualScenes.set(scenes);
            syncVisualScenesToLegacyStores(scenes);
          }
          break;

        case 'setDataReportingRate':
          {
            const ratePayload = payload as { sensorHz?: number };
            if (deps.getSensorManager() && ratePayload.sensorHz) {
              deps.getSensorManager()?.setThrottleMs(1000 / ratePayload.sensorHz);
            }
          }
          break;

        case 'setSensorState':
          {
            const sensorStatePayload = payload as { active: boolean };
            if (deps.getSensorManager()) {
              if (sensorStatePayload.active) {
                deps.getSensorManager()?.start();
              } else {
                deps.getSensorManager()?.stop();
              }
            }
          }
          break;

        case 'asciiMode':
          asciiEnabled.set((payload as { enabled: boolean }).enabled);
          syncLegacyVisualEffects();
          break;

        case 'asciiResolution':
          asciiResolution.set((payload as { cellSize: number }).cellSize);
          syncLegacyVisualEffects();
          break;

        case 'visualEffects':
          {
            const effects = normalizeVisualEffectsPayload(payload as VisualEffectsPayload);
            visualEffects.set(effects);
            syncVisualEffectsToLegacyStores(effects);
          }
          break;

        case 'convolution':
          {
            const convPayload = payload as ConvolutionPayload;
            const allowed: ConvolutionPreset[] = [
              'blur',
              'gaussianBlur',
              'sharpen',
              'edge',
              'emboss',
              'sobelX',
              'sobelY',
              'custom',
            ];

            convolution.update((prev) => {
              const next: ConvolutionState = { ...prev };

              if (typeof convPayload.enabled === 'boolean') {
                next.enabled = convPayload.enabled;
              }

              const presetCandidate =
                typeof convPayload.preset === 'string' &&
                allowed.includes(convPayload.preset as ConvolutionPreset)
                  ? (convPayload.preset as ConvolutionPreset)
                  : null;

              if (presetCandidate) {
                next.preset = presetCandidate;
              }

              if (Array.isArray(convPayload.kernel)) {
                const kernel = convPayload.kernel
                  .map((n) => (typeof n === 'number' ? n : Number(n)))
                  .filter((n) => Number.isFinite(n))
                  .slice(0, 9);
                next.kernel = kernel.length === 9 ? kernel : null;
              } else if (presetCandidate) {
                // Avoid stale kernel overriding preset kernels when the preset changes.
                next.kernel = null;
              }

              if (typeof convPayload.mix === 'number' && Number.isFinite(convPayload.mix)) {
                next.mix = Math.max(0, Math.min(1, convPayload.mix));
              }

              if (typeof convPayload.bias === 'number' && Number.isFinite(convPayload.bias)) {
                next.bias = Math.max(-1, Math.min(1, convPayload.bias));
              }

              if (typeof convPayload.normalize === 'boolean') {
                next.normalize = convPayload.normalize;
              }

              if (typeof convPayload.scale === 'number' && Number.isFinite(convPayload.scale)) {
                next.scale = Math.max(0.1, Math.min(1, convPayload.scale));
              }

              return next;
            });

            syncLegacyVisualEffects();
          }
          break;

        case 'custom':
          {
            const raw = payload as Partial<PushImageUploadPayload> | null;
            if (raw && typeof raw === 'object' && raw.kind === 'push-image-upload') {
              console.info('[Client] push-image-upload requested', {
                seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : null,
                speed:
                  typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : null,
                format: typeof raw.format === 'string' ? raw.format : null,
                quality:
                  typeof raw.quality === 'number' && Number.isFinite(raw.quality)
                    ? raw.quality
                    : null,
                maxWidth:
                  typeof raw.maxWidth === 'number' && Number.isFinite(raw.maxWidth)
                    ? raw.maxWidth
                    : null,
              });
              void handlePushImageUpload(deps.getSDK(), raw as PushImageUploadPayload);
              break;
            }
            console.log('[Client] Unknown custom payload:', payload);
          }
          break;

        default:
          console.log('[Client] Unknown action:', action);
      }
    };

    const sdkNow = deps.getSDK();
    if (executeAt && sdkNow) {
      // Special efficient path for audio: use Web Audio scheduling
      const shouldUseAudioScheduling =
        action === 'modulateSound' ||
        action === 'playSound' ||
        (action === 'playMedia' &&
          (() => {
            const mediaType = (payload as any)?.mediaType;
            if (mediaType === 'video') return false;
            const rawUrl = (payload as any)?.url;
            const url = typeof rawUrl === 'string' ? rawUrl : String(rawUrl ?? '');
            return !/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(url);
          })());

      if (shouldUseAudioScheduling) {
        const delayMs = sdkNow.getDelayUntil(executeAt);
        const delaySeconds = Math.max(0, delayMs / 1000);

        // Execute immediately but pass the Future Delay to the audio engine
        // This bypasses setTimeout jitter
        executeAction(delaySeconds);
      } else {
        // Standard scheduling for visual effects (setTimeout is fine)
        const { cancel, delay } = sdkNow.scheduleAt(executeAt, () => executeAction(0));
        if (delay < 0) {
          // Already past: execute immediately and cancel the scheduled callback to avoid double execution.
          cancel();
          executeAction(0);
        }
      }
    } else {
      executeAction(0);
    }
  }

  function handleControlMessage(message: ControlMessage): void {
    // Calculate and log message size
    try {
      const messageJson = JSON.stringify(message);
      const messageSizeBytes = new Blob([messageJson]).size;
      const messageSizeKB = (messageSizeBytes / 1024).toFixed(2);

      console.log(
        `[Message] Received ${message.action} | Size: ${messageSizeBytes} bytes (${messageSizeKB} KB)`
      );
    } catch (err) {
      console.warn('[Message] Failed to calculate message size:', err);
    }

    executeControl(message.action, message.payload, message.executeAt);
  }

  function handlePluginControlMessage(message: PluginControlMessage): void {
    // Calculate and log message size
    try {
      const messageJson = JSON.stringify(message);
      const messageSizeBytes = new Blob([messageJson]).size;
      const messageSizeKB = (messageSizeBytes / 1024).toFixed(2);

      console.log(
        `[Plugin] ${message.pluginId} ${message.command} | Size: ${messageSizeBytes} bytes (${messageSizeKB} KB)`
      );
    } catch (err) {
      console.log('[Client] Plugin control:', message.pluginId, message.command);
    }

    if (message.pluginId === 'node-executor') {
      deps.getNodeExecutor()?.handlePluginControl(message);
      return;
    }
    if (message.pluginId === 'multimedia-core' && message.command === 'configure') {
      const payload: any = message.payload ?? {};
      const manifestId = typeof payload.manifestId === 'string' ? payload.manifestId : '';
      const assets = Array.isArray(payload.assets) ? payload.assets.map(String) : [];
      const updatedAt =
        typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt)
          ? payload.updatedAt
          : undefined;
      if (!manifestId) return;
      deps.getMultimediaCore()?.setAssetManifest({ manifestId, assets, updatedAt });
      return;
    }
  }

  return { handleControlMessage, handlePluginControlMessage, executeControl };
}
