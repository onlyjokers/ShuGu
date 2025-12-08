<script lang="ts">
  export let value: number;
  export let min = 0;
  export let max = 100;
  export let step = 1;
  export let label = '';
  export let suffix = '';
  export let disabled = false;

  let className = '';
  export { className as class };
</script>

<div class="slider-wrapper {className}">
  <div class="slider-header">
    {#if label}
      <label class="control-label" for="slider-{label}">{label}</label>
    {/if}
    <span class="value-display">{Number(value).toFixed(step < 1 ? 1 : 0)}{suffix}</span>
  </div>

  <input
    type="range"
    class="range-slider"
    {min}
    {max}
    {step}
    bind:value
    {disabled}
    id={label ? `slider-${label}` : undefined}
    on:input
  />
</div>

<style>
  .slider-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: 100%;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .value-display {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-accent);
  }
</style>
