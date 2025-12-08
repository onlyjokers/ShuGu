<script lang="ts">
  import { state, flashlight } from '$lib/stores/manager';
  import { controlState, updateControlState } from '$lib/stores/controlState';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let flashlightMode: 'off' | 'on' | 'blink' = 'off';
  let blinkFrequency = 2;
  let blinkDutyCycle = 0.5;

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: flashlightMode = $controlState.flashlightOn
    ? (flashlightMode === 'blink' ? 'blink' : 'on')
    : 'off';

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleFlashlight(toAll = false) {
    const options =
      flashlightMode === 'blink'
        ? { frequency: blinkFrequency, dutyCycle: blinkDutyCycle }
        : undefined;
    flashlight(flashlightMode, options, toAll, getExecuteAt());
    updateControlState({ flashlightOn: flashlightMode !== 'off' });
  }

  const modeOptions = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On (Steady)' },
    { value: 'blink', label: 'Blink' },
  ];
</script>

<Card title="💡 Flashlight">
  <div slot="actions">
    <!-- Optional header actions -->
  </div>

  <div class="control-group">
    <Select label="Mode" options={modeOptions} bind:value={flashlightMode} />

    {#if flashlightMode === 'blink'}
      <div class="sliders">
        <Slider
          label="Frequency"
          min={0.5}
          max={10}
          step={0.5}
          suffix=" Hz"
          bind:value={blinkFrequency}
        />
        <Slider
          label="Duty Cycle"
          min={0.1}
          max={0.9}
          step={0.1}
          suffix="%"
          bind:value={blinkDutyCycle}
        />
      </div>
    {/if}

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection}
        on:click={() => handleFlashlight(false)}
        fullWidth
      >
        Apply to Selected
      </Button>
      <Button variant="secondary" on:click={() => handleFlashlight(true)} fullWidth>
        Apply to All
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

  .sliders {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
