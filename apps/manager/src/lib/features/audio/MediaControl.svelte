<script lang="ts">
  import { state, playSound } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let soundUrl = '';
  let soundVolume = 1;
  let soundLoop = false;

  $: hasSelection = $state.selectedClientIds.length > 0;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handlePlaySound(toAll = false) {
    if (!soundUrl) return;
    playSound(soundUrl, { volume: soundVolume, loop: soundLoop }, toAll, getExecuteAt());
  }
</script>

<Card title="🔊 Media Player">
  <div class="control-group">
    <Input label="Audio URL" placeholder="https://..." bind:value={soundUrl} />

    <Slider label="Volume" bind:value={soundVolume} max={1} step={0.1} suffix="" />

    <Toggle label="Loop" bind:checked={soundLoop} />

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection || !soundUrl}
        on:click={() => handlePlaySound(false)}
        fullWidth
      >
        Play Selected
      </Button>
      <Button
        variant="secondary"
        disabled={!soundUrl}
        on:click={() => handlePlaySound(true)}
        fullWidth
      >
        Play All
      </Button>
    </div>
  </div>
</Card>

<style>
  .control-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
