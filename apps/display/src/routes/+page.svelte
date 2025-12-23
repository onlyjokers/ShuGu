<!--
Purpose: Full-screen Display player (Phase 2/3: UI + MultimediaCore + server transport).
-->

<script lang="ts">
  import '@shugu/ui-kit/styles';
  import { onMount, onDestroy } from 'svelte';
  import VideoPlayer from '$components/VideoPlayer.svelte';
  import ImageDisplay from '$components/ImageDisplay.svelte';
  import {
    coreState,
    audioState,
    videoState,
    imageState,
    screenOverlay,
    mode,
    serverState,
    readyOnce,
    initializeDisplay,
    destroyDisplay,
    executeControl,
    enableAudio,
  } from '$lib/stores/display';

  let serverUrl = 'https://localhost:3001';
  let assetReadToken = '';
  let pairToken = '';

  let debugImageUrl = '';
  let debugVideoUrl = '';
  let debugColor = '#000000';
  let debugOpacity = 0;

  onMount(() => {
    const params = new URLSearchParams(window.location.search);

    const urlParam = params.get('server');
    const assetReadTokenParam = params.get('assetReadToken') ?? params.get('asset_read_token');
    const pairTokenParam = params.get('pairToken') ?? params.get('pair_token');

    serverUrl = urlParam?.trim() ? urlParam.trim() : serverUrl;
    assetReadToken = assetReadTokenParam?.trim() ? assetReadTokenParam.trim() : '';
    pairToken = pairTokenParam?.trim() ? pairTokenParam.trim() : '';

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
    />
  {/if}

  {#if $imageState.url}
    <ImageDisplay
      url={$imageState.url}
      duration={$imageState.duration}
      onHide={() => executeControl('hideImage', {})}
    />
  {/if}

  {#if $screenOverlay.visible}
    <div
      class="screen-overlay"
      style={`background:${$screenOverlay.color}; opacity:${$screenOverlay.opacity}`}
    ></div>
  {/if}

  <div class="debug">
    <div class="row">
      <div class="badge">Display</div>
      <div class="muted">mode={$mode} ws={$serverState.status} id={$serverState.clientId ?? '-'} server={serverUrl}</div>
    </div>
    <div class="row muted">
      <span>pairToken={pairToken ? 'yes' : 'no'}</span>
      <span>assetReadToken={assetReadToken ? 'yes' : 'no'}</span>
    </div>
    <div class="row">
      <div class="muted">
        core={$coreState.status} readyOnce={$readyOnce.ready ? 'yes' : 'no'} reportedServer={$readyOnce.reportedToServer ? 'yes' : 'no'}
        reportedLocal={$readyOnce.reportedToLocal ? 'yes' : 'no'}
        manifest={$coreState.manifestId ?? '-'} {$coreState.loaded}/{$coreState.total}
      </div>
    </div>
    <div class="row muted">
      <span>audio={$audioState.enabled ? 'on' : 'off'}</span>
      <button disabled={$audioState.enabled} on:click={() => void enableAudio()}>
        {$audioState.enabled ? 'Audio Enabled' : 'Enable Audio'}
      </button>
      {#if $audioState.error}
        <span class="warn">{$audioState.error}</span>
      {/if}
    </div>
    <div class="row">
      <input placeholder="Image URL or asset:..." bind:value={debugImageUrl} />
      <button on:click={() => executeControl('showImage', { url: debugImageUrl })}>Show</button>
      <button on:click={() => executeControl('hideImage', {})}>Hide</button>
    </div>
    <div class="row">
      <input placeholder="Video URL or asset:..." bind:value={debugVideoUrl} />
      <button on:click={() => executeControl('playMedia', { url: debugVideoUrl, mediaType: 'video', muted: true })}>
        Play
      </button>
      <button on:click={() => executeControl('stopMedia', {})}>Stop</button>
    </div>
    <div class="row">
      <input type="color" bind:value={debugColor} />
      <input type="range" min="0" max="1" step="0.01" bind:value={debugOpacity} />
      <button on:click={() => executeControl('screenColor', { color: debugColor, opacity: debugOpacity, mode: 'solid' })}>
        Color
      </button>
      <button on:click={() => executeControl('screenColor', { color: debugColor, opacity: 0, mode: 'solid' })}>
        Clear
      </button>
    </div>
  </div>
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

  .debug {
    position: fixed;
    left: 12px;
    top: 12px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    min-width: min(520px, calc(100vw - 24px));
    backdrop-filter: blur(10px);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge {
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .muted {
    color: rgba(255, 255, 255, 0.7);
  }

  .warn {
    color: rgba(255, 170, 170, 0.92);
  }

  input:not([type]),
  input[placeholder] {
    flex: 1;
    min-width: 180px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.92);
    outline: none;
  }

  input[type='color'] {
    width: 32px;
    height: 28px;
    border: none;
    padding: 0;
    background: transparent;
  }

  input[type='range'] {
    width: 160px;
  }

  button {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
