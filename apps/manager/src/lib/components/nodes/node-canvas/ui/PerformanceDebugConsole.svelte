<!--
  Purpose: DEV-only performance debug logger for Node Graph.
  Logs FPS, node/edge counts, renderer type, and shadow status to the console.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let nodeCount: number = 0;
  export let connectionCount: number = 0;
  export let rendererType: 'rete' | 'xyflow' = 'rete';
  export let shadowsEnabled: boolean = true;
  export let enabled: boolean = false;

  let isMounted = false;
  let frameCount = 0;
  let lastSampleTime = 0;
  let animationFrameId: number | null = null;

  const stop = () => {
    if (animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = null;
  };

  const tick = (timestamp: number) => {
    frameCount++;

    if (timestamp - lastSampleTime >= 1000) {
      const elapsed = timestamp - lastSampleTime;
      const fps = Math.round((frameCount * 1000) / Math.max(1, elapsed));
      frameCount = 0;
      lastSampleTime = timestamp;

      console.info('[NodeGraph Perf]', {
        fps,
        nodes: nodeCount,
        edges: connectionCount,
        renderer: rendererType,
        shadows: shadowsEnabled ? 'ON' : 'OFF',
      });
    }

    animationFrameId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (animationFrameId !== null) return;
    if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return;

    frameCount = 0;
    lastSampleTime = performance.now();
    animationFrameId = requestAnimationFrame(tick);
  };

  $: if (isMounted) {
    if (enabled) start();
    else stop();
  }

  onMount(() => {
    isMounted = true;
    if (enabled) start();
  });

  onDestroy(() => {
    stop();
  });
</script>

