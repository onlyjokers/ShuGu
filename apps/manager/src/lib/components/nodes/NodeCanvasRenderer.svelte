<!--
  NodeCanvasRenderer - Switches between Rete and XYFlow renderers based on feature flag.
  Usage: <NodeCanvasRenderer /> (replaces direct NodeCanvas usage)
-->
<script lang="ts">
  import { nodeGraphRenderer } from '$lib/features/node-graph-flags';
  import NodeCanvas from './NodeCanvas.svelte';
  import { NodeCanvasXYFlow } from './node-canvas-xyflow';
</script>

{#if $nodeGraphRenderer === 'xyflow'}
  <NodeCanvasXYFlow />
{:else}
  <NodeCanvas />
{/if}
