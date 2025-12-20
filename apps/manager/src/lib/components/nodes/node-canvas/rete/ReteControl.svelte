<!-- Purpose: Render Rete controls (inputs/selects/MIDI learn) for the node canvas. -->
<script lang="ts">
  import { ClassicPreset } from 'rete';
  import { sensorData, state as managerState } from '$lib/stores/manager';
  import { nodeEngine } from '$lib/nodes';
  import type { ClientInfo } from '@shugu/protocol';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import { midiNodeBridge, formatMidiSource } from '$lib/features/midi/midi-node-bridge';

  export let data: any;
  $: isInline = Boolean((data as any)?.inline);
  $: inputControlLabel = data instanceof ClassicPreset.InputControl ? (data as any).controlLabel : undefined;
  $: numberInputMin =
    data instanceof ClassicPreset.InputControl && data.type === 'number' ? (data as any).min : undefined;
  $: numberInputMax =
    data instanceof ClassicPreset.InputControl && data.type === 'number' ? (data as any).max : undefined;
  $: numberInputStep =
    data instanceof ClassicPreset.InputControl && data.type === 'number'
      ? ((data as any).step ?? 'any')
      : undefined;
  const graphStateStore = nodeEngine.graphState;
  const midiLearnModeStore = midiNodeBridge.learnMode;
  const midiLastMessageStore = midiService.lastMessage;
  const midiSelectedInputStore = midiService.selectedInputId;
  const midiSupportedStore = midiService.isSupported;

  function changeInput(event: Event) {
    if (!(data instanceof ClassicPreset.InputControl)) return;
    const target = event.target as HTMLInputElement;
    if (data.type === 'number') {
      const num = Number(target.value);
      let next = Number.isFinite(num) ? num : 0;
      const min = (data as any).min;
      const max = (data as any).max;
      if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
      if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
      if (Number.isFinite(num) && next !== num) target.value = String(next);
      data.setValue(next);
    } else {
      data.setValue(target.value);
    }
  }

  function normalizeNumberInput(event: Event) {
    if (!(data instanceof ClassicPreset.InputControl)) return;
    if (data.type !== 'number') return;
    if ((data as any).readonly) return;

    const target = event.target as HTMLInputElement;
    const raw = target.value;
    if (raw === '') return;

    const num = Number(raw);
    const current = typeof (data as any).value === 'number' ? (data as any).value : 0;

    if (!Number.isFinite(num)) {
      target.value = String(current);
      return;
    }

    let next = num;
    const min = (data as any).min;
    const max = (data as any).max;
    if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
    if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);

    // Force a canonical display string (e.g. "000" -> "0", "01.0" -> "1").
    const canonical = String(next);
    if (target.value !== canonical) target.value = canonical;

    // Ensure the underlying control value matches the canonical/clamped value.
    data.setValue(next);
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

  $: hasLabel = Boolean(data?.label) && !isInline;
  $: showInputControlLabel = Boolean(inputControlLabel) && !isInline;

  function formatValue(val: number | null | undefined): string {
    if (val === null || val === undefined) return '0.00';
    const num = Number(val);
    if (!Number.isFinite(num)) return '0.00';
    return num.toFixed(2);
  }

  let sensorsClientId = '';
  let sensorsData: any = null;
  let sensorsPayload: any = {};
  let sensorValueText = '--';

  function formatBpm(val: unknown): string {
    if (val === null || val === undefined) return '0';
    const num = Number(val);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num));
  }

  function computeSensorValue(portId: string, msg: any, payload: any): string {
    const fallbackNumber = formatValue(0);
    const fallbackBpm = formatBpm(0);
    if (!msg || typeof msg !== 'object') return portId === 'micBpm' ? fallbackBpm : fallbackNumber;

    if (portId === 'accelX')
      return msg.sensorType === 'accel' ? formatValue(payload.x) : fallbackNumber;
    if (portId === 'accelY')
      return msg.sensorType === 'accel' ? formatValue(payload.y) : fallbackNumber;
    if (portId === 'accelZ')
      return msg.sensorType === 'accel' ? formatValue(payload.z) : fallbackNumber;

    const isAngle = msg.sensorType === 'gyro' || msg.sensorType === 'orientation';
    if (portId === 'gyroA') return isAngle ? formatValue(payload.alpha) : fallbackNumber;
    if (portId === 'gyroB') return isAngle ? formatValue(payload.beta) : fallbackNumber;
    if (portId === 'gyroG') return isAngle ? formatValue(payload.gamma) : fallbackNumber;

    if (portId === 'micVol') return msg.sensorType === 'mic' ? formatValue(payload.volume) : fallbackNumber;
    if (portId === 'micLow')
      return msg.sensorType === 'mic' ? formatValue(payload.lowEnergy) : fallbackNumber;
    if (portId === 'micHigh')
      return msg.sensorType === 'mic' ? formatValue(payload.highEnergy) : fallbackNumber;
    if (portId === 'micBpm') return msg.sensorType === 'mic' ? formatBpm(payload.bpm) : fallbackBpm;

    return fallbackNumber;
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

  let midiNodeId = '';
  let midiSource: any = null;
  let midiIsLearning = false;

  let fileInput: HTMLInputElement | null = null;
  let fileName = '';
  let fileDisplayLabel = '';

  function openFilePicker() {
    if (data?.readonly) return;
    fileInput?.click?.();
  }

  function handleFileChange(event: Event) {
    if (data?.readonly) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      data?.setValue?.(result);
    };
    reader.onerror = () => {
      console.warn('[file-picker] Failed to read file');
    };
    reader.readAsDataURL(file);
  }

  function formatMidiEvent(event: MidiEvent | null): string {
    if (!event) return '—';
    const channel = `ch${event.channel + 1}`;
    if (event.type === 'pitchbend') return `pitchbend • ${channel} • ${event.normalized.toFixed(3)}`;
    const num = event.number ?? 0;
    const suffix = event.type === 'note' ? (event.isPress ? 'on' : 'off') : `${event.rawValue}`;
    return `${event.type} ${num} • ${channel} • ${suffix}`;
  }

  $: if (data?.controlType === 'midi-learn') {
    midiNodeId = String(data?.nodeId ?? '');
    const node = ($graphStateStore.nodes ?? []).find((n: any) => String(n.id) === midiNodeId);
    midiSource = node?.config?.source ?? null;
    midiIsLearning = Boolean($midiLearnModeStore.active && $midiLearnModeStore.nodeId === midiNodeId);
  }

  $: fileDisplayLabel =
    data?.controlType === 'file-picker'
      ? fileName || (typeof data?.value === 'string' && data.value ? 'Loaded' : 'No file')
      : '';

  function toggleMidiLearn(nodeId: string) {
    void midiService.init();
    if (midiIsLearning) {
      midiNodeBridge.cancelLearn();
    } else {
      midiNodeBridge.startLearn(nodeId);
    }
  }

  function clearMidiBinding(nodeId: string) {
    nodeEngine.updateNodeConfig(nodeId, { source: null });
  }
