<script lang="ts">
  import { state, showImage, hideImage } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let imageUrl = '';
  let imageDuration = 3000; // Default 3 seconds
  let useDuration = true;

  $: hasSelection = $state.selectedClientIds.length > 0;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleShow(toAll = false) {
    if (!imageUrl) return;
    showImage(
      imageUrl,
      useDuration ? { duration: imageDuration } : undefined,
      toAll,
      getExecuteAt()
    );
  }

  function handleHide(toAll = false) {
    hideImage(toAll);
  }
</script>

<Card title="🖼️ Image Display">
  <div class="control-group">
    <Input label="Image URL" placeholder="https://..." bind:value={imageUrl} />

    <div class="duration-row">
      <label class="duration-toggle">
        <input type="checkbox" bind:checked={useDuration} />
        <span>Auto-hide</span>
      </label>
      {#if useDuration}
        <Slider
          label="Duration"
          bind:value={imageDuration}
          min={500}
          max={30000}
          step={500}
          suffix="ms"
        />
      {/if}
    </div>

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection || !imageUrl}
        on:click={() => handleShow(false)}
        fullWidth
      >
        Show Selected
      </Button>
      <Button variant="secondary" disabled={!imageUrl} on:click={() => handleShow(true)} fullWidth>
        Show All
      </Button>
    </div>

    <div class="button-group">
      <Button
        variant="danger"
        disabled={!hasSelection}
        on:click={() => handleHide(false)}
        fullWidth
      >
        Hide Selected
      </Button>
      <Button variant="ghost" on:click={() => handleHide(true)} fullWidth>Hide All</Button>
    </div>
  </div>
</Card>

<style>
  .control-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .duration-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .duration-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
