<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import { midiParamBridge, type MidiBinding } from '$lib/features/midi/midi-param-bridge';
  import { parameterRegistry } from '$lib/parameters/registry';
  import Button from '$lib/components/ui/Button.svelte';

  let inputs = midiService.inputs;
  let selectedInputId = midiService.selectedInputId;
  let lastMessage = midiService.lastMessage;
  let bindings = midiParamBridge.bindings;
  let learnMode = midiParamBridge.learnMode;

  let availableParams: { path: string; label: string }[] = [];
  let newTargetPath = '';

  onMount(async () => {
    await midiService.init();
    midiParamBridge.init();
    refreshParams();
  });

  onDestroy(() => {
    midiParamBridge.destroy();
  });

  function refreshParams() {
    const params = parameterRegistry.list();
    availableParams = params.map((p) => ({
      path: p.path,
      label: p.metadata?.label || p.path.split('/').pop() || p.path,
    }));
    if (availableParams.length > 0 && !newTargetPath) {
      newTargetPath = availableParams[0].path;
    }
  }

  function handleInputChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    midiService.selectInput(select.value);
  }

  function startLearn(targetPath: string) {
    midiParamBridge.startLearn(targetPath, 'REMOTE');
  }

  function cancelLearn() {
    midiParamBridge.cancelLearn();
  }

  function toggleMode(id: string) {
    midiParamBridge.toggleMode(id);
  }

  function removeBinding(id: string) {
    midiParamBridge.removeBinding(id);
  }

  function updateRange(id: string, field: 'min' | 'max', value: number) {
    const binding = $bindings.find((b) => b.id === id);
    if (!binding) return;
    midiParamBridge.updateBinding(id, {
      mapping: { ...binding.mapping, [field]: value },
    });
  }

  function toggleInvert(id: string) {
    const binding = $bindings.find((b) => b.id === id);
    if (!binding) return;
    midiParamBridge.updateBinding(id, {
      mapping: { ...binding.mapping, invert: !binding.mapping.invert },
    });
  }

  function describeSource(source: MidiBinding['source']): string {
    if (source.type === 'pitchbend') return `PitchBend ch${source.channel + 1}`;
    return `${source.type.toUpperCase()} ${source.number} ch${source.channel + 1}`;
  }

  function formatValue(value?: number): string {
    if (value === undefined) return '—';
    return value.toFixed(2);
  }

  function getInputValue(e: Event): number {
    return parseFloat((e.target as HTMLInputElement).value);
  }
</script>

