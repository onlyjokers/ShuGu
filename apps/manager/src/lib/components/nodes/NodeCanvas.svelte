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
  let isSyncingGraph = false;

  let addCategory = 'Objects';
  let addItem = '';
  let addItems: { value: string; label: string }[] = [];
  let selectedNodeId = '';
  let nodeCount = 0;
  let graphState = { nodes: [], connections: [] };
  let numberParamOptions: { path: string; label: string }[] = [];
  let selectedNode: NodeInstance | undefined = undefined;
  let isNodeDragging = false;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let wheelHandler: ((event: WheelEvent) => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;

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

  function socketFor(type: string | undefined) {
    if (type && type in sockets) return sockets[type as keyof typeof sockets];
    return sockets.any;
  }

  function generateId(): string {
    return `node-${crypto.randomUUID?.() ?? Date.now()}`;
  }

  function setSelectedNode(nextId: string) {
    const prevId = selectedNodeId;
    if (prevId === nextId) return;

    selectedNodeId = nextId;

    if (prevId) {
      const prev = nodeMap.get(prevId);
      if (prev && prev.selected) {
        prev.selected = false;
        areaPlugin?.update?.('node', prevId);
      }
    }

    if (nextId) {
      const next = nodeMap.get(nextId);
      if (next && !next.selected) {
        next.selected = true;
        areaPlugin?.update?.('node', nextId);
      }
    }
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

    isSyncingGraph = true;
    try {
      graphState = state;
      nodeCount = state.nodes.length;

      // Add / update nodes
      for (const n of state.nodes) {
        let reteNode = nodeMap.get(n.id);
        if (!reteNode) {
          reteNode = buildReteNode(n);
          await editor.addNode(reteNode);
          nodeMap.set(n.id, reteNode);
          if (n.id === selectedNodeId) {
            reteNode.selected = true;
            await areaPlugin.update('node', n.id);
          }
        } else {
          const nextLabel = nodeLabel(n);
          if (reteNode.label !== nextLabel) {
            reteNode.label = nextLabel;
            await areaPlugin.update('node', reteNode.id);
          }
        }
        await areaPlugin.translate(reteNode.id, { x: n.position.x, y: n.position.y });
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

        const targetNode = nodeMap.get(c.targetNodeId);
        const input = targetNode?.inputs?.[c.targetPortId];
        if (input?.control) {
          input.showControl = false;
          await areaPlugin.update('node', c.targetNodeId);
        }
      }

      // Remove stale connections
      for (const [id, conn] of Array.from(connectionMap.entries())) {
        if (state.connections.find((c) => c.id === id)) continue;
        const targetId = String((conn as any).target ?? '');
        const portId = String((conn as any).targetInput ?? '');

        await editor.removeConnection(id);
        connectionMap.delete(id);

        const targetNode = nodeMap.get(targetId);
        const input = targetNode?.inputs?.[portId];
        if (input?.control) {
          const stillConnected = Array.from(connectionMap.values()).some(
            (c2: any) => String(c2.target) === targetId && String(c2.targetInput) === portId
          );
          input.showControl = !stillConnected;
          await areaPlugin.update('node', targetId);
        }
      }

      // Remove stale nodes
      for (const [id] of Array.from(nodeMap.entries())) {
        if (state.nodes.find((n) => n.id === id)) continue;
        await editor.removeNode(id);
        nodeMap.delete(id);
      }
    } finally {
      isSyncingGraph = false;
    }
  }

  // Mirror Rete interactions back into nodeEngine
  function bindEditorPipes() {
    if (!editor) return;
    editor.addPipe(async (ctx) => {
      if (!ctx || typeof ctx !== 'object') return ctx;
      if (isSyncingGraph) return ctx;

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
          await editor.removeConnection(String(c.id));
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
          isNodeDragging = true;
          setSelectedNode(String(ctx.data?.id ?? ''));
        }
        if (ctx?.type === 'nodedragged') {
          isNodeDragging = false;
        }
        if (ctx?.type === 'pointerdown') {
          const target = ctx.data?.event?.target as HTMLElement | undefined;
          const clickedNode = target?.closest?.('.node');
          if (!clickedNode) setSelectedNode('');
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

  $: if (selectedNodeId && !graphState.nodes.some((n) => n.id === selectedNodeId)) {
    setSelectedNode('');
  }

  $: selectedNode = graphState.nodes.find((n) => n.id === selectedNodeId);

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

    // We implement our own wheel/pinch zoom to avoid conflicts and ensure consistent behavior.
    // Disable the built-in zoom handler (wheel/dblclick/touch) from rete-area-plugin.
    areaPlugin?.area?.setZoomHandler?.(null);

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

    await syncGraph(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => syncGraph(state));

    // Fit view on first render
    if (areaPlugin) {
      AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
    }

    bindEditorPipes();

    const onWheel = (event: WheelEvent) => {
      // Always zoom the canvas on wheel/trackpad gestures (incl. pinch-as-wheel on macOS).
      event.preventDefault();
      event.stopImmediatePropagation();

      const area = areaPlugin?.area;
      if (!area) return;
      if (isNodeDragging) return;

      const current = Number(area.transform?.k ?? 1) || 1;
      const raw = -event.deltaY;
      const delta = Math.max(-0.3, Math.min(0.3, raw / 500));
      if (delta === 0) return;

      const minZoom = 0.2;
      const maxZoom = 2.5;
      const next = Math.max(minZoom, Math.min(maxZoom, current * (1 + delta)));
      const ratio = next / current - 1;

      const rectEl: HTMLElement | null = area?.content?.holder ?? container;
      const rect = rectEl?.getBoundingClientRect?.();
      if (!rect) return;

      const ox = (rect.left - event.clientX) * ratio;
      const oy = (rect.top - event.clientY) * ratio;
      area.zoom(next, ox, oy, 'wheel');
    };

    container.addEventListener('wheel', onWheel, { passive: false, capture: true });
    wheelHandler = onWheel;

    resizeObserver = new ResizeObserver(() => {
      const area = areaPlugin?.area;
      if (!area) return;
      isNodeDragging = false;
      // Re-apply current transform after layout changes (keeps drag math consistent after resizes).
      void area.zoom(Number(area.transform?.k ?? 1) || 1, 0, 0);
    });
    resizeObserver.observe(container);

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
    if (wheelHandler) container?.removeEventListener('wheel', wheelHandler, { capture: true } as any);
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
    resizeObserver?.disconnect();
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
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    min-width: 0;
    min-height: 0;
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

  .canvas-wrapper {
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      radial-gradient(circle at 30% 0%, rgba(99, 102, 241, 0.12), transparent 50%),
      radial-gradient(circle at 70% 10%, rgba(168, 85, 247, 0.1), transparent 55%),
      linear-gradient(180deg, rgba(10, 11, 20, 0.85) 0%, rgba(7, 8, 17, 0.95) 100%);
    background-size: 32px 32px, 32px 32px, auto, auto, auto;
    background-position: center, center, center, center, center;
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
