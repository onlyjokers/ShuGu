<script lang="ts">
  import { fade } from 'svelte/transition';

  export let url: string;
  export let muted = true;
  export let loop = false;
  export let volume = 1;
  export let onEnded: (() => void) | undefined = undefined;

  let videoElement: HTMLVideoElement;
  let visible = false;
  let loaded = false;

  $: if (videoElement && loaded) {
    videoElement.volume = Math.max(0, Math.min(1, volume));
    videoElement.muted = muted;
  }

  function handleCanPlay() {
    loaded = true;
    visible = true;
    videoElement?.play().catch(console.error);
  }

  function handleEnded() {
    if (!loop) {
      visible = false;
      onEnded?.();
    }
  }

  export function stop() {
    if (videoElement) {
      videoElement.pause();
      videoElement.currentTime = 0;
    }
    visible = false;
  }

  export function play() {
    visible = true;
    videoElement?.play().catch(console.error);
  }
</script>

{#if visible}
  <div class="video-overlay" transition:fade={{ duration: 500 }}>
    <video
      bind:this={videoElement}
      src={url}
      {loop}
      {muted}
      crossorigin="anonymous"
      playsinline
      on:canplay={handleCanPlay}
      on:ended={handleEnded}
    />
  </div>
{:else if url}
  <!-- Hidden preload -->
  <video
    bind:this={videoElement}
    src={url}
    preload="auto"
    {muted}
    crossorigin="anonymous"
    playsinline
    on:canplay={handleCanPlay}
    style="display: none;"
  />
{/if}

<style>
  .video-overlay {
    position: fixed;
    inset: 0;
    z-index: 0; /* Below ASCII overlay so ASCII can cover */
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    padding: 24px; /* Margin from screen edges */
  }

  video {
    max-width: calc(100% - 48px);
    max-height: calc(100% - 48px);
    width: auto;
    height: auto;
    border-radius: 16px;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.8);
    object-fit: contain;
  }
</style>
