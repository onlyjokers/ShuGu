<script lang="ts">
  import Ref from 'rete-svelte-plugin/svelte/Ref.svelte';
  import type { ClassicScheme, SvelteArea2D } from 'rete-svelte-plugin/svelte/presets/classic/types';
  import { nodeEngine, nodeRegistry } from '$lib/nodes';

  type NodeExtraData = { width?: number; height?: number; localLoop?: boolean; deployedLoop?: boolean };

  function sortByIndex<K, I extends undefined | { index?: number }>(entries: [K, I][]) {
    entries.sort((a, b) => ((a[1] && a[1].index) || 0) - ((b[1] && b[1].index) || 0));
    return entries as [K, Exclude<I, undefined>][];
  }

  export let data: ClassicScheme['Node'] & NodeExtraData;
  export let emit: (props: SvelteArea2D<ClassicScheme>) => void;

  $: width = Number.isFinite(data.width) ? `${data.width}px` : '';
  $: height = Number.isFinite(data.height) ? `${data.height}px` : '';

  $: inputs = sortByIndex(Object.entries(data.inputs));
  $: controls = sortByIndex(Object.entries(data.controls));
  $: outputs = sortByIndex(Object.entries(data.outputs));
  function any<T>(arg: T): any {
    return arg;
  }

  // Live Port Values
  // Values are derived from NodeEngine runtime outputs and graph connections.
  // This enables "MIDI → mapping → processor" pipelines to show numbers at each port.
  const graphStateStore = nodeEngine.graphState;
  const tickTimeStore = nodeEngine.tickTime;

  type ConnectionInfo = { sourceNodeId: string; sourcePortId: string };

  let nodeId = '';
  $: nodeId = String(data?.id ?? '');

  let inputConnections: Record<string, ConnectionInfo[]> = {};
  $: if (nodeId) {
    const byInput: Record<string, ConnectionInfo[]> = {};
    for (const c of $graphStateStore.connections ?? []) {
      if (String(c.targetNodeId) !== nodeId) continue;
      const key = String(c.targetPortId ?? '');
      if (!key) continue;
      (byInput[key] ??= []).push({
        sourceNodeId: String(c.sourceNodeId),
        sourcePortId: String(c.sourcePortId),
      });
    }
    inputConnections = byInput;
  } else {
    inputConnections = {};
  }

  function formatNumber(value: number, maxDecimals = 3): string {
    if (!Number.isFinite(value)) return '--';
    const fixed = value.toFixed(maxDecimals);
    return fixed.replace(/\.?0+$/, '');
  }

  function formatPortValue(portType: string, value: unknown): string | null {
    // Always show numeric ports (even when null), since these are the common "MIDI pipe" signals.
    if (portType === 'number' || portType === 'fuzzy') {
      if (typeof value !== 'number') return '--';
      return formatNumber(value, portType === 'fuzzy' ? 3 : 3);
    }

    if (value === null || value === undefined) return null;

    if (portType === 'boolean') return typeof value === 'boolean' ? (value ? 'true' : 'false') : null;
    if (portType === 'string') return typeof value === 'string' ? value : null;
    if (portType === 'color') return typeof value === 'string' ? value : null;
    if (portType === 'client' && typeof value === 'object' && value) {
      const clientId = (value as any).clientId;
      return clientId ? String(clientId) : null;
    }

    return null;
  }

  function portTypeFor(side: 'input' | 'output', portId: string): string {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) return 'any';
    const def = nodeRegistry.get(instance.type);
    if (!def) return 'any';
    const ports = side === 'input' ? def.inputs : def.outputs;
    const port = ports?.find((p) => p.id === portId);
    return String(port?.type ?? 'any');
  }

  function effectiveInputValue(portId: string): unknown {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) return undefined;

    const conns = inputConnections[portId] ?? [];
    if (conns.length === 0) {
      const def = nodeRegistry.get(instance.type);
      const port = def?.inputs?.find((p) => p.id === portId);

      const stored = instance.inputValues?.[portId];
      if (stored !== undefined) return stored;
      if (port?.defaultValue !== undefined) return port.defaultValue;

      // Many nodes (especially processors) treat config fields as fallback values for unconnected inputs.
      const fromConfig = (instance.config as any)?.[portId];
      if (fromConfig !== undefined) return fromConfig;
      return undefined;
    }

    // Multi-connection sink inputs show a compact list preview.
    if (conns.length > 1) {
      return conns.map((c) => nodeEngine.getNode(c.sourceNodeId)?.outputValues?.[c.sourcePortId]);
    }

    const conn = conns[0];
    return nodeEngine.getNode(conn.sourceNodeId)?.outputValues?.[conn.sourcePortId];
  }

  function effectiveOutputValue(portId: string): unknown {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) return undefined;
    return instance.outputValues?.[portId];
  }

  type PortValueText = { inputs: Record<string, string | null>; outputs: Record<string, string | null> };
  let portValueText: PortValueText = { inputs: {}, outputs: {} };

  $: if (nodeId) {
    // Depend on tickTimeStore to refresh live values (MIDI/sensors/etc).
    const _tick = $tickTimeStore;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void _tick;

    const nextInputs: Record<string, string | null> = {};
    for (const [key] of inputs) {
      const type = portTypeFor('input', String(key));
      const val = effectiveInputValue(String(key));
      const formatted = formatPortValue(type, val);
      if (formatted !== null) nextInputs[String(key)] = formatted;
    }

    const nextOutputs: Record<string, string | null> = {};
    for (const [key] of outputs) {
      const type = portTypeFor('output', String(key));
      const val = effectiveOutputValue(String(key));
      const formatted = formatPortValue(type, val);
      if (formatted !== null) nextOutputs[String(key)] = formatted;
    }

    portValueText = { inputs: nextInputs, outputs: nextOutputs };
  } else {
    portValueText = { inputs: {}, outputs: {} };
  }
