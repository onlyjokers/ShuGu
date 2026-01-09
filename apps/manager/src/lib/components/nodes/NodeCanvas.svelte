<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { ClassicPreset, NodeEditor } from 'rete';
  import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
  import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
  import { HistoryPlugin } from 'rete-history-plugin';
  import { SveltePlugin, Presets as SveltePresets } from 'rete-svelte-plugin';

  import NodeCanvasLayout from './node-canvas/ui/NodeCanvasLayout.svelte';
  import ReteNode from './node-canvas/rete/ReteNode.svelte';
  import ReteControl from './node-canvas/rete/ReteControl.svelte';
  import ReteConnection from './node-canvas/rete/ReteConnection.svelte';
  import ExecutorLogsPanel from './node-canvas/ui/panels/ExecutorLogsPanel.svelte';
  import GroupFramesOverlay from './node-canvas/ui/overlays/GroupFramesOverlay.svelte';
  import LoopFramesOverlay from './node-canvas/ui/overlays/LoopFramesOverlay.svelte';
  import MarqueeOverlay from './node-canvas/ui/overlays/MarqueeOverlay.svelte';
  import NodeCanvasMinimap from './node-canvas/ui/NodeCanvasMinimap.svelte';
  import NodeCanvasToolbar from './node-canvas/ui/NodeCanvasToolbar.svelte';
  import NodePickerOverlay from './node-canvas/ui/NodePickerOverlay.svelte';
  import PerformanceDebugConsole from './node-canvas/ui/PerformanceDebugConsole.svelte';
  import { nodeGraphPerfConsole, nodeGraphEdgeShadows } from '$lib/features/node-graph-flags';

  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import { parameterRegistry } from '$lib/parameters/registry';
  import { getSDK, sensorData, state as managerState } from '$lib/stores/manager';
  import {
    displayBridgeState,
    ensureDisplayLocalFilesRegisteredFromValue,
    sendPlugin as sendLocalDisplayPlugin,
  } from '$lib/display/display-bridge';
  import type { NodeInstance, Connection as EngineConnection, GraphState } from '$lib/nodes/types';
  import type { LocalLoop } from '$lib/nodes';
  import { midiService } from '$lib/features/midi/midi-service';
  import { createFileActions } from './node-canvas/io/file-actions';
  import { LiveDOMSocketPosition } from './node-canvas/rete/live-socket-position';
  import { createReteAdapter, type GraphViewAdapter } from './node-canvas/adapters';
  import { createMinimapController } from './node-canvas/controllers/minimap-controller';
  import { createGroupController } from './node-canvas/controllers/group-controller';
  import { createFocusController } from './node-canvas/controllers/focus-controller';
  import { createGroupPortNodesController } from './node-canvas/controllers/group-port-nodes-controller';
  import { createClipboardController } from './node-canvas/controllers/clipboard-controller';
  import { createFrameDragController } from './node-canvas/controllers/frame-drag-controller';
  import {
    createLoopController,
    type LoopController,
  } from './node-canvas/controllers/loop-controller';
  import { createMidiHighlightController } from './node-canvas/controllers/midi-highlight-controller';
  import {
    createPickerController,
    type SocketData,
  } from './node-canvas/controllers/picker-controller';
  import { createReteBuilder } from './node-canvas/rete/rete-builder';
  import { createGraphSync, type GraphSyncController } from './node-canvas/rete/rete-sync';
  import { bindRetePipes } from './node-canvas/rete/rete-pipes';
  import { normalizeAreaTransform, readAreaTransform } from './node-canvas/utils/view-utils';
  import { createPatchRuntime } from './node-canvas/runtime/patch-runtime';
  import { createClientSelectionBinding } from './node-canvas/runtime/client-selection-binding';
  import { createSleepNodeSocketSync } from './node-canvas/runtime/sleep-node-sockets';

  let container: HTMLDivElement | null = null;
  let editor: NodeEditor<any> | null = null;
  let areaPlugin: any = null;
  let connectionPlugin: any = null;
  let graphUnsub: (() => void) | null = null;
  let paramsUnsub: (() => void) | null = null;
  let tickUnsub: (() => void) | null = null;
  let runningUnsub: (() => void) | null = null;
  let groupDisabledUnsub: (() => void) | null = null;
  let groupNodesUnsub: (() => void) | null = null;
  let groupFramesUnsub: (() => void) | null = null;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let wheelHandler: ((event: WheelEvent) => void) | null = null;
  let contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  let pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  let pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  let dblclickHandler: ((event: MouseEvent) => void) | null = null;
  let toolbarMenuOutsideHandler: ((event: PointerEvent) => void) | null = null;
  let altDuplicateDragPointerId: number | null = null;
  let altDuplicateDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let altDuplicateDragUpHandler: ((event: PointerEvent) => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let socketPositionWatcher: LiveDOMSocketPosition | null = null;
  let managerUnsub: (() => void) | null = null;
  let displayBridgeUnsub: (() => void) | null = null;
  let loopDeployUnsub: (() => void) | null = null;

  const sockets = {
    number: new ClassicPreset.Socket('number'),
    boolean: new ClassicPreset.Socket('boolean'),
    string: new ClassicPreset.Socket('string'),
    color: new ClassicPreset.Socket('color'),
    audio: new ClassicPreset.Socket('audio'),
    image: new ClassicPreset.Socket('image'),
    video: new ClassicPreset.Socket('video'),
    scene: new ClassicPreset.Socket('scene'),
    effect: new ClassicPreset.Socket('effect'),
    client: new ClassicPreset.Socket('client'),
    command: new ClassicPreset.Socket('command'),
    fuzzy: new ClassicPreset.Socket('fuzzy'),
    array: new ClassicPreset.Socket('array'),
    any: new ClassicPreset.Socket('any'),
  } as const;

  const nodeMap = new Map<string, any>();
  const connectionMap = new Map<string, any>();
  const isSyncingRef = { value: false };

  let graphState: GraphState = { nodes: [], connections: [] };
  let nodeCount = 0;
  let lastGraphNodeCount = -1;
  let selectedNodeId = '';
  let importGraphInputEl: HTMLInputElement | null = null;
  let importTemplatesInputEl: HTMLInputElement | null = null;
  let isToolbarMenuOpen = false;
  let toolbarMenuWrap: HTMLDivElement | null = null;
  let numberParamOptions: { path: string; label: string }[] = [];
  let pickerElement: HTMLDivElement | null = null;
  let lastPointerClient = { x: 0, y: 0 };

  const graphStateStore = nodeEngine?.graphState;
  const isRunningStore = nodeEngine?.isRunning;
  const lastErrorStore = nodeEngine?.lastError;

  let loopController: LoopController | null = null;
  let minimapController: ReturnType<typeof createMinimapController> | null = null;
  let requestFramesUpdate = () => {};
  let canvasTransform = { k: 1, tx: 0, ty: 0 };

  const viewAdapter: GraphViewAdapter = createReteAdapter({
    getContainer: () => container,
    getAreaPlugin: () => areaPlugin,
    getNodeMap: () => nodeMap,
    getConnectionMap: () => connectionMap,
    requestFramesUpdate: () => requestFramesUpdate(),
  });

  // Manager-only visual state (not part of the graph runtime).
  // Used to restore UI state after imports when nodes may not be rendered yet.
  const pendingCollapsedByNodeId = new Map<string, boolean>();

  const getNodeCollapsed = (nodeId: string): boolean =>
    Boolean(viewAdapter.getNodeVisualState(String(nodeId))?.collapsed);

  const flushPendingCollapsedNodes = async () => {
    if (pendingCollapsedByNodeId.size === 0) return;
    for (const [nodeId, collapsed] of Array.from(pendingCollapsedByNodeId.entries())) {
      if (!nodeMap.has(String(nodeId))) continue;
      pendingCollapsedByNodeId.delete(String(nodeId));
      await viewAdapter.setNodeVisualState(String(nodeId), { collapsed: Boolean(collapsed) });
    }
    requestFramesUpdate();
    minimapController?.requestUpdate();
  };

  const setNodeCollapsed = async (nodeId: string, collapsed: boolean) => {
    const id = String(nodeId ?? '');
    if (!id) return;
    pendingCollapsedByNodeId.set(id, Boolean(collapsed));
    await flushPendingCollapsedNodes();
  };

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
    stopAndRemoveLoop: (loop: LocalLoop) => loopController?.loopActions.removeLoop(loop),
  });

  minimapController = createMinimapController({
    getContainer: () => container,
    getAdapter: () => viewAdapter,
    getGraphState: () => graphState,
    getSelectedNodeId: () => selectedNodeId,
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
      const effectiveLoop =
        loopController?.getEffectiveLoops().find((l) => l.id === loop.id) ?? loop;
      const bounds = groupController.computeLoopFrameBounds(effectiveLoop);
      if (!bounds) return;
      groupController.pushNodesOutOfBounds(
        bounds,
        new Set((effectiveLoop.nodeIds ?? []).map((id) => String(id)))
      );
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
    nodeGroups,
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

  const focusController = createFocusController({
    getContainer: () => container,
    getGraphState: () => graphState,
    exportGraph: () => nodeEngine.exportGraph(),
    adapter: viewAdapter,
    requestFramesUpdate: () => requestFramesUpdate(),
    requestMinimapUpdate: () => minimapController?.requestUpdate(),
    getNodeGroups: () => get(nodeGroups),
    getGroupFrames: () => get(groupFrames),
  });

  requestFramesUpdate = () => {
    const t = readAreaTransform(areaPlugin);
    if (t) canvasTransform = t;
    loopController?.requestFramesUpdate();
    groupController.requestFramesUpdate();
  };

  const sleepNodeSockets = createSleepNodeSocketSync({
    getGraphState: () => graphState,
    nodeRegistry,
    sockets,
    getAreaPlugin: () => areaPlugin,
    getNodeMap: () => nodeMap,
  });

  const patchRuntime = createPatchRuntime({
    nodeEngine,
    nodeRegistry,
    adapter: viewAdapter,
    isRunningStore,
    getGraphState: () => graphState,
    groupDisabledNodeIds: groupController.groupDisabledNodeIds,
    executorStatusByClient,
    showExecutorLogs,
    logsClientId,
    loopController,
    managerState,
    displayBridgeState,
    getSDK,
    sendLocalDisplayPlugin,
    ensureDisplayLocalFilesRegisteredFromValue,
  });

  const clientSelectionBinding = createClientSelectionBinding({
    nodeEngine,
    graphStateStore,
    getGraphState: () => graphState,
    managerState,
    sensorData,
    getAreaPlugin: () => areaPlugin,
    getNodeMap: () => nodeMap,
    sendNodeOverride: patchRuntime.sendNodeOverride,
  });

  const syncSleepNodeSockets = (state: GraphState) => sleepNodeSockets.syncSleepNodeSockets(state);

  const resolveSleepOutputType = (nodeId: string) =>
    sleepNodeSockets.resolveSleepOutputType(nodeId);

  const applyClientNodeSelection = (nodeId: string, next: any) =>
    clientSelectionBinding.applyClientNodeSelection(nodeId, next);

  const syncClientNodesFromInputs = () => clientSelectionBinding.syncClientNodesFromInputs();

  const schedulePatchReconcile = (reason: string) => patchRuntime.scheduleReconcile(reason);

  const stopAllDeployedPatches = () => patchRuntime.stopAllDeployedPatches();

  const applyStoppedHighlights = (running: boolean) => patchRuntime.applyStoppedHighlights(running);

  const toggleExecutorLogs = () => patchRuntime.toggleExecutorLogs();

  const syncPatchVisualState = () => patchRuntime.syncPatchVisualState();

  const sendNodeOverride = patchRuntime.sendNodeOverride;

  const reteBuilder = createReteBuilder({
    nodeRegistry,
    nodeEngine,
    sockets,
    getNumberParamOptions: () => numberParamOptions,
    sendNodeOverride,
    onClientNodePick: (nodeId, clientId) => void applyClientNodeSelection(nodeId, { clientId }),
    onClientNodeSelectInput: (nodeId, portId, value) =>
      void applyClientNodeSelection(nodeId, { [portId]: value } as any),
    onClientNodeRandom: (nodeId, value) => void applyClientNodeSelection(nodeId, { random: value }),
  });

  let graphSync: GraphSyncController | null = null;

  let pickerControllerRef: ReturnType<typeof createPickerController> | null = null;

  const pickerController = createPickerController({
    nodeRegistry,
    getContainer: () => container,
    computeGraphPosition,
    getLastPointerClient: () => lastPointerClient,
    getPortDefForSocket: (socket) => {
      const base = reteBuilder.getPortDefForSocket(socket);
      if (!base) return null;
      if (socket.side === 'output' && socket.key === 'output') {
        const node = (graphState.nodes ?? []).find((n) => String(n.id) === String(socket.nodeId));
        if (node && String(node.type) === 'logic-sleep') {
          const { type } = resolveSleepOutputType(String(node.id));
          return { ...base, type };
        }
      }
      return base;
    },
    bestMatchingPort: reteBuilder.bestMatchingPort,
    addNode: (type, position) => {
      const nodeId = addNode(type, position);
      if (!nodeId) return nodeId;

      const picker = pickerControllerRef;
      const mode = picker ? get(picker.mode) : 'add';
      const initial = picker ? get(picker.initialSocket) : null;

      if (mode === 'connect' && initial && position) {
        groupController.autoAddNodeToGroupFromConnectDrop(initial.nodeId, nodeId, position);
        loopController?.autoAddNodeToLoopFromConnectDrop(initial.nodeId, nodeId, position);
      }

      return nodeId;
    },
    addConnection: (conn) => nodeEngine.addConnection(conn),
  });

  pickerControllerRef = pickerController;

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

  const toMiniX = (x: number) => {
    const m = get(minimap);
    return m.offsetX + (x - m.bounds.minX) * m.scale;
  };

  const toMiniY = (y: number) => {
    const m = get(minimap);
    return m.offsetY + (y - m.bounds.minY) * m.scale;
  };

  const refreshNumberParams = () => {
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
  };

  const setSelectedNode = (nextId: string) => {
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
  };

  const generateId = () => `node-${crypto.randomUUID?.() ?? Date.now()}`;

  const groupPortNodesController = createGroupPortNodesController({
    nodeEngine,
    nodeRegistry,
    adapter: viewAdapter,
    groupController,
    getNodeCount: () => nodeCount,
    generateId,
  });

  function computeGraphPosition(clientX: number, clientY: number) {
    const pos = viewAdapter.clientToGraph(clientX, clientY);
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
    return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
  }

  const findPortRowSocketAt = (
    clientX: number,
    clientY: number,
    desiredSide: 'input' | 'output'
  ): SocketData | null => {
    if (!container) return null;
    if (typeof document === 'undefined') return null;
    const elements = document.elementsFromPoint(clientX, clientY) as Element[];
    for (const el of elements) {
      const row = (el as HTMLElement | null)?.closest?.(
        '[data-rete-port-side][data-rete-port-key][data-rete-node-id]'
      ) as HTMLElement | null;
      if (!row) continue;
      if (!container.contains(row)) continue;
      const side = (row.dataset.retePortSide as 'input' | 'output' | undefined) ?? undefined;
      if (!side || side !== desiredSide) continue;
      const nodeId = row.dataset.reteNodeId;
      const key = row.dataset.retePortKey;
      if (!nodeId || !key) continue;
      return { nodeId, side, key };
    }
    return null;
  };

  function addNode(type: string, position?: { x: number; y: number }) {
    const def = nodeRegistry.get(type);
    if (!def) return;
    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) {
      config[field.key] = field.defaultValue;
    }
    const fallback = { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position: position ?? fallback,
      config,
      inputValues: {},
      outputValues: {},
    };
    nodeEngine.addNode(newNode);
    return newNode.id;
  }

  const clipboardController = createClipboardController({
    getContainer: () => container,
    nodeEngine,
    adapter: viewAdapter,
    getGraphState: () => graphState,
    getNodeCount: () => nodeCount,
    getSelectedNodeId: () => selectedNodeId,
    setSelectedNode,
    groupController,
    getLastPointerClient: () => lastPointerClient,
    computeGraphPosition,
    generateId,
  });

  const frameDragController = createFrameDragController({
    getAreaPlugin: () => areaPlugin,
    groupController,
    getLoopController: () => loopController,
  });

  const handleToggleEngine = () => {
    if (get(isRunningStore)) {
      nodeEngine.stop();
      loopController?.loopActions.stopAllClientEffects();
      loopController?.loopActions.stopAllDeployedLoops();
      stopAllDeployedPatches();
    } else {
      nodeEngine.start();
      schedulePatchReconcile('engine-start');
    }
  };

  const handleClear = () => {
    if (confirm('Clear all nodes?')) {
      nodeEngine.clear();
      resetGroups();
    }
  };

  function resetGroups() {
    groupController.nodeGroups.set([]);
    groupController.groupFrames.set([]);
    groupController.groupDisabledNodeIds.set(new Set());
    groupController.editModeGroupId.set(null);
    groupController.groupEditToast.set(null);
    groupController.clearSelection();
    groupController.scheduleHighlight();
  }

  const viewportCenterGraphPos = (): { x: number; y: number } => {
    if (!container) return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const rect = container.getBoundingClientRect();
    return computeGraphPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const fileActions = createFileActions({
    nodeEngine,
    getNodePosition: (nodeId) => viewAdapter.getNodePosition(String(nodeId)),
    getNodeCollapsed,
    setNodeCollapsed,
    getImportGraphInput: () => importGraphInputEl,
    getImportTemplatesInput: () => importTemplatesInputEl,
    getNodeGroups: () => get(groupController.nodeGroups),
    appendNodeGroups: (groups) => groupController.appendGroups(groups),
    onSelectNodeIds: (nodeIds) => {
      const ids = (nodeIds ?? []).map((id) => String(id)).filter(Boolean);
      if (ids.length === 0) return;
      groupController.clearSelection();
      setSelectedNode('');
      groupController.groupSelectionNodeIds.set(new Set(ids));
      groupController.scheduleHighlight();
      requestFramesUpdate();
      minimapController?.requestUpdate();
      focusController.setPendingFocusNodeIds(ids);
    },
    getViewportCenterGraphPos: viewportCenterGraphPos,
  });

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

  $: if (selectedNodeId && !graphState.nodes.some((n) => n.id === selectedNodeId)) {
    setSelectedNode('');
  }

  onMount(async () => {
    if (!container) return;

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as any).__shuguNodeEngine = nodeEngine;
    }

    midiController.start();

    refreshNumberParams();
    paramsUnsub = parameterRegistry.subscribe(() => refreshNumberParams());

    tickUnsub = nodeEngine.tickTime.subscribe(() => {
      groupPortNodesController.updateRuntimeActives();
      patchRuntime.onTick();
    });

    runningUnsub = isRunningStore.subscribe((running) => {
      patchRuntime.onRunningChanged(Boolean(running));
      if (!running) {
        loopController?.loopActions.stopAllClientEffects();
        loopController?.loopActions.stopAllDeployedLoops();
      }
    });

    loopDeployUnsub = deployedLoopIds.subscribe(() => {
      patchRuntime.onLoopDeployListChanged();
    });

    groupDisabledUnsub = groupController.groupDisabledNodeIds.subscribe((disabled) => {
      patchRuntime.onGroupDisabledChanged(disabled);
    });

    editor = new NodeEditor('fluffy-rete');
    areaPlugin = new AreaPlugin(container);
    const connection: any = new ConnectionPlugin();
    connectionPlugin = connection;
    const render: any = new SveltePlugin();
    const history = new HistoryPlugin();

    areaPlugin?.area?.setZoomHandler?.(null);

    editor.use(areaPlugin);
    areaPlugin.use(connection);
    areaPlugin.use(render);
    areaPlugin.use(history);

    connection.addPreset(ConnectionPresets.classic.setup());
    connection.addPipe((ctx: any) => {
      if (ctx?.type === 'connectiondrop') {
        const data = ctx.data as any;
        const initial = data?.initial as any;
        const socket = data?.socket as any;
        const created = Boolean(data?.created);
        if (initial && !socket && !created) {
          const initialSocket: SocketData = {
            nodeId: String(initial.nodeId),
            side: initial.side,
            key: String(initial.key),
          };
          const desiredSide = initialSocket.side === 'output' ? 'input' : 'output';
          const snapped = findPortRowSocketAt(
            lastPointerClient.x,
            lastPointerClient.y,
            desiredSide
          );
          if (snapped) {
            const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
            const engineConn: EngineConnection =
              initialSocket.side === 'output'
                ? {
                    id: connId,
                    sourceNodeId: initialSocket.nodeId,
                    sourcePortId: initialSocket.key,
                    targetNodeId: snapped.nodeId,
                    targetPortId: snapped.key,
                  }
                : {
                    id: connId,
                    sourceNodeId: snapped.nodeId,
                    sourcePortId: snapped.key,
                    targetNodeId: initialSocket.nodeId,
                    targetPortId: initialSocket.key,
                  };
            nodeEngine.addConnection(engineConn);
          } else {
            openConnectPicker(initialSocket);
          }
        }
      }
      return ctx;
    });

    render.addPreset(
      SveltePresets.classic.setup({
        socketPositionWatcher:
          socketPositionWatcher ??
          (socketPositionWatcher = new LiveDOMSocketPosition(requestFramesUpdate)),
        customize: {
          node: () => ReteNode,
          connection: () => ReteConnection,
          control: () => ReteControl,
        },
      })
    );

    graphSync = createGraphSync({
      editor,
      areaPlugin,
      nodeMap,
      connectionMap,
      nodeRegistry,
      socketFor: reteBuilder.socketFor,
      buildReteNode: reteBuilder.buildReteNode,
      nodeLabel: reteBuilder.nodeLabel,
      applyMidiMapRangeConstraints: reteBuilder.applyMidiMapRangeConstraints,
      setGraphState: (state) => (graphState = state),
      setNodeCount: (count) => (nodeCount = count),
      getSelectedNodeId: () => selectedNodeId,
      onAfterSync: () => {
        void syncSleepNodeSockets(graphState);
        void flushPendingCollapsedNodes();
        minimapController.requestUpdate();
        requestFramesUpdate();
        void loopController?.applyHighlights();
        void groupController.applyHighlights();
        void midiController.applyHighlights();
        void applyStoppedHighlights(get(isRunningStore));
        syncPatchVisualState();

        focusController.flushPendingFocus();

        syncClientNodesFromInputs();
      },
      isSyncingRef,
    });

    await graphSync.schedule(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => {
      if ((state.nodes ?? []).some((n) => String(n.type).startsWith('midi-'))) {
        void midiService.init();
      }

      const nextNodeCount = state.nodes?.length ?? 0;
      const prevNodeCount = lastGraphNodeCount;
      lastGraphNodeCount = nextNodeCount;

      // Only reconcile on node removal to avoid interfering with imports (nodes are added one-by-one).
      if (prevNodeCount >= 0 && nextNodeCount < prevNodeCount) {
        const removedGroupIds = groupController.reconcileGraphNodes(state);
        if (removedGroupIds.length > 0) {
          // Removing group ports triggers another graphState update; skip syncing this stale snapshot.
          const removedPorts =
            groupPortNodesController.removeGroupPortNodesForGroupIds(removedGroupIds);
          if (removedPorts > 0) return;
        }
      }

      graphSync?.schedule(state);
      patchRuntime.onGraphStateChanged();
    });

    groupNodesUnsub = groupController.nodeGroups.subscribe(() => {
      groupPortNodesController.ensureGroupPortNodes();
      groupPortNodesController.scheduleAlign();
    });

    groupFramesUnsub = groupFrames.subscribe(() => {
      groupPortNodesController.scheduleAlign();
    });

    let lastClientKey = '';
    managerUnsub = managerState.subscribe(($state) => {
      const clientsWithGroups = ($state.clients ?? [])
        .map((c: any) => ({
          id: String(c?.clientId ?? ''),
          group: String(c?.group ?? ''),
        }))
        .filter((c: any) => Boolean(c.id));

      const audience = clientsWithGroups
        .filter((c: any) => String(c.group) !== 'display')
        .map((c: any) => String(c.id));

      const displayIdSet = new Set(
        clientsWithGroups
          .filter((c: any) => String(c.group) === 'display')
          .map((c: any) => String(c.id))
      );

      const nextClientKey = clientsWithGroups.map((c: any) => `${c.id}:${c.group}`).join('|');
      if (nextClientKey === lastClientKey) return;
      lastClientKey = nextClientKey;

      schedulePatchReconcile('manager-state');
      // Client node titles depend on online client count; refresh labels when client list changes.
      void graphSync?.schedule(get(graphStateStore));

      const engineState = get(graphStateStore);
      // If a project ever ended up with a Display clientId inside a Client node, clear it.
      if (displayIdSet.size > 0) {
        for (const node of engineState.nodes ?? []) {
          if (String(node.type) !== 'client-object') continue;
          const nodeId = String(node.id);
          const nodeInstance = nodeEngine.getNode(nodeId);
          const configuredClientId =
            typeof (nodeInstance?.config as any)?.clientId === 'string'
              ? String((nodeInstance?.config as any).clientId)
              : '';
          if (configuredClientId && displayIdSet.has(configuredClientId)) {
            nodeEngine.updateNodeConfig(nodeId, { clientId: '' });
            if (nodeInstance?.outputValues) {
              (nodeInstance.outputValues as any).out = { clientId: '', sensors: null };
              nodeEngine.tickTime.set(Date.now());
            }
          }
        }
      }

      if (audience.length === 0) {
        return;
      }

      syncClientNodesFromInputs();
    });

    // Patch targets can include local display (MessagePort), which is outside `managerState.clients`.
    // Reconcile patch deployment when the Display bridge connects/disconnects.
    let lastDisplayBridgeKey = '';
    displayBridgeUnsub = displayBridgeState.subscribe((s) => {
      const nextKey = `${s.status}|${s.ready ? 1 : 0}`;
      if (nextKey === lastDisplayBridgeKey) return;
      lastDisplayBridgeKey = nextKey;
      schedulePatchReconcile('display-bridge');
    });

    bindRetePipes({
      editor,
      areaPlugin,
      nodeEngine,
      nodeMap,
      connectionMap,
      isSyncing: () => isSyncingRef.value,
      setSelectedNode,
      groupSelectionNodeIds: groupController.groupSelectionNodeIds,
      isProgrammaticTranslate: groupController.isProgrammaticTranslate,
      handleDroppedNodesAfterDrag: groupController.handleDroppedNodesAfterDrag,
      requestFramesUpdate,
      requestMinimapUpdate: minimapController.requestUpdate,
    });

    if (areaPlugin) {
      await AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
      minimapController.requestUpdate();
      requestFramesUpdate();
    }

    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const hasBounds = bounds.width > 0 && bounds.height > 0;
      const within =
        hasBounds &&
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!hasBounds) return;
      } else if (!within) {
        return;
      }

      if (target?.closest?.('.node-picker')) return;
      if (target?.closest?.('.minimap')) return;
      const tag = target?.tagName?.toLowerCase?.() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const area = areaPlugin?.area;
      if (!area) return;
      normalizeAreaTransform(area);

      const current = Number(area.transform?.k ?? 1) || 1;
      let deltaY = event.deltaY;
      if (event.deltaMode === 1) deltaY *= 16;
      if (event.deltaMode === 2) deltaY *= container.clientHeight || 1;
      if (!deltaY) return;

      const abs = Math.abs(deltaY);
      const isFine = abs < 10;
      const speed = event.ctrlKey ? 0.02 : isFine ? 0.012 : 0.0022;
      const zoomFactor = Math.exp(-deltaY * speed);

      const minZoom = 0.2;
      const maxZoom = 2.5;
      const next = Math.max(minZoom, Math.min(maxZoom, current * zoomFactor));
      const ratio = next / current - 1;
      if (ratio === 0) return;

      const rectEl: HTMLElement | null = area?.content?.holder ?? container;
      const rect = rectEl?.getBoundingClientRect?.();
      if (!rect) return;

      if (!event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
      }

      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
      const clientX = within ? event.clientX : clamp(event.clientX, bounds.left, bounds.right);
      const clientY = within ? event.clientY : clamp(event.clientY, bounds.top, bounds.bottom);

      const ox = (rect.left - clientX) * ratio;
      const oy = (rect.top - clientY) * ratio;
      void area.zoom(next, ox, oy, 'wheel');
      minimapController.requestUpdate();
      requestFramesUpdate();
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    wheelHandler = onWheel;

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.node-picker')) return;
      if (target?.closest?.('.minimap')) return;

      const tag = target?.tagName?.toLowerCase?.() ?? '';
      const isEditing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean((target as any)?.isContentEditable);
      if (isEditing) return;

      event.preventDefault();
      event.stopPropagation();
      openPicker({ clientX: event.clientX, clientY: event.clientY, mode: 'add' });
    };
    container.addEventListener('contextmenu', onContextMenu, { capture: true });
    contextMenuHandler = onContextMenu;

    const onPointerDown = (event: PointerEvent) => {
      // New UX: Alt/Option + drag on a node duplicates it and drags the clone.
      if (event.button === 0 && event.altKey && altDuplicateDragPointerId === null) {
        const target = event.target as HTMLElement | null;
        const nodeEl = (target?.closest?.('.node') as HTMLElement | null) ?? null;
        const nodeId = String(nodeEl?.dataset?.reteNodeId ?? '');

        const tag = target?.tagName?.toLowerCase?.() ?? '';
        const isEditing =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          tag === 'button' ||
          Boolean((target as any)?.isContentEditable) ||
          Boolean(target?.closest?.('input, textarea, select, button')) ||
          Boolean(target?.closest?.('.port-control')) ||
          Boolean(target?.closest?.('.cmd-aggregator-controls'));

        if (nodeEl && nodeId && !isEditing) {
          // Prevent the default Rete drag so the original node stays put.
          event.preventDefault();
          event.stopPropagation();

          const initialNode = nodeEngine.getNode(nodeId);
          if (!initialNode) return;

          groupController.clearSelection();
          setSelectedNode(nodeId);

          const startClient = { x: event.clientX, y: event.clientY };
          const startGraph = computeGraphPosition(event.clientX, event.clientY);
          const startPos =
            viewAdapter.getNodePosition(nodeId) ??
            ({
              x: Number(initialNode.position?.x ?? 0),
              y: Number(initialNode.position?.y ?? 0),
            } as const);

          let didDuplicate = false;
          let duplicatedId: string | null = null;
          let dragOffset = { x: startGraph.x - startPos.x, y: startGraph.y - startPos.y };

          const MIN_DRAG_PX = 4;

          const cleanup = () => {
            if (altDuplicateDragMoveHandler)
              window.removeEventListener('pointermove', altDuplicateDragMoveHandler, {
                capture: true,
              } as any);
            if (altDuplicateDragUpHandler) {
              window.removeEventListener('pointerup', altDuplicateDragUpHandler, {
                capture: true,
              } as any);
              window.removeEventListener('pointercancel', altDuplicateDragUpHandler, {
                capture: true,
              } as any);
            }
            altDuplicateDragPointerId = null;
            altDuplicateDragMoveHandler = null;
            altDuplicateDragUpHandler = null;
          };

          const onMove = (moveEvent: PointerEvent) => {
            if (altDuplicateDragPointerId === null) return;
            if (moveEvent.pointerId !== altDuplicateDragPointerId) return;

            const dx = moveEvent.clientX - startClient.x;
            const dy = moveEvent.clientY - startClient.y;
            const dist = Math.hypot(dx, dy);

            if (!didDuplicate) {
              if (dist < MIN_DRAG_PX) return;

              const source = nodeEngine.getNode(nodeId);
              if (!source) {
                cleanup();
                return;
              }

              const basePos =
                viewAdapter.getNodePosition(nodeId) ??
                ({
                  x: Number(source.position?.x ?? 0),
                  y: Number(source.position?.y ?? 0),
                } as const);

              const newId = generateId();
              const clone: NodeInstance = {
                id: newId,
                type: String(source.type ?? ''),
                position: { x: basePos.x, y: basePos.y },
                config: { ...(source.config ?? {}) },
                inputValues: { ...(source.inputValues ?? {}) },
                outputValues: {},
              };

              nodeEngine.addNode(clone);

              didDuplicate = true;
              duplicatedId = newId;
              dragOffset = { x: startGraph.x - basePos.x, y: startGraph.y - basePos.y };

              groupController.clearSelection();
              setSelectedNode(newId);
            }

            if (!duplicatedId) return;

            const graphPos = computeGraphPosition(moveEvent.clientX, moveEvent.clientY);
            const desiredX = graphPos.x - dragOffset.x;
            const desiredY = graphPos.y - dragOffset.y;
            viewAdapter.setNodePosition(duplicatedId, desiredX, desiredY);

            moveEvent.preventDefault();
            moveEvent.stopPropagation();
          };

          const onUp = (upEvent: PointerEvent) => {
            if (altDuplicateDragPointerId === null) return;
            if (upEvent.pointerId !== altDuplicateDragPointerId) return;

            const finalId = duplicatedId;
            cleanup();

            if (finalId) {
              const pos = viewAdapter.getNodePosition(finalId);
              if (pos) nodeEngine.updateNodePosition(finalId, { x: pos.x, y: pos.y });
              groupController.handleDroppedNodesAfterDrag([finalId]);
            }
          };

          altDuplicateDragPointerId = event.pointerId;
          altDuplicateDragMoveHandler = onMove;
          altDuplicateDragUpHandler = onUp;
          window.addEventListener('pointermove', onMove, { capture: true });
          window.addEventListener('pointerup', onUp, { capture: true });
          window.addEventListener('pointercancel', onUp, { capture: true });

          return;
        }
      }

      groupController.onPointerDown(event);
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    pointerDownHandler = onPointerDown;

    const onPointerMove = (event: PointerEvent) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
    };
    container.addEventListener('pointermove', onPointerMove, { capture: true });
    pointerMoveHandler = onPointerMove;

    const onDblClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.node')) return;
      if (target?.closest?.('.node-picker')) return;
      if (target?.closest?.('.marquee-actions')) return;
      if (target?.closest?.('.minimap')) return;
      if (target?.closest?.('.executor-logs')) return;
      if (target?.closest?.('.loop-frame-header')) return;
      if (target?.closest?.('.group-frame-header')) return;

      const tag = target?.tagName?.toLowerCase?.() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const t = readAreaTransform(areaPlugin);
      if (!t) return;
      const gx = (x - t.tx) / t.k;
      const gy = (y - t.ty) / t.k;

      const frames = get(groupFrames) ?? [];
      let picked: any = null;
      let bestDepth = -1;
      let bestArea = Number.POSITIVE_INFINITY;

      for (const frame of frames) {
        const left = Number(frame?.left);
        const top = Number(frame?.top);
        const width = Number(frame?.width);
        const height = Number(frame?.height);
        if (
          !Number.isFinite(left) ||
          !Number.isFinite(top) ||
          !Number.isFinite(width) ||
          !Number.isFinite(height)
        )
          continue;

        const inside = gx >= left && gx <= left + width && gy >= top && gy <= top + height;
        if (!inside) continue;

        const depth = Number(frame?.depth ?? 0);
        const area = width * height;
        if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
          picked = frame;
          bestDepth = depth;
          bestArea = area;
        }
      }

      if (!picked?.group?.id) return;
      event.preventDefault();
      event.stopPropagation();
      groupController.toggleGroupEditMode(String(picked.group.id));
    };

    container.addEventListener('dblclick', onDblClick, { capture: true });
    dblclickHandler = onDblClick;

    resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const area = areaPlugin?.area;
      if (!area) return;
      normalizeAreaTransform(area);
      area.update?.();
      minimapController.handleContainerResize();
      requestFramesUpdate();
    });
    resizeObserver.observe(container);

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      const lowerKey = key.toLowerCase();
      if (key === 'Escape' && isToolbarMenuOpen) {
        event.preventDefault();
        closeToolbarMenu();
        return;
      }
      if (key === 'Escape' && get(isPickerOpen)) {
        event.preventDefault();
        closePicker();
        return;
      }
      if (key === 'Escape' && get(groupController.groupSelectionNodeIds).size > 0) {
        event.preventDefault();
        groupController.clearSelection();
        return;
      }

      const el = (event.target as HTMLElement | null) ?? document.activeElement;
      const tag = el?.tagName?.toLowerCase?.() ?? '';
      const isEditing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean((el as any)?.isContentEditable);
      if (isEditing) return;

      if ((event.metaKey || event.ctrlKey) && lowerKey === 'c') {
        if (clipboardController.copySelectedNodes()) {
          event.preventDefault();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === 'v') {
        if (clipboardController.pasteCopiedNodes()) {
          event.preventDefault();
        }
        return;
      }

      if (key !== 'Backspace' && key !== 'Delete') return;

      const selectedIds = get(groupController.groupSelectionNodeIds);
      if (selectedIds.size > 0) {
        event.preventDefault();
        for (const id of selectedIds) {
          nodeEngine.removeNode(id);
        }
        groupController.clearSelection();
        return;
      }

      if (!selectedNodeId) return;
      event.preventDefault();
      nodeEngine.removeNode(selectedNodeId);
    };

    window.addEventListener('keydown', onKeyDown);
    keydownHandler = onKeyDown;

    const onWindowPointerDown = (event: PointerEvent) => {
      if (!isToolbarMenuOpen) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (toolbarMenuWrap?.contains(target)) return;
      closeToolbarMenu();
    };
    window.addEventListener('pointerdown', onWindowPointerDown, { capture: true });
    toolbarMenuOutsideHandler = onWindowPointerDown;
  });

  onDestroy(() => {
    graphUnsub?.();
    groupNodesUnsub?.();
    groupFramesUnsub?.();
    paramsUnsub?.();
    tickUnsub?.();
    runningUnsub?.();
    loopDeployUnsub?.();
    groupDisabledUnsub?.();
    managerUnsub?.();
    displayBridgeUnsub?.();
    midiController.stop();
    patchRuntime.destroy();
    loopController?.destroy();
    frameDragController.destroy();
    groupController.destroy();
    groupPortNodesController.destroy();
    minimapController.destroy();
    if (wheelHandler) window.removeEventListener('wheel', wheelHandler, { capture: true } as any);
    if (contextMenuHandler)
      container?.removeEventListener('contextmenu', contextMenuHandler, { capture: true } as any);
    if (pointerDownHandler)
      container?.removeEventListener('pointerdown', pointerDownHandler, { capture: true } as any);
    if (pointerMoveHandler)
      container?.removeEventListener('pointermove', pointerMoveHandler, { capture: true } as any);
    if (dblclickHandler)
      container?.removeEventListener('dblclick', dblclickHandler, { capture: true } as any);
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
    if (altDuplicateDragMoveHandler)
      window.removeEventListener('pointermove', altDuplicateDragMoveHandler, {
        capture: true,
      } as any);
    if (altDuplicateDragUpHandler) {
      window.removeEventListener('pointerup', altDuplicateDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', altDuplicateDragUpHandler, {
        capture: true,
      } as any);
    }
    altDuplicateDragPointerId = null;
    altDuplicateDragMoveHandler = null;
    altDuplicateDragUpHandler = null;
    if (toolbarMenuOutsideHandler)
      window.removeEventListener('pointerdown', toolbarMenuOutsideHandler, {
        capture: true,
      } as any);
    resizeObserver?.disconnect();
    socketPositionWatcher?.destroy();
    areaPlugin?.destroy?.();
    editor?.clear();
    nodeMap.clear();
    connectionMap.clear();
    nodeEngine.clearDisabledNodes();

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      if ((window as any).__shuguNodeEngine === nodeEngine) {
        delete (window as any).__shuguNodeEngine;
      }
    }
  });
