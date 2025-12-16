<script lang="ts">
  import { ClassicPreset } from 'rete';
  import { sensorData, state as managerState } from '$lib/stores/manager';
  import { nodeEngine } from '$lib/nodes';
  import type { ClientInfo } from '@shugu/protocol';

  export let data: any;
  $: inputControlLabel = data instanceof ClassicPreset.InputControl ? (data as any).controlLabel : undefined;
  const graphStateStore = nodeEngine.graphState;

  function changeInput(event: Event) {
    if (!(data instanceof ClassicPreset.InputControl)) return;
    const target = event.target as HTMLInputElement;
    if (data.type === 'number') {
      const num = Number(target.value);
      data.setValue(Number.isFinite(num) ? num : 0);
    } else {
      data.setValue(target.value);
    }
  }

  function changeSelect(event: Event) {
    const target = event.target as HTMLSelectElement;
    data?.setValue?.(target.value);
  }

  function changeBoolean(event: Event) {
    const target = event.target as HTMLInputElement;
    data?.setValue?.(Boolean(target.checked));
  }

  function pickClient(clientId: string) {
    data?.setValue?.(clientId);
  }

  function clientLabel(c: ClientInfo): string {
    return String((c as any).clientId ?? '');
  }

  function clientSubtitle(c: ClientInfo): string {
    const connectedAt = (c as any).connectedAt;
    if (!connectedAt) return '';
    try {
      const d = new Date(connectedAt);
      return d.toLocaleTimeString(undefined, { hour12: false });
    } catch {
      return '';
    }
  }

  $: hasLabel = Boolean(data?.label);

  function formatValue(val: number | null | undefined): string {
    if (val === null || val === undefined) return '--';
    return Number(val).toFixed(2);
  }

  let sensorsClientId = '';
  let sensorsData: any = null;
  let sensorsPayload: any = {};
  let sensorValueText = '--';

  function formatBpm(val: unknown): string {
    if (val === null || val === undefined) return '--';
    const num = Number(val);
    if (!Number.isFinite(num)) return '--';
    return String(Math.round(num));
  }

  function computeSensorValue(portId: string, msg: any, payload: any): string {
    if (!msg || typeof msg !== 'object') return '--';

    if (portId === 'accelX') return msg.sensorType === 'accel' ? formatValue(payload.x) : '--';
    if (portId === 'accelY') return msg.sensorType === 'accel' ? formatValue(payload.y) : '--';
    if (portId === 'accelZ') return msg.sensorType === 'accel' ? formatValue(payload.z) : '--';

    const isAngle = msg.sensorType === 'gyro' || msg.sensorType === 'orientation';
    if (portId === 'gyroA') return isAngle ? formatValue(payload.alpha) : '--';
    if (portId === 'gyroB') return isAngle ? formatValue(payload.beta) : '--';
    if (portId === 'gyroG') return isAngle ? formatValue(payload.gamma) : '--';

    if (portId === 'micVol') return msg.sensorType === 'mic' ? formatValue(payload.volume) : '--';
    if (portId === 'micLow') return msg.sensorType === 'mic' ? formatValue(payload.lowEnergy) : '--';
    if (portId === 'micHigh') return msg.sensorType === 'mic' ? formatValue(payload.highEnergy) : '--';
    if (portId === 'micBpm') return msg.sensorType === 'mic' ? formatBpm(payload.bpm) : '--';

    return '--';
  }

  $: if (data?.controlType === 'client-sensor-value') {
    const nodeId = String(data?.nodeId ?? '');
    const portId = String(data?.portId ?? '');
    const conn = ($graphStateStore.connections ?? []).find(
      (c: any) => c.targetNodeId === nodeId && c.targetPortId === 'client'
    );
    const srcNode = conn ? ($graphStateStore.nodes ?? []).find((n: any) => n.id === conn.sourceNodeId) : null;
    sensorsClientId = srcNode?.config?.clientId ? String(srcNode.config.clientId) : '';
    sensorsData = sensorsClientId ? $sensorData.get(sensorsClientId) : null;
    sensorsPayload = sensorsData?.payload ?? {};
    sensorValueText = computeSensorValue(portId, sensorsData, sensorsPayload);
  }
</script>

{#if data instanceof ClassicPreset.InputControl}
  <div class="control-field">
    {#if inputControlLabel}
      <div class="control-label">{inputControlLabel}</div>
    {/if}
    <input
      class="control-input"
      type={data.type}
      value={data.value}
      readonly={data.readonly}
      on:pointerdown|stopPropagation
      on:input={changeInput}
    />
  </div>
{:else if data?.controlType === 'select'}
  <div class="control-field">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <select
      class="control-input"
      value={data.value}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:change={changeSelect}
    >
      {#if data.placeholder}
        <option value="">{data.placeholder}</option>
      {/if}
      {#each data.options ?? [] as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
{:else if data?.controlType === 'boolean'}
  <div class="control-field boolean-field">
    <label class="toggle" on:pointerdown|stopPropagation>
      <input type="checkbox" checked={Boolean(data.value)} disabled={data.readonly} on:change={changeBoolean} />
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      {#if hasLabel}
        <span class="toggle-label">{data.label}</span>
      {/if}
    </label>
  </div>
{:else if data?.controlType === 'client-picker'}
  <div class="client-picker">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    {#if ($managerState.clients ?? []).length === 0}
      <div class="client-empty">No clients connected</div>
    {:else}
      <div class="client-list">
        {#each $managerState.clients as c (c.clientId)}
          <button
            type="button"
            class="client-item {c.clientId === data.value ? 'selected' : ''}"
            disabled={data.readonly}
            on:pointerdown|stopPropagation
            on:click|stopPropagation={() => pickClient(c.clientId)}
          >
            <span class="client-dot"></span>
            <span class="client-main">
              <span class="client-id">{clientLabel(c)}</span>
              <span class="client-time">{clientSubtitle(c)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else if data?.controlType === 'client-sensor-value'}
  <div class="sensor-inline-value">{sensorValueText}</div>
{:else}
  <div class="control-unknown">Unsupported control</div>
{/if}

<style>
  .control-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px;
  }

  .control-label {
    font-size: 11px;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.72);
  }

  .control-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 10px;
    padding: 6px 10px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    outline: none;
    font-size: 12px;
  }

  .control-input:focus {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  }

  .boolean-field {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }

  .toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .toggle-track {
    width: 34px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.08);
    display: inline-flex;
    align-items: center;
    padding: 2px;
    box-sizing: border-box;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .toggle-thumb {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.78);
    transform: translateX(0);
    transition: transform 120ms ease, background 120ms ease;
  }

  .toggle input:checked + .toggle-track {
    background: rgba(99, 102, 241, 0.35);
    border-color: rgba(99, 102, 241, 0.55);
  }

  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
    background: rgba(255, 255, 255, 0.9);
  }

  .toggle-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.84);
  }

  .client-picker {
    padding: 6px 8px 10px;
  }

  .client-empty {
    padding: 10px 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
  }

  .client-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow: auto;
    padding-right: 2px;
  }

  .client-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    text-align: left;
  }

  .client-item:hover {
    border-color: rgba(99, 102, 241, 0.35);
    background: rgba(2, 6, 23, 0.45);
  }

  .client-item.selected {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .client-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.9);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.16);
    flex: 0 0 auto;
  }

  .client-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .client-id {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .client-time {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    flex: 0 0 auto;
  }

  .control-unknown {
    padding: 10px 12px;
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
  }

  .sensor-inline-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: rgba(99, 102, 241, 0.95);
    text-align: right;
    min-width: 56px;
    white-space: nowrap;
  }
</style>
