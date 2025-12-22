<!-- Purpose: Render group frames and group actions overlay. -->
<script lang="ts">
  // @ts-nocheck
  import { tick } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';

  export let frames: any[] = [];
  export let areaTransform: { k: number; tx: number; ty: number } | null = null;
  export let isRunning = false;
  export let editModeGroupId: string | null = null;
  export let toast: { groupId: string; message: string } | null = null;
  export let onToggleDisabled: (groupId: string) => void = () => undefined;
  export let onToggleEditMode: (groupId: string) => void = () => undefined;
  export let onDisassemble: (groupId: string) => void = () => undefined;
  export let onRename: (groupId: string, name: string) => void = () => undefined;
  export let onHeaderPointerDown: (groupId: string, event: PointerEvent) => void = () => undefined;

  let editingGroupId: string | null = null;
  let draftName = '';
  let nameInputEl: HTMLInputElement | null = null;
  let k = 1;
  let tx = 0;
  let ty = 0;

  $: k = Number(areaTransform?.k ?? 1) || 1;
  $: tx = Number(areaTransform?.tx ?? 0) || 0;
  $: ty = Number(areaTransform?.ty ?? 0) || 0;

  $: isTiny = k < 0.55;

  async function startEdit(group: any) {
    editingGroupId = String(group?.id ?? '');
    draftName = String(group?.name ?? 'Group');
    await tick();
    nameInputEl?.focus?.();
    nameInputEl?.select?.();
  }

  function commitEdit() {
    if (!editingGroupId) return;
    const trimmed = draftName.trim();
    if (trimmed) onRename(editingGroupId, trimmed);
    editingGroupId = null;
  }

  function cancelEdit() {
    editingGroupId = null;
  }
</script>

