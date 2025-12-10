<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '../../../parameters/parameter';
  import { createParamStore } from '../../../stores/param-store';

  export let parameter: Parameter<boolean>;

  const dispatch = createEventDispatcher();
  const state = createParamStore(parameter);

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    state.set(target.checked);
  }
</script>

<div
  class="widget-container"
  class:offline={$state.isOffline}
  on:contextmenu|preventDefault={(e) => dispatch('contextmenu', e)}
>
  <label class="toggle-label">
    <input
      type="checkbox"
      checked={$state.base}
      disabled={$state.isOffline}
      on:change={handleChange}
    />
    <span class="text">{parameter.metadata?.label || parameter.path}</span>
  </label>
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

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: #cbd5e1;
    font-size: 0.9rem;
  }
</style>
