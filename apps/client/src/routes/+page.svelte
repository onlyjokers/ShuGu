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

  onMount(() => {
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

    // Initialize connection
    await initialize({ serverUrl });

    // Request permissions (must be triggered by user action)
    await requestPermissions();
  }
</script>

<svelte:head>
  <title>ShuGu Experience</title>
  <meta name="theme-color" content="#0a0a0f" />
</svelte:head>

<div class="app">
  {#if !hasStarted}
    <StartScreen on:start={handleStart} />
  {:else}
    <VisualCanvas />
    <PermissionWarning />

    <!-- Connection status indicator -->
    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot {$connectionStatus}"></span>
        <span class="status-text">
          {#if $connectionStatus === 'connected'}
            Connected
          {:else if $connectionStatus === 'connecting'}
            Connecting...
          {:else if $connectionStatus === 'reconnecting'}
            Reconnecting...
          {:else}
            Disconnected
          {/if}
        </span>
      </div>

      {#if $clientId}
        <span class="client-id">{$clientId.slice(-8)}</span>
      {/if}
    </div>
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

  .status-bar {
    position: fixed;
    bottom: env(safe-area-inset-bottom, 1rem);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background: rgba(22, 22, 30, 0.8);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9999px;
    z-index: 50;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: white;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  .status-dot.connected {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }

  .status-dot.disconnected {
    background: #ef4444;
    animation: none;
  }

  .status-dot.connecting,
  .status-dot.reconnecting {
    background: #f59e0b;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .status-text {
    font-weight: 500;
  }

  .client-id {
    font-family: monospace;
    font-size: 0.75rem;
    color: #94a3b8;
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
</style>