{#if frames.length > 0}
  <div class="group-frame-layer" style="transform: translate({tx}px, {ty}px) scale({k}); transform-origin: 0 0;">
    {#each frames as frame (frame.group.id)}
      {@const group = frame.group}
      {@const isEditing = editModeGroupId === group.id}
      {@const toastMessage = toast?.groupId === group.id ? toast.message : ''}
      {@const showCount = !isTiny}
      {@const gateClosed = !isRunning || frame.effectiveDisabled}
      {@const gateReason = !isRunning
        ? 'Graph STOP'
        : frame.effectiveDisabled
          ? group.disabled
            ? 'Gate closed'
            : 'Parent gate closed'
          : 'Gate open'}
      <div
        class="group-frame {gateClosed ? 'disabled' : ''} {isEditing ? 'editing' : ''}"
        style="left: {frame.left}px; top: {frame.top}px; width: {frame.width}px; height: {frame.height}px;"
      >
        <div
          class="group-frame-header"
          on:pointerdown|stopPropagation={(event) => onHeaderPointerDown(String(group.id), event)}
        >
          {#if editingGroupId === group.id}
            <div class="group-frame-title editing">
              <input
                class="group-frame-title-input"
                bind:this={nameInputEl}
                bind:value={draftName}
                on:pointerdown|stopPropagation
                on:keydown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                on:blur={commitEdit}
              />
            </div>
          {:else}
            <button
              type="button"
              class="group-frame-title"
              on:click={() => startEdit(group)}
              on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') startEdit(group);
              }}
              title={gateReason}
            >
              <span class="group-frame-title-name">{group.name ?? 'Group'}</span>
              {#if showCount}
                <span class="group-frame-title-count">{group.nodeIds?.length ?? 0} nodes</span>
              {/if}
              <span class="group-frame-gate {gateClosed ? 'closed' : 'open'}">
                {gateClosed ? 'Gate: Closed' : 'Gate: Open'}
              </span>
            </button>
          {/if}
          <div class="group-frame-actions">
            <Button
              variant={isEditing ? 'primary' : 'ghost'}
              size="sm"
              on:click={() => onToggleEditMode(group.id)}
            >
              {isEditing ? 'Editing…' : 'Edit Group'}
            </Button>
            <Button variant="ghost" size="sm" on:click={() => onDisassemble(group.id)}>
              Disassemble
            </Button>
            <Button
              variant={group.disabled ? 'primary' : 'ghost'}
              size="sm"
              on:click={() => onToggleDisabled(group.id)}
            >
              {group.disabled ? 'Activate group' : 'Deactivate group'}
            </Button>
          </div>
        </div>

        {#if toastMessage}
          <div class="group-frame-toast" aria-live="polite">
            {toastMessage}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .group-frame-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
  }

  .group-frame {
    position: absolute;
    border-radius: 26px;
    border: 2px solid rgba(59, 130, 246, 0.65);
    background: rgba(59, 130, 246, 0.03);
    box-shadow:
      0 0 0 1px rgba(59, 130, 246, 0.16),
      0 18px 64px rgba(59, 130, 246, 0.06);
    pointer-events: none;
  }

  .group-frame.disabled {
    border-color: rgba(148, 163, 184, 0.55);
    background: rgba(148, 163, 184, 0.04);
    box-shadow:
      0 0 0 1px rgba(148, 163, 184, 0.14),
      0 18px 64px rgba(148, 163, 184, 0.06);
  }

  .group-frame.editing {
    animation: group-frame-pulse 1.4s ease-in-out infinite;
  }

  .group-frame.disabled.editing {
    animation-name: group-frame-pulse-disabled;
  }

  .group-frame-header {
    position: absolute;
    top: 12px;
    left: 18px;
    right: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    pointer-events: auto;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .group-frame-header.compact {
    justify-content: flex-start;
  }

  .group-frame-header:active,
  .group-frame-header:active *,
  .group-frame-header *:active {
    cursor: grabbing;
  }

  .group-frame-title {
    appearance: none;
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 11px;
    font-family: inherit;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(12px);
    white-space: nowrap;
    gap: 8px;
    cursor: pointer;
  }

  .group-frame-title.editing {
    cursor: default;
  }

  .group-frame-title-name {
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .group-frame-title-count {
    color: rgba(148, 163, 184, 0.95);
    font-variant-numeric: tabular-nums;
  }

  .group-frame-gate {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(255, 255, 255, 0.82);
  }

  .group-frame-gate.open {
    border-color: rgba(34, 197, 94, 0.45);
    background: rgba(34, 197, 94, 0.14);
    color: rgba(187, 247, 208, 0.95);
  }

  .group-frame-gate.closed {
    border-color: rgba(148, 163, 184, 0.4);
    background: rgba(148, 163, 184, 0.12);
    color: rgba(226, 232, 240, 0.92);
  }

  .group-frame-title-input {
    width: min(220px, 42vw);
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.9);
    font-size: 11px;
    outline: none;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .group-frame-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
    flex-wrap: nowrap;
    white-space: nowrap;
  }

  .group-frame-actions :global(.btn) {
    border-radius: 999px;
    white-space: nowrap;
  }

  .group-frame-toast {
    position: absolute;
    top: 46px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(2, 6, 23, 0.58);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(12px);
    pointer-events: none;
    white-space: nowrap;
    max-width: min(520px, calc(100% - 48px));
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes group-frame-pulse {
    0%,
    100% {
      border-color: rgba(59, 130, 246, 0.65);
      background: rgba(59, 130, 246, 0.03);
      box-shadow:
        0 0 0 1px rgba(59, 130, 246, 0.16),
        0 18px 64px rgba(59, 130, 246, 0.06);
    }
    50% {
      border-color: rgba(59, 130, 246, 0.22);
      background: rgba(59, 130, 246, 0.01);
      box-shadow:
        0 0 0 1px rgba(59, 130, 246, 0.08),
        0 18px 64px rgba(59, 130, 246, 0.03);
    }
  }

  @keyframes group-frame-pulse-disabled {
    0%,
    100% {
      border-color: rgba(148, 163, 184, 0.55);
      background: rgba(148, 163, 184, 0.04);
      box-shadow:
        0 0 0 1px rgba(148, 163, 184, 0.14),
        0 18px 64px rgba(148, 163, 184, 0.06);
    }
    50% {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(148, 163, 184, 0.02);
      box-shadow:
        0 0 0 1px rgba(148, 163, 184, 0.08),
        0 18px 64px rgba(148, 163, 184, 0.03);
    }
  }
</style>
