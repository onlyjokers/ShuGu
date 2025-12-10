<script lang="ts">
  import '@shugu/ui-kit/styles';
  import { onMount } from 'svelte';
  import { connect, disconnect, connectionStatus } from '$lib/stores/manager';
  import { ALLOWED_USERNAMES, auth, type AuthUser } from '$lib/stores/auth';
  import { streamEnabled } from '$lib/streaming/streaming';
  import { loadLocalProject, saveLocalProject, startAutoSave, stopAutoSave } from '$lib/project/projectManager';

  // Layouts & Components
  import AppShell from '$lib/layouts/AppShell.svelte';
  import ClientList from '$lib/components/ClientList.svelte';
  import SensorDisplay from '$lib/components/SensorDisplay.svelte';
  import PluginControl from '$lib/components/PluginControl.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  // Feature Controls
  import FlashlightControl from '$lib/features/lighting/FlashlightControl.svelte';
  import VibrationControl from '$lib/features/haptics/VibrationControl.svelte';
  import SynthControl from '$lib/features/audio/SynthControl.svelte';
  import ScreenColorControl from '$lib/features/lighting/ScreenColorControl.svelte';
  import MediaControl from '$lib/features/audio/MediaControl.svelte';
  import SceneControl from '$lib/features/visuals/SceneControl.svelte';
  import AutoControlPanel from '$lib/components/AutoControlPanel.svelte';
  import RegistryMidiPanel from '$lib/components/RegistryMidiPanel.svelte';
  import NodeCanvas from '$lib/components/nodes/NodeCanvas.svelte';

  let serverUrl = 'https://localhost:3001';
  let isConnecting = false;
  let username: AuthUser | '' = '';
  let password = '';
  let rememberLogin = false;

let activePage: 'dashboard' | 'auto' | 'registry-midi' | 'nodes' = 'dashboard';

  let projectRestored = false;
  let autoSaveStarted = false;

  // Global Sync State
  let useSync = true;

  onMount(() => {
    // Detect if accessing via IP address
    const isAccessingViaIP =
      window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

    // Try to get server URL from localStorage
    const savedUrl = localStorage.getItem('shugu-server-url');

    // If accessing via IP but saved URL is localhost, ignore the saved URL
    const savedIsLocalhost =
      savedUrl && (savedUrl.includes('localhost') || savedUrl.includes('127.0.0.1'));
    const savedIsHttp = savedUrl && savedUrl.startsWith('http:');

    if (savedUrl && !savedIsHttp && !(isAccessingViaIP && savedIsLocalhost)) {
      serverUrl = savedUrl;
    } else {
      // Default to HTTPS on current host
      serverUrl = `https://${window.location.hostname}:3001`;
    }

    return () => {
      disconnect();
      stopAutoSave();
    };
  });

  // Restore project once we're connected (parameters are registered after connect)
  $: if (!projectRestored && $connectionStatus === 'connected') {
    if (loadLocalProject()) {
      console.info('[Project] restored from local storage');
    }
    projectRestored = true;
  }

  // Start autosave once connected
  $: if ($connectionStatus === 'connected' && !autoSaveStarted) {
    startAutoSave();
    autoSaveStarted = true;
  }

  onMount(() => {
    const handler = () => saveLocalProject('beforeunload');
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  });

  function handleConnect() {
    if (!$auth.user) return;
    localStorage.setItem('shugu-server-url', serverUrl);
    isConnecting = true;
    connect({ serverUrl });
    isConnecting = false;
  }

  function handleDisconnect() {
    disconnect();
  }

  function handleLogin(event: Event) {
    event.preventDefault();
    auth.clearError();
    const result = auth.login(username, password, rememberLogin);

    if (result.ok) {
      password = '';
    } else {
      password = '';
    }
  }

  function handleLogout() {
    handleDisconnect();
    auth.logout();
    rememberLogin = false;
    password = '';
  }
</script>

<svelte:head>
  <title>Fluffy Manager</title>
</svelte:head>