</script>

{#if data instanceof ClassicPreset.InputControl}
  <div class="control-field {isInline ? 'inline' : ''}">
    {#if showInputControlLabel}
      <div class="control-label">{inputControlLabel}</div>
    {/if}
    <input
      class="control-input {isInline ? 'inline' : ''}"
      type={data.type}
      value={data.value}
      min={numberInputMin}
      max={numberInputMax}
      step={numberInputStep}
      readonly={data.readonly}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:input={changeInput}
      on:blur={normalizeNumberInput}
    />
  </div>
{:else if data?.controlType === 'select'}
  <div class="control-field {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <select
      class="control-input {isInline ? 'inline' : ''}"
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
  <div class="control-field boolean-field {isInline ? 'inline' : ''}">
    <label class="toggle {isInline ? 'inline' : ''}" on:pointerdown|stopPropagation>
      <input type="checkbox" checked={Boolean(data.value)} disabled={data.readonly} on:change={changeBoolean} />
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
      {#if hasLabel}
        <span class="toggle-label">{data.label}</span>
      {/if}
    </label>
  </div>
{:else if data?.controlType === 'file-picker'}
  <div class="file-picker {isInline ? 'inline' : ''}">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <div class="file-row">
      <button
        type="button"
        class="file-btn"
        disabled={data.readonly}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={openFilePicker}
      >
        {data.buttonLabel || 'Choose file'}
      </button>
      <div class="file-name">{fileDisplayLabel}</div>
    </div>
    <input
      class="file-input"
      type="file"
      accept={data.accept}
      bind:this={fileInput}
      disabled={data.readonly}
      on:pointerdown|stopPropagation
      on:change={handleFileChange}
    />
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
{:else if data?.controlType === 'midi-learn'}
  <div class="midi-learn">
    {#if hasLabel}
      <div class="control-label">{data.label}</div>
    {/if}
    <div class="midi-row">
      <div class="midi-binding">{formatMidiSource(midiSource)}</div>
      <button
        type="button"
        class="midi-btn {midiIsLearning ? 'active' : ''}"
        disabled={!$midiSupportedStore}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => toggleMidiLearn(midiNodeId)}
      >
        {midiIsLearning ? 'Listening…' : 'Learn'}
      </button>
    </div>
    {#if midiIsLearning}
      <div class="midi-hint">
        Move a MIDI control… (input: {$midiSelectedInputStore || 'auto'})
      </div>
      <div class="midi-last">{formatMidiEvent($midiLastMessageStore)}</div>
    {/if}
    {#if midiSource}
      <button
        type="button"
        class="midi-clear"
        on:pointerdown|stopPropagation
        on:click|stopPropagation={() => clearMidiBinding(midiNodeId)}
      >
        Clear binding
      </button>
    {/if}
  </div>
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

  .control-field.inline {
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 0;
    padding: 0;
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

  .control-input.inline {
    width: 110px;
    padding: 5px 8px;
  }

  .control-input:focus {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  }

  .control-input:disabled,
  .control-input[readonly] {
    background: rgba(2, 6, 23, 0.22);
    border-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.58);
    cursor: not-allowed;
  }

  .control-input:disabled:focus,
  .control-input[readonly]:focus {
    border-color: rgba(255, 255, 255, 0.12);
    box-shadow: none;
  }

  .boolean-field {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .boolean-field.inline {
    padding-top: 0;
    padding-bottom: 0;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }

  .toggle.inline {
    gap: 0;
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

  .toggle input:disabled + .toggle-track {
    opacity: 0.45;
  }

  .toggle input:disabled ~ .toggle-label {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .toggle-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.84);
  }

  .client-picker {
    padding: 6px 8px 10px;
  }

  .file-picker {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .file-btn {
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.5);
    color: rgba(255, 255, 255, 0.88);
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .file-btn:hover {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .file-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .file-name {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.62);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .file-input {
    display: none;
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

  .midi-learn {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .midi-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .midi-binding {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.76);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.32);
    border-radius: 10px;
    padding: 6px 10px;
  }

  .midi-btn {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(2, 6, 23, 0.38);
    color: rgba(255, 255, 255, 0.9);
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .midi-btn:hover {
    border-color: rgba(99, 102, 241, 0.45);
    background: rgba(2, 6, 23, 0.5);
  }

  .midi-btn.active {
    border-color: rgba(99, 102, 241, 0.75);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }

  .midi-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .midi-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.62);
  }

  .midi-last {
    font-family: var(--font-mono);
    font-size: 11px;
    color: rgba(20, 184, 166, 0.92);
  }

  .midi-clear {
    align-self: flex-start;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(2, 6, 23, 0.35);
    color: rgba(255, 255, 255, 0.84);
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .midi-clear:hover {
    border-color: rgba(239, 68, 68, 0.45);
    background: rgba(2, 6, 23, 0.5);
  }
</style>
