<script lang="ts">
  import { state, screenColor } from '$lib/stores/manager';
  import type { ScreenColorPayload } from '@shugu/protocol';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { streamEnabled } from '$lib/streaming/streaming';
  import { onDestroy } from 'svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let selectedColor = '#6366f1';
  let colorOpacity = 1;
  // Single unified Modulate model
  let screenWaveform: 'sine' | 'square' | 'triangle' | 'sawtooth' = 'sine';
  let screenFrequency = 1.5;
  let screenMinOpacity = 0;
  let screenMaxOpacity = 1;
  let screenSecondaryColor = '#ffffff';
  let playing = false;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  let durationMs = 2000;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let playingUntil = 0;

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

  function buildPayload(): ScreenColorPayload {
    return {
      mode: 'modulate',
      color: selectedColor,
      secondaryColor: screenSecondaryColor,
      opacity: screenMaxOpacity,
      minOpacity: screenMinOpacity,
      maxOpacity: screenMaxOpacity,
      frequencyHz: screenFrequency,
      waveform: screenWaveform,
    };
  }

  function handleScreenColor(toAll = false) {
    screenColor(buildPayload(), undefined, toAll, getExecuteAt());
    playing = true;
    if (stopTimer) clearTimeout(stopTimer);
    if (durationMs > 0) {
      stopTimer = setTimeout(() => {
        handleClear(toAll);
      }, durationMs);
      playingUntil = Date.now() + durationMs;
    } else {
      playingUntil = 0;
    }
  }

  function handleClear(toAll = false) {
    screenColor(
      { color: 'transparent', opacity: 0, mode: 'solid' },
      undefined,
      toAll,
      getExecuteAt()
    );
    playing = false;
    if (stopTimer) clearTimeout(stopTimer);
    playingUntil = 0;
  }

  function queueUpdate() {
    if (!$streamEnabled) return;
    if (!hasSelection || !playing) return;
    if (durationMs > 0 && Date.now() > playingUntil) return;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      screenColor(buildPayload(), undefined, false, getExecuteAt());
    }, 30);
  }

  $: queueUpdate();

  onDestroy(() => {
    if (stopTimer) clearTimeout(stopTimer);
    if (updateTimer) clearTimeout(updateTimer);
  });
</script>

<Card title="🎨 Screen Color">
  <div class="control-group">
    <div class="main-controls">
      <Input type="color" label="Primary" bind:value={selectedColor} />
      <Input type="color" label="Secondary" bind:value={screenSecondaryColor} />
    </div>

    <div class="opacity-row">
      <Slider label="Max Opacity" bind:value={screenMaxOpacity} step={0.05} max={1} suffix="" />
      <Slider label="Min Opacity" bind:value={screenMinOpacity} step={0.05} max={1} suffix="" />
    </div>

    <div class="params-section">
      <Select label="Waveform" options={waveforms} bind:value={screenWaveform} />
      <Slider
        label="Frequency"
        bind:value={screenFrequency}
        min={0.2}
        max={20}
        step={0.1}
        suffix=" Hz"
      />
      <Slider
        label="Dur (ms)"
        bind:value={durationMs}
        min={0}
        max={8000}
        step={50}
        suffix=" ms"
      />
    </div>

    <div class="button-grid">
      <Button
        variant="primary"
        disabled={!hasSelection}
        on:click={() => handleScreenColor(false)}
        fullWidth>Play Selected</Button
      >
      <Button variant="secondary" on:click={() => handleScreenColor(true)} fullWidth
        >Play All</Button
      >
      <Button variant="ghost" disabled={!hasSelection} on:click={() => handleClear(false)} fullWidth>
        Stop Selected
      </Button>
      <Button variant="ghost" on:click={() => handleClear(true)} fullWidth>Stop All</Button>
    </div>
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
    grid-template-columns: 1fr 1fr;
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

  .opacity-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }

  .button-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }
</style>
