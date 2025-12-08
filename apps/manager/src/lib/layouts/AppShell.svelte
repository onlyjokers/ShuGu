<script lang="ts">
  import ConnectionBar from '$lib/components/ConnectionBar.svelte';

  // Slots
  // - sidebar: Client list, etc.
  // - main: Main content
  // - right-sidebar: Sensor data (optional)
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
    <aside class="sidebar-left">
      <slot name="sidebar" />
    </aside>

    <main class="main-content">
      <slot />
    </main>

    <aside class="sidebar-right">
      <slot name="right-sidebar" />
    </aside>
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
  }

  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .sidebar-left {
    width: 320px;
    border-right: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    padding: var(--space-md);
    gap: var(--space-md);
    overflow-y: auto;
  }

  .sidebar-right {
    width: 320px;
    border-left: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    padding: var(--space-md);
    gap: var(--space-md);
    overflow-y: auto;
  }

  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-xl);
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

  @media (max-width: 1200px) {
    .sidebar-right {
      display: none; /* Hide sensor sidebar on smaller screens or make it collapsible */
    }
  }
</style>
