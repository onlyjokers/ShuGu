<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    currentScene,
    audioStream,
    asciiEnabled,
    asciiResolution,
    videoState,
    imageState,
    getSDK,
    connectionStatus,
  } from '$lib/stores/client';
  import VideoPlayer from '$lib/components/VideoPlayer.svelte';
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

  let container: HTMLElement;
  let sceneManager: DefaultSceneManager | null = null;
  let asciiCanvas: HTMLCanvasElement;
  let splitPlugin: AudioSplitPlugin | null = null;
  let melPlugin: MelSpectrogramPlugin | null = null;
  let audioContext: AudioContext | null = null;
  let animationId: number;
  let tinyCanvas: HTMLCanvasElement | null = null;
  let tinyCtx: CanvasRenderingContext2D | null = null;
  let asciiCtx: CanvasRenderingContext2D | null = null;
  let sourceCanvas: HTMLCanvasElement | null = null;
  let mediaCanvas: HTMLCanvasElement | null = null;
  let mediaCtx: CanvasRenderingContext2D | null = null;
  let lastTime = 0;

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

    // Switch to initial scene
    sceneManager.switchTo($currentScene);

    // ASCII overlay setup
    asciiCtx = asciiCanvas.getContext('2d');
    tinyCanvas = document.createElement('canvas');
    tinyCtx = tinyCanvas.getContext('2d');
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

  // React to scene changes
  $: if (sceneManager && $currentScene) {
    sceneManager.switchTo($currentScene);
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
        console.warn('[VisualCanvas] Tone context not available; skipping audio analysis pipeline.');
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

    if (sceneManager) {
      sceneManager.update(dt, context);
    }

    if ($asciiEnabled) {
      drawAsciiOverlay();
    } else if (asciiCtx) {
      asciiCtx.clearRect(0, 0, container?.clientWidth ?? 0, container?.clientHeight ?? 0);
      setBaseCanvasVisibility(true);
    }

    animationId = requestAnimationFrame(animate);
  }

  function ensureSourceCanvas(): HTMLCanvasElement | null {
    const media = updateMediaCanvas();
    if (media) {
      sourceCanvas = media;
      return sourceCanvas;
    }

    if (sourceCanvas && sourceCanvas.isConnected) return sourceCanvas;
    const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[];
    sourceCanvas = canvases.find((c) => c !== asciiCanvas) ?? null;
    return sourceCanvas;
  }

  type MediaFit = 'contain' | 'fit-screen' | 'cover' | 'fill';

  function getFittedDrawParams(
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    fit: MediaFit
  ): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
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

  function updateMediaCanvas(): HTMLCanvasElement | null {
    const video = container?.querySelector('video');
    const img = container?.querySelector('img');

    const targetW = container?.clientWidth ?? 0;
    const targetH = container?.clientHeight ?? 0;
    if (targetW === 0 || targetH === 0) return null;

    const ensureMediaCanvas = () => {
      if (!mediaCanvas) {
        mediaCanvas = document.createElement('canvas');
        mediaCtx = mediaCanvas.getContext('2d');
      }
      if (!mediaCtx) return null;
      if (mediaCanvas.width !== targetW) mediaCanvas.width = targetW;
      if (mediaCanvas.height !== targetH) mediaCanvas.height = targetH;
      mediaCtx.setTransform(1, 0, 0, 1, 0, 0);
      mediaCtx.clearRect(0, 0, targetW, targetH);
      mediaCtx.fillStyle = '#0a0a0f';
      mediaCtx.fillRect(0, 0, targetW, targetH);
      return mediaCtx;
    };

    if (video && $videoState.url && (video as HTMLVideoElement).readyState >= 2) {
      const el = video as HTMLVideoElement;
      const srcW = el.videoWidth || 0;
      const srcH = el.videoHeight || 0;
      if (srcW === 0 || srcH === 0) return null;
      const ctx = ensureMediaCanvas();
      if (!ctx) return null;

      const fit = ($videoState.fit ?? 'contain') as MediaFit;
      const padding = fit === 'contain' ? 24 : 0;
      const dstW = Math.max(0, targetW - padding * 2);
      const dstH = Math.max(0, targetH - padding * 2);
      if (dstW === 0 || dstH === 0) return null;
      const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(srcW, srcH, dstW, dstH, fit);

      try {
        ctx.drawImage(el, sx, sy, sw, sh, padding + dx, padding + dy, dw, dh);
      } catch {
        return null; // cross-origin without CORS
      }
      return mediaCanvas;
    }

    if (img && $imageState.visible && $imageState.url) {
      const el = img as HTMLImageElement;
      const srcW = el.naturalWidth || el.clientWidth || 0;
      const srcH = el.naturalHeight || el.clientHeight || 0;
      if (srcW === 0 || srcH === 0) return null;
      const ctx = ensureMediaCanvas();
      if (!ctx) return null;

      const fit = ($imageState.fit ?? 'contain') as MediaFit;
      const padding = fit === 'contain' ? 24 : 0;
      const dstW = Math.max(0, targetW - padding * 2);
      const dstH = Math.max(0, targetH - padding * 2);
      if (dstW === 0 || dstH === 0) return null;
      const { sx, sy, sw, sh, dx, dy, dw, dh } = getFittedDrawParams(srcW, srcH, dstW, dstH, fit);

      try {
        ctx.drawImage(el, sx, sy, sw, sh, padding + dx, padding + dy, dw, dh);
      } catch {
        return null; // cross-origin without CORS
      }
      return mediaCanvas;
    }

    return null;
  }

  function drawAsciiOverlay() {
    if (!asciiCtx || !tinyCtx || !tinyCanvas) return;

    const src = ensureSourceCanvas();
    const width = container?.clientWidth ?? 0;
    const height = container?.clientHeight ?? 0;
    if (!src || width === 0 || height === 0) {
      asciiCtx.clearRect(0, 0, width, height);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    asciiCanvas.width = Math.floor(width * dpr);
    asciiCanvas.height = Math.floor(height * dpr);
    asciiCanvas.style.width = `${width}px`;
    asciiCanvas.style.height = `${height}px`;

    const cellSize = Math.max(6, Math.min(24, $asciiResolution));
    const cols = Math.max(24, Math.floor(width / cellSize));
    const rows = Math.max(18, Math.floor(height / (cellSize * 1.05)));

    tinyCanvas.width = cols;
    tinyCanvas.height = rows;
    try {
      tinyCtx.drawImage(src, 0, 0, cols, rows);
    } catch (e) {
      // Cross-origin or invalid source; skip drawing this frame
      return;
    }

    let data: Uint8ClampedArray;
    try {
      data = tinyCtx.getImageData(0, 0, cols, rows).data;
    } catch (e) {
      // Canvas tainted (likely cross-origin media without CORS)
      return;
    }

    asciiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    asciiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    asciiCtx.fillStyle = '#0a0a0f';
    asciiCtx.fillRect(0, 0, width, height);
    asciiCtx.textAlign = 'center';
    asciiCtx.textBaseline = 'middle';
    const fontSize = Math.max(9, Math.round(height / rows));
    asciiCtx.font = `${fontSize}px "IBM Plex Mono", "SFMono-Regular", "Menlo", monospace`;

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
          asciiCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.94)`;
          asciiCtx.fillRect(
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
        asciiCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
        asciiCtx.fillText(glyph, posX, posY);
      }
    }

    drawBorder(asciiCtx, width, height, cols, rows);
    setBaseCanvasVisibility(false);
  }

  function setBaseCanvasVisibility(show: boolean) {
    const canvases = Array.from(container?.querySelectorAll('canvas') ?? []) as HTMLCanvasElement[];
    canvases
      .filter((c) => c !== asciiCanvas)
      .forEach((c) => {
        c.style.visibility = show ? 'visible' : 'hidden';
      });
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
    if (asciiCtx && container) {
      asciiCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    }
  }
</script>

<div class="visual-container" bind:this={container}>
  <!-- Video Player (z-index: 1, below ASCII) -->
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

  <!-- Image Display (z-index: 1, below ASCII) -->
  {#if $imageState.url && $imageState.visible}
    <ImageDisplay url={$imageState.url} duration={$imageState.duration} fit={$imageState.fit} />
  {/if}

  <canvas class="ascii-overlay" bind:this={asciiCanvas}></canvas>
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

  .ascii-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    mix-blend-mode: normal;
  }
</style>
