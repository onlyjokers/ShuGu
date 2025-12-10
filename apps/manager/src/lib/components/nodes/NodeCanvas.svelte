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
  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import type { NodeInstance, Connection as EngineConnection } from '$lib/nodes/types';

  // Rete core handles the view; nodeEngine remains the source of truth for execution

  let container: HTMLDivElement | null = null;
  let editor: NodeEditor<any> | null = null;
  let areaPlugin: any = null;
  let graphUnsub: (() => void) | null = null;

  // Shared sockets mapped to our port types
  const sockets = {
    number: new ClassicPreset.Socket('number'),
    boolean: new ClassicPreset.Socket('boolean'),
    string: new ClassicPreset.Socket('string'),
    any: new ClassicPreset.Socket('any'),
  } as const;

  const nodeMap = new Map<string, any>();
  const connectionMap = new Map<string, any>();

  let selectedType = '';
  let nodeCount = 0;

  // Store handles
  let graphStateStore = nodeEngine?.graphState;
  let isRunningStore = nodeEngine?.isRunning;
  let lastErrorStore = nodeEngine?.lastError;

  const nodeCategories = nodeRegistry.listByCategory();

  function socketFor(type: string | undefined) {
    if (type && type in sockets) return sockets[type as keyof typeof sockets];
    return sockets.any;
  }

  function generateId(): string {
    return `node-${crypto.randomUUID?.() ?? Date.now()}`;
  }

  function buildReteNode(instance: NodeInstance): any {
    const def = nodeRegistry.get(instance.type);
    const node: any = new ClassicPreset.Node(def?.label ?? instance.type);

    for (const input of def?.inputs ?? []) {
      node.addInput(
        input.id,
        new ClassicPreset.Input(socketFor(input.type), input.label ?? input.id, false)
      );
    }

    for (const output of def?.outputs ?? []) {
      node.addOutput(
        output.id,
        new ClassicPreset.Output(socketFor(output.type), output.label ?? output.id)
      );
    }

    node.position = [instance.position.x, instance.position.y];
    return node;
  }

  async function syncGraph(state: { nodes: NodeInstance[]; connections: EngineConnection[] }) {
    if (!editor || !areaPlugin) return;

    nodeCount = state.nodes.length;

    // Add / update nodes
    for (const n of state.nodes) {
      let reteNode = nodeMap.get(n.id);
      if (!reteNode) {
        reteNode = buildReteNode(n);
        await editor.addNode(reteNode);
        nodeMap.set(n.id, reteNode);
      }
      reteNode.position = [n.position.x, n.position.y];
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
        nodeEngine.addConnection(engineConn);
      }

      // Connection removed via UI
      if (ctx.type === 'connectionremoved') {
        nodeEngine.removeConnection((ctx.data as any).id);
      }

      // Node removed via UI
      if (ctx.type === 'noderemoved') {
        nodeEngine.removeNode((ctx.data as any).id);
      }

      return ctx;
    });

    // Track node drag to persist positions
    if (areaPlugin) {
      areaPlugin.addPipe((ctx: any) => {
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
      position: { x: 100, y: 100 },
      config,
      inputValues: {},
      outputValues: {},
    };
    nodeEngine.addNode(newNode);
  }

  function handleAddNode() {
    if (selectedType) {
      addNode(selectedType);
    }
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

  onMount(async () => {
    if (!container) return;

    editor = new NodeEditor('fluffy-rete');
    // @ts-expect-error runtime constructor expects container element
    areaPlugin = new AreaPlugin(container);
    const connection: any = new ConnectionPlugin();
    const render: any = new SveltePlugin();
    const history = new HistoryPlugin();

    editor.use(areaPlugin);
    editor.use(connection);
    editor.use(render);
    editor.use(history);

    // Types in presets are strict to ClassicScheme; runtime is fine for our usage
    // @ts-expect-error loose preset application
    connection.addPreset(ConnectionPresets.classic.setup());
    // @ts-expect-error preset type mismatch
    render.addPreset(SveltePresets.classic.setup());

    await syncGraph(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => syncGraph(state));

    // Fit view on first render
    if (areaPlugin) {
      AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
    }

    bindEditorPipes();
  });

  onDestroy(() => {
    graphUnsub?.();
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
    <select bind:value={selectedType}>
      <option value="">Add node...</option>
      {#each [...nodeCategories] as [category, defs]}
        <optgroup label={category}>
          {#each defs as def}
            <option value={def.type}>{def.label}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    <Button variant="secondary" size="sm" on:click={handleAddNode} disabled={!selectedType}>Add</Button>
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
    height: 600px;
    background: var(--bg-primary, #1a1a1a);
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

  .canvas-actions select {
    background: var(--bg-secondary, #252525);
    color: var(--text-primary, #fff);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-sm, 6px);
    padding: 6px 10px;
  }

  .canvas-wrapper {
    flex: 1;
  }
</style>
