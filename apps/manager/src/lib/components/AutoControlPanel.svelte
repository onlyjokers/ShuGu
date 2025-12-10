<script lang="ts">
  import { parameterRegistry } from '$lib/parameters/registry';
  import type { Parameter } from '$lib/parameters/parameter';
  import ParamWidgetFactory from './ParamWidgetFactory.svelte';

  export let clientId: string;

  // Retrieve parameters for this client
  // Note: reactive declaration to update if clientId changes
  // In a real reactive system, Registry should expose a store of 'structure',
  // or we can just rely on the fact that params are registered once on connection.
  // For Phase 2, we assume structure is stable after connection.
  $: params = parameterRegistry.list(`client/${clientId}`);

  interface Group {
    name: string;
    items: Parameter<any>[];
  }

  // Grouping Logic
  $: groups = params
    .reduce((acc: Group[], param: Parameter<any>) => {
      const groupName = param.metadata?.group || 'General';
      let group = acc.find((g) => g.name === groupName);
      if (!group) {
        group = { name: groupName, items: [] };
        acc.push(group);
      }
      group.items.push(param);
      return acc;
    }, [] as Group[])
    .sort((a: Group, b: Group) => {
      // Custom order: Flashlight first, Sound second, etc.
      const order = ['Flashlight', 'Sound', 'Screen', 'General'];
      return order.indexOf(a.name) - order.indexOf(b.name);
    });
</script>

<div class="auto-panel">
  {#if groups.length === 0}
    <div class="empty-state">No parameters for client {clientId}</div>
  {:else}
    {#each groups as group}
      <details class="group-details" open>
        <summary class="group-summary">{group.name}</summary>
        <div class="group-content">
          {#each group.items as param (param.path)}
            <ParamWidgetFactory parameter={param} />
          {/each}
        </div>
      </details>
    {/each}
  {/if}
</div>

<style>
  .auto-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }

  .empty-state {
    color: #64748b;
    font-style: italic;
  }

  .group-details {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .group-summary {
    padding: 12px;
    cursor: pointer;
    font-weight: 600;
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.05);
    user-select: none;
    list-style: none; /* Hide default triangle in some browsers if needed, or customize */
  }

  .group-summary::-webkit-details-marker {
    display: none;
  }

  /* Custom marker */
  .group-summary::before {
    content: '▶';
    display: inline-block;
    margin-right: 8px;
    font-size: 0.8em;
    transition: transform 0.2s;
  }

  details[open] .group-summary::before {
    transform: rotate(90deg);
  }

  .group-content {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
