<script lang="ts">
  export let value: string | number;
  export let type: 'text' | 'number' | 'password' | 'email' | 'color' = 'text';
  export let placeholder = '';
  export let label = '';
  export let min: number | undefined = undefined;
  export let max: number | undefined = undefined;
  export let step: number | undefined = undefined;
  export let disabled = false;
  export let width = 'full'; // 'full' | 'auto' | 'sm'

  let className = '';
  export { className as class };

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (type === 'number') {
      value = target.valueAsNumber;
    } else {
      value = target.value;
    }
  }
</script>

<div class="input-wrapper {className}">
  {#if label}
    <label class="control-label" for="input-{label}">{label}</label>
  {/if}

  {#if type === 'color'}
    <div class="color-input-group">
      <input {type} class="color-picker" {value} on:input={handleInput} {disabled} />
      <input
        type="text"
        class="input input-sm"
        {value}
        on:input={(e) => (value = e.currentTarget.value)}
        {disabled}
      />
    </div>
  {:else}
    <input
      {type}
      class="input input-{width}"
      {value}
      {placeholder}
      {min}
      {max}
      {step}
      {disabled}
      on:input={handleInput}
      id={label ? `input-${label}` : undefined}
    />
  {/if}
</div>

<style>
  .input-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: 100%;
  }

  .input-auto {
    width: auto;
  }
  .input-sm {
    width: 100px;
  }

  .color-input-group {
    display: flex;
    gap: var(--space-sm);
    align-items: center;
  }
</style>
