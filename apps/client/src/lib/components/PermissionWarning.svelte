<script lang="ts">
  import { permissions } from '$lib/stores/client';

  $: failedPermissions = Object.entries($permissions)
    .filter(([_, status]) => status === 'denied')
    .map(([name]) => name);
</script>

{#if failedPermissions.length > 0}
  <div class="permission-warning">
    <span class="warning-icon">⚠️</span>
    <span class="warning-text">
      Some features unavailable: {failedPermissions.join(', ')}
    </span>
  </div>
{/if}

<style>
  .permission-warning {
    position: fixed;
    top: var(--space-md, 1rem);
    right: var(--space-md, 1rem);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    border-radius: 8px;
    font-size: 0.875rem;
    color: white;
    z-index: 100;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
