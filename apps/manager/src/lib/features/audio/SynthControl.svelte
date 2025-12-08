<script lang="ts">
  import { state, modulateSound } from '$lib/stores/manager';
  import { controlState, updateControlState } from '$lib/stores/controlState';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Select from '$lib/components/ui/Select.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let modFrequency = 180;
  let modDuration = 200;
  let modVolume = 0.7;
  let modWaveform: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'square';
  let modDepth = 0;
  let modLfo = 12;

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: modFrequency = $controlState.modFrequency;

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleModulateSound(toAll = false) {
    modulateSound(
      {
        frequency: Number(modFrequency) || 180,
        duration: Number(modDuration) || 200,
        volume: Math.max(0, Math.min(1, Number(modVolume) || 0.7)),
        waveform: modWaveform,
        modFrequency: modDepth > 0 ? Number(modLfo) || 12 : undefined,
        modDepth: modDepth > 0 ? Math.max(0, Math.min(1, modDepth)) : undefined,
      },
      toAll,
      getExecuteAt()
    );
    updateControlState({ modFrequency: Number(modFrequency) || 180 });
  }

  const waveforms = [
    { value: 'square', label: 'Square (Buzzy)' },
    { value: 'sine', label: 'Sine' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sawtooth', label: 'Sawtooth' },
  ];
</script>

<Card title="🎛️ Synth">
  <div class="control-group">
    <div class="row">
      <Input
        type="number"
        label="Freq (Hz)"
        bind:value={modFrequency}
        min={20}
        max={2000}
        step={10}
      />
      <Input
        type="number"
        label="Dur (ms)"
        bind:value={modDuration}
        min={20}
        max={2000}
        step={10}
      />
    </div>

    <Slider label="Volume" bind:value={modVolume} min={0} max={1} step={0.05} suffix="" />

    <Select label="Waveform" options={waveforms} bind:value={modWaveform} />

    <div class="lfo-section">
      <Slider label="Wobble Depth" bind:value={modDepth} min={0} max={1} step={0.05} suffix="" />

      {#if modDepth > 0}
        <Input type="number" label="Wobble Rate (Hz)" bind:value={modLfo} min={1} max={40} />
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