</script>

<NodeCanvasLayout
  bind:container
  isRunning={$isRunningStore}
  edgeShadowsEnabled={$nodeGraphEdgeShadows}
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
      groups={$nodeGroups}
      onFocusGroup={focusController.focusGroupById}
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
      <ExecutorLogsPanel
        clientId={$logsClientId}
        status={logsStatus}
        onClose={() => showExecutorLogs.set(false)}
      />
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="overlays">
    {#if $nodeGraphPerfConsole}
      <PerformanceDebugConsole
        enabled={true}
        {nodeCount}
        connectionCount={graphState.connections?.length ?? 0}
        rendererType="rete"
        shadowsEnabled={$nodeGraphEdgeShadows}
      />
    {/if}

    {#if $canvasToast}
      <div class="canvas-toast" aria-live="polite">{$canvasToast}</div>
    {/if}

    <NodePickerOverlay
      isOpen={$isPickerOpen}
      mode={$pickerMode}
      initialSocket={$pickerInitialSocket}
      connectTypeLabel={$pickerInitialSocket
        ? (reteBuilder.getPortDefForSocket($pickerInitialSocket)?.type ?? 'any')
        : 'any'}
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
      isRunning={$isRunningStore}
      editModeGroupId={$editModeGroupId}
      toast={$groupEditToast}
      onToggleDisabled={groupController.toggleGroupDisabled}
      onToggleEditMode={groupController.toggleGroupEditMode}
      onDisassemble={groupPortNodesController.disassembleGroupAndPorts}
      onRename={groupController.renameGroup}
      onHeaderPointerDown={frameDragController.startGroupHeaderDrag}
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
      onHeaderPointerDown={frameDragController.startLoopHeaderDrag}
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

  :global(.node-canvas-container .node.local-loop) {
    border-color: rgba(236, 72, 153, 0.85) !important;
    box-shadow: 0 18px 56px rgba(236, 72, 153, 0.16) !important;
  }

  :global(.node-canvas-container .node.deployed-loop) {
    border-color: rgba(20, 184, 166, 0.95) !important;
    box-shadow: 0 18px 56px rgba(20, 184, 166, 0.16) !important;
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

  :global(.node-canvas-container .socket[title='number']) {
    background: rgba(34, 197, 94, 0.92) !important;
  }

  :global(.node-canvas-container .socket[title='boolean']) {
    background: rgba(245, 158, 11, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='string']) {
    background: rgba(59, 130, 246, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='color']) {
    background: rgba(236, 72, 153, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='audio']) {
    background: rgba(14, 165, 233, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='image']) {
    background: rgba(244, 114, 182, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='video']) {
    background: rgba(34, 211, 238, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='client']) {
    background: rgba(168, 85, 247, 0.95) !important;
  }

  :global(.node-canvas-container .socket[title='command']) {
    background: rgba(239, 68, 68, 0.92) !important;
  }

  :global(.node-canvas-container .socket[title='fuzzy']) {
    background: rgba(20, 184, 166, 0.95) !important;
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