<div class="registry-midi-panel">
  <div class="panel-header">
    <h2>Registry MIDI Mapper</h2>
    <div class="input-selector">
      <label for="midi-input">Input:</label>
      <select id="midi-input" value={$selectedInputId} on:change={handleInputChange}>
        {#if $inputs.length === 0}
          <option value="">No MIDI inputs</option>
        {:else}
          {#each $inputs as input}
            <option value={input.id}>{input.name}</option>
          {/each}
        {/if}
      </select>
      <Button variant="ghost" size="sm" on:click={refreshParams}>🔄</Button>
    </div>
  </div>

  <!-- MIDI Monitor -->
  <div class="monitor-section">
    <h3>MIDI Monitor</h3>
    <div class="monitor-display">
      {#if $lastMessage}
        <div class="monitor-row">
          <span class="label">Type:</span>
          <span class="value">{$lastMessage.type.toUpperCase()}</span>
        </div>
        <div class="monitor-row">
          <span class="label">Channel:</span>
          <span class="value">{$lastMessage.channel + 1}</span>
        </div>
        {#if $lastMessage.number !== undefined}
          <div class="monitor-row">
            <span class="label">Number:</span>
            <span class="value">{$lastMessage.number}</span>
          </div>
        {/if}
        <div class="monitor-row">
          <span class="label">Value:</span>
          <span class="value"
            >{$lastMessage.rawValue} ({($lastMessage.normalized * 100).toFixed(0)}%)</span
          >
        </div>
      {:else}
        <div class="monitor-empty">Move a MIDI control...</div>
      {/if}
    </div>
  </div>

  <!-- Learn Mode Indicator -->
  {#if $learnMode.active}
    <div class="learn-indicator">
      <span>🎹 Learning: Move a MIDI control for <strong>{$learnMode.targetPath}</strong></span>
      <Button variant="ghost" size="sm" on:click={cancelLearn}>Cancel</Button>
    </div>
  {/if}

  <!-- Quick Add -->
  <div class="quick-add">
    <h3>Quick Add Binding</h3>
    <div class="quick-add-row">
      <select bind:value={newTargetPath}>
        {#each availableParams as param}
          <option value={param.path}>{param.label} ({param.path})</option>
        {/each}
      </select>
      <Button
        variant="primary"
        size="sm"
        on:click={() => startLearn(newTargetPath)}
        disabled={!newTargetPath}
      >
        Learn MIDI
      </Button>
    </div>
  </div>

  <!-- Bindings List -->
  <div class="bindings-section">
    <h3>Active Bindings ({$bindings.length})</h3>
    {#if $bindings.length === 0}
      <div class="empty-state">No bindings yet. Use "Learn MIDI" above.</div>
    {:else}
      <div class="bindings-list">
        {#each $bindings as binding (binding.id)}
          <div class="binding-card">
            <div class="binding-header">
              <div class="binding-source">{describeSource(binding.source)}</div>
              <div class="binding-arrow">→</div>
              <div class="binding-target">{binding.targetPath}</div>
            </div>

            <div class="binding-controls">
              <div class="control-group">
                <label>Mode:</label>
                <button
                  class="mode-toggle mode-{binding.mode.toLowerCase()}"
                  on:click={() => toggleMode(binding.id)}
                >
                  {binding.mode}
                </button>
              </div>

              <div class="control-group">
                <label>Range:</label>
                <input
                  type="number"
                  class="range-input"
                  value={binding.mapping.min}
                  on:change={(e) => updateRange(binding.id, 'min', getInputValue(e))}
                />
                <span>–</span>
                <input
                  type="number"
                  class="range-input"
                  value={binding.mapping.max}
                  on:change={(e) => updateRange(binding.id, 'max', getInputValue(e))}
                />
              </div>

              <div class="control-group">
                <label>
                  <input
                    type="checkbox"
                    checked={binding.mapping.invert}
                    on:change={() => toggleInvert(binding.id)}
                  />
                  Invert
                </label>
              </div>

              <div class="control-group">
                <span class="last-value">Last: {formatValue(binding.lastValue)}</span>
              </div>

              <Button variant="danger" size="sm" on:click={() => removeBinding(binding.id)}
                >×</Button
              >
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .registry-midi-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg, 24px);
    padding: var(--space-lg, 24px);
    background: var(--bg-primary, #1a1a1a);
    border-radius: var(--radius-lg, 12px);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-md, 16px);
  }

  .panel-header h2 {
    margin: 0;
    font-size: var(--text-xl, 1.25rem);
    color: var(--text-primary, #fff);
  }

  .input-selector {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
  }

  .input-selector select {
    padding: var(--space-xs, 4px) var(--space-sm, 8px);
    background: var(--bg-secondary, #252525);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary, #fff);
  }

  .monitor-section,
  .quick-add,
  .bindings-section {
    background: var(--bg-secondary, #252525);
    padding: var(--space-md, 16px);
    border-radius: var(--radius-md, 8px);
  }

  .monitor-section h3,
  .quick-add h3,
  .bindings-section h3 {
    margin: 0 0 var(--space-sm, 8px) 0;
    font-size: var(--text-md, 1rem);
    color: var(--text-secondary, #aaa);
  }

  .monitor-display {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm, 0.875rem);
  }

  .monitor-row {
    display: flex;
    gap: var(--space-sm, 8px);
  }

  .monitor-row .label {
    color: var(--text-secondary, #aaa);
    width: 70px;
  }

  .monitor-row .value {
    color: var(--color-primary, #6366f1);
  }

  .monitor-empty {
    color: var(--text-muted, #666);
    font-style: italic;
  }

  .learn-indicator {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--color-warning, #f59e0b);
    color: #000;
    border-radius: var(--radius-md, 8px);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .quick-add-row {
    display: flex;
    gap: var(--space-sm, 8px);
    align-items: center;
  }

  .quick-add-row select {
    flex: 1;
    padding: var(--space-sm, 8px);
    background: var(--bg-tertiary, #2a2a2a);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-sm, 4px);
    color: var(--text-primary, #fff);
  }

  .empty-state {
    color: var(--text-muted, #666);
    font-style: italic;
    text-align: center;
    padding: var(--space-lg, 24px);
  }

  .bindings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
  }

  .binding-card {
    background: var(--bg-tertiary, #2a2a2a);
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    border-radius: var(--radius-sm, 4px);
    border-left: 3px solid var(--color-primary, #6366f1);
  }

  .binding-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    margin-bottom: var(--space-sm, 8px);
    font-weight: 500;
  }

  .binding-source {
    color: var(--color-warning, #f59e0b);
    font-family: var(--font-mono, monospace);
  }

  .binding-arrow {
    color: var(--text-muted, #666);
  }

  .binding-target {
    color: var(--color-primary, #6366f1);
    font-family: var(--font-mono, monospace);
  }

  .binding-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-md, 16px);
    align-items: center;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: var(--space-xs, 4px);
    font-size: var(--text-sm, 0.875rem);
  }

  .control-group label {
    color: var(--text-secondary, #aaa);
  }

  .mode-toggle {
    padding: 2px 8px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: var(--text-xs, 0.75rem);
  }

  .mode-toggle.mode-remote {
    background: var(--color-success, #22c55e);
    color: #000;
  }

  .mode-toggle.mode-modulation {
    background: var(--color-warning, #f59e0b);
    color: #000;
  }

  .range-input {
    width: 60px;
    padding: 2px 6px;
    background: var(--bg-primary, #1a1a1a);
    border: 1px solid var(--border-color, #444);
    border-radius: 3px;
    color: var(--text-primary, #fff);
    font-family: var(--font-mono, monospace);
  }

  .last-value {
    color: var(--text-muted, #666);
    font-family: var(--font-mono, monospace);
  }
</style>
