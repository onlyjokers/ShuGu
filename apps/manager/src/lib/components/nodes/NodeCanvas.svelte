<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { ClassicPreset, NodeEditor } from 'rete';
  import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
  import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
  import { HistoryPlugin } from 'rete-history-plugin';
  import { SveltePlugin, Presets as SveltePresets } from 'rete-svelte-plugin';

  import Button from '$lib/components/ui/Button.svelte';
  import ReteNode from '$lib/components/nodes/ReteNode.svelte';
  import ReteControl from '$lib/components/nodes/ReteControl.svelte';
  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import { parameterRegistry } from '$lib/parameters/registry';
  import type { NodeInstance, Connection as EngineConnection } from '$lib/nodes/types';
  import { BooleanControl, ClientPickerControl, SelectControl } from './rete-controls';

  // Rete core handles the view; nodeEngine remains the source of truth for execution

  let container: HTMLDivElement | null = null;
  let editor: NodeEditor<any> | null = null;
  let areaPlugin: any = null;
  let graphUnsub: (() => void) | null = null;
  let paramsUnsub: (() => void) | null = null;

  // Shared sockets mapped to our port types
  const sockets = {
    number: new ClassicPreset.Socket('number'),
    boolean: new ClassicPreset.Socket('boolean'),
    string: new ClassicPreset.Socket('string'),
    client: new ClassicPreset.Socket('client'),
    command: new ClassicPreset.Socket('command'),
    any: new ClassicPreset.Socket('any'),
  } as const;

  const nodeMap = new Map<string, any>();
  const connectionMap = new Map<string, any>();

  let addCategory = 'Objects';
  let addItem = '';
  let addItems: { value: string; label: string }[] = [];
  let selectedNodeId = '';
  let nodeCount = 0;
  let graphState = { nodes: [], connections: [] };
  let numberParamOptions: { path: string; label: string }[] = [];
  let selectedNode: NodeInstance | undefined = undefined;
  let selectedDef: any = undefined;
  let runtimeSnapshot: NodeInstance | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  // Store handles
  let graphStateStore = nodeEngine?.graphState;
  let isRunningStore = nodeEngine?.isRunning;
  let lastErrorStore = nodeEngine?.lastError;

  const nodeCategories = nodeRegistry.listByCategory();
  const addCategoryOptions = ['Objects', ...Array.from(nodeCategories.keys()).filter((k) => k !== 'Objects')];

  $: {
    const defs = nodeCategories.get(addCategory) ?? [];
    addItems = defs.map((d) => ({ value: d.type, label: d.label }));

    if (!addItems.some((i) => i.value === addItem)) {
      addItem = addItems[0]?.value ?? '';
    }
  }

  function refreshNumberParams() {
    const params = parameterRegistry
      .list()
      .filter((p) => p.type === 'number')
      .filter((p) => !p.metadata?.hidden);
    numberParamOptions = params
      .map((p) => ({
        path: p.path,
        label: p.metadata?.label || p.path.split('/').pop() || p.path,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function nodeLabel(node: NodeInstance): string {
    if (node.type === 'client-object') {
      const id = String(node.config?.clientId ?? '');
      return id ? `Client: ${id}` : 'Client';
    }
    return nodeRegistry.get(node.type)?.label ?? node.type;
  }

  function safeClone<T>(value: T): T {
    try {
      // @ts-ignore
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {
      // ignore
    }
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  function refreshRuntimeSnapshot() {
    if (!selectedNodeId) {
      runtimeSnapshot = null;
      return;
    }
    const node = nodeEngine.getNode(selectedNodeId);
    runtimeSnapshot = node ? safeClone(node) : null;
  }

  function socketFor(type: string | undefined) {
    if (type && type in sockets) return sockets[type as keyof typeof sockets];
    return sockets.any;
  }

  function generateId(): string {
    return `node-${crypto.randomUUID?.() ?? Date.now()}`;
  }

  function buildReteNode(instance: NodeInstance): any {
    const def = nodeRegistry.get(instance.type);
    const node: any = new ClassicPreset.Node(nodeLabel(instance));
    // Ensure Rete IDs match engine IDs so editor events map back cleanly.
    node.id = instance.id;

    for (const input of def?.inputs ?? []) {
      const multipleConnections = input.kind === 'sink';
      const inp = new ClassicPreset.Input(
        socketFor(input.type),
        input.label ?? input.id,
        multipleConnections
      );

      // ComfyUI-like default widgets for primitive inputs with defaultValue
      const hasDefault = input.defaultValue !== undefined;
      const isPrimitive = input.type === 'number' || input.type === 'string' || input.type === 'boolean';
      const isSink = input.kind === 'sink';
      if (hasDefault && isPrimitive && !isSink) {
        const current = instance.inputValues?.[input.id];
        if (input.type === 'number') {
          const initial = typeof current === 'number' ? current : Number(input.defaultValue ?? 0);
          inp.addControl(
            new ClassicPreset.InputControl('number', {
              initial,
              change: (value) => nodeEngine.updateNodeInputValue(instance.id, input.id, value),
            })
          );
        } else if (input.type === 'string') {
          const initial = typeof current === 'string' ? current : String(input.defaultValue ?? '');
          inp.addControl(
            new ClassicPreset.InputControl('text', {
              initial,
              change: (value) => nodeEngine.updateNodeInputValue(instance.id, input.id, value),
            })
          );
        } else if (input.type === 'boolean') {
          const initial = typeof current === 'boolean' ? current : Boolean(input.defaultValue);
          inp.addControl(
            new BooleanControl({
              initial,
              change: (value) => nodeEngine.updateNodeInputValue(instance.id, input.id, value),
            })
          );
        }
        inp.showControl = true;
      }

      node.addInput(input.id, inp);
    }

    for (const output of def?.outputs ?? []) {
      node.addOutput(
        output.id,
        new ClassicPreset.Output(socketFor(output.type), output.label ?? output.id)
      );
    }

    // ComfyUI-like node widgets: render configSchema as inline controls
    if (instance.type === 'client-object') {
      node.addControl(
        'clientId',
        new ClientPickerControl({
          label: 'Clients',
          initial: String(instance.config?.clientId ?? ''),
          change: (value) => nodeEngine.updateNodeConfig(instance.id, { clientId: value }),
        })
      );
    }

    for (const field of def?.configSchema ?? []) {
      const key = field.key;
      const current = instance.config?.[key] ?? field.defaultValue;
      if (field.type === 'select') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            initial: String(current ?? ''),
            options: field.options ?? [],
            change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
          })
        );
      } else if (field.type === 'boolean') {
        node.addControl(
          key,
          new BooleanControl({
            label: field.label,
            initial: Boolean(current),
            change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
          })
        );
      } else if (field.type === 'number') {
        const control: any = new ClassicPreset.InputControl('number', {
          initial: Number(current ?? 0),
          change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
        });
        control.controlLabel = field.label;
        node.addControl(key, control);
      } else if (field.type === 'param-path') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            placeholder: 'Select parameter…',
            initial: String(current ?? ''),
            options: numberParamOptions.map((p) => ({ value: p.path, label: `${p.label} (${p.path})` })),
            change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
          })
        );
      } else {
        const control: any = new ClassicPreset.InputControl('text', {
          initial: String(current ?? ''),
          change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
        });
        control.controlLabel = field.label;
        node.addControl(key, control);
      }
    }

    node.position = [instance.position.x, instance.position.y];
    return node;
  }

  async function syncGraph(state: { nodes: NodeInstance[]; connections: EngineConnection[] }) {
    if (!editor || !areaPlugin) return;

    graphState = state;
    nodeCount = state.nodes.length;

    // Add / update nodes
    for (const n of state.nodes) {
      let reteNode = nodeMap.get(n.id);
      if (!reteNode) {
        reteNode = buildReteNode(n);
        await editor.addNode(reteNode);
        nodeMap.set(n.id, reteNode);
      } else {
        const nextLabel = nodeLabel(n);
        if (reteNode.label !== nextLabel) {
          reteNode.label = nextLabel;
          await areaPlugin.update('node', reteNode.id);
        }
      }
      await areaPlugin.translate(reteNode.id, { x: n.position.x, y: n.position.y });
    }

    // Remove stale nodes
    for (const [id, reteNode] of Array.from(nodeMap.entries())) {
      if (!state.nodes.find((n) => n.id === id)) {
        editor.removeNode(reteNode);
        nodeMap.delete(id);
      }
    }

    // Add connections
    for (const c of state.connections) {
      if (connectionMap.has(c.id)) continue;
      const src = nodeMap.get(c.sourceNodeId);
      const tgt = nodeMap.get(c.targetNodeId);
      if (!src || !tgt) continue;
      const conn: any = new ClassicPreset.Connection(src, c.sourcePortId, tgt, c.targetPortId);
      conn.id = c.id;
      await editor.addConnection(conn);
      connectionMap.set(c.id, conn);
    }

    // Remove stale connections
    for (const [id, conn] of Array.from(connectionMap.entries())) {
      if (!state.connections.find((c) => c.id === id)) {
        editor.removeConnection(conn);
        connectionMap.delete(id);
      }
    }
  }

  // Mirror Rete interactions back into nodeEngine
  function bindEditorPipes() {
    if (!editor) return;
    editor.addPipe(async (ctx) => {
      if (!ctx || typeof ctx !== 'object') return ctx;

      // Connection created by user drag
      if (ctx.type === 'connectioncreated') {
        const c = ctx.data as any;
        const engineConn: EngineConnection = {
          id: String(c.id),
          sourceNodeId: String(c.source),
          sourcePortId: String(c.sourceOutput),
          targetNodeId: String(c.target),
          targetPortId: String(c.targetInput),
        };
        const accepted = nodeEngine.addConnection(engineConn);
        if (accepted) {
          connectionMap.set(engineConn.id, c);
          const targetNode = nodeMap.get(engineConn.targetNodeId);
          const input = targetNode?.inputs?.[engineConn.targetPortId];
          if (input?.control) {
            input.showControl = false;
            await areaPlugin?.update?.('node', engineConn.targetNodeId);
          }
        } else if (editor) {
          // Engine rejected; rollback UI to match source of truth.
          await editor.removeConnection(c);
        }
      }

      // Connection removed via UI
      if (ctx.type === 'connectionremoved') {
        const raw = ctx.data as any;
        const id = String(raw.id);
        const targetId = String(raw.target);
        const portId = String(raw.targetInput);
        connectionMap.delete(id);
        nodeEngine.removeConnection(id);
        const targetNode = nodeMap.get(targetId);
        const input = targetNode?.inputs?.[portId];
        if (input?.control) {
          const stillConnected = Array.from(connectionMap.values()).some(
            (conn: any) => String(conn.target) === targetId && String(conn.targetInput) === portId
          );
          input.showControl = !stillConnected;
          await areaPlugin?.update?.('node', targetId);
        }
      }

      // Node removed via UI
      if (ctx.type === 'noderemoved') {
        const id = String((ctx.data as any).id);
        nodeMap.delete(id);
        nodeEngine.removeNode(id);
      }

      return ctx;
    });

    // Track node drag to persist positions
    if (areaPlugin) {
      areaPlugin.addPipe((ctx: any) => {
        if (ctx?.type === 'nodepicked') {
          selectedNodeId = String(ctx.data?.id ?? '');
        }
        if (ctx?.type === 'pointerdown') {
          const target = ctx.data?.event?.target as HTMLElement | undefined;
          const clickedNode = target?.closest?.('.node');
          if (!clickedNode) selectedNodeId = '';
        }
        if (ctx?.type === 'nodetranslated') {
          const { id, position } = ctx.data ?? {};
          if (id && position) {
            nodeEngine.updateNodePosition(String(id), { x: position.x, y: position.y });
          }
        }
        return ctx;
      });
    }
  }

  function addNode(type: string) {
    const def = nodeRegistry.get(type);
    if (!def) return;
    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) {
      config[field.key] = field.defaultValue;
    }
    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position: { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 },
      config,
      inputValues: {},
      outputValues: {},
    };
    nodeEngine.addNode(newNode);
  }

  function handleAddNode() {
    if (!addItem) return;
    addNode(addItem);
  }

  function handleToggleEngine() {
    if ($isRunningStore) {
      nodeEngine.stop();
    } else {
      nodeEngine.start();
    }
  }

  function handleClear() {
    if (confirm('Clear all nodes?')) {
      nodeEngine.clear();
    }
  }

  function updateSelectedConfig(fieldKey: string, value: unknown) {
    if (!selectedNodeId) return;
    nodeEngine.updateNodeConfig(selectedNodeId, { [fieldKey]: value });
  }

  function readTextValue(e: Event): string {
    return String((e.target as HTMLInputElement | HTMLSelectElement).value);
  }

  function readNumberValue(e: Event): number {
    const num = Number((e.target as HTMLInputElement).value);
    return Number.isFinite(num) ? num : 0;
  }

  function readChecked(e: Event): boolean {
    return Boolean((e.target as HTMLInputElement).checked);
  }

  $: if (selectedNodeId && !graphState.nodes.some((n) => n.id === selectedNodeId)) {
    selectedNodeId = '';
  }

  $: selectedNode = graphState.nodes.find((n) => n.id === selectedNodeId);
  $: selectedDef = selectedNode ? nodeRegistry.get(selectedNode.type) : undefined;
  $: refreshRuntimeSnapshot();

  $: {
    if (snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
    if (selectedNodeId && $isRunningStore) {
      snapshotTimer = setInterval(refreshRuntimeSnapshot, 200);
    }
  }

  onMount(async () => {
    if (!container) return;

    refreshNumberParams();
    paramsUnsub = parameterRegistry.subscribe(() => refreshNumberParams());

    editor = new NodeEditor('fluffy-rete');
    // @ts-expect-error runtime constructor expects container element
    areaPlugin = new AreaPlugin(container);
    const connection: any = new ConnectionPlugin();
    const render: any = new SveltePlugin();
    const history = new HistoryPlugin();

    // IMPORTANT: AreaPlugin is used by editor, but render/connection/history plugins must be used by AreaPlugin
    // because they consume Area signals (render/pointer events).
    editor.use(areaPlugin);
    areaPlugin.use(connection);
    areaPlugin.use(render);
    areaPlugin.use(history);

    // Types in presets are strict to ClassicScheme; runtime is fine for our usage
    // @ts-expect-error loose preset application
    connection.addPreset(ConnectionPresets.classic.setup());
    // @ts-expect-error preset type mismatch
    render.addPreset(
      // @ts-expect-error preset type mismatch
      SveltePresets.classic.setup({
        customize: {
          node: () => ReteNode,
          control: () => ReteControl,
        },
      })
    );

    const selector = AreaExtensions.selector();
    const accumulating = AreaExtensions.accumulateOnCtrl();
    AreaExtensions.selectableNodes(areaPlugin, selector, { accumulating });

    await syncGraph(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => syncGraph(state));

    // Fit view on first render
    if (areaPlugin) {
      AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
    }

    bindEditorPipes();

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key !== 'Backspace' && key !== 'Delete') return;

      const el = (event.target as HTMLElement | null) ?? document.activeElement;
      const tag = el?.tagName?.toLowerCase?.() ?? '';
      const isEditing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean((el as any)?.isContentEditable);
      if (isEditing) return;

      if (!selectedNodeId) return;
      event.preventDefault();
      nodeEngine.removeNode(selectedNodeId);
    };

    window.addEventListener('keydown', onKeyDown);
    keydownHandler = onKeyDown;
  });

  onDestroy(() => {
    graphUnsub?.();
    paramsUnsub?.();
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
    areaPlugin?.destroy?.();
    editor?.clear();
    nodeMap.clear();
    connectionMap.clear();
  });
