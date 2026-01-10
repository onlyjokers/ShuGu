<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    melSceneEnabled,
    cameraStream,
    frontCameraEnabled,
    backCameraEnabled,
    audioStream,
    visualScenes,
    visualEffects,
    videoState,
    imageState,
    getSDK,
    connectionStatus,
  } from '$lib/stores/client';
  import { VideoPlayer } from '@shugu/ui-kit';
  import ImageDisplay from '$lib/components/ImageDisplay.svelte';
  import {
    BoxScene,
    MelSpectrogramScene,
    DefaultSceneManager,
    type VisualContext,
  } from '@shugu/visual-plugins';
  import { toneAudioEngine } from '@shugu/multimedia-core';
  import {
    AudioSplitPlugin,
    MelSpectrogramPlugin,
    type AudioSplitFeature,
    type MelSpectrogramFeature,
  } from '@shugu/audio-plugins';
  import {
    applyConvolution3x3,
    resolveConvolutionKernel,
  } from '$lib/features/convolution/convolution';

  let container: HTMLElement;
  let sceneManager: DefaultSceneManager | null = null;
  let effectCanvas: HTMLCanvasElement;
  let splitPlugin: AudioSplitPlugin | null = null;
  let melPlugin: MelSpectrogramPlugin | null = null;
  let audioContext: AudioContext | null = null;
  let animationId: number;
  let effectCtx: CanvasRenderingContext2D | null = null;
  let frameA: HTMLCanvasElement | null = null;
  let frameACtx: CanvasRenderingContext2D | null = null;
  let frameB: HTMLCanvasElement | null = null;
  let frameBCtx: CanvasRenderingContext2D | null = null;
  let tinyCanvas: HTMLCanvasElement | null = null;
  let tinyCtx: CanvasRenderingContext2D | null = null;
  let convWorkCanvas: HTMLCanvasElement | null = null;
  let convWorkCtx: CanvasRenderingContext2D | null = null;
  let convOutput: ImageData | null = null;
  let convWorkW = 0;
  let convWorkH = 0;
  let lastEffectDraw = 0;
  let lastEffectsSignature = '';
  let baseVisible = true;
  let lastTime = 0;
  let cameraVideoElement: HTMLVideoElement;

  // Current context data for scene updates
  let context: VisualContext = {};

  // Device orientation data
  let orientationData = { alpha: 0, beta: 0, gamma: 0, screen: 0 };

  function reportVideoStarted(nodeId: string): void {
    const sdk = getSDK();
    if (!sdk) return;
    if (!nodeId) return;
    try {
      sdk.sendSensorData(
        'custom',
        {
          kind: 'node-media',
          event: 'started',
          nodeId,
          nodeType: 'load-video-from-assets',
        } as any,
        { trackLatest: false }
      );
    } catch {
      // ignore
    }
  }

  onMount(() => {
    // Create scene manager
    sceneManager = new DefaultSceneManager(container);

    // Register scenes (base visuals)
    sceneManager.register(new BoxScene());
    sceneManager.register(new MelSpectrogramScene());

    // Effect pipeline setup
    effectCtx = effectCanvas.getContext('2d');
    frameA = document.createElement('canvas');
    frameACtx = frameA.getContext('2d');
    frameB = document.createElement('canvas');
    frameBCtx = frameB.getContext('2d');
    tinyCanvas = document.createElement('canvas');
    tinyCtx = tinyCanvas.getContext('2d', { willReadFrequently: true });
    convWorkCanvas = document.createElement('canvas');
    convWorkCtx = convWorkCanvas.getContext('2d', { willReadFrequently: true });
    handleResize();

    // Set up device orientation listener
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('resize', handleResize);

    // Start animation loop
    lastTime = performance.now();
    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('deviceorientation', handleOrientation);
    window.removeEventListener('resize', handleResize);
    sceneManager?.destroy();
    splitPlugin?.destroy();
    melPlugin?.destroy();
    splitPlugin = null;
    melPlugin = null;
    audioContext = null;
  });

  // React to visual scene layer changes
  $: if (sceneManager) {
    applySceneLayer($visualScenes);
  }

  // Bind camera stream to video element
  $: if (cameraVideoElement && $cameraStream) {
    cameraVideoElement.srcObject = $cameraStream;
  } else if (cameraVideoElement && !$cameraStream) {
    cameraVideoElement.srcObject = null;
  }

  // React to audio stream changes
  $: if ($audioStream && !audioContext) {
    setupAudioPipeline($audioStream);
  }

  async function setupAudioPipeline(stream: MediaStream) {
    try {
      const mod = await toneAudioEngine.ensureLoaded();
      const Tone: any = (mod as any).default ?? mod;
      const raw: AudioContext | null = Tone.getContext?.().rawContext ?? null;
      if (!raw) {
        console.warn(
          '[VisualCanvas] Tone context not available; skipping audio analysis pipeline.'
        );
        return;
      }

      audioContext = raw;
      try {
        if (audioContext.state === 'suspended') await audioContext.resume();
      } catch {
        // ignore
      }
      const source = audioContext.createMediaStreamSource(stream);

      splitPlugin = new AudioSplitPlugin();
      melPlugin = new MelSpectrogramPlugin({ melBands: 64, frameRate: 30 });

      await Promise.all([
        splitPlugin.init(audioContext, source),
        melPlugin.init(audioContext, source, { melBands: 64, frameRate: 30 }),
      ]);

      const updateAudioFeatures = (partial: Partial<VisualContext['audioFeatures']>) => {
        context.audioFeatures = { ...(context.audioFeatures ?? {}), ...partial };
      };

      splitPlugin.onFeature((feature: AudioSplitFeature) => {
        updateAudioFeatures({
          rms: feature.rms,
          lowEnergy: feature.lowEnergy,
          midEnergy: feature.midEnergy,
          highEnergy: feature.highEnergy,
          bpm: feature.bpm,
          beatDetected: feature.beatDetected,
        });

        // Send audio features to server
        const sdk = getSDK();
        if (sdk) {
          sdk.sendSensorData('mic', {
            volume: feature.rms,
            lowEnergy: feature.lowEnergy,
            highEnergy: feature.highEnergy,
            bpm: feature.bpm,
          });
        }
      });

      melPlugin.onFeature((feature: MelSpectrogramFeature) => {
        updateAudioFeatures({
          melBands: feature.melBands,
          rms: feature.rms,
          spectralCentroid: feature.spectralCentroid,
        });
      });

      splitPlugin.start();
      melPlugin.start();
    } catch (error) {
      console.error('[VisualCanvas] Failed to setup audio pipeline:', error);
      splitPlugin?.destroy();
      melPlugin?.destroy();
      splitPlugin = null;
      melPlugin = null;
      audioContext?.close();
      audioContext = null;
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const screen =
      typeof window.orientation === 'number'
        ? (window.orientation as number)
        : (window.screen.orientation?.angle ?? 0);

    orientationData = {
      alpha: event.alpha ?? 0,
      beta: event.beta ?? 0,
      gamma: event.gamma ?? 0,
      screen,
    };
    context.orientation = orientationData;
  }

  function animate() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000; // Convert to seconds
    lastTime = now;

    sceneManager?.update(dt, context);

    const effects = Array.isArray($visualEffects) ? $visualEffects : [];
    if (effects.length > 0) {
      const ok = renderEffects(effects, now);
      setBaseLayerVisibility(!ok);
      if (effectCanvas) effectCanvas.style.visibility = ok ? 'visible' : 'hidden';
    } else {
      setBaseLayerVisibility(true);
      if (effectCanvas) effectCanvas.style.visibility = 'hidden';
    }

    animationId = requestAnimationFrame(animate);
  }

  type MediaFit = 'contain' | 'fit-screen' | 'cover' | 'fill';

  function getFittedDrawParams(
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    fit: MediaFit
  ): {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  } {
    if (fit === 'fill') {
      return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
    }

    if (fit === 'cover') {
      const scale = Math.max(dstW / srcW, dstH / srcH);
      const sw = dstW / scale;
      const sh = dstH / scale;
      const sx = (srcW - sw) / 2;
      const sy = (srcH - sh) / 2;
      return { sx, sy, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
    }

    // contain: preserve aspect ratio and don't scale up beyond 1x (real size when possible).
    // fit-screen: preserve aspect ratio and scale up to fit the screen.
    const scale =
      fit === 'fit-screen'
        ? Math.min(dstW / srcW, dstH / srcH)
        : Math.min(1, dstW / srcW, dstH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = (dstW - dw) / 2;
    const dy = (dstH - dh) / 2;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx, dy, dw, dh };
  }

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

  function applySceneLayer(scenes: unknown[]): void {
    if (!sceneManager) return;

    const list = Array.isArray(scenes) ? scenes : [];
    const desiredSceneIds: string[] = [];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const type = typeof (item as any).type === 'string' ? String((item as any).type) : '';
      if (type === 'box') desiredSceneIds.push('box-scene');
      if (type === 'mel') desiredSceneIds.push('mel-scene');
    }

    const enabled = new Set(desiredSceneIds);
    sceneManager.setSceneEnabled('box-scene', enabled.has('box-scene'));
    sceneManager.setSceneEnabled('mel-scene', enabled.has('mel-scene'));

    // Best-effort: keep DOM canvas order in sync with the scene chain.
    reorderSceneCanvases(desiredSceneIds);
  }

  function reorderSceneCanvases(sceneIds: string[]): void {
    if (!container || !effectCanvas) return;

    for (const id of sceneIds) {
      const canvas = container.querySelector(
        `canvas[data-shugu-scene-id="${id}"]`
      ) as HTMLCanvasElement | null;
      if (!canvas) continue;

      try {
        container.insertBefore(canvas, effectCanvas);
      } catch {
        // ignore
      }
    }
  }

  function setBaseLayerVisibility(show: boolean) {
    if (!container) return;
    if (baseVisible === show) return;
    baseVisible = show;

    const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[];
    for (const c of canvases) {
      if (c === effectCanvas) continue;
      c.style.visibility = show ? 'visible' : 'hidden';
    }

    const overlays = Array.from(
      container.querySelectorAll('.video-overlay, .image-overlay, video.camera-display')
    ) as HTMLElement[];
    for (const el of overlays) {
      el.style.visibility = show ? 'visible' : 'hidden';
    }
  }

  function computeEffectTargetFps(effects: unknown[], width: number, height: number): number {
    let fps = 30;

    for (const effect of effects) {
      if (!effect || typeof effect !== 'object') continue;
      const type = typeof (effect as any).type === 'string' ? String((effect as any).type) : '';

      if (type === 'convolution') {
        const scale = clamp(Number((effect as any).scale ?? 0.5), 0.1, 1);
        let procW = Math.max(48, Math.floor(width * scale));
        let procH = Math.max(48, Math.floor(height * scale));

        const maxPixels = 260_000;
        const pixels = procW * procH;
        if (pixels > maxPixels) {
          const ratio = Math.sqrt(maxPixels / pixels);
          procW = Math.max(48, Math.floor(procW * ratio));
          procH = Math.max(48, Math.floor(procH * ratio));
        }

        const convFps = procW * procH > 180_000 ? 15 : 30;
        fps = Math.min(fps, convFps);
        continue;
      }

      if (type === 'ascii') {
        const cellSize = Math.max(
          1,
          Math.min(100, Math.round(Number((effect as any).cellSize ?? 11)))
        );
        const cols = Math.max(24, Math.floor(width / cellSize));
        const rows = Math.max(18, Math.floor(height / (cellSize * 1.05)));

        const cellCount = cols * rows;
        const asciiFps = (() => {
          if ($melSceneEnabled) return cellCount >= 12_000 ? 10 : 15;
          return cellCount >= 18_000 ? 15 : 30;
        })();
        fps = Math.min(fps, asciiFps);
      }
    }

    return Math.max(5, Math.min(60, fps));
  }

  function renderEffects(effects: unknown[], nowMs: number): boolean {
    if (!effectCtx || !frameA || !frameACtx || !frameB || !frameBCtx) return false;
    if (!tinyCanvas || !tinyCtx) return false;
    if (!convWorkCanvas || !convWorkCtx) return false;

    const width = container?.clientWidth ?? 0;
    const height = container?.clientHeight ?? 0;
    if (width === 0 || height === 0) return false;

    const signature = (() => {
      try {
        return JSON.stringify(effects);
      } catch {
        return '';
      }
    })();
    if (signature !== lastEffectsSignature) {
      lastEffectsSignature = signature;
      lastEffectDraw = 0;
    }

    const targetFps = computeEffectTargetFps(effects, width, height);
    if (nowMs - lastEffectDraw < 1000 / targetFps) return true;
    lastEffectDraw = nowMs;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(height * dpr);
    if (targetW === 0 || targetH === 0) return false;

    if (effectCanvas.width !== targetW) effectCanvas.width = targetW;
    if (effectCanvas.height !== targetH) effectCanvas.height = targetH;
    if (effectCanvas.style.width !== `${width}px`) effectCanvas.style.width = `${width}px`;
    if (effectCanvas.style.height !== `${height}px`) effectCanvas.style.height = `${height}px`;

    if (frameA.width !== targetW) frameA.width = targetW;
    if (frameA.height !== targetH) frameA.height = targetH;
    if (frameB.width !== targetW) frameB.width = targetW;
    if (frameB.height !== targetH) frameB.height = targetH;

    drawBaseFrame(frameACtx, width, height, dpr);

    let srcCanvas: HTMLCanvasElement = frameA;
    let srcCtx: CanvasRenderingContext2D = frameACtx;
    let dstCanvas: HTMLCanvasElement = frameB;
    let dstCtx: CanvasRenderingContext2D = frameBCtx;

    for (const effect of effects) {
      if (!effect || typeof effect !== 'object') continue;
      const type = typeof (effect as any).type === 'string' ? String((effect as any).type) : '';

      const applied = (() => {
        if (type === 'convolution')
          return applyConvolutionEffect(srcCanvas, dstCtx, width, height, dpr, effect as any);
        if (type === 'ascii')
          return applyAsciiEffect(srcCanvas, dstCtx, width, height, dpr, effect as any);
        return false;
      })();

      if (!applied) {
        // Best-effort fallback: pass-through when the effect can't run (e.g. canvas tainted by CORS).
        dstCtx.setTransform(1, 0, 0, 1, 0, 0);
        dstCtx.clearRect(0, 0, targetW, targetH);
        dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
      }

      // Swap buffers for the next pass.
      [srcCanvas, dstCanvas] = [dstCanvas, srcCanvas];
      [srcCtx, dstCtx] = [dstCtx, srcCtx];
    }

    effectCtx.setTransform(1, 0, 0, 1, 0, 0);
    effectCtx.clearRect(0, 0, targetW, targetH);
    effectCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    return true;
  }

  function drawBaseFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number
  ): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw any mounted scene canvases first (Box, Mel, ...).
    const sceneCanvases = Array.from(
      container?.querySelectorAll('canvas') ?? []
    ) as HTMLCanvasElement[];
    for (const c of sceneCanvases) {
      if (c === effectCanvas) continue;
      if (!c.width || !c.height) continue;
      try {
        ctx.drawImage(c, 0, 0, width, height);
      } catch {
        // ignore
      }
    }

    // Draw video (if any) on top of scenes.
    const video = container?.querySelector('.video-overlay video') as HTMLVideoElement | null;
    if (video && $videoState.url && video.readyState >= 2) {
      const srcW = video.videoWidth || 0;
      const srcH = video.videoHeight || 0;
      if (srcW > 0 && srcH > 0) {
        const fit = ($videoState.fit ?? 'contain') as MediaFit;
        const padding = fit === 'contain' ? 24 : 0;
        const dstW = Math.max(0, width - padding * 2);
        const dstH = Math.max(0, height - padding * 2);
        if (dstW > 0 && dstH > 0) {
          const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
            srcW,
            srcH,
            dstW,
            dstH,
            fit
          );
          try {
            ctx.drawImage(video, sx, sy, sw, sh, padding + dx, padding + dy, dw, dh);
          } catch {
            // cross-origin without CORS
          }
        }
      }
    }

    // Draw image (if any) on top of video.
    const img = container?.querySelector('.image-overlay img') as HTMLImageElement | null;
    if (img && $imageState.visible && $imageState.url) {
      const srcW = img.naturalWidth || img.clientWidth || 0;
      const srcH = img.naturalHeight || img.clientHeight || 0;
      if (srcW > 0 && srcH > 0) {
        const fit = ($imageState.fit ?? 'contain') as MediaFit;
        const padding = fit === 'contain' ? 24 : 0;
        const dstW = Math.max(0, width - padding * 2);
        const dstH = Math.max(0, height - padding * 2);
        if (dstW > 0 && dstH > 0) {
          const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
            srcW,
            srcH,
            dstW,
            dstH,
            fit
          );

          const scale = (() => {
            const raw = typeof $imageState.scale === 'number' ? $imageState.scale : 1;
            return Number.isFinite(raw) ? Math.max(0.1, Math.min(10, raw)) : 1;
          })();
          const offsetX = (() => {
            const raw = typeof $imageState.offsetX === 'number' ? $imageState.offsetX : 0;
            return Number.isFinite(raw) ? raw : 0;
          })();
          const offsetY = (() => {
            const raw = typeof $imageState.offsetY === 'number' ? $imageState.offsetY : 0;
            return Number.isFinite(raw) ? raw : 0;
          })();
          const opacity = (() => {
            const raw = typeof $imageState.opacity === 'number' ? $imageState.opacity : 1;
            return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
          })();

          const centerX = padding + dx + dw / 2;
          const centerY = padding + dy + dh / 2;
          const scaledW = dw * scale;
          const scaledH = dh * scale;
          const drawX = centerX - scaledW / 2 + offsetX;
          const drawY = centerY - scaledH / 2 + offsetY;

          try {
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, scaledW, scaledH);
            ctx.restore();
          } catch {
            // cross-origin without CORS
          }
        }
      }
    }

    // Draw camera on top (if enabled).
    if (
      cameraVideoElement &&
      $cameraStream &&
      ($frontCameraEnabled || $backCameraEnabled) &&
      cameraVideoElement.readyState >= 2
    ) {
      const srcW = cameraVideoElement.videoWidth || 0;
      const srcH = cameraVideoElement.videoHeight || 0;
      if (srcW > 0 && srcH > 0) {
        const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(
          srcW,
          srcH,
          width,
          height,
          'cover'
        );
        try {
          ctx.save();
          if ($frontCameraEnabled) {
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(cameraVideoElement, sx, sy, sw, sh, dx, dy, dw, dh);
          ctx.restore();
        } catch {
          // ignore
        }
      }
    }
  }

  function applyConvolutionEffect(
    src: HTMLCanvasElement,
    dstCtx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number,
    effect: {
      preset?: unknown;
      kernel?: unknown;
      mix?: unknown;
      bias?: unknown;
      normalize?: unknown;
      scale?: unknown;
    }
  ): boolean {
    if (!convWorkCanvas || !convWorkCtx) return false;

    const scale = clamp(Number(effect.scale ?? 0.5), 0.1, 1);
    let procW = Math.max(48, Math.floor(width * scale));
    let procH = Math.max(48, Math.floor(height * scale));

    const maxPixels = 260_000;
    const pixels = procW * procH;
    if (pixels > maxPixels) {
      const ratio = Math.sqrt(maxPixels / pixels);
      procW = Math.max(48, Math.floor(procW * ratio));
      procH = Math.max(48, Math.floor(procH * ratio));
    }

    if (convWorkW !== procW || convWorkH !== procH) {
      convWorkW = procW;
      convWorkH = procH;
      convWorkCanvas.width = procW;
      convWorkCanvas.height = procH;
      convOutput = convWorkCtx.createImageData(procW, procH);
    }

    try {
      convWorkCtx.setTransform(1, 0, 0, 1, 0, 0);
      convWorkCtx.drawImage(src, 0, 0, procW, procH);
    } catch {
      return false;
    }

    let input: ImageData;
    try {
      input = convWorkCtx.getImageData(0, 0, procW, procH);
    } catch {
      return false;
    }

    if (!convOutput) return false;

    const presetRaw = typeof effect.preset === 'string' ? effect.preset : 'sharpen';
    const preset = (() => {
      const allowed = [
        'blur',
        'gaussianBlur',
        'sharpen',
        'edge',
        'emboss',
        'sobelX',
        'sobelY',
        'custom',
      ];
      return allowed.includes(presetRaw) ? presetRaw : 'sharpen';
    })();
    const kernel = (() => {
      const raw = effect.kernel;
      if (!Array.isArray(raw)) return null;
      const parsed = raw
        .map((n) => (typeof n === 'number' ? n : Number(n)))
        .filter((n) => Number.isFinite(n))
        .slice(0, 9);
      return parsed.length === 9 ? parsed : null;
    })();

    const mix = clamp(Number(effect.mix ?? 1), 0, 1);
    const bias = clamp(Number(effect.bias ?? 0), -1, 1);
    const normalize = typeof effect.normalize === 'boolean' ? effect.normalize : true;

    const resolvedKernel = resolveConvolutionKernel(preset as any, kernel);
    applyConvolution3x3(input.data, procW, procH, convOutput.data, {
      kernel: resolvedKernel,
      mix,
      bias,
      normalize,
    });

    convWorkCtx.putImageData(convOutput, 0, 0);

    dstCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.fillStyle = '#0a0a0f';
    dstCtx.fillRect(0, 0, width, height);
    dstCtx.drawImage(convWorkCanvas, 0, 0, width, height);
    return true;
  }

  function applyAsciiEffect(
    src: HTMLCanvasElement,
    dstCtx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number,
    effect: { cellSize?: unknown }
  ): boolean {
    if (!tinyCtx || !tinyCanvas) return false;

    const cellSize = Math.max(1, Math.min(100, Math.round(Number(effect.cellSize ?? 11))));
    const cols = Math.max(24, Math.floor(width / cellSize));
    const rows = Math.max(18, Math.floor(height / (cellSize * 1.05)));

    if (tinyCanvas.width !== cols) tinyCanvas.width = cols;
    if (tinyCanvas.height !== rows) tinyCanvas.height = rows;

    try {
      tinyCtx.drawImage(src, 0, 0, cols, rows);
    } catch {
      // Cross-origin or invalid source; skip this frame
      return false;
    }

    let data: Uint8ClampedArray;
    try {
      data = tinyCtx.getImageData(0, 0, cols, rows).data;
    } catch {
      // Canvas tainted (likely cross-origin media without CORS)
      return false;
    }

    dstCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dstCtx.fillStyle = '#0a0a0f';
    dstCtx.fillRect(0, 0, width, height);
    dstCtx.textAlign = 'center';
    dstCtx.textBaseline = 'middle';
    const fontSize = Math.max(9, Math.round(height / rows));
    dstCtx.font = `${fontSize}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

    const ramp = ['.', '`', ',', ':', ';', '-', '~', '+', '*', 'x', 'o', 'O', '%', '#', '@'];
    const strokes = ['/', '\\', '|', '-', '='];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3] / 255;
        if (a === 0) continue;

        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (brightness < 0.08) continue; // deep black stays empty

        const posX = (x + 0.5) * (width / cols);
        const posY = (y + 0.5) * (height / rows);

        // bright -> solid block
        if (brightness >= 0.82) {
          dstCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.94)`;
          dstCtx.fillRect(
            posX - width / cols / 2,
            posY - height / rows / 2,
            width / cols + 0.75,
            height / rows + 0.75
          );
          continue;
        }

        const glyphIndex =
          brightness > 0.62
            ? Math.floor((x + y) % strokes.length)
            : Math.min(ramp.length - 1, Math.floor(brightness * ramp.length));
        const glyph = brightness > 0.62 ? strokes[glyphIndex] : ramp[glyphIndex];

        const alpha = 0.35 + brightness * 0.55;
        dstCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
        dstCtx.fillText(glyph, posX, posY);
      }
    }

    drawBorder(dstCtx, width, height, cols, rows);
    return true;
  }

  function drawBorder(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cols: number,
    rows: number
  ) {
    let edgeColor = 'rgba(255, 228, 210, 0.55)';

    if ($connectionStatus !== 'connected') {
      const t = performance.now() / 1000;
      // Pulsing red effect: alpha oscillates between 0.3 and 1.0
      const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3));
      edgeColor = `rgba(239, 68, 68, ${alpha})`;
    }

    ctx.fillStyle = edgeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const charW = width / cols;
    const charH = height / rows;
    ctx.font = `${Math.max(10, Math.round(charH * 0.95))}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

    const topChars = ['=', '-', '='];
    const sideChars = ['|', '!', '|'];

    for (let c = 0; c < cols; c++) {
      const ch = topChars[c % topChars.length];
      const x = c * charW + charW / 2;
      ctx.fillText(ch, x, charH * 0.55);
      ctx.fillText(ch, x, height - charH * 0.45);
    }

    for (let r = 0; r < rows; r++) {
      const ch = sideChars[r % sideChars.length];
      const y = r * charH + charH / 2;
      ctx.fillText(ch, charW * 0.45, y);
      ctx.fillText(ch, width - charW * 0.45, y);
    }

    ctx.fillText('+', charW * 0.45, charH * 0.55);
    ctx.fillText('+', width - charW * 0.45, charH * 0.55);
    ctx.fillText('+', charW * 0.45, height - charH * 0.45);
    ctx.fillText('+', width - charW * 0.45, height - charH * 0.45);
  }

  function handleResize() {
    lastEffectDraw = 0;
    lastEffectsSignature = '';
    convWorkW = 0;
    convWorkH = 0;
    convOutput = null;
  }
