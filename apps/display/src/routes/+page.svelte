<!--
Purpose: Full-screen Display player (Phase 2/3: UI + MultimediaCore + server transport).
-->

<script lang="ts">
  import '@shugu/ui-kit/styles';
  import { onMount, onDestroy } from 'svelte';
  import { VideoPlayer } from '@shugu/ui-kit';
  import ImageDisplay from '$components/ImageDisplay.svelte';
  import { toneAudioEngine } from '@shugu/multimedia-core';
  import {
    audioState,
    mode,
    serverState,
    videoState,
    imageState,
    screenOverlay,
    initializeDisplay,
    destroyDisplay,
    executeControl,
    enableAudio,
    reportNodeMediaStarted,
  } from '$lib/stores/display';

  let serverUrl = 'https://localhost:3001';
  let assetReadToken = '';
  let pairToken = '';
  let isConnected = false;

  $: isConnected = $mode === 'local' || $serverState.status === 'connected';

  onMount(() => {
    const params = new URLSearchParams(window.location.search);

    const urlParam = params.get('server');
    const assetReadTokenParam = params.get('assetReadToken') ?? params.get('asset_read_token');
    const pairTokenParam = params.get('pairToken') ?? params.get('pair_token');

    serverUrl = urlParam?.trim() ? urlParam.trim() : serverUrl;
    assetReadToken = assetReadTokenParam?.trim() ? assetReadTokenParam.trim() : '';
    pairToken = pairTokenParam?.trim() ? pairTokenParam.trim() : '';

    // Preload Tone.js early so `toneAudioEngine.start()` can run inside a user gesture later.
    void toneAudioEngine.ensureLoaded().catch(() => undefined);

    initializeDisplay({ serverUrl, assetReadToken, pairToken });

    return () => {
      destroyDisplay();
    };
  });

  onDestroy(() => {
    // `onMount` already returns the cleanup; keep this as a safety net.
    destroyDisplay();
  });
</script>

<div
  class="root"
  on:pointerdown={() => {
    if (!$audioState.enabled) void enableAudio();
  }}
>
  {#if isConnected && $videoState.url}
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
      onStarted={reportNodeMediaStarted}
    />
  {/if}

  {#if isConnected && $imageState.url}
    <ImageDisplay
      url={$imageState.url}
      duration={$imageState.duration}
      fit={$imageState.fit}
      onHide={() => executeControl('hideImage', {})}
    />
  {/if}

  {#if isConnected && $screenOverlay.visible}
    <div
      class="screen-overlay"
      style={`background:${$screenOverlay.color}; opacity:${$screenOverlay.opacity}`}
    ></div>
  {/if}
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    background: #000;
    overflow: hidden;
  }

  .screen-overlay {
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }
</style>
