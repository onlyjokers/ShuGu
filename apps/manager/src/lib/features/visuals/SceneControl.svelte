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

  // selectedScene, asciiOn, asciiRes managed by controlState

  const scenes = [
    { value: 'box-scene', label: '3D Box' },
    { value: 'mel-scene', label: 'Mel Spectrogram' },
  ];

  $: hasSelection = $state.selectedClientIds.length > 0;

  function handleAsciiChange(e: Event) {
    const target = e.target as HTMLInputElement;
    updateControlState({ asciiOn: target.checked });
  }

  function handleAsciiResInput(e: Event) {
    const target = e.target as HTMLInputElement;
    updateControlState({ asciiResolution: Number(target.value) });
  }

  function handleSceneChange(e: CustomEvent<Event>) {
    const raw = e.detail;
    const next = (raw.target as HTMLSelectElement | null)?.value;
    if (!next) return;
    updateControlState({ selectedScene: next });
  }

  function getExecuteAt() {
    if (!useSync) return undefined;
    return Date.now() + $state.timeSync.offset + syncDelay;
  }

  function handleSwitchScene(toAll = false) {
    switchScene($controlState.selectedScene, toAll, getExecuteAt());
    // updateControlState({ selectedScene }); // No need to update store as it's already source of truth
  }

  function handleAsciiToggle(toAll = false) {
    asciiMode($controlState.asciiOn, toAll, getExecuteAt());
  }

  function handleAsciiResolution(toAll = false) {
    asciiResolution(Number($controlState.asciiResolution), toAll, getExecuteAt());
  }
</script>

<Card title="🎬 Scene & Effects">
  <div class="control-group">
    <div class="section">
      <Select
        label="Visual Scene"
        options={scenes}
        value={$controlState.selectedScene}
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
        checked={$controlState.asciiOn}
        description="Retro text effect"
        on:change={handleAsciiChange}
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
        value={$controlState.asciiResolution}
        suffix=" px"
        on:input={handleAsciiResInput}
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