<div class="app">
  {#if $auth.isRestoring}
    <div class="connect-screen">
      <div class="connect-card card card-glass">
        <h1 class="title">Fluffy Manager</h1>
        <p class="subtitle">Restoring session...</p>
      </div>
    </div>
  {:else if !$auth.user}
    <div class="connect-screen">
      <div class="connect-card card card-glass">
        <h1 class="title">Fluffy Manager</h1>

        <form class="connect-form" on:submit|preventDefault={handleLogin} autocomplete="on">
          <label class="form-label" for="username">Username</label>
          <input
            id="username"
            list="user-options"
            type="text"
            class="input"
            bind:value={username}
            placeholder="Eureka / Starno / VKong"
            autocomplete="username"
            on:input={() => auth.clearError()}
          />
          <datalist id="user-options">
            {#each ALLOWED_USERNAMES as name}
              <option value={name} />
            {/each}
          </datalist>

          <label class="form-label" for="password">Password</label>
          <input
            id="password"
            type="password"
            class="input"
            bind:value={password}
            placeholder="******"
            autocomplete="current-password"
            on:input={() => auth.clearError()}
          />

          <label class="remember-row">
            <input type="checkbox" bind:checked={rememberLogin} />
            <span>Remember me</span>
          </label>

          {#if $auth.error}
            <p class="error-message">{$auth.error}</p>
          {/if}

          <button class="btn btn-primary btn-lg w-full" type="submit">Login</button>
        </form>
      </div>
    </div>
  {:else if $connectionStatus === 'disconnected' || $connectionStatus === 'error'}
    <div class="connect-screen">
      <div class="connect-card card card-glass">
        <h1 class="title">Fluffy Manager</h1>

        <div class="connect-form">
          <label class="form-label" for="server-url">Server URL</label>
          <input
            id="server-url"
            type="text"
            class="input"
            bind:value={serverUrl}
            placeholder="https://localhost:3001"
          />

          <p class="status-note">Logged in as: <strong>{$auth.user}</strong></p>

          {#if $connectionStatus === 'error'}
            <p class="error-message">Failed to connect. Please check the server URL.</p>
          {/if}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            on:click={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>

          <Button variant="secondary" size="lg" fullWidth on:click={handleLogout}>Logout</Button>
        </div>
      </div>
    </div>
  {:else}
    <AppShell>
      <div slot="sidebar" class="sidebar-content">
        <ClientList />
        <div class="sidebar-divider"></div>
        <PluginControl />
      </div>

      <div slot="right-sidebar">
        <SensorDisplay />
      </div>

      <div class="page-tabs">
        <button
          class:active={activePage === 'dashboard'}
          on:click={() => (activePage = 'dashboard')}
        >
          控制台
        </button>
        <button class:active={activePage === 'auto'} on:click={() => (activePage = 'auto')}>
          🎛️ Auto UI
        </button>
        <button
          class:active={activePage === 'registry-midi'}
          on:click={() => (activePage = 'registry-midi')}
        >
          🎹 Registry MIDI
        </button>
        <button class:active={activePage === 'nodes'} on:click={() => (activePage = 'nodes')}>
          📊 Node Graph
        </button>
      </div>

      <div class:hide={activePage !== 'dashboard'}>
        <div class="dashboard-grid">
          <div class="grid-item">
            <FlashlightControl {useSync} />
          </div>
          <div class="grid-item">
            <ScreenColorControl {useSync} />
          </div>
          <div class="grid-item">
            <SynthControl {useSync} />
          </div>
          <div class="grid-item">
            <MediaControl {useSync} />
          </div>
          <div class="grid-item">
            <VibrationControl {useSync} />
          </div>
          <div class="grid-item">
            <SceneControl {useSync} />
          </div>
        </div>
      </div>

      <div class:hide={activePage !== 'auto'}>
        <div class="auto-pane">
          <AutoControlPanel />
        </div>
      </div>

      <div class:hide={activePage !== 'registry-midi'}>
        <div class="midi-pane">
          <RegistryMidiPanel />
        </div>
      </div>

      <div class:hide={activePage !== 'nodes'}>
        <div class="nodes-pane">
          <NodeCanvas />
        </div>
      </div>

      <div slot="footer" class="footer-actions">
        <label class="sync-toggle">
          <input type="checkbox" bind:checked={useSync} />
          <span>⚡ Global Sync (500ms)</span>
        </label>
        <Button variant="ghost" size="sm" on:click={() => streamEnabled.update((v) => !v)}>
          {#if $streamEnabled}⏸ Stream Off{:else}▶ Stream On{/if}
        </Button>

        <div class="spacer"></div>

        <Button variant="danger" size="sm" on:click={handleDisconnect}>Disconnect</Button>
        <Button variant="ghost" size="sm" on:click={handleLogout}>Logout</Button>
      </div>
    </AppShell>
  {/if}
</div>

<style>
  .app {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  /* Connect Screen Styles */
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
    padding: var(--space-xl);
  }

  .title {
    font-size: var(--text-3xl);
    font-weight: 700;
    margin-bottom: var(--space-md);
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
  }

  .connect-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    text-align: left;
    margin-top: var(--space-lg);
  }

  .form-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .input {
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 1rem;
  }

  .input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .error-message {
    color: var(--color-error);
    font-size: var(--text-sm);
    text-align: center;
  }

  .status-note {
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .remember-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  /* Dashboard Grid */
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-lg);
    padding-bottom: var(--space-xl);
  }

  .page-tabs {
    display: inline-flex;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
    background: var(--bg-secondary);
    padding: 6px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
  }

  .page-tabs button {
    border: none;
    padding: 8px 14px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-weight: 600;
  }

  .page-tabs button.active {
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    color: white;
  }

  .midi-pane {
    margin-top: var(--space-sm);
  }

  .auto-pane {
    margin-top: var(--space-sm);
  }

  .hide {
    display: none;
  }

  .sidebar-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    height: 100%;
  }

  .sidebar-divider {
    height: 1px;
    background: var(--border-color);
  }

  .footer-actions {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--space-md);
  }

  .spacer {
    flex: 1;
  }

  .sync-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-sm);
    color: var(--color-warning);
    font-weight: 500;
    cursor: pointer;
  }
</style>
