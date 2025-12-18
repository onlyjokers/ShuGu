<script lang="ts">
  import ConnectionBar from '$lib/components/ConnectionBar.svelte';
  import ConnectionMenu from '$lib/components/ConnectionMenu.svelte';

  export let fullBleed = false;
  export let collapseHeader = false;

  // Slots
  // - main: Main content
  // - tabs: Page tabs in header
  // - headerActions: Floating actions (bottom-left)
</script>

<div class="app-shell">
  <header class="header" class:collapsed={collapseHeader}>
    <div class="logo">
      <h1 class="title">Fluffy Manager</h1>
    </div>
    <div class="header-tabs">
      <slot name="tabs" />
    </div>
    <div class="header-menu">
      <ConnectionMenu />
    </div>
  </header>

  <div class="body">
    <main class="main-content" class:fullBleed>
      <slot />
    </main>
  </div>

  <div class="floating-actions">
    <slot name="headerActions" />
    <ConnectionBar />
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .header {
    --header-height: 60px;
    height: var(--header-height);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: var(--space-lg);
    padding: 0 var(--space-lg);
    background: var(--glass-bg);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    transition:
      transform 560ms cubic-bezier(0.16, 1, 0.3, 1),
      margin-bottom 560ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 240ms ease-out;
    will-change: transform, margin-bottom, opacity;
    position: relative;
    z-index: 70;
  }

  .header.collapsed {
    transform: translateY(calc(-1 * var(--header-height)));
    margin-bottom: calc(-1 * var(--header-height));
    opacity: 0;
    pointer-events: none;
  }

  .logo {
    justify-self: start;
    min-width: 0;
  }

  .title {
    font-size: var(--text-lg);
    font-weight: 700;
    background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    white-space: nowrap;
  }

  .header-tabs {
    display: flex;
    justify-content: center;
    min-width: 0;
    justify-self: center;
  }

  .header-menu {
    display: flex;
    align-items: center;
    min-width: 0;
    justify-self: end;
  }

  .floating-actions {
    position: fixed;
    left: 14px;
    bottom: 14px;
    z-index: 80;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-md);
    max-width: calc(100vw - 28px);
  }

  .body {
    flex: 1;
    overflow: hidden;
  }

  .main-content {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: var(--space-xl);
    position: relative;
    /* Dot pattern background */
    background-image: radial-gradient(var(--border-color) 1px, transparent 1px);
    background-size: 24px 24px;
  }

  .main-content.fullBleed {
    padding: 0;
    overflow: hidden;
    background-image: none;
  }
</style>
