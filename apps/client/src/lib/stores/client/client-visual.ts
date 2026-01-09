/**
 * Client visual-layer stores (scene selection, camera stream, post-processing effects).
 *
 * Keep this module free of SDK/runtime wiring so it can be reused by control executors.
 */

import { writable, get } from 'svelte/store';
import type { VisualEffect, VisualSceneLayerItem } from '@shugu/protocol';
import { clampNumber } from './client-utils';

// Current visual scene (legacy, kept for backward compatibility)
export const currentScene = writable<string>('box-scene');

// Independent scene enabled states (for multi-scene support)
export const boxSceneEnabled = writable<boolean>(true);
export const melSceneEnabled = writable<boolean>(false);
export const frontCameraEnabled = writable<boolean>(false);
export const backCameraEnabled = writable<boolean>(false);

// Visual scene layer applied on top of the visual layer (first -> last).
// Default keeps the legacy behavior (Box scene enabled by default).
export const visualScenes = writable<VisualSceneLayerItem[]>([{ type: 'box' }]);

function buildLegacyVisualScenes(): VisualSceneLayerItem[] {
  const scenes: VisualSceneLayerItem[] = [];

  if (get(boxSceneEnabled)) scenes.push({ type: 'box' });
  if (get(melSceneEnabled)) scenes.push({ type: 'mel' });

  // Camera is mutually exclusive; prefer the currently enabled one.
  if (get(frontCameraEnabled)) {
    scenes.push({ type: 'frontCamera' });
  } else if (get(backCameraEnabled)) {
    scenes.push({ type: 'backCamera' });
  }

  return scenes;
}

export function syncLegacyVisualScenes(): void {
  visualScenes.set(buildLegacyVisualScenes());
}

export function normalizeVisualScenesPayload(payload: unknown): VisualSceneLayerItem[] {
  const raw = payload && typeof payload === 'object' ? (payload as any).scenes : null;
  if (!Array.isArray(raw)) return [];

  const limited = raw.slice(0, 12);
  const out: VisualSceneLayerItem[] = [];

  for (const item of limited) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof (item as any).type === 'string' ? String((item as any).type) : '';
    if (type === 'box') {
      out.push({ type: 'box' });
      continue;
    }
    if (type === 'mel') {
      out.push({ type: 'mel' });
      continue;
    }
    if (type === 'frontCamera') {
      out.push({ type: 'frontCamera' });
      continue;
    }
    if (type === 'backCamera') {
      out.push({ type: 'backCamera' });
    }
  }

  // De-duplicate scene types, keeping the last occurrence so ordering is preserved.
  const deduped: VisualSceneLayerItem[] = [];
  const seen = new Set<string>();
  for (let i = out.length - 1; i >= 0; i--) {
    const entry = out[i]!;
    if (seen.has(entry.type)) continue;
    seen.add(entry.type);
    deduped.push(entry);
  }
  deduped.reverse();

  // Camera is mutually exclusive; keep only the last camera item if both appear.
  const lastCameraIndex = (() => {
    for (let i = deduped.length - 1; i >= 0; i--) {
      const t = deduped[i]!.type;
      if (t === 'frontCamera' || t === 'backCamera') return i;
    }
    return -1;
  })();

  if (lastCameraIndex >= 0) {
    const keep = deduped[lastCameraIndex]!.type;
    return deduped.filter((s) =>
      s.type === 'frontCamera' || s.type === 'backCamera' ? s.type === keep : true
    );
  }

  return deduped;
}

export function syncVisualScenesToLegacyStores(scenes: VisualSceneLayerItem[]): void {
  const list = Array.isArray(scenes) ? scenes : [];
  const types = new Set(list.map((s) => s.type));

  boxSceneEnabled.set(types.has('box'));
  melSceneEnabled.set(types.has('mel'));

  const lastCamera = (() => {
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]!.type;
      if (t === 'frontCamera' || t === 'backCamera') return t;
    }
    return null;
  })();

  const front = lastCamera === 'frontCamera';
  const back = lastCamera === 'backCamera';
  frontCameraEnabled.set(front);
  backCameraEnabled.set(back);

  if (front) {
    void startCameraStream('user');
  } else if (back) {
    void startCameraStream('environment');
  } else {
    stopCameraStream();
  }
}

// Camera stream state
export type CameraFacing = 'user' | 'environment' | null;
export const cameraStream = writable<MediaStream | null>(null);
export const cameraFacing = writable<CameraFacing>(null);

/**
 * Start camera stream with specified facing mode
 */
export async function startCameraStream(facingMode: 'user' | 'environment'): Promise<void> {
  // Stop any existing stream first
  stopCameraStream();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false,
    });
    cameraStream.set(stream);
    cameraFacing.set(facingMode);
    console.log(`[Camera] Started ${facingMode} camera`);
  } catch (error) {
    console.error('[Camera] Failed to start camera:', error);
    cameraStream.set(null);
    cameraFacing.set(null);
  }
}

/**
 * Stop camera stream and release resources
 */
