<script lang="ts">
  import { state, switchScene, asciiMode, asciiResolution } from '$lib/stores/manager';
  import { controlState, updateControlState } from '$lib/stores/controlState';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';

  export let useSync = true;
  export let syncDelay = 500;

  let selectedScene = 'box-scene';
  let asciiOn = true;
  let asciiRes = 11;

  const scenes = [
    { value: 'box-scene', label: '3D Box' },
    { value: 'mel-scene', label: 'Mel Spectrogram' },
  ];

  $: hasSelection = $state.selectedClientIds.length > 0;
  $: selectedScene = $controlState.selectedScene;
  $: asciiOn = $controlState.asciiOn;
  $: asciiRes = $controlState.asciiResolution;

  function handleSceneChange(e: CustomEvent<Event>) {
    const raw = e.detail;
    const next = (raw.target as HTMLSelectElement | null)?.value;
    if (!next) return;
    selectedScene = next;
    updateControlState({ selectedScene: next });
  }

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleSwitchScene(toAll = false) {
    switchScene(selectedScene, toAll, getExecuteAt());
    updateControlState({ selectedScene });
  }

  function handleAsciiToggle(toAll = false) {
    asciiMode(asciiOn, toAll, getExecuteAt());
    updateControlState({ asciiOn });
  }

  function handleAsciiResolution(toAll = false) {
    asciiResolution(Number(asciiRes), toAll, getExecuteAt());
    updateControlState({ asciiResolution: Number(asciiRes) });
  }
</script>

<Card title="🎬 Scene & Effects">
  <div class="control-group">
    <div class="section">
      <Select
        label="Visual Scene"
        options={scenes}
        bind:value={selectedScene}
        on:change={handleSceneChange}
      />
      <div class="button-group">
        <Button
          variant="primary"
          disabled={!hasSelection}
          on:click={() => handleSwitchScene(false)}
          fullWidth>Switch Selected</Button
        >
        <Button variant="secondary" on:click={() => handleSwitchScene(true)} fullWidth
          >Switch All</Button
        >
      </div>
    </div>

    <div class="separator"></div>

    <div class="section">
      <Toggle
        label="ASCII Overlay"
        bind:checked={asciiOn}
        description="Retro text effect"
        on:change={() => updateControlState({ asciiOn })}
      />
      <div class="button-group">
        <Button
          variant="primary"
          disabled={!hasSelection}
          on:click={() => handleAsciiToggle(false)}
          fullWidth>Apply Selected</Button
        >
        <Button variant="secondary" on:click={() => handleAsciiToggle(true)} fullWidth
          >Apply All</Button
        >
      </div>
    </div>

    <div class="section">
      <Slider
        label="ASCII Resolution"
        min={6}
        max={24}
        step={1}
        bind:value={asciiRes}
        suffix=" px"
        on:input={() => updateControlState({ asciiResolution: Number(asciiRes) })}
      />
      <div class="button-group">
        <Button
          variant="secondary"
          disabled={!hasSelection}
          on:click={() => handleAsciiResolution(false)}
          fullWidth>Set Selected</Button
        >
        <Button variant="secondary" on:click={() => handleAsciiResolution(true)} fullWidth
          >Set All</Button
        >
      </div>
    </div>
  </div>
</Card>

<style>
  .control-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .separator {
    height: 1px;
    background: var(--border-color);
  }

  .button-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
</style>
