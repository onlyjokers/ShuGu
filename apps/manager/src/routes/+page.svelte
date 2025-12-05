<script lang="ts">
  import '@shugu/ui-kit/styles';
  import { onMount } from 'svelte';
  import { connect, disconnect, connectionStatus } from '$lib/stores/manager';
  import ConnectionBar from '$lib/components/ConnectionBar.svelte';
  import ClientList from '$lib/components/ClientList.svelte';
  import ControlPanel from '$lib/components/ControlPanel.svelte';
  import SensorDisplay from '$lib/components/SensorDisplay.svelte';
  import PluginControl from '$lib/components/PluginControl.svelte';

  let serverUrl = 'http://localhost:3001';
  let isConnecting = false;

  onMount(() => {
    // Detect if accessing via IP address
    const isAccessingViaIP =
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

    // Try to get server URL from localStorage
    const savedUrl = localStorage.getItem('shugu-server-url');

    // If accessing via IP but saved URL is localhost, ignore the saved URL
    const savedIsLocalhost =
      savedUrl && (savedUrl.includes('localhost') || savedUrl.includes('127.0.0.1'));

    if (savedUrl && !(isAccessingViaIP && savedIsLocalhost)) {
      serverUrl = savedUrl;
    } else if (isAccessingViaIP) {
      // Assume server is on the same host if we are accessing via IP
      serverUrl = `http://${window.location.hostname}:3001`;
    }

    return () => {
      disconnect();
    };
  });

  function handleConnect() {
    localStorage.setItem('shugu-server-url', serverUrl);
    isConnecting = true;
    connect({ serverUrl });
    isConnecting = false;
  }

  function handleDisconnect() {
    disconnect();
  }
</script>

<svelte:head>
  <title>ShuGu Manager</title>
</svelte:head>

<div class="app">
  {#if $connectionStatus === 'disconnected' || $connectionStatus === 'error'}
    <div class="connect-screen">
      <div class="connect-card card card-glass">
        <h1 class="title">ShuGu Manager</h1>
        <p class="subtitle">Interactive Art Control System</p>

        <div class="connect-form">
          <label class="form-label">Server URL</label>
          <input
            type="text"
            class="input"
            bind:value={serverUrl}
            placeholder="http://localhost:3001"
          />

          {#if $connectionStatus === 'error'}
            <p class="error-message">Failed to connect. Please check the server URL.</p>
          {/if}

          <button
            class="btn btn-primary btn-lg w-full"
            on:click={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <ConnectionBar />

    <main class="main-content">
      <aside class="sidebar">
        <ClientList />
        <PluginControl />
      </aside>

      <div class="content">
        <ControlPanel />
      </div>

      <aside class="sidebar-right">
        <SensorDisplay />
      </aside>
    </main>

    <button class="disconnect-btn" on:click={handleDisconnect}> Disconnect </button>
  {/if}
</div>

<style>
  .app {
    min-height: 100vh;
    background: var(--bg-primary);
  }

  .connect-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--space-lg);
    background: linear-gradient(135deg, var(--bg-primary) 0%, #0f0f1a 100%);
  }

  .connect-card {
    max-width: 400px;
    width: 100%;
    text-align: center;
  }

  .title {
    font-size: var(--text-3xl);
    font-weight: 700;
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: var(--space-sm);
  }

  .subtitle {
    color: var(--text-muted);
    margin-bottom: var(--space-xl);
  }

  .connect-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    text-align: left;
  }

  .form-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .error-message {
    color: var(--color-error);
    font-size: var(--text-sm);
  }

  .main-content {
    display: grid;
    grid-template-columns: 300px 1fr 300px;
    gap: var(--space-lg);
    padding: var(--space-lg);
    min-height: calc(100vh - 60px);
  }

  .sidebar,
  .sidebar-right {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .disconnect-btn {
    position: fixed;
    bottom: var(--space-lg);
    right: var(--space-lg);
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }

  .disconnect-btn:hover {
    background: var(--color-error);
    color: white;
    border-color: var(--color-error);
  }

  @media (max-width: 1200px) {
    .main-content {
      grid-template-columns: 1fr;
    }

    .sidebar,
    .sidebar-right {
      order: 1;
    }

    .content {
      order: 0;
    }
  }
</style>