</script>

<div class="visual-container" bind:this={container}>
  <!-- Video Player (base visual layer) -->
  {#if $videoState.url}
    <VideoPlayer
      url={$videoState.url}
      playing={$videoState.playing}
      muted={$videoState.muted}
      loop={$videoState.loop}
      volume={$videoState.volume}
      startSec={$videoState.startSec}
      endSec={$videoState.endSec}
      cursorSec={$videoState.cursorSec}
      reverse={$videoState.reverse}
      fit={$videoState.fit}
      sourceNodeId={$videoState.sourceNodeId}
      onStarted={reportVideoStarted}
    />
  {/if}

  <!-- Image Display (base visual layer) -->
  {#if $imageState.url && $imageState.visible}
    <ImageDisplay
      url={$imageState.url}
      duration={$imageState.duration}
      fit={$imageState.fit}
      scale={$imageState.scale}
      offsetX={$imageState.offsetX}
      offsetY={$imageState.offsetY}
      opacity={$imageState.opacity}
    />
  {/if}

  <!-- Camera Display -->
  {#if $cameraStream && ($frontCameraEnabled || $backCameraEnabled)}
    <video
      class="camera-display"
      autoplay
      playsinline
      muted
      bind:this={cameraVideoElement}
      class:mirror={$frontCameraEnabled}
    ></video>
  {/if}

  <canvas class="effect-output" bind:this={effectCanvas}></canvas>
</div>

<style>
  .visual-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    background: #0a0a0f;
  }

  .visual-container :global(canvas) {
    display: block;
  }

  .effect-output {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 3;
    pointer-events: none;
    visibility: hidden;
  }

  .camera-display {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 1;
  }

  .camera-display.mirror {
    transform: scaleX(-1);
  }
</style>
