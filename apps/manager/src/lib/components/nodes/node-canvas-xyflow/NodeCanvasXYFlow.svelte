<!--
  Purpose: XYFlow-based node graph renderer that runs in parallel to the Rete-based NodeCanvas.
  Notes:
  - Kept behind feature flag (ng_renderer=xyflow) until UX parity is reached.
  - Reuses existing overlays/controllers via GraphViewAdapter.
-->
<script lang="ts">
  // @ts-nocheck
  import { onDestroy, onMount } from 'svelte';
  import { derived, get, writable } from 'svelte/store';
  import { SvelteFlow, type Node as FlowNode, type Edge as FlowEdge, type Viewport, type SvelteFlowProps } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import NodeCanvasLayout from '../node-canvas/ui/NodeCanvasLayout.svelte';
  import NodeCanvasToolbar from '../node-canvas/ui/NodeCanvasToolbar.svelte';
  import NodeCanvasMinimap from '../node-canvas/ui/NodeCanvasMinimap.svelte';
  import NodePickerOverlay from '../node-canvas/ui/NodePickerOverlay.svelte';
  import ExecutorLogsPanel from '../node-canvas/ui/panels/ExecutorLogsPanel.svelte';
  import GroupFramesOverlay from '../node-canvas/ui/overlays/GroupFramesOverlay.svelte';
  import LoopFramesOverlay from '../node-canvas/ui/overlays/LoopFramesOverlay.svelte';
  import MarqueeOverlay from '../node-canvas/ui/overlays/MarqueeOverlay.svelte';
  import PerformanceDebugOverlay from '../node-canvas/ui/PerformanceDebugOverlay.svelte';

  import XYFlowNode from './XYFlowNode.svelte';
  import XYFlowEdge from './XYFlowEdge.svelte';

  import { nodeGraphPerfOverlay } from '$lib/features/node-graph-flags';
  import { midiService } from '$lib/features/midi/midi-service';
  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import type { Connection as EngineConnection, GraphState, NodeInstance, NodePort, PortType } from '$lib/nodes/types';
  import type { LocalLoop } from '$lib/nodes';
  import { getSDK } from '$lib/stores/manager';

  import { createFileActions } from '../node-canvas/io/file-actions';
  import { createGroupController } from '../node-canvas/controllers/group-controller';
  import { createLoopController, type LoopController } from '../node-canvas/controllers/loop-controller';
  import { createMidiHighlightController } from '../node-canvas/controllers/midi-highlight-controller';
  import { createMinimapController } from '../node-canvas/controllers/minimap-controller';
  import { createPickerController, type SocketData } from '../node-canvas/controllers/picker-controller';
  import { createXYFlowAdapter, type GraphViewAdapter } from '../node-canvas/adapters';

  const nodeTypes = { default: XYFlowNode };
  const edgeTypes = { default: XYFlowEdge };

  let container: HTMLDivElement | null = null;
  let importGraphInputEl: HTMLInputElement | null = null;
  let importTemplatesInputEl: HTMLInputElement | null = null;
  let toolbarMenuWrap: HTMLDivElement | null = null;
  let isToolbarMenuOpen = false;

  let pickerElement: HTMLDivElement | null = null;
  let lastPointerClient = { x: 0, y: 0 };

  const nodes = writable<FlowNode[]>([]);
  const edges = writable<FlowEdge[]>([]);
  const viewport = writable<Viewport>({ x: 0, y: 0, zoom: 1 });

  const selectedNodeIdStore = derived(nodes, ($nodes) => String($nodes.find((n) => n.selected)?.id ?? ''));

  let graphState: GraphState = { nodes: [], connections: [] };
  let nodeCount = 0;

  const graphStateStore = nodeEngine.graphState;
  const isRunningStore = nodeEngine.isRunning;
  const lastErrorStore = nodeEngine.lastError;

  const isSyncingRef = { value: false };

  let updateScheduled = false;
  const requestUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateScheduled = false;
      nodes.update((n) => [...n]);
      edges.update((e) => [...e]);
    });
  };

  const viewAdapter: GraphViewAdapter = createXYFlowAdapter({
    getContainer: () => container,
    getNodes: () => get(nodes),
    getEdges: () => get(edges),
    setNodes: (n) => nodes.set(n),
    setEdges: (e) => edges.set(e),
    getViewport: () => get(viewport),
    setViewport: (vp) => viewport.set(vp),
    requestUpdate,
    onNodePositionChange: (nodeId, position) => nodeEngine.updateNodePosition(String(nodeId), position),
  });

  let loopController: LoopController | null = null;
  let minimapController: ReturnType<typeof createMinimapController> | null = null;
  let requestFramesUpdate = () => {};

  const groupController = createGroupController({
    getContainer: () => container,
    getAdapter: () => viewAdapter,
    getGraphState: () => graphState,
    getLocalLoops: () => (loopController ? get(loopController.localLoops) : []),
    getLoopConstraintLoops: () => (loopController ? loopController.getEffectiveLoops() : []),
    getDeployedLoopIds: () => (loopController ? get(loopController.deployedLoopIds) : new Set()),
    setNodesDisabled: (ids, disabled) => nodeEngine.setNodesDisabled(ids, disabled),
    requestLoopFramesUpdate: () => requestFramesUpdate(),
    requestMinimapUpdate: () => minimapController?.requestUpdate(),
    isSyncingGraph: () => isSyncingRef.value,
    stopLoop: (loop: LocalLoop) => loopController?.loopActions.stopLoop(loop),
  });

  minimapController = createMinimapController({
    getContainer: () => container,
    getAdapter: () => viewAdapter,
    getGraphState: () => graphState,
    getSelectedNodeId: () => get(selectedNodeIdStore),
    getLocalLoopConnIds: () => (loopController ? get(loopController.localLoopConnIds) : new Set()),
    getDeployedConnIds: () => (loopController ? get(loopController.deployedConnIds) : new Set()),
  });

  loopController = createLoopController({
    nodeEngine,
    getSDK,
    isRunning: () => get(isRunningStore),
    getGraphState: () => graphState,
    getAdapter: () => viewAdapter,
    getGroupDisabledNodeIds: () => get(groupController.groupDisabledNodeIds),
    isSyncingGraph: () => isSyncingRef.value,
    onDeployTimeout: (loopId) => alert(`Deploy timeout for loop ${loopId}`),
    onDeployError: (message) => alert(`Deploy failed: ${message}`),
    onDeployMissingClient: () => alert('Select a client in the Client node before deploying.'),
    onMissingSdk: () => alert('Manager SDK not connected.'),
    onLoopVanished: () => undefined,
    onLoopFrameReady: (loop) => {
      const effectiveLoop = loopController?.getEffectiveLoops().find((l) => l.id === loop.id) ?? loop;
      const bounds = groupController.computeLoopFrameBounds(effectiveLoop);
      if (!bounds) return;
      groupController.pushNodesOutOfBounds(bounds, new Set((effectiveLoop.nodeIds ?? []).map((id) => String(id))));
    },
  });

  const {
    loopFrames,
    deployedLoopIds,
    executorStatusByClient,
    showExecutorLogs,
    logsClientId,
    localLoopConnIds,
    deployedConnIds,
  } = loopController;

  const {
    groupFrames,
    editModeGroupId,
    canvasToast,
    groupEditToast,
    groupSelectionBounds,
    groupSelectionNodeIds,
    marqueeRect,
  } = groupController;

  const { minimap, minimapUi } = minimapController;

  const midiController = createMidiHighlightController({
    getGraphState: () => graphState,
    getGroupDisabledNodeIds: () => get(groupController.groupDisabledNodeIds),
    getAdapter: () => viewAdapter,
    isSyncingGraph: () => isSyncingRef.value,
  });

  requestFramesUpdate = () => {
    loopController?.requestFramesUpdate();
    groupController.requestFramesUpdate();
  };

  let canvasTransform = { k: 1, tx: 0, ty: 0 };
  $: canvasTransform = { k: $viewport.zoom ?? 1, tx: $viewport.x ?? 0, ty: $viewport.y ?? 0 };

  const resetGroups = () => {
    groupController.nodeGroups.set([]);
    groupController.groupFrames.set([]);
    groupController.groupDisabledNodeIds.set(new Set());
    groupController.editModeGroupId.set(null);
    groupController.groupEditToast.set(null);
    groupController.clearSelection();
    groupController.scheduleHighlight();
  };

  const handleClear = () => {
    if (confirm('Clear all nodes?')) {
      nodeEngine.clear();
      resetGroups();
    }
  };

  const handleToggleEngine = () => {
    if (get(isRunningStore)) {
      nodeEngine.stop();
      loopController?.loopActions.stopAllClientEffects();
      loopController?.loopActions.stopAllDeployedLoops();
    } else {
      nodeEngine.start();
    }
  };

  const closeToolbarMenu = () => {
    isToolbarMenuOpen = false;
  };

  const toggleToolbarMenu = () => {
    isToolbarMenuOpen = !isToolbarMenuOpen;
  };

  const handleToolbarMenuPick = (action: () => void) => {
    closeToolbarMenu();
    action();
  };

  const toggleExecutorLogs = () => {
    const show = get(showExecutorLogs);
    if (show) {
      showExecutorLogs.set(false);
      return;
    }

    const current = get(logsClientId);
    if (current) {
      showExecutorLogs.set(true);
      return;
    }

    const first = get(executorStatusByClient).keys().next().value as string | undefined;
    if (!first) return;
    logsClientId.set(String(first));
    showExecutorLogs.set(true);
  };

  const viewportCenterGraphPos = (): { x: number; y: number } => {
    if (!container) return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const rect = container.getBoundingClientRect();
    return viewAdapter.clientToGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const fileActions = createFileActions({
    nodeEngine,
    getImportGraphInput: () => importGraphInputEl,
    getImportTemplatesInput: () => importTemplatesInputEl,
    onResetGroups: resetGroups,
    getViewportCenterGraphPos: viewportCenterGraphPos,
  });

  const toMiniX = (x: number) => {
    const m = get(minimap);
    return m.offsetX + (x - m.bounds.minX) * m.scale;
  };

  const toMiniY = (y: number) => {
    const m = get(minimap);
    return m.offsetY + (y - m.bounds.minY) * m.scale;
  };

  const isCompatible = (sourceType: PortType, targetType: PortType) => {
    if (sourceType === 'audio' || targetType === 'audio') return sourceType === 'audio' && targetType === 'audio';
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
  };

  const getPortDefForSocket = (socket: SocketData): NodePort | null => {
    const instance = nodeEngine.getNode(socket.nodeId);
    if (!instance) return null;
    const def = nodeRegistry.get(instance.type);
    if (!def) return null;
    const list = socket.side === 'output' ? def.outputs : def.inputs;
    return list?.find((p) => String(p.id) === String(socket.key)) ?? null;
  };

  const bestMatchingPort = (ports: NodePort[], requiredType: PortType, side: 'input' | 'output'): NodePort | null => {
    let best: NodePort | null = null;
    let bestScore = -1;

    for (const port of ports) {
      const portType = (port.type ?? 'any') as PortType;
      const ok = side === 'input' ? isCompatible(requiredType, portType) : isCompatible(portType, requiredType);
      if (!ok) continue;

      const score = portType === requiredType ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        best = port;
      }
    }

    return best;
  };

  const generateNodeId = () => `node-${crypto.randomUUID?.() ?? Date.now()}`;

  const addNode = (type: string, position?: { x: number; y: number }) => {
    const def = nodeRegistry.get(type);
    if (!def) return undefined;

    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) {
      config[field.key] = field.defaultValue;
    }

    const fallback = { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const newNode: NodeInstance = {
      id: generateNodeId(),
      type,
      position: position ?? fallback,
      config,
      inputValues: {},
      outputValues: {},
    };

    nodeEngine.addNode(newNode);
    return newNode.id;
  };

  const pickerController = createPickerController({
    nodeRegistry,
    getContainer: () => container,
    computeGraphPosition: (clientX, clientY) => viewAdapter.clientToGraph(clientX, clientY),
    getLastPointerClient: () => lastPointerClient,
    getPortDefForSocket,
    bestMatchingPort,
    addNode: (type, position) => {
      const nodeId = addNode(type, position);
      if (!nodeId) return nodeId;

      const mode = get(pickerMode);
      const initial = get(pickerInitialSocket);

      if (mode === 'connect' && initial && position) {
        groupController.autoAddNodeToGroupFromConnectDrop(initial.nodeId, nodeId, position);
        loopController?.autoAddNodeToLoopFromConnectDrop(initial.nodeId, nodeId, position);
      }

      return nodeId;
    },
    addConnection: (conn) => void nodeEngine.addConnection(conn),
  });

  const {
    isOpen: isPickerOpen,
    mode: pickerMode,
    anchor: pickerAnchor,
    selectedCategory: pickerSelectedCategory,
    query: pickerQuery,
    initialSocket: pickerInitialSocket,
    items: pickerItems,
    categories: pickerCategories,
    setPickerElement,
    openPicker,
    openConnectPicker,
    closePicker,
    handlePick: handlePickerPick,
  } = pickerController;

  $: setPickerElement(pickerElement);

  const onEdgeCreate: NonNullable<SvelteFlowProps['onedgecreate']> = (connection) => {
    if (!connection?.source || !connection?.target) return;

    const id = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
    const sourcePortId = connection.sourceHandle ?? 'out';
    const targetPortId = connection.targetHandle ?? 'in';

    const targetInstance = nodeEngine.getNode(String(connection.target));
    const targetDef = targetInstance ? nodeRegistry.get(String(targetInstance.type)) : null;
    const targetPort = targetDef?.inputs?.find((p) => String(p.id) === String(targetPortId)) ?? null;
    const allowMulti = targetPort?.kind === 'sink';
    if (!allowMulti) {
      const snapshot = get(graphStateStore);
      for (const c of snapshot.connections ?? []) {
        if (String(c.targetNodeId) !== String(connection.target)) continue;
        if (String(c.targetPortId) !== String(targetPortId)) continue;
        nodeEngine.removeConnection(String(c.id));
      }
    }

    const conn: EngineConnection = {
      id,
      sourceNodeId: String(connection.source),
      sourcePortId: String(sourcePortId),
      targetNodeId: String(connection.target),
      targetPortId: String(targetPortId),
    };

    const ok = nodeEngine.addConnection(conn);
    if (!ok) return;

    return {
      id,
      source: conn.sourceNodeId,
      sourceHandle: conn.sourcePortId,
      target: conn.targetNodeId,
      targetHandle: conn.targetPortId,
      type: 'default',
      data: {},
    };
  };

  const onDelete: NonNullable<SvelteFlowProps['ondelete']> = ({ nodes: deletedNodes, edges: deletedEdges }) => {
    for (const e of deletedEdges ?? []) nodeEngine.removeConnection(String((e as any)?.id ?? ''));
    for (const n of deletedNodes ?? []) nodeEngine.removeNode(String((n as any)?.id ?? ''));
  };

  const onNodeDragStop = (event: CustomEvent<any>) => {
    const moved = (event.detail?.nodes ?? []) as { id: string; position?: { x: number; y: number } }[];
    const movedIds: string[] = [];
    for (const node of moved) {
      if (!node?.id || !node.position) continue;
      movedIds.push(String(node.id));
      nodeEngine.updateNodePosition(String(node.id), { x: node.position.x, y: node.position.y });
    }
    if (movedIds.length > 0) groupController.handleDroppedNodesAfterDrag(movedIds);
  };

  const convertToXYFlow = (state: GraphState): { nodes: FlowNode[]; edges: FlowEdge[] } => {
    const prevNodes = get(nodes);
    const prevEdges = get(edges);
    const prevNodeById = new Map(prevNodes.map((n) => [String(n.id), n]));
    const prevEdgeById = new Map(prevEdges.map((e) => [String(e.id), e]));

    const xyNodes: FlowNode[] = (state.nodes ?? []).map((n: NodeInstance) => {
      const prev = prevNodeById.get(String(n.id));
      return {
        id: String(n.id),
        type: 'default',
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
        selected: Boolean(prev?.selected),
        data: {
          ...(prev?.data ?? {}),
          type: n.type,
          label: nodeRegistry.get(n.type)?.label ?? n.type,
          config: n.config,
        },
      };
    });

    const xyEdges: FlowEdge[] = (state.connections ?? []).map((c: EngineConnection) => {
      const prev = prevEdgeById.get(String(c.id));
      return {
        id: String(c.id),
        source: String(c.sourceNodeId),
        sourceHandle: String(c.sourcePortId),
        target: String(c.targetNodeId),
        targetHandle: String(c.targetPortId),
        type: 'default',
        data: { ...(prev?.data ?? {}) },
      };
    });

    return { nodes: xyNodes, edges: xyEdges };
  };

  const syncFromEngine = (state: GraphState) => {
    if (isSyncingRef.value) return;
    isSyncingRef.value = true;

    graphState = state;
    nodeCount = state.nodes?.length ?? 0;

    const { nodes: xyNodes, edges: xyEdges } = convertToXYFlow(state);
    nodes.set(xyNodes);
    edges.set(xyEdges);

    isSyncingRef.value = false;

    minimapController?.requestUpdate();
    requestFramesUpdate();
    void loopController?.applyHighlights();
    void groupController.applyHighlights();
    void midiController.applyHighlights();
  };

  let graphUnsub: (() => void) | null = null;
  let contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  let pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  let pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  let toolbarMenuOutsideHandler: ((event: PointerEvent) => void) | null = null;

  let groupHeaderDragPointerId: number | null = null;
  let groupHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let groupHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;
  let loopHeaderDragPointerId: number | null = null;
  let loopHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let loopHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;

  const startGroupHeaderDrag = (groupId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.group-frame-actions')) return;
    if (target?.closest?.('input')) return;

    const group = get(groupController.nodeGroups).find((g) => String(g.id) === String(groupId));
    if (!group?.nodeIds?.length) return;

    const nodeIds = (group.nodeIds ?? []).map((id) => String(id));
    if (nodeIds.length === 0) return;

    if (groupHeaderDragMoveHandler)
      window.removeEventListener('pointermove', groupHeaderDragMoveHandler, { capture: true } as any);
    if (groupHeaderDragUpHandler) {
      window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', groupHeaderDragUpHandler, { capture: true } as any);
    }

    groupHeaderDragPointerId = event.pointerId;
    let last = { x: event.clientX, y: event.clientY };
    let didMove = false;
    groupController.beginProgrammaticTranslate();

    const onMove = (ev: PointerEvent) => {
      if (groupHeaderDragPointerId !== null && ev.pointerId !== groupHeaderDragPointerId) return;
      const t = viewAdapter.getViewportTransform();
      const dx = (ev.clientX - last.x) / t.k;
      const dy = (ev.clientY - last.y) / t.k;
      if (!dx && !dy) return;
      last = { x: ev.clientX, y: ev.clientY };
      didMove = true;
      viewAdapter.translateNodes(nodeIds, dx, dy);
    };

    const onUp = (ev: PointerEvent) => {
      if (groupHeaderDragPointerId !== null && ev.pointerId !== groupHeaderDragPointerId) return;
      groupHeaderDragPointerId = null;
      groupController.endProgrammaticTranslate();

      if (groupHeaderDragMoveHandler)
        window.removeEventListener('pointermove', groupHeaderDragMoveHandler, { capture: true } as any);
      if (groupHeaderDragUpHandler) {
        window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
        window.removeEventListener('pointercancel', groupHeaderDragUpHandler, { capture: true } as any);
      }
      groupHeaderDragMoveHandler = null;
      groupHeaderDragUpHandler = null;

      if (!didMove) return;
      groupController.handleDroppedNodesAfterDrag(nodeIds);
    };

    groupHeaderDragMoveHandler = onMove;
    groupHeaderDragUpHandler = onUp;
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

  const startLoopHeaderDrag = (loopId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.loop-frame-actions')) return;
    if (target?.closest?.('input')) return;

    const effectiveLoops = loopController?.getEffectiveLoops?.() ?? (loopController ? get(loopController.localLoops) : []);
    const loop = (effectiveLoops ?? []).find((l: any) => String(l?.id ?? '') === String(loopId));
    if (!loop?.nodeIds?.length) return;

    const nodeIds = (loop.nodeIds ?? []).map((id: string) => String(id));
    if (nodeIds.length === 0) return;

    if (loopHeaderDragMoveHandler)
      window.removeEventListener('pointermove', loopHeaderDragMoveHandler, { capture: true } as any);
    if (loopHeaderDragUpHandler) {
      window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', loopHeaderDragUpHandler, { capture: true } as any);
    }

    loopHeaderDragPointerId = event.pointerId;
    let last = { x: event.clientX, y: event.clientY };
    let didMove = false;
    groupController.beginProgrammaticTranslate();

    const onMove = (ev: PointerEvent) => {
      if (loopHeaderDragPointerId !== null && ev.pointerId !== loopHeaderDragPointerId) return;
      const t = viewAdapter.getViewportTransform();
      const dx = (ev.clientX - last.x) / t.k;
      const dy = (ev.clientY - last.y) / t.k;
      if (!dx && !dy) return;
      last = { x: ev.clientX, y: ev.clientY };
      didMove = true;
      viewAdapter.translateNodes(nodeIds, dx, dy);
    };

    const onUp = (ev: PointerEvent) => {
      if (loopHeaderDragPointerId !== null && ev.pointerId !== loopHeaderDragPointerId) return;
      loopHeaderDragPointerId = null;
      groupController.endProgrammaticTranslate();

      if (loopHeaderDragMoveHandler)
        window.removeEventListener('pointermove', loopHeaderDragMoveHandler, { capture: true } as any);
      if (loopHeaderDragUpHandler) {
        window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
        window.removeEventListener('pointercancel', loopHeaderDragUpHandler, { capture: true } as any);
      }
      loopHeaderDragMoveHandler = null;
      loopHeaderDragUpHandler = null;

      if (!didMove) return;
      groupController.handleDroppedNodesAfterDrag(nodeIds);
    };

    loopHeaderDragMoveHandler = onMove;
    loopHeaderDragUpHandler = onUp;
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

  let connectInitial: SocketData | null = null;
  let connectDidCreate = false;

  const onConnectStart: NonNullable<SvelteFlowProps['onconnectstart']> = (_event, params) => {
    connectDidCreate = false;
    const nodeId = (params as any)?.nodeId;
    const handleId = (params as any)?.handleId;
    const handleType = (params as any)?.handleType;
    if (!nodeId || !handleId || (handleType !== 'source' && handleType !== 'target')) {
      connectInitial = null;
      return;
    }
    connectInitial = {
      nodeId: String(nodeId),
      side: handleType === 'source' ? 'output' : 'input',
      key: String(handleId),
    };
  };

  const onConnectEnd: NonNullable<SvelteFlowProps['onconnectend']> = (_event) => {
    if (connectDidCreate) {
      connectInitial = null;
      return;
    }
    if (!connectInitial) return;
    openConnectPicker(connectInitial);
    connectInitial = null;
  };

  const onEdgeCreateWithPicker: NonNullable<SvelteFlowProps['onedgecreate']> = (connection) => {
    connectDidCreate = true;
    return onEdgeCreate(connection);
  };

  let overlaysRaf = 0;
  const scheduleOverlaysUpdate = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (overlaysRaf) return;
    overlaysRaf = requestAnimationFrame(() => {
      overlaysRaf = 0;
      minimapController?.requestUpdate();
      requestFramesUpdate();
    });
  };

  $: {
    const _vp = $viewport;
    void _vp;
    scheduleOverlaysUpdate();
  }

  $: {
    const _nodes = $nodes;
    void _nodes;
    scheduleOverlaysUpdate();
  }

  onMount(() => {
    if (!container) return;

    midiController.start();

    // Initial sync
    syncFromEngine(get(graphStateStore));

    graphUnsub = graphStateStore.subscribe((state) => {
      if ((state.nodes ?? []).some((n) => String((n as any).type).startsWith('midi-'))) {
        void midiService.init();
      }
      syncFromEngine(state);
    });

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.node-picker')) return;
      if (target?.closest?.('.minimap')) return;
      const tag = target?.tagName?.toLowerCase?.() ?? '';
      const isEditing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean((target as any)?.isContentEditable);
      if (isEditing) return;

      event.preventDefault();
      event.stopPropagation();
      openPicker({ clientX: event.clientX, clientY: event.clientY, mode: 'add' });
    };
    container.addEventListener('contextmenu', onContextMenu, { capture: true });
    contextMenuHandler = onContextMenu;

    const onPointerDown = (event: PointerEvent) => {
      groupController.onPointerDown(event);
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    pointerDownHandler = onPointerDown;

    const onPointerMove = (event: PointerEvent) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
    };
    container.addEventListener('pointermove', onPointerMove, { capture: true });
    pointerMoveHandler = onPointerMove;
  });

  $: {
    if (isToolbarMenuOpen && toolbarMenuWrap && !toolbarMenuOutsideHandler) {
      const wrap = toolbarMenuWrap;
      const onOutside = (event: PointerEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (wrap?.contains?.(target)) return;
        closeToolbarMenu();
      };

      toolbarMenuOutsideHandler = onOutside;
      window.addEventListener('pointerdown', onOutside, { capture: true } as any);
    }
  }

  $: {
    if (!isToolbarMenuOpen && toolbarMenuOutsideHandler) {
      window.removeEventListener('pointerdown', toolbarMenuOutsideHandler, { capture: true } as any);
      toolbarMenuOutsideHandler = null;
    }
  }

  onDestroy(() => {
    midiController.stop();
    graphUnsub?.();
    graphUnsub = null;

    if (contextMenuHandler && container) {
      container.removeEventListener('contextmenu', contextMenuHandler, { capture: true } as any);
    }
    if (pointerDownHandler && container) {
      container.removeEventListener('pointerdown', pointerDownHandler, { capture: true } as any);
    }
    if (pointerMoveHandler && container) {
      container.removeEventListener('pointermove', pointerMoveHandler, { capture: true } as any);
    }
    contextMenuHandler = null;
    pointerDownHandler = null;
    pointerMoveHandler = null;

    if (toolbarMenuOutsideHandler) {
      window.removeEventListener('pointerdown', toolbarMenuOutsideHandler, { capture: true } as any);
      toolbarMenuOutsideHandler = null;
    }

    if (groupHeaderDragMoveHandler)
      window.removeEventListener('pointermove', groupHeaderDragMoveHandler, { capture: true } as any);
    if (groupHeaderDragUpHandler) {
      window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', groupHeaderDragUpHandler, { capture: true } as any);
    }
    groupHeaderDragPointerId = null;
    groupHeaderDragMoveHandler = null;
    groupHeaderDragUpHandler = null;

    if (loopHeaderDragMoveHandler)
      window.removeEventListener('pointermove', loopHeaderDragMoveHandler, { capture: true } as any);
    if (loopHeaderDragUpHandler) {
      window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', loopHeaderDragUpHandler, { capture: true } as any);
    }
    loopHeaderDragPointerId = null;
    loopHeaderDragMoveHandler = null;
    loopHeaderDragUpHandler = null;

    if (overlaysRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(overlaysRaf);
    overlaysRaf = 0;

    minimapController?.destroy();
    loopController?.destroy();
    groupController.destroy();
  });
</script>

<NodeCanvasLayout
  bind:container
  isRunning={$isRunningStore}
  gridScale={canvasTransform.k}
  gridOffset={{ x: canvasTransform.tx, y: canvasTransform.ty }}
>
  <svelte:fragment slot="toolbar">
    <input
      bind:this={importGraphInputEl}
      type="file"
      accept="application/json"
      on:change={fileActions.handleImportGraphChange}
      style="display: none;"
    />
    <input
      bind:this={importTemplatesInputEl}
      type="file"
      accept="application/json"
      on:change={fileActions.handleImportTemplatesChange}
      style="display: none;"
    />
    <NodeCanvasToolbar
      bind:toolbarMenuWrap
      isRunning={$isRunningStore}
      {nodeCount}
      lastError={$lastErrorStore}
      isMenuOpen={isToolbarMenuOpen}
      onToggleEngine={handleToggleEngine}
      onToggleExecutorLogs={toggleExecutorLogs}
      onClear={handleClear}
      onToggleMenu={toggleToolbarMenu}
      onMenuPick={handleToolbarMenuPick}
      onImportGraph={fileActions.importGraph}
      onExportGraph={fileActions.exportGraph}
      onImportTemplates={fileActions.importTemplates}
      onExportTemplates={fileActions.exportTemplates}
    />
  </svelte:fragment>

  <svelte:fragment slot="logs">
    {#if $showExecutorLogs && $logsClientId}
      {@const logsStatus = $executorStatusByClient.get($logsClientId)}
      <ExecutorLogsPanel clientId={$logsClientId} status={logsStatus} onClose={() => showExecutorLogs.set(false)} />
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="canvas">
    <div class="xyflow-layer">
      <SvelteFlow
        {nodes}
        {edges}
        {nodeTypes}
        {edgeTypes}
        viewport={viewport}
        onedgecreate={onEdgeCreateWithPicker}
        ondelete={onDelete}
        onconnectstart={onConnectStart}
        onconnectend={onConnectEnd}
        on:nodedragstop={onNodeDragStop}
        fitView
        minZoom={0.2}
        maxZoom={2.5}
        onlyRenderVisibleElements
        selectionKey={null}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  </svelte:fragment>

  <svelte:fragment slot="overlays">
    {#if $nodeGraphPerfOverlay}
      <PerformanceDebugOverlay
        visible={true}
        {nodeCount}
        connectionCount={graphState.connections?.length ?? 0}
        rendererType="xyflow"
        shadowsEnabled={false}
      />
    {/if}

    {#if $canvasToast}
      <div class="canvas-toast" aria-live="polite">{$canvasToast}</div>
    {/if}

    <NodePickerOverlay
      isOpen={$isPickerOpen}
      mode={$pickerMode}
      initialSocket={$pickerInitialSocket}
      connectTypeLabel={$pickerInitialSocket ? (getPortDefForSocket($pickerInitialSocket)?.type ?? 'any') : 'any'}
      anchor={$pickerAnchor}
      bind:query={$pickerQuery}
      categories={$pickerCategories}
      bind:selectedCategory={$pickerSelectedCategory}
      items={$pickerItems}
      onClose={closePicker}
      onPick={handlePickerPick}
      bind:pickerElement
    />

    <GroupFramesOverlay
      frames={$groupFrames}
      areaTransform={canvasTransform}
      editModeGroupId={$editModeGroupId}
      toast={$groupEditToast}
      onToggleDisabled={groupController.toggleGroupDisabled}
      onToggleEditMode={groupController.toggleGroupEditMode}
      onDisassemble={groupController.disassembleGroup}
      onRename={groupController.renameGroup}
      onHeaderPointerDown={startGroupHeaderDrag}
    />

    <LoopFramesOverlay
      frames={$loopFrames}
      areaTransform={canvasTransform}
      deployedLoopIds={$deployedLoopIds}
      getLoopClientId={loopController.loopActions.getLoopClientId}
      executorStatusByClient={$executorStatusByClient}
      showExecutorLogs={$showExecutorLogs}
      logsClientId={$logsClientId}
      isRunning={$isRunningStore}
      onToggleLogs={loopController.toggleLoopLogs}
      onStop={loopController.loopActions.stopLoop}
      onDeploy={loopController.loopActions.deployLoop}
      isLoopDeploying={loopController.isLoopDeploying}
      loopHasDisabledNodes={loopController.loopHasDisabledNodes}
      onHeaderPointerDown={startLoopHeaderDrag}
    />

    <MarqueeOverlay
      marqueeRect={$marqueeRect}
      selectionBounds={$groupSelectionBounds}
      selectionCount={$groupSelectionNodeIds.size}
      onCreateGroup={groupController.createGroupFromSelection}
    />
  </svelte:fragment>

  <svelte:fragment slot="minimap">
    <NodeCanvasMinimap
      minimapUi={$minimapUi}
      minimap={$minimap}
      zoomStep={30}
      {toMiniX}
      {toMiniY}
      onZoom={minimapController.zoom}
      onMovePointerDown={minimapController.handleMovePointerDown}
      onMovePointerMove={minimapController.handleMovePointerMove}
      onMovePointerUp={minimapController.handleMovePointerUp}
      onPointerDown={minimapController.handlePointerDown}
      onPointerMove={minimapController.handlePointerMove}
      onPointerUp={minimapController.handlePointerUp}
    />
  </svelte:fragment>
</NodeCanvasLayout>

<style>
  .xyflow-layer {
    position: absolute;
    inset: 0;
  }

  :global(.xyflow-layer .svelte-flow) {
    background: transparent;
  }

  :global(.xyflow-layer .svelte-flow__background) {
    background: transparent;
  }

  :global(.xyflow-layer .svelte-flow__attribution) {
    display: none;
  }

  .canvas-toast {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    background: rgba(2, 6, 23, 0.66);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow:
      0 10px 28px rgba(0, 0, 0, 0.38),
      0 0 0 1px rgba(59, 130, 246, 0.12);
    backdrop-filter: blur(14px);
    pointer-events: none;
    max-width: min(520px, calc(100% - 48px));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
