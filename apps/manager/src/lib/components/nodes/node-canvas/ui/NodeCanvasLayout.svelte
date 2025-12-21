<!-- Purpose: Layout shell for the node canvas, providing slots for toolbar, overlays, and minimap. -->
<script lang="ts">
  export let container: HTMLDivElement | null = null;
  export let isRunning = false;
  // Scale grid background with canvas zoom.
  export let gridScale = 1;
  // Keep grid background aligned with canvas translation.
  export let gridOffset = { x: 0, y: 0 };
</script>

<div class="node-canvas-container">
  <slot name="toolbar" />
  <slot name="logs" />

  <div
    class="canvas-wrapper"
    bind:this={container}
    role="application"
    aria-label="Node graph editor"
    style="--grid-scale: {gridScale}; --grid-x: {gridOffset.x}px; --grid-y: {gridOffset.y}px;"
  >
    <div class="canvas-dimmer" class:active={isRunning} aria-hidden="true" />
    <slot name="overlays" />
    <slot name="minimap" />
  </div>
</div>

<style>
  .node-canvas-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    position: relative;
    min-width: 0;
    min-height: 0;
    background:
      radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.18), transparent 45%),
      radial-gradient(circle at 80% 10%, rgba(168, 85, 247, 0.16), transparent 50%),
      linear-gradient(180deg, #0b0c14 0%, #070811 100%);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    border: 1px solid var(--border-color, #444);
  }

  .canvas-wrapper {
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    position: relative;
    z-index: 0;
    isolation: isolate;
    overflow: hidden;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      radial-gradient(circle at 30% 0%, rgba(99, 102, 241, 0.12), transparent 50%),
      radial-gradient(circle at 70% 10%, rgba(168, 85, 247, 0.1), transparent 55%),
      linear-gradient(180deg, rgba(10, 11, 20, 0.85) 0%, rgba(7, 8, 17, 0.95) 100%);
    background-size:
      calc(32px * var(--grid-scale, 1)) calc(32px * var(--grid-scale, 1)),
      calc(32px * var(--grid-scale, 1)) calc(32px * var(--grid-scale, 1)),
      auto,
      auto,
      auto;
    background-position:
      var(--grid-x, 0px) var(--grid-y, 0px),
      var(--grid-x, 0px) var(--grid-y, 0px),
      center,
      center,
      center;
  }

  .canvas-dimmer {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: rgba(0, 0, 0, 0.38);
    opacity: 0;
    pointer-events: none;
    transition: opacity 520ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .canvas-dimmer.active {
    opacity: 1;
  }
</style>
