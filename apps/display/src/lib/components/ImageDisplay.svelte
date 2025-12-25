<!--
Purpose: Display image overlay (full-screen) for the Display app.
-->

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { onDestroy } from 'svelte';

  export let url: string;
  export let duration: number | undefined = undefined;
  export let fit: 'contain' | 'cover' | 'fill' = 'contain';
  export let onHide: (() => void) | undefined = undefined;

  let visible = false;
  let loaded = false;
  let lastUrl: string | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  $: if (url !== lastUrl) {
    loaded = false;
    visible = false;
    lastUrl = url;
  }

  $: if (url && loaded) {
    visible = true;

    // If duration is set, hide after that time
    if (duration && duration > 0) {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        visible = false;
        onHide?.();
      }, duration);
    }
  }

  function handleLoad() {
    loaded = true;
  }

  function handleError() {
    console.error('[ImageDisplay] Failed to load image:', url);
    loaded = false;
  }

  export function hide() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    visible = false;
    onHide?.();
  }

  onDestroy(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
</script>

{#if url}
  {#if visible}
    <div
      class="image-overlay"
      class:fit-cover={fit === 'cover'}
      class:fit-fill={fit === 'fill'}
      transition:fade={{ duration: 500 }}
    >
      <img src={url} alt="" on:load={handleLoad} on:error={handleError} crossorigin="anonymous" />
    </div>
  {:else}
    <!-- Hidden preload -->
    <img
      src={url}
      alt=""
      on:load={handleLoad}
      on:error={handleError}
      crossorigin="anonymous"
      style="display: none;"
    />
  {/if}
{/if}

<style>
  .image-overlay {
    position: fixed;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    padding: 24px;
  }

  .image-overlay.fit-cover,
  .image-overlay.fit-fill {
    padding: 0;
  }

  img {
    max-width: calc(100% - 48px);
    max-height: calc(100% - 48px);
    width: auto;
    height: auto;
    border-radius: 16px;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.8);
    object-fit: contain;
    background: #000;
  }

  .image-overlay.fit-cover img,
  .image-overlay.fit-fill img {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100%;
    border-radius: 0;
    box-shadow: none;
  }

  .image-overlay.fit-cover img {
    object-fit: cover;
  }

  .image-overlay.fit-fill img {
    object-fit: fill;
  }
</style>
