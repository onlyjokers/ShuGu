<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '../../../parameters/parameter';
  import { createParamStore } from '../../../stores/param-store';

  export let parameter: Parameter<string>; // Assuming string for Hex color

  const dispatch = createEventDispatcher();
  const state = createParamStore(parameter);

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    state.set(target.value);
  }
</script>

<div
  class="widget-container"
  class:offline={$state.isOffline}
  on:contextmenu|preventDefault={(e) => dispatch('contextmenu', e)}
>
  <div class="header">
    <span class="label">{parameter.metadata?.label || parameter.path}</span>
    <span class="value">{$state.effective}</span>
  </div>
  <div class="color-row">
    <input
      type="color"
      class="color-picker"
      value={$state.base}
      disabled={$state.isOffline}
      on:input={handleInput}
    />
  </div>
</div>

<style>
  .widget-container {
    padding: 8px 0;
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
    margin-bottom: 4px;
  }
  .value {
    font-family: monospace;
    color: #94a3b8;
  }
  .color-picker {
    width: 100%;
    height: 32px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
</style>