</script>

<div
  class="node {data.selected ? 'selected' : ''} {data.localLoop ? 'local-loop' : ''} {data.deployedLoop ? 'deployed-loop' : ''}"
  style:width
  style:height
  data-testid="node"
>
  <div class="title" data-testid="title">{data.label}</div>

  {#if controls.length}
    <div class="controls">
      {#each controls as [key, control]}
        <Ref
          class="control"
          data-testid={"control-" + key}
          init={(element) =>
            emit({
              type: 'render',
              data: {
                type: 'control',
                element,
                payload: control,
              },
            })}
          unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
        />
      {/each}
    </div>
  {/if}

  <div class="ports">
    {#if inputs.length}
      <div class="inputs">
        {#each inputs as [key, input]}
          <div
            class="port-row input"
            data-testid={"input-" + key}
            data-rete-node-id={data.id}
            data-rete-port-side="input"
            data-rete-port-key={key}
          >
            <Ref
              class="input-socket"
              data-testid="input-socket"
              init={(element) =>
                emit({
                  type: 'render',
                  data: {
                    type: 'socket',
                    side: 'input',
                    key,
                    nodeId: data.id,
                    element,
                    payload: input.socket,
                  },
                })}
              unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
	            />
	            <div class="port-body">
	              <div class="port-title-line">
	                <div class="port-label" data-testid="input-title">{input.label || ''}</div>
	                {#if portValueText.inputs[String(key)] && (inputConnections[String(key)]?.length ?? 0) > 0}
	                  <div class="port-value input" data-testid={"input-value-" + key}>
	                    {portValueText.inputs[String(key)]}
	                  </div>
	                {/if}
	              </div>
	              {#if input.control && (inputConnections[String(key)]?.length ?? 0) === 0}
	                <Ref
	                  class="port-control"
	                  data-testid="input-control"
	                  init={(element) =>
                    emit({
                      type: 'render',
                      data: {
                        type: 'control',
                        element,
                        payload: any(input).control,
                      },
                    })}
                  unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
                />
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if outputs.length}
      <div class="outputs">
        {#each outputs as [key, output]}
          <div
            class="port-row output"
            data-testid={"output-" + key}
            data-rete-node-id={data.id}
            data-rete-port-side="output"
            data-rete-port-key={key}
          >
	            <div class="port-body">
	              <div class="output-line">
	                <div class="port-label" data-testid="output-title">{output.label || ''}</div>
	                {#if portValueText.outputs[String(key)] && !any(output).control}
	                  <div class="port-value output" data-testid={"output-value-" + key}>
	                    {portValueText.outputs[String(key)]}
	                  </div>
	                {/if}
	                {#if any(output).control}
                  <Ref
                    class="port-control port-inline-value"
                    data-testid="output-control"
                    init={(element) =>
                      emit({
                        type: 'render',
                        data: {
                          type: 'control',
                          element,
                          payload: any(output).control,
                        },
                      })}
                    unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
                  />
                {/if}
              </div>
            </div>
            <Ref
              class="output-socket"
              data-testid="output-socket"
              init={(element) =>
                emit({
                  type: 'render',
                  data: {
                    type: 'socket',
                    side: 'output',
                    key,
                    nodeId: data.id,
                    element,
                    payload: output.socket,
                  },
                })}
              unmount={(ref) => emit({ type: 'unmount', data: { element: ref } })}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .node {
    cursor: pointer;
    user-select: none;
    line-height: initial;
  }

  .title {
    padding: 10px 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.92);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .ports {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0 6px;
  }

  .inputs,
  .outputs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .port-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 10px;
  }

  .port-row.output {
    justify-content: flex-end;
  }

  :global(.input-socket) {
    margin-left: -10px;
    flex: 0 0 auto;
  }

  :global(.output-socket) {
    margin-right: -10px;
    flex: 0 0 auto;
  }

  .port-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .port-row.output .port-body {
    align-items: flex-end;
  }

  .port-title-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .output-line {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .port-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.82);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 84px;
    min-width: 0;
  }

  .port-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
    flex: 0 1 auto;
    letter-spacing: 0.2px;
    max-width: 110px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .port-value.input {
    color: rgba(20, 184, 166, 0.92);
  }

  .port-value.output {
    color: rgba(99, 102, 241, 0.95);
  }

  :global(.port-control) {
    width: 100%;
  }

  :global(.port-inline-value) {
    width: auto;
    flex: 0 0 auto;
  }

  .node.local-loop {
    border-color: rgba(236, 72, 153, 0.8);
    box-shadow: 0 18px 56px rgba(236, 72, 153, 0.16);
  }

  .node.deployed-loop {
    border-color: rgba(20, 184, 166, 0.9);
    box-shadow: 0 18px 56px rgba(20, 184, 166, 0.16);
  }
</style>
