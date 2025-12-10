<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { parameterRegistry } from '$lib/parameters/registry';
  import type { Parameter } from '$lib/parameters/parameter';
  import ParamWidgetFactory from './parameters/ParamWidgetFactory.svelte';

  export let clientId: string | undefined = undefined;

  const dispatch = createEventDispatcher<{
    paramContextMenu: { parameter: Parameter<any>; event: MouseEvent };
  }>();

  interface ParamGroup {
    name: string;
    params: Parameter<any>[];
    expanded: boolean;
  }

  let groups: ParamGroup[] = [];

  // Refresh params from registry
  function refreshParams() {
    const prefix = clientId ? `client/${clientId}` : undefined;
    const allParams = parameterRegistry.list(prefix);

    // Group by metadata.group
    const groupMap = new Map<string, Parameter<any>[]>();

    for (const param of allParams) {
      const groupName = param.metadata?.group ?? 'Uncategorized';
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName)!.push(param);
    }

    // Convert to array and sort
    groups = Array.from(groupMap.entries())
      .map(([name, params]) => ({
        name,
        params: params.sort((a, b) => {
          // Sort by order if available, then by path
          const orderA = (a.metadata as any)?.order ?? 999;
          const orderB = (b.metadata as any)?.order ?? 999;
          if (orderA !== orderB) return orderA - orderB;
          return a.path.localeCompare(b.path);
        }),
        expanded: true,
      }))
      .sort((a, b) => {
        // Priority groups first
        const priority = ['Flashlight', 'Sound', 'Screen', 'Visual'];
        const aIdx = priority.indexOf(a.name);
        const bIdx = priority.indexOf(b.name);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  onMount(() => {
    refreshParams();
    // TODO: Could add a registry change listener here for live updates
  });

  // Re-run when clientId changes
  $: if (clientId !== undefined) refreshParams();

  function toggleGroup(index: number) {
    groups[index].expanded = !groups[index].expanded;
    groups = groups; // trigger reactivity
  }

  function handleParamContextMenu(
    e: CustomEvent<{ parameter: Parameter<any>; event: MouseEvent }>
  ) {
    dispatch('paramContextMenu', e.detail);
  }
</script>

<div class="auto-control-panel">
  <div class="panel-header">
    <h3 class="panel-title">
      {#if clientId}
        Client {clientId.slice(0, 8)}... Parameters
      {:else}
        All Parameters
      {/if}
    </h3>
    <button class="refresh-btn" on:click={refreshParams} title="Refresh"> 🔄 </button>
  </div>

  {#if groups.length === 0}
    <div class="empty-state">
      <p>No parameters registered.</p>
      <p class="hint">Connect a client to see controls here.</p>
    </div>
  {:else}
    <div class="param-groups">
      {#each groups as group, i}
        <details class="param-group" bind:open={group.expanded}>
          <summary class="group-header" on:click|preventDefault={() => toggleGroup(i)}>
            <span class="group-icon">{group.expanded ? '▼' : '▶'}</span>
            <span class="group-name">{group.name}</span>
            <span class="group-count">{group.params.length}</span>
          </summary>

          <div class="group-content">
            {#each group.params as param (param.path)}
              <div class="param-item">
                <ParamWidgetFactory parameter={param} on:contextmenu={handleParamContextMenu} />
              </div>
            {/each}
          </div>
        </details>
      {/each}
    </div>
  {/if}
</div>

<style>
  .auto-control-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-md, 16px);
    padding: var(--space-md, 16px);
    background: var(--bg-primary, #1a1a1a);
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border-color, #333);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-title {
    font-size: var(--text-lg, 1.125rem);
    font-weight: 600;
    color: var(--text-primary, #ffffff);
    margin: 0;
  }

  .refresh-btn {
    background: none;
    border: none;
    font-size: 1rem;
    cursor: pointer;
    padding: var(--space-xs, 4px);
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .refresh-btn:hover {
    opacity: 1;
  }

  .empty-state {
    text-align: center;
    padding: var(--space-xl, 32px);
    color: var(--text-secondary, #a0a0a0);
  }

  .empty-state .hint {
    font-size: var(--text-sm, 0.875rem);
    opacity: 0.7;
  }

  .param-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
  }

  .param-group {
    background: var(--bg-secondary, #252525);
    border-radius: var(--radius-sm, 4px);
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--bg-tertiary, #2a2a2a);
    cursor: pointer;
    user-select: none;
    list-style: none;
  }

  .group-header::-webkit-details-marker {
    display: none;
  }

  .group-icon {
    font-size: 0.75rem;
    color: var(--text-secondary, #a0a0a0);
    width: 12px;
  }

  .group-name {
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    flex: 1;
  }

  .group-count {
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-secondary, #a0a0a0);
    background: var(--bg-primary, #1a1a1a);
    padding: 2px 6px;
    border-radius: 10px;
  }

  .group-content {
    padding: var(--space-md, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-md, 16px);
  }

  .param-item {
    /* Container for individual parameter widget - reserved for future styling */
    min-width: 0;
  }
</style>
