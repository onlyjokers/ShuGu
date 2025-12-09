<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import { parameterRegistry } from '$lib/parameters';
  import ParameterControl from './ParameterControl.svelte';

  export let prefix: string;
  export let title: string | undefined = undefined;
  export let columns = 1;

  $: parameters = parameterRegistry
    .list(prefix)
    .sort((a, b) => a.path.localeCompare(b.path));
</script>

<Card title={title ?? prefix}>
  <div class="grid" style={`--cols:${columns}`}>
    {#each parameters as param (param.path)}
      <div class="cell">
        <ParameterControl path={param.path} />
      </div>
    {/each}
  </div>
</Card>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-sm);
  }
  .cell {
    min-width: 0;
  }
</style>
