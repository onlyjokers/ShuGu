<script lang="ts">
  export let value: any;
  export let options: { value: any; label: string }[] = [];
  export let label = '';
  export let disabled = false;

  let className = '';
  export { className as class };
</script>

<div class="select-wrapper {className}">
  {#if label}
    <label class="control-label" for="select-{label}">{label}</label>
  {/if}

  <select class="select" bind:value {disabled} id={label ? `select-${label}` : undefined} on:change>
    {#each options as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>

<style>
  .select-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    width: 100%;
  }

  .select {
    width: 100%;
  }
</style>
