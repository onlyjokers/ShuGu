<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import {
    midiParamBridge,
    type MidiBindingMode,
    type MidiTarget,
  } from '$lib/features/midi/midi-param-bridge';
  import Button from '$lib/components/ui/Button.svelte';

  export let targetPath: string;
  export let targetLabel: string = '';
  export let defaultMode: MidiBindingMode = 'REMOTE';
  export let x: number = 0;
  export let y: number = 0;

  const dispatch = createEventDispatcher<{
    close: void;
    bound: { targetPath: string };
  }>();

  let lastMessage = midiService.lastMessage;
  let learnMode = midiParamBridge.learnMode;
  let started = false;
  let closed = false;

  onMount(() => {
    const target: MidiTarget = { type: 'PARAM', path: targetPath };
    midiParamBridge.startLearn(target, defaultMode);
    started = true;
  });

  onDestroy(() => {
    if ($learnMode.active) {
      midiParamBridge.cancelLearn();
    }
  });

  // Watch for successful binding
  $: if (started && !closed && !$learnMode.active && $learnMode.target === null) {
    dispatch('bound', { targetPath });
    dispatch('close');
    closed = true;
  }

  function handleCancel() {
    closed = true;
    midiParamBridge.cancelLearn();
    dispatch('close');
  }

  function describeEvent(event: MidiEvent): string {
    if (event.type === 'pitchbend') return `Pitch Bend ch${event.channel + 1}`;
    return `${event.type.toUpperCase()} ${event.number} ch${event.channel + 1}`;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="popup-overlay" on:click={handleCancel}>
  <div class="popup" style="left: {x}px; top: {y}px;" on:click|stopPropagation>
    <div class="popup-header">
      <h4>MIDI Learn</h4>
      <button class="close-btn" on:click={handleCancel}>×</button>
    </div>

    <div class="popup-body">
      <div class="target-info">
        <span class="label">Target:</span>
        <span class="value">{targetLabel || targetPath}</span>
      </div>

      <div class="instruction">🎹 Move a MIDI control to bind...</div>

      {#if $lastMessage}
        <div class="last-signal">
          <span class="label">Last:</span>
          <span class="value">{describeEvent($lastMessage)}</span>
        </div>
      {/if}
    </div>

    <div class="popup-footer">
      <Button variant="ghost" size="sm" on:click={handleCancel}>Cancel</Button>
    </div>
  </div>
</div>

<style>
  .popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }

  .popup {
    position: fixed;
    min-width: 280px;
    background: var(--bg-primary, #1a1a1a);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: popup-in 0.15s ease-out;
  }

  @keyframes popup-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--bg-secondary, #252525);
    border-bottom: 1px solid var(--border-color, #444);
  }

  .popup-header h4 {
    margin: 0;
    font-size: var(--text-md, 1rem);
    color: var(--text-primary, #fff);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary, #fff);
  }

  .popup-body {
    padding: var(--space-md, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
  }

  .target-info,
  .last-signal {
    display: flex;
    gap: var(--space-sm, 8px);
    font-size: var(--text-sm, 0.875rem);
  }

  .label {
    color: var(--text-secondary, #aaa);
  }

  .value {
    color: var(--color-primary, #6366f1);
    font-family: var(--font-mono, monospace);
  }

  .instruction {
    padding: var(--space-sm, 8px);
    background: var(--color-warning, #f59e0b);
    color: #000;
    border-radius: var(--radius-sm, 4px);
    text-align: center;
    font-weight: 500;
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

  .popup-footer {
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    border-top: 1px solid var(--border-color, #444);
    display: flex;
    justify-content: flex-end;
  }
</style>