</script>

<div class="node-canvas-container">
  <div class="canvas-toolbar">
    <div class="toolbar-left">
      <Button
        variant={$isRunningStore ? 'danger' : 'primary'}
        size="sm"
        on:click={handleToggleEngine}
      >
        {$isRunningStore ? '⏹ Stop' : '▶ Start'}
      </Button>
      <Button variant="ghost" size="sm" on:click={handleClear}>🗑️ Clear</Button>
      <span class="node-count">{nodeCount} nodes</span>
    </div>
    <div class="toolbar-right">
      {#if $lastErrorStore}
        <span class="error-message">⚠️ {$lastErrorStore}</span>
      {/if}
    </div>
  </div>

  <div class="canvas-actions">
    <select bind:value={addCategory} aria-label="Node category">
      {#each addCategoryOptions as cat}
        <option value={cat}>{cat}</option>
      {/each}
    </select>

    <select bind:value={addItem} aria-label="Node type" disabled={addItems.length === 0}>
      {#if addItems.length === 0}
        <option value="">
          {addCategory === 'Objects' ? 'No clients connected' : 'No nodes'}
        </option>
      {:else}
        {#each addItems as item (item.value)}
          <option value={item.value}>{item.label}</option>
        {/each}
      {/if}
    </select>

    <Button variant="secondary" size="sm" on:click={handleAddNode} disabled={!addItem}>Add</Button>

    <div class="actions-spacer"></div>
    <div class="selection-info" aria-live="polite">
      {#if selectedNodeId && selectedNode}
        <span class="selected-node">Selected: {nodeLabel(selectedNode)}</span>
        <Button variant="danger" size="sm" on:click={() => nodeEngine.removeNode(selectedNodeId)}>Delete</Button>
      {:else}
        <span class="selected-node hint">Click a node · Del/Backspace to delete</span>
      {/if}
    </div>
  </div>

  {#if selectedNodeId && selectedNode}
    <div class="node-inspector">
      <div class="inspector-title">{nodeLabel(selectedNode)}</div>

      {#if selectedDef?.configSchema?.length}
        <div class="inspector-fields">
          {#each selectedDef.configSchema as field (field.key)}
            <div class="inspector-field">
              <label class="field-label" for={`cfg-${selectedNodeId}-${field.key}`}>{field.label}</label>

              {#if field.type === 'number'}
                <input
                  id={`cfg-${selectedNodeId}-${field.key}`}
                  type="number"
                  class="field-input"
                  value={selectedNode.config?.[field.key] ?? field.defaultValue ?? 0}
                  on:change={(e) => updateSelectedConfig(field.key, readNumberValue(e))}
                />
              {:else if field.type === 'boolean'}
                <input
                  id={`cfg-${selectedNodeId}-${field.key}`}
                  type="checkbox"
                  checked={Boolean(selectedNode.config?.[field.key] ?? field.defaultValue)}
                  on:change={(e) => updateSelectedConfig(field.key, readChecked(e))}
                />
              {:else if field.type === 'select'}
                <select
                  id={`cfg-${selectedNodeId}-${field.key}`}
                  class="field-input"
                  value={selectedNode.config?.[field.key] ?? field.defaultValue ?? ''}
                  on:change={(e) => updateSelectedConfig(field.key, readTextValue(e))}
                >
                  {#each field.options ?? [] as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              {:else if field.type === 'param-path'}
                <select
                  id={`cfg-${selectedNodeId}-${field.key}`}
                  class="field-input"
                  value={selectedNode.config?.[field.key] ?? field.defaultValue ?? ''}
                  on:change={(e) => updateSelectedConfig(field.key, readTextValue(e))}
                >
                  <option value="">Select parameter...</option>
                  {#each numberParamOptions as p (p.path)}
                    <option value={p.path}>{p.label} ({p.path})</option>
                  {/each}
                </select>
              {:else}
                <input
                  id={`cfg-${selectedNodeId}-${field.key}`}
                  type="text"
                  class="field-input"
                  value={selectedNode.config?.[field.key] ?? field.defaultValue ?? ''}
                  on:change={(e) => updateSelectedConfig(field.key, readTextValue(e))}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if runtimeSnapshot}
        <details class="inspector-debug" open>
          <summary class="debug-summary">Runtime</summary>
          <div class="debug-grid">
            <div class="debug-block">
              <div class="debug-title">Inputs</div>
              <pre class="debug-json">{JSON.stringify(runtimeSnapshot.inputValues ?? {}, null, 2)}</pre>
            </div>
            <div class="debug-block">
              <div class="debug-title">Outputs</div>
              <pre class="debug-json">{JSON.stringify(runtimeSnapshot.outputValues ?? {}, null, 2)}</pre>
            </div>
          </div>
        </details>
      {/if}
    </div>
  {/if}

  <div
    class="canvas-wrapper"
    bind:this={container}
    role="application"
    aria-label="Node graph editor"
  ></div>
</div>

<style>
  .node-canvas-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 680px;
    background: radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.18), transparent 45%),
      radial-gradient(circle at 80% 10%, rgba(168, 85, 247, 0.16), transparent 50%),
      linear-gradient(180deg, #0b0c14 0%, #070811 100%);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    border: 1px solid var(--border-color, #444);
  }

  .canvas-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--bg-secondary, #252525);
    border-bottom: 1px solid var(--border-color, #444);
  }

  .toolbar-left {
    display: flex;
    gap: var(--space-sm, 8px);
    align-items: center;
  }

  .node-count {
    color: var(--text-muted, #666);
    font-size: var(--text-sm, 0.875rem);
  }

  .error-message {
    color: var(--color-error, #ef4444);
    font-size: var(--text-sm, 0.875rem);
  }

  .canvas-actions {
    display: flex;
    gap: var(--space-sm, 8px);
    align-items: center;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    background: var(--bg-tertiary, #2a2a2a);
    border-bottom: 1px solid var(--border-color, #444);
  }

  .actions-spacer {
    flex: 1;
  }

  .selection-info {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    min-width: 0;
  }

  .selected-node {
    color: rgba(255, 255, 255, 0.82);
    font-size: var(--text-sm, 0.875rem);
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-node.hint {
    color: rgba(255, 255, 255, 0.6);
  }

  .canvas-actions select {
    background: var(--bg-secondary, #252525);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-sm, 6px);
    padding: 6px 10px;
  }

  .node-inspector {
    padding: var(--space-md, 16px);
    background: rgba(17, 24, 39, 0.6);
    border-bottom: 1px solid var(--border-color, #444);
    backdrop-filter: blur(8px);
  }

  .inspector-title {
    color: var(--text-primary, #fff);
    font-weight: 600;
    margin-bottom: var(--space-sm, 8px);
  }

  .inspector-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-sm, 8px) var(--space-md, 16px);
    align-items: center;
  }

  .inspector-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    color: var(--text-secondary, #a0a0a0);
    font-size: var(--text-xs, 0.8rem);
  }

  .field-input {
    background: var(--bg-tertiary, #2a2a2a);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-sm, 6px);
    padding: 6px 10px;
  }

  .canvas-wrapper {
    flex: 1;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      radial-gradient(circle at 30% 0%, rgba(99, 102, 241, 0.12), transparent 50%),
      radial-gradient(circle at 70% 10%, rgba(168, 85, 247, 0.1), transparent 55%),
      linear-gradient(180deg, rgba(10, 11, 20, 0.85) 0%, rgba(7, 8, 17, 0.95) 100%);
    background-size: 32px 32px, 32px 32px, auto, auto, auto;
    background-position: center, center, center, center, center;
  }

  .inspector-debug {
    margin-top: var(--space-md, 16px);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: var(--space-sm, 10px);
  }

  .debug-summary {
    color: var(--text-secondary, #a0a0a0);
    cursor: pointer;
    font-weight: 600;
    user-select: none;
  }

  .debug-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md, 16px);
    margin-top: var(--space-sm, 8px);
  }

  .debug-block {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-md, 8px);
    padding: var(--space-sm, 10px);
    min-width: 0;
  }

  .debug-title {
    font-size: var(--text-xs, 0.8rem);
    color: var(--text-secondary, #a0a0a0);
    margin-bottom: 6px;
  }

  .debug-json {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
    font-size: 12px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.85);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }

  /* --- Rete Classic preset overrides --- */
  :global(.node-canvas-container .node) {
    background: rgba(17, 24, 39, 0.92) !important;
    border: 1px solid rgba(99, 102, 241, 0.35) !important;
    border-radius: 12px !important;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38) !important;
    width: 230px !important;
  }

  :global(.node-canvas-container .node:hover) {
    border-color: rgba(99, 102, 241, 0.6) !important;
  }

  :global(.node-canvas-container .node.selected) {
    border-color: rgba(99, 102, 241, 0.95) !important;
    box-shadow: 0 18px 52px rgba(99, 102, 241, 0.18) !important;
  }

  :global(.node-canvas-container .node .title) {
    color: rgba(255, 255, 255, 0.92) !important;
    font-size: 14px !important;
    padding: 10px 12px !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    letter-spacing: 0.2px;
  }

  :global(.node-canvas-container .node .input-title),
  :global(.node-canvas-container .node .output-title) {
    color: rgba(255, 255, 255, 0.78) !important;
    font-size: 12px !important;
    margin: 4px 8px !important;
    line-height: 18px !important;
  }

  :global(.node-canvas-container .socket) {
    width: 14px !important;
    height: 14px !important;
    border-radius: 999px !important;
    margin: 6px !important;
    border: 2px solid rgba(255, 255, 255, 0.35) !important;
    background: rgba(99, 102, 241, 0.95) !important;
  }

  /* socket color by type (via title attr from ClassicPreset.Socket.name) */
  :global(.node-canvas-container .socket[title='number']) {
    background: rgba(34, 197, 94, 0.92) !important;
  }

  :global(.node-canvas-container .socket[title='boolean']) {
    background: rgba(245, 158, 11, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='string']) {
    background: rgba(59, 130, 246, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='client']) {
    background: rgba(168, 85, 247, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='command']) {
    background: rgba(239, 68, 68, 0.92) !important;
  }

  :global(.node-canvas-container .socket[title='any']) {
    background: rgba(99, 102, 241, 0.95) !important;
  }

  :global(.node-canvas-container .socket:hover) {
    border-width: 3px !important;
  }

  :global(.node-canvas-container .output-socket) {
    margin-right: -10px !important;
  }

  :global(.node-canvas-container .input-socket) {
    margin-left: -10px !important;
  }
</style>
