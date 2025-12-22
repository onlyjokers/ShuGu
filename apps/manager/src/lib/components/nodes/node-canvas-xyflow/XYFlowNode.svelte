<!--
  Purpose: Custom XYFlow node component that mirrors the Rete node DOM/CSS hooks.
  Notes:
  - Uses `.node`/`.socket` class names so existing NodeCanvas global styles apply.
-->
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { onDestroy } from 'svelte';
  import { ClassicPreset } from 'rete';
  import { nodeRegistry } from '$lib/nodes';
  import { nodeEngine } from '$lib/nodes';
  import { parameterRegistry } from '$lib/parameters/registry';
  import { nodeGraphLiveValues } from '$lib/features/node-graph-flags';
  import ReteControl from '../node-canvas/rete/ReteControl.svelte';
  import {
    AssetPickerControl,
    BooleanControl,
    ClientPickerControl,
    FilePickerControl,
    MidiLearnControl,
    SelectControl,
  } from '../node-canvas/rete/rete-controls';

  type $$Props = NodeProps;

  export let id: string;
  export let data: any;
  export let selected: boolean = false;

  $: nodeType = data?.type ?? '';
  $: label = data?.label ?? nodeType;
  $: def = nodeRegistry.get(nodeType);
  $: inputs = def?.inputs ?? [];
  $: outputs = def?.outputs ?? [];

  $: isLocalLoop = Boolean(data?.localLoop);
  $: isDeployedLoop = Boolean(data?.deployedLoop);
  $: isActive = Boolean(data?.active);
  $: isGroupDisabled = Boolean(data?.groupDisabled);
  $: isGroupSelected = Boolean(data?.groupSelected);
  $: activeInputs = new Set<string>(((data?.activeInputs ?? []) as unknown[]).map((v) => String(v)));
  $: activeOutputs = new Set<string>(((data?.activeOutputs ?? []) as unknown[]).map((v) => String(v)));

  const socketClass = (side: 'input' | 'output', portType: string, disabled = false): string => {
    const type = portType ? String(portType) : 'any';
    const base =
      side === 'input' ? `socket input-socket port-${type}` : `socket output-socket port-${type}`;
    return disabled ? `${base} socket-disabled` : base;
  };

  const isPortDisabled = (port: unknown): boolean => Boolean((port as any)?.disabled);

  // ────────────────────────────────────────────────────────────────────────────
  // Live port values (optional, gated by nodeGraphLiveValues)
  // ────────────────────────────────────────────────────────────────────────────

  const graphStateStore = nodeEngine.graphState;
  const tickTimeStore = nodeEngine.tickTime;

  type ConnectionInfo = { sourceNodeId: string; sourcePortId: string };
  let nodeId = '';
  $: nodeId = String(id ?? '');

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
    // Always show numeric ports (even when null), since these are common "MIDI pipe" signals.
    if (portType === 'number' || portType === 'fuzzy') {
      if (typeof value !== 'number') return '--';
      return formatNumber(value, 3);
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

  function effectiveInputValue(portId: string): unknown {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) return undefined;

    const conns = inputConnections[portId] ?? [];
    if (conns.length === 0) {
      const port = inputs?.find((p) => String(p.id) === String(portId));

      const stored = instance.inputValues?.[portId];
      if (stored !== undefined) return stored;
      if (port?.defaultValue !== undefined) return port.defaultValue;

      // Many nodes treat config fields as fallback values for unconnected inputs.
      const fromConfig = (instance.config as any)?.[portId];
      if (fromConfig !== undefined) return fromConfig;
      return undefined;
    }

    // Multi-connection sink inputs show a compact list preview (currently rendered as "--" for numeric ports).
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

  let liveValuesEnabled = false;
  let tickUnsub: (() => void) | null = null;
  let liveUnsub: (() => void) | null = null;

  const computePortValues = () => {
    if (!liveValuesEnabled || !nodeId) {
      portValueText = { inputs: {}, outputs: {} };
      return;
    }

    const nextInputs: Record<string, string | null> = {};
    for (const input of inputs ?? []) {
      const val = effectiveInputValue(String(input.id));
      const formatted = formatPortValue(String(input.type ?? 'any'), val);
      if (formatted !== null) nextInputs[String(input.id)] = formatted;
    }

    const nextOutputs: Record<string, string | null> = {};
    for (const output of outputs ?? []) {
      const val = effectiveOutputValue(String(output.id));
      const formatted = formatPortValue(String(output.type ?? 'any'), val);
      if (formatted !== null) nextOutputs[String(output.id)] = formatted;
    }

    portValueText = { inputs: nextInputs, outputs: nextOutputs };
  };

  const stopLiveTick = () => {
    tickUnsub?.();
    tickUnsub = null;
  };

  const startLiveTick = () => {
    stopLiveTick();
    tickUnsub = tickTimeStore.subscribe(() => {
      if (!liveValuesEnabled) return;
      computePortValues();
    });
  };

  // Initialize live-values subscriptions once per node component.
  liveUnsub = nodeGraphLiveValues.subscribe((enabled) => {
    liveValuesEnabled = Boolean(enabled);
    if (!liveValuesEnabled) {
      stopLiveTick();
      portValueText = { inputs: {}, outputs: {} };
      return;
    }

    startLiveTick();
    computePortValues();
  });

  onDestroy(() => {
    liveUnsub?.();
    liveUnsub = null;
    stopLiveTick();
  });

  $: if (liveValuesEnabled) {
    // Recompute immediately when graph wiring or node defs change (avoid waiting for next tick).
    void inputConnections;
    void inputs;
    void outputs;
    computePortValues();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Controls (basic parity with ReteBuilder + ReteControl)
  // ────────────────────────────────────────────────────────────────────────────

  type ControlEntry = { key: string; control: any };
  let nodeControls: ControlEntry[] = [];
  let inlineControlByInputId: Record<string, any> = {};

  const buildNumberParamOptions = (): { value: string; label: string }[] => {
    const params = parameterRegistry
      .list()
      .filter((p) => (p as any).type === 'number')
      .filter((p) => !(p as any).metadata?.hidden);

    return params
      .map((p) => ({
        value: (p as any).path,
        label: (p as any).metadata?.label || String((p as any).path ?? '').split('/').pop() || (p as any).path,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  $: if (nodeId && def) {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) {
      nodeControls = [];
      inlineControlByInputId = {};
    } else {
      const configFields = def.configSchema ?? [];
      const configFieldByKey = new Map<string, any>();
      for (const field of configFields) configFieldByKey.set(String(field.key), field);
      const inputControlKeys = new Set<string>();

      const nextInline: Record<string, any> = {};

      for (const input of inputs ?? []) {
        const isSink = input.kind === 'sink';
        const configField = configFieldByKey.get(String(input.id));
        const isSelectConfig = configField?.type === 'select';
        const configValue = (instance.config as any)?.[String(input.id)];
        const current = (instance.inputValues as any)?.[String(input.id)];
        const derivedDefault = input.defaultValue !== undefined ? input.defaultValue : configField?.defaultValue;
        const forceInlineInput =
          instance.type === 'client-object' &&
          (String(input.id) === 'index' || String(input.id) === 'range' || String(input.id) === 'random');
        const hasInitial =
          forceInlineInput || current !== undefined || configValue !== undefined || derivedDefault !== undefined;

        if (hasInitial && (input.type === 'number' || input.type === 'string' || input.type === 'boolean') && !isSink && !isSelectConfig) {
          if (input.type === 'number') {
            const min =
              typeof input.min === 'number'
                ? input.min
                : typeof configField?.min === 'number'
                  ? configField.min
                  : undefined;
            const max =
              typeof input.max === 'number'
                ? input.max
                : typeof configField?.max === 'number'
                  ? configField.max
                  : undefined;
            const step =
              typeof input.step === 'number'
                ? input.step
                : typeof configField?.step === 'number'
                  ? configField.step
                  : undefined;

            const initial =
              typeof current === 'number'
                ? current
                : typeof configValue === 'number'
                  ? configValue
                  : forceInlineInput
                    ? 1
                    : Number(derivedDefault ?? 0);

            const clamp = (value: number) => {
              let next = value;
              if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
              if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
              return next;
            };

            const control: any = new ClassicPreset.InputControl('number', {
              initial: clamp(initial),
              change: (value) => {
                const next = typeof value === 'number' ? clamp(value) : value;
                nodeEngine.updateNodeInputValue(nodeId, String(input.id), next);
              },
            });
            control.inline = true;
            control.min = min;
            control.max = max;
            control.step = step;
            nextInline[String(input.id)] = control;
            inputControlKeys.add(String(input.id));
          } else if (input.type === 'string') {
            const initial =
              typeof current === 'string'
                ? current
                : typeof configValue === 'string'
                  ? configValue
                  : String(derivedDefault ?? '');
            const control: any = new ClassicPreset.InputControl('text', {
              initial,
              change: (value) => nodeEngine.updateNodeInputValue(nodeId, String(input.id), value),
            });
            control.inline = true;
            nextInline[String(input.id)] = control;
            inputControlKeys.add(String(input.id));
          } else if (input.type === 'boolean') {
            const initial =
              typeof current === 'boolean'
                ? current
                : typeof configValue === 'boolean'
                  ? configValue
                  : forceInlineInput
                    ? false
                    : Boolean(derivedDefault);
            const control: any = new BooleanControl({
              initial,
              change: (value) => nodeEngine.updateNodeInputValue(nodeId, String(input.id), value),
            });
            control.inline = true;
            nextInline[String(input.id)] = control;
            inputControlKeys.add(String(input.id));
          }
        }

        if (!isSink && input.type === 'color') {
          const initial =
            typeof (instance.config as any)?.[String(input.id)] === 'string'
              ? String((instance.config as any)[String(input.id)])
              : typeof current === 'string'
                ? String(current)
                : String(derivedDefault ?? '#ffffff');
          const control: any = new ClassicPreset.InputControl('text', {
            initial,
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [String(input.id)]: value }),
          });
          control.inline = true;
          nextInline[String(input.id)] = control;
          inputControlKeys.add(String(input.id));
        }

        if (!isSink && configField?.type === 'select') {
          const control: any = new SelectControl({
            initial: String((instance.config as any)?.[String(input.id)] ?? configField.defaultValue ?? ''),
            options: configField.options ?? [],
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [String(input.id)]: value }),
          });
          control.inline = true;
          nextInline[String(input.id)] = control;
          inputControlKeys.add(String(input.id));
        }
      }

      const nextControls: ControlEntry[] = [];
      for (const field of def.configSchema ?? []) {
        if (inputControlKeys.has(String(field.key))) continue;
        const key = String(field.key);
        const current = (instance.config as any)?.[key] ?? field.defaultValue;

        if (field.type === 'select') {
          nextControls.push({
            key,
            control: new SelectControl({
              label: field.label,
              initial: String(current ?? ''),
              options: field.options ?? [],
              change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
            }),
          });
        } else if (field.type === 'boolean') {
          nextControls.push({
            key,
            control: new BooleanControl({
              label: field.label,
              initial: Boolean(current),
              change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
            }),
          });
        } else if (field.type === 'number') {
          const clamp = (value: number) => {
            let next = value;
            const min = typeof field.min === 'number' ? field.min : undefined;
            const max = typeof field.max === 'number' ? field.max : undefined;
            if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
            if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
            return next;
          };

          const control: any = new ClassicPreset.InputControl('number', {
            initial: clamp(Number(current ?? 0)),
            change: (value) => {
              const next = typeof value === 'number' ? clamp(value) : value;
              nodeEngine.updateNodeConfig(nodeId, { [key]: next });
            },
          });
          control.controlLabel = field.label;
          control.min = field.min;
          control.max = field.max;
          control.step = field.step;
          nextControls.push({ key, control });
        } else if (field.type === 'client-picker') {
          const control: any = new ClientPickerControl({
            label: field.label,
            initial: String(current ?? ''),
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
          });
          nextControls.push({ key, control });
        } else if (field.type === 'asset-picker') {
          const control: any = new AssetPickerControl({
            label: field.label,
            initial: String(current ?? ''),
            assetKind: (field as any).assetKind ?? 'any',
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
          });
          nextControls.push({ key, control });
        } else if (field.type === 'param-path') {
          nextControls.push({
            key,
            control: new SelectControl({
              label: field.label,
              placeholder: 'Select parameter…',
              initial: String(current ?? ''),
              options: buildNumberParamOptions().map((p) => ({ value: p.value, label: `${p.label} (${p.value})` })),
              change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
            }),
          });
        } else if (field.type === 'file') {
          const control: any = new FilePickerControl({
            label: field.label,
            initial: typeof current === 'string' ? current : '',
            accept: field.accept,
            buttonLabel: field.buttonLabel,
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
          });
          nextControls.push({ key, control });
        } else if (field.type === 'midi-source') {
          nextControls.push({ key, control: new MidiLearnControl({ nodeId, label: field.label }) });
        } else {
          const control: any = new ClassicPreset.InputControl('text', {
            initial: String(current ?? ''),
            change: (value) => nodeEngine.updateNodeConfig(nodeId, { [key]: value }),
          });
          control.controlLabel = field.label;
          nextControls.push({ key, control });
        }
      }

      nodeControls = nextControls;
      inlineControlByInputId = nextInline;
    }
  } else {
    nodeControls = [];
    inlineControlByInputId = {};
  }
</script>

<div
  class="node"
  class:selected
  class:local-loop={isLocalLoop}
  class:deployed-loop={isDeployedLoop}
  class:active={isActive}
  class:group-selected={isGroupSelected}
  class:group-disabled={isGroupDisabled}
  data-testid="node"
>
  <div class="title" data-testid="title">{label}</div>

  {#if nodeControls.length > 0}
    <div class="controls">
      {#each nodeControls as entry (entry.key)}
        <div class="control" data-testid={"control-" + entry.key}>
          <ReteControl data={entry.control} />
        </div>
      {/each}
    </div>
  {/if}

  <div class="ports">
    {#if inputs.length > 0}
      <div class="inputs">
        {#each inputs as input}
          <div class="port-row input {activeInputs.has(String(input.id)) ? 'active' : ''}" data-testid={"input-" + input.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={input.id}
              class={socketClass('input', String(input.type ?? 'any'))}
            />
            <div class="port-body">
              <div class="port-title-line">
                <div class="port-label" data-testid="input-title">{input.label ?? input.id}</div>
                {#if portValueText.inputs[String(input.id)] && (inputConnections[String(input.id)]?.length ?? 0) > 0}
                  <div class="port-value input" data-testid={"input-value-" + input.id}>
                    {portValueText.inputs[String(input.id)]}
                  </div>
                {:else if inlineControlByInputId[String(input.id)] && (inputConnections[String(input.id)]?.length ?? 0) === 0}
                  <div class="port-control port-inline-input" data-testid="input-control">
                    <ReteControl data={inlineControlByInputId[String(input.id)]} />
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if outputs.length > 0}
      <div class="outputs">
        {#each outputs as output}
          <div class="port-row output {activeOutputs.has(String(output.id)) ? 'active' : ''}" data-testid={"output-" + output.id}>
            <div class="port-body">
              <div class="output-line">
                <div class="port-label" data-testid="output-title">{output.label ?? output.id}</div>
                {#if portValueText.outputs[String(output.id)]}
                  <div class="port-value output" data-testid={"output-value-" + output.id}>
                    {portValueText.outputs[String(output.id)]}
                  </div>
                {/if}
              </div>
            </div>
            <Handle
              type="source"
              position={Position.Right}
              id={output.id}
              class={socketClass('output', String(output.type ?? 'any'), isPortDisabled(output))}
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

  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .inputs,
  .outputs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .outputs {
    align-items: flex-end;
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
    display: inline-flex;
    align-items: center;
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
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(2, 6, 23, 0.32);
    border-radius: 10px;
    padding: 4px 8px;
  }

  .port-value.input {
    color: rgba(20, 184, 166, 0.92);
  }

  .port-value.output {
    color: rgba(99, 102, 241, 0.95);
  }

  .node.active {
    outline: 2px solid rgba(250, 204, 21, 0.55);
    outline-offset: 0;
  }

  .node.group-selected {
    outline: 2px solid rgba(59, 130, 246, 0.55);
    outline-offset: 0;
  }

  .node.group-disabled {
    opacity: 0.42;
    filter: grayscale(0.78) saturate(0.35);
  }

  .node.group-disabled .title {
    color: rgba(226, 232, 240, 0.7);
  }

  .node.group-disabled .port-label {
    color: rgba(226, 232, 240, 0.55);
  }

  .port-row.active {
    background: rgba(250, 204, 21, 0.08);
    border-radius: 10px;
  }

  .port-row.active .port-label {
    color: rgba(255, 255, 255, 0.92);
  }

  .port-row.active .port-value {
    color: rgba(250, 204, 21, 0.95);
  }

  .port-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .port-title-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
  }

  .output-line {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
  }
</style>
