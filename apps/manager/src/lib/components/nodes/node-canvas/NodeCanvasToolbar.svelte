<!-- Purpose: Toolbar controls for node canvas start/stop and file actions. -->
<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';

  export let isRunning = false;
  export let lastError: string | null = null;
  export let nodeCount = 0;

  export let isMenuOpen = false;
  export let toolbarMenuWrap: HTMLDivElement | null = null;

  export let onToggleEngine: () => void = () => undefined;
  export let onClear: () => void = () => undefined;
  export let onToggleMenu: () => void = () => undefined;
  export let onMenuPick: (action: () => void) => void = (action) => action();
  export let onImportGraph: () => void = () => undefined;
  export let onExportGraph: () => void = () => undefined;
  export let onImportTemplates: () => void = () => undefined;
  export let onExportTemplates: () => void = () => undefined;
</script>

<div class="canvas-toolbar">
  <div class="toolbar-left">
    <Button variant={isRunning ? 'danger' : 'primary'} size="sm" on:click={onToggleEngine}>
      {isRunning ? '⏹ Stop' : '▶ Start'}
    </Button>
    <Button variant="ghost" size="sm" on:click={onClear}>🗑️ Clear</Button>
  </div>

  <div class="toolbar-right">
    <div class="toolbar-menu-wrap" bind:this={toolbarMenuWrap}>
      <Button variant="ghost" size="sm" on:click={onToggleMenu}>⋯</Button>
      {#if isMenuOpen}
        <div class="toolbar-menu" role="menu" on:pointerdown|stopPropagation>
          <button
            type="button"
            class="toolbar-menu-item"
            on:click={() => onMenuPick(onImportGraph)}
          >
            ⬇ Import
          </button>
          <button
            type="button"
            class="toolbar-menu-item"
            on:click={() => onMenuPick(onExportGraph)}
          >
            ⬆ Export
          </button>
          <div class="toolbar-menu-sep" />
          <button
            type="button"
            class="toolbar-menu-item"
            on:click={() => onMenuPick(onImportTemplates)}
          >
            ⬇ Templates
          </button>
          <button
            type="button"
            class="toolbar-menu-item"
            on:click={() => onMenuPick(onExportTemplates)}
          >
            ⬆ Templates
          </button>
          <div class="toolbar-menu-sep" />
          <div class="toolbar-menu-footer">{nodeCount} nodes</div>
        </div>
      {/if}
    </div>
    {#if lastError}
      <span class="error-message">⚠️ {lastError}</span>
    {/if}
  </div>
</div>

<style>
  .canvas-toolbar {
    position: absolute;
    top: 14px;
    left: 0;
    right: 0;
    margin-left: var(--space-2xl, 32px);
    margin-right: var(--space-2xl, 32px);
    z-index: 25;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 18px 56px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(16px);
  }

  .toolbar-left {
    display: flex;
    gap: var(--space-sm, 8px);
    align-items: center;
    min-width: 0;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .toolbar-menu-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .toolbar-menu {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 40;
    min-width: 180px;
    padding: 8px;
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 18px 56px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(14px);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toolbar-menu-item {
    width: 100%;
    border: none;
    border-radius: 12px;
    padding: 8px 10px;
    background: transparent;
    color: rgba(226, 232, 240, 0.92);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .toolbar-menu-item:hover {
    background: rgba(99, 102, 241, 0.18);
    color: rgba(255, 255, 255, 0.96);
  }

  .toolbar-menu-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 6px 4px;
  }

  .toolbar-menu-footer {
    color: var(--text-muted, #666);
    font-size: var(--text-sm, 0.875rem);
    text-align: center;
    padding: 2px 6px;
  }

  .error-message {
    color: var(--color-error, #ef4444);
    font-size: var(--text-sm, 0.875rem);
  }
</style>
