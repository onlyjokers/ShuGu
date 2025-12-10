<script lang="ts">
  import type { Parameter } from '../../parameters/parameter';
  import ParamSlider from './widgets/ParamSlider.svelte';
  import ParamToggle from './widgets/ParamToggle.svelte';
  import ParamColor from './widgets/ParamColor.svelte';

  export let parameter: Parameter<any>;

  // Infer widget type if not explicitly set
  $: type = parameter.metadata?.widgetType || inferWidgetType(parameter);

  function inferWidgetType(p: Parameter<any>): string {
    if (p.type === 'number') return 'slider';
    if (p.type === 'boolean') return 'toggle';
    if (p.type === 'string' && (p.path.includes('color') || p.path.includes('Color')))
      return 'color';
    return 'unknown';
  }
</script>

{#if type === 'slider' && parameter.type === 'number'}
  <ParamSlider {parameter} on:contextmenu />
{:else if type === 'toggle' && parameter.type === 'boolean'}
  <ParamToggle {parameter} on:contextmenu />
{:else if type === 'color'}
  <ParamColor {parameter} on:contextmenu />
{:else}
  <!-- Fallback or Unknown -->
  <div class="fallback-widget">
    <span>{parameter.metadata?.label || parameter.path} ({parameter.type})</span>
  </div>
{/if}

<style>
  .fallback-widget {
    padding: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: #94a3b8;
    font-size: 0.8rem;
  }
</style>
