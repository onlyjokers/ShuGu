<script lang="ts">
  import ConnectionBar from '$lib/components/ConnectionBar.svelte';

  // Slots
  // - main: Main content
  // - footer: Session actions
</script>

<div class="app-shell">
  <header class="header">
    <div class="logo">
      <h1 class="title">Fluffy Manager</h1>
    </div>
    <div class="connection-status">
      <ConnectionBar />
    </div>
  </header>

  <div class="body">
    <main class="main-content">
      <slot />
    </main>
  </div>

  <footer class="footer">
    <slot name="footer" />
  </footer>
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
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-lg);
    background: var(--glass-bg);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
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

  .connection-status {
    display: flex;
    align-items: center;
    min-width: 0;
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
    padding-bottom: 0;
    position: relative;
    /* Dot pattern background */
    background-image: radial-gradient(var(--border-color) 1px, transparent 1px);
    background-size: 24px 24px;
  }

  .footer {
    height: 60px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    padding: 0 var(--space-lg);
    justify-content: flex-end;
    gap: var(--space-md);
    flex-shrink: 0;
  }

</style>
