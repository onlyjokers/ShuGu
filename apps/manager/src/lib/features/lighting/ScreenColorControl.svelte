<script lang="ts">
  import { state, screenColor } from '$lib/stores/manager';
  import type { ScreenColorPayload } from '@shugu/protocol';
  import { parameterRegistry, parameterWritable } from '$lib/parameters';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { streamEnabled } from '$lib/streaming/streaming';
  import { onDestroy } from 'svelte';

  export let useSync = true;
  export let syncDelay = 500;

  const selectedColor = parameterWritable(
    parameterRegistry.get<string>('controls/screenColor/primary')!
  );
  const screenSecondaryColor = parameterWritable(
    parameterRegistry.get<string>('controls/screenColor/secondary')!
  );
  const screenWaveform = parameterWritable(
    parameterRegistry.get<string>('controls/screenColor/waveform')!
  );
  const screenFrequency = parameterWritable(
    parameterRegistry.get<number>('controls/screenColor/frequencyHz')!
  );
  const screenMinOpacity = parameterWritable(
    parameterRegistry.get<number>('controls/screenColor/minOpacity')!
  );
  const screenMaxOpacity = parameterWritable(
    parameterRegistry.get<number>('controls/screenColor/maxOpacity')!
  );
  const durationMs = parameterWritable(
    parameterRegistry.get<number>('controls/screenColor/durationMs')!
  );
  let playing = false;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
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

  function buildPayload(values: {
    color: string;
    secondaryColor: string;
    waveform: string;
    frequencyHz: number;
    minOpacity: number;
    maxOpacity: number;
  }): ScreenColorPayload {
    return {
      mode: 'modulate',
      color: values.color,
      secondaryColor: values.secondaryColor,
      opacity: values.maxOpacity,
      minOpacity: values.minOpacity,
      maxOpacity: values.maxOpacity,
      frequencyHz: values.frequencyHz,
      waveform: values.waveform as 'sine' | 'square' | 'triangle' | 'sawtooth',
    };
  }

  function handleScreenColor(toAll = false) {
    screenColor(
      buildPayload({
        color: $selectedColor,
        secondaryColor: $screenSecondaryColor,
        waveform: $screenWaveform,
        frequencyHz: $screenFrequency,
        minOpacity: $screenMinOpacity,
        maxOpacity: $screenMaxOpacity,
      }),
      undefined,
      toAll,
      getExecuteAt()
    );
    playing = true;
    if (stopTimer) clearTimeout(stopTimer);
    if ($durationMs > 0) {
      stopTimer = setTimeout(() => {
        handleClear(toAll);
      }, $durationMs);
      playingUntil = Date.now() + $durationMs;
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

  function queueUpdate(options: {
    streamEnabled: boolean;
    hasSelection: boolean;
    playing: boolean;
    durationMs: number;
    playingUntil: number;
    payload: ScreenColorPayload;
  }) {
    if (!options.streamEnabled) return;
    if (!options.hasSelection || !options.playing) return;
    if (options.durationMs > 0 && Date.now() > options.playingUntil) return;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      screenColor(options.payload, undefined, false, getExecuteAt());
    }, 30);
  }

  $: queueUpdate({
    streamEnabled: $streamEnabled,
    hasSelection,
    playing,
    durationMs: $durationMs,
    playingUntil,
    payload: buildPayload({
      color: $selectedColor,
      secondaryColor: $screenSecondaryColor,
      waveform: $screenWaveform,
      frequencyHz: $screenFrequency,
      minOpacity: $screenMinOpacity,
      maxOpacity: $screenMaxOpacity,
    }),
  });

  onDestroy(() => {
    if (stopTimer) clearTimeout(stopTimer);
    if (updateTimer) clearTimeout(updateTimer);
  });
</script>

<Card title="🎨 Screen Color">
  <div class="control-group">
    <div class="main-controls">
      <Input type="color" label="Primary" bind:value={$selectedColor} />
      <Input type="color" label="Secondary" bind:value={$screenSecondaryColor} />
    </div>

    <div class="opacity-row">
      <Slider label="Max Opacity" bind:value={$screenMaxOpacity} step={0.05} max={1} suffix="" />
      <Slider label="Min Opacity" bind:value={$screenMinOpacity} step={0.05} max={1} suffix="" />
    </div>

    <div class="params-section">
      <Select label="Waveform" options={waveforms} bind:value={$screenWaveform} />
      <Slider
        label="Frequency"
        bind:value={$screenFrequency}
        min={0.2}
        max={20}
        step={0.1}
        suffix=" Hz"
      />
      <Slider
        label="Dur (ms)"
        bind:value={$durationMs}
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

  /* .row unused */

  .button-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }
</style>
