<script lang="ts">
  import { state, sendPluginControl } from '$lib/stores/manager';

  const plugins = [
    {
      id: 'mel-spectrogram',
      name: 'Mel Spectrogram',
      description: 'Frequency-based audio visualization',
    },
    {
      id: 'audio-splitter',
      name: 'Audio Splitter',
      description: 'Low/high frequency energy & BPM detection',
    },
  ];

  let selectedPlugin = 'mel-spectrogram';

  $: hasSelection = $state.selectedClientIds.length > 0;

  function sendCommand(command: 'init' | 'start' | 'stop' | 'configure', toAll = false) {
    sendPluginControl(selectedPlugin, command, undefined, toAll);
  }
</script>

<div class="card">
  <div class="card-header">
    <h3 class="card-title">Audio Plugins</h3>
  </div>

  <div class="plugin-list">
    {#each plugins as plugin (plugin.id)}
      <button
        class="plugin-item"
        class:selected={selectedPlugin === plugin.id}
        on:click={() => (selectedPlugin = plugin.id)}
      >
        <span class="plugin-name">{plugin.name}</span>
        <span class="plugin-desc">{plugin.description}</span>
      </button>
    {/each}
  </div>

  <div class="plugin-controls">
    <div class="button-group">
      <button
        class="btn btn-sm btn-secondary"
        on:click={() => sendCommand('init', false)}
        disabled={!hasSelection}
      >
        Init
      </button>
      <button
        class="btn btn-sm btn-primary"
        on:click={() => sendCommand('start', false)}
        disabled={!hasSelection}
      >
        Start
      </button>
      <button
        class="btn btn-sm btn-danger"
        on:click={() => sendCommand('stop', false)}
        disabled={!hasSelection}
      >
        Stop
      </button>
    </div>

    <div class="apply-all">
      <span class="text-muted">or apply to all:</span>
      <div class="button-group">
        <button class="btn btn-sm btn-secondary" on:click={() => sendCommand('init', true)}>
          Init All
        </button>
        <button class="btn btn-sm btn-secondary" on:click={() => sendCommand('start', true)}>
          Start All
        </button>
        <button class="btn btn-sm btn-secondary" on:click={() => sendCommand('stop', true)}>
          Stop All
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .plugin-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin-bottom: var(--space-lg);
  }

  .plugin-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: var(--space-md);
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
    text-align: left;
    width: 100%;
  }

  .plugin-item:hover {
    background: var(--bg-elevated);
  }

  .plugin-item.selected {
    background: rgba(99, 102, 241, 0.15);
    border-color: var(--color-primary);
  }

  .plugin-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .plugin-desc {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .plugin-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .button-group {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .apply-all {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding-top: var(--space-md);
    border-top: 1px solid var(--border-color);
  }

  .btn-danger {
    background: linear-gradient(135deg, var(--color-error), #dc2626);
    color: white;
  }
</style>
