<script lang="ts">
  import {
    clients,
    state,
    toggleClientSelection,
    selectAllClients,
    clearSelection,
  } from '$lib/stores/manager';
  import { formatClientId } from '@shugu/ui-kit';
  import Button from '$lib/components/ui/Button.svelte';

  $: selectedIds = $state.selectedClientIds;
</script>

<div class="client-list-container">
  <div class="header">
    <h3 class="title">Clients ({$clients.length})</h3>
    <div class="actions">
      <Button
        variant="ghost"
        size="sm"
        on:click={selectAllClients}
        disabled={$clients.length === 0}
      >
        All
      </Button>
      <Button
        variant="ghost"
        size="sm"
        on:click={clearSelection}
        disabled={selectedIds.length === 0}
      >
        Clear
      </Button>
    </div>
  </div>

  <div class="list-content">
    {#if $clients.length === 0}
      <div class="empty-state">
        <span class="text-muted">No clients connected</span>
      </div>
    {:else}
      {#each $clients as client (client.clientId)}
        <button
          class="client-item"
          class:selected={selectedIds.includes(client.clientId)}
          on:click={() => toggleClientSelection(client.clientId)}
        >
          <div class="status-dot"></div>
          <div class="client-info">
            <span class="client-id">{formatClientId(client.clientId)}</span>
            <span class="client-time">
              {new Date(client.connectedAt).toLocaleTimeString()}
            </span>
          </div>
          {#if selectedIds.includes(client.clientId)}
            <div class="check-icon">✓</div>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .client-list-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    margin-bottom: var(--space-sm);
  }

  .title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .actions {
    display: flex;
    gap: var(--space-xs);
  }

  .list-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 4px; /* Space for scrollbar */
  }

  .empty-state {
    padding: var(--space-xl);
    text-align: center;
    font-size: var(--text-sm);
  }

  .client-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
  }

  .client-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .client-item.selected {
    background: rgba(99, 102, 241, 0.1);
    border-color: var(--color-primary);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 6px var(--color-success);
  }

  .client-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .client-id {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .client-time {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .check-icon {
    color: var(--color-primary);
    font-weight: bold;
  }
</style>
