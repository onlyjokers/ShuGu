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
  import type {
    NodeInstance,
    Connection as EngineConnection,
    GraphState,
    PortType,
  } from '$lib/nodes/types';
  import type { LocalLoop } from '$lib/nodes';
  import { midiService } from '$lib/features/midi/midi-service';
  import { createFileActions } from './node-canvas/io/file-actions';
  import { LiveDOMSocketPosition } from './node-canvas/rete/live-socket-position';
  import { createReteAdapter, type GraphViewAdapter } from './node-canvas/adapters';
  import { createMinimapController } from './node-canvas/controllers/minimap-controller';
  import { createGroupController } from './node-canvas/controllers/group-controller';
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
  let groupHeaderDragPointerId: number | null = null;
  let groupHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let groupHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;
  let loopHeaderDragPointerId: number | null = null;
  let loopHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let loopHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;
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

  const GROUP_ACTIVATE_NODE_TYPE = 'group-activate';

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
  let clipboardNodes: NodeInstance[] = [];
  // Track internal connections so paste can restore them.
  let clipboardConnections: EngineConnection[] = [];
  let clipboardPasteIndex = 0;

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

  const clampNumber = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const mergeBounds = (
    base: { left: number; top: number; right: number; bottom: number } | null,
    next: { left: number; top: number; right: number; bottom: number } | null
  ) => {
    if (!next) return base;
    if (!base) return { ...next };
    return {
      left: Math.min(base.left, next.left),
      top: Math.min(base.top, next.top),
      right: Math.max(base.right, next.right),
      bottom: Math.max(base.bottom, next.bottom),
    };
  };

  let pendingFocusNodeIds: string[] | null = null;

  const focusBounds = (
    bounds: { left: number; top: number; right: number; bottom: number } | null,
    opts: { force?: boolean } = {}
  ) => {
    if (!container) return;
    if (!bounds) return;

    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 1 || h <= 1) return;

    if (!opts.force) {
      const t = viewAdapter.getViewportTransform();
      const k = Number(t?.k ?? 1) || 1;
      const tx = Number(t?.tx ?? 0) || 0;
      const ty = Number(t?.ty ?? 0) || 0;

      const visibleLeft = -tx / k;
      const visibleTop = -ty / k;
      const visibleRight = (container.clientWidth - tx) / k;
      const visibleBottom = (container.clientHeight - ty) / k;

      const marginX = 48 / k;
      const marginY = 64 / k;
      const fullyVisible =
        bounds.left >= visibleLeft + marginX &&
        bounds.right <= visibleRight - marginX &&
        bounds.top >= visibleTop + marginY &&
        bounds.bottom <= visibleBottom - marginY;

      if (fullyVisible) return;
    }

    const marginX = 120;
    const marginY = 140;
    const availW = Math.max(240, container.clientWidth - marginX * 2);
    const availH = Math.max(180, container.clientHeight - marginY * 2);

    let k = Math.min(availW / w, availH / h);
    if (!Number.isFinite(k) || k <= 0) k = 1;
    k = clampNumber(k, 0.08, 2.2);

    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const tx = container.clientWidth / 2 - cx * k;
    const ty = container.clientHeight / 2 - cy * k;

    viewAdapter.setViewportTransform({ k, tx, ty });
    minimapController?.requestUpdate();
    requestFramesUpdate();
  };

  const focusNodeIds = (nodeIdsRaw: string[], opts: { force?: boolean } = {}) => {
    if (!container) return;

    const nodeById = new Map((graphState.nodes ?? []).map((n) => [String(n.id), n]));
    const typeByNodeId = new Map(
      (graphState.nodes ?? []).map((n) => [String(n.id), String(n.type ?? '')])
    );

    const ids = (nodeIdsRaw ?? []).map((id) => String(id)).filter(Boolean);
    const nodeIds = ids.filter((id) => {
      const type = typeByNodeId.get(id) ?? '';
      return Boolean(type) && type !== GROUP_ACTIVATE_NODE_TYPE;
    });
    if (nodeIds.length === 0) return;

    const getNodeBoundsApprox = (nodeId: string) => {
      const node = nodeById.get(String(nodeId));
      const pos = node?.position as any;
      const x = Number(pos?.x ?? 0);
      const y = Number(pos?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const w = 230;
      const h = 100;
      return { left: x, top: y, right: x + w, bottom: y + h };
    };

    let bounds: { left: number; top: number; right: number; bottom: number } | null = null;
    for (const id of nodeIds) {
      const raw = viewAdapter.getNodeBounds(id);
      const usable = (() => {
        if (!raw) return null;
        const bw = raw.right - raw.left;
        const bh = raw.bottom - raw.top;
        if (!Number.isFinite(bw) || !Number.isFinite(bh)) return null;
        if (bw < 40 || bh < 30) return null;
        return raw;
      })();
      bounds = mergeBounds(bounds, usable ?? getNodeBoundsApprox(id));
    }
    focusBounds(bounds, opts);
  };

  const focusGroupById = (groupId: string) => {
    const targetId = String(groupId ?? '');
    if (!targetId) return;

    const groups = get(nodeGroups) as any[];
    if (!Array.isArray(groups) || groups.length === 0) return;

    const byId = new Map<string, any>();
    const childrenByParentId = new Map<string, string[]>();

    for (const g of groups) {
      const id = String(g?.id ?? '');
      if (!id) continue;
      byId.set(id, g);

      const pid = g?.parentId ? String(g.parentId) : '';
      if (!pid) continue;
      const list = childrenByParentId.get(pid) ?? [];
      list.push(id);
      childrenByParentId.set(pid, list);
    }

    const groupIds = new Set<string>();
    const stack = [targetId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || groupIds.has(id)) continue;
      groupIds.add(id);
      for (const childId of childrenByParentId.get(id) ?? []) stack.push(childId);
    }

    // Prefer frame-based focus (accounts for group padding + child groups), then include Group Activate port nodes.
    let bounds: { left: number; top: number; right: number; bottom: number } | null = null;
    const frames = get(groupFrames) as any[];
    if (Array.isArray(frames) && frames.length > 0) {
      const frame = frames.find((f) => String(f?.group?.id ?? '') === targetId) ?? null;
      const left = Number(frame?.left);
      const top = Number(frame?.top);
      const width = Number(frame?.width);
      const height = Number(frame?.height);
      if (
        Number.isFinite(left) &&
        Number.isFinite(top) &&
        Number.isFinite(width) &&
        Number.isFinite(height)
      ) {
        bounds = { left, top, right: left + width, bottom: top + height };
      }
    }

    if (groupIds.size > 0) {
      const state = nodeEngine.exportGraph();
      const index = buildGroupPortIndex(state);
      const nodeById = new Map((state.nodes ?? []).map((n) => [String(n.id), n]));

      const getPortBoundsApprox = (nodeId: string) => {
        const node = nodeById.get(String(nodeId));
        const x = Number((node as any)?.position?.x ?? 0);
        const y = Number((node as any)?.position?.y ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const w = 80;
        const h = 44;
        return { left: x, top: y, right: x + w, bottom: y + h };
      };

      for (const gid of groupIds) {
        const portId = index.get(String(gid))?.activateId;
        if (!portId) continue;
        bounds = mergeBounds(
          bounds,
          viewAdapter.getNodeBounds(String(portId)) ?? getPortBoundsApprox(portId)
        );
      }
    }

    const nodeIdsSet = new Set<string>();
    for (const gid of groupIds) {
      const g = byId.get(gid);
      for (const nid of g?.nodeIds ?? []) {
        const id = String(nid);
        if (id) nodeIdsSet.add(id);
      }
    }

    if (bounds) {
      focusBounds(bounds, { force: true });
      return;
    }

    focusNodeIds(Array.from(nodeIdsSet), { force: true });
  };

  requestFramesUpdate = () => {
    const t = readAreaTransform(areaPlugin);
    if (t) canvasTransform = t;
    loopController?.requestFramesUpdate();
    groupController.requestFramesUpdate();
  };

  const OVERRIDE_TTL_MS = 1500;

  // ===== Client Node Selection Binding =====
  const clampInt = (value: number, min: number, max: number) => {
    const next = Math.floor(value);
    return Math.max(min, Math.min(max, next));
  };

  const toFiniteNumber = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const coerceBoolean = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
    return fallback;
  };

  const hashStringDjb2 = (value: string): number => {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  };

  const buildStableRandomOrder = (nodeId: string, clients: string[]) => {
    const keyed = clients.map((id) => ({ id, score: hashStringDjb2(`${nodeId}|${id}`) }));
    keyed.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    return keyed.map((k) => k.id);
  };

  const clientIdsInOrder = () =>
    (get(managerState).clients ?? []).map((c: any) => String(c?.clientId ?? '')).filter(Boolean);

  const audienceClientIdsInOrder = () =>
    (get(managerState).clients ?? [])
      .filter((c: any) => String(c?.group ?? '') !== 'display')
      .map((c: any) => String(c?.clientId ?? ''))
      .filter(Boolean);

  let patchPendingCommitByKey = new Map<string, ReturnType<typeof setTimeout>>();

  // ===== Patch Deployment (Graph-driven, no toolbar controls) =====
  // Note: `audio-out(cmd) -> client-object(in)` is the routing edge for deploying an audio patch.
  // Display extends this pattern via `audio-out(cmd) -> display-object(in)`.
  const LOCAL_DISPLAY_TARGET_ID = 'local:display';

  const isLocalDisplayTarget = (id: string): boolean => id === LOCAL_DISPLAY_TARGET_ID;

  const isDisplayTarget = (id: string): boolean => {
    if (isLocalDisplayTarget(id)) return true;
    const clients = get(managerState).clients ?? [];
    return clients.some(
      (c: any) => String(c?.clientId ?? '') === id && String(c?.group ?? '') === 'display'
    );
  };

  const sendNodeExecutorPluginControl = (
    targetId: string,
    command: string,
    payload: Record<string, unknown>
  ) => {
    const id = String(targetId ?? '');
    if (!id) return;

    // Display-only nodes can reference `displayfile:<id>` (browser-local File) that must be registered on Display
    // before node-executor starts playback. This works in paired mode (MessagePort) and same-origin fallback mode
    // (BroadcastChannel), so we always pre-register for display targets.
    if ((command === 'deploy' || command === 'override-set') && isDisplayTarget(id)) {
      ensureDisplayLocalFilesRegisteredFromValue(payload);
    }

    if (isLocalDisplayTarget(id)) {
      const bridge = get(displayBridgeState);
      if (bridge.status !== 'connected') return;
      sendLocalDisplayPlugin('node-executor', command, payload);
      return;
    }

    const sdk = getSDK();
    if (!sdk) return;
    sdk.sendPluginControl(
      { mode: 'clientIds', ids: [id] },
      'node-executor',
      command as any,
      payload as any
    );
  };

  type DeployedPatch = {
    patchId: string;
    nodeIds: Set<string>;
    topologySignature: string;
    deployedAt: number;
  };

  let deployedPatchByClientId = new Map<string, DeployedPatch>();
  let patchDeployTimer: ReturnType<typeof setTimeout> | null = null;
  let patchLastPlanKey = '';
  let patchRuntimeTargetsLastCheckAt = 0;
  const PATCH_RUNTIME_TARGETS_CHECK_INTERVAL_MS = 200;

  const getDeployedPatchNodeIds = (): Set<string> => {
    const out = new Set<string>();
    for (const patch of deployedPatchByClientId.values()) {
      for (const id of patch.nodeIds) out.add(id);
    }
    return out;
  };

  const applyStoppedHighlights = async (running: boolean) => {
    const stopped = !running;
    for (const node of graphState.nodes ?? []) {
      const id = String(node.id);
      if (!id) continue;
      const prev = viewAdapter.getNodeVisualState(id);
      if (Boolean(prev?.stopped) !== stopped) await viewAdapter.setNodeVisualState(id, { stopped });
    }
  };

  const applyPatchHighlights = async (patchNodeIds: Set<string>) => {
    const ids = patchNodeIds ?? new Set<string>();
    for (const node of graphState.nodes ?? []) {
      const id = String(node.id);
      if (!id) continue;
      const deployedPatch = ids.has(id);
      const prev = viewAdapter.getNodeVisualState(id);
      if (Boolean(prev?.deployedPatch) !== deployedPatch) {
        await viewAdapter.setNodeVisualState(id, { deployedPatch });
      }
    }
  };

  const syncPatchOffloadState = (patchNodeIds: Set<string>) => {
    nodeEngine.setPatchOffloadedNodeIds(Array.from(patchNodeIds ?? []));
  };

  type MidiBridgeRoute = {
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    targetType: PortType;
    key: string; // `${targetNodeId}|${targetPortId}`
  };

  const isMidiNodeType = (type: string): boolean => type.startsWith('midi-');

  let midiBridgeRoutes: MidiBridgeRoute[] = [];
  let midiBridgeDesiredKeys = new Set<string>();
  let midiBridgeActiveKeysByClientId = new Map<string, Set<string>>();
  let midiBridgeLastSignatureByClientKey = new Map<string, string>();
  let midiBridgeLastSendAt = 0;

  const midiBridgeClientKey = (clientId: string, patchId: string, nodeId: string, portId: string) =>
    `${clientId}|${patchId}|${nodeId}|${portId}`;

  const computeMidiBridgeRoutes = (
    patchNodeIds: Set<string>
  ): { routes: MidiBridgeRoute[]; keys: Set<string> } => {
    const nodeById = new Map((graphState.nodes ?? []).map((n: any) => [String(n.id), n]));
    const routes: MidiBridgeRoute[] = [];
    const keys = new Set<string>();

    for (const c of graphState.connections ?? []) {
      const targetNodeId = String(c.targetNodeId);
      const targetPortId = String(c.targetPortId);
      if (!patchNodeIds.has(targetNodeId)) continue;

      const sourceNodeId = String(c.sourceNodeId);
      const sourcePortId = String(c.sourcePortId);
      const sourceNode = nodeById.get(sourceNodeId);
      if (!sourceNode) continue;
      if (!isMidiNodeType(String(sourceNode.type))) continue;

      const targetNode = nodeById.get(targetNodeId);
      if (!targetNode) continue;
      const def = nodeRegistry.get(String(targetNode.type));
      const port = def?.inputs?.find((p) => String(p.id) === targetPortId) ?? null;
      if (!port || port.kind === 'sink') continue;
      const targetType = (port.type ?? 'any') as PortType;

      const key = `${targetNodeId}|${targetPortId}`;
      keys.add(key);
      routes.push({
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
        targetType,
        key,
      });
    }

    // Stable ordering for deterministic behavior.
    routes.sort(
      (a, b) => a.key.localeCompare(b.key) || a.sourceNodeId.localeCompare(b.sourceNodeId)
    );

    return { routes, keys };
  };

  const clearMidiBridgeState = () => {
    midiBridgeRoutes = [];
    midiBridgeDesiredKeys = new Set();
    midiBridgeActiveKeysByClientId = new Map();
    midiBridgeLastSignatureByClientKey = new Map();
  };

  const syncMidiBridgeRoutes = (patchId: string, patchNodeIds: Set<string>) => {
    if (!patchId || patchNodeIds.size === 0 || deployedPatchByClientId.size === 0) {
      clearMidiBridgeState();
      return;
    }

    const { routes, keys } = computeMidiBridgeRoutes(patchNodeIds);
    midiBridgeRoutes = routes;
    midiBridgeDesiredKeys = keys;

    // Remove overrides that are no longer wired from MIDI.
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      const prev = midiBridgeActiveKeysByClientId.get(clientId) ?? new Set<string>();
      const next = new Set(keys);
      const toRemove = Array.from(prev).filter((k) => !next.has(k));
      if (toRemove.length > 0) {
        const overrides = toRemove.map((k) => {
          const [nodeId, portId] = k.split('|');
          return { nodeId, kind: 'input', portId };
        });
        sendNodeExecutorPluginControl(String(clientId), 'override-remove', {
          loopId: patch.patchId,
          overrides,
        } as any);

        for (const k of toRemove) {
          const [nodeId, portId] = k.split('|');
          midiBridgeLastSignatureByClientKey.delete(
            midiBridgeClientKey(clientId, patch.patchId, nodeId, portId)
          );
        }
      }
      midiBridgeActiveKeysByClientId.set(clientId, next);
    }
  };

  const coerceForPortType = (value: unknown, type: PortType): unknown | undefined => {
    if (value === undefined || value === null) return undefined;
    if (type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    if (type === 'boolean') {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
      return undefined;
    }
    if (type === 'string') return typeof value === 'string' ? value : String(value);
    if (type === 'color') return typeof value === 'string' ? value : undefined;
    // any/fuzzy/client/command/audio are not expected here (we skip sink + type mismatch should prevent it).
    return value;
  };

  const signatureForValue = (value: unknown, type: PortType): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return 'nan';
      return `n:${Math.round(n * 1_000_000) / 1_000_000}`;
    }
    if (type === 'boolean') return `b:${Boolean(value)}`;
    if (type === 'string' || type === 'color') return `s:${String(value)}`;
    try {
      return `j:${JSON.stringify(value)}`;
    } catch {
      return `u:${String(value)}`;
    }
  };

  const sendMidiBridgeOverrides = () => {
    if (!get(isRunningStore)) return;
    if (midiBridgeRoutes.length === 0) return;
    if (deployedPatchByClientId.size === 0) return;

    const now = Date.now();
    if (now - midiBridgeLastSendAt < 30) return;
    midiBridgeLastSendAt = now;

    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      const overrides: any[] = [];
      const removals: any[] = [];
      const activeKeys = midiBridgeActiveKeysByClientId.get(clientId) ?? new Set<string>();

      for (const route of midiBridgeRoutes) {
        const sourceNode = nodeEngine.getNode(route.sourceNodeId);
        const raw = sourceNode?.outputValues?.[route.sourcePortId];
        const coerced = coerceForPortType(raw, route.targetType);

        const key = midiBridgeClientKey(
          clientId,
          patch.patchId,
          route.targetNodeId,
          route.targetPortId
        );
        if (coerced === undefined) {
          if (activeKeys.has(route.key)) {
            activeKeys.delete(route.key);
            midiBridgeLastSignatureByClientKey.delete(key);
            removals.push({
              nodeId: route.targetNodeId,
              kind: 'input',
              portId: route.targetPortId,
            });
          }
          continue;
        }

        const sig = signatureForValue(coerced, route.targetType);
        const prevSig = midiBridgeLastSignatureByClientKey.get(key);
        if (prevSig === sig) {
          activeKeys.add(route.key);
          continue;
        }

        midiBridgeLastSignatureByClientKey.set(key, sig);
        activeKeys.add(route.key);
        overrides.push({
          nodeId: route.targetNodeId,
          kind: 'input',
          portId: route.targetPortId,
          value: coerced,
        });
      }

      midiBridgeActiveKeysByClientId.set(clientId, activeKeys);

      if (removals.length > 0) {
        sendNodeExecutorPluginControl(String(clientId), 'override-remove', {
          loopId: patch.patchId,
          overrides: removals,
        } as any);
      }

      if (overrides.length > 0) {
        sendNodeExecutorPluginControl(String(clientId), 'override-set', {
          loopId: patch.patchId,
          overrides,
        } as any);
      }
    }
  };

  // ===== MIDI Bridge (Loop Deploy) =====
  // Loops are deployed without manager-only MIDI nodes. When a deployed loop node input is wired from
  // a MIDI node in the manager graph, forward that value as a runtime override to the loop executor.
  type MidiLoopBridgeTarget = { loopId: string; clientId: string; nodeIds: Set<string> };

  let midiLoopBridgeRoutesByLoopId = new Map<string, MidiBridgeRoute[]>();
  let midiLoopBridgeActiveKeysByLoopId = new Map<string, Set<string>>();
  let midiLoopBridgeLastSignatureByClientKey = new Map<string, string>();
  let midiLoopBridgeLastSendAt = 0;
  let midiLoopBridgeDirty = true;

  const midiLoopBridgeClientKey = (
    clientId: string,
    loopId: string,
    nodeId: string,
    portId: string
  ) => `${clientId}|${loopId}|${nodeId}|${portId}`;

  const clearMidiLoopBridgeState = () => {
    midiLoopBridgeRoutesByLoopId = new Map();
    midiLoopBridgeActiveKeysByLoopId = new Map();
    midiLoopBridgeLastSignatureByClientKey = new Map();
    midiLoopBridgeDirty = true;
  };

  const getMidiLoopBridgeTargets = (): MidiLoopBridgeTarget[] => {
    if (!loopController) return [];
    const deployed = get(loopController.deployedLoopIds);
    if (!deployed || deployed.size === 0) return [];

    const loops = get(loopController.localLoops) ?? [];
    const targets: MidiLoopBridgeTarget[] = [];
    for (const loop of loops) {
      const loopId = String(loop?.id ?? '');
      if (!loopId || !deployed.has(loopId)) continue;
      const clientId = loopController.loopActions.getLoopClientId(loop);
      if (!clientId) continue;

      const nodeIds = new Set((loop.nodeIds ?? []).map((id) => String(id)).filter(Boolean));
      if (nodeIds.size === 0) continue;

      targets.push({ loopId, clientId: String(clientId), nodeIds });
    }

    targets.sort(
      (a, b) => a.loopId.localeCompare(b.loopId) || a.clientId.localeCompare(b.clientId)
    );
    return targets;
  };

  const syncMidiLoopBridgeRoutes = () => {
    const targets = getMidiLoopBridgeTargets();
    if (targets.length === 0) {
      clearMidiLoopBridgeState();
      return;
    }

    const activeLoopIds = new Set(targets.map((t) => t.loopId));
    for (const loopId of Array.from(midiLoopBridgeRoutesByLoopId.keys())) {
      if (activeLoopIds.has(loopId)) continue;
      midiLoopBridgeRoutesByLoopId.delete(loopId);
      midiLoopBridgeActiveKeysByLoopId.delete(loopId);
    }

    for (const target of targets) {
      const { routes, keys } = computeMidiBridgeRoutes(target.nodeIds);
      midiLoopBridgeRoutesByLoopId.set(target.loopId, routes);

      const prev = midiLoopBridgeActiveKeysByLoopId.get(target.loopId) ?? new Set<string>();
      const next = new Set(keys);
      const toRemove = Array.from(prev).filter((k) => !next.has(k));
      if (toRemove.length > 0) {
        const overrides = toRemove.map((k) => {
          const [nodeId, portId] = k.split('|');
          return { nodeId, kind: 'input', portId };
        });
        sendNodeExecutorPluginControl(String(target.clientId), 'override-remove', {
          loopId: target.loopId,
          overrides,
        } as any);

        for (const k of toRemove) {
          const [nodeId, portId] = k.split('|');
          midiLoopBridgeLastSignatureByClientKey.delete(
            midiLoopBridgeClientKey(target.clientId, target.loopId, nodeId, portId)
          );
        }
      }

      midiLoopBridgeActiveKeysByLoopId.set(target.loopId, next);
    }

    midiLoopBridgeDirty = false;
  };

  const sendMidiLoopBridgeOverrides = () => {
    if (!get(isRunningStore)) return;

    const targets = getMidiLoopBridgeTargets();
    if (targets.length === 0) return;

    if (midiLoopBridgeDirty) syncMidiLoopBridgeRoutes();

    const now = Date.now();
    if (now - midiLoopBridgeLastSendAt < 30) return;
    midiLoopBridgeLastSendAt = now;

    for (const target of targets) {
      const routes = midiLoopBridgeRoutesByLoopId.get(target.loopId) ?? [];
      if (routes.length === 0) continue;

      const overrides: any[] = [];
      const removals: any[] = [];
      const activeKeys = midiLoopBridgeActiveKeysByLoopId.get(target.loopId) ?? new Set<string>();

      for (const route of routes) {
        const sourceNode = nodeEngine.getNode(route.sourceNodeId);
        const raw = sourceNode?.outputValues?.[route.sourcePortId];
        const coerced = coerceForPortType(raw, route.targetType);

        const key = midiLoopBridgeClientKey(
          target.clientId,
          target.loopId,
          route.targetNodeId,
          route.targetPortId
        );
        if (coerced === undefined) {
          if (activeKeys.has(route.key)) {
            activeKeys.delete(route.key);
            midiLoopBridgeLastSignatureByClientKey.delete(key);
            removals.push({
              nodeId: route.targetNodeId,
              kind: 'input',
              portId: route.targetPortId,
            });
          }
          continue;
        }

        const sig = signatureForValue(coerced, route.targetType);
        const prevSig = midiLoopBridgeLastSignatureByClientKey.get(key);
        if (prevSig === sig) {
          activeKeys.add(route.key);
          continue;
        }

        midiLoopBridgeLastSignatureByClientKey.set(key, sig);
        activeKeys.add(route.key);
        overrides.push({
          nodeId: route.targetNodeId,
          kind: 'input',
          portId: route.targetPortId,
          value: coerced,
        });
      }

      midiLoopBridgeActiveKeysByLoopId.set(target.loopId, activeKeys);

      if (removals.length > 0) {
        sendNodeExecutorPluginControl(String(target.clientId), 'override-remove', {
          loopId: target.loopId,
          overrides: removals,
        } as any);
      }

      if (overrides.length > 0) {
        sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
          loopId: target.loopId,
          overrides,
        } as any);
      }
    }
  };

  const computeTopologySignature = (payload: { nodes?: any[]; connections?: any[] }): string => {
    const nodes = (payload.nodes ?? []).map((n: any) => ({
      id: String(n.id),
      type: String(n.type),
    }));
    nodes.sort((a: any, b: any) => a.id.localeCompare(b.id));

    const connections = (payload.connections ?? []).map((c: any) => ({
      s: String(c.sourceNodeId),
      sp: String(c.sourcePortId),
      t: String(c.targetNodeId),
      tp: String(c.targetPortId),
    }));
    connections.sort((a: any, b: any) => {
      const sa = `${a.s}:${a.sp}->${a.t}:${a.tp}`;
      const sb = `${b.s}:${b.sp}->${b.t}:${b.tp}`;
      return sa.localeCompare(sb);
    });

    return JSON.stringify({ nodes, connections });
  };

  const isBypassableWhenDisabled = (nodeId: string): boolean => {
    const node = nodeEngine.getNode(String(nodeId));
    if (!node) return false;

    const def = nodeRegistry.get(String(node.type));
    if (!def) return false;

    const inputs = Array.isArray(def.inputs) ? def.inputs : [];
    const outputs = Array.isArray(def.outputs) ? def.outputs : [];

    const isSafeType = (type: any) => type !== 'command' && type !== 'client';

    const inPort = inputs.find((p: any) => String(p?.id ?? '') === 'in') ?? null;
    const outPort = outputs.find((p: any) => String(p?.id ?? '') === 'out') ?? null;
    if (
      inPort &&
      outPort &&
      String(inPort.type) === String(outPort.type) &&
      isSafeType(inPort.type)
    ) {
      return true;
    }

    if (inputs.length === 1 && outputs.length === 1) {
      const onlyIn: any = inputs[0];
      const onlyOut: any = outputs[0];
      if (String(onlyIn?.type ?? '') === String(onlyOut?.type ?? '') && isSafeType(onlyIn?.type)) {
        return true;
      }
    }

    const sinkInputs = inputs.filter((p: any) => p?.kind === 'sink');
    const sinkOutputs = outputs.filter((p: any) => p?.kind === 'sink');
    if (sinkInputs.length === 1 && sinkOutputs.length === 1) {
      const onlyIn: any = sinkInputs[0];
      const onlyOut: any = sinkOutputs[0];
      if (String(onlyIn?.type ?? '') === String(onlyOut?.type ?? '') && isSafeType(onlyIn?.type)) {
        return true;
      }
    }

    return false;
  };

  const applyTimeRangePlayheadsToPatchPayload = (payload: any) => {
    const nodes = payload?.graph?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) return;

    for (const node of nodes) {
      const type = String(node?.type ?? '');
      if (type !== 'load-audio-from-assets' && type !== 'load-video-from-assets') continue;
      const nodeId = String(node?.id ?? '');
      if (!nodeId) continue;
      const playheadSec = nodeEngine.getTimeRangePlayheadSec(nodeId);
      if (playheadSec === null) continue;

      node.inputValues = { ...(node.inputValues ?? {}), cursorSec: playheadSec };
    }
  };

  type PatchRoot = { id: string; type: string };

  type PatchDeploymentPlan = {
    selectedRoots: PatchRoot[];
    rootIdsByClientId: Map<string, string[]>;
    targetClientIds: string[];
    planKey: string;
  };

  const resolvePatchDeploymentPlan = (): PatchDeploymentPlan | null => {
    const patchRootTypes = ['audio-out', 'image-out', 'video-out', 'effect-out', 'scene-out'] as const;
    const disabled = get(groupController.groupDisabledNodeIds);
    const roots = (graphState.nodes ?? [])
      .filter((n) => patchRootTypes.includes(String(n.type) as any))
      .map((n) => ({ id: String(n.id ?? ''), type: String(n.type ?? '') }))
      .filter((n) => Boolean(n.id));
    const enabledRoots = roots.filter((root) => !disabled.has(root.id));
    if (enabledRoots.length === 0) return null;

    const connectedAll = new Set(clientIdsInOrder());
    const connectedAudience = new Set(audienceClientIdsInOrder());

    const connections = graphState.connections ?? [];

    const activeRoots = enabledRoots.filter((root) =>
      connections.some(
        (c) => String(c.sourceNodeId) === root.id && String(c.sourcePortId) === 'cmd'
      )
    );

    const formatRootList = (items: { id: string; type: string }[]) =>
      items
        .map((r) => `${r.type}:${r.id}`)
        .sort()
        .join(', ');

    const selectedRoots = (() => {
      if (enabledRoots.length === 1) return enabledRoots;
      if (activeRoots.length >= 1) return activeRoots;
      nodeEngine.lastError.set(
        `Multiple patch roots found (${formatRootList(enabledRoots)}). Connect Deploy on one or more roots (or delete the others).`
      );
      return null;
    })();

    if (!selectedRoots) return null;

    const outgoingBySourceKey = new Map<string, (typeof connections)[number][]>();
    for (const c of connections) {
      const key = `${String(c.sourceNodeId)}:${String(c.sourcePortId)}`;
      const list = outgoingBySourceKey.get(key) ?? [];
      list.push(c);
      outgoingBySourceKey.set(key, list);
    }

    const typeById = new Map<string, string>();
    for (const n of graphState.nodes ?? []) {
      const id = String((n as any)?.id ?? '');
      if (!id) continue;
      typeById.set(id, String((n as any)?.type ?? ''));
    }

    const getCommandOutputPorts = (type: string): string[] => {
      const def = nodeRegistry.get(String(type));
      const ports = (def?.outputs ?? []).filter((p) => String(p.type) === 'command');
      return ports.map((p) => String(p.id));
    };

    const isCommandInputPort = (type: string, portId: string): boolean => {
      const def = nodeRegistry.get(String(type));
      const port = (def?.inputs ?? []).find((p) => String(p.id) === String(portId));
      return Boolean(port) && String(port?.type) === 'command';
    };

    const toFiniteNumber = (value: unknown, fallback: number): number => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const resolveClientId = (nodeId: string, outputPortId: string) => {
      const runtimeNode = nodeEngine.getNode(nodeId);
      const runtimeOut = runtimeNode?.outputValues?.[outputPortId] as any;
      const fromOut =
        typeof runtimeOut?.clientId === 'string' ? String(runtimeOut.clientId).trim() : '';
      const fromConfig =
        typeof (runtimeNode?.config as any)?.clientId === 'string'
          ? String((runtimeNode?.config as any).clientId).trim()
          : '';
      return fromOut || fromConfig;
    };

    // Patch deployment treats `client-object` as a selection (index/range/random), so expand it to all target ids.
    const resolveClientNodeTargets = (nodeId: string): string[] => {
      const runtimeNode = nodeEngine.getNode(nodeId);
      if (!runtimeNode) return [];
      const computed = nodeEngine.getLastComputedInputs(nodeId);
      const isPortConnected = (portId: string) =>
        connections.some(
          (c) =>
            String(c.targetNodeId) === String(nodeId) && String(c.targetPortId) === String(portId)
        );
      const getEffectiveInput = (portId: 'index' | 'range' | 'random'): unknown => {
        const connected = isPortConnected(portId);
        if (connected && computed && Object.prototype.hasOwnProperty.call(computed, portId)) {
          return (computed as any)[portId];
        }
        return (runtimeNode.inputValues as any)?.[portId];
      };

      const clients = audienceClientIdsInOrder();
      const total = clients.length;
      if (total === 0) return [];

      const randomRaw = getEffectiveInput('random');
      const random = coerceBoolean(randomRaw, false);
      const ordered = random ? buildStableRandomOrder(nodeId, clients) : clients;

      const primaryId = resolveClientId(nodeId, 'out');
      const indexRaw = getEffectiveInput('index');
      const indexCandidate = toFiniteNumber(indexRaw, Number.NaN);
      const indexFromInput = Number.isFinite(indexCandidate)
        ? clampInt(indexCandidate, 1, total)
        : null;
      const indexFromPrimary = primaryId ? ordered.indexOf(primaryId) + 1 : 0;
      const index = indexFromInput ?? (indexFromPrimary > 0 ? indexFromPrimary : 1);

      const rangeRaw = getEffectiveInput('range');
      const rangeCandidate = toFiniteNumber(rangeRaw, 1);
      const range = clampInt(rangeCandidate, 1, total);

      const ids: string[] = [];
      const start = index - 1;
      for (let i = 0; i < range; i += 1) {
        ids.push(ordered[(start + i) % total]);
      }
      return ids;
    };

    // Patch target routing (Max/MSP style):
    // - Direct: `<patch-root>(cmd) -> client-object(in)`.
    // - Indirect (supported): `<patch-root>(cmd) -> cmd-aggregator(...) -> client-object(in)`.
    // We follow the command-type subgraph starting from `<patch-root>(cmd)` to find target objects.
    const resolveTargetsForRoot = (rootId: string): string[] => {
      const routedClientNodeIds: string[] = [];
      const routedClientNodeIdSet = new Set<string>();
      let hasDisplayTarget = false;

      const queue: { nodeId: string; portId: string }[] = [{ nodeId: rootId, portId: 'cmd' }];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const next = queue.shift()!;
        const visitKey = `${next.nodeId}:${next.portId}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        const outgoing = outgoingBySourceKey.get(visitKey) ?? [];
        for (const c of outgoing) {
          const targetNodeId = String((c as any)?.targetNodeId ?? '');
          if (!targetNodeId) continue;
          const targetPortId = String((c as any)?.targetPortId ?? '');

          const targetType = typeById.get(targetNodeId) ?? '';
          if (!targetType) continue;
          if (!isCommandInputPort(targetType, targetPortId)) continue;

          if (targetType === 'display-object') {
            hasDisplayTarget = true;
            continue;
          }

          if (targetType === 'client-object') {
            if (!routedClientNodeIdSet.has(targetNodeId)) {
              routedClientNodeIdSet.add(targetNodeId);
              routedClientNodeIds.push(targetNodeId);
            }
            continue;
          }

          // Continue walking through any node that can output commands.
          for (const outPortId of getCommandOutputPorts(targetType)) {
            queue.push({ nodeId: targetNodeId, portId: outPortId });
          }
        }
      }

      const out: string[] = [];
      const seen = new Set<string>();

      for (const nodeId of routedClientNodeIds) {
        const ids = resolveClientNodeTargets(nodeId);
        for (const id of ids) {
          if (!id || !connectedAudience.has(id) || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }

      if (hasDisplayTarget) {
        const bridge = get(displayBridgeState);
        if (bridge.status === 'connected' && !seen.has(LOCAL_DISPLAY_TARGET_ID)) {
          seen.add(LOCAL_DISPLAY_TARGET_ID);
          out.push(LOCAL_DISPLAY_TARGET_ID);
        }

        const displayIds = (get(managerState).clients ?? [])
          .filter((c: any) => String(c?.group ?? '') === 'display')
          .map((c: any) => String(c?.clientId ?? ''))
          .filter((id) => Boolean(id) && connectedAll.has(id));

        for (const id of displayIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }

      return out;
    };

    const rootIdSetByClientId = new Map<string, Set<string>>();
    for (const root of selectedRoots) {
      const targets = resolveTargetsForRoot(root.id);
      for (const targetId of targets) {
        const set = rootIdSetByClientId.get(targetId) ?? new Set<string>();
        set.add(root.id);
        rootIdSetByClientId.set(targetId, set);
      }
    }

    if (rootIdSetByClientId.size === 0) return null;

    const rootIdsByClientId = new Map<string, string[]>();
    for (const [clientId, set] of rootIdSetByClientId.entries()) {
      rootIdsByClientId.set(clientId, Array.from(set).sort());
    }

    const targetClientIds: string[] = [];
    const seenTargets = new Set<string>();

    if (rootIdsByClientId.has(LOCAL_DISPLAY_TARGET_ID)) {
      targetClientIds.push(LOCAL_DISPLAY_TARGET_ID);
      seenTargets.add(LOCAL_DISPLAY_TARGET_ID);
    }

    for (const id of clientIdsInOrder()) {
      if (!rootIdsByClientId.has(id) || seenTargets.has(id)) continue;
      seenTargets.add(id);
      targetClientIds.push(id);
    }

    const leftovers = Array.from(rootIdsByClientId.keys())
      .filter((id) => !seenTargets.has(id))
      .sort();
    for (const id of leftovers) {
      seenTargets.add(id);
      targetClientIds.push(id);
    }

    const prevError = get(nodeEngine.lastError);
    if (
      typeof prevError === 'string' &&
      (prevError.startsWith('Multiple patch roots found') ||
        prevError.startsWith('Multiple active patch roots found') ||
        prevError.startsWith('Multiple active patch roots have different targets'))
    ) {
      nodeEngine.lastError.set(null);
    }

    const planKey = Array.from(rootIdsByClientId.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clientId, rootIds]) => `${clientId}=${rootIds.join(',')}`)
      .join('|');

    return { selectedRoots, rootIdsByClientId, targetClientIds, planKey };
  };

  const resolvePatchTargetClientIds = (): string[] =>
    resolvePatchDeploymentPlan()?.targetClientIds ?? [];

  const stopAndRemovePatchOnClient = (clientId: string, patchId: string) => {
    const id = String(clientId ?? '');
    const loopId = String(patchId ?? '');
    if (!id || !loopId) return;
    sendNodeExecutorPluginControl(id, 'stop', { loopId } as any);
    sendNodeExecutorPluginControl(id, 'remove', { loopId } as any);
  };

  const stopAllDeployedPatches = () => {
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      stopAndRemovePatchOnClient(clientId, patch.patchId);
    }
    deployedPatchByClientId = new Map();
    patchLastPlanKey = '';
    clearMidiBridgeState();
    syncPatchOffloadState(new Set());
    void applyPatchHighlights(new Set());
  };

  const reconcilePatchDeployment = (reason: string) => {
    if (!get(isRunningStore)) {
      stopAllDeployedPatches();
      return;
    }

    const sdk = getSDK();
    if (!sdk) return;

    const plan = resolvePatchDeploymentPlan();
    patchLastPlanKey = plan?.planKey ?? '';
    if (!plan || plan.targetClientIds.length === 0) {
      if (deployedPatchByClientId.size > 0) stopAllDeployedPatches();
      return;
    }

    const localOnlyNodeTypes = new Set([
      'load-audio-from-local',
      'load-image-from-local',
      'load-video-from-local',
    ]);
    const disabled = get(groupController.groupDisabledNodeIds);
    const statusMap = get(executorStatusByClient);

    const desiredByClientId = new Map<
      string,
      {
        patchId: string;
        nodeIds: Set<string>;
        topologySignature: string;
        payload: any;
      }
    >();
    const desiredNodeIds = new Set<string>();
    const retainedClientIds = new Set<string>();

    const groupsByRootKey = new Map<string, { rootIds: string[]; clientIds: string[] }>();
    for (const [clientId, rootIds] of plan.rootIdsByClientId.entries()) {
      const key = rootIds.join('|');
      const group = groupsByRootKey.get(key) ?? { rootIds, clientIds: [] };
      group.clientIds.push(String(clientId));
      groupsByRootKey.set(key, group);
    }

    for (const group of groupsByRootKey.values()) {
      let payload: any;
      try {
        payload = nodeEngine.exportGraphForPatchFromRootNodeIds(group.rootIds);
      } catch (err) {
        nodeEngine.lastError.set(err instanceof Error ? err.message : 'Export patch failed');
        for (const clientId of group.clientIds) retainedClientIds.add(String(clientId));
        continue;
      }

      let targets = group.clientIds.slice();
      const applyLocalOnlyTargetFilter = () => {
        const isLocalOnlyPatch = (payload?.graph?.nodes ?? []).some((n: any) =>
          localOnlyNodeTypes.has(String(n?.type ?? ''))
        );
        if (!isLocalOnlyPatch) return true;

        const displayTargets = targets.filter((id) => isDisplayTarget(id));
        if (displayTargets.length === 0) {
          nodeEngine.lastError.set(
            'Load * From Local(Display only) requires a Display target (connect Deploy to Display).'
          );
          return false;
        }
        targets = displayTargets;
        return true;
      };

      if (!applyLocalOnlyTargetFilter() || targets.length === 0) continue;

      let nodeIds = new Set((payload?.graph?.nodes ?? []).map((n: any) => String(n.id)));
      let hasDisabledNodes = Array.from(nodeIds).some((id) => disabled.has(id));

      // Disabled nodes do not exist on the client runtime; drop roots that include disabled nodes so other roots can
      // still deploy and run.
      if (hasDisabledNodes && group.rootIds.length > 1) {
        const enabledRoots: string[] = [];
        for (const rootId of group.rootIds) {
          try {
            const rootPayload = nodeEngine.exportGraphForPatchFromRootNodeIds([rootId]);
            const rootNodeIds = new Set(
              (rootPayload?.graph?.nodes ?? []).map((n: any) => String(n.id))
            );
            const rootHasDisabled = Array.from(rootNodeIds).some((id) => disabled.has(id));
            if (!rootHasDisabled) enabledRoots.push(rootId);
          } catch {
            // ignore roots that fail to export
          }
        }

        if (enabledRoots.length === 0) {
          nodeEngine.lastError.set(
            'Patch contains disabled nodes; enable them or remove from deploy.'
          );
          continue;
        }

        try {
          payload = nodeEngine.exportGraphForPatchFromRootNodeIds(enabledRoots);
        } catch (err) {
          nodeEngine.lastError.set(err instanceof Error ? err.message : 'Export patch failed');
          continue;
        }

        targets = group.clientIds.slice();
        if (!applyLocalOnlyTargetFilter() || targets.length === 0) continue;

        nodeIds = new Set((payload?.graph?.nodes ?? []).map((n: any) => String(n.id)));
        hasDisabledNodes = Array.from(nodeIds).some((id) => disabled.has(id));
      }

      if (hasDisabledNodes) {
        nodeEngine.lastError.set(
          'Patch contains disabled nodes; enable them or remove from deploy.'
        );
        continue;
      }

      const topologySignature = computeTopologySignature(payload.graph ?? {});
      const patchId = String(payload?.meta?.loopId ?? '');

      applyTimeRangePlayheadsToPatchPayload(payload);

      for (const nodeId of nodeIds) desiredNodeIds.add(nodeId);
      for (const clientId of targets) {
        desiredByClientId.set(String(clientId), { patchId, nodeIds, topologySignature, payload });
      }
    }

    for (const clientId of retainedClientIds) {
      const deployed = deployedPatchByClientId.get(clientId);
      if (!deployed) continue;
      for (const nodeId of deployed.nodeIds) desiredNodeIds.add(nodeId);
    }

    if (desiredByClientId.size === 0) {
      if (retainedClientIds.size === 0) {
        if (deployedPatchByClientId.size > 0) stopAllDeployedPatches();
      } else {
        syncPatchOffloadState(desiredNodeIds);
        void applyPatchHighlights(desiredNodeIds);
        const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
        if (first) syncMidiBridgeRoutes(first.patchId, desiredNodeIds);
      }
      return;
    }

    // Stop/remove patches on clients that are no longer targeted.
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      if (desiredByClientId.has(clientId) || retainedClientIds.has(clientId)) continue;
      stopAndRemovePatchOnClient(clientId, patch.patchId);
      deployedPatchByClientId.delete(clientId);
    }

    let didDeploy = false;
    for (const [clientId, desired] of desiredByClientId.entries()) {
      const deployed = deployedPatchByClientId.get(clientId) ?? null;
      const status = statusMap.get(clientId) ?? null;

      const needDeploy =
        !deployed ||
        deployed.patchId !== desired.patchId ||
        deployed.topologySignature !== desired.topologySignature ||
        (status?.loopId && status.loopId !== desired.patchId);

      if (!needDeploy) {
        // Best-effort: if the patch is targeted but was stopped on the client, restart it.
        if (status?.loopId === desired.patchId && status.running === false) {
          sendNodeExecutorPluginControl(String(clientId), 'start', {
            loopId: desired.patchId,
          } as any);
        }

        // Keep nodeId membership up to date for per-node override routing.
        deployedPatchByClientId.set(String(clientId), {
          patchId: desired.patchId,
          nodeIds: desired.nodeIds,
          topologySignature: desired.topologySignature,
          deployedAt: deployed?.deployedAt ?? Date.now(),
        });
        continue;
      }

      if (!didDeploy) {
        // A deploy resets client overrides; ensure MIDI bridge resend starts fresh.
        midiBridgeLastSignatureByClientKey = new Map();
        midiBridgeActiveKeysByClientId = new Map();
        didDeploy = true;
      }

      sendNodeExecutorPluginControl(String(clientId), 'deploy', desired.payload);
      sendNodeExecutorPluginControl(String(clientId), 'start', { loopId: desired.patchId } as any);

      deployedPatchByClientId.set(String(clientId), {
        patchId: desired.patchId,
        nodeIds: desired.nodeIds,
        topologySignature: desired.topologySignature,
        deployedAt: Date.now(),
      });
    }

    // MIDI wiring is manager-only; keep bridge routes in sync even when the deploy graph is unchanged.
    const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
    syncPatchOffloadState(desiredNodeIds);
    void applyPatchHighlights(desiredNodeIds);
    if (first) syncMidiBridgeRoutes(first.patchId, desiredNodeIds);
    console.log('[patch] reconciled', {
      reason,
      targets: Array.from(desiredByClientId.keys()).sort(),
    });
  };

  const schedulePatchReconcile = (reason: string) => {
    if (patchDeployTimer) clearTimeout(patchDeployTimer);
    patchDeployTimer = setTimeout(() => {
      patchDeployTimer = null;
      reconcilePatchDeployment(reason);
    }, 320);
  };

  const toggleExecutorLogs = () => {
    const show = get(showExecutorLogs);
    const current = get(logsClientId);
    const patchTargets = resolvePatchTargetClientIds();
    const selected = (get(managerState).selectedClientIds ?? []).map(String).filter(Boolean);
    const targetId = patchTargets[0] ?? selected[0] ?? clientIdsInOrder()[0] ?? '';
    if (!targetId) return;

    if (show && current === targetId) {
      showExecutorLogs.set(false);
      return;
    }
    logsClientId.set(targetId);
    showExecutorLogs.set(true);
  };

  const isInputConnected = (nodeId: string, portId: string) =>
    (graphState.connections ?? []).some(
      (c) => String(c.targetNodeId) === String(nodeId) && String(c.targetPortId) === String(portId)
    );

  // ===== Sleep Node Dynamic Output =====
  const getOutputPortType = (nodeId: string, portId: string): PortType => {
    const node = (graphState.nodes ?? []).find((n) => String(n.id) === String(nodeId));
    if (!node) return 'any';
    const def = nodeRegistry.get(String(node.type));
    const port = def?.outputs?.find((p) => p.id === portId);
    return (port?.type ?? 'any') as PortType;
  };

  const resolveSleepOutputType = (nodeId: string): { type: PortType; hasInput: boolean } => {
    const conn = (graphState.connections ?? []).find(
      (c) => String(c.targetNodeId) === String(nodeId) && String(c.targetPortId) === 'input'
    );
    if (!conn) return { type: 'any', hasInput: false };
    return { type: getOutputPortType(conn.sourceNodeId, conn.sourcePortId), hasInput: true };
  };

  const syncSleepNodeSockets = async (state: GraphState) => {
    if (!areaPlugin) return;
    const nodes = state.nodes ?? [];
    if (nodes.length === 0) return;

    for (const node of nodes) {
      if (String(node.type) !== 'logic-sleep') continue;
      const reteNode = nodeMap.get(String(node.id));
      const output = reteNode?.outputs?.output;
      if (!reteNode || !output) continue;

      const { type, hasInput } = resolveSleepOutputType(String(node.id));
      const nextSocket = (sockets as any)[type] ?? sockets.any;
      const nextDisabled = !hasInput;
      const prevSocket = output.socket;
      const prevDisabled = Boolean(output.disabled);

      if (prevSocket !== nextSocket || prevDisabled !== nextDisabled) {
        output.socket = nextSocket;
        output.disabled = nextDisabled;
        await areaPlugin.update('node', String(node.id));
      }
    }
  };

  const computeClientSlice = (
    nodeId: string,
    indexRaw: number,
    rangeRaw: number,
    randomRaw: unknown
  ) => {
    const clients = audienceClientIdsInOrder();
    if (clients.length === 0) return null;

    const total = clients.length;
    const range = clampInt(rangeRaw, 1, total);
    const index = clampInt(indexRaw, 1, total);
    const random = coerceBoolean(randomRaw, false);

    const ids: string[] = [];
    const ordered = random ? buildStableRandomOrder(nodeId, clients) : clients;
    const start = index - 1;
    for (let i = 0; i < range; i += 1) {
      ids.push(ordered[(start + i) % total]);
    }

    const firstId = ids[0] ?? '';
    return { index, range, total, maxIndex: total, ids, firstId, random };
  };

  const syncClientNodeUi = async (
    nodeId: string,
    slice: ReturnType<typeof computeClientSlice>,
    opts?: { updateInputs?: boolean; updateControls?: boolean; updateConfig?: boolean }
  ) => {
    if (!slice) return;
    const node = nodeEngine.getNode(nodeId);
    if (!node || node.type !== 'client-object') return;
    const updateInputs = opts?.updateInputs !== false;
    const updateControls = opts?.updateControls !== false;
    const updateConfig = opts?.updateConfig !== false;

    // Keep node config in sync so labels + loop deploy use the selected client.
    const currentClientId =
      typeof (node.config as any)?.clientId === 'string'
        ? String((node.config as any).clientId)
        : '';
    if (updateConfig) {
      if (slice.firstId && slice.firstId !== currentClientId) {
        nodeEngine.updateNodeConfig(nodeId, { clientId: slice.firstId });
      } else if (!slice.firstId && currentClientId) {
        nodeEngine.updateNodeConfig(nodeId, { clientId: '' });
      }
    }

    // Clamp + persist unconnected inputs (connected inputs are driven by upstream nodes).
    if (updateInputs) {
      if (!isInputConnected(nodeId, 'index'))
        nodeEngine.updateNodeInputValue(nodeId, 'index', slice.index);
      if (!isInputConnected(nodeId, 'range'))
        nodeEngine.updateNodeInputValue(nodeId, 'range', slice.range);
    }

    // Keep live display outputs usable even when the engine is stopped.
    (node.outputValues as any).indexOut = slice.index;
    (node.outputValues as any).out = {
      clientId: slice.firstId,
      sensors: (() => {
        const latest: any = slice.firstId ? get(sensorData)?.get?.(slice.firstId) : null;
        if (!latest) return null;
        return {
          sensorType: latest.sensorType,
          payload: latest.payload,
          serverTimestamp: latest.serverTimestamp,
          clientTimestamp: latest.clientTimestamp,
        };
      })(),
    };
    nodeEngine.tickTime.set(Date.now());

    const reteNode = nodeMap.get(String(nodeId));
    if (!reteNode || !areaPlugin) return;

    const indexCtrl: any = reteNode?.inputs?.index?.control;
    const rangeCtrl: any = reteNode?.inputs?.range?.control;

    if (indexCtrl && updateControls) {
      indexCtrl.min = 1;
      indexCtrl.max = slice.maxIndex;
      indexCtrl.step = 1;
      indexCtrl.value = slice.index;
    }
    if (rangeCtrl && updateControls) {
      rangeCtrl.min = 1;
      rangeCtrl.max = slice.total;
      rangeCtrl.step = 1;
      rangeCtrl.value = slice.range;
    }

    await areaPlugin.update('node', String(nodeId));
  };

  const applyClientNodeSelection = async (
    nodeId: string,
    next: { index?: number; range?: number; clientId?: string; random?: boolean }
  ) => {
    const clients = audienceClientIdsInOrder();
    if (clients.length === 0) return;

    const node = nodeEngine.getNode(nodeId);
    if (!node || node.type !== 'client-object') return;

    const computed = nodeEngine.getLastComputedInputs(nodeId);
    const getEffectiveInput = (portId: 'index' | 'range' | 'random'): unknown => {
      const connected = isInputConnected(nodeId, portId);
      if (connected && computed && Object.prototype.hasOwnProperty.call(computed, portId)) {
        return (computed as any)[portId];
      }
      return (node.inputValues as any)?.[portId];
    };

    const currentIndexRaw = toFiniteNumber(getEffectiveInput('index'), 1);
    const currentRangeRaw = toFiniteNumber(getEffectiveInput('range'), 1);
    const currentRandomRaw = getEffectiveInput('random');

    const desiredRandom =
      typeof next.random === 'boolean' ? next.random : coerceBoolean(currentRandomRaw, false);

    let desiredIndex =
      typeof next.index === 'number' && Number.isFinite(next.index) ? next.index : currentIndexRaw;
    let desiredRange =
      typeof next.range === 'number' && Number.isFinite(next.range) ? next.range : currentRangeRaw;

    // Client picker binding: treat clicks as "toggle this client in the range selection" and
    // translate them to index/range updates (single source of truth per node). If index/range are
    // externally connected, the picker becomes display-only.
    if (
      typeof next.clientId === 'string' &&
      next.clientId &&
      !(typeof next.index === 'number') &&
      !(typeof next.range === 'number')
    ) {
      if (isInputConnected(nodeId, 'index') || isInputConnected(nodeId, 'range')) return;

      const total = clients.length;
      const ordered = desiredRandom ? buildStableRandomOrder(nodeId, clients) : clients;
      const clickedPos = ordered.indexOf(next.clientId);
      if (clickedPos >= 0 && total > 0) {
        const dist = (from: number, to: number) => (to - from + total) % total;
        const currentIndex = clampInt(currentIndexRaw, 1, total);
        const currentRange = clampInt(currentRangeRaw, 1, total);
        const startPos = currentIndex - 1;
        const endPos = (startPos + currentRange - 1) % total;

        const offset = dist(startPos, clickedPos);
        const isSelected = offset < currentRange;

        if (!isSelected) {
          const extendRange = offset + 1; // include clicked by extending end forward
          const shiftRange = dist(clickedPos, endPos) + 1; // include clicked by shifting start back
          if (shiftRange < extendRange) {
            desiredIndex = clickedPos + 1;
            desiredRange = shiftRange;
          } else {
            desiredIndex = currentIndex;
            desiredRange = extendRange;
          }
        } else {
          const prefixLen = offset; // clients before clicked in current selection
          const suffixLen = dist(clickedPos, endPos); // clients after clicked in current selection

          if (prefixLen === 0 && suffixLen === 0) {
            // Can't represent an empty selection; move the window forward so the clicked client
            // is no longer selected while keeping range=1.
            desiredIndex = ((startPos + 1) % total) + 1;
            desiredRange = 1;
          } else if (suffixLen > prefixLen) {
            desiredIndex = ((clickedPos + 1) % total) + 1;
            desiredRange = suffixLen;
          } else {
            desiredIndex = currentIndex;
            desiredRange = prefixLen;
          }
        }
      }
    }

    const slice = computeClientSlice(nodeId, desiredIndex, desiredRange, desiredRandom);
    if (!slice) return;

    // When the picker drives index/range, also forward overrides to any deployed loop/patch runtime.
    // (Input controls already do this via their own change handlers.)
    const pickerOnlyChange =
      typeof next.clientId === 'string' &&
      next.clientId &&
      typeof next.index !== 'number' &&
      typeof next.range !== 'number' &&
      typeof next.random !== 'boolean';
    if (pickerOnlyChange) {
      sendNodeOverride(nodeId, 'input', 'index', slice.index);
      sendNodeOverride(nodeId, 'input', 'range', slice.range);
    }

    await syncClientNodeUi(nodeId, slice);
  };

  const syncClientNodesFromInputs = () => {
    const clients = audienceClientIdsInOrder();
    if (clients.length === 0) return;

    const engineState = get(graphStateStore);
    for (const node of engineState.nodes ?? []) {
      if (String(node.type) !== 'client-object') continue;
      const nodeId = String(node.id);
      const nodeInstance = nodeEngine.getNode(nodeId);
      const computed = nodeEngine.getLastComputedInputs(nodeId);
      const useComputedIndex = isInputConnected(nodeId, 'index');
      const useComputedRange = isInputConnected(nodeId, 'range');
      const useComputedRandom = isInputConnected(nodeId, 'random');
      const indexRaw = toFiniteNumber(
        useComputedIndex && computed && Object.prototype.hasOwnProperty.call(computed, 'index')
          ? (computed as any).index
          : (nodeInstance?.inputValues as any)?.index,
        1
      );
      const rangeRaw = toFiniteNumber(
        useComputedRange && computed && Object.prototype.hasOwnProperty.call(computed, 'range')
          ? (computed as any).range
          : (nodeInstance?.inputValues as any)?.range,
        1
      );
      const randomRaw =
        useComputedRandom && computed && Object.prototype.hasOwnProperty.call(computed, 'random')
          ? (computed as any).random
          : (nodeInstance?.inputValues as any)?.random;
      const slice = computeClientSlice(nodeId, indexRaw, rangeRaw, randomRaw);
      if (!slice) continue;
      void syncClientNodeUi(nodeId, slice);
    }
  };

  const sendNodeOverride = (
    nodeId: string,
    kind: 'input' | 'config',
    portId: string,
    value: unknown
  ) => {
    if (!nodeId || !portId) return;

    const node = graphState.nodes.find((n) => String(n.id) === String(nodeId));
    if (node?.type === 'client-object' && kind === 'config' && portId === 'clientId') return;

    const loop = loopController?.loopActions.getDeployedLoopForNode(nodeId);
    if (loop) {
      // Important: once a loop is deployed, the executor client is the "source of truth" for where to send overrides.
      // Using the current `client-object.config.clientId` is incorrect because Index/Range changes can retarget the
      // picker selection without redeploying the loop.
      const deployedClientId = (() => {
        const statusMap = get(executorStatusByClient);
        for (const [cid, status] of statusMap.entries()) {
          if (String((status as any)?.loopId ?? '') === String(loop.id)) return String(cid);
        }
        return '';
      })();

      const clientId = deployedClientId || loopController?.loopActions.getLoopClientId(loop);
      if (!clientId) return;

      sendNodeExecutorPluginControl(clientId, 'override-set', {
        loopId: loop.id,
        overrides: [{ nodeId, kind, portId, value, ttlMs: OVERRIDE_TTL_MS }],
      } as any);

      // Commit: persist the latest value after inactivity (debounced).
      const key = `${clientId}|${loop.id}|${nodeId}|${kind}|${portId}`;
      const existing = patchPendingCommitByKey.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        patchPendingCommitByKey.delete(key);
        sendNodeExecutorPluginControl(clientId, 'override-set', {
          loopId: loop.id,
          overrides: [{ nodeId, kind, portId, value }],
        } as any);
      }, 420);
      patchPendingCommitByKey.set(key, timer);
      return;
    }

    const nodeKey = String(nodeId);
    const patchTargets: { clientId: string; patch: DeployedPatch }[] = [];
    for (const [clientId, patch] of deployedPatchByClientId.entries()) {
      if (patch.nodeIds.has(nodeKey)) patchTargets.push({ clientId, patch });
    }
    if (patchTargets.length === 0) return;

    for (const target of patchTargets) {
      sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
        loopId: target.patch.patchId,
        overrides: [{ nodeId, kind, portId, value, ttlMs: OVERRIDE_TTL_MS }],
      } as any);

      const key = `${target.clientId}|${target.patch.patchId}|${nodeId}|${kind}|${portId}`;
      const existing = patchPendingCommitByKey.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        patchPendingCommitByKey.delete(key);
        sendNodeExecutorPluginControl(String(target.clientId), 'override-set', {
          loopId: target.patch.patchId,
          overrides: [{ nodeId, kind, portId, value }],
        } as any);
      }, 420);
      patchPendingCommitByKey.set(key, timer);
    }
  };

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

  const isGroupPortNodeType = (type: string) => type === GROUP_ACTIVATE_NODE_TYPE;

  const groupIdFromNode = (node: NodeInstance): string => {
    const raw = (node.config as any)?.groupId;
    return typeof raw === 'string' ? raw : raw ? String(raw) : '';
  };

  const buildGroupPortIndex = (state: GraphState) => {
    const byGroupId = new Map<string, { activateId?: string }>();

    for (const node of state.nodes ?? []) {
      const type = String(node.type ?? '');
      if (!isGroupPortNodeType(type)) continue;
      const groupId = groupIdFromNode(node);
      if (!groupId) continue;

      const entry = byGroupId.get(groupId) ?? {};
      if (type === GROUP_ACTIVATE_NODE_TYPE && !entry.activateId)
        entry.activateId = String(node.id);
      byGroupId.set(groupId, entry);
    }

    return byGroupId;
  };

  const computeGroupNodeBounds = (group: any, state: GraphState) => {
    const ids = Array.isArray(group?.nodeIds) ? group.nodeIds.map(String).filter(Boolean) : [];
    if (ids.length === 0) return null;

    const nodeById = new Map((state.nodes ?? []).map((n) => [String(n.id), n]));

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const id of ids) {
      const node = nodeById.get(id);
      if (!node) continue;
      const x = Number(node.position?.x ?? 0);
      const y = Number(node.position?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const ok =
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxY);
    if (!ok) return null;

    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  };

  const addGroupPortNode = (type: string, groupId: string, position: { x: number; y: number }) => {
    const def = nodeRegistry.get(type);
    if (!def) return '';

    const config: Record<string, unknown> = {};
    for (const field of def.configSchema) config[field.key] = field.defaultValue;
    config.groupId = groupId;

    const newNode: NodeInstance = {
      id: generateId(),
      type,
      position,
      config,
      inputValues: {},
      outputValues: {},
    };

    nodeEngine.addNode(newNode);
    return newNode.id;
  };

  const ensureGroupPortNodes = () => {
    const groups = get(groupController.nodeGroups);
    if (groups.length === 0) return;

    const state = nodeEngine.exportGraph();
    const index = buildGroupPortIndex(state);

    for (const group of groups) {
      const groupId = String(group?.id ?? '');
      if (!groupId) continue;
      const existing = index.get(groupId) ?? {};
      if (existing.activateId) continue;

      const bounds = computeGroupNodeBounds(group, state);
      const baseX = bounds ? bounds.centerX : 120 + nodeCount * 10;
      const baseY = bounds ? bounds.centerY : 120 + nodeCount * 6;
      const leftX = bounds ? bounds.minX : baseX;

      if (!existing.activateId) {
        addGroupPortNode(GROUP_ACTIVATE_NODE_TYPE, groupId, { x: leftX - 140, y: baseY - 20 });
      }
    }
  };

  let groupPortAlignRaf = 0;
  const scheduleGroupPortAlign = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (groupPortAlignRaf) return;
    groupPortAlignRaf = requestAnimationFrame(() => {
      groupPortAlignRaf = 0;
      alignGroupPortNodes();
    });
  };

  const alignGroupPortNodes = () => {
    const frames = get(groupFrames);
    if (frames.length === 0) return;

    const state = nodeEngine.exportGraph();
    const index = buildGroupPortIndex(state);

    groupController.beginProgrammaticTranslate();
    try {
      for (const frame of frames) {
        const groupId = String(frame.group?.id ?? '');
        if (!groupId) continue;
        const ports = index.get(groupId);
        if (!ports) continue;

        const centerY = frame.top + frame.height / 2;

        if (ports.activateId) {
          const nodeId = String(ports.activateId);
          const b = viewAdapter.getNodeBounds(nodeId);
          const w = b ? b.right - b.left : 72;
          const h = b ? b.bottom - b.top : 40;
          // Place the Activate port fully outside the Group frame (to the left) with a small gap,
          // instead of straddling the frame edge.
          const gap = 18;
          const desiredX = frame.left - w - gap;
          const desiredY = centerY - h / 2;
          const cur = viewAdapter.getNodePosition(nodeId);
          if (!cur || Math.abs(cur.x - desiredX) > 1 || Math.abs(cur.y - desiredY) > 1) {
            viewAdapter.setNodePosition(nodeId, desiredX, desiredY);
          }
        }
      }
    } finally {
      groupController.endProgrammaticTranslate();
    }
  };

  const updateGroupRuntimeActives = () => {
    const groups = get(groupController.nodeGroups);
    if (groups.length === 0) return;

    const state = nodeEngine.exportGraph();
    const activeByGroupId = new Map<string, boolean>();

    for (const node of state.nodes ?? []) {
      if (String(node.type) !== GROUP_ACTIVATE_NODE_TYPE) continue;
      const groupId = groupIdFromNode(node);
      if (!groupId) continue;
      const raw = (node.outputValues as any)?.active;
      activeByGroupId.set(groupId, typeof raw === 'boolean' ? raw : true);
    }

    groupController.setRuntimeActiveByGroupId(activeByGroupId);
  };

  const removeGroupPortNodesForGroupIds = (groupIds: string[]): number => {
    const ids = new Set((groupIds ?? []).map((id) => String(id)).filter(Boolean));
    if (ids.size === 0) return 0;

    let removed = 0;
    const state = nodeEngine.exportGraph();
    for (const node of state.nodes ?? []) {
      const type = String(node.type ?? '');
      if (!isGroupPortNodeType(type)) continue;
      const groupId = groupIdFromNode(node);
      if (!groupId || !ids.has(groupId)) continue;
      nodeEngine.removeNode(String(node.id));
      removed += 1;
    }

    return removed;
  };

  const disassembleGroupAndPorts = (groupId: string) => {
    const rootId = String(groupId ?? '');
    if (!rootId) return;

    const groupsSnapshot = get(groupController.nodeGroups);
    const toRemove = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || toRemove.has(id)) continue;
      toRemove.add(id);
      for (const g of groupsSnapshot) {
        if (String(g.parentId ?? '') === id) stack.push(String(g.id));
      }
    }

    groupController.disassembleGroup(rootId);
    removeGroupPortNodesForGroupIds(Array.from(toRemove));
  };

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

  // Clipboard helpers for node copy/paste.
  const cloneNodeInstance = (
    node: NodeInstance,
    positionOverride?: { x: number; y: number } | null
  ): NodeInstance => ({
    id: String(node.id),
    type: node.type,
    position: {
      x: Number(positionOverride?.x ?? node.position?.x ?? 0),
      y: Number(positionOverride?.y ?? node.position?.y ?? 0),
    },
    config: { ...(node.config ?? {}) },
    inputValues: { ...(node.inputValues ?? {}) },
    outputValues: { ...(node.outputValues ?? {}) },
  });

  const collectCopySelection = (): { nodes: NodeInstance[]; ids: string[] } => {
    const selected = get(groupController.groupSelectionNodeIds);
    const ids =
      selected.size > 0
        ? Array.from(selected).map(String)
        : selectedNodeId
          ? [String(selectedNodeId)]
          : [];
    if (ids.length === 0) return { nodes: [], ids: [] };

    const nodeById = new Map(graphState.nodes.map((node) => [String(node.id), node]));
    const nodes = ids.map((id) => nodeById.get(id)).filter(Boolean) as NodeInstance[];
    return {
      nodes: nodes.map((node) =>
        cloneNodeInstance(node, viewAdapter.getNodePosition(String(node.id)))
      ),
      ids,
    };
  };

  const collectCopyConnections = (ids: string[]): EngineConnection[] => {
    const set = new Set(ids.map(String));
    return (graphState.connections ?? [])
      .filter((c) => set.has(String(c.sourceNodeId)) && set.has(String(c.targetNodeId)))
      .map((c) => ({
        id: String(c.id),
        sourceNodeId: String(c.sourceNodeId),
        sourcePortId: String(c.sourcePortId),
        targetNodeId: String(c.targetNodeId),
        targetPortId: String(c.targetPortId),
      }));
  };

  const copySelectedNodes = () => {
    const { nodes, ids } = collectCopySelection();
    if (nodes.length === 0) return false;
    clipboardNodes = nodes;
    clipboardConnections = collectCopyConnections(ids);
    clipboardPasteIndex = 0;
    return true;
  };

  const computePasteAnchor = () => {
    if (!container) return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const rect = container.getBoundingClientRect();
    const within =
      lastPointerClient.x >= rect.left &&
      lastPointerClient.x <= rect.right &&
      lastPointerClient.y >= rect.top &&
      lastPointerClient.y <= rect.bottom;
    if (within) return computeGraphPosition(lastPointerClient.x, lastPointerClient.y);
    return computeGraphPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const pasteCopiedNodes = () => {
    if (clipboardNodes.length === 0) return false;

    const anchor = computePasteAnchor();
    const positions = clipboardNodes.map((node) => node.position);
    const minX = Math.min(...positions.map((p) => p.x));
    const minY = Math.min(...positions.map((p) => p.y));
    const maxX = Math.max(...positions.map((p) => p.x));
    const maxY = Math.max(...positions.map((p) => p.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nudge = clipboardPasteIndex * 28;
    const offsetX = anchor.x - centerX + nudge;
    const offsetY = anchor.y - centerY + nudge;

    const newIds: string[] = [];
    const idMap = new Map<string, string>();
    for (const node of clipboardNodes) {
      const newId = generateId();
      const position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
      const newNode: NodeInstance = {
        id: newId,
        type: node.type,
        position,
        config: { ...(node.config ?? {}) },
        inputValues: { ...(node.inputValues ?? {}) },
        outputValues: { ...(node.outputValues ?? {}) },
      };
      nodeEngine.addNode(newNode);
      groupController.autoAddNodeToGroupFromPosition(newId, position);
      newIds.push(newId);
      idMap.set(String(node.id), newId);
    }

    if (clipboardConnections.length > 0 && idMap.size > 0) {
      for (const conn of clipboardConnections) {
        const sourceNodeId = idMap.get(String(conn.sourceNodeId));
        const targetNodeId = idMap.get(String(conn.targetNodeId));
        if (!sourceNodeId || !targetNodeId) continue;
        const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
        const engineConn: EngineConnection = {
          id: connId,
          sourceNodeId,
          sourcePortId: String(conn.sourcePortId),
          targetNodeId,
          targetPortId: String(conn.targetPortId),
        };
        nodeEngine.addConnection(engineConn);
      }
    }

    clipboardPasteIndex += 1;

    if (newIds.length === 1) {
      groupController.clearSelection();
      setSelectedNode(newIds[0] ?? '');
    } else if (newIds.length > 1) {
      groupController.groupSelectionNodeIds.set(new Set(newIds));
      groupController.scheduleHighlight();
      groupController.requestFramesUpdate();
    }

    return true;
  };

  // Dragging a group header moves all nodes in that group together.
  const startGroupHeaderDrag = (groupId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.group-frame-actions')) return;
    if (target?.closest?.('input')) return;

    const group = get(groupController.nodeGroups).find((g) => String(g.id) === String(groupId));
    if (!group?.nodeIds?.length) return;
    if (!areaPlugin?.nodeViews) return;

    const t = readAreaTransform(areaPlugin);
    if (!t) return;

    const nodeIds = group.nodeIds.map((id) => String(id));
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of nodeIds) {
      const view = areaPlugin.nodeViews.get(id);
      const pos = view?.position as { x: number; y: number } | undefined;
      if (!pos) continue;
      startPositions.set(id, { x: pos.x, y: pos.y });
    }
    if (startPositions.size === 0) return;

    if (groupHeaderDragMoveHandler)
      window.removeEventListener('pointermove', groupHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (groupHeaderDragUpHandler) {
      window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', groupHeaderDragUpHandler, {
        capture: true,
      } as any);
    }

    groupHeaderDragPointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    let didMove = false;
    groupController.beginProgrammaticTranslate();

    const onMove = (ev: PointerEvent) => {
      if (groupHeaderDragPointerId !== null && ev.pointerId !== groupHeaderDragPointerId) return;
      const dx = (ev.clientX - start.x) / t.k;
      const dy = (ev.clientY - start.y) / t.k;
      if (!dx && !dy) return;
      didMove = true;
      for (const [id, pos] of startPositions.entries()) {
        void areaPlugin.translate(id, { x: pos.x + dx, y: pos.y + dy });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (groupHeaderDragPointerId !== null && ev.pointerId !== groupHeaderDragPointerId) return;
      groupHeaderDragPointerId = null;
      groupController.endProgrammaticTranslate();

      if (groupHeaderDragMoveHandler)
        window.removeEventListener('pointermove', groupHeaderDragMoveHandler, {
          capture: true,
        } as any);
      if (groupHeaderDragUpHandler) {
        window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
        window.removeEventListener('pointercancel', groupHeaderDragUpHandler, {
          capture: true,
        } as any);
      }
      groupHeaderDragMoveHandler = null;
      groupHeaderDragUpHandler = null;

      if (!didMove) return;
      groupController.handleDroppedNodesAfterDrag(Array.from(startPositions.keys()));
    };

    groupHeaderDragMoveHandler = onMove;
    groupHeaderDragUpHandler = onUp;
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

  // Dragging a loop header moves all nodes in that loop together.
  const startLoopHeaderDrag = (loopId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.loop-frame-actions')) return;
    if (target?.closest?.('input')) return;

    const effectiveLoops =
      loopController?.getEffectiveLoops?.() ??
      (loopController ? get(loopController.localLoops) : []);
    const loop = (effectiveLoops ?? []).find((l: any) => String(l?.id ?? '') === String(loopId));
    if (!loop?.nodeIds?.length) return;
    if (!areaPlugin?.nodeViews) return;

    const t = readAreaTransform(areaPlugin);
    if (!t) return;

    const nodeIds = (loop.nodeIds ?? []).map((id: string) => String(id));
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of nodeIds) {
      const view = areaPlugin.nodeViews.get(id);
      const pos = view?.position as { x: number; y: number } | undefined;
      if (!pos) continue;
      startPositions.set(id, { x: pos.x, y: pos.y });
    }
    if (startPositions.size === 0) return;

    if (loopHeaderDragMoveHandler)
      window.removeEventListener('pointermove', loopHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (loopHeaderDragUpHandler) {
      window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', loopHeaderDragUpHandler, {
        capture: true,
      } as any);
    }

    loopHeaderDragPointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    let didMove = false;
    groupController.beginProgrammaticTranslate();

    const onMove = (ev: PointerEvent) => {
      if (loopHeaderDragPointerId !== null && ev.pointerId !== loopHeaderDragPointerId) return;
      const dx = (ev.clientX - start.x) / t.k;
      const dy = (ev.clientY - start.y) / t.k;
      if (!dx && !dy) return;
      didMove = true;
      for (const [id, pos] of startPositions.entries()) {
        void areaPlugin.translate(id, { x: pos.x + dx, y: pos.y + dy });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (loopHeaderDragPointerId !== null && ev.pointerId !== loopHeaderDragPointerId) return;
      loopHeaderDragPointerId = null;
      groupController.endProgrammaticTranslate();

      if (loopHeaderDragMoveHandler)
        window.removeEventListener('pointermove', loopHeaderDragMoveHandler, {
          capture: true,
        } as any);
      if (loopHeaderDragUpHandler) {
        window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
        window.removeEventListener('pointercancel', loopHeaderDragUpHandler, {
          capture: true,
        } as any);
      }
      loopHeaderDragMoveHandler = null;
      loopHeaderDragUpHandler = null;

      if (!didMove) return;
      groupController.handleDroppedNodesAfterDrag(Array.from(startPositions.keys()));
    };

    loopHeaderDragMoveHandler = onMove;
    loopHeaderDragUpHandler = onUp;
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });

    event.preventDefault();
    event.stopPropagation();
  };

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
      pendingFocusNodeIds = ids;
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
      updateGroupRuntimeActives();
      sendMidiBridgeOverrides();
      sendMidiLoopBridgeOverrides();

      if (!get(isRunningStore)) return;
      if (patchDeployTimer) return;
      const now = Date.now();
      if (now - patchRuntimeTargetsLastCheckAt < PATCH_RUNTIME_TARGETS_CHECK_INTERVAL_MS) return;
      patchRuntimeTargetsLastCheckAt = now;

      const planKey = resolvePatchDeploymentPlan()?.planKey ?? '';
      if (planKey !== patchLastPlanKey) schedulePatchReconcile('runtime-target-change');
    });

    runningUnsub = isRunningStore.subscribe((running) => {
      void applyStoppedHighlights(Boolean(running));
      if (!running) {
        loopController?.loopActions.stopAllClientEffects();
        loopController?.loopActions.stopAllDeployedLoops();
        stopAllDeployedPatches();
        clearMidiLoopBridgeState();
      }
    });

    loopDeployUnsub = deployedLoopIds.subscribe(() => {
      // Loop deploy/redeploy clears client runtime overrides; force resend of MIDI-driven overrides.
      midiLoopBridgeDirty = true;
      midiLoopBridgeLastSignatureByClientKey = new Map();
      midiLoopBridgeActiveKeysByLoopId = new Map();
    });

    groupDisabledUnsub = groupController.groupDisabledNodeIds.subscribe((disabled) => {
      let didStop = false;
      for (const [clientId, patch] of deployedPatchByClientId.entries()) {
        const disabledInPatch = Array.from(patch.nodeIds).filter((id) => disabled.has(id));
        // Avoid hard-stopping patches when the disabled nodes can be bypassed on the next reconcile.
        // This prevents audible restarts when toggling audio FX groups (e.g. Tone Delay).
        const shouldStop =
          disabledInPatch.length > 0 &&
          !disabledInPatch.every((id) => isBypassableWhenDisabled(id));
        if (!shouldStop) continue;

        stopAndRemovePatchOnClient(clientId, patch.patchId);
        deployedPatchByClientId.delete(clientId);
        midiBridgeActiveKeysByClientId.delete(clientId);

        const prefix = `${clientId}|${patch.patchId}|`;
        for (const key of Array.from(midiBridgeLastSignatureByClientKey.keys())) {
          if (key.startsWith(prefix)) midiBridgeLastSignatureByClientKey.delete(key);
        }
        didStop = true;
      }

      if (didStop) {
        const nodeIds = getDeployedPatchNodeIds();
        syncPatchOffloadState(nodeIds);
        void applyPatchHighlights(nodeIds);
      }
      schedulePatchReconcile('group-gate');
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

        const nodeIds = getDeployedPatchNodeIds();
        syncPatchOffloadState(nodeIds);
        void applyPatchHighlights(nodeIds);

        if (pendingFocusNodeIds && pendingFocusNodeIds.length > 0) {
          const ids = pendingFocusNodeIds;
          pendingFocusNodeIds = null;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => focusNodeIds(ids));
          } else {
            focusNodeIds(ids);
          }
        }

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
          const removedPorts = removeGroupPortNodesForGroupIds(removedGroupIds);
          if (removedPorts > 0) return;
        }
      }

      graphSync?.schedule(state);
      schedulePatchReconcile('graph-change');
      midiLoopBridgeDirty = true;

      // Keep MIDI bridge wiring responsive (MIDI nodes are excluded from deploy topology).
      const first = deployedPatchByClientId.values().next().value as DeployedPatch | undefined;
      if (first) syncMidiBridgeRoutes(first.patchId, getDeployedPatchNodeIds());
    });

    groupNodesUnsub = groupController.nodeGroups.subscribe(() => {
      ensureGroupPortNodes();
      scheduleGroupPortAlign();
    });

    groupFramesUnsub = groupFrames.subscribe(() => {
      scheduleGroupPortAlign();
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
        if (copySelectedNodes()) {
          event.preventDefault();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === 'v') {
        if (pasteCopiedNodes()) {
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
    if (patchDeployTimer) clearTimeout(patchDeployTimer);
    for (const timer of patchPendingCommitByKey.values()) clearTimeout(timer);
    patchPendingCommitByKey.clear();
    stopAllDeployedPatches();
    loopController?.destroy();
    groupController.destroy();
    minimapController.destroy();
    if (groupPortAlignRaf && typeof cancelAnimationFrame !== 'undefined')
      cancelAnimationFrame(groupPortAlignRaf);
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
    if (groupHeaderDragMoveHandler)
      window.removeEventListener('pointermove', groupHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (groupHeaderDragUpHandler) {
      window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', groupHeaderDragUpHandler, {
        capture: true,
      } as any);
    }
    if (groupHeaderDragPointerId !== null) groupController.endProgrammaticTranslate();
    groupHeaderDragPointerId = null;
    groupHeaderDragMoveHandler = null;
    groupHeaderDragUpHandler = null;
    if (loopHeaderDragMoveHandler)
      window.removeEventListener('pointermove', loopHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (loopHeaderDragUpHandler) {
      window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', loopHeaderDragUpHandler, {
        capture: true,
      } as any);
    }
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
    if (loopHeaderDragPointerId !== null) groupController.endProgrammaticTranslate();
    loopHeaderDragPointerId = null;
    loopHeaderDragMoveHandler = null;
    loopHeaderDragUpHandler = null;
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
      onFocusGroup={focusGroupById}
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
      onDisassemble={disassembleGroupAndPorts}
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
