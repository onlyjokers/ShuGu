<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { currentScene, audioStream, getSDK } from '$lib/stores/client';
  import {
    BoxScene,
    MelSpectrogramScene,
    DefaultSceneManager,
    type VisualContext,
  } from '@shugu/visual-plugins';
  import { AudioSplitPlugin, type AudioSplitFeature } from '@shugu/audio-plugins';

  let container: HTMLElement;
  let sceneManager: DefaultSceneManager | null = null;
  let audioPlugin: AudioSplitPlugin | null = null;
  let audioContext: AudioContext | null = null;
  let animationId: number;
  let lastTime = 0;

  // Current context data for scene updates
  let context: VisualContext = {};

  // Device orientation data
  let orientationData = { alpha: 0, beta: 0, gamma: 0 };

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
    audioPlugin?.destroy();
    audioContext?.close();
  });

  // React to scene changes
  $: if (sceneManager && $currentScene) {
    sceneManager.switchTo($currentScene);
  }

  // React to audio stream changes
  $: if ($audioStream && !audioPlugin) {
    setupAudioPipeline($audioStream);
  }

  async function setupAudioPipeline(stream: MediaStream) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);

      audioPlugin = new AudioSplitPlugin();
      await audioPlugin.init(audioContext, source);

      audioPlugin.onFeature((feature: AudioSplitFeature) => {
        context.audioFeatures = {
          rms: feature.rms,
          lowEnergy: feature.lowEnergy,
          midEnergy: feature.midEnergy,
          highEnergy: feature.highEnergy,
          bpm: feature.bpm,
          beatDetected: feature.beatDetected,
        };

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

      audioPlugin.start();
    } catch (error) {
      console.error('[VisualCanvas] Failed to setup audio pipeline:', error);
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    orientationData = {
      alpha: event.alpha ?? 0,
      beta: event.beta ?? 0,
      gamma: event.gamma ?? 0,
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
