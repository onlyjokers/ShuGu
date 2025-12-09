<script lang="ts">
  import { parameterRegistry, parameterWritable } from '$lib/parameters';
  import type { Parameter } from '$lib/parameters';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  export let path: string;
  export let label: string | undefined = undefined;
  export let description: string | undefined = undefined;
  export let disabled = false;

  let param: Parameter<any> | undefined;
  let store;
  let widget: string | undefined;
  let type: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  let step: number | undefined;
  let enumOptions:
    | {
        value: string;
        label?: string;
      }[]
    | undefined;

  $: param = parameterRegistry.get(path);
  $: store = param ? parameterWritable(param) : null;
  $: widget = param?.metadata?.widget;
  $: type = param?.type;
  $: min = param?.min;
  $: max = param?.max;
  $: enumOptions = param?.enumOptions as
    | {
        value: string;
        label?: string;
      }[]
    | undefined;
  $: step = param?.metadata?.step;

  function handleTrigger() {
    param?.setValue(true, 'ui');
    // Immediately reset to default to avoid sticky button
    param?.setValue(param.defaultValue, 'ui');
  }
</script>

{#if !param}
  <div class="param-missing">Missing param: {path}</div>
{:else if type === 'number' && (widget === 'slider' || widget === undefined)}
  <Slider
    bind:value={$store}
    {min}
    {max}
    step={step ?? 0.01}
    label={label ?? param.metadata?.label ?? param.path}
    disabled={disabled}
  />
{:else if type === 'number'}
  <Input
    type="number"
    bind:value={$store}
    min={min}
    max={max}
    step={step}
    label={label ?? param.metadata?.label ?? param.path}
    disabled={disabled}
  />
{:else if type === 'boolean'}
  <Toggle
    bind:checked={$store}
    label={label ?? param.metadata?.label ?? param.path}
    description={description ?? param.metadata?.description}
    class="param-toggle"
  />
{:else if type === 'enum'}
  <Select
    bind:value={$store}
    options={enumOptions?.map((opt) => ({
      value: opt.value,
      label: opt.label ?? opt.value,
    })) ?? []}
    label={label ?? param.metadata?.label ?? param.path}
    disabled={disabled}
  />
{:else if type === 'trigger'}
  <Button variant="secondary" size="sm" fullWidth on:click={handleTrigger} disabled={disabled}>
    {label ?? param.metadata?.label ?? param.path}
  </Button>
{:else}
  <Input
    bind:value={$store}
    label={label ?? param.metadata?.label ?? param.path}
    disabled={disabled}
  />
{/if}

<style>
  .param-missing {
    padding: var(--space-sm);
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    color: var(--color-warning);
    font-size: var(--text-sm);
  }

  .param-toggle {
    width: 100%;
  }
</style>
