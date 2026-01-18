<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Parameter } from '$lib/parameters/parameter';
  import ParamSlider from './widgets/ParamSlider.svelte';
  import ParamToggle from './widgets/ParamToggle.svelte';
  import ParamColor from './widgets/ParamColor.svelte';
  import ParamSelect from './widgets/ParamSelect.svelte';

  export let parameter: Parameter<unknown>;
  export let label: string | undefined = undefined;

  const dispatch = createEventDispatcher<{
    contextmenu: { parameter: Parameter<unknown>; event: MouseEvent };
  }>();

  const dispatchContextMenu = (event: MouseEvent) => {
    dispatch('contextmenu', { parameter, event });
  };

  const forwardContextMenu = (e: CustomEvent<{ parameter: unknown; event: MouseEvent }>) => {
    dispatchContextMenu(e.detail.event);
  };

  // Determine widget type
  $: widgetType = parameter.metadata?.widgetType ?? inferWidgetType(parameter);

  let numberParameter: Parameter<number> | null = null;
  let booleanParameter: Parameter<boolean> | null = null;
  let stringParameter: Parameter<string> | null = null;

  $: {
    numberParameter = null;
    booleanParameter = null;
    stringParameter = null;

    if (widgetType === 'slider' || widgetType === 'knob') {
      numberParameter = parameter as unknown as Parameter<number>;
    } else if (widgetType === 'toggle') {
      booleanParameter = parameter as unknown as Parameter<boolean>;
    } else if (widgetType === 'color' || widgetType === 'select') {
      stringParameter = parameter as unknown as Parameter<string>;
    }
  }

  function inferWidgetType(param: Parameter<unknown>): string {
    switch (param.type) {
      case 'number':
        return 'slider';
      case 'boolean':
        return 'toggle';
      case 'enum':
        return 'select';
      case 'color':
        return 'color';
      case 'string':
        // Check if it looks like a color
        if (param.path.includes('color') || param.metadata?.widgetType === 'color') {
          return 'color';
        }
        return 'input';
      default:
        return 'input';
    }
  }
</script>

{#if (widgetType === 'slider' || widgetType === 'knob') && numberParameter}
  <ParamSlider parameter={numberParameter} {label} on:contextmenu={forwardContextMenu} />
{:else if widgetType === 'toggle' && booleanParameter}
  <ParamToggle parameter={booleanParameter} {label} on:contextmenu={forwardContextMenu} />
{:else if widgetType === 'color' && stringParameter}
  <ParamColor parameter={stringParameter} {label} on:contextmenu={forwardContextMenu} />
{:else if widgetType === 'select' && stringParameter}
  <ParamSelect parameter={stringParameter} {label} on:contextmenu={forwardContextMenu} />
{:else}
  <!-- Fallback: simple text display -->
  <div class="param-fallback">
    <span class="fallback-label">{label ?? parameter.path}</span>
    <span class="fallback-value">{parameter.effectiveValue}</span>
  </div>
{/if}

<style>
  .param-fallback {
    display: flex;
    justify-content: space-between;
    padding: var(--space-sm, 8px);
    background: var(--bg-tertiary, #2a2a2a);
    border-radius: var(--radius-sm, 4px);
  }

  .fallback-label {
    color: var(--text-secondary, #a0a0a0);
    font-size: var(--text-sm, 0.875rem);
  }

  .fallback-value {
    color: var(--text-primary, #ffffff);
    font-family: var(--font-mono, monospace);
  }
</style>
