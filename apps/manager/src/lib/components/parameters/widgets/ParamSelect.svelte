<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '$lib/parameters/parameter';
  import type { EnumOption } from '$lib/parameters/types';
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
  $: options = (parameter.enumOptions ?? []) as EnumOption[];

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    store.set(target.value);
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch('contextmenu', { parameter, event: e });
  }

  $: displayLabel = label ?? parameter.metadata?.label ?? parameter.path.split('/').pop();
</script>

<div
  class="param-select {className}"
  class:offline={isOffline}
  on:contextmenu={handleContextMenu}
  role="group"
>
  <label class="select-label" for="select-{parameter.path}">{displayLabel}</label>
  <select
    class="select-input"
    value={base}
    on:change={handleChange}
    disabled={isOffline}
    id="select-{parameter.path}"
  >
    {#each options as opt}
      <option value={opt.value}>{opt.label ?? opt.value}</option>
    {/each}
  </select>
</div>

<style>
  .param-select {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs, 4px);
    width: 100%;
    transition: opacity 0.2s;
  }

  .param-select.offline {
    opacity: 0.4;
    pointer-events: none;
  }

  .select-label {
    font-size: var(--text-sm, 0.875rem);
    color: var(--text-secondary, #a0a0a0);
  }

  .select-input {
    padding: var(--space-sm, 8px);
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--border-color, #4a4a4a);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary, #ffffff);
    font-size: var(--text-sm, 0.875rem);
    cursor: pointer;
  }

  .select-input:focus {
    outline: none;
    border-color: var(--color-primary, #6366f1);
  }
</style>
