<script lang="ts">
  import { permissions } from '$lib/stores/client';

  $: failedPermissions = Object.entries($permissions)
    .filter(([_, status]) => status === 'denied')
    .map(([name]) => name);

  $: if (failedPermissions.length > 0) {
    console.warn('[Client] Some features unavailable:', failedPermissions.join(', '));
  }
</script>
