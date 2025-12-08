<script lang="ts">
  import { state, screenColor } from '$lib/stores/manager';
  import type { ScreenColorPayload } from '@shugu/protocol';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Select from '$lib/components/ui/Select.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let selectedColor = '#6366f1';
  let colorOpacity = 1;
  let screenMode: 'solid' | 'blink' | 'pulse' | 'cycle' | 'modulate' = 'solid';

  // Blink params
  let screenBlinkFrequency = 2;

  // Pulse params
  let screenPulseDuration = 1200;
  let screenPulseMin = 0.2;

  // Cycle params
  let screenCycleColors = '#6366f1,#22d3ee,#a855f7';
  let screenCycleDuration = 4000;

  // Modulate/Common params
  let screenWaveform: 'sine' | 'square' | 'triangle' | 'sawtooth' = 'sine';
  let screenFrequency = 1.5;
  let screenMinOpacity = 0;
  let screenMaxOpacity = 1;
  let screenSecondaryColor = '#ffffff';

  const modes = [
    { value: 'solid', label: 'Solid' },
    { value: 'blink', label: 'Blink' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'cycle', label: 'Cycle' },
    { value: 'modulate', label: 'Modulate (Adv)' },
  ];

  const waveforms = [
    { value: 'sine', label: 'Sine' },
    { value: 'square', label: 'Square' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Sawtooth' },
  ];

  $: hasSelection = $state.selectedClientIds.length > 0;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleScreenColor(toAll = false) {
    const payload: ScreenColorPayload = {
      mode: screenMode,
      color: selectedColor,
      opacity: colorOpacity,
    };

    if (screenMode === 'blink') {
      payload.blinkFrequency = screenBlinkFrequency;
    } else if (screenMode === 'pulse') {
      payload.pulseDuration = screenPulseDuration;
      payload.pulseMin = screenPulseMin;
      payload.waveform = screenWaveform;
    } else if (screenMode === 'cycle') {
      const colors = screenCycleColors
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (colors.length >= 2) payload.cycleColors = colors;
      payload.cycleDuration = screenCycleDuration;
    } else if (screenMode === 'modulate') {
      payload.waveform = screenWaveform;
      payload.frequencyHz = screenFrequency;
      payload.minOpacity = screenMinOpacity;
      payload.maxOpacity = screenMaxOpacity;
      if (screenSecondaryColor) payload.secondaryColor = screenSecondaryColor;
    }

    screenColor(payload, undefined, toAll, getExecuteAt());
  }

  function handleClear(toAll = false) {
    screenColor(
      { color: 'transparent', opacity: 0, mode: 'solid' },
      undefined,
      toAll,
      getExecuteAt()
    );
  }
</script>

<Card title="🎨 Screen Color">
  <div class="control-group">
    <div class="main-controls">
      <Select label="Mode" options={modes} bind:value={screenMode} />
      <Input type="color" label="Color" bind:value={selectedColor} />
    </div>

    <Slider label="Opacity" bind:value={colorOpacity} step={0.05} max={1} suffix="" />

    <div class="params-section">
      {#if screenMode === 'blink'}
        <Slider
          label="Frequency"
          bind:value={screenBlinkFrequency}
          min={0.5}
          max={10}
          step={0.5}
          suffix=" Hz"
        />
      {:else if screenMode === 'pulse'}
        <Slider
          label="Duration"
          bind:value={screenPulseDuration}
          min={300}
          max={4000}
          step={100}
          suffix=" ms"
        />
        <Slider label="Min Opacity" bind:value={screenPulseMin} step={0.05} max={1} suffix="" />
        <Select label="Waveform" options={waveforms} bind:value={screenWaveform} />
      {:else if screenMode === 'cycle'}
        <Input label="Colors (csv)" bind:value={screenCycleColors} />
        <Slider
          label="Duration"
          bind:value={screenCycleDuration}
          min={600}
          max={8000}
          step={200}
          suffix=" ms"
        />
      {:else if screenMode === 'modulate'}
        <Select label="Waveform" options={waveforms} bind:value={screenWaveform} />
        <Slider
          label="Freq"
          bind:value={screenFrequency}
          min={0.2}
          max={20}
          step={0.1}
          suffix=" Hz"
        />
        <div class="row">
          <Slider label="Min Op" bind:value={screenMinOpacity} step={0.05} max={1} suffix="" />
          <Slider label="Max Op" bind:value={screenMaxOpacity} step={0.05} max={1} suffix="" />
        </div>
        <Input type="color" label="Secondary Color" bind:value={screenSecondaryColor} />
      {/if}
    </div>

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection}
        on:click={() => handleScreenColor(false)}
        fullWidth>Apply Selected</Button
      >
      <Button variant="secondary" on:click={() => handleScreenColor(true)} fullWidth
        >Apply All</Button
      >
    </div>
    <Button variant="ghost" on:click={() => handleClear(true)} fullWidth>Clear All Screens</Button>
  </div>
</Card>

<style>
  .control-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .main-controls {
    display: grid;
    grid-template-columns: 1fr 80px;
    gap: var(--space-md);
    align-items: start;
  }

  .params-section {
    padding: var(--space-sm);
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