export function stopCameraStream(): void {
  const stream = get(cameraStream);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    cameraStream.set(null);
    cameraFacing.set(null);
    console.log('[Camera] Stopped camera');
  }
}

// ASCII post-processing toggle (default on)
export const asciiEnabled = writable<boolean>(true);

// ASCII resolution (cell size in pixels)
export const asciiResolution = writable<number>(11);

export type ConvolutionPreset =
  | 'blur'
  | 'gaussianBlur'
  | 'sharpen'
  | 'edge'
  | 'emboss'
  | 'sobelX'
  | 'sobelY'
  | 'custom';

export type ConvolutionState = {
  enabled: boolean;
  preset: ConvolutionPreset;
  kernel: number[] | null;
  mix: number;
  bias: number;
  normalize: boolean;
  scale: number;
};

// Convolution post-processing config
export const convolution = writable<ConvolutionState>({
  enabled: false,
  preset: 'sharpen',
  kernel: null,
  mix: 1,
  bias: 0,
  normalize: true,
  scale: 0.5,
});

// Visual post-processing chain applied on top of the visual layer (first -> last).
// Default keeps the legacy behavior (ASCII on by default).
export const visualEffects = writable<VisualEffect[]>([{ type: 'ascii', cellSize: 11 }]);

function buildLegacyVisualEffects(): VisualEffect[] {
  const effects: VisualEffect[] = [];

  const conv = get(convolution);
  if (conv?.enabled) {
    effects.push({
      type: 'convolution',
      preset: conv.preset,
      ...(Array.isArray(conv.kernel) && conv.kernel.length === 9 ? { kernel: conv.kernel } : {}),
      mix: conv.mix,
      bias: conv.bias,
      normalize: conv.normalize,
      scale: conv.scale,
    });
  }

  const asciiOn = Boolean(get(asciiEnabled));
  if (asciiOn) {
    effects.push({
      type: 'ascii',
      cellSize: clampNumber(get(asciiResolution), 11, 1, 100),
    });
  }

  return effects;
}

export function syncLegacyVisualEffects(): void {
  visualEffects.set(buildLegacyVisualEffects());
}

export function normalizeVisualEffectsPayload(payload: unknown): VisualEffect[] {
  const raw = payload && typeof payload === 'object' ? (payload as any).effects : null;
  if (!Array.isArray(raw)) return [];
  const limited = raw.slice(0, 12);
  const out: VisualEffect[] = [];

  for (const item of limited) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof (item as any).type === 'string' ? String((item as any).type) : '';
    if (type === 'ascii') {
      const cellSize = clampNumber((item as any).cellSize, 11, 1, 100);
      out.push({ type: 'ascii', cellSize: Math.round(cellSize) });
      continue;
    }
    if (type === 'convolution') {
      const preset =
        typeof (item as any).preset === 'string' ? String((item as any).preset) : undefined;
      const kernel = Array.isArray((item as any).kernel)
        ? (item as any).kernel
            .map((n: unknown) => (typeof n === 'number' ? n : Number(n)))
            .filter((n: number) => Number.isFinite(n))
            .slice(0, 9)
        : undefined;

      out.push({
        type: 'convolution',
        ...(preset ? { preset: preset as any } : {}),
        ...(kernel && kernel.length === 9 ? { kernel } : {}),
        mix: clampNumber((item as any).mix, 1, 0, 1),
        bias: clampNumber((item as any).bias, 0, -1, 1),
        normalize: typeof (item as any).normalize === 'boolean' ? (item as any).normalize : true,
        scale: clampNumber((item as any).scale, 0.5, 0.1, 1),
      });
    }
  }

  return out;
}

export function syncVisualEffectsToLegacyStores(effects: VisualEffect[]): void {
  const list = Array.isArray(effects) ? effects : [];
  const firstAscii = list.find((e) => e.type === 'ascii') as
    | Extract<VisualEffect, { type: 'ascii' }>
    | undefined;
  const firstConv = list.find((e) => e.type === 'convolution') as
    | Extract<VisualEffect, { type: 'convolution' }>
    | undefined;

  asciiEnabled.set(Boolean(firstAscii));
  if (firstAscii) {
    asciiResolution.set(clampNumber(firstAscii.cellSize, 11, 1, 100));
  }

  convolution.update((prev) => {
    const next: ConvolutionState = { ...prev, enabled: Boolean(firstConv) };
    if (!firstConv) return next;

    if (typeof firstConv.preset === 'string') {
      next.preset = firstConv.preset as ConvolutionPreset;
    }

    if (Array.isArray(firstConv.kernel) && firstConv.kernel.length === 9) {
      next.kernel = firstConv.kernel.slice(0, 9);
    } else {
      next.kernel = null;
    }

    next.mix = clampNumber(firstConv.mix, next.mix, 0, 1);
    next.bias = clampNumber(firstConv.bias, next.bias, -1, 1);
    next.normalize =
      typeof firstConv.normalize === 'boolean' ? firstConv.normalize : next.normalize;
    next.scale = clampNumber(firstConv.scale, next.scale, 0.1, 1);

    return next;
  });
}
