<script lang="ts">
  import { connectionStatus, timeOffset } from '$lib/stores/manager';
  import { formatTime } from '@shugu/ui-kit';
  import { onDestroy } from 'svelte';

  let displayLocalTime = Date.now();
  let displayServerTime = Date.now();
  let interval: ReturnType<typeof setInterval> | null = null;

  function tick() {
    displayLocalTime = Date.now();
    displayServerTime = Date.now() + $timeOffset;
  }

  function startTicker() {
    if (interval) return;
    tick();
    interval = setInterval(tick, 250);
  }

  function stopTicker() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
  }

  $: if ($connectionStatus === 'connected') {
    startTicker();
  } else {
    stopTicker();
  }

  onDestroy(stopTicker);
</script>

<div class="connection-bar">
  <div class="status-indicator">
    <span class="status-dot {$connectionStatus}"></span>
    <span class="status-text">
      {#if $connectionStatus === 'connected'}
        Connected
      {:else if $connectionStatus === 'connecting'}
        Connecting...
      {:else if $connectionStatus === 'reconnecting'}
        Reconnecting...
      {:else if $connectionStatus === 'error'}
        Connection Error
      {:else}
        Disconnected
      {/if}
    </span>
  </div>
  
  {#if $connectionStatus === 'connected'}
    <div class="time-display">
      <div class="time-pill">
        <span class="time-label">Local</span>
        <span class="time-value">{formatTime(displayLocalTime)}</span>
      </div>
      <div class="time-pill">
        <span class="time-label">Server</span>
        <span class="time-value">{formatTime(displayServerTime)}</span>
      </div>
      <div class="time-pill">
        <span class="time-label">Offset</span>
        <span class="time-value">{$timeOffset > 0 ? '+' : ''}{$timeOffset.toFixed(0)}ms</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .connection-bar {
    display: inline-flex;
    align-items: center;
    gap: var(--space-md);
    padding: 6px 10px;
    max-width: 100%;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.03);
  }

  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    white-space: nowrap;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.9;
  }

  .status-dot.connected {
    background: var(--color-success);
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
  }

  .status-dot.connecting,
  .status-dot.reconnecting {
    background: var(--color-warning);
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
  }

  .status-dot.error {
    background: var(--color-error);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
  }
  
  .status-text {
    font-weight: 500;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .time-display {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    white-space: nowrap;
  }

  .time-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.18);
  }

  .time-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .time-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  @media (max-width: 900px) {
    .time-display {
      display: none;
    }
  }
</style>
