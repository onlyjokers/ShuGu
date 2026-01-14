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
  import {
    CUSTOM_NODE_TYPE_PREFIX,
    addCustomNodeDefinition,
    customNodeDefinitions,
    customNodeType,
    getCustomNodeDefinition,
    removeCustomNodeDefinition,
    upsertCustomNodeDefinition,
  } from '$lib/nodes/custom-nodes/store';
  import {
    cloneInternalGraphForNewInstance,
    generateCustomNodeGroupId,
    readCustomNodeState,
    writeCustomNodeState,
  } from '$lib/nodes/custom-nodes/instance';
  import {
    syncCustomNodeInternalGraph,
    syncNestedCustomNodesToDefinition,
  } from '$lib/nodes/custom-nodes/sync';
  import { definitionsInCycles, wouldCreateCycle } from '$lib/nodes/custom-nodes/deps';
  import {
    buildCustomNodeFile,
    parseCustomNodeFile,
    remapImportedDefinitions,
  } from '$lib/nodes/custom-nodes/io';
  import { parameterRegistry } from '$lib/parameters/registry';
  import { nodeGroupsState } from '$lib/project/nodeGraphUiState';
  import { displayTransport, getSDK, sensorData, state as managerState } from '$lib/stores/manager';
  import {
    displayBridgeState,
    ensureDisplayLocalFilesRegisteredFromValue,
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
  import {
    buildGroupPortIndex,
    groupIdFromNode,
    isGroupPortNodeType,
  } from './node-canvas/utils/group-port-utils';
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
  let groupUiStateUnsub: (() => void) | null = null;
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
  let proxyDragPointerId: number | null = null;
  let proxyDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let proxyDragUpHandler: ((event: PointerEvent) => void) | null = null;
  let groupFrameToggleHandler: ((event: Event) => void) | null = null;
  let groupFrameDisabledHandler: ((event: Event) => void) | null = null;
  let customNodeUncoupleHandler: ((event: Event) => void) | null = null;
  let customNodeExpandHandler: ((event: Event) => void) | null = null;
  let groupFrameTranslateDepth = 0;
  let resizeObserver: ResizeObserver | null = null;
  let socketPositionWatcher: LiveDOMSocketPosition | null = null;
  let managerUnsub: (() => void) | null = null;
  let displayBridgeUnsub: (() => void) | null = null;
  let loopDeployUnsub: (() => void) | null = null;

  const sockets = {
    number: new ClassicPreset.Socket('number'),
    boolean: new ClassicPreset.Socket('boolean'),
    string: new ClassicPreset.Socket('string'),
    asset: new ClassicPreset.Socket('asset'),
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
  let lastGraphConnKey = '';
  let selectedNodeId = '';
  let importGraphInputEl: HTMLInputElement | null = null;
  let importTemplatesInputEl: HTMLInputElement | null = null;
  let importCustomNodeInputEl: HTMLInputElement | null = null;
  let isToolbarMenuOpen = false;
  let toolbarMenuWrap: HTMLDivElement | null = null;
  let numberParamOptions: { path: string; label: string }[] = [];
  let pickerElement: HTMLDivElement | null = null;
  let lastPointerClient = { x: 0, y: 0 };
  let groupEdgeHighlight: { groupId: string; side: 'input' | 'output' } | null = null;
  let connectDraggingSocket: SocketData | null = null;

  // Project persistence: keep Group metadata in sync with ProjectManager autosave/restore.
  let syncingGroupsFromProject = false;
  let syncingGroupsToProject = false;
  let lastGroupsKeyFromProject = '';
  let lastGroupsKeyFromCanvas = '';

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
  const forcedHiddenNodeIds = new Set<string>();

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
    getForcedHiddenNodeIds: () => forcedHiddenNodeIds,
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
    selectedGroupId,
    canvasToast,
    groupEditToast,
    groupSelectionBounds,
    groupSelectionNodeIds,
    marqueeRect,
  } = groupController;

  // UI helper: When a Group's gate input is wired (connection into group-gate.active), we treat it as "Gate mode"
  // and hide the "Gate: Open/Closed" badge (the wire + border state is enough).
  $: gateModeGroupIds = (() => {
    const nodes = Array.isArray(graphState.nodes) ? graphState.nodes : [];
    const connections = Array.isArray(graphState.connections) ? graphState.connections : [];

    const incomingTargetKeys = new Set<string>();
    for (const c of connections) {
      incomingTargetKeys.add(
        `${String((c as any).targetNodeId ?? '')}:${String((c as any).targetPortId ?? '')}`
      );
    }

    const result = new Set<string>();
    for (const node of nodes) {
      if (String((node as any).type ?? '') !== 'group-gate') continue;
      const nodeId = String((node as any).id ?? '');
      if (!nodeId) continue;
      if (!incomingTargetKeys.has(`${nodeId}:active`)) continue;
      const rawGroupId = ((node as any).config as any)?.groupId;
      const groupId =
        typeof rawGroupId === 'string' ? rawGroupId : rawGroupId ? String(rawGroupId) : '';
      if (groupId) result.add(groupId);
    }

    return result;
  })();

  $: groupGateNodeIdByGroupId = (() => {
    const nodes = Array.isArray(graphState.nodes) ? graphState.nodes : [];
    const map = new Map<string, string>();

    for (const node of nodes) {
      if (String((node as any).type ?? '') !== 'group-gate') continue;
      const nodeId = String((node as any).id ?? '');
      if (!nodeId) continue;
      const rawGroupId = ((node as any).config as any)?.groupId;
      const groupId =
        typeof rawGroupId === 'string' ? rawGroupId : rawGroupId ? String(rawGroupId) : '';
      if (!groupId) continue;
      if (!map.has(groupId)) map.set(groupId, nodeId);
    }

    return map;
  })();

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
    displayTransport,
    getSDK,
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
    graphStateStore,
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
    if (nextId) selectedGroupId.set(null);

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

  const deleteNodeWithRules = (nodeId: string) => {
    const id = String(nodeId ?? '');
    if (!id) return;

    const node = nodeEngine.getNode(id);
    if (!node) return;

    const state = readCustomNodeState((node as any)?.config ?? {});
    if (!state || state.role !== 'mother') {
      nodeEngine.removeNode(id);
      return;
    }

    const def = getCustomNodeDefinition(state.definitionId);
    const name = String(def?.name ?? 'Custom Node');

    const graph = nodeEngine.exportGraph();
    const coupledChildren = (graph.nodes ?? [])
      .map((n: any) => ({
        id: String(n.id ?? ''),
        state: readCustomNodeState((n as any)?.config ?? {}),
      }))
      .filter((n: any) =>
        Boolean(
          n.id &&
          n.state &&
          String(n.state.definitionId) === state.definitionId &&
          n.state.role === 'child'
        )
      )
      .map((n: any) => String(n.id))
      .filter((cid: string) => cid !== id);

    const ok = confirm(
      `Delete mother "${name}"?\n\nThis will delete the Custom Node definition and ${coupledChildren.length} coupled child instance(s).`
    );
    if (!ok) return;

    for (const cid of coupledChildren) nodeEngine.removeNode(cid);
    nodeEngine.removeNode(id);
    removeCustomNodeDefinition(state.definitionId);

    if (selectedNodeId === id) setSelectedNode('');
  };

  type ExpandedCustomNodeFrame = {
    groupId: string;
    nodeId: string;
  };

  const expandedCustomByGroupId = new Map<string, ExpandedCustomNodeFrame>();
  let expandedCustomGroupIds: Set<string> = new Set();
  const refreshExpandedCustomGroupIds = () => {
    expandedCustomGroupIds = new Set(Array.from(expandedCustomByGroupId.keys()));
  };

  const handleGroupHeaderPointerDown = (groupId: string, event: PointerEvent) => {
    const id = String(groupId ?? '');
    if (id) selectedGroupId.set(id);

    if (get(groupSelectionNodeIds).size > 0) {
      groupSelectionNodeIds.set(new Set());
      groupSelectionBounds.set(null);
      groupController.scheduleHighlight();
    }

    setSelectedNode('');
    frameDragController.startGroupHeaderDrag(id, event);
  };

  const materializeInternalNodeId = (customNodeId: string, internalNodeId: string): string => {
    const cid = String(customNodeId ?? '');
    const iid = String(internalNodeId ?? '');
    return `cn:${cid}:${iid}`;
  };

  const isMaterializedInternalNodeId = (customNodeId: string, nodeId: string): boolean => {
    const cid = String(customNodeId ?? '');
    const id = String(nodeId ?? '');
    return Boolean(cid && id && id.startsWith(`cn:${cid}:`));
  };

  const internalNodeIdFromMaterialized = (customNodeId: string, nodeId: string): string => {
    const cid = String(customNodeId ?? '');
    const id = String(nodeId ?? '');
    const prefix = `cn:${cid}:`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const customNodeIdFromMaterializedNodeId = (nodeId: string): string | null => {
    const id = String(nodeId ?? '');
    if (!id.startsWith('cn:')) return null;
    const rest = id.slice(3);
    // Support nested materialization where the customNodeId itself may contain ':' (e.g. nested mothers),
    // assuming the internal node id (template id) never contains ':'.
    const idx = rest.lastIndexOf(':');
    if (idx <= 0 || idx >= rest.length - 1) return null;
    return rest.slice(0, idx);
  };

  const deepestGroupIdContainingNode = (nodeId: string, groups: any[]): string | null => {
    const byId = new Map(groups.map((g: any) => [String(g?.id ?? ''), g] as const));
    const depthCache = new Map<string, number>();

    const depthOf = (groupId: string, visiting = new Set<string>()): number => {
      const cached = depthCache.get(groupId);
      if (cached !== undefined) return cached;
      if (visiting.has(groupId)) return 0;
      visiting.add(groupId);
      const g = byId.get(String(groupId));
      const parentId = g?.parentId ? String(g.parentId) : null;
      const depth = parentId && byId.has(parentId) ? depthOf(parentId, visiting) + 1 : 0;
      visiting.delete(groupId);
      depthCache.set(groupId, depth);
      return depth;
    };

    let best: { id: string; depth: number } | null = null;
    for (const g of groups) {
      const id = String(g?.id ?? '');
      if (!id) continue;
      const nodeIds = Array.isArray(g?.nodeIds) ? g.nodeIds.map(String) : [];
      if (!nodeIds.includes(String(nodeId))) continue;
      const depth = depthOf(id);
      if (!best || depth > best.depth) best = { id, depth };
    }
    return best?.id ?? null;
  };

  const rehydrateExpandedCustomFrames = (state: GraphState) => {
    const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
    const customNodeIds = new Set<string>();
    for (const n of nodes) {
      const id = String((n as any)?.id ?? '');
      const customId = customNodeIdFromMaterializedNodeId(id);
      if (customId) customNodeIds.add(customId);
    }
    if (customNodeIds.size === 0) return;

    const groups = get(groupController.nodeGroups) ?? [];
    let nextGroups = groups;
    let groupsChanged = false;
    let expandedChanged = false;

    const decorationTypes = new Set(['group-activate', 'group-gate', 'group-proxy', 'group-frame']);

    for (const customId of customNodeIds) {
      const node = nodeEngine.getNode(String(customId)) as any;
      if (!node) continue;
      const state = readCustomNodeState(node?.config ?? {});
      if (!state || state.role !== 'mother') continue;

      const groupId = String(state.groupId ?? '');
      if (!groupId) continue;

      // Mark as expanded so the Group frame shows the Custom Node actions (Collapse only).
      if (!expandedCustomByGroupId.has(groupId)) {
        expandedCustomByGroupId.set(groupId, { groupId, nodeId: String(customId) });
        forcedHiddenNodeIds.add(String(customId));
        expandedChanged = true;
      }

      if (!nextGroups.some((g: any) => String(g?.id ?? '') === groupId)) {
        const def = getCustomNodeDefinition(state.definitionId);
        const parentId = deepestGroupIdContainingNode(String(customId), nextGroups);
        const nodeIdsInGroup = nodes
          .filter(
            (n: any) =>
              isMaterializedInternalNodeId(String(customId), String(n?.id ?? '')) &&
              !decorationTypes.has(String(n?.type ?? ''))
          )
          .map((n: any) => String(n.id));

        nextGroups = [
          ...nextGroups,
          {
            id: groupId,
            parentId: parentId ? String(parentId) : null,
            name: String(def?.name ?? 'Custom Node'),
            nodeIds: nodeIdsInGroup,
            disabled: !state.manualGate,
            minimized: false,
          },
        ];
        groupsChanged = true;
      }
    }

    if (!groupsChanged && !expandedChanged) return;

    if (groupsChanged) {
      groupController.setGroups(nextGroups as any);
    }

    refreshExpandedCustomGroupIds();
    groupController.scheduleHighlight();
    requestFramesUpdate();
  };

  const handleExpandCustomNode = (nodeId: string) => {
    const id = String(nodeId ?? '');
    if (!id) return;

    const node = nodeEngine.getNode(id) as any;
    if (!node) return;

    const state = readCustomNodeState(node?.config ?? {});
    if (!state || state.role !== 'mother') return;

    const groupId = String(state.groupId ?? '');
    if (!groupId) return;
    if (expandedCustomByGroupId.has(groupId)) return;

    const def = getCustomNodeDefinition(state.definitionId);
    if (!def) return;

    const baseX = Number(node.position?.x ?? 0);
    const baseY = Number(node.position?.y ?? 0);

    const internal = state.internal ?? { nodes: [], connections: [] };
    const internalNodes: any[] = Array.isArray((internal as any).nodes)
      ? (internal as any).nodes
      : [];
    const internalConnections: any[] = Array.isArray((internal as any).connections)
      ? (internal as any).connections
      : [];

    const decorationTypes = new Set(['group-activate', 'group-gate', 'group-proxy', 'group-frame']);
    const materializedIdsInGroup: string[] = [];

    for (const n of internalNodes) {
      const internalId = String((n as any).id ?? '');
      if (!internalId) continue;
      const matId = materializeInternalNodeId(id, internalId);
      const pos = (n as any).position ?? { x: 0, y: 0 };
      const x = baseX + Number(pos?.x ?? 0);
      const y = baseY + Number(pos?.y ?? 0);

      nodeEngine.addNode({
        id: matId,
        type: String((n as any).type ?? ''),
        position: { x, y },
        config: { ...((n as any).config ?? {}) },
        inputValues: { ...((n as any).inputValues ?? {}) },
        outputValues: {},
      } as any);

      const t = String((n as any).type ?? '');
      if (!decorationTypes.has(t)) materializedIdsInGroup.push(matId);
    }

    for (const c of internalConnections) {
      const sourceNodeId = String((c as any).sourceNodeId ?? '');
      const sourcePortId = String((c as any).sourcePortId ?? '');
      const targetNodeId = String((c as any).targetNodeId ?? '');
      const targetPortId = String((c as any).targetPortId ?? '');
      if (!sourceNodeId || !sourcePortId || !targetNodeId || !targetPortId) continue;

      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: materializeInternalNodeId(id, sourceNodeId),
        sourcePortId,
        targetNodeId: materializeInternalNodeId(id, targetNodeId),
        targetPortId,
      } as any);
    }

    const prevGroups = get(groupController.nodeGroups) ?? [];
    const parentId = deepestGroupIdContainingNode(id, prevGroups);

    groupController.setGroups([
      ...(prevGroups ?? []),
      {
        id: groupId,
        parentId: parentId ? String(parentId) : null,
        name: String(def.name ?? 'Custom Node'),
        nodeIds: materializedIdsInGroup,
        disabled: !state.manualGate,
        minimized: false,
      },
    ] as any);

    groupPortNodesController.ensureGroupPortNodes();
    groupPortNodesController.scheduleAlign();

    // Rewire external connections from the collapsed Custom Node ports to the group boundary proxy nodes.
    const graph = nodeEngine.exportGraph();
    const allConnections = Array.isArray(graph.connections) ? graph.connections : [];

    const portByKey = new Map(
      (def.ports ?? []).map((p: any) => [String(p.portKey ?? ''), p] as const)
    );

    const removed: any[] = [];
    for (const c of allConnections) {
      const connId = String((c as any).id ?? '');
      if (!connId) continue;
      const src = String((c as any).sourceNodeId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      if (src !== id && tgt !== id) continue;
      removed.push(c);
      nodeEngine.removeConnection(connId);
    }

    const index = buildGroupPortIndex(nodeEngine.exportGraph());
    const gateId = index.get(groupId)?.gateId ? String(index.get(groupId)?.gateId) : '';

    for (const c of removed) {
      const src = String((c as any).sourceNodeId ?? '');
      const srcPort = String((c as any).sourcePortId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      const tgtPort = String((c as any).targetPortId ?? '');

      if (tgt === id && tgtPort === 'gate') {
        if (gateId) {
          nodeEngine.addConnection({
            id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
            sourceNodeId: src,
            sourcePortId: srcPort,
            targetNodeId: gateId,
            targetPortId: 'active',
          } as any);
        }
        continue;
      }

      if (tgt === id) {
        const port = portByKey.get(tgtPort);
        if (!port) continue;
        const boundInternalId = String(port?.binding?.nodeId ?? '');
        const boundPortId = String(port?.binding?.portId ?? '');
        if (!boundInternalId || !boundPortId) continue;
        const proxyNodeId = materializeInternalNodeId(id, boundInternalId);
        nodeEngine.addConnection({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: src,
          sourcePortId: srcPort,
          targetNodeId: proxyNodeId,
          targetPortId: boundPortId,
        } as any);
        continue;
      }

      if (src === id) {
        const port = portByKey.get(srcPort);
        if (!port) continue;
        const boundInternalId = String(port?.binding?.nodeId ?? '');
        const boundPortId = String(port?.binding?.portId ?? '');
        if (!boundInternalId || !boundPortId) continue;
        const proxyNodeId = materializeInternalNodeId(id, boundInternalId);
        nodeEngine.addConnection({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: proxyNodeId,
          sourcePortId: boundPortId,
          targetNodeId: tgt,
          targetPortId: tgtPort,
        } as any);
        continue;
      }
    }

    expandedCustomByGroupId.set(groupId, { groupId, nodeId: id });
    forcedHiddenNodeIds.add(id);
    refreshExpandedCustomGroupIds();

    groupController.scheduleHighlight();
    requestFramesUpdate();
    groupPortNodesController.scheduleNormalizeProxies();
  };

  const handleCollapseCustomNodeFrame = (groupId: string) => {
    const rootGroupId = String(groupId ?? '');
    if (!rootGroupId) return;

    const expanded = expandedCustomByGroupId.get(rootGroupId) ?? null;
    if (!expanded) return;

    const motherNodeId = String(expanded.nodeId ?? '');
    if (!motherNodeId) return;

    const motherNode = nodeEngine.getNode(motherNodeId) as any;
    if (!motherNode) return;

    const motherState = readCustomNodeState(motherNode?.config ?? {});
    if (!motherState || motherState.role !== 'mother') return;

    const def = getCustomNodeDefinition(motherState.definitionId);
    if (!def) return;

    // Ensure boundary proxies are normalized before snapshotting ports.
    groupPortNodesController.scheduleNormalizeProxies();
    groupPortNodesController.ensureGroupPortNodes();
    groupPortNodesController.scheduleAlign();

    const frames = get(groupFrames) ?? [];
    const frame = frames.find((f: any) => String(f?.group?.id ?? '') === rootGroupId) ?? null;
    const originX = frame ? Number(frame.left ?? 0) : Number(motherNode.position?.x ?? 0);
    const originY = frame ? Number(frame.top ?? 0) : Number(motherNode.position?.y ?? 0);

    const graph = nodeEngine.exportGraph();
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const connections = Array.isArray(graph.connections) ? graph.connections : [];
    const nodeById = new Map(nodes.map((n: any) => [String(n.id), n] as const));

    const groupsSnapshot = get(groupController.nodeGroups) ?? [];
    const subtreeGroupIds = new Set<string>();
    const stack = [rootGroupId];
    while (stack.length > 0) {
      const gid = String(stack.pop() ?? '');
      if (!gid || subtreeGroupIds.has(gid)) continue;
      subtreeGroupIds.add(gid);
      for (const g of groupsSnapshot) {
        if (String(g?.parentId ?? '') !== gid) continue;
        stack.push(String(g?.id ?? ''));
      }
    }

    const nodeIdsInSubtree = new Set<string>();
    for (const g of groupsSnapshot) {
      const gid = String(g?.id ?? '');
      if (!gid || !subtreeGroupIds.has(gid)) continue;
      for (const nid of g?.nodeIds ?? []) nodeIdsInSubtree.add(String(nid));
    }

    for (const n of nodes) {
      const type = String((n as any).type ?? '');
      if (!isGroupPortNodeType(type) && type !== 'group-frame') continue;
      const gid = groupIdFromNode(n as any);
      if (!gid || !subtreeGroupIds.has(String(gid))) continue;
      nodeIdsInSubtree.add(String((n as any).id ?? ''));
    }

    const internalNodeIdsForTemplate = new Set<string>();
    for (const id of nodeIdsInSubtree) {
      const node = nodeById.get(String(id)) as any;
      if (!node) continue;
      const type = String(node.type ?? '');
      if (type === 'group-gate' || type === 'group-frame' || type === 'group-activate') continue;
      internalNodeIdsForTemplate.add(String(id));
    }

    const internalIdForMain = (mainId: string): string => {
      return isMaterializedInternalNodeId(motherNodeId, mainId)
        ? internalNodeIdFromMaterialized(motherNodeId, mainId)
        : String(mainId);
    };

    const packedNodes: any[] = [];
    for (const id of internalNodeIdsForTemplate) {
      const node = nodeById.get(String(id)) as any;
      if (!node) continue;
      const internalId = internalIdForMain(String(id));
      const pos = node.position ?? { x: 0, y: 0 };
      packedNodes.push({
        ...node,
        id: internalId,
        position: { x: Number(pos?.x ?? 0) - originX, y: Number(pos?.y ?? 0) - originY },
        outputValues: {},
      });
    }

    const packedNodeIdSet = new Set(packedNodes.map((n) => String(n.id)));
    const packedConnections: any[] = connections
      .filter(
        (c: any) =>
          internalNodeIdsForTemplate.has(String(c.sourceNodeId)) &&
          internalNodeIdsForTemplate.has(String(c.targetNodeId)) &&
          Boolean(String(c.sourcePortId ?? '')) &&
          Boolean(String(c.targetPortId ?? ''))
      )
      .map((c: any) => ({
        ...c,
        sourceNodeId: internalIdForMain(String(c.sourceNodeId)),
        targetNodeId: internalIdForMain(String(c.targetNodeId)),
      }));

    // Derive Custom Node ports from root-level group-proxy nodes.
    const resolvePortLabel = (
      nodeType: string,
      side: 'input' | 'output',
      portId: string
    ): string => {
      const def = nodeRegistry.get(String(nodeType ?? ''));
      const ports = side === 'input' ? def?.inputs : def?.outputs;
      const port = (ports ?? []).find((p: any) => String(p.id) === String(portId)) ?? null;
      return String((port as any)?.label ?? portId);
    };

    const validPortTypes = new Set([
      'number',
      'boolean',
      'string',
      'asset',
      'color',
      'audio',
      'image',
      'video',
      'scene',
      'effect',
      'client',
      'command',
      'fuzzy',
      'array',
      'any',
    ]);

    const ports: any[] = [];
    const rootProxyNodes = nodes.filter((n: any) => {
      if (String((n as any).type ?? '') !== 'group-proxy') return false;
      const gid = groupIdFromNode(n as any);
      return String(gid ?? '') === rootGroupId;
    });

    for (const proxy of rootProxyNodes) {
      const proxyMainId = String((proxy as any).id ?? '');
      if (!proxyMainId) continue;
      if (
        !internalNodeIdsForTemplate.has(proxyMainId) &&
        !isMaterializedInternalNodeId(motherNodeId, proxyMainId)
      ) {
        // It should still be removed as a group decoration node, but won't be part of the template.
      }

      const internalProxyId = internalIdForMain(proxyMainId);
      const directionRaw = String(((proxy as any).config as any)?.direction ?? 'output');
      const side: 'input' | 'output' = directionRaw === 'input' ? 'input' : 'output';
      const bindingPortId = side === 'input' ? 'in' : 'out';
      const portKey = `p:${internalProxyId}`;

      const portTypeRaw = String(((proxy as any).config as any)?.portType ?? 'any');
      const type = validPortTypes.has(portTypeRaw) ? portTypeRaw : 'any';
      const pinned = Boolean(((proxy as any).config as any)?.pinned);

      const pos = (proxy as any).position ?? { x: 0, y: 0 };
      const y = Number(pos?.y ?? 0) - originY;

      const label = (() => {
        if (side === 'input') {
          const inner = packedConnections.find(
            (c: any) =>
              String(c.sourceNodeId) === internalProxyId && String(c.sourcePortId) === 'out'
          );
          if (!inner) return 'In';
          const targetNode = packedNodes.find((n) => String(n.id) === String(inner.targetNodeId));
          if (!targetNode) return String(inner.targetPortId ?? 'In');
          return resolvePortLabel(
            String((targetNode as any).type),
            'input',
            String(inner.targetPortId)
          );
        }
        const inner = packedConnections.find(
          (c: any) => String(c.targetNodeId) === internalProxyId && String(c.targetPortId) === 'in'
        );
        if (!inner) return 'Out';
        const sourceNode = packedNodes.find((n) => String(n.id) === String(inner.sourceNodeId));
        if (!sourceNode) return String(inner.sourcePortId ?? 'Out');
        return resolvePortLabel(
          String((sourceNode as any).type),
          'output',
          String(inner.sourcePortId)
        );
      })();

      ports.push({
        portKey,
        side,
        label,
        type,
        pinned,
        y: Number.isFinite(y) ? y : 0,
        binding: { nodeId: internalProxyId, portId: bindingPortId },
      });
    }

    // Capture external wiring from boundary proxies (so we can reconnect to collapsed Custom Node ports).
    const mainInternalNodeIdSet = new Set<string>();
    for (const id of internalNodeIdsForTemplate) mainInternalNodeIdSet.add(String(id));
    for (const n of rootProxyNodes) {
      const id = String((n as any).id ?? '');
      if (id) mainInternalNodeIdSet.add(id);
    }

    const proxyPortKeyByMainId = new Map<string, string>();
    for (const n of rootProxyNodes) {
      const pid = String((n as any).id ?? '');
      if (!pid) continue;
      const internalProxyId = internalIdForMain(pid);
      proxyPortKeyByMainId.set(pid, `p:${internalProxyId}`);
    }

    const externalInputs: any[] = [];
    const externalOutputs: any[] = [];

    for (const c of connections) {
      const connId = String((c as any).id ?? '');
      const src = String((c as any).sourceNodeId ?? '');
      const srcPort = String((c as any).sourcePortId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      const tgtPort = String((c as any).targetPortId ?? '');
      if (!connId || !src || !srcPort || !tgt || !tgtPort) continue;

      const portKey = proxyPortKeyByMainId.get(tgt);
      if (portKey && tgtPort === 'in' && !mainInternalNodeIdSet.has(src)) {
        externalInputs.push({ sourceNodeId: src, sourcePortId: srcPort, portKey });
        continue;
      }

      const outKey = proxyPortKeyByMainId.get(src);
      if (outKey && srcPort === 'out' && !mainInternalNodeIdSet.has(tgt)) {
        externalOutputs.push({ targetNodeId: tgt, targetPortId: tgtPort, portKey: outKey });
        continue;
      }
    }

    const gateNodeId =
      nodes.find(
        (n: any) =>
          String((n as any).type ?? '') === 'group-gate' &&
          String(((n as any).config as any)?.groupId ?? '') === rootGroupId
      )?.id ?? '';

    const gateConn = (() => {
      if (!gateNodeId) return null;
      const c = connections.find(
        (c: any) =>
          String((c as any).targetNodeId ?? '') === String(gateNodeId) &&
          String((c as any).targetPortId ?? '') === 'active' &&
          !mainInternalNodeIdSet.has(String((c as any).sourceNodeId ?? ''))
      );
      return c
        ? {
            sourceNodeId: String((c as any).sourceNodeId),
            sourcePortId: String((c as any).sourcePortId),
          }
        : null;
    })();

    // Update definition + mother internal state; children sync happens in Phase 2.5.7.
    const nextDefinition = {
      ...def,
      name: String(
        groupsSnapshot.find((g: any) => String(g?.id ?? '') === rootGroupId)?.name ??
          def.name ??
          def.name
      ),
      template: { nodes: packedNodes as any, connections: packedConnections as any },
      ports,
    } as any;

    {
      const defs = get(customNodeDefinitions) ?? [];
      const nextDefs = defs.map((d: any) =>
        String(d?.definitionId ?? '') === String(nextDefinition.definitionId) ? nextDefinition : d
      );
      const inCycle = definitionsInCycles(nextDefs as any);
      if (inCycle.size > 0) {
        const ids = Array.from(inCycle).map(String).filter(Boolean);
        const msg = `Cyclic Custom Node nesting is not allowed.\n\nCycle detected: ${ids.join(' → ')}`;
        nodeEngine.lastError?.set?.(msg);
        alert(msg);
        return;
      }
    }
    upsertCustomNodeDefinition(nextDefinition);

    nodeEngine.updateNodePosition(motherNodeId, { x: originX, y: originY });
    nodeEngine.updateNodeConfig(
      motherNodeId,
      writeCustomNodeState(motherNode?.config ?? {}, {
        ...motherState,
        manualGate: !groupsSnapshot.find((g: any) => String(g?.id ?? '') === rootGroupId)?.disabled,
        internal: { nodes: packedNodes as any, connections: packedConnections as any },
      } as any)
    );
    nodeEngine.updateNodeInputValue(
      motherNodeId,
      'gate',
      !groupsSnapshot.find((g: any) => String(g?.id ?? '') === rootGroupId)?.disabled
    );

    syncCoupledCustomNodesForDefinition(nextDefinition.definitionId);

    // Remove the expanded frame group subtree.
    groupController.setGroups(
      (groupsSnapshot ?? []).filter((g: any) => !subtreeGroupIds.has(String(g?.id ?? ''))) as any
    );

    // Remove all materialized/internal nodes + group decoration nodes for this subtree.
    for (const id of Array.from(nodeIdsInSubtree)) {
      if (!id) continue;
      if (id === motherNodeId) continue;
      nodeEngine.removeNode(String(id));
    }

    // Reconnect external wiring back to the collapsed Custom Node ports.
    for (const entry of externalInputs) {
      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: entry.sourceNodeId,
        sourcePortId: entry.sourcePortId,
        targetNodeId: motherNodeId,
        targetPortId: entry.portKey,
      } as any);
    }
    for (const entry of externalOutputs) {
      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: motherNodeId,
        sourcePortId: entry.portKey,
        targetNodeId: entry.targetNodeId,
        targetPortId: entry.targetPortId,
      } as any);
    }
    if (gateConn) {
      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: gateConn.sourceNodeId,
        sourcePortId: gateConn.sourcePortId,
        targetNodeId: motherNodeId,
        targetPortId: 'gate',
      } as any);
    }

    expandedCustomByGroupId.delete(rootGroupId);
    forcedHiddenNodeIds.delete(motherNodeId);
    refreshExpandedCustomGroupIds();

    groupController.scheduleHighlight();
    requestFramesUpdate();
    groupPortNodesController.scheduleNormalizeProxies();
  };

  const syncCoupledCustomNodesForDefinition = (definitionId: string) => {
    const id = String(definitionId ?? '');
    if (!id) return;

    const def = getCustomNodeDefinition(id);
    if (!def) return;

    const graph = nodeEngine.exportGraph();
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const connections = Array.isArray(graph.connections) ? graph.connections : [];

    const type = customNodeType(id);
    const instanceNodeIds = new Set<string>();
    for (const node of nodes) {
      if (String((node as any).type ?? '') !== type) continue;
      instanceNodeIds.add(String((node as any).id ?? ''));
    }

    const validPortIds = new Set<string>([
      'gate',
      ...(def.ports ?? []).map((p: any) => String(p?.portKey ?? '')).filter(Boolean),
    ]);

    for (const c of connections) {
      const connId = String((c as any).id ?? '');
      if (!connId) continue;

      const sourceNodeId = String((c as any).sourceNodeId ?? '');
      const sourcePortId = String((c as any).sourcePortId ?? '');
      const targetNodeId = String((c as any).targetNodeId ?? '');
      const targetPortId = String((c as any).targetPortId ?? '');

      const invalidSource = instanceNodeIds.has(sourceNodeId) && !validPortIds.has(sourcePortId);
      const invalidTarget = instanceNodeIds.has(targetNodeId) && !validPortIds.has(targetPortId);
      if (invalidSource || invalidTarget) nodeEngine.removeConnection(connId);
    }

    for (const nodeId of instanceNodeIds) {
      const node = nodeEngine.getNode(String(nodeId)) as any;
      if (!node) continue;
      const state = readCustomNodeState(node.config ?? {});
      if (!state || state.role !== 'child') continue;

      const nextInternal = syncCustomNodeInternalGraph({
        current: state.internal,
        template: def.template,
        instanceGroupId: state.groupId,
      });

      nodeEngine.updateNodeConfig(
        nodeId,
        writeCustomNodeState(node.config ?? {}, { ...state, internal: nextInternal } as any)
      );
    }

    // Also sync nested occurrences inside other Custom Node instances' internal graphs.
    for (const node of nodes) {
      const nodeId = String((node as any).id ?? '');
      if (!nodeId) continue;
      const instance = nodeEngine.getNode(nodeId) as any;
      if (!instance) continue;
      const state = readCustomNodeState(instance.config ?? {});
      if (!state) continue;

      const nested = syncNestedCustomNodesToDefinition({
        graph: state.internal,
        definitionId: id,
        definitionTemplate: def.template,
      });
      if (!nested.changed) continue;

      nodeEngine.updateNodeConfig(
        nodeId,
        writeCustomNodeState(instance.config ?? {}, { ...state, internal: nested.graph } as any)
      );
    }
  };

  const handleToggleGroupDisabled = (groupId: string) => {
    const id = String(groupId ?? '');
    if (!id) return;
    groupController.toggleGroupDisabled(id);

    const expanded = expandedCustomByGroupId.get(id) ?? null;
    if (!expanded) return;
    const nodeId = String(expanded.nodeId ?? '');
    const node = nodeId ? (nodeEngine.getNode(nodeId) as any) : null;
    const state = node ? readCustomNodeState(node.config ?? {}) : null;
    if (!node || !state) return;

    const group =
      get(groupController.nodeGroups).find((g: any) => String(g?.id ?? '') === id) ?? null;
    const manualGate = group ? !(group as any).disabled : state.manualGate;
    nodeEngine.updateNodeConfig(
      nodeId,
      writeCustomNodeState(node.config ?? {}, { ...state, manualGate } as any)
    );
    nodeEngine.updateNodeInputValue(nodeId, 'gate', manualGate);
  };

  const handleRenameGroup = (groupId: string, name: string) => {
    const id = String(groupId ?? '');
    const nextName = String(name ?? '').trim();
    if (!id || !nextName) return;

    const expanded = expandedCustomByGroupId.get(id) ?? null;
    if (expanded) {
      const node = nodeEngine.getNode(String(expanded.nodeId ?? '')) as any;
      const state = node ? readCustomNodeState(node.config ?? {}) : null;
      const def = state ? getCustomNodeDefinition(state.definitionId) : null;
      if (def) upsertCustomNodeDefinition({ ...def, name: nextName } as any);
    }

    groupController.renameGroup(id, nextName);
  };

  const syncCustomGateInputs = (state: GraphState) => {
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const connections = Array.isArray(state.connections) ? state.connections : [];
    if (nodes.length === 0) return;

    const connectedGateIds = new Set<string>();
    for (const c of connections) {
      if (String((c as any).targetPortId ?? '') !== 'gate') continue;
      connectedGateIds.add(String((c as any).targetNodeId ?? ''));
    }

    for (const node of nodes) {
      const nodeId = String((node as any).id ?? '');
      if (!nodeId) continue;
      if (!String((node as any).type ?? '').startsWith(CUSTOM_NODE_TYPE_PREFIX)) continue;
      if (connectedGateIds.has(nodeId)) continue;
      const state = readCustomNodeState((node as any).config ?? {});
      if (!state) continue;
      const desired = Boolean(state.manualGate);
      const current = (node as any).inputValues?.gate;
      if (current === desired) continue;
      nodeEngine.updateNodeInputValue(nodeId, 'gate', desired);
    }
  };

  const handleNodalizeGroup = (groupId: string) => {
    const rootId = String(groupId ?? '');
    if (!rootId) return;

    const groupsSnapshot = get(groupController.nodeGroups);
    const group = groupsSnapshot.find((g) => String(g.id) === rootId) ?? null;
    if (!group) return;

    const ok = confirm(
      `Nodalize "${String(group.name ?? 'Group')}"?\n\nThis will replace the Group with a real Custom Node (mother instance).`
    );
    if (!ok) return;

    // Ensure the latest group port nodes exist before snapshotting proxies.
    groupPortNodesController.ensureGroupPortNodes();

    const state = nodeEngine.exportGraph();
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const connections = Array.isArray(state.connections) ? state.connections : [];

    // Collect subtree group ids so we can remove all group metadata + port nodes.
    const subtreeGroupIds = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const current = String(stack.pop() ?? '');
      if (!current || subtreeGroupIds.has(current)) continue;
      subtreeGroupIds.add(current);
      for (const g of groupsSnapshot) {
        if (String(g.parentId ?? '') !== current) continue;
        stack.push(String(g.id));
      }
    }

    const portIndex = buildGroupPortIndex(state);

    const toRemove = new Set<string>();
    const groupById = new Map(groupsSnapshot.map((g) => [String(g.id), g] as const));
    for (const gid of subtreeGroupIds) {
      const g = groupById.get(String(gid));
      if (!g) continue;
      for (const nodeId of g.nodeIds ?? []) toRemove.add(String(nodeId));
    }

    // Also remove group port nodes (gate/proxy/legacy activate) for the whole subtree.
    for (const gid of subtreeGroupIds) {
      const entry = portIndex.get(String(gid));
      if (!entry) continue;
      if (entry.gateId) toRemove.add(String(entry.gateId));
      for (const id of entry.proxyIds ?? []) toRemove.add(String(id));
      for (const id of entry.legacyActivateIds ?? []) toRemove.add(String(id));
    }

    // Remove group-frame nodes (minimized UI) for the subtree.
    for (const node of nodes) {
      if (String(node.type) !== 'group-frame') continue;
      const gid = groupIdFromNode(node as any);
      if (!gid || !subtreeGroupIds.has(String(gid))) continue;
      toRemove.add(String(node.id));
    }

    // Template includes all nodes we remove except group frames + group gate/activate nodes (editor affordances).
    const excludedTypes = new Set(['group-frame', 'group-gate', 'group-activate']);
    const templateNodeIds = new Set<string>();
    for (const nodeId of Array.from(toRemove)) {
      const node = nodes.find((n) => String(n.id) === String(nodeId)) as any;
      if (!node) continue;
      if (excludedTypes.has(String(node.type))) continue;
      templateNodeIds.add(String(nodeId));
    }

    const frame =
      (get(groupFrames) ?? []).find((f: any) => String(f?.group?.id ?? '') === rootId) ?? null;
    const originX = frame ? Number(frame.left ?? 0) : 0;
    const originY = frame ? Number(frame.top ?? 0) : 0;

    const nodeById = new Map(nodes.map((n: any) => [String(n.id), n]));

    const positionFor = (nodeId: string) => {
      const viewPos = viewAdapter.getNodePosition(String(nodeId));
      if (viewPos && Number.isFinite(viewPos.x) && Number.isFinite(viewPos.y)) return viewPos;
      const instance = nodeById.get(String(nodeId));
      return instance?.position ?? { x: originX, y: originY };
    };

    const templateNodes = Array.from(templateNodeIds)
      .map((id) => {
        const node = nodeById.get(String(id)) as any;
        if (!node) return null;
        const pos = positionFor(String(id));
        return {
          ...node,
          position: { x: Number(pos.x) - originX, y: Number(pos.y) - originY },
          outputValues: {},
        };
      })
      .filter(Boolean) as any[];

    const templateConnections = connections.filter(
      (c: any) =>
        templateNodeIds.has(String(c.sourceNodeId)) &&
        templateNodeIds.has(String(c.targetNodeId)) &&
        Boolean(String(c.sourcePortId ?? '')) &&
        Boolean(String(c.targetPortId ?? ''))
    );

    const resolvePortLabel = (
      nodeType: string,
      side: 'input' | 'output',
      portId: string
    ): string => {
      const def = nodeRegistry.get(String(nodeType ?? ''));
      const ports = side === 'input' ? def?.inputs : def?.outputs;
      const port = (ports ?? []).find((p) => String(p.id) === String(portId)) ?? null;
      return String(port?.label ?? portId);
    };

    // Build Custom Node ports from the root group's boundary proxy nodes.
    const rootEntry = portIndex.get(rootId) ?? { legacyActivateIds: [], proxyIds: [] };
    const portKeyByProxyId = new Map<string, string>();

    const ports = (rootEntry.proxyIds ?? [])
      .map((proxyId) => {
        const id = String(proxyId ?? '');
        if (!id) return null;
        const node = nodeById.get(id) as any;
        if (!node || String(node.type) !== 'group-proxy') return null;

        const directionRaw = String(node?.config?.direction ?? 'output');
        const side: 'input' | 'output' = directionRaw === 'input' ? 'input' : 'output';
        const bindingPortId = side === 'input' ? 'in' : 'out';
        const portKey = `p:${id}`;
        portKeyByProxyId.set(id, portKey);

        const portTypeRaw = String(node?.config?.portType ?? 'any');
        const type = portTypeRaw ? portTypeRaw : 'any';
        const pinned = Boolean(node?.config?.pinned);

        const pos = positionFor(id);
        const y = Number(pos.y) - originY;

        const label = (() => {
          if (side === 'input') {
            const inner = connections.find(
              (c: any) => String(c.sourceNodeId) === id && String(c.sourcePortId) === 'out'
            );
            if (!inner) return 'In';
            const targetNode = nodeById.get(String(inner.targetNodeId));
            if (!targetNode) return String(inner.targetPortId ?? 'In');
            return resolvePortLabel(
              String((targetNode as any).type),
              'input',
              String(inner.targetPortId)
            );
          }
          const inner = connections.find(
            (c: any) => String(c.targetNodeId) === id && String(c.targetPortId) === 'in'
          );
          if (!inner) return 'Out';
          const sourceNode = nodeById.get(String(inner.sourceNodeId));
          if (!sourceNode) return String(inner.sourcePortId ?? 'Out');
          return resolvePortLabel(
            String((sourceNode as any).type),
            'output',
            String(inner.sourcePortId)
          );
        })();

        return {
          portKey,
          side,
          label,
          type,
          pinned,
          y: Number.isFinite(y) ? y : 0,
          binding: { nodeId: id, portId: bindingPortId },
        };
      })
      .filter(Boolean) as any[];

    // Capture external wiring so we can reconnect it to the new Custom Node ports.
    const externalConnections: any[] = [];

    const isRemoved = (nodeId: string) => toRemove.has(String(nodeId));

    for (const proxyId of rootEntry.proxyIds ?? []) {
      const id = String(proxyId ?? '');
      if (!id) continue;
      const node = nodeById.get(id) as any;
      if (!node || String(node.type) !== 'group-proxy') continue;

      const portKey = portKeyByProxyId.get(id);
      if (!portKey) continue;

      const directionRaw = String(node?.config?.direction ?? 'output');
      if (directionRaw === 'input') {
        const incoming = connections.find(
          (c: any) =>
            String(c.targetNodeId) === id &&
            String(c.targetPortId) === 'in' &&
            !isRemoved(String(c.sourceNodeId))
        );
        if (incoming) {
          externalConnections.push({
            sourceNodeId: String(incoming.sourceNodeId),
            sourcePortId: String(incoming.sourcePortId),
            targetPortId: portKey,
            kind: 'input',
          });
        }
      } else {
        for (const c of connections) {
          if (String(c.sourceNodeId) !== id) continue;
          if (String(c.sourcePortId) !== 'out') continue;
          if (isRemoved(String(c.targetNodeId))) continue;
          externalConnections.push({
            targetNodeId: String(c.targetNodeId),
            targetPortId: String(c.targetPortId),
            sourcePortId: portKey,
            kind: 'output',
          });
        }
      }
    }

    const gateConn = (() => {
      const gateId = rootEntry.gateId ? String(rootEntry.gateId) : '';
      if (!gateId) return null;
      const c = connections.find(
        (c: any) =>
          String(c.targetNodeId) === gateId &&
          String(c.targetPortId) === 'active' &&
          !isRemoved(String(c.sourceNodeId))
      );
      return c
        ? { sourceNodeId: String(c.sourceNodeId), sourcePortId: String(c.sourcePortId) }
        : null;
    })();

    const definitionId = crypto.randomUUID?.() ?? `${Date.now()}`;
    addCustomNodeDefinition({
      definitionId,
      name: String(group.name ?? 'Group'),
      template: { nodes: templateNodes as any, connections: templateConnections as any },
      ports,
    } as any);

    // Remove group metadata first so the frame disappears immediately.
    groupController.disassembleGroup(rootId);

    // Remove all nodes in the group subtree (including boundary proxies).
    for (const id of Array.from(toRemove)) {
      if (!id) continue;
      nodeEngine.removeNode(String(id));
    }

    const motherNodeId = generateId();
    const motherType = customNodeType(definitionId);
    const motherPos = frame ? { x: originX, y: originY } : { x: originX, y: originY };

    const motherInternal = {
      nodes: (templateNodes ?? []).map((n: any) => ({ ...n, outputValues: {} })),
      connections: (templateConnections ?? []).map((c: any) => ({ ...c })),
    };

    const initialGate = !group.disabled;
    const motherConfig = writeCustomNodeState({}, {
      definitionId,
      groupId: rootId,
      role: 'mother',
      manualGate: initialGate,
      internal: motherInternal as any,
    } as any);

    nodeEngine.addNode({
      id: motherNodeId,
      type: motherType,
      position: motherPos,
      config: motherConfig,
      inputValues: { gate: initialGate },
      outputValues: {},
    } as any);

    // Reconnect gate input (wiredGateInput) if present.
    if (gateConn) {
      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: gateConn.sourceNodeId,
        sourcePortId: gateConn.sourcePortId,
        targetNodeId: motherNodeId,
        targetPortId: 'gate',
      });
    }

    // Reconnect proxy ports.
    for (const entry of externalConnections) {
      if (entry.kind === 'input') {
        nodeEngine.addConnection({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: entry.sourceNodeId,
          sourcePortId: entry.sourcePortId,
          targetNodeId: motherNodeId,
          targetPortId: entry.targetPortId,
        });
      } else {
        nodeEngine.addConnection({
          id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
          sourceNodeId: motherNodeId,
          sourcePortId: entry.sourcePortId,
          targetNodeId: entry.targetNodeId,
          targetPortId: entry.targetPortId,
        });
      }
    }

    setSelectedNode(motherNodeId);
  };

  const handleUncoupleCustomNode = (nodeId: string) => {
    const id = String(nodeId ?? '');
    if (!id) return;

    const node = nodeEngine.getNode(id);
    if (!node) return;

    const state = readCustomNodeState((node as any)?.config ?? {});
    if (!state || state.role !== 'child') return;

    const baseDef = getCustomNodeDefinition(state.definitionId);
    if (!baseDef) return;

    const ok = confirm(
      `Uncouple "${String(baseDef.name ?? 'Custom Node')}"?\n\nThis will fork a new Custom Node definition and turn this instance into the mother.`
    );
    if (!ok) return;

    const definitionId = crypto.randomUUID?.() ?? `${Date.now()}`;
    const name = `${String(baseDef.name ?? 'Custom Node')} (Uncoupled)`;

    const template: GraphState = {
      nodes: (state.internal?.nodes ?? []).map((n: any) => ({ ...n, outputValues: {} })),
      connections: (state.internal?.connections ?? []).map((c: any) => ({ ...c })),
    };

    const ports = (baseDef.ports ?? []).map((p: any) => ({
      ...p,
      binding: { ...p.binding },
    }));

    addCustomNodeDefinition({
      definitionId,
      name,
      template,
      ports,
    } as any);

    nodeEngine.updateNodeType(id, customNodeType(definitionId));
    nodeEngine.updateNodeConfig(
      id,
      writeCustomNodeState((node as any)?.config ?? {}, {
        ...state,
        definitionId,
        role: 'mother',
      } as any)
    );
    nodeEngine.updateNodeInputValue(id, 'gate', state.manualGate);
  };

  const handleDenodalizeGroup = (groupId: string) => {
    const id = String(groupId ?? '');
    if (!id) return;

    const expanded = expandedCustomByGroupId.get(id) ?? null;
    if (!expanded) return;

    const motherNodeId = String(expanded.nodeId ?? '');
    if (!motherNodeId) return;

    const motherNode = nodeEngine.getNode(motherNodeId) as any;
    if (!motherNode) return;

    const state = readCustomNodeState(motherNode?.config ?? {});
    if (!state || state.role !== 'mother') return;

    const def = getCustomNodeDefinition(state.definitionId);
    const name = String(def?.name ?? 'Custom Node');

    const graph = nodeEngine.exportGraph();
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const connections = Array.isArray(graph.connections) ? graph.connections : [];

    const ok = confirm(
      `Denodalize "${name}"?\n\nThis will remove the Custom Node (all instances) and restore a normal Group frame. Internal nodes will remain as regular nodes.`
    );
    if (!ok) return;

    const instanceNodes = nodes
      .map((n: any) => ({ id: String(n.id ?? ''), state: readCustomNodeState((n as any)?.config ?? {}) }))
      .filter((n: any) => n.id && n.state && String(n.state.definitionId) === String(state.definitionId));
    const instanceIds = instanceNodes.map((n: any) => String(n.id));
    const motherInstances = instanceNodes.filter((n: any) => n.state?.role === 'mother');

    for (const inst of motherInstances) {
      const gid = String(inst.state?.groupId ?? '');
      if (!gid || gid === id) continue;
      if (expandedCustomByGroupId.has(gid)) {
        expandedCustomByGroupId.delete(gid);
        forcedHiddenNodeIds.delete(String(inst.id ?? ''));
      }
      groupPortNodesController.disassembleGroupAndPorts(gid);

      const prefixOther = `cn:${String(inst.id ?? '')}:`;
      for (const n of nodes) {
        const nid = String((n as any)?.id ?? '');
        if (nid.startsWith(prefixOther)) nodeEngine.removeNode(nid);
      }
    }

    const prefix = `cn:${motherNodeId}:`;
    const materialized = nodes.filter((n: any) => String(n?.id ?? '').startsWith(prefix));

    const idMap = new Map<string, string>();
    for (const node of materialized) {
      const oldId = String(node.id ?? '');
      const newId = generateId();
      idMap.set(oldId, newId);
      nodeEngine.addNode({
        ...node,
        id: newId,
        config: { ...(node as any).config },
        inputValues: { ...((node as any).inputValues ?? {}) },
        outputValues: {},
      } as any);
    }

    for (const c of connections) {
      const connId = String((c as any)?.id ?? '');
      if (!connId) continue;
      const src = String((c as any).sourceNodeId ?? '');
      const tgt = String((c as any).targetNodeId ?? '');
      const nextSrc = idMap.get(src) ?? src;
      const nextTgt = idMap.get(tgt) ?? tgt;
      if (nextSrc === src && nextTgt === tgt) continue;
      nodeEngine.removeConnection(connId);
      nodeEngine.addConnection({
        id: `conn-${crypto.randomUUID?.() ?? Date.now()}`,
        sourceNodeId: nextSrc,
        sourcePortId: String((c as any).sourcePortId ?? ''),
        targetNodeId: nextTgt,
        targetPortId: String((c as any).targetPortId ?? ''),
      } as any);
    }

    const groups = get(groupController.nodeGroups) ?? [];
    const nextGroups = groups.map((g: any) => {
      if (String(g?.id ?? '') !== id) return g;
      const nextNodeIds = (g.nodeIds ?? []).map((nid: any) => idMap.get(String(nid)) ?? String(nid));
      return { ...g, nodeIds: nextNodeIds };
    });
    groupController.setGroups(nextGroups as any);

    for (const oldId of idMap.keys()) {
      nodeEngine.removeNode(oldId);
    }

    for (const instId of instanceIds) {
      nodeEngine.removeNode(instId);
    }

    removeCustomNodeDefinition(state.definitionId);

    expandedCustomByGroupId.delete(id);
    forcedHiddenNodeIds.delete(motherNodeId);
    refreshExpandedCustomGroupIds();

    groupController.scheduleHighlight();
    requestFramesUpdate();
    groupPortNodesController.scheduleNormalizeProxies();
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

  const findGroupGateTargetAt = (clientX: number, clientY: number): { groupId: string } | null => {
    const frames = get(groupFrames) ?? [];
    if (frames.length === 0) return null;

    const pos = viewAdapter.clientToGraph(clientX, clientY);
    const k = Number(canvasTransform?.k ?? 1) || 1;
    const radius = 22 / k;

    let best: { groupId: string; dist: number; depth: number; area: number } | null = null;

    for (const frame of frames) {
      const groupId = String(frame?.group?.id ?? '');
      if (!groupId) continue;
      const left = Number(frame.left ?? 0);
      const top = Number(frame.top ?? 0);
      const width = Number(frame.width ?? 0);
      const height = Number(frame.height ?? 0);
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      )
        continue;

      // Must stay in sync with Group Gate node placement offsets in `group-port-nodes-controller.ts`.
      const isMinimized = Boolean((frame as any)?.group?.minimized);
      const gateCenterX = left + (isMinimized ? 12 : 18) + 7;
      const gateCenterY = top + 12 + 4 + 7;
      const dx = pos.x - gateCenterX;
      const dy = pos.y - gateCenterY;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;

      const depth = Number(frame.depth ?? 0) || 0;
      const area = Math.max(0, width) * Math.max(0, height);

      if (
        !best ||
        dist < best.dist - 0.001 ||
        (Math.abs(dist - best.dist) <= 0.001 &&
          (depth > best.depth || (depth === best.depth && area < best.area)))
      ) {
        best = { groupId, dist, depth, area };
      }
    }

    return best ? { groupId: best.groupId } : null;
  };

  const findGroupProxyEdgeTargetAt = (
    clientX: number,
    clientY: number
  ): { groupId: string; side: 'input' | 'output'; frame: any } | null => {
    const frames = get(groupFrames) ?? [];
    if (frames.length === 0) return null;

    const pos = viewAdapter.clientToGraph(clientX, clientY);
    const k = Number(canvasTransform?.k ?? 1) || 1;
    const threshold = 18 / k;
    const yMargin = 14 / k;

    let best: {
      groupId: string;
      side: 'input' | 'output';
      dist: number;
      depth: number;
      area: number;
      frame: any;
    } | null = null;

    for (const frame of frames) {
      const groupId = String(frame?.group?.id ?? '');
      if (!groupId) continue;
      const left = Number(frame.left ?? 0);
      const top = Number(frame.top ?? 0);
      const width = Number(frame.width ?? 0);
      const height = Number(frame.height ?? 0);
      const right = left + width;
      const bottom = top + height;

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(right) ||
        !Number.isFinite(bottom)
      )
        continue;

      if (pos.y < top - yMargin || pos.y > bottom + yMargin) continue;

      const dl = Math.abs(pos.x - left);
      const dr = Math.abs(pos.x - right);
      if (dl > threshold && dr > threshold) continue;

      const side: 'input' | 'output' = dl <= dr ? 'input' : 'output';
      const dist = side === 'input' ? dl : dr;
      const depth = Number(frame.depth ?? 0) || 0;
      const area = Math.max(0, width) * Math.max(0, height);

      if (
        !best ||
        dist < best.dist - 0.001 ||
        (Math.abs(dist - best.dist) <= 0.001 &&
          (depth > best.depth || (depth === best.depth && area < best.area)))
      ) {
        best = { groupId, side, dist, depth, area, frame };
      }
    }

    return best ? { groupId: best.groupId, side: best.side, frame: best.frame } : null;
  };

  function addNode(
    type: string,
    position?: { x: number; y: number },
    configPatch?: Record<string, unknown>
  ) {
    const fallback = { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };

    if (String(type).startsWith(CUSTOM_NODE_TYPE_PREFIX)) {
      const definitionId = String(type).slice(CUSTOM_NODE_TYPE_PREFIX.length);
      const def = getCustomNodeDefinition(definitionId);
      if (!def) return;

      // Prevent cyclic nesting when creating custom nodes inside an expanded mother definition.
      if (position) {
        const frames = get(groupFrames) ?? [];
        let host: { groupId: string; nodeId: string } | null = null;
        let bestDepth = -1;
        for (const frame of frames) {
          const gid = String(frame?.group?.id ?? '');
          if (!gid) continue;
          const expanded = expandedCustomByGroupId.get(gid) ?? null;
          if (!expanded) continue;

          const left = Number(frame.left ?? 0);
          const top = Number(frame.top ?? 0);
          const width = Number(frame.width ?? 0);
          const height = Number(frame.height ?? 0);
          const right = left + width;
          const bottom = top + height;
          if (position.x < left || position.x > right || position.y < top || position.y > bottom)
            continue;

          const depth = Number(frame.depth ?? 0) || 0;
          if (depth <= bestDepth) continue;
          bestDepth = depth;
          host = { groupId: gid, nodeId: expanded.nodeId };
        }

        if (host) {
          const hostNode = nodeEngine.getNode(String(host.nodeId)) as any;
          const hostState = hostNode ? readCustomNodeState(hostNode.config ?? {}) : null;
          if (hostState) {
            const defs = get(customNodeDefinitions) ?? [];
            if (wouldCreateCycle(defs, hostState.definitionId, definitionId)) {
              nodeEngine.lastError?.set?.('Cyclic custom node nesting is not allowed.');
              return;
            }
          }
        }
      }

      const groupId = generateCustomNodeGroupId();
      const internal = cloneInternalGraphForNewInstance(def.template, groupId);
      const state = {
        definitionId,
        groupId,
        role: 'child',
        manualGate: true,
        internal,
      };

      const newNode: NodeInstance = {
        id: generateId(),
        type,
        position: position ?? fallback,
        config: writeCustomNodeState({ ...(configPatch ?? {}) }, state as any),
        inputValues: {},
        outputValues: {},
      };
      nodeEngine.addNode(newNode);
      return newNode.id;
    }

    const def = nodeRegistry.get(type);
    if (!def) return;
    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) {
      config[field.key] = field.defaultValue;
    }
    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position: position ?? fallback,
      config: { ...config, ...(configPatch ?? {}) },
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

  const downloadJson = (payload: unknown, filename: string) => {
    if (typeof document === 'undefined') return;
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sanitizeFileName = (name: string) => {
    const raw = String(name ?? '').trim() || 'custom-node';
    return raw
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
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

  const exportCustomNode = () => {
    if (!selectedNodeId) {
      nodeEngine.lastError?.set?.('Select a Custom Node mother instance to export.');
      return;
    }
    const node = nodeEngine.getNode(String(selectedNodeId)) as any;
    const state = node ? readCustomNodeState(node.config ?? {}) : null;
    if (!state || state.role !== 'mother') {
      nodeEngine.lastError?.set?.('Only a Custom Node mother instance can be exported.');
      return;
    }

    const def = getCustomNodeDefinition(state.definitionId);
    if (!def) {
      nodeEngine.lastError?.set?.('Missing Custom Node definition.');
      return;
    }

    const file = buildCustomNodeFile(get(customNodeDefinitions) ?? [], state.definitionId);
    downloadJson(file, `${sanitizeFileName(def.name)}.shugu-node.json`);
  };

  const importCustomNode = () => {
    importCustomNodeInputEl?.click?.();
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

  const cloneInternalGraphForMotherInstance = (graph: GraphState, groupId: string): GraphState => {
    const gid = String(groupId ?? '');
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const connections = Array.isArray(graph?.connections) ? graph.connections : [];
    return {
      nodes: nodes.map((node: any) => {
        let config = { ...(node.config ?? {}) };
        const inputValues = { ...(node.inputValues ?? {}) };
        if (gid && (node.type === 'group-proxy' || node.type === 'group-gate')) {
          config = { ...config, groupId: gid };
        }
        return { ...node, config, inputValues, outputValues: {} };
      }),
      connections: connections.map((c: any) => ({ ...c })),
    };
  };

  const handleImportCustomNodeChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    const parsedFile = parseCustomNodeFile(parsed);
    if (!parsedFile) {
      alert('Unsupported Custom Node file format.');
      return;
    }

    const ok = confirm('Import Custom Node definitions from file?');
    if (!ok) return;

    try {
      const importedDefs = parsedFile.definitions ?? [];
      const remapped = remapImportedDefinitions(importedDefs);

      const inCycleImported = definitionsInCycles(remapped.definitions as any);
      if (inCycleImported.size > 0) {
        const ids = Array.from(inCycleImported).map(String).filter(Boolean);
        alert(`Import rejected: cyclic Custom Node nesting detected.\n\n${ids.join(' → ')}`);
        return;
      }

      const existing = get(customNodeDefinitions) ?? [];
      const merged = [...existing, ...remapped.definitions];
      const inCycleMerged = definitionsInCycles(merged as any);
      if (inCycleMerged.size > 0) {
        const ids = Array.from(inCycleMerged).map(String).filter(Boolean);
        alert(`Import rejected: would introduce cyclic nesting.\n\n${ids.join(' → ')}`);
        return;
      }

      for (const def of remapped.definitions) {
        addCustomNodeDefinition(def as any);
      }

      const rootOld = String(parsedFile.rootDefinitionId ?? '');
      const rootId = remapped.idMap.get(rootOld) ?? '';
      const rootDef = rootId
        ? remapped.definitions.find((d) => String(d.definitionId) === rootId)
        : null;
      if (!rootDef) {
        nodeEngine.lastError?.set?.('Import failed: missing remapped root definition.');
        return;
      }

      // Determine which imported definitions already have a nested mother instance in any template.
      const nestedMothers = new Set<string>();
      for (const def of remapped.definitions) {
        const nodes = Array.isArray(def.template?.nodes) ? def.template.nodes : [];
        for (const node of nodes as any[]) {
          const cfg = isRecord((node as any)?.config) ? ((node as any).config as any) : {};
          const st = readCustomNodeState(cfg);
          if (st && st.role === 'mother') nestedMothers.add(String(st.definitionId));
        }
      }

      // Ensure each imported definition has exactly one mother instance somewhere.
      // Always materialize a mother for the root definition on the main graph.
      const toCreate = new Set<string>();
      toCreate.add(String(rootDef.definitionId));
      for (const def of remapped.definitions) {
        const did = String(def.definitionId ?? '');
        if (!did) continue;
        if (nestedMothers.has(did)) continue;
        toCreate.add(did);
      }

      const center = viewportCenterGraphPos();
      const defsToCreate = remapped.definitions.filter((d) => toCreate.has(String(d.definitionId)));
      defsToCreate.sort((a, b) => {
        if (String(a.definitionId) === String(rootDef.definitionId)) return -1;
        if (String(b.definitionId) === String(rootDef.definitionId)) return 1;
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
      });

      const createdNodeIds: string[] = [];
      const spacingX = 260;
      const spacingY = 180;
      let col = 0;
      let row = 0;
      for (const def of defsToCreate) {
        const did = String(def.definitionId ?? '');
        if (!did) continue;

        const groupId = generateCustomNodeGroupId();
        const internal = cloneInternalGraphForMotherInstance(def.template, groupId);
        const nodeId = generateId();
        const pos = {
          x: center.x + col * spacingX,
          y: center.y + row * spacingY,
        };
        col += 1;
        if (col >= 3) {
          col = 0;
          row += 1;
        }

        nodeEngine.addNode({
          id: nodeId,
          type: customNodeType(did),
          position: pos,
          config: writeCustomNodeState({}, {
            definitionId: did,
            groupId,
            role: 'mother',
            manualGate: true,
            internal,
          } as any),
          inputValues: {},
          outputValues: {},
        } as any);
        createdNodeIds.push(nodeId);
      }

      if (createdNodeIds.length > 0) {
        groupController.clearSelection();
        setSelectedNode('');
        groupController.groupSelectionNodeIds.set(new Set(createdNodeIds));
        groupController.scheduleHighlight();
        requestFramesUpdate();
        minimapController?.requestUpdate();
        focusController.setPendingFocusNodeIds(createdNodeIds);
      }
    } catch (err) {
      console.error('[CustomNodeImport] failed', err);
      alert('Custom Node import failed. See console for details.');
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

  $: if (selectedNodeId && !graphState.nodes.some((n) => n.id === selectedNodeId)) {
    setSelectedNode('');
  }

  const groupSnapshotKey = (groups: any[]): string => {
    const sorted = Array.isArray(groups)
      ? [...groups].sort((a: any, b: any) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
      : [];
    return sorted
      .map((g: any) => {
        const nodeIds = Array.isArray(g?.nodeIds)
          ? Array.from(new Set(g.nodeIds.map((id: any) => String(id)).filter(Boolean)))
              .sort()
              .join(',')
          : '';
        const runtimeActive =
          typeof g?.runtimeActive === 'boolean' ? (g.runtimeActive ? '1' : '0') : '';
        return [
          String(g?.id ?? ''),
          String(g?.parentId ?? ''),
          String(g?.name ?? ''),
          g?.disabled ? '1' : '0',
          g?.minimized ? '1' : '0',
          runtimeActive,
          nodeIds,
        ].join(':');
      })
      .join('|');
  };

  const normalizeGroupsForSnapshot = (groups: any[]) =>
    (Array.isArray(groups) ? groups : []).map((g: any) => ({
      id: String(g?.id ?? ''),
      parentId: g?.parentId ? String(g.parentId) : null,
      name: String(g?.name ?? ''),
      nodeIds: Array.from(new Set((g?.nodeIds ?? []).map((id: any) => String(id)).filter(Boolean))),
      disabled: Boolean(g?.disabled),
      minimized: Boolean(g?.minimized),
      runtimeActive: typeof g?.runtimeActive === 'boolean' ? Boolean(g.runtimeActive) : undefined,
    }));

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

    // Restore persisted groups (and keep them synced) so refresh doesn't lose Group frames.
    groupUiStateUnsub?.();
    groupUiStateUnsub = nodeGroupsState.subscribe((groups) => {
      if (syncingGroupsToProject) return;
      const nextKey = groupSnapshotKey(groups as any);
      if (nextKey === lastGroupsKeyFromProject || nextKey === lastGroupsKeyFromCanvas) return;
      lastGroupsKeyFromProject = nextKey;

      syncingGroupsFromProject = true;
      groupController.setGroups(normalizeGroupsForSnapshot(groups as any) as any);
      syncingGroupsFromProject = false;
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
      if (ctx?.type === 'connectionpick') {
        const sock = (ctx.data as any)?.socket;
        if (sock) {
          connectDraggingSocket = {
            nodeId: String(sock.nodeId),
            side: sock.side,
            key: String(sock.key),
          };
          const edge = findGroupProxyEdgeTargetAt(lastPointerClient.x, lastPointerClient.y);
          groupEdgeHighlight = edge ? { groupId: edge.groupId, side: edge.side } : null;
        }
      }
      if (ctx?.type === 'connectiondrop') {
        connectDraggingSocket = null;
        groupEdgeHighlight = null;

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

          const gateTarget = findGroupGateTargetAt(lastPointerClient.x, lastPointerClient.y);
          if (gateTarget && initialSocket.side === 'output') {
            const group =
              get(groupController.nodeGroups).find((g) => String(g.id) === gateTarget.groupId) ??
              null;
            if (group && (group.nodeIds ?? []).some((id) => String(id) === initialSocket.nodeId)) {
              nodeEngine.lastError.set('Group gate input cannot originate from inside the group.');
              return ctx;
            }

            const state = nodeEngine.exportGraph();
            const gateNodeId =
              state.nodes.find(
                (n) =>
                  String(n.type) === 'group-gate' &&
                  String((n as any)?.config?.groupId ?? '') === gateTarget.groupId
              )?.id ?? '';
            if (gateNodeId) {
              const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
              nodeEngine.addConnection({
                id: connId,
                sourceNodeId: initialSocket.nodeId,
                sourcePortId: initialSocket.key,
                targetNodeId: String(gateNodeId),
                targetPortId: 'active',
              });
              groupPortNodesController.scheduleNormalizeProxies();
              return ctx;
            }
          }

          const edgeTarget = findGroupProxyEdgeTargetAt(lastPointerClient.x, lastPointerClient.y);
          if (edgeTarget) {
            const validTypes = new Set([
              'number',
              'boolean',
              'string',
              'asset',
              'color',
              'audio',
              'image',
              'video',
              'scene',
              'effect',
              'client',
              'command',
              'fuzzy',
              'array',
              'any',
            ]);
            const resolveTypeForSocket = (sock: SocketData) => {
              const node = nodeEngine.getNode(String(sock.nodeId));
              if (!node) return 'any';
              if (node.type === 'group-proxy') {
                const raw = (node.config as any)?.portType;
                const t = typeof raw === 'string' && raw ? raw : raw ? String(raw) : '';
                return validTypes.has(t) ? t : 'any';
              }
              const def = nodeRegistry.get(String(node.type ?? ''));
              const ports = sock.side === 'input' ? def?.inputs : def?.outputs;
              const port = (ports ?? []).find((p) => String(p.id) === String(sock.key));
              const t = String((port as any)?.type ?? 'any');
              return validTypes.has(t) ? t : 'any';
            };

            const frame = edgeTarget.frame;
            const groupId = edgeTarget.groupId;
            const direction = edgeTarget.side === 'input' ? 'input' : 'output';
            const graphPos = computeGraphPosition(lastPointerClient.x, lastPointerClient.y);
            const left = Number(frame.left ?? 0);
            const top = Number(frame.top ?? 0);
            const width = Number(frame.width ?? 0);
            const height = Number(frame.height ?? 0);
            const right = left + width;
            const bottom = top + height;

            const clampY = (y: number) => {
              const isMinimized = Boolean((frame as any)?.group?.minimized);
              const topPad = isMinimized ? 44 + 6 + 28 / 2 : 56;
              const bottomPad = isMinimized ? 6 + 28 / 2 : 56;
              const minY = top + topPad;
              const maxY = bottom - bottomPad;
              if (!Number.isFinite(y)) return top + height / 2;
              if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY)
                return top + height / 2;
              return Math.max(minY, Math.min(maxY, y));
            };

            const proxyWidth = 48;
            const proxyOutset = 10;
            const proxyEdgeNudge = 12;
            const isMinimized = Boolean((frame as any)?.group?.minimized);
            const x = isMinimized
              ? direction === 'input'
                ? left - proxyOutset
                : right + proxyOutset - proxyWidth
              : direction === 'input'
                ? left - proxyWidth / 2 - proxyEdgeNudge
                : right - proxyWidth / 2 + proxyEdgeNudge;
            const y = clampY(graphPos.y);
            const portType = resolveTypeForSocket(initialSocket);

            const proxyId = addNode(
              'group-proxy',
              { x, y: y - 10 },
              { groupId, direction, portType, pinned: true }
            );
            if (proxyId) {
              const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
              const conn: EngineConnection =
                initialSocket.side === 'output'
                  ? {
                      id: connId,
                      sourceNodeId: initialSocket.nodeId,
                      sourcePortId: initialSocket.key,
                      targetNodeId: proxyId,
                      targetPortId: 'in',
                    }
                  : {
                      id: connId,
                      sourceNodeId: proxyId,
                      sourcePortId: 'out',
                      targetNodeId: initialSocket.nodeId,
                      targetPortId: initialSocket.key,
                    };
              nodeEngine.addConnection(conn);
              groupPortNodesController.scheduleAlign();
              groupPortNodesController.scheduleNormalizeProxies();
              return ctx;
            }
          }

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
            groupPortNodesController.scheduleNormalizeProxies();
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

      const nextConnKey = (state.connections ?? []).map((c) => String(c.id)).join('|');
      const connectionsChanged = nextConnKey !== lastGraphConnKey;
      lastGraphConnKey = nextConnKey;

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
      syncCustomGateInputs(state);
      if (connectionsChanged) groupPortNodesController.scheduleNormalizeProxies();
      patchRuntime.onGraphStateChanged();
      rehydrateExpandedCustomFrames(state);
    });

    groupNodesUnsub = groupController.nodeGroups.subscribe((groups) => {
      const nextKey = groupSnapshotKey(groups as any);
      lastGroupsKeyFromCanvas = nextKey;
      if (!syncingGroupsFromProject && nextKey !== lastGroupsKeyFromProject) {
        syncingGroupsToProject = true;
        nodeGroupsState.set(normalizeGroupsForSnapshot(groups as any) as any);
        syncingGroupsToProject = false;
      }
      groupPortNodesController.ensureGroupPortNodes();
      groupPortNodesController.scheduleAlign();
      groupPortNodesController.scheduleNormalizeProxies();
    });

    groupFramesUnsub = groupFrames.subscribe(() => {
      groupPortNodesController.scheduleAlign();
    });

    let lastClientKey = '';
    managerUnsub = managerState.subscribe(($state) => {
      const clientsWithGroups = ($state.clients ?? [])
        .filter((c: any) => c?.connected !== false)
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

    // UI: Group minimized node expand toggle (from ReteNode's group-frame nodes).
    const onGroupFrameToggle = (event: Event) => {
      const detail = (event as any)?.detail ?? null;
      const rawGroupId = detail?.groupId;
      const groupId =
        typeof rawGroupId === 'string' ? rawGroupId : rawGroupId ? String(rawGroupId) : '';
      if (!groupId) return;
      groupController.toggleGroupMinimized(groupId);
    };
    window.addEventListener('shugu:toggle-group-minimized', onGroupFrameToggle as any);
    groupFrameToggleHandler = onGroupFrameToggle;

    // UI: Minimized Group node active toggle (manually activate/deactivate the group).
    const onGroupFrameToggleDisabled = (event: Event) => {
      const detail = (event as any)?.detail ?? null;
      const rawGroupId = detail?.groupId;
      const groupId =
        typeof rawGroupId === 'string' ? rawGroupId : rawGroupId ? String(rawGroupId) : '';
      if (!groupId) return;
      groupController.toggleGroupDisabled(groupId);
    };
    window.addEventListener('shugu:toggle-group-disabled', onGroupFrameToggleDisabled as any);
    groupFrameDisabledHandler = onGroupFrameToggleDisabled;

    const onCustomNodeUncouple = (event: Event) => {
      const detail = (event as any)?.detail ?? null;
      const rawNodeId = detail?.nodeId;
      const nodeId = typeof rawNodeId === 'string' ? rawNodeId : rawNodeId ? String(rawNodeId) : '';
      if (!nodeId) return;
      handleUncoupleCustomNode(nodeId);
    };
    window.addEventListener('shugu:custom-node-uncouple', onCustomNodeUncouple as any);
    customNodeUncoupleHandler = onCustomNodeUncouple;

    const onCustomNodeExpand = (event: Event) => {
      const detail = (event as any)?.detail ?? null;
      const rawNodeId = detail?.nodeId;
      const nodeId = typeof rawNodeId === 'string' ? rawNodeId : rawNodeId ? String(rawNodeId) : '';
      if (!nodeId) return;
      handleExpandCustomNode(nodeId);
    };
    window.addEventListener('shugu:custom-node-expand', onCustomNodeExpand as any);
    customNodeExpandHandler = onCustomNodeExpand;


    // UX: Dragging the minimized Group node should move the entire group (incl. nested frames/ports).
    if (areaPlugin) {
      areaPlugin.addPipe(async (ctx: any) => {
        if (ctx?.type !== 'nodetranslated') return ctx;
        if (isSyncingRef.value) return ctx;
        if (groupController.isProgrammaticTranslate()) return ctx;
        if (groupFrameTranslateDepth > 0) return ctx;

        const data = ctx.data ?? {};
        const nodeId = String(data.id ?? '');
        const pos = data.position as { x: number; y: number } | undefined;
        const prev = data.previous as { x: number; y: number } | undefined;
        if (!nodeId || !pos || !prev) return ctx;

        const node = nodeEngine.getNode(nodeId);
        if (!node || String(node.type) !== 'group-frame') return ctx;

        const rawGroupId = (node.config as any)?.groupId;
        const groupId =
          typeof rawGroupId === 'string' ? rawGroupId : rawGroupId ? String(rawGroupId) : '';
        if (!groupId) return ctx;

        const dx = Number(pos.x ?? 0) - Number(prev.x ?? 0);
        const dy = Number(pos.y ?? 0) - Number(prev.y ?? 0);
        if (!dx && !dy) return ctx;

        const groups = get(groupController.nodeGroups) ?? [];
        const subtreeGroupIds = new Set<string>();
        const stack = [groupId];
        while (stack.length > 0) {
          const gid = String(stack.pop() ?? '');
          if (!gid || subtreeGroupIds.has(gid)) continue;
          subtreeGroupIds.add(gid);
          for (const g of groups) {
            if (String((g as any)?.parentId ?? '') === gid)
              stack.push(String((g as any)?.id ?? ''));
          }
        }

        const nodeIdsToMove = new Set<string>();
        for (const g of groups) {
          const gid = String((g as any)?.id ?? '');
          if (!gid || !subtreeGroupIds.has(gid)) continue;
          for (const id of (g as any)?.nodeIds ?? []) nodeIdsToMove.add(String(id));
        }

        const state: GraphState = nodeEngine.exportGraph();
        for (const n of state.nodes ?? []) {
          const type = String((n as any)?.type ?? '');
          if (type !== 'group-gate' && type !== 'group-proxy' && type !== 'group-frame') continue;
          const gid = String(((n as any)?.config as any)?.groupId ?? '');
          if (!gid || !subtreeGroupIds.has(gid)) continue;
          nodeIdsToMove.add(String((n as any).id ?? ''));
        }
        nodeIdsToMove.delete(nodeId);

        if (nodeIdsToMove.size === 0) return ctx;

        groupFrameTranslateDepth += 1;
        groupController.beginProgrammaticTranslate();
        try {
          const promises: Promise<unknown>[] = [];
          for (const id of nodeIdsToMove) {
            const view = areaPlugin?.nodeViews?.get?.(String(id));
            const viewPos = view?.position as { x: number; y: number } | undefined;
            if (viewPos && Number.isFinite(viewPos.x) && Number.isFinite(viewPos.y)) {
              promises.push(
                areaPlugin.translate(String(id), { x: viewPos.x + dx, y: viewPos.y + dy })
              );
            } else {
              const instance = nodeEngine.getNode(String(id));
              if (!instance) continue;
              const cx = Number((instance as any).position?.x ?? 0);
              const cy = Number((instance as any).position?.y ?? 0);
              if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
              nodeEngine.updateNodePosition(String(id), { x: cx + dx, y: cy + dy });
            }
          }
          await Promise.all(promises);
        } finally {
          groupController.endProgrammaticTranslate();
          groupFrameTranslateDepth = Math.max(0, groupFrameTranslateDepth - 1);
        }

        // Persist translated positions for nodes that were moved programmatically via the view.
        for (const id of nodeIdsToMove) {
          const view = areaPlugin?.nodeViews?.get?.(String(id));
          const viewPos = view?.position as { x: number; y: number } | undefined;
          if (viewPos && Number.isFinite(viewPos.x) && Number.isFinite(viewPos.y)) {
            nodeEngine.updateNodePosition(String(id), { x: viewPos.x, y: viewPos.y });
          }
        }

        groupPortNodesController.scheduleAlign();
        requestFramesUpdate();
        minimapController.requestUpdate();

        return ctx;
      });
    }

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
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('.group-frame-header')) selectedGroupId.set(null);

      // Feature: Group proxy ports can be dragged along the group edge (vertical only).
      if (event.button === 0 && !event.altKey && proxyDragPointerId === null) {
        const nodeEl = (target?.closest?.('.node') as HTMLElement | null) ?? null;
        const nodeId = String(nodeEl?.dataset?.reteNodeId ?? '');
        const isOnSocket = Boolean(target?.closest?.('.socket'));
        const isEditing =
          Boolean(target?.closest?.('input, textarea, select, button')) ||
          Boolean((target as any)?.isContentEditable) ||
          Boolean(target?.closest?.('.port-control')) ||
          Boolean(target?.closest?.('.cmd-aggregator-controls'));

        if (nodeEl && nodeId && !isOnSocket && !isEditing) {
          const node = nodeEngine.getNode(nodeId);
          if (node?.type === 'group-proxy') {
            const groupId =
              typeof (node.config as any)?.groupId === 'string'
                ? String((node.config as any).groupId)
                : '';
            if (!groupId) return;

            const frames = get(groupFrames) ?? [];
            const frame = frames.find((f: any) => String(f?.group?.id ?? '') === groupId) ?? null;
            if (!frame) return;

            const direction =
              String((node.config as any)?.direction ?? 'output') === 'input' ? 'input' : 'output';
            const proxyWidth = 48;
            const proxyHalfHeight = 10;
            const proxyOutset = 10;
            const proxyEdgeNudge = 12;

            const left = Number(frame.left ?? 0);
            const top = Number(frame.top ?? 0);
            const width = Number(frame.width ?? 0);
            const height = Number(frame.height ?? 0);

            const isMinimized = Boolean((frame as any)?.group?.minimized);

            const fixedX = isMinimized
              ? direction === 'input'
                ? left - proxyOutset
                : left + width + proxyOutset - proxyWidth
              : direction === 'input'
                ? left - proxyWidth / 2 - proxyEdgeNudge
                : left + width - proxyWidth / 2 + proxyEdgeNudge;
            const topPad = isMinimized
              ? 44 + 6 + 28 / 2
              : (() => {
                  if (!Number.isFinite(height) || height <= 0) return 56;
                  return Math.max(24, Math.min(56, Math.max(0, height / 2 - 18)));
                })();
            const bottomPad = isMinimized ? 6 + 28 / 2 : topPad;

            const minCenterY = top + topPad;
            const maxCenterY = top + height - bottomPad;

            const clampCenterY = (y: number) => {
              if (!Number.isFinite(y)) return top + height / 2;
              if (
                !Number.isFinite(minCenterY) ||
                !Number.isFinite(maxCenterY) ||
                maxCenterY <= minCenterY
              ) {
                return top + height / 2;
              }
              return Math.max(minCenterY, Math.min(maxCenterY, y));
            };

            // Prevent the default Rete drag so the proxy stays constrained to its edge.
            event.preventDefault();
            event.stopPropagation();

            const startGraph = computeGraphPosition(event.clientX, event.clientY);
            const startPos =
              viewAdapter.getNodePosition(nodeId) ??
              ({
                x: Number(node.position?.x ?? 0),
                y: Number(node.position?.y ?? 0),
              } as const);

            const dragOffsetY = startGraph.y - startPos.y;

            const cleanup = () => {
              if (proxyDragMoveHandler) {
                window.removeEventListener('pointermove', proxyDragMoveHandler, {
                  capture: true,
                } as any);
              }
              if (proxyDragUpHandler) {
                window.removeEventListener('pointerup', proxyDragUpHandler, {
                  capture: true,
                } as any);
                window.removeEventListener('pointercancel', proxyDragUpHandler, {
                  capture: true,
                } as any);
              }
              proxyDragPointerId = null;
              proxyDragMoveHandler = null;
              proxyDragUpHandler = null;
            };

            const onMove = (moveEvent: PointerEvent) => {
              if (proxyDragPointerId === null) return;
              if (moveEvent.pointerId !== proxyDragPointerId) return;

              const graphPos = computeGraphPosition(moveEvent.clientX, moveEvent.clientY);
              const desiredTopLeftY = graphPos.y - dragOffsetY;
              const desiredCenterY = desiredTopLeftY + proxyHalfHeight;
              const clampedCenterY = clampCenterY(desiredCenterY);
              const topLeftY = clampedCenterY - proxyHalfHeight;
              viewAdapter.setNodePosition(nodeId, fixedX, topLeftY);

              moveEvent.preventDefault();
              moveEvent.stopPropagation();
            };

            const onUp = (upEvent: PointerEvent) => {
              if (proxyDragPointerId === null) return;
              if (upEvent.pointerId !== proxyDragPointerId) return;

              cleanup();

              const pos = viewAdapter.getNodePosition(nodeId);
              if (pos) nodeEngine.updateNodePosition(nodeId, { x: pos.x, y: pos.y });
              nodeEngine.updateNodeConfig(nodeId, { pinned: true });
              groupPortNodesController.scheduleAlign();
            };

            proxyDragPointerId = event.pointerId;
            proxyDragMoveHandler = onMove;
            proxyDragUpHandler = onUp;
            window.addEventListener('pointermove', onMove, { capture: true });
            window.addEventListener('pointerup', onUp, { capture: true });
            window.addEventListener('pointercancel', onUp, { capture: true });

            return;
          }
        }
      }

      // New UX: Alt/Option + drag on a node duplicates it and drags the clone.
      if (event.button === 0 && event.altKey && altDuplicateDragPointerId === null) {
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
              let config = { ...(source.config ?? {}) };
              const state = readCustomNodeState(config);
              if (state) {
                const groupId = generateCustomNodeGroupId();
                config = writeCustomNodeState(config, {
                  ...state,
                  groupId,
                  role: 'child',
                  internal: cloneInternalGraphForNewInstance(state.internal, groupId),
                } as any);
              }
              const clone: NodeInstance = {
                id: newId,
                type: String(source.type ?? ''),
                position: { x: basePos.x, y: basePos.y },
                config,
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
      if (connectDraggingSocket) {
        const edge = findGroupProxyEdgeTargetAt(event.clientX, event.clientY);
        groupEdgeHighlight = edge ? { groupId: edge.groupId, side: edge.side } : null;
      } else if (groupEdgeHighlight) {
        groupEdgeHighlight = null;
      }
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
      if (
        key === 'Escape' &&
        (get(groupController.groupSelectionNodeIds).size > 0 ||
          Boolean(get(groupController.selectedGroupId)))
      ) {
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
          deleteNodeWithRules(id);
        }
        groupController.clearSelection();
        return;
      }

      if (!selectedNodeId) return;
      event.preventDefault();
      deleteNodeWithRules(selectedNodeId);
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
    groupUiStateUnsub?.();
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
    if (proxyDragMoveHandler)
      window.removeEventListener('pointermove', proxyDragMoveHandler, {
        capture: true,
      } as any);
    if (proxyDragUpHandler) {
      window.removeEventListener('pointerup', proxyDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', proxyDragUpHandler, { capture: true } as any);
    }
    proxyDragPointerId = null;
    proxyDragMoveHandler = null;
    proxyDragUpHandler = null;
    if (toolbarMenuOutsideHandler)
      window.removeEventListener('pointerdown', toolbarMenuOutsideHandler, {
        capture: true,
      } as any);
    if (groupFrameToggleHandler)
      window.removeEventListener('shugu:toggle-group-minimized', groupFrameToggleHandler as any);
    if (groupFrameDisabledHandler)
      window.removeEventListener('shugu:toggle-group-disabled', groupFrameDisabledHandler as any);
    if (customNodeUncoupleHandler)
      window.removeEventListener('shugu:custom-node-uncouple', customNodeUncoupleHandler as any);
    if (customNodeExpandHandler)
      window.removeEventListener('shugu:custom-node-expand', customNodeExpandHandler as any);
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
    <input
      bind:this={importCustomNodeInputEl}
      type="file"
      accept="application/json"
      on:change={handleImportCustomNodeChange}
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
      onImportCustomNode={importCustomNode}
      onExportCustomNode={exportCustomNode}
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
      selectedGroupId={$selectedGroupId}
      toast={$groupEditToast}
      edgeHighlight={groupEdgeHighlight}
      {gateModeGroupIds}
      groupGateNodeIdByGroupId={groupGateNodeIdByGroupId}
      customNodeGroupIds={expandedCustomGroupIds}
      onToggleDisabled={handleToggleGroupDisabled}
      onToggleMinimized={groupController.toggleGroupMinimized}
      onToggleEditMode={groupController.toggleGroupEditMode}
      onNodalize={handleNodalizeGroup}
      onDenodalize={handleDenodalizeGroup}
      onCollapseCustomNode={handleCollapseCustomNodeFrame}
      onDisassemble={groupPortNodesController.disassembleGroupAndPorts}
      onRename={handleRenameGroup}
      onHeaderPointerDown={handleGroupHeaderPointerDown}
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
