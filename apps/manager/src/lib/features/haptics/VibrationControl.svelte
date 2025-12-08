<script lang="ts">
  import { state, vibrate } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { streamEnabled } from '$lib/streaming/streaming';

  export let useSync = true;
  export let syncDelay = 500;

  let vibratePattern = '200,100,200';
  let running = false;

  $: hasSelection = $state.selectedClientIds.length > 0;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleVibrate(toAll = false) {
    const pattern = vibratePattern
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n));
    vibrate(pattern, undefined, toAll, getExecuteAt());
    running = true;
  }

  function stopVibrate(toAll = false) {
    // send empty pattern to stop
    vibrate([], 0, toAll, getExecuteAt());
    running = false;
  }
</script>

<Card title="📳 Vibration">
  <div class="control-group">
    <Input label="Pattern (ms)" placeholder="200,100,200" bind:value={vibratePattern} />
    <p class="hint">Comma-separated: vibrate, pause, vibrate...</p>

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection}
        on:click={() => handleVibrate(false)}
        fullWidth
      >
        Vibrate Selected
      </Button>
      <Button variant="secondary" on:click={() => handleVibrate(true)} fullWidth>
        Vibrate All
      </Button>
      <Button variant="ghost" disabled={!hasSelection} on:click={() => stopVibrate(false)} fullWidth>
        Stop Selected
      </Button>
      <Button variant="ghost" on:click={() => stopVibrate(true)} fullWidth>Stop All</Button>
    </div>
  </div>
</Card>

<style>
  .control-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-top: -8px;
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
