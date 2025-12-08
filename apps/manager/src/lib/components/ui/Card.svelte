<script lang="ts">
  export let title: string = '';
  export let variant: 'default' | 'glass' = 'glass';

  let className = '';
  export { className as class };

  $: baseClass = variant === 'glass' ? 'card card-glass' : 'card';
</script>

<div class="{baseClass} {className}">
  {#if title}
    <div class="card-header">
      <h3 class="card-title">{title}</h3>
      <div class="card-actions">
        <slot name="actions" />
      </div>
    </div>
  {/if}
  <div class="card-content">
    <slot />
  </div>
</div>

<style>
  .card-actions {
    display: flex;
    gap: var(--space-sm);
  }
</style>
