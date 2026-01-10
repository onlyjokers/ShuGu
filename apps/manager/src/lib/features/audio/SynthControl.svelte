<script lang="ts">
  import {
    state,
    clientToneReadiness,
    modulateSound,
    modulateSoundUpdate,
    stopSound,
  } from '$lib/stores/manager';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { ParameterControl } from '$lib/components/parameters';
  import { parameterRegistry, parameterWritable } from '$lib/parameters';
  import { streamEnabled } from '$lib/streaming/streaming';

  export let useSync = true;
  export let syncDelay = 500;
  export let requireToneReady = false;

  let playingStartAt = 0;
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
  $: audienceIds = $state.clients.filter((c) => c.group !== 'display').map((c) => c.clientId);
  $: selectedIds = $state.selectedClientIds;

  $: selectedNotToneReadyCount = requireToneReady
    ? selectedIds.filter((id) => $clientToneReadiness.get(id)?.enabled !== true).length
    : 0;
  $: allNotToneReadyCount = requireToneReady
    ? audienceIds.filter((id) => $clientToneReadiness.get(id)?.enabled !== true).length
    : 0;

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

    const localStartAt = useSync ? Date.now() + syncDelay : Date.now();
    const active = Date.now() < playingUntil;

    if (active) {
      // If something is already playing, update parameters without re-triggering playback.
      modulateSoundUpdate(
        {
          frequency: freq,
          volume: vol,
          waveform: $waveform,
          modFrequency: depth > 0 ? lfo : undefined,
          modDepth: depth > 0 ? depth : undefined,
          durationMs: durMs,
        },
        toAll,
        getExecuteAt()
      );
      // Keep the original start time, but allow duration changes to adjust the planned end.
      playingUntil = (playingStartAt || localStartAt) + durMs + 200;
      return;
    }

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
    playingStartAt = localStartAt;
    playingUntil = localStartAt + durMs + 200; // basic release buffer
  }

  function queueUpdate(options: {
    streamEnabled: boolean;
    hasSelection: boolean;
    playingUntil: number;
    frequency: number;
    volume: number;
    waveform: SynthWaveform;
    modDepth: number;
    modLfo: number;
    durationMs: number;
  }) {
    if (!options.streamEnabled) return;
    if (!options.hasSelection) return;
    const now = Date.now();
    if (now > options.playingUntil) return; // nothing currently playing
    const depth = options.modDepth;
    const lfo = options.modLfo;

    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      modulateSoundUpdate(
        {
          frequency: options.frequency,
          volume: options.volume,
          waveform: options.waveform,
          modFrequency: depth > 0 ? lfo : undefined,
          modDepth: depth > 0 ? depth : undefined,
          durationMs: options.durationMs,
        },
        false,
        getExecuteAt()
      );
    }, 30);
  }

  // React to parameter changes while stream mode is on
  $: queueUpdate({
    streamEnabled: $streamEnabled,
    hasSelection,
    playingUntil,
    frequency: Number($frequency) || 180,
    volume: clamp01(Number($volume) || 0.7),
    waveform: $waveform,
    modDepth: Math.max(0, Math.min(1, Number($modDepth) || 0)),
    modLfo: Number($modLfo) || 12,
    durationMs: Number($duration) || 200,
  });

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
        disabled={!hasSelection || (requireToneReady && selectedNotToneReadyCount > 0)}
        on:click={() => handleModulateSound(false)}
        fullWidth
      >
        Play Selected
      </Button>
      <Button
        variant="secondary"
        disabled={requireToneReady && allNotToneReadyCount > 0}
        on:click={() => handleModulateSound(true)}
        fullWidth
      >
        Play All
      </Button>
      <Button
        variant="ghost"
        on:click={() => {
          playingStartAt = 0;
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
          playingStartAt = 0;
          playingUntil = 0;
          stopSound(true);
        }}
        fullWidth
      >
        Stop All
      </Button>
    </div>

    {#if requireToneReady && (selectedNotToneReadyCount > 0 || allNotToneReadyCount > 0)}
      <p class="tone-hint">
        Tone gate: {audienceIds.length - allNotToneReadyCount}/{audienceIds.length} audience ready.
      </p>
    {/if}
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

  .tone-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
