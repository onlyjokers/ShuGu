<script lang="ts">
  import {
    audienceClients,
    clientReadiness,
  } from '$lib/stores/manager';
  import { formatClientId } from '@shugu/ui-kit';

  function readinessStatus(clientId: string): 'connected' | 'loading' | 'ready' | 'error' {
    const info = $clientReadiness.get(clientId);
    if (!info) return 'connected';
    if (info.status === 'assets-ready') return 'ready';
    if (info.status === 'assets-error') return 'error';
    if (info.status === 'assets-loading') return 'loading';
    return 'connected';
  }

  function readinessTitle(clientId: string): string {
    const info = $clientReadiness.get(clientId);
    if (!info) return 'Connected (assets not verified)';
    if (info.status === 'assets-ready') return 'Assets ready';
    if (info.status === 'assets-error') return info.error ? `Assets error: ${info.error}` : 'Assets error';
    if (info.status === 'assets-loading') {
      const loaded = typeof info.loaded === 'number' ? info.loaded : null;
      const total = typeof info.total === 'number' ? info.total : null;
      if (loaded !== null && total !== null) return `Assets loading (${loaded}/${total})`;
      return 'Assets loading';
    }
    return 'Connected (assets not verified)';
  }
</script>

<div class="client-list-container">
  <div class="header">
    <h3 class="title">Clients ({$audienceClients.length})</h3>
    <div class="subtitle">View only</div>
  </div>

  <div class="list-content">
    {#if $audienceClients.length === 0}
      <div class="empty-state">
        <span class="text-muted">No clients connected</span>
      </div>
    {:else}
      {#each $audienceClients as client (client.clientId)}
        <div class="client-item">
          <div
            class="status-dot {readinessStatus(client.clientId)}"
            title={readinessTitle(client.clientId)}
          ></div>
          <div class="client-info">
            <span class="client-id">{formatClientId(client.clientId)}</span>
            <span class="client-time">
              {new Date(client.connectedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
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

  .subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
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
    cursor: default;
    text-align: left;
    transition: all var(--transition-fast);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(250, 204, 21, 0.95);
    box-shadow: 0 0 6px rgba(250, 204, 21, 0.55);
  }

  .status-dot.ready {
    background: var(--color-success);
    box-shadow: 0 0 6px var(--color-success);
  }

  .status-dot.error {
    background: rgba(239, 68, 68, 0.92);
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.55);
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
</style>
