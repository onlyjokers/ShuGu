<script lang="ts">
  import '@shugu/ui-kit/styles';
  import { onMount, onDestroy } from 'svelte';
  import {
    initialize,
    requestPermissions,
    disconnect,
    connectionStatus,
    clientId,
  } from '$lib/stores/client';
  import StartScreen from '$lib/components/StartScreen.svelte';
  import VisualCanvas from '$lib/components/VisualCanvas.svelte';
  import PermissionWarning from '$lib/components/PermissionWarning.svelte';

  let hasStarted = false;
  let serverUrl = 'https://localhost:3001';

  /**
   * Best-effort fullscreen entry. iOS Safari only recently supports the API; we probe multiple
   * element targets and vendor-prefixed methods. Tries on load and again on the Enter click.
   */
  function tryFullscreen(context: 'auto' | 'click'): void {
    // If already standalone (PWA), nothing to do
    if (typeof navigator !== 'undefined' && (navigator as any).standalone) return;

    const candidates = [document.documentElement, document.body].filter(Boolean);

    let request: (() => Promise<void> | void) | null = null;

    for (const el of candidates) {
      const anyEl = el as any;
      const fn =
        anyEl.requestFullscreen?.bind(el) ??
        anyEl.webkitRequestFullscreen?.bind(el) ??
        anyEl.webkitRequestFullScreen?.bind(el) ??
        anyEl.webkitEnterFullscreen?.bind(el);

      if (typeof fn === 'function') {
        request = fn;
        break;
      }
    }

    if (!request) {
      console.warn(`[Fullscreen] API unavailable (${context})`);
      return;
    }

    if (document.fullscreenElement) return;

    Promise.resolve(request()).catch((error) => {
      console.warn(`[Fullscreen] ${context} request failed`, error);
    });
  }

  onMount(() => {
    // Try immediately (may be ignored without gesture but cheap to attempt)
    tryFullscreen('auto');

    // Get server URL from query params or localStorage
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('server');
    const isAccessingViaIP =
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

    if (urlParam) {
      serverUrl = urlParam;
    } else {
      const savedUrl = localStorage.getItem('shugu-server-url');

      // If accessing via IP but saved URL is localhost, ignore the saved URL
      // Also ignore if saved URL is http but we want https
      const savedIsLocalhost =
        savedUrl && (savedUrl.includes('localhost') || savedUrl.includes('127.0.0.1'));
      const savedIsHttp = savedUrl && savedUrl.startsWith('http:');

      // If we are on IP, we definitely want HTTPS IP
      // If we are on localhost, we definitely want HTTPS localhost
      // Basically always prefer auto-detected HTTPS unless user manually set a complex URL

      if (savedUrl && !savedIsHttp && !(isAccessingViaIP && savedIsLocalhost)) {
        serverUrl = savedUrl;
      } else {
        // Default to current hostname (localhost or IP) with HTTPS
        // If running on standard HTTPS port (443), assume we are proxied and use the origin
        if (window.location.protocol === 'https:' && window.location.port === '') {
          serverUrl = window.location.origin;
        } else {
          serverUrl = `https://${window.location.hostname}:3001`;
        }
      }
    }
  });

  onDestroy(() => {
    disconnect();
  });

  async function handleStart() {
    hasStarted = true;

    // Save server URL
    localStorage.setItem('shugu-server-url', serverUrl);

    // Request fullscreen while the click gesture is still active to maximize success.
    tryFullscreen('click');

    // Initialize synchronously, then request permissions immediately while the user gesture is still active
    // (iOS motion/mic permissions require being in the same click stack).
    initialize({ serverUrl });

    try {
      await requestPermissions();
    } catch (error) {
      console.error('[Client] Permission request failed', error);
    }
  }
</script>

<svelte:head>
  <title>Fluffy Foundation</title>
  <meta name="theme-color" content="#0a0a0f" />
</svelte:head>

<div class="app">
  {#if !hasStarted}
    <StartScreen on:start={handleStart} />
  {:else}
    <VisualCanvas />
    <PermissionWarning />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    touch-action: none;
    -webkit-overflow-scrolling: none;
  }

  .app {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #0a0a0f;
  }
</style>
