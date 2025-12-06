<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { currentScene, audioStream, getSDK } from '$lib/stores/client';
  import {
    BoxScene,
    MelSpectrogramScene,
    DefaultSceneManager,
    type VisualContext,
  } from '@shugu/visual-plugins';
  import {
    AudioSplitPlugin,
    MelSpectrogramPlugin,
    type AudioSplitFeature,
    type MelSpectrogramFeature,
  } from '@shugu/audio-plugins';

  let container: HTMLElement;
  let sceneManager: DefaultSceneManager | null = null;
  let splitPlugin: AudioSplitPlugin | null = null;
  let melPlugin: MelSpectrogramPlugin | null = null;
  let audioContext: AudioContext | null = null;
  let animationId: number;
  let lastTime = 0;

  // Current context data for scene updates
  let context: VisualContext = {};

  // Device orientation data
  let orientationData = { alpha: 0, beta: 0, gamma: 0, screen: 0 };

  onMount(() => {
    // Create scene manager
    sceneManager = new DefaultSceneManager(container);

    // Register scenes
    sceneManager.register(new BoxScene());
    sceneManager.register(new MelSpectrogramScene());

    // Switch to initial scene
    sceneManager.switchTo($currentScene);

    // Set up device orientation listener
    window.addEventListener('deviceorientation', handleOrientation);

    // Start animation loop
    lastTime = performance.now();
    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('deviceorientation', handleOrientation);
    sceneManager?.destroy();
    splitPlugin?.destroy();
    melPlugin?.destroy();
    splitPlugin = null;
    melPlugin = null;
    audioContext?.close();
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
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    const screen = typeof window.orientation === 'number'
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

    animationId = requestAnimationFrame(animate);
  }
</script>

<div class="visual-container" bind:this={container}></div>

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
</style>
