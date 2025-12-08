<script lang="ts">
  import { state, playMedia, stopMedia, showImage, hideImage } from '$lib/stores/manager';
  import { interruptMedia } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import Select from '$lib/components/ui/Select.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let mediaUrl = '';
  let mediaVolume = 1;
  let mediaLoop = false;
  let mediaMuted = true;
  let mediaType: 'auto' | 'audio' | 'video' | 'image' = 'auto';
  let imageDuration = 3000;
  let useImageDuration = true;

  const mediaTypeOptions = [
    { value: 'auto', label: 'Auto Detect' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
    { value: 'image', label: 'Image' },
  ];

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: detectedType = getDetectedType(mediaUrl, mediaType);
  $: isImage = detectedType === 'image';
  $: isVideo = detectedType === 'video';

  function getDetectedType(url: string, type: typeof mediaType): 'audio' | 'video' | 'image' {
    if (type !== 'auto') return type as 'audio' | 'video' | 'image';

    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(url)) return 'image';
    if (/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(url)) return 'video';
    return 'audio';
  }

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handlePlay(toAll = false) {
    if (!mediaUrl) return;

    if (isImage) {
      showImage(
        mediaUrl,
        useImageDuration ? { duration: imageDuration } : undefined,
        toAll,
        getExecuteAt()
      );
    } else {
      playMedia(
        mediaUrl,
        {
          mediaType: detectedType as 'audio' | 'video',
          volume: mediaVolume,
          loop: mediaLoop,
          muted: isVideo ? mediaMuted : undefined,
        },
        toAll,
        getExecuteAt()
      );
    }
  }

  function handleStop(toAll = false) {
    if (isImage) {
      hideImage(toAll);
    } else {
      stopMedia(toAll);
    }
  }

  function handleInterrupt(toAll = false) {
    interruptMedia(toAll);
  }
</script>

<Card title="🎬 Media Player">
  <div class="control-group">
    <Input label="Media URL" placeholder="https://..." bind:value={mediaUrl} />

    <Select label="Type" options={mediaTypeOptions} bind:value={mediaType} />

    {#if !isImage}
      <Slider label="Volume" bind:value={mediaVolume} max={1} step={0.1} suffix="" />

      <div class="toggle-row">
        <Toggle label="Loop" bind:checked={mediaLoop} />
        {#if isVideo}
          <Toggle label="Muted" description="Video only" bind:checked={mediaMuted} />
        {/if}
      </div>
    {:else}
      <div class="image-options">
        <Toggle label="Auto-hide" bind:checked={useImageDuration} />
        {#if useImageDuration}
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
    {/if}

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection || !mediaUrl}
        on:click={() => handlePlay(false)}
        fullWidth
      >
        {isImage ? 'Show' : 'Play'} Selected
      </Button>
      <Button variant="secondary" disabled={!mediaUrl} on:click={() => handlePlay(true)} fullWidth>
        {isImage ? 'Show' : 'Play'} All
      </Button>
    </div>

    <div class="button-group">
      <Button
        variant="danger"
        disabled={!hasSelection}
        on:click={() => handleStop(false)}
        fullWidth
      >
        {isImage ? 'Hide' : 'Stop'} Selected
      </Button>
      <Button variant="ghost" on:click={() => handleStop(true)} fullWidth>
        {isImage ? 'Hide' : 'Stop'} All
      </Button>
    </div>

    <div class="button-group single">
      <Button variant="danger" on:click={() => handleInterrupt(true)} fullWidth>
        ⏹ Interrupt All Media
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

  .toggle-row {
    display: flex;
    gap: var(--space-lg);
  }

  .image-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }

  .button-group.single {
    grid-template-columns: 1fr;
  }
</style>
