<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon' = 'primary';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let disabled = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let fullWidth = false;

  let className = '';
  export { className as class };

  $: btnClass = `btn btn-${variant} btn-${size} ${fullWidth ? 'w-full' : ''} ${className}`;
</script>

<button {type} class={btnClass} {disabled} on:click>
  <slot />
</button>

<style>
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
  }
  .btn-ghost:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }
</style>
