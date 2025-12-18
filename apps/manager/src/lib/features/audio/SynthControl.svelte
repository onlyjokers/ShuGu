<script lang="ts">
  import { state, modulateSound, modulateSoundUpdate, stopSound } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { ParameterControl } from '$lib/components/parameters';
  import { parameterRegistry, parameterWritable } from '$lib/parameters';
  import { streamEnabled } from '$lib/streaming/streaming';

  export let useSync = true;
  export let syncDelay = 500;

  let playingUntil = 0;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;

  // Register & bind parameters (single source of truth)
  type SynthWaveform = 'sine' | 'square' | 'sawtooth' | 'triangle';
  const frequency = parameterWritable(parameterRegistry.get<number>('controls/synth/frequency')!);
  const duration = parameterWritable(parameterRegistry.get<number>('controls/synth/duration')!);
  const volume = parameterWritable(parameterRegistry.get<number>('controls/synth/volume')!);
  const modDepth = parameterWritable(parameterRegistry.get<number>('controls/synth/modDepth')!);
  const modLfo = parameterWritable(parameterRegistry.get<number>('controls/synth/modLfo')!);
  const waveform = parameterWritable(parameterRegistry.get<SynthWaveform>('controls/synth/waveform')!);

  $: hasSelection = $state.selectedClientIds.length > 0;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleModulateSound(toAll = false) {
    const durMs = Number($duration) || 200;
    const depth = Math.max(0, Math.min(1, Number($modDepth) || 0));
    const lfo = Number($modLfo) || 12;
    const freq = Number($frequency) || 180;
    const vol = clamp01(Number($volume) || 0.7);
    modulateSound(
      {
        frequency: freq,
        duration: durMs,
        volume: vol,
        waveform: $waveform,
        modFrequency: depth > 0 ? lfo : undefined,
        modDepth: depth > 0 ? depth : undefined,
      },
      toAll,
      getExecuteAt()
    );
    playingUntil = Date.now() + durMs + 200; // basic release buffer
  }

  function queueUpdate() {
    if (!$streamEnabled) return;
    if (!hasSelection) return;
    const now = Date.now();
    if (now > playingUntil) return; // nothing currently playing
    const depth = Math.max(0, Math.min(1, Number($modDepth) || 0));
    const lfo = Number($modLfo) || 12;

    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      modulateSoundUpdate(
        {
          frequency: Number($frequency) || 180,
          volume: clamp01(Number($volume) || 0.7),
          waveform: $waveform,
          modFrequency: depth > 0 ? lfo : undefined,
          modDepth: depth > 0 ? depth : undefined,
          durationMs: Number($duration) || 200,
        },
        false,
        getExecuteAt()
      );
    }, 30);
  }

  // React to parameter changes while stream mode is on
  $: queueUpdate();

  function clamp01(v: number) {
    return Math.max(0, Math.min(1, v));
  }
</script>

<Card title="🎛️ Synth">
  <div class="control-group">
    <div class="row">
      <ParameterControl path="controls/synth/frequency" />
      <ParameterControl path="controls/synth/duration" />
    </div>

    <ParameterControl path="controls/synth/volume" />
    <ParameterControl path="controls/synth/waveform" />

    <div class="lfo-section">
      <ParameterControl path="controls/synth/modDepth" />

      {#if $modDepth > 0}
        <ParameterControl path="controls/synth/modLfo" />
      {/if}
    </div>

    <div class="button-group">
      <Button
        variant="primary"
        disabled={!hasSelection}
        on:click={() => handleModulateSound(false)}
        fullWidth
      >
        Play Selected
      </Button>
      <Button variant="secondary" on:click={() => handleModulateSound(true)} fullWidth>
        Play All
      </Button>
      <Button
        variant="ghost"
        on:click={() => {
          playingUntil = 0;
          stopSound(false);
        }}
        fullWidth
      >
        Stop Selected
      </Button>
      <Button
        variant="ghost"
        on:click={() => {
          playingUntil = 0;
          stopSound(true);
        }}
        fullWidth
      >
        Stop All
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

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }

  .lfo-section {
    padding: var(--space-sm);
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
