<!--
  Purpose: DEV-only performance debug overlay for Node Graph.
  Displays FPS, node/edge counts, renderer type, and shadow status.
  Only visible in development mode or when explicitly enabled.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let nodeCount: number = 0;
  export let connectionCount: number = 0;
  export let rendererType: string = 'rete';
  export let shadowsEnabled: boolean = true;
  export let visible: boolean = false;

  let fps = 0;
  let frameCount = 0;
  let lastFrameTime = 0;
  let animationFrameId: number | null = null;

  const measureFps = (timestamp: number) => {
    frameCount++;
    if (timestamp - lastFrameTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFrameTime = timestamp;
    }
    animationFrameId = requestAnimationFrame(measureFps);
  };

  onMount(() => {
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(measureFps);
  });

  onDestroy(() => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
  });

  $: fpsColor = fps >= 55 ? '#22c55e' : fps >= 30 ? '#eab308' : '#ef4444';
</script>

{#if visible}
  <div class="perf-overlay">
    <div class="perf-row">
      <span class="perf-label">FPS</span>
      <span class="perf-value" style="color: {fpsColor}">{fps}</span>
    </div>
    <div class="perf-row">
      <span class="perf-label">Nodes</span>
      <span class="perf-value">{nodeCount}</span>
    </div>
    <div class="perf-row">
      <span class="perf-label">Edges</span>
      <span class="perf-value">{connectionCount}</span>
    </div>
    <div class="perf-row">
      <span class="perf-label">Renderer</span>
      <span class="perf-value">{rendererType}</span>
    </div>
    <div class="perf-row">
      <span class="perf-label">Shadows</span>
      <span class="perf-value" style="color: {shadowsEnabled ? '#ef4444' : '#22c55e'}">
        {shadowsEnabled ? 'ON' : 'OFF'}
      </span>
    </div>
  </div>
{/if}

<style>
  .perf-overlay {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    padding: 8px 12px;
    font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
    font-size: 11px;
    color: #e5e7eb;
    pointer-events: none;
    user-select: none;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .perf-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    line-height: 1.6;
  }

  .perf-label {
    color: #9ca3af;
  }

  .perf-value {
    font-weight: 600;
  }
</style>
