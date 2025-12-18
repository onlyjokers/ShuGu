<script lang="ts">
  import { state, flashlight } from '$lib/stores/manager';
  import { controlState, updateControlState } from '$lib/stores/controlState';
  import { parameterRegistry, parameterWritable } from '$lib/parameters';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import { streamEnabled } from '$lib/streaming/streaming';
  import { onDestroy } from 'svelte';

  export let useSync = true;
  export let syncDelay = 500;

  const frequencyHz = parameterWritable(
    parameterRegistry.get<number>('controls/flashlight/frequencyHz')!
  );
  const blinkDutyCycle = parameterWritable(
    parameterRegistry.get<number>('controls/flashlight/dutyCycle')!
  );
  const durationMs = parameterWritable(
    parameterRegistry.get<number>('controls/flashlight/durationMs')!
  );
  let playing = false;
  let playingUntil = 0;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: $controlState; // keep reactive tie to shared state

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function scheduleStop(toAll = false) {
    if (stopTimer) clearTimeout(stopTimer);
    if ($durationMs <= 0) return;
    stopTimer = setTimeout(() => {
      flashlight('off', undefined, toAll, getExecuteAt());
      playing = false;
    }, $durationMs);
    playingUntil = Date.now() + $durationMs;
  }

  function buildPayload() {
    if ($frequencyHz <= 1) {
      return { mode: 'on' as const };
    }
    return {
      mode: 'blink' as const,
      frequency: $frequencyHz,
      dutyCycle: $blinkDutyCycle,
    };
  }

  function handleFlashlight(toAll = false) {
    const payload = buildPayload();
    flashlight(payload.mode, payload.frequency ? { frequency: payload.frequency, dutyCycle: payload.dutyCycle } : undefined, toAll, getExecuteAt());
    updateControlState({ flashlightOn: true });
    playing = true;
    if (playing) {
      scheduleStop(toAll);
    } else {
      if (stopTimer) clearTimeout(stopTimer);
    }
  }

  function handleStop(toAll = false) {
    if (stopTimer) clearTimeout(stopTimer);
    playing = false;
    playingUntil = 0;
    flashlight('off', undefined, toAll, getExecuteAt());
  }

  function queueUpdate() {
    if (!$streamEnabled) return;
    if (!hasSelection || !playing) return;
    if ($durationMs > 0 && Date.now() > playingUntil) return;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const payload = buildPayload();
      flashlight(
        payload.mode,
        payload.frequency ? { frequency: payload.frequency, dutyCycle: payload.dutyCycle } : undefined,
        false,
        getExecuteAt()
      );
    }, 30);
  }

  $: queueUpdate();

  onDestroy(() => {
    if (stopTimer) clearTimeout(stopTimer);
    if (updateTimer) clearTimeout(updateTimer);
  });

</script>

<Card title="💡 Flashlight">
  <div slot="actions">
    <!-- Optional header actions -->
  </div>

  <div class="control-group">
    <div class="sliders">
      <Slider
        label="Frequency"
        min={0.2}
        max={10}
        step={0.2}
        suffix=" Hz"
        bind:value={$frequencyHz}
      />
      <Slider
        label="Duty Cycle"
        min={0.1}
        max={0.9}
        step={0.05}
        suffix="%"
        bind:value={$blinkDutyCycle}
      />
    </div>

    <Slider
      label="Dur (ms)"
      min={0}
      max={8000}
      step={50}
      suffix=" ms"
      bind:value={$durationMs}
    />

    <div class="button-grid">
      <Button variant="primary" disabled={!hasSelection} on:click={() => handleFlashlight(false)} fullWidth>
        Play Selected
      </Button>
      <Button variant="secondary" on:click={() => handleFlashlight(true)} fullWidth>Play All</Button>
      <Button variant="ghost" disabled={!hasSelection} on:click={() => handleStop(false)} fullWidth>
        Stop Selected
      </Button>
      <Button variant="ghost" on:click={() => handleStop(true)} fullWidth>Stop All</Button>
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

  .button-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }
</style>
