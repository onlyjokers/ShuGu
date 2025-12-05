<script lang="ts">
  import { connectionStatus, timeOffset, serverTime } from '$lib/stores/manager';
  import { formatTime } from '@shugu/ui-kit';
  
  // Update server time every 100ms
  let displayServerTime = 0;
  let interval: ReturnType<typeof setInterval>;
  
  $: if ($connectionStatus === 'connected') {
    clearInterval(interval);
    interval = setInterval(() => {
      displayServerTime = Date.now() + $timeOffset;
    }, 100);
  }
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
      <div class="time-item">
        <span class="time-value">{formatTime(Date.now())}</span>
        <span class="time-label">Local</span>
      </div>
      <div class="time-item">
        <span class="time-value">{formatTime(displayServerTime)}</span>
        <span class="time-label">Server</span>
      </div>
      <div class="time-item">
        <span class="time-value">{$timeOffset > 0 ? '+' : ''}{$timeOffset.toFixed(0)}ms</span>
        <span class="time-label">Offset</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .connection-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-md) var(--space-lg);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
  }
  
  .status-text {
    font-weight: 500;
  }
</style>
