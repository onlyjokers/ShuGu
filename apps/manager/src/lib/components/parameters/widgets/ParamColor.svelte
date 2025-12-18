<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '$lib/parameters/parameter';
  import { createParamStore, type ParamStore } from '$lib/stores/param-store';

  export let parameter: Parameter<string>;
  export let label: string | undefined = undefined;

  let className = '';
  export { className as class };

  const dispatch = createEventDispatcher<{
    contextmenu: { parameter: Parameter<string>; event: MouseEvent };
  }>();

  let store: ParamStore<string>;
  let base: string;
  let isOffline: boolean;

  $: store = createParamStore(parameter);
  $: ({ base, isOffline } = $store);

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    store.set(target.value);
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch('contextmenu', { parameter, event: e });
  }

  $: displayLabel = label ?? parameter.metadata?.label ?? parameter.path.split('/').pop();
</script>

<div
  class="param-color {className}"
  class:offline={isOffline}
  on:contextmenu={handleContextMenu}
  role="group"
>
  <label class="color-label" for="color-{parameter.path}">{displayLabel}</label>
  <div class="color-inputs">
    <input
      type="color"
      class="color-picker"
      value={base}
      on:input={handleInput}
      disabled={isOffline}
      id="color-{parameter.path}"
    />
    <input
      type="text"
      class="color-text"
      value={base}
      on:input={handleInput}
      disabled={isOffline}
      placeholder="#000000"
    />
  </div>
</div>

<style>
  .param-color {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs, 4px);
    width: 100%;
    transition: opacity 0.2s;
  }

  .param-color.offline {
    opacity: 0.4;
    pointer-events: none;
  }

  .color-label {
    font-size: var(--text-sm, 0.875rem);
    color: var(--text-secondary, #a0a0a0);
  }

  .color-inputs {
    display: flex;
    gap: var(--space-sm, 8px);
    align-items: center;
  }

  .color-picker {
    width: 40px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    background: transparent;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: 2px solid var(--border-color, #4a4a4a);
    border-radius: var(--radius-sm, 4px);
  }

  .color-text {
    flex: 1;
    padding: var(--space-xs, 4px) var(--space-sm, 8px);
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--border-color, #4a4a4a);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary, #ffffff);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm, 0.875rem);
  }

  .color-text:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }
</style>
