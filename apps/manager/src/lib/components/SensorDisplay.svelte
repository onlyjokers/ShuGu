<script lang="ts">
  import { sensorData, state } from '$lib/stores/manager';
  import type { SensorDataMessage } from '@shugu/protocol';

  $: selectedClientId = $state.selectedClientIds[0] ?? null;
  $: clientData = selectedClientId ? $sensorData.get(selectedClientId) : null;

  function formatValue(val: number | null | undefined): string {
    if (val === null || val === undefined) return '--';
    return val.toFixed(2);
  }
</script>

<div class="card">
  <div class="card-header">
    <h3 class="card-title">Sensor Data</h3>
    {#if selectedClientId}
      <span class="client-badge">{selectedClientId.slice(-8)}</span>
    {/if}
  </div>

  {#if !selectedClientId}
    <div class="empty-state">
      <span class="text-muted">Select a client to view sensor data</span>
    </div>
  {:else if !clientData}
    <div class="empty-state">
      <span class="text-muted">Waiting for data...</span>
    </div>
  {:else}
    <div class="sensor-data">
      {#if clientData.sensorType === 'gyro'}
        <div class="data-section">
          <h4 class="data-title">Gyroscope</h4>
          <div class="data-grid">
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.alpha)}</span>
              <span class="data-label">Alpha</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.beta)}</span>
              <span class="data-label">Beta</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.gamma)}</span>
              <span class="data-label">Gamma</span>
            </div>
          </div>
        </div>
      {:else if clientData.sensorType === 'accel'}
        <div class="data-section">
          <h4 class="data-title">Accelerometer</h4>
          <div class="data-grid">
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.x)}</span>
              <span class="data-label">X</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.y)}</span>
              <span class="data-label">Y</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.z)}</span>
              <span class="data-label">Z</span>
            </div>
          </div>
        </div>
      {:else if clientData.sensorType === 'orientation'}
        <div class="data-section">
          <h4 class="data-title">Orientation</h4>
          <div class="data-grid">
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.alpha)}</span>
              <span class="data-label">Alpha</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.beta)}</span>
              <span class="data-label">Beta</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.gamma)}</span>
              <span class="data-label">Gamma</span>
            </div>
          </div>
        </div>
      {:else if clientData.sensorType === 'mic'}
        <div class="data-section">
          <h4 class="data-title">Audio Features</h4>
          <div class="data-grid">
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.volume)}</span>
              <span class="data-label">Volume</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.lowEnergy)}</span>
              <span class="data-label">Low</span>
            </div>
            <div class="data-item">
              <span class="data-value">{formatValue(clientData.payload.highEnergy)}</span>
              <span class="data-label">High</span>
            </div>
            <div class="data-item">
              <span class="data-value">{clientData.payload.bpm ?? '--'}</span>
              <span class="data-label">BPM</span>
            </div>
          </div>
        </div>
      {:else}
        <div class="data-section">
          <h4 class="data-title">{clientData.sensorType}</h4>
          <pre class="data-raw">{JSON.stringify(clientData.payload, null, 2)}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    padding: var(--space-xl);
    text-align: center;
  }

  .client-badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
  }

  .sensor-data {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .data-section {
    padding: var(--space-md);
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }

  .data-title {
    font-size: var(--text-sm);
    font-weight: 600;
    margin-bottom: var(--space-md);
    color: var(--text-secondary);
  }

  .data-raw {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow-x: auto;
  }
</style>
