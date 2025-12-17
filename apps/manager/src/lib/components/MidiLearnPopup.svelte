<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import { midiNodeBridge } from '$lib/features/midi/midi-node-bridge';
  import { nodeEngine } from '$lib/nodes';
  import Button from '$lib/components/ui/Button.svelte';
  import { instantiateMidiBinding, templateForParam, type MidiBindingMode } from '$lib/features/midi/midi-templates';

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
  let learnMode = midiNodeBridge.learnMode;

  let createdNodeIds: string[] = [];
  let midiNodeId = '';
  let started = false;
  let closed = false;

  function describeEvent(event: MidiEvent): string {
    if (event.type === 'pitchbend') return `Pitch Bend ch${event.channel + 1}`;
    return `${event.type.toUpperCase()} ${event.number} ch${event.channel + 1}`;
  }

  function cleanupCreatedNodes() {
    for (const id of createdNodeIds) {
      try {
        nodeEngine.removeNode(id);
      } catch {
        // ignore
      }
    }
    createdNodeIds = [];
  }

  function handleCancel() {
    closed = true;
    midiNodeBridge.cancelLearn();
    cleanupCreatedNodes();
    dispatch('close');
  }

  onMount(async () => {
    await midiService.init();
    midiNodeBridge.init();

    const template = templateForParam(targetPath, defaultMode);
    if (!template) {
      alert('Parameter not found for MIDI learn.');
      dispatch('close');
      return;
    }

    const created = instantiateMidiBinding(template);
    if (!created) {
      alert('Failed to create Node Graph binding.');
      dispatch('close');
      return;
    }

    createdNodeIds = [created.targetNodeId, created.mapNodeId, created.midiNodeId];
    midiNodeId = created.midiNodeId;
    midiNodeBridge.startLearn(midiNodeId);
    started = true;
  });

  onDestroy(() => {
    if (!started) return;
    if (closed) return;
    // If user navigates away mid-learn, treat as cancel to avoid leaving junk nodes.
    if ($learnMode.active && $learnMode.nodeId === midiNodeId) {
      midiNodeBridge.cancelLearn();
      cleanupCreatedNodes();
    }
  });

  // Watch for successful binding: learn mode ends after midiNodeBridge captures the next event.
  $: if (started && !closed && midiNodeId && !$learnMode.active && $learnMode.nodeId === null) {
    dispatch('bound', { targetPath });
    dispatch('close');
    closed = true;
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

      <div class="instruction">🎹 Move a MIDI control to bind…</div>

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

