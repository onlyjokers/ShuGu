<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    SvelteFlow,
    Controls,
    Background,
    MiniMap,
    type Node,
    type Edge,
    type Connection as FlowConnection,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import type { NodeInstance, Connection } from '$lib/nodes/types';
  import { parameterRegistry } from '$lib/parameters/registry';
  import Button from '$lib/components/ui/Button.svelte';

  // Convert our node format to Svelte Flow format
  const nodesStore = writable<Node[]>([]);
  const edgesStore = writable<Edge[]>([]);

  // Node ID counter
  let nodeIdCounter = 0;

  // For adding nodes
  let showNodeMenu = false;
  let menuPosition = { x: 0, y: 0 };

  // Subscribe to engine state safely
  let graphStateStore = nodeEngine?.graphState;
  let isRunningStore = nodeEngine?.isRunning;
  let lastErrorStore = nodeEngine?.lastError;

  // Local state for nodes/edges
  $: if (graphStateStore) {
    const state = $graphStateStore;
    nodesStore.set(state.nodes.map(convertToFlowNode));
    edgesStore.set(state.connections.map(convertToFlowEdge));
  }

  function convertToFlowNode(node: NodeInstance): Node {
    const definition = nodeRegistry.get(node.type);
    return {
      id: node.id,
      type: 'default', // We'll use custom nodes later
      position: node.position,
      data: {
        label: definition?.label ?? node.type,
        config: node.config,
        nodeType: node.type,
        inputs: definition?.inputs ?? [],
        outputs: definition?.outputs ?? [],
      },
    };
  }

  function convertToFlowEdge(conn: Connection): Edge {
    return {
      id: conn.id,
      source: conn.sourceNodeId,
      sourceHandle: conn.sourcePortId,
      target: conn.targetNodeId,
      targetHandle: conn.targetPortId,
    };
  }

  function generateId(): string {
    return `node-${++nodeIdCounter}-${Date.now()}`;
  }

  function handleAddNode(type: string) {
    const definition = nodeRegistry.get(type);
    if (!definition) return;

    const config: Record<string, unknown> = {};
    for (const field of definition.configSchema) {
      config[field.key] = field.defaultValue;
    }

    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position: { x: menuPosition.x, y: menuPosition.y },
      config,
      inputValues: {},
      outputValues: {},
    };

    nodeEngine.addNode(newNode);
    showNodeMenu = false;
  }

  function handleConnect(event: CustomEvent<FlowConnection>) {
    const conn = event.detail;
    if (!conn.source || !conn.target) return;

    const connection: Connection = {
      id: `edge-${Date.now()}`,
      sourceNodeId: conn.source,
      sourcePortId: conn.sourceHandle ?? 'value',
      targetNodeId: conn.target,
      targetPortId: conn.targetHandle ?? 'value',
    };

    const success = nodeEngine.addConnection(connection);
    if (!success) {
      console.warn('Connection rejected (possibly cycle detected)');
    }
  }

  // Svelte Flow v2 callback-style handlers
  function handleConnectCallback(conn: FlowConnection) {
    if (!conn.source || !conn.target) return;

    const connection: Connection = {
      id: `edge-${Date.now()}`,
      sourceNodeId: conn.source,
      sourcePortId: conn.sourceHandle ?? 'value',
      targetNodeId: conn.target,
      targetPortId: conn.targetHandle ?? 'value',
    };

    const success = nodeEngine.addConnection(connection);
    if (!success) {
      console.warn('Connection rejected (possibly cycle detected)');
    }
  }

  function handleDeleteCallback({
    nodes: deletedNodes,
    edges: deletedEdges,
  }: {
    nodes: Node[];
    edges: Edge[];
  }) {
    for (const edge of deletedEdges) {
      nodeEngine.removeConnection(edge.id);
    }
    for (const node of deletedNodes) {
      nodeEngine.removeNode(node.id);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleNodeDragStopCallback(...args: any[]) {
    const node = args[1] as Node;
    if (node?.id) {
      nodeEngine.updateNodePosition(node.id, node.position);
    }
  }

  function handlePaneClickCallback() {
    showNodeMenu = false;
  }

  function handleEdgesDelete(event: CustomEvent<Edge[]>) {
    for (const edge of event.detail) {
      nodeEngine.removeConnection(edge.id);
    }
  }

  function handleNodesDelete(event: CustomEvent<Node[]>) {
    for (const node of event.detail) {
      nodeEngine.removeNode(node.id);
    }
  }

  function handleNodeDragStop(event: CustomEvent<{ node: Node }>) {
    const { node } = event.detail;
    nodeEngine.updateNodePosition(node.id, node.position);
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    menuPosition = { x: event.clientX - 250, y: event.clientY - 100 };
    showNodeMenu = true;
  }

  function handlePaneClick() {
    showNodeMenu = false;
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

  // Get available node types grouped by category
  $: nodeCategories = nodeRegistry.listByCategory();

  // Get available parameters for dropdown
  $: availableParams = parameterRegistry.list().map((p) => ({
    path: p.path,
    label: p.metadata?.label || p.path,
  }));

  let nodesRegistered = false;

  onMount(async () => {
    // Import nodes to trigger registration
    await import('$lib/nodes/nodes');
    nodesRegistered = true;
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
      <span class="node-count">{$nodesStore.length} nodes</span>
    </div>
    <div class="toolbar-right">
      {#if $lastErrorStore}
        <span class="error-message">⚠️ {$lastErrorStore}</span>
      {/if}
    </div>
  </div>

  <div class="canvas-wrapper" on:contextmenu={handleContextMenu}>
    <SvelteFlow
      nodes={nodesStore}
      edges={edgesStore}
      fitView
      on:connect={handleConnect}
      on:edgesdelete={handleEdgesDelete}
      on:nodesdelete={handleNodesDelete}
      on:nodedragstop={handleNodeDragStop}
      on:paneclick={handlePaneClick}
    >
      <Controls />
      <Background />
      <MiniMap />
    </SvelteFlow>
  </div>

  <!-- Add Node Menu -->
  {#if showNodeMenu}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="node-menu" style="left: {menuPosition.x}px; top: {menuPosition.y}px;">
      <div class="menu-header">Add Node</div>
      {#each [...nodeCategories] as [category, nodeDefs]}
        <div class="menu-category">{category}</div>
        {#each nodeDefs as def}
          <button class="menu-item" on:click={() => handleAddNode(def.type)}>
            {def.label}
          </button>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .node-canvas-container {
    display: flex;
    flex-direction: column;
    height: 600px;
    background: var(--bg-primary, #1a1a1a);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
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

  .canvas-wrapper {
    flex: 1;
    position: relative;
  }

  .node-menu {
    position: fixed;
    z-index: 1000;
    min-width: 180px;
    background: var(--bg-secondary, #252525);
    border: 1px solid var(--border-color, #444);
    border-radius: var(--radius-md, 8px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .menu-header {
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    font-weight: 600;
    color: var(--text-primary, #fff);
    background: var(--bg-tertiary, #2a2a2a);
    border-bottom: 1px solid var(--border-color, #444);
  }

  .menu-category {
    padding: var(--space-xs, 4px) var(--space-md, 16px);
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-secondary, #aaa);
    background: var(--bg-primary, #1a1a1a);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: var(--space-xs, 4px) var(--space-md, 16px);
    text-align: left;
    background: none;
    border: none;
    color: var(--text-primary, #fff);
    cursor: pointer;
    font-size: var(--text-sm, 0.875rem);
  }

  .menu-item:hover {
    background: var(--color-primary, #6366f1);
  }

  /* Svelte Flow overrides for dark theme */
  :global(.svelte-flow) {
    background: var(--bg-primary, #1a1a1a) !important;
  }

  :global(.svelte-flow__node) {
    background: var(--bg-secondary, #252525) !important;
    border: 1px solid var(--border-color, #444) !important;
    border-radius: 6px !important;
    color: var(--text-primary, #fff) !important;
  }

  :global(.svelte-flow__node.selected) {
    border-color: var(--color-primary, #6366f1) !important;
  }

  :global(.svelte-flow__edge path) {
    stroke: var(--color-primary, #6366f1) !important;
  }
</style>
