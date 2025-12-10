<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '../../../parameters/parameter';
  import { createParamStore } from '../../../stores/param-store';

  export let parameter: Parameter<number>;

  const dispatch = createEventDispatcher();
  const state = createParamStore(parameter);

  let isDragging = false;

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    state.set(Number(target.value));
  }

  // Calculate percentage for visualization
  $: min = parameter.min ?? 0;
  $: max = parameter.max ?? 100;
  $: range = max - min;

  // Effective Value Bar (The "Ghost" / Real output)
  $: effectivePercent = Math.max(0, Math.min(100, (($state.effective - min) / range) * 100));
</script>

<div
  class="widget-container"
  class:offline={$state.isOffline}
  on:contextmenu|preventDefault={(e) => dispatch('contextmenu', e)}
>
  <div class="header">
    <label class="label">
      {parameter.metadata?.label || parameter.path}
    </label>
    <span class="value">{$state.effective.toFixed(2)} {parameter.metadata?.unit || ''}</span>
  </div>

  <div class="slider-track-container">
    <!-- Modulation Ghost Bar (Background) -->
    <div class="modulation-bar" style="width: {effectivePercent}%;"></div>

    <!-- The Knob (User Input) -->
    <input
      type="range"
      class="range-input"
      value={$state.base}
      {min}
      {max}
      step={parameter.metadata?.step || 0.01}
      disabled={$state.isOffline}
      on:input={handleInput}
      on:mousedown={() => (isDragging = true)}
      on:mouseup={() => (isDragging = false)}
    />
  </div>
</div>

<style>
  .widget-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
    opacity: 1;
    transition: opacity 0.2s;
  }

  .widget-container.offline {
    opacity: 0.5;
    pointer-events: none;
  }

  .header {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: #cbd5e1;
  }

  .value {
    font-family: monospace;
    color: #94a3b8;
  }

  /* Dual Layer Slider */
  .slider-track-container {
    position: relative;
    height: 24px;
    display: flex;
    align-items: center;
  }

  /* 1. Underlying Modulation Visualizer */
  .modulation-bar {
    position: absolute;
    top: 8px; /* Vertically centered-ish behind thumb */
    bottom: 8px;
    left: 0;
    background: rgba(99, 102, 241, 0.5); /* Indigo with opacity */
    border-radius: 4px;
    pointer-events: none;
    z-index: 0;
    transition: width 0.05s linear; /* Fast but smooth update */
  }

  /* 2. User Input (The Knob) */
  .range-input {
    position: relative;
    z-index: 1; /* Above mod bar */
    width: 100%;
    margin: 0;
    -webkit-appearance: none;
    appearance: none;
    background: transparent; /* Transparent track so we see mod bar */
    cursor: pointer;
  }

  /* Thumb Styling */
  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 16px;
    width: 16px;
    border-radius: 50%;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    margin-top: -6px; /* Center on track */
  }

  /* Track Styling (Invisible/Subtle mostly) */
  .range-input::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }
</style>
