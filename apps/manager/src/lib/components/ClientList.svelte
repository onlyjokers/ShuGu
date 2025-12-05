<script lang="ts">
  import {
    clients,
    state,
    toggleClientSelection,
    selectAllClients,
    clearSelection,
  } from '$lib/stores/manager';
  import { formatClientId } from '@shugu/ui-kit';

  $: selectedIds = $state.selectedClientIds;
  $: allSelected = $clients.length > 0 && selectedIds.length === $clients.length;
</script>

<div class="card">
  <div class="card-header">
    <h3 class="card-title">Clients ({$clients.length})</h3>
    <div class="actions">
      <button
        class="btn btn-sm btn-secondary"
        on:click={selectAllClients}
        disabled={$clients.length === 0}
      >
        Select All
      </button>
      <button
        class="btn btn-sm btn-secondary"
        on:click={clearSelection}
        disabled={selectedIds.length === 0}
      >
        Clear
      </button>
    </div>
  </div>

  <div class="client-list">
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
          <div class="checkbox">
            {#if selectedIds.includes(client.clientId)}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6L5 9L10 3"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {/if}
          </div>
          <div class="client-info">
            <span class="client-id">{formatClientId(client.clientId)}</span>
            <span class="client-time text-muted">
              Connected {new Date(client.connectedAt).toLocaleTimeString()}
            </span>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .actions {
    display: flex;
    gap: var(--space-sm);
  }

  .empty-state {
    padding: var(--space-xl);
    text-align: center;
  }

  .client-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .client-time {
    font-size: var(--text-xs);
  }

  .checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
