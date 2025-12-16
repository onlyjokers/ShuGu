<script lang="ts">
  import ClientList from '$lib/components/ClientList.svelte';

  // Reusable wrapper so we can embed the same client selection UI (ClientList)
  // in places where we need a constrained height (cards/panels).
  export let height: number | string = 280;

  $: heightStyle = typeof height === 'number' ? `${height}px` : height;
</script>

<div class="client-selector" style={`height:${heightStyle}`}>
  <ClientList />
</div>

<style>
  .client-selector {
    min-height: 0;
  }
</style>
