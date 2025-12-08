<script lang="ts">
  export let checked = false;
  export let label = '';
  export let description = '';

  let className = '';
  export { className as class };
</script>

<label class="toggle-wrapper {className}">
  <div class="toggle-input">
    <input type="checkbox" bind:checked on:change />
    <span class="toggle-slider"></span>
  </div>
  {#if label}
    <div class="toggle-text">
      <span class="toggle-label">{label}</span>
      {#if description}
        <span class="toggle-description">{description}</span>
      {/if}
    </div>
  {/if}
</label>

<style>
  .toggle-wrapper {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    cursor: pointer;
  }

  .toggle-input {
    position: relative;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }

  .toggle-input input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--bg-tertiary);
    transition: 0.4s;
    border-radius: 34px;
    border: 1px solid var(--border-color);
  }

  .toggle-slider:before {
    position: absolute;
    content: '';
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: var(--text-muted);
    transition: 0.4s;
    border-radius: 50%;
  }

  input:checked + .toggle-slider {
    background-color: var(--color-primary-dark);
    border-color: var(--color-primary);
  }

  input:checked + .toggle-slider:before {
    transform: translateX(20px);
    background-color: white;
  }

  .toggle-text {
    display: flex;
    flex-direction: column;
  }

  .toggle-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .toggle-description {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
