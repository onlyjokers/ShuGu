<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '$lib/parameters/parameter';
  import { createParamStore, type ParamStore } from '$lib/stores/param-store';

  export let parameter: Parameter<boolean>;
  export let label: string | undefined = undefined;
  export let description: string | undefined = undefined;

  let className = '';
  export { className as class };

  const dispatch = createEventDispatcher<{
    contextmenu: { parameter: Parameter<boolean>; event: MouseEvent };
  }>();

  let store: ParamStore<boolean>;
  let base: boolean;
  let isOffline: boolean;

  $: store = createParamStore(parameter);
  $: ({ base, isOffline } = $store);

  function handleChange() {
    store.set(!base);
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    dispatch('contextmenu', { parameter, event: e });
  }

  $: displayLabel = label ?? parameter.metadata?.label ?? parameter.path.split('/').pop();
  $: displayDesc = description ?? parameter.metadata?.description;
</script>

<div
  class="param-toggle {className}"
  class:offline={isOffline}
  on:contextmenu={handleContextMenu}
  role="group"
>
  <label class="toggle-label">
    <input type="checkbox" checked={base} on:change={handleChange} disabled={isOffline} />
    <span class="toggle-track">
      <span class="toggle-thumb" class:on={base}></span>
    </span>
    <span class="toggle-text">
      <span class="toggle-title">{displayLabel}</span>
      {#if displayDesc}
        <span class="toggle-desc">{displayDesc}</span>
      {/if}
    </span>
  </label>
</div>

<style>
  .param-toggle {
    width: 100%;
    transition: opacity 0.2s;
  }

  .param-toggle.offline {
    opacity: 0.4;
    pointer-events: none;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    cursor: pointer;
  }

  .toggle-label input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .toggle-track {
    position: relative;
    width: 40px;
    height: 22px;
    background: var(--bg-tertiary, #3a3a3a);
    border-radius: 11px;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle-label input:checked + .toggle-track {
    background: var(--color-primary, #6366f1);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: var(--text-primary, #ffffff);
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-thumb.on {
    transform: translateX(18px);
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-title {
    font-size: var(--text-sm, 0.875rem);
    color: var(--text-primary, #ffffff);
  }

  .toggle-desc {
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-secondary, #a0a0a0);
  }
</style>
