<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { ClassicPreset, NodeEditor } from 'rete';
  import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
  import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
  import { HistoryPlugin } from 'rete-history-plugin';
  import { SveltePlugin, Presets as SveltePresets } from 'rete-svelte-plugin';
  import { DOMSocketPosition } from 'rete-render-utils';

  import ReteNode from '$lib/components/nodes/ReteNode.svelte';
  import ReteControl from '$lib/components/nodes/ReteControl.svelte';
  import ReteConnection from '$lib/components/nodes/ReteConnection.svelte';
  import ExecutorLogsPanel from './node-canvas/ExecutorLogsPanel.svelte';
  import GroupFramesOverlay from './node-canvas/GroupFramesOverlay.svelte';
  import LoopFramesOverlay from './node-canvas/LoopFramesOverlay.svelte';
  import MarqueeOverlay from './node-canvas/MarqueeOverlay.svelte';
  import NodeCanvasMinimap from './node-canvas/NodeCanvasMinimap.svelte';
  import NodeCanvasToolbar from './node-canvas/NodeCanvasToolbar.svelte';
  import NodePickerOverlay from './node-canvas/NodePickerOverlay.svelte';
  import { nodeEngine, nodeRegistry } from '$lib/nodes';
  import { parameterRegistry } from '$lib/parameters/registry';
  import { midiService, type MidiEvent } from '$lib/features/midi/midi-service';
  import { midiNodeBridge, midiSourceMatchesEvent } from '$lib/features/midi/midi-node-bridge';
  import {
    exportMidiTemplateFile,
    instantiateMidiBindings,
    parseMidiTemplateFile,
  } from '$lib/features/midi/midi-templates';
  import { minimapPreferences, type MinimapPreferences } from '$lib/project/uiState';
  import { getSDK } from '$lib/stores/manager';
  import { sensorData } from '$lib/stores/manager';
  import type {
    NodeInstance,
    NodePort,
    PortType,
    Connection as EngineConnection,
    GraphState,
  } from '$lib/nodes/types';
  import type { LocalLoop } from '$lib/nodes';
  import {
    BooleanControl,
    ClientPickerControl,
    ClientSensorValueControl,
    FilePickerControl,
    MidiLearnControl,
    SelectControl,
  } from './rete-controls';

  // Rete core handles the view; nodeEngine remains the source of truth for execution

  let container: HTMLDivElement | null = null;
  let editor: NodeEditor<any> | null = null;
  let areaPlugin: any = null;
  let connectionPlugin: any = null;
  let graphUnsub: (() => void) | null = null;
  let paramsUnsub: (() => void) | null = null;

  // Shared sockets mapped to our port types
  const sockets = {
    number: new ClassicPreset.Socket('number'),
    boolean: new ClassicPreset.Socket('boolean'),
    string: new ClassicPreset.Socket('string'),
    color: new ClassicPreset.Socket('color'),
    client: new ClassicPreset.Socket('client'),
    command: new ClassicPreset.Socket('command'),
    fuzzy: new ClassicPreset.Socket('fuzzy'),
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
  let importGraphInputEl: HTMLInputElement | null = null;
  let importTemplatesInputEl: HTMLInputElement | null = null;
  let isToolbarMenuOpen = false;
  let toolbarMenuWrap: HTMLDivElement | null = null;
  let numberParamOptions: { path: string; label: string }[] = [];
  let selectedNode: NodeInstance | undefined = undefined;
  let isNodeDragging = false;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let wheelHandler: ((event: WheelEvent) => void) | null = null;
  let contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  let pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  let pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  let toolbarMenuOutsideHandler: ((event: PointerEvent) => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let lastPointerClient = { x: 0, y: 0 };
  let socketPositionWatcher: LiveDOMSocketPosition | null = null;

  let marqueePointerId: number | null = null;
  let marqueeMoveHandler: ((event: PointerEvent) => void) | null = null;
  let marqueeUpHandler: ((event: PointerEvent) => void) | null = null;

  let queuedGraphState: { nodes: NodeInstance[]; connections: EngineConnection[] } | null = null;
  let syncLoop: Promise<void> | null = null;

  class LiveDOMSocketPosition extends DOMSocketPosition<any, any> {
    private ro: ResizeObserver | null = null;
    private observed = new WeakSet<HTMLElement>();
    private elementToNodeId = new WeakMap<HTMLElement, string>();
    private pending = new Set<string>();
    private raf = 0;

    override attach(scope: any) {
      super.attach(scope);
      if (typeof ResizeObserver === 'undefined') return;
      if (this.ro) return;

      this.ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const nodeId = this.elementToNodeId.get(entry.target as HTMLElement);
          if (nodeId) this.queue(nodeId);
        }
      });

      const area = (this as any).area;
      if (!area) return;

      const observeAll = () => {
        if (!this.ro) return;
        for (const [id, view] of area.nodeViews?.entries?.() ?? []) {
          const el = view?.element as HTMLElement | undefined;
          if (!el) continue;
          if (this.observed.has(el)) continue;
          this.observed.add(el);
          this.elementToNodeId.set(el, String(id));
          try {
            this.ro.observe(el);
          } catch {
            // ignore
          }
        }
      };

      observeAll();
      area.addPipe((ctx: any) => {
        if (ctx?.type === 'rendered' && ctx.data?.type === 'node') {
          observeAll();
        }
        return ctx;
      });
    }

    destroy() {
      if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.pending.clear();
      this.ro?.disconnect();
      this.ro = null;
    }

    private queue(nodeId: string) {
      this.pending.add(nodeId);
      requestLoopFramesUpdate();
      if (typeof requestAnimationFrame === 'undefined') return;
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        void this.flush();
      });
    }

    private async flush() {
      const area = (this as any).area;
      if (!area) return;
      const ids = Array.from(this.pending);
      this.pending.clear();

      for (const nodeId of ids) {
        const items = (this as any).sockets
          ?.snapshot?.()
          ?.filter((item: any) => String(item.nodeId) === String(nodeId));
        if (!items || items.length === 0) continue;

        await Promise.all(
          items.map(async (item: any) => {
            const position = await (this as any).calculatePosition(
              String(nodeId),
              item.side,
              String(item.key),
              item.element
            );
            if (position) item.position = position;
          })
        );

        (this as any).emitter?.emit?.({ nodeId: String(nodeId) });
      }
    }
  }

  function normalizeAreaTransform(area: any) {
    const k = Number(area?.transform?.k);
    const x = Number(area?.transform?.x);
    const y = Number(area?.transform?.y);

    if (!Number.isFinite(k) || k <= 0) area.transform.k = 1;
    if (!Number.isFinite(x)) area.transform.x = 0;
    if (!Number.isFinite(y)) area.transform.y = 0;
  }

  type MiniNode = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    selected: boolean;
  };
  type MiniConnection = {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    localLoop: boolean;
    deployedLoop: boolean;
  };
  type MinimapState = {
    size: number;
    nodes: MiniNode[];
    connections: MiniConnection[];
    viewport: { x: number; y: number; width: number; height: number };
    bounds: { minX: number; minY: number; width: number; height: number };
    scale: number;
    offsetX: number;
    offsetY: number;
  };

  const DEFAULT_MINIMAP_SIZE = 190;
  const MIN_MINIMAP_SIZE = 120;
  const MAX_MINIMAP_SIZE = 360;
  const MINIMAP_STEP = 30;
  const MINIMAP_BAR_WIDTH = 22;
  const MINIMAP_MARGIN = 12;

  type MinimapUiState = { x: number; y: number; size: number };
  let minimapUi: MinimapUiState = { x: 0, y: 0, size: DEFAULT_MINIMAP_SIZE };
  let pendingMinimapPrefs: MinimapPreferences | null = null;
  let minimapPrefsUnsub: (() => void) | null = null;
  let isMinimapDragging = false;
  let minimapDragPointerId = -1;
  let minimapDragStart = { x: 0, y: 0, originX: 0, originY: 0 };
  let isMinimapViewportDragging = false;
  let minimapViewportPointerId = -1;
  let minimapViewportGrabOffset = { x: 0, y: 0 };

  let minimap: MinimapState = {
    size: DEFAULT_MINIMAP_SIZE,
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, width: 1, height: 1 },
    bounds: { minX: 0, minY: 0, width: 1, height: 1 },
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  let minimapRaf = 0;

  type PickerMode = 'add' | 'connect';
  type SocketData = { nodeId: string; side: 'input' | 'output'; key: string };

  let isPickerOpen = false;
  let pickerMode: PickerMode = 'add';
  let pickerAnchor = { x: 0, y: 0 }; // px within container
  let pickerGraphPos = { x: 0, y: 0 }; // graph coords
  let pickerSelectedCategory = 'Objects';
  let pickerQuery = '';
  let pickerInitialSocket: SocketData | null = null;
  let pickerElement: HTMLDivElement | null = null;

  // Store handles
  let graphStateStore = nodeEngine?.graphState;
  let isRunningStore = nodeEngine?.isRunning;
  let lastErrorStore = nodeEngine?.lastError;
  let localLoopsStore = nodeEngine?.localLoops;
  let deployedLoopsStore = nodeEngine?.deployedLoops;

  let localLoops: LocalLoop[] = [];
  let deployedLoopIds = new Set<string>();

  let localLoopNodeIds = new Set<string>();
  let localLoopConnIds = new Set<string>();
  let deployedNodeIds = new Set<string>();
  let deployedConnIds = new Set<string>();
  let loopsUnsub: (() => void) | null = null;
  let deployedLoopsUnsub: (() => void) | null = null;
  let loopHighlightDirty = false;
  let sensorUnsub: (() => void) | null = null;

  // MIDI activity highlight (source node + downstream chain)
  const MIDI_HIGHLIGHT_TTL_MS = 180;
  const midiSourceNodeTypes = new Set(['midi-fuzzy', 'midi-boolean']);
  const midiTraversalStopNodeTypes = new Set(['client-object']);
  let midiUnsub: (() => void) | null = null;
  let midiHighlightTimeout: ReturnType<typeof setTimeout> | null = null;
  let midiHighlightDirty = false;
  let midiActiveNodeIds = new Set<string>();
  let midiActiveConnIds = new Set<string>();
  let midiActiveInputPortsByNode = new Map<string, Set<string>>();
  let midiActiveOutputPortsByNode = new Map<string, Set<string>>();

  type DeployPendingEntry = { clientId: string; timeoutId: ReturnType<typeof setTimeout> | null };
  let deployPendingByLoopId = new Map<string, DeployPendingEntry>();
  // Remember where a loop was deployed so we can auto-stop/remove when the loop disappears.
  let deployedLoopClientIdByLoopId = new Map<string, string>();

  type ExecutorLogEntry = {
    at: number;
    event: string;
    loopId: string | null;
    error: string | null;
    payload: Record<string, unknown>;
  };

  type ExecutorClientStatus = {
    running: boolean;
    loopId: string | null;
    lastEvent: string;
    lastError: string | null;
    lastSeenAt: number;
    log: ExecutorLogEntry[];
  };

  let executorStatusByClient = new Map<string, ExecutorClientStatus>();
  let executorLastServerTimestampByClient = new Map<string, number>();
  let showExecutorLogs = false;
  let logsClientId = '';
  type LoopFrame = { loop: LocalLoop; left: number; top: number; width: number; height: number };
  let loopFrames: LoopFrame[] = [];
  let loopFramesRaf = 0;

  // Node Groups (user-defined frames with optional "deactivate" to disable nodes)
  type NodeGroup = { id: string; name: string; nodeIds: string[]; disabled: boolean };
  type GroupFrame = { group: NodeGroup; left: number; top: number; width: number; height: number };
  let nodeGroups: NodeGroup[] = [];
  let groupFrames: GroupFrame[] = [];
  let editModeGroupId: string | null = null;
  // Frozen group bounds in graph coordinates while in edit mode (so the frame doesn't "follow" node movement).
  let editModeGroupBounds: { left: number; top: number; right: number; bottom: number } | null = null;
  let groupEditToast: { groupId: string; message: string } | null = null;
  let groupEditToastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Shift+drag marquee selection for creating groups.
  let isMarqueeDragging = false;
  let marqueeStart = { x: 0, y: 0 }; // container-local px
  let marqueeCurrent = { x: 0, y: 0 }; // container-local px
  let groupSelectionNodeIds = new Set<string>();
  let groupSelectionBounds: { left: number; top: number; width: number; height: number } | null =
    null;
  let marqueeRect: { left: number; top: number; width: number; height: number } | null = null;
  $: marqueeRect = (() => {
    if (!isMarqueeDragging) return null;
    const left = Math.min(marqueeStart.x, marqueeCurrent.x);
    const top = Math.min(marqueeStart.y, marqueeCurrent.y);
    const width = Math.abs(marqueeStart.x - marqueeCurrent.x);
    const height = Math.abs(marqueeStart.y - marqueeCurrent.y);
    return { left, top, width, height };
  })();

  // Derived: nodes disabled by any group.
  let groupDisabledNodeIds = new Set<string>();
  let groupHighlightDirty = false;

  // Programmatic translations (e.g., group push-out) should not trigger multi-drag logic.
  let programmaticTranslateDepth = 0;
  const isProgrammaticTranslate = () => programmaticTranslateDepth > 0;

  // Multi-select drag (marquee selection): dragging one selected node moves all selected nodes.
  let multiDragLeaderId: string | null = null;
  let multiDragLeaderLastPos: { x: number; y: number } | null = null;
  let multiDragTranslateDepth = 0;
  const isMultiDragTranslate = () => multiDragTranslateDepth > 0;

  const OVERRIDE_TTL_MS = 1500;

  function getLoopClientId(loop: LocalLoop): string {
    const clientNodeId = loop.clientsInvolved?.[0] ?? '';
    const node = graphState.nodes.find((n: any) => String(n.id) === String(clientNodeId));
    const id = node?.config?.clientId;
    return typeof id === 'string' ? id : '';
  }

  function loopHasDisabledNodes(loop: LocalLoop): boolean {
    for (const nodeId of loop.nodeIds ?? []) {
      if (groupDisabledNodeIds.has(String(nodeId))) return true;
    }
    return false;
  }

  function getDeployedLoopForNode(nodeId: string): LocalLoop | null {
    for (const loop of localLoops) {
      if (!deployedLoopIds.has(loop.id)) continue;
      if (loop.nodeIds.includes(nodeId)) return loop;
    }
    return null;
  }

  function sendNodeOverride(
    nodeId: string,
    kind: 'input' | 'config',
    portId: string,
    value: unknown
  ) {
    if (!nodeId || !portId) return;

    const node = graphState.nodes.find((n) => String(n.id) === String(nodeId));
    if (node?.type === 'client-object' && kind === 'config' && portId === 'clientId') return;

    const loop = getDeployedLoopForNode(nodeId);
    if (!loop) return;

    const clientId = getLoopClientId(loop);
    if (!clientId) return;

    const sdk = getSDK();
    if (!sdk) return;

    sdk.sendPluginControl({ mode: 'clientIds', ids: [clientId] }, 'node-executor', 'override-set', {
      loopId: loop.id,
      overrides: [{ nodeId, kind, portId, value, ttlMs: OVERRIDE_TTL_MS }],
    } as any);
  }

  let logsStatus: ExecutorClientStatus | undefined = undefined;
  $: logsStatus = logsClientId ? executorStatusByClient.get(logsClientId) : undefined;

  function recomputeLoopHighlightSets() {
    localLoopNodeIds = new Set<string>();
    localLoopConnIds = new Set<string>();
    deployedNodeIds = new Set<string>();
    deployedConnIds = new Set<string>();

    for (const loop of localLoops) {
      for (const nid of loop.nodeIds) localLoopNodeIds.add(nid);
      for (const cid of loop.connectionIds) localLoopConnIds.add(cid);
      if (!deployedLoopIds.has(loop.id)) continue;
      for (const nid of loop.nodeIds) deployedNodeIds.add(nid);
      for (const cid of loop.connectionIds) deployedConnIds.add(cid);
    }

    scheduleLoopHighlight();
  }

  function scheduleLoopHighlight() {
    loopHighlightDirty = true;
    if (!isSyncingGraph) void applyLoopHighlights();
  }

  function scheduleMidiHighlight() {
    midiHighlightDirty = true;
    if (!isSyncingGraph) void applyMidiHighlights();
  }

  function scheduleGroupHighlight() {
    groupHighlightDirty = true;
    if (!isSyncingGraph) void applyGroupHighlights();
  }

  function arraysEqual(a: string[] | undefined, b: string[]): boolean {
    if (!a) return b.length === 0;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function applyGroupHighlights() {
    if (!areaPlugin) return;
    if (!groupHighlightDirty) return;
    groupHighlightDirty = false;

    for (const [id, node] of nodeMap.entries()) {
      const nextDisabled = groupDisabledNodeIds.has(id);
      const nextSelected = groupSelectionNodeIds.has(id);

      const prevDisabled = Boolean((node as any).groupDisabled);
      const prevSelected = Boolean((node as any).groupSelected);

      let changed = false;
      if (prevDisabled !== nextDisabled) {
        (node as any).groupDisabled = nextDisabled;
        changed = true;
      }
      if (prevSelected !== nextSelected) {
        (node as any).groupSelected = nextSelected;
        changed = true;
      }

      if (changed) await areaPlugin.update('node', id);
    }
  }

  async function applyMidiHighlights() {
    if (!areaPlugin) return;
    if (!midiHighlightDirty) return;
    midiHighlightDirty = false;

    for (const [id, node] of nodeMap.entries()) {
      const nextActive = midiActiveNodeIds.has(id);
      const nextInputs = Array.from(midiActiveInputPortsByNode.get(id) ?? []).sort();
      const nextOutputs = Array.from(midiActiveOutputPortsByNode.get(id) ?? []).sort();

      const prevActive = Boolean((node as any).active);
      const prevInputs = ((node as any).activeInputs ?? []) as string[];
      const prevOutputs = ((node as any).activeOutputs ?? []) as string[];

      let changed = false;
      if (prevActive !== nextActive) {
        (node as any).active = nextActive;
        changed = true;
      }
      if (!arraysEqual(prevInputs, nextInputs)) {
        (node as any).activeInputs = nextInputs;
        changed = true;
      }
      if (!arraysEqual(prevOutputs, nextOutputs)) {
        (node as any).activeOutputs = nextOutputs;
        changed = true;
      }

      if (changed) await areaPlugin.update('node', id);
    }

    for (const [id, conn] of connectionMap.entries()) {
      const nextActive = midiActiveConnIds.has(id);
      if (Boolean((conn as any).active) !== nextActive) {
        (conn as any).active = nextActive;
        await areaPlugin.update('connection', id);
      }
    }
  }

  function clearMidiHighlight() {
    midiActiveNodeIds = new Set();
    midiActiveConnIds = new Set();
    midiActiveInputPortsByNode = new Map();
    midiActiveOutputPortsByNode = new Map();
    scheduleMidiHighlight();
  }

  function handleMidiActivity(event: MidiEvent) {
    const selectedInputId = get(midiService.selectedInputId) || null;
    const nodeTypeById = new Map(
      (graphState.nodes ?? []).map((n: any) => [String(n.id), String(n.type)])
    );
    const sourceNodeIds = (graphState.nodes ?? [])
      .filter((n) => midiSourceNodeTypes.has(String(n.type)))
      .filter((n) => midiSourceMatchesEvent((n.config as any)?.source, event, selectedInputId))
      .map((n) => String(n.id))
      .filter((id) => !groupDisabledNodeIds.has(id));

    if (sourceNodeIds.length === 0) return;

    const outsByNode = new Map<string, EngineConnection[]>();
    for (const c of graphState.connections ?? []) {
      const src = String(c.sourceNodeId);
      const list = outsByNode.get(src) ?? [];
      list.push(c);
      outsByNode.set(src, list);
    }

    const nextNodeIds = new Set<string>();
    const nextConnIds = new Set<string>();
    const nextInputsByNode = new Map<string, Set<string>>();
    const nextOutputsByNode = new Map<string, Set<string>>();

    const queue: string[] = [];
    const visited = new Set<string>();
    for (const id of sourceNodeIds) {
      nextNodeIds.add(id);
      queue.push(id);
      visited.add(id);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      for (const conn of outsByNode.get(nodeId) ?? []) {
        const connId = String(conn.id);
        const targetNodeId = String(conn.targetNodeId);
        const sourcePortId = String(conn.sourcePortId);
        const targetPortId = String(conn.targetPortId);
        const targetType = nodeTypeById.get(targetNodeId) ?? '';
        const targetDisabled = groupDisabledNodeIds.has(targetNodeId);
        const stopAtTarget = midiTraversalStopNodeTypes.has(targetType);

        if (targetDisabled) continue;

        nextConnIds.add(connId);

        const outSet = nextOutputsByNode.get(nodeId) ?? new Set<string>();
        outSet.add(sourcePortId);
        nextOutputsByNode.set(nodeId, outSet);

        if (!stopAtTarget) {
          nextNodeIds.add(targetNodeId);

          const inSet = nextInputsByNode.get(targetNodeId) ?? new Set<string>();
          inSet.add(targetPortId);
          nextInputsByNode.set(targetNodeId, inSet);

          if (!visited.has(targetNodeId)) {
            visited.add(targetNodeId);
            queue.push(targetNodeId);
          }
        }
      }
    }

    midiActiveNodeIds = nextNodeIds;
    midiActiveConnIds = nextConnIds;
    midiActiveInputPortsByNode = nextInputsByNode;
    midiActiveOutputPortsByNode = nextOutputsByNode;
    scheduleMidiHighlight();

    if (midiHighlightTimeout) clearTimeout(midiHighlightTimeout);
    midiHighlightTimeout = setTimeout(() => clearMidiHighlight(), MIDI_HIGHLIGHT_TTL_MS);
  }

  async function applyLoopHighlights() {
    if (!areaPlugin) return;
    if (!loopHighlightDirty) return;
    loopHighlightDirty = false;

    for (const [id, node] of nodeMap.entries()) {
      const nextLocal = localLoopNodeIds.has(id);
      const nextDeployed = deployedNodeIds.has(id);
      if (Boolean((node as any).localLoop) !== nextLocal) {
        (node as any).localLoop = nextLocal;
        await areaPlugin.update('node', id);
      }
      if (Boolean((node as any).deployedLoop) !== nextDeployed) {
        (node as any).deployedLoop = nextDeployed;
        await areaPlugin.update('node', id);
      }
    }

    for (const [id, conn] of connectionMap.entries()) {
      const nextLocal = localLoopConnIds.has(id);
      const nextDeployed = deployedConnIds.has(id);
      if (Boolean((conn as any).localLoop) !== nextLocal) {
        (conn as any).localLoop = nextLocal;
        await areaPlugin.update('connection', id);
      }
      if (Boolean((conn as any).deployedLoop) !== nextDeployed) {
        (conn as any).deployedLoop = nextDeployed;
        await areaPlugin.update('connection', id);
      }
    }
  }

  function updateExecutorStatus(clientId: string, entry: ExecutorLogEntry) {
    const next = new Map(executorStatusByClient);
    const prev =
      next.get(clientId) ??
      ({
        running: false,
        loopId: null,
        lastEvent: 'unknown',
        lastError: null,
        lastSeenAt: 0,
        log: [],
      } as ExecutorClientStatus);

    const log = [...prev.log, entry].slice(-30);
    const running =
      entry.event === 'deployed' || entry.event === 'started'
        ? true
        : entry.event === 'stopped' || entry.event === 'removed' || entry.event === 'rejected'
          ? false
          : prev.running;

    next.set(clientId, {
      running,
      loopId: entry.loopId ?? prev.loopId,
      lastEvent: entry.event,
      lastError: entry.error ?? prev.lastError,
      lastSeenAt: entry.at,
      log,
    });
    executorStatusByClient = next;
  }

  function isLoopDeploying(loopId: string): boolean {
    return deployPendingByLoopId.has(loopId);
  }

  function clearLoopDeployPending(loopId: string) {
    const existing = deployPendingByLoopId.get(loopId);
    if (existing?.timeoutId) clearTimeout(existing.timeoutId);
    const next = new Map(deployPendingByLoopId);
    next.delete(loopId);
    deployPendingByLoopId = next;
  }

  function setLoopDeployPending(loopId: string, clientId: string) {
    const next = new Map(deployPendingByLoopId);
    const existing = next.get(loopId);
    if (existing?.timeoutId) clearTimeout(existing.timeoutId);

    const timeoutId = setTimeout(() => {
      if (!deployPendingByLoopId.has(loopId)) return;
      clearLoopDeployPending(loopId);
      alert(`Deploy timeout for loop ${loopId}`);
    }, 8000);

    next.set(loopId, { clientId, timeoutId });
    deployPendingByLoopId = next;
  }

  function toggleLoopLogs(loop: LocalLoop) {
    const clientId = getLoopClientId(loop);
    if (!clientId) return;
    if (showExecutorLogs && logsClientId === clientId) {
      showExecutorLogs = false;
      return;
    }
    logsClientId = clientId;
    showExecutorLogs = true;
  }

  function deployLoop(loop: LocalLoop) {
    if (!$isRunningStore) return;
    const clientId = getLoopClientId(loop);
    if (!clientId) {
      alert('Select a client in the Client node before deploying.');
      return;
    }
    const sdk = getSDK();
    if (!sdk) {
      alert('Manager SDK not connected.');
      return;
    }

    try {
      const payload = nodeEngine.exportGraphForLoop(loop.id) as any;
      sdk.sendPluginControl(
        { mode: 'clientIds', ids: [clientId] },
        'node-executor',
        'deploy',
        payload
      );
      setLoopDeployPending(loop.id, clientId);
    } catch (err) {
      console.error('[NodeCanvas] deploy failed', err);
      alert(err instanceof Error ? err.message : 'Deploy failed');
    }
  }

  function stopLoop(loop: LocalLoop) {
    const clientId = getLoopClientId(loop);
    if (!clientId) return;
    const sdk = getSDK();
    if (!sdk) return;
    sdk.sendPluginControl({ mode: 'clientIds', ids: [clientId] }, 'node-executor', 'stop', {
      loopId: loop.id,
    } as any);
    nodeEngine.markLoopDeployed(loop.id, false);
  }

  function stopAndRemoveLoopById(loopId: string, clientId: string) {
    if (!loopId || !clientId) return;
    const sdk = getSDK();
    if (!sdk) return;
    sdk.sendPluginControl({ mode: 'clientIds', ids: [clientId] }, 'node-executor', 'stop', {
      loopId,
    } as any);
    sdk.sendPluginControl({ mode: 'clientIds', ids: [clientId] }, 'node-executor', 'remove', {
      loopId,
    } as any);
  }

  function stopAllDeployedLoops() {
    const sdk = getSDK();
    if (!sdk) return;

    const loopById = new Map(localLoops.map((loop) => [loop.id, loop]));
    const nextClientMap = new Map(deployedLoopClientIdByLoopId);
    const pendingLoopIds = Array.from(deployPendingByLoopId.keys());
    const loopIds = new Set<string>([...deployedLoopIds, ...pendingLoopIds]);

    for (const loopId of loopIds) {
      const loop = loopById.get(loopId);
      const clientId =
        nextClientMap.get(loopId) ??
        deployPendingByLoopId.get(loopId)?.clientId ??
        (loop ? getLoopClientId(loop) : '');
      if (!clientId) continue;
      stopAndRemoveLoopById(loopId, clientId);
      nodeEngine.markLoopDeployed(loopId, false);
      nextClientMap.delete(loopId);
    }

    deployedLoopClientIdByLoopId = nextClientMap;
    deployPendingByLoopId = new Map();
  }

  function stopAllClientEffects() {
    const sdk = getSDK();
    if (!sdk) return;

    sdk.stopSound(true);
    sdk.stopMedia(true);
    sdk.hideImage(true);
    sdk.flashlight('off', undefined, true);
    sdk.screenColor({ color: '#000000', opacity: 0, mode: 'solid' }, true);
  }

  function removeLoop(loop: LocalLoop) {
    const clientId = getLoopClientId(loop);
    if (!clientId) return;
    const sdk = getSDK();
    if (!sdk) return;
    sdk.sendPluginControl({ mode: 'clientIds', ids: [clientId] }, 'node-executor', 'remove', {
      loopId: loop.id,
    } as any);
    nodeEngine.markLoopDeployed(loop.id, false);
  }

  function recomputeGroupDisabledNodes(nextGroups: NodeGroup[] = nodeGroups) {
    const prev = groupDisabledNodeIds;
    const next = new Set<string>();

    for (const g of nextGroups) {
      if (!g.disabled) continue;
      for (const nodeId of g.nodeIds ?? []) next.add(String(nodeId));
    }

    groupDisabledNodeIds = next;

    const toDisable = Array.from(next).filter((id) => !prev.has(id));
    const toEnable = Array.from(prev).filter((id) => !next.has(id));
    if (toDisable.length > 0) nodeEngine.setNodesDisabled(toDisable, true);
    if (toEnable.length > 0) nodeEngine.setNodesDisabled(toEnable, false);
    scheduleGroupHighlight();
  }

  function clearGroupEditToast() {
    groupEditToast = null;
    if (groupEditToastTimeout) {
      clearTimeout(groupEditToastTimeout);
      groupEditToastTimeout = null;
    }
  }

  function showGroupEditToast(groupId: string, message: string) {
    if (!groupId) return;
    groupEditToast = { groupId, message };
    if (groupEditToastTimeout) clearTimeout(groupEditToastTimeout);
    groupEditToastTimeout = setTimeout(() => {
      groupEditToast = null;
      groupEditToastTimeout = null;
    }, 1400);
  }

  function computeGroupFrameBounds(group: NodeGroup, t: AreaTransform): NodeBounds | null {
    const paddingX = 52;
    const paddingTop = 64;
    const paddingBottom = 52;

    const loopPaddingX = 56;
    const loopPaddingTop = 64;
    const loopPaddingBottom = 64;

    const base = unionBounds(group.nodeIds ?? [], t);
    if (!base) return null;

    let bounds = { ...base };
    const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
    for (const loop of localLoops) {
      if (!loop?.nodeIds?.length) continue;
      const fullyContained = loop.nodeIds.every((id) => groupNodeSet.has(String(id)));
      if (!fullyContained) continue;
      const lb = unionBounds(loop.nodeIds, t);
      if (!lb) continue;
      bounds.left = Math.min(bounds.left, lb.left - loopPaddingX);
      bounds.top = Math.min(bounds.top, lb.top - loopPaddingTop);
      bounds.right = Math.max(bounds.right, lb.right + loopPaddingX);
      bounds.bottom = Math.max(bounds.bottom, lb.bottom + loopPaddingBottom);
    }

    return {
      left: bounds.left - paddingX,
      top: bounds.top - paddingTop,
      right: bounds.right + paddingX,
      bottom: bounds.bottom + paddingBottom,
    };
  }

  function computeLoopFrameBounds(loop: LocalLoop, t: AreaTransform): NodeBounds | null {
    // Keep in sync with computeLoopFrames() so push-out matches the visual loop frame.
    const paddingX = 56;
    const paddingTop = 64;
    const paddingBottom = 64;

    const base = unionBounds(loop.nodeIds ?? [], t);
    if (!base) return null;

    return {
      left: base.left - paddingX,
      top: base.top - paddingTop,
      right: base.right + paddingX,
      bottom: base.bottom + paddingBottom,
    };
  }

  function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateNodeTranslations(
    updates: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[],
    durationMs = 320
  ) {
    if (!areaPlugin) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    if (updates.length === 0) return;

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    programmaticTranslateDepth += 1;

    const step = (now: number) => {
      const current = typeof performance !== 'undefined' ? now : Date.now();
      const rawT = (current - start) / durationMs;
      const tt = Math.max(0, Math.min(1, rawT));
      const eased = easeOutCubic(tt);

      for (const u of updates) {
        const x = u.from.x + (u.to.x - u.from.x) * eased;
        const y = u.from.y + (u.to.y - u.from.y) * eased;
        void areaPlugin.translate(u.id, { x, y });
      }

      if (tt < 1) {
        requestAnimationFrame(step);
        return;
      }

      programmaticTranslateDepth = Math.max(0, programmaticTranslateDepth - 1);
      requestLoopFramesUpdate();
      requestMinimapUpdate();
    };

    requestAnimationFrame(step);
  }

  function pushNodesOutOfBounds(bounds: NodeBounds, excludeNodeIds: Set<string>) {
    if (!areaPlugin?.nodeViews) return;
    const t = readAreaTransform();
    if (!t) return;

    const margin = 24;
    const updates: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] =
      [];

    for (const nodeId of nodeMap.keys()) {
      const id = String(nodeId);
      if (excludeNodeIds.has(id)) continue;
      const b = readNodeBounds(id, t);
      if (!b) continue;

      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      const inside = cx > bounds.left && cx < bounds.right && cy > bounds.top && cy < bounds.bottom;
      if (!inside) continue;

      const moveLeft = bounds.left - margin - b.right;
      const moveRight = bounds.right + margin - b.left;
      const moveUp = bounds.top - margin - b.bottom;
      const moveDown = bounds.bottom + margin - b.top;

      const candidates = [
        { dx: moveLeft, dy: 0 },
        { dx: moveRight, dy: 0 },
        { dx: 0, dy: moveUp },
        { dx: 0, dy: moveDown },
      ];
      candidates.sort(
        (a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy))
      );
      const pick = candidates[0];
      if (!pick) continue;

      const view = areaPlugin.nodeViews.get(id);
      const pos = view?.position as { x: number; y: number } | undefined;
      if (!pos) continue;

      const to = { x: pos.x + pick.dx / t.k, y: pos.y + pick.dy / t.k };
      updates.push({ id, from: { x: pos.x, y: pos.y }, to });
    }

    animateNodeTranslations(updates);
  }

  // Frame constraints:
  // - Loop frames always exclude unrelated nodes (push-out on drop).
  // - Group membership can be edited only when "Edit Group" is enabled for that group; in edit mode, the
  //   group frame is frozen (so it doesn't follow node movement) and dropping nodes inside/outside adds/removes
  //   membership with a temporary toast. Outside edit mode, non-member nodes dropped inside groups get pushed out.
  function handleDroppedNodesAfterDrag(nodeIds: string[]) {
    if (!nodeIds.length) return;
    if (isProgrammaticTranslate()) return;

    const t = readAreaTransform();
    if (!t) return;

    const nodeCenterCache = new Map<string, { cx: number; cy: number }>();
    const getNodeCenter = (nodeId: string) => {
      const id = String(nodeId);
      const cached = nodeCenterCache.get(id);
      if (cached) return cached;
      const b = readNodeBounds(id, t);
      if (!b) return null;
      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      const v = { cx, cy };
      nodeCenterCache.set(id, v);
      return v;
    };

    // 1) Loop frames: always push unrelated nodes out when a drag ends inside/near the loop.
    for (const loop of localLoops) {
      const bounds = computeLoopFrameBounds(loop, t);
      if (!bounds) continue;
      const loopNodeSet = new Set((loop.nodeIds ?? []).map((id) => String(id)));

      let shouldEnforce = false;
      for (const movedId of nodeIds) {
        const id = String(movedId);
        if (loopNodeSet.has(id)) {
          shouldEnforce = true;
          break;
        }
        const c = getNodeCenter(id);
        if (!c) continue;
        if (c.cx > bounds.left && c.cx < bounds.right && c.cy > bounds.top && c.cy < bounds.bottom) {
          shouldEnforce = true;
          break;
        }
      }
      if (!shouldEnforce) continue;

      pushNodesOutOfBounds(bounds, loopNodeSet);
    }

    // 2) Group edit mode: add/remove membership based on the frozen bounds.
    if (editModeGroupId && editModeGroupBounds) {
      const group = nodeGroups.find((g) => g.id === editModeGroupId) ?? null;
      if (group) {
        const bounds: NodeBounds = {
          left: editModeGroupBounds.left * t.k + t.tx,
          top: editModeGroupBounds.top * t.k + t.ty,
          right: editModeGroupBounds.right * t.k + t.tx,
          bottom: editModeGroupBounds.bottom * t.k + t.ty,
        };

        const nextSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
        const added: string[] = [];
        const removed: string[] = [];

        for (const movedId of nodeIds) {
          const id = String(movedId);
          const c = getNodeCenter(id);
          if (!c) continue;
          const inside =
            c.cx > bounds.left && c.cx < bounds.right && c.cy > bounds.top && c.cy < bounds.bottom;

          if (inside && !nextSet.has(id)) {
            nextSet.add(id);
            added.push(id);
            const node = graphState.nodes.find((n) => String(n.id) === id);
            const nodeName = node ? nodeLabel(node) : id;
            showGroupEditToast(group.id, `Add ${nodeName} to ${group.name ?? 'Group'}`);
          }

          if (!inside && nextSet.has(id)) {
            nextSet.delete(id);
            removed.push(id);
            const node = graphState.nodes.find((n) => String(n.id) === id);
            const nodeName = node ? nodeLabel(node) : id;
            showGroupEditToast(group.id, `Remove ${nodeName} from ${group.name ?? 'Group'}`);
          }
        }

        if (added.length > 0 || removed.length > 0) {
          nodeGroups = nodeGroups.map((g) =>
            g.id === group.id ? { ...g, nodeIds: Array.from(nextSet) } : g
          );
          recomputeGroupDisabledNodes(nodeGroups);
          requestLoopFramesUpdate();

          if (group.disabled && added.length > 0) {
            stopDeployedLoopsIntersecting(added.map(String));
          }
        }
      }
    }

    // 3) Group frames (non-edit): push unrelated nodes out on drop.
    for (const group of nodeGroups) {
      if (editModeGroupId === group.id) continue;

      const bounds = computeGroupFrameBounds(group, t);
      if (!bounds) continue;
      const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));

      let shouldEnforce = false;
      for (const movedId of nodeIds) {
        const id = String(movedId);
        if (groupNodeSet.has(id)) {
          shouldEnforce = true;
          break;
        }
        const c = getNodeCenter(id);
        if (!c) continue;
        if (c.cx > bounds.left && c.cx < bounds.right && c.cy > bounds.top && c.cy < bounds.bottom) {
          shouldEnforce = true;
          break;
        }
      }
      if (!shouldEnforce) continue;

      pushNodesOutOfBounds(bounds, groupNodeSet);
    }
  }

  function createNodeGroupFromSelection() {
    const initialIds = Array.from(groupSelectionNodeIds).map((id) => String(id));
    if (initialIds.length === 0) return;

    const ids = new Set(initialIds);
    // If the selection intersects any loop, include the entire loop so the loop frame is grouped as a unit.
    for (const loop of localLoops) {
      if (!loop?.nodeIds?.some((id) => ids.has(String(id)))) continue;
      for (const nid of loop.nodeIds) ids.add(String(nid));
    }

    const groupId = `group:${crypto.randomUUID?.() ?? Date.now()}`;
    const nextName = `Group ${nodeGroups.length + 1}`;
    const group: NodeGroup = {
      id: groupId,
      name: nextName,
      nodeIds: Array.from(ids),
      disabled: false,
    };
    nodeGroups = [...nodeGroups, group];
    recomputeGroupDisabledNodes();

    groupSelectionNodeIds = new Set();
    groupSelectionBounds = null;
    scheduleGroupHighlight();
    requestLoopFramesUpdate();

    const t = readAreaTransform();
    if (!t) return;
    const bounds = computeGroupFrameBounds(group, t);
    if (!bounds) return;
    pushNodesOutOfBounds(bounds, new Set(group.nodeIds.map((id) => String(id))));
  }

  function stopDeployedLoopsIntersecting(nodeIds: string[]) {
    const set = new Set(nodeIds.map((id) => String(id)));
    for (const loop of localLoops) {
      if (!deployedLoopIds.has(loop.id)) continue;
      if (!loop.nodeIds.some((id) => set.has(String(id)))) continue;
      stopLoop(loop);
    }
  }

  function toggleGroupDisabled(groupId: string) {
    const group = nodeGroups.find((g) => g.id === groupId);
    if (!group) return;

    const nextDisabled = !group.disabled;
    nodeGroups = nodeGroups.map((g) => (g.id === groupId ? { ...g, disabled: nextDisabled } : g));
    recomputeGroupDisabledNodes();
    requestLoopFramesUpdate();

    if (nextDisabled) stopDeployedLoopsIntersecting(group.nodeIds);
  }

  function disassembleGroup(groupId: string) {
    if (!groupId) return;
    if (!nodeGroups.some((g) => g.id === groupId)) return;
    if (editModeGroupId === groupId) {
      editModeGroupId = null;
      editModeGroupBounds = null;
      clearGroupEditToast();
    }
    nodeGroups = nodeGroups.filter((g) => g.id !== groupId);
    recomputeGroupDisabledNodes(nodeGroups);
    requestLoopFramesUpdate();
  }

  function renameGroup(groupId: string, name: string) {
    const trimmed = name.trim();
    if (!groupId) return;
    if (!trimmed) return;
    if (!nodeGroups.some((g) => g.id === groupId)) return;
    nodeGroups = nodeGroups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g));
    requestLoopFramesUpdate();
  }

  function toggleGroupEditMode(groupId: string) {
    if (!groupId) return;
    const group = nodeGroups.find((g) => g.id === groupId) ?? null;
    if (!group) return;

    if (editModeGroupId === groupId) {
      editModeGroupId = null;
      editModeGroupBounds = null;
      clearGroupEditToast();
      requestLoopFramesUpdate();
      return;
    }

    const t = readAreaTransform();
    if (t) {
      const b = computeGroupFrameBounds(group, t);
      if (b) {
        editModeGroupBounds = {
          left: (b.left - t.tx) / t.k,
          top: (b.top - t.ty) / t.k,
          right: (b.right - t.tx) / t.k,
          bottom: (b.bottom - t.ty) / t.k,
        };
      } else {
        editModeGroupBounds = null;
      }
    } else {
      editModeGroupBounds = null;
    }

    editModeGroupId = groupId;
    clearGroupEditToast();
    requestLoopFramesUpdate();
  }

  const nodeCategories = nodeRegistry.listByCategory();
  const addCategoryOptions = [
    'Objects',
    ...Array.from(nodeCategories.keys()).filter((k) => k !== 'Objects'),
  ];

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
    const configFields = def?.configSchema ?? [];
    const configFieldByKey = new Map<string, any>();
    for (const field of configFields) configFieldByKey.set(field.key, field);
    const inputControlKeys = new Set<string>();
    // Ensure Rete IDs match engine IDs so editor events map back cleanly.
    node.id = instance.id;

    for (const input of def?.inputs ?? []) {
      const multipleConnections = input.kind === 'sink';
      const inp = new ClassicPreset.Input(
        socketFor(input.type),
        input.label ?? input.id,
        multipleConnections
      );

      // ComfyUI-like default widgets for primitive inputs with config/default fallbacks
      const hasDefault = input.defaultValue !== undefined;
      const isPrimitive =
        input.type === 'number' || input.type === 'string' || input.type === 'boolean';
      const isSink = input.kind === 'sink';
      const configField = configFieldByKey.get(input.id);
      const isSelectConfig = configField?.type === 'select';
      const configValue = instance.config?.[input.id];
      const current = instance.inputValues?.[input.id];
      const derivedDefault = hasDefault ? input.defaultValue : configField?.defaultValue;
      const hasInitial =
        current !== undefined || configValue !== undefined || derivedDefault !== undefined;
      if (hasInitial && isPrimitive && !isSink && !isSelectConfig) {
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
                : Number(derivedDefault ?? 0);

          const clamp = (value: number) => {
            let next = value;
            if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
            if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
            return next;
          };

          inp.addControl(
            (() => {
              const control: any = new ClassicPreset.InputControl('number', {
                initial: clamp(initial),
                change: (value) => {
                  const next = typeof value === 'number' ? clamp(value) : value;
                  nodeEngine.updateNodeInputValue(instance.id, input.id, next);
                  sendNodeOverride(instance.id, 'input', input.id, next);
                },
              });
              control.inline = true;
              control.min = min;
              control.max = max;
              control.step = step;
              return control;
            })()
          );
        } else if (input.type === 'string') {
          const initial =
            typeof current === 'string'
              ? current
              : typeof configValue === 'string'
                ? configValue
                : String(derivedDefault ?? '');
          const control: any = new ClassicPreset.InputControl('text', {
            initial,
            change: (value) => {
              nodeEngine.updateNodeInputValue(instance.id, input.id, value);
              sendNodeOverride(instance.id, 'input', input.id, value);
            },
          });
          control.inline = true;
          inp.addControl(control);
        } else if (input.type === 'boolean') {
          const initial =
            typeof current === 'boolean'
              ? current
              : typeof configValue === 'boolean'
                ? configValue
                : Boolean(derivedDefault);
          const control: any = new BooleanControl({
            initial,
            change: (value) => {
              nodeEngine.updateNodeInputValue(instance.id, input.id, value);
              sendNodeOverride(instance.id, 'input', input.id, value);
            },
          });
          control.inline = true;
          inp.addControl(control);
        }
        inp.showControl = true;
        inputControlKeys.add(input.id);
      }

      // Color controls can appear inline on the input row (config-backed).
      // Use config when present so "override ports" behave like other processor options.
      if (!isSink && input.type === 'color') {
        const initial =
          typeof instance.config?.[input.id] === 'string'
            ? String(instance.config[input.id])
            : typeof current === 'string'
              ? String(current)
              : String(derivedDefault ?? '#ffffff');
        inp.addControl(
          (() => {
            const control: any = new ClassicPreset.InputControl('color', {
              initial,
              change: (value) => {
                nodeEngine.updateNodeConfig(instance.id, { [input.id]: value });
                sendNodeOverride(instance.id, 'config', input.id, value);
              },
            });
            control.inline = true;
            return control;
          })()
        );
        inp.showControl = true;
        inputControlKeys.add(input.id);
      }

      // Select controls can also appear inline on the input row (use config as fallback).
      if (!isSink && configField?.type === 'select') {
        const control: any = new SelectControl({
          initial: String(instance.config?.[input.id] ?? configField.defaultValue ?? ''),
          options: configField.options ?? [],
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [input.id]: value });
            sendNodeOverride(instance.id, 'config', input.id, value);
          },
        });
        control.inline = true;
        inp.addControl(control);
        inputControlKeys.add(input.id);
      }

      node.addInput(input.id, inp);
    }

    for (const output of def?.outputs ?? []) {
      const out: any = new ClassicPreset.Output(socketFor(output.type), output.label ?? output.id);
      if (instance.type === 'proc-client-sensors') {
        out.control = new ClientSensorValueControl({ nodeId: instance.id, portId: output.id });
      }
      node.addOutput(output.id, out);
    }

    for (const field of def?.configSchema ?? []) {
      if (inputControlKeys.has(field.key)) continue;
      const key = field.key;
      const current = instance.config?.[key] ?? field.defaultValue;
      if (field.type === 'select') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            initial: String(current ?? ''),
            options: field.options ?? [],
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'boolean') {
        node.addControl(
          key,
          new BooleanControl({
            label: field.label,
            initial: Boolean(current),
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
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
            nodeEngine.updateNodeConfig(instance.id, { [key]: next });
            sendNodeOverride(instance.id, 'config', key, next);
          },
        });
        control.controlLabel = field.label;
        control.min = field.min;
        control.max = field.max;
        control.step = field.step;
        node.addControl(key, control);
      } else if (field.type === 'client-picker') {
        node.addControl(
          key,
          new ClientPickerControl({
            label: field.label,
            initial: String(current ?? ''),
            change: (value) => nodeEngine.updateNodeConfig(instance.id, { [key]: value }),
          })
        );
      } else if (field.type === 'param-path') {
        node.addControl(
          key,
          new SelectControl({
            label: field.label,
            placeholder: 'Select parameter…',
            initial: String(current ?? ''),
            options: numberParamOptions.map((p) => ({
              value: p.path,
              label: `${p.label} (${p.path})`,
            })),
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'file') {
        node.addControl(
          key,
          new FilePickerControl({
            label: field.label,
            initial: typeof current === 'string' ? current : '',
            accept: field.accept,
            buttonLabel: field.buttonLabel,
            change: (value) => {
              nodeEngine.updateNodeConfig(instance.id, { [key]: value });
              sendNodeOverride(instance.id, 'config', key, value);
            },
          })
        );
      } else if (field.type === 'midi-source') {
        node.addControl(key, new MidiLearnControl({ nodeId: instance.id, label: field.label }));
      } else {
        const control: any = new ClassicPreset.InputControl('text', {
          initial: String(current ?? ''),
          change: (value) => {
            nodeEngine.updateNodeConfig(instance.id, { [key]: value });
            sendNodeOverride(instance.id, 'config', key, value);
          },
        });
        control.controlLabel = field.label;
        node.addControl(key, control);
      }
    }

    node.position = [instance.position.x, instance.position.y];
    return node;
  }

  function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
    let next = value;
    if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
    if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
    return next;
  }

  async function applyMidiMapRangeConstraints(state: {
    nodes: NodeInstance[];
    connections: EngineConnection[];
  }) {
    if (!areaPlugin) return;

    const byId = new Map(state.nodes.map((n) => [String(n.id), n]));

    for (const node of state.nodes) {
      if (node.type !== 'midi-map') continue;

      const def = nodeRegistry.get(node.type);
      const minField = def?.configSchema?.find((f) => f.key === 'min');
      const maxField = def?.configSchema?.find((f) => f.key === 'max');

      const baseMinCandidates = [minField?.min, maxField?.min].filter(isFiniteNumber);
      const baseMaxCandidates = [minField?.max, maxField?.max].filter(isFiniteNumber);
      const baseMin = baseMinCandidates.length > 0 ? Math.max(...baseMinCandidates) : undefined;
      const baseMax = baseMaxCandidates.length > 0 ? Math.min(...baseMaxCandidates) : undefined;

      const conns = state.connections.filter(
        (c) => String(c.sourceNodeId) === String(node.id) && String(c.sourcePortId) === 'out'
      );

      let downMin: number | undefined;
      let downMax: number | undefined;

      for (const c of conns) {
        const target = byId.get(String(c.targetNodeId));
        const targetDef = target ? nodeRegistry.get(target.type) : null;
        const port = targetDef?.inputs?.find((p) => p.id === c.targetPortId);
        if (!port || port.type !== 'number') continue;

        if (isFiniteNumber(port.min)) {
          downMin = downMin === undefined ? port.min : Math.max(downMin, port.min);
        }
        if (isFiniteNumber(port.max)) {
          downMax = downMax === undefined ? port.max : Math.min(downMax, port.max);
        }
      }

      // Conflicting constraints => do not apply downstream clamping.
      if (downMin !== undefined && downMax !== undefined && downMax < downMin) {
        downMin = undefined;
        downMax = undefined;
      }

      const nextMinLimit =
        baseMin !== undefined && downMin !== undefined
          ? Math.max(baseMin, downMin)
          : (baseMin ?? downMin);
      const nextMaxLimit =
        baseMax !== undefined && downMax !== undefined
          ? Math.min(baseMax, downMax)
          : (baseMax ?? downMax);

      const reteNode = nodeMap.get(String(node.id));
      const minCtrl: any = reteNode?.controls?.min;
      const maxCtrl: any = reteNode?.controls?.max;
      let needsNodeUpdate = false;

      if (minCtrl) {
        if (minCtrl.min !== nextMinLimit) {
          minCtrl.min = nextMinLimit;
          needsNodeUpdate = true;
        }
        if (minCtrl.max !== nextMaxLimit) {
          minCtrl.max = nextMaxLimit;
          needsNodeUpdate = true;
        }
      }

      if (maxCtrl) {
        if (maxCtrl.min !== nextMinLimit) {
          maxCtrl.min = nextMinLimit;
          needsNodeUpdate = true;
        }
        if (maxCtrl.max !== nextMaxLimit) {
          maxCtrl.max = nextMaxLimit;
          needsNodeUpdate = true;
        }
      }

      const rawMin = Number(node.config?.min ?? minField?.defaultValue ?? 0);
      const rawMax = Number(node.config?.max ?? maxField?.defaultValue ?? 1);
      const effectiveRawMin = Number.isFinite(rawMin) ? rawMin : 0;
      const effectiveRawMax = Number.isFinite(rawMax) ? rawMax : 1;
      const clampedMin = clampNumber(effectiveRawMin, nextMinLimit, nextMaxLimit);
      const clampedMax = clampNumber(effectiveRawMax, nextMinLimit, nextMaxLimit);

      const updates: Record<string, number> = {};
      if (clampedMin !== effectiveRawMin) updates.min = clampedMin;
      if (clampedMax !== effectiveRawMax) updates.max = clampedMax;
      if (Object.keys(updates).length > 0) {
        nodeEngine.updateNodeConfig(String(node.id), updates);
        if (minCtrl) minCtrl.value = clampedMin;
        if (maxCtrl) maxCtrl.value = clampedMax;
        needsNodeUpdate = true;
      }

      if (needsNodeUpdate) await areaPlugin.update('node', String(node.id));
    }
  }

  function isCompatible(sourceType: PortType, targetType: PortType) {
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
  }

  function getPortDefForSocket(socket: SocketData): NodePort | null {
    const instance = nodeEngine.getNode(socket.nodeId);
    if (!instance) return null;
    const def = nodeRegistry.get(instance.type);
    if (!def) return null;
    if (socket.side === 'output')
      return (def.outputs ?? []).find((p) => p.id === socket.key) ?? null;
    return (def.inputs ?? []).find((p) => p.id === socket.key) ?? null;
  }

  function bestMatchingPort(
    ports: NodePort[],
    requiredType: PortType,
    portSide: 'input' | 'output'
  ) {
    let best: NodePort | null = null;
    let bestScore = -1;

    for (const port of ports) {
      const portType = (port.type ?? 'any') as PortType;
      const ok =
        portSide === 'input'
          ? isCompatible(requiredType, portType)
          : isCompatible(portType, requiredType);
      if (!ok) continue;
      const exact = portType === requiredType ? 2 : 1;
      if (exact > bestScore) {
        bestScore = exact;
        best = port;
      }
    }

    return best;
  }

  function computeGraphPosition(clientX: number, clientY: number) {
    const area = areaPlugin?.area;
    const holder: HTMLElement | null = area?.content?.holder ?? null;
    if (!area || !holder) return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };

    const rect = holder.getBoundingClientRect();
    const k = Number(area.transform?.k ?? 1) || 1;
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k };
  }

  function findPortRowSocketAt(
    clientX: number,
    clientY: number,
    desiredSide: 'input' | 'output'
  ): SocketData | null {
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
  }

  function inputAllowsMultiple(nodeId: string, inputKey: string): boolean {
    const instance = nodeEngine.getNode(nodeId);
    if (!instance) return false;
    const def = nodeRegistry.get(instance.type);
    const port = def?.inputs?.find((p) => p.id === inputKey);
    return port?.kind === 'sink';
  }

  function replaceSingleInputConnection(targetNodeId: string, targetPortId: string) {
    if (inputAllowsMultiple(targetNodeId, targetPortId)) return;
    const state = get(graphStateStore);
    for (const c of state.connections ?? []) {
      if (c.targetNodeId === targetNodeId && c.targetPortId === targetPortId) {
        nodeEngine.removeConnection(c.id);
      }
    }
  }

  async function clampPickerToBounds() {
    await tick();
    if (!container || !pickerElement) return;
    const bounds = container.getBoundingClientRect();
    const w = pickerElement.offsetWidth;
    const h = pickerElement.offsetHeight;
    const pad = 10;

    let x = pickerAnchor.x;
    let y = pickerAnchor.y;

    if (x + w + pad > bounds.width) x = bounds.width - w - pad;
    if (y + h + pad > bounds.height) y = bounds.height - h - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    pickerAnchor = { x, y };
  }

  function openPicker(opts: {
    clientX: number;
    clientY: number;
    mode: PickerMode;
    initialSocket?: SocketData | null;
  }) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    pickerAnchor = { x: opts.clientX - rect.left, y: opts.clientY - rect.top };
    pickerGraphPos = computeGraphPosition(opts.clientX, opts.clientY);
    pickerMode = opts.mode;
    pickerInitialSocket = opts.initialSocket ?? null;
    pickerQuery = '';
    pickerSelectedCategory = addCategory || 'Objects';
    isPickerOpen = true;
    void tick().then(() => {
      const input = pickerElement?.querySelector?.(
        'input.picker-search'
      ) as HTMLInputElement | null;
      input?.focus?.();
      input?.select?.();
    });
    void clampPickerToBounds();
  }

  let lastConnectPickerOpenedAt = 0;
  function openConnectPicker(initialSocket: SocketData) {
    const now = Date.now();
    if (now - lastConnectPickerOpenedAt < 80) return;
    lastConnectPickerOpenedAt = now;
    openPicker({
      clientX: lastPointerClient.x,
      clientY: lastPointerClient.y,
      mode: 'connect',
      initialSocket,
    });
  }

  function closePicker() {
    isPickerOpen = false;
    pickerInitialSocket = null;
  }

  function toContainerPoint(clientX: number, clientY: number): { x: number; y: number } {
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function clearGroupSelection() {
    if (groupSelectionNodeIds.size === 0) return;
    groupSelectionNodeIds = new Set();
    groupSelectionBounds = null;
    scheduleGroupHighlight();
  }

  function isMarqueeStartTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    if (target.closest('.node')) return false;
    if (target.closest('.node-picker')) return false;
    if (target.closest('.marquee-actions')) return false;
    if (target.closest('.minimap')) return false;
    if (target.closest('.executor-logs')) return false;
    if (target.closest('.loop-frame-header')) return false;
    if (target.closest('.group-frame-header')) return false;
    return true;
  }

  type PickerItem = {
    type: string;
    label: string;
    category: string;
    matchPort?: { id: string; label: string; side: 'input' | 'output'; type: PortType };
  };

  $: pickerItemsByCategory = (() => {
    const map = new Map<string, PickerItem[]>();
    const query = pickerQuery.trim().toLowerCase();

    const addItem = (item: PickerItem) => {
      if (query) {
        const hay = `${item.label} ${item.type} ${item.category}`.toLowerCase();
        if (!hay.includes(query)) return;
      }
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    };

    if (pickerMode === 'connect' && pickerInitialSocket) {
      const initial = pickerInitialSocket;
      const initialPort = getPortDefForSocket(initial);
      const requiredType = (initialPort?.type ?? 'any') as PortType;
      const neededSide: 'input' | 'output' = initial.side === 'output' ? 'input' : 'output';

      for (const def of nodeRegistry.list()) {
        const ports = (neededSide === 'input' ? def.inputs : def.outputs) ?? [];
        const match = bestMatchingPort(ports, requiredType, neededSide);
        if (!match) continue;

        addItem({
          type: def.type,
          label: def.label,
          category: def.category,
          matchPort: {
            id: match.id,
            label: match.label ?? match.id,
            side: neededSide,
            type: (match.type ?? 'any') as PortType,
          },
        });
      }
    } else {
      for (const def of nodeRegistry.list()) {
        addItem({ type: def.type, label: def.label, category: def.category });
      }
    }

    for (const [cat, list] of map) {
      list.sort((a, b) => a.label.localeCompare(b.label));
      map.set(cat, list);
    }

    return map;
  })();

  $: pickerCategories = (() => {
    const cats = Array.from(pickerItemsByCategory.keys());
    const rest = cats.filter((c) => c !== 'Objects').sort((a, b) => a.localeCompare(b));
    return cats.includes('Objects') ? ['Objects', ...rest] : rest;
  })();

  $: if (
    isPickerOpen &&
    pickerCategories.length > 0 &&
    !pickerCategories.includes(pickerSelectedCategory)
  ) {
    pickerSelectedCategory = pickerCategories[0] ?? '';
  }

  $: pickerItems = pickerItemsByCategory.get(pickerSelectedCategory) ?? [];

  async function syncGraph(state: { nodes: NodeInstance[]; connections: EngineConnection[] }) {
    if (!editor || !areaPlugin) return;

    isSyncingGraph = true;
    try {
      graphState = state;
      nodeCount = state.nodes.length;

      const engineNodeIds = new Set(state.nodes.map((n) => n.id));
      const engineConnIds = new Set(state.connections.map((c) => c.id));

      // Add / update nodes
      for (const n of state.nodes) {
        let reteNode = nodeMap.get(n.id);
        if (!reteNode) {
          const existing = editor.getNode(n.id);
          if (existing) {
            reteNode = existing;
            nodeMap.set(n.id, reteNode);
          } else {
            reteNode = buildReteNode(n);
            await editor.addNode(reteNode);
            nodeMap.set(n.id, reteNode);
            if (n.id === selectedNodeId) {
              reteNode.selected = true;
              await areaPlugin.update('node', n.id);
            }
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
        const existing = editor.getConnection(c.id);
        if (existing) {
          connectionMap.set(c.id, existing);
          continue;
        }
        const src = nodeMap.get(c.sourceNodeId);
        const tgt = nodeMap.get(c.targetNodeId);
        if (!src || !tgt) continue;
        const conn: any = new ClassicPreset.Connection(src, c.sourcePortId, tgt, c.targetPortId);
        conn.id = c.id;
        await editor.addConnection(conn);
        connectionMap.set(c.id, conn);
      }

      // Remove stale connections (from editor to match engine)
      for (const conn of editor.getConnections()) {
        const id = String((conn as any).id);
        if (engineConnIds.has(id)) continue;
        const targetId = String((conn as any).target ?? '');
        const portId = String((conn as any).targetInput ?? '');
        try {
          await editor.removeConnection(id);
        } catch (err) {
          console.warn('[NodeCanvas] removeConnection failed', id, err);
        }
        connectionMap.delete(id);
      }

      // Remove stale nodes (from editor to match engine)
      for (const node of editor.getNodes()) {
        const id = String((node as any).id);
        if (engineNodeIds.has(id)) continue;
        try {
          await editor.removeNode(id);
        } catch (err) {
          console.warn('[NodeCanvas] removeNode failed', id, err);
        }
        nodeMap.delete(id);
      }

      // Disable inline input controls when their inputs are connected (ComfyUI-like behavior).
      const connectedInputs = new Set<string>();
      for (const c of state.connections) connectedInputs.add(`${c.targetNodeId}:${c.targetPortId}`);

      for (const n of state.nodes) {
        const reteNode = nodeMap.get(n.id);
        if (!reteNode) continue;
        const def = nodeRegistry.get(n.type);
        let updated = false;
        for (const port of def?.inputs ?? []) {
          const input = reteNode?.inputs?.[port.id];
          const control = input?.control as any;
          if (!control) continue;
          const nextReadonly = connectedInputs.has(`${n.id}:${port.id}`);
          if (Boolean(control.readonly) !== nextReadonly) {
            control.readonly = nextReadonly;
            updated = true;
          }
        }
        if (updated) await areaPlugin.update('node', n.id);
      }

      await applyMidiMapRangeConstraints(state);
    } finally {
      isSyncingGraph = false;
      requestMinimapUpdate();
      requestLoopFramesUpdate();
      void applyLoopHighlights();
      void applyGroupHighlights();
      void applyMidiHighlights();
    }
  }

  function scheduleGraphSync(state: { nodes: NodeInstance[]; connections: EngineConnection[] }) {
    queuedGraphState = state;
    if (syncLoop) return syncLoop;
    syncLoop = (async () => {
      while (queuedGraphState) {
        const next = queuedGraphState;
        queuedGraphState = null;
        try {
          await syncGraph(next);
        } catch (err) {
          console.error('[NodeCanvas] syncGraph failed', err);
        }
      }
    })().finally(() => {
      syncLoop = null;
    });
    return syncLoop;
  }

  function computeMinimap() {
    if (!container || !areaPlugin?.area) return;
    const area = areaPlugin.area;
    const k = Number(area.transform?.k ?? 1) || 1;
    const tx = Number(area.transform?.x ?? 0) || 0;
    const ty = Number(area.transform?.y ?? 0) || 0;

    const viewport = {
      x: -tx / k,
      y: -ty / k,
      width: container.clientWidth / k,
      height: container.clientHeight / k,
    };

    const nodes: MiniNode[] = [];
    for (const [id, view] of areaPlugin.nodeViews?.entries?.() ?? []) {
      const el = view?.element as HTMLElement | undefined;
      const width = el?.clientWidth ?? 230;
      const height = el?.clientHeight ?? 100;
      const pos = view?.position ?? { x: 0, y: 0 };
      nodes.push({
        id: String(id),
        x: Number(pos.x) || 0,
        y: Number(pos.y) || 0,
        width,
        height,
        selected: String(id) === selectedNodeId,
      });
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const connections: MiniConnection[] = [];
    for (const c of graphState.connections ?? []) {
      const source = nodeById.get(String(c.sourceNodeId));
      const target = nodeById.get(String(c.targetNodeId));
      if (!source || !target) continue;
      const id = String(c.id);
      connections.push({
        id,
        x1: source.x + source.width,
        y1: source.y + source.height / 2,
        x2: target.x,
        y2: target.y + target.height / 2,
        localLoop: localLoopConnIds.has(id),
        deployedLoop: deployedConnIds.has(id),
      });
    }

    const hasNodes = nodes.length > 0;
    let minX = hasNodes ? (nodes[0]?.x ?? 0) : viewport.x;
    let minY = hasNodes ? (nodes[0]?.y ?? 0) : viewport.y;
    let maxX = hasNodes ? (nodes[0]?.x ?? 0) + (nodes[0]?.width ?? 0) : viewport.x + viewport.width;
    let maxY = hasNodes
      ? (nodes[0]?.y ?? 0) + (nodes[0]?.height ?? 0)
      : viewport.y + viewport.height;

    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    // Ensure the current viewport is always visible in the minimap bounds.
    minX = Math.min(minX, viewport.x);
    minY = Math.min(minY, viewport.y);
    maxX = Math.max(maxX, viewport.x + viewport.width);
    maxY = Math.max(maxY, viewport.y + viewport.height);

    // Add padding so the viewport outline remains visible even when it matches the bounds closely.
    const padding = 120;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const size = minimapUi.size;
    const margin = 10;
    const extent = Math.max(width, height, 1);
    const scale = (size - margin * 2) / extent;
    const offsetX = (size - width * scale) / 2;
    const offsetY = (size - height * scale) / 2;

    minimap = {
      size,
      nodes,
      connections,
      viewport,
      bounds: { minX, minY, width, height },
      scale,
      offsetX,
      offsetY,
    };
  }

  function requestMinimapUpdate() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (minimapRaf) return;
    minimapRaf = requestAnimationFrame(() => {
      minimapRaf = 0;
      computeMinimap();
    });
  }

  function requestLoopFramesUpdate() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (loopFramesRaf) return;
    loopFramesRaf = requestAnimationFrame(() => {
      loopFramesRaf = 0;
      computeLoopFrames();
      computeGroupFrames();
      computeGroupSelectionBounds();
    });
  }

  type AreaTransform = { k: number; tx: number; ty: number };
  type NodeBounds = { left: number; top: number; right: number; bottom: number };

  function readAreaTransform(): AreaTransform | null {
    if (!areaPlugin?.area) return null;
    const area = areaPlugin.area;
    normalizeAreaTransform(area);
    const k = Number(area.transform?.k ?? 1) || 1;
    const tx = Number(area.transform?.x ?? 0) || 0;
    const ty = Number(area.transform?.y ?? 0) || 0;
    return { k, tx, ty };
  }

  function readNodeBounds(nodeId: string, t: AreaTransform): NodeBounds | null {
    if (!areaPlugin?.nodeViews) return null;
    const view = areaPlugin.nodeViews.get(String(nodeId));
    const el = view?.element as HTMLElement | undefined;
    const pos = view?.position as { x: number; y: number } | undefined;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;

    const width = (el?.clientWidth ?? 230) * t.k;
    const height = (el?.clientHeight ?? 100) * t.k;
    const left = pos.x * t.k + t.tx;
    const top = pos.y * t.k + t.ty;
    return { left, top, right: left + width, bottom: top + height };
  }

  function unionBounds(nodeIds: string[], t: AreaTransform): NodeBounds | null {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const nodeId of nodeIds) {
      const b = readNodeBounds(nodeId, t);
      if (!b) continue;
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      right = Math.max(right, b.right);
      bottom = Math.max(bottom, b.bottom);
    }

    const hasBounds =
      Number.isFinite(left) &&
      Number.isFinite(top) &&
      Number.isFinite(right) &&
      Number.isFinite(bottom);
    if (!hasBounds) return null;
    return { left, top, right, bottom };
  }

  function computeLoopFrames() {
    if (!container || !areaPlugin?.nodeViews || !areaPlugin?.area) {
      loopFrames = [];
      return;
    }

    const t = readAreaTransform();
    if (!t) {
      loopFrames = [];
      return;
    }

    // Padding is in viewport px (post-zoom) so frames also include node shadows.
    const paddingX = 56;
    const paddingTop = 64; // includes header space + shadows
    const paddingBottom = 64;

    const frames: LoopFrame[] = [];
    for (const loop of localLoops) {
      const bounds = unionBounds(loop.nodeIds, t);
      if (!bounds) continue;
      const left = bounds.left;
      const top = bounds.top;
      const right = bounds.right;
      const bottom = bounds.bottom;

      const localLeft = left - paddingX;
      const localTop = top - paddingTop;
      const localWidth = right - left + paddingX * 2;
      const localHeight = bottom - top + paddingTop + paddingBottom;

      frames.push({
        loop,
        left: localLeft,
        top: localTop,
        width: localWidth,
        height: localHeight,
      });
    }

    loopFrames = frames;
  }

  function computeGroupFrames() {
    if (!container || !areaPlugin?.nodeViews || !areaPlugin?.area) {
      groupFrames = [];
      return;
    }
    if (nodeGroups.length === 0) {
      groupFrames = [];
      return;
    }

    const t = readAreaTransform();
    if (!t) {
      groupFrames = [];
      return;
    }

    const paddingX = 52;
    const paddingTop = 64;
    const paddingBottom = 52;

    // Loop frames include additional padding beyond node bounds; when a group fully contains a loop,
    // expand the group bounds so the loop frame is fully wrapped.
    const loopPaddingX = 56;
    const loopPaddingTop = 64;
    const loopPaddingBottom = 64;

    const frames: GroupFrame[] = [];
    for (const group of nodeGroups) {
      if (editModeGroupId === group.id && editModeGroupBounds) {
        const left = editModeGroupBounds.left * t.k + t.tx;
        const top = editModeGroupBounds.top * t.k + t.ty;
        const right = editModeGroupBounds.right * t.k + t.tx;
        const bottom = editModeGroupBounds.bottom * t.k + t.ty;
        frames.push({
          group,
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
        continue;
      }

      const base = unionBounds(group.nodeIds, t);
      if (!base) continue;

      let bounds = { ...base };
      const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
      for (const loop of localLoops) {
        if (!loop?.nodeIds?.length) continue;
        const fullyContained = loop.nodeIds.every((id) => groupNodeSet.has(String(id)));
        if (!fullyContained) continue;
        const lb = unionBounds(loop.nodeIds, t);
        if (!lb) continue;
        bounds.left = Math.min(bounds.left, lb.left - loopPaddingX);
        bounds.top = Math.min(bounds.top, lb.top - loopPaddingTop);
        bounds.right = Math.max(bounds.right, lb.right + loopPaddingX);
        bounds.bottom = Math.max(bounds.bottom, lb.bottom + loopPaddingBottom);
      }

      const localLeft = bounds.left - paddingX;
      const localTop = bounds.top - paddingTop;
      const localWidth = bounds.right - bounds.left + paddingX * 2;
      const localHeight = bounds.bottom - bounds.top + paddingTop + paddingBottom;

      frames.push({
        group,
        left: localLeft,
        top: localTop,
        width: localWidth,
        height: localHeight,
      });
    }

    groupFrames = frames;
  }

  function computeGroupSelectionBounds() {
    if (!container || !areaPlugin?.area) {
      groupSelectionBounds = null;
      return;
    }
    if (groupSelectionNodeIds.size === 0) {
      groupSelectionBounds = null;
      return;
    }

    const t = readAreaTransform();
    if (!t) {
      groupSelectionBounds = null;
      return;
    }

    const bounds = unionBounds(Array.from(groupSelectionNodeIds), t);
    if (!bounds) {
      groupSelectionBounds = null;
      return;
    }

    const pad = 18;
    groupSelectionBounds = {
      left: bounds.left - pad,
      top: bounds.top - pad,
      width: bounds.right - bounds.left + pad * 2,
      height: bounds.bottom - bounds.top + pad * 2,
    };
  }

  function toMiniX(x: number) {
    return minimap.offsetX + (x - minimap.bounds.minX) * minimap.scale;
  }

  function toMiniY(y: number) {
    return minimap.offsetY + (y - minimap.bounds.minY) * minimap.scale;
  }

  function handleMinimapPointerDown(event: PointerEvent) {
    if (!container || !areaPlugin?.area) return;
    event.preventDefault();
    event.stopPropagation();

    const el = event.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const graphX = minimap.bounds.minX + (mx - minimap.offsetX) / minimap.scale;
    const graphY = minimap.bounds.minY + (my - minimap.offsetY) / minimap.scale;

    // If the user presses within the viewport "window", allow dragging it to pan the main area.
    const viewportX = toMiniX(minimap.viewport.x);
    const viewportY = toMiniY(minimap.viewport.y);
    const viewportW = Math.max(4, minimap.viewport.width * minimap.scale);
    const viewportH = Math.max(4, minimap.viewport.height * minimap.scale);
    const hitSlop = 8;
    const hitViewport =
      mx >= viewportX - hitSlop &&
      mx <= viewportX + viewportW + hitSlop &&
      my >= viewportY - hitSlop &&
      my <= viewportY + viewportH + hitSlop;

    if (hitViewport) {
      isMinimapViewportDragging = true;
      minimapViewportPointerId = event.pointerId;

      const centerX = minimap.viewport.x + minimap.viewport.width / 2;
      const centerY = minimap.viewport.y + minimap.viewport.height / 2;
      minimapViewportGrabOffset = { x: graphX - centerX, y: graphY - centerY };

      try {
        el?.setPointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    const area = areaPlugin.area;
    normalizeAreaTransform(area);
    const k = Number(area.transform?.k ?? 1) || 1;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    void area.translate(cx - graphX * k, cy - graphY * k);
    requestMinimapUpdate();
  }

  function handleMinimapPointerMove(event: PointerEvent) {
    if (!isMinimapViewportDragging) return;
    if (event.pointerId !== minimapViewportPointerId) return;
    if (!container || !areaPlugin?.area) return;

    event.preventDefault();
    event.stopPropagation();

    const el = event.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const graphX = minimap.bounds.minX + (mx - minimap.offsetX) / minimap.scale;
    const graphY = minimap.bounds.minY + (my - minimap.offsetY) / minimap.scale;

    const desiredCenterX = graphX - minimapViewportGrabOffset.x;
    const desiredCenterY = graphY - minimapViewportGrabOffset.y;

    const area = areaPlugin.area;
    normalizeAreaTransform(area);
    const k = Number(area.transform?.k ?? 1) || 1;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    void area.translate(cx - desiredCenterX * k, cy - desiredCenterY * k);
    requestMinimapUpdate();
  }

  function handleMinimapPointerUp(event: PointerEvent) {
    if (!isMinimapViewportDragging) return;
    if (event.pointerId !== minimapViewportPointerId) return;
    isMinimapViewportDragging = false;
    minimapViewportPointerId = -1;
    requestMinimapUpdate();
  }

  function clampMinimapSize(size: number): number {
    const next = Math.floor(size);
    return Math.max(MIN_MINIMAP_SIZE, Math.min(MAX_MINIMAP_SIZE, next));
  }

  function clampMinimapPosition(next: MinimapUiState): MinimapUiState {
    if (!container) return next;
    const width = next.size + MINIMAP_BAR_WIDTH;
    const height = next.size;
    const maxX = Math.max(0, container.clientWidth - width);
    const maxY = Math.max(0, container.clientHeight - height);
    return {
      ...next,
      x: Math.max(0, Math.min(maxX, next.x)),
      y: Math.max(0, Math.min(maxY, next.y)),
    };
  }

  function isMinimapContainerReady(): boolean {
    if (!container) return false;
    return container.clientWidth > 50 && container.clientHeight > 50;
  }

  function applyMinimapPreferences(prefs: MinimapPreferences) {
    if (!container) return;
    const size = clampMinimapSize(prefs.size);

    // Wait until the canvas container has a real size; otherwise clamping would force (0,0) and
    // we'd "lose" the saved/default placement until the next refresh.
    if (!isMinimapContainerReady()) {
      pendingMinimapPrefs = prefs;
      minimapUi = clampMinimapPosition({ ...minimapUi, size });
      requestMinimapUpdate();
      return;
    }
    pendingMinimapPrefs = null;

    let x = Number(prefs.x);
    let y = Number(prefs.y);
    const useDefault = !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0;
    if (useDefault) {
      x = container.clientWidth - (size + MINIMAP_BAR_WIDTH) - MINIMAP_MARGIN;
      y = container.clientHeight - size - MINIMAP_MARGIN;
    }

    minimapUi = clampMinimapPosition({ x, y, size });
    requestMinimapUpdate();
  }

  function commitMinimapPreferences() {
    const prev = get(minimapPreferences);
    if (prev.x === minimapUi.x && prev.y === minimapUi.y && prev.size === minimapUi.size) return;
    minimapPreferences.set({ x: minimapUi.x, y: minimapUi.y, size: minimapUi.size });
  }

  function zoomMinimap(delta: number) {
    const size = clampMinimapSize(minimapUi.size + delta);
    minimapUi = clampMinimapPosition({ ...minimapUi, size });
    requestMinimapUpdate();
    commitMinimapPreferences();
  }

  function handleMinimapMovePointerDown(event: PointerEvent) {
    if (!container) return;
    event.preventDefault();
    event.stopPropagation();
    isMinimapDragging = true;
    minimapDragPointerId = event.pointerId;
    minimapDragStart = {
      x: event.clientX,
      y: event.clientY,
      originX: minimapUi.x,
      originY: minimapUi.y,
    };
    const el = event.currentTarget as HTMLElement | null;
    try {
      el?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  }

  function handleMinimapMovePointerMove(event: PointerEvent) {
    if (!isMinimapDragging) return;
    if (event.pointerId !== minimapDragPointerId) return;
    const dx = event.clientX - minimapDragStart.x;
    const dy = event.clientY - minimapDragStart.y;
    minimapUi = clampMinimapPosition({
      ...minimapUi,
      x: minimapDragStart.originX + dx,
      y: minimapDragStart.originY + dy,
    });
  }

  function handleMinimapMovePointerUp(event: PointerEvent) {
    if (!isMinimapDragging) return;
    if (event.pointerId !== minimapDragPointerId) return;
    isMinimapDragging = false;
    minimapDragPointerId = -1;
    commitMinimapPreferences();
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
          const control = input?.control as any;
          if (control && Boolean(control.readonly) !== true) {
            control.readonly = true;
            await areaPlugin?.update?.('node', engineConn.targetNodeId);
          }
        } else if (editor) {
          // Engine rejected; rollback UI to match source of truth.
          try {
            if (editor.getConnection(String(c.id))) {
              await editor.removeConnection(String(c.id));
            }
          } catch (err) {
            console.warn('[NodeCanvas] rollback removeConnection failed', String(c.id), err);
          }
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
        const control = input?.control as any;
        if (control) {
          const stillConnected = Array.from(connectionMap.values()).some(
            (conn: any) => String(conn.target) === targetId && String(conn.targetInput) === portId
          );
          if (Boolean(control.readonly) !== stillConnected) {
            control.readonly = stillConnected;
            await areaPlugin?.update?.('node', targetId);
          }
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
      areaPlugin.addPipe(async (ctx: any) => {
        if (ctx?.type === 'nodepicked') {
          setSelectedNode(String(ctx.data?.id ?? ''));
        }
        if (ctx?.type === 'nodetranslate') {
          if (isProgrammaticTranslate() || isMultiDragTranslate()) return ctx;
          isNodeDragging = true;

          const id = String(ctx.data?.id ?? '');
          if (id && groupSelectionNodeIds.size > 1 && groupSelectionNodeIds.has(id)) {
            multiDragLeaderId = id;
            const view = areaPlugin?.nodeViews?.get?.(id);
            const pos = view?.position as { x: number; y: number } | undefined;
            multiDragLeaderLastPos = pos ? { x: pos.x, y: pos.y } : null;
          } else {
            multiDragLeaderId = null;
            multiDragLeaderLastPos = null;
          }
        }
        if (ctx?.type === 'nodedragged') {
          isNodeDragging = false;
          const id = String(ctx.data?.id ?? '');
          const movedNodeIds =
            multiDragLeaderId &&
            id === multiDragLeaderId &&
            groupSelectionNodeIds.size > 1 &&
            groupSelectionNodeIds.has(id)
              ? Array.from(groupSelectionNodeIds).map(String)
              : id
                ? [id]
                : [];
          multiDragLeaderId = null;
          multiDragLeaderLastPos = null;
          handleDroppedNodesAfterDrag(movedNodeIds);
        }
        if (
          ctx?.type === 'translated' ||
          ctx?.type === 'zoomed' ||
          ctx?.type === 'nodetranslated'
        ) {
          requestMinimapUpdate();
          requestLoopFramesUpdate();
        }
        if (ctx?.type === 'pointerdown') {
          const target = ctx.data?.event?.target as HTMLElement | undefined;
          const clickedNode = target?.closest?.('.node');
          if (!clickedNode) setSelectedNode('');
        }
        if (ctx?.type === 'nodetranslated') {
          const { id, position } = ctx.data ?? {};
          if (id && position) {
            const nodeId = String(id);

            if (
              multiDragLeaderId &&
              nodeId === multiDragLeaderId &&
              groupSelectionNodeIds.size > 1 &&
              !isProgrammaticTranslate()
            ) {
              if (!multiDragLeaderLastPos) {
                multiDragLeaderLastPos = { x: position.x, y: position.y };
              } else {
                const dx = position.x - multiDragLeaderLastPos.x;
                const dy = position.y - multiDragLeaderLastPos.y;
                multiDragLeaderLastPos = { x: position.x, y: position.y };

                if ((dx || dy) && areaPlugin?.nodeViews) {
                  multiDragTranslateDepth += 1;
                  try {
                    const promises: Promise<unknown>[] = [];
                    for (const otherId of groupSelectionNodeIds) {
                      const oid = String(otherId);
                      if (oid === nodeId) continue;
                      const view = areaPlugin.nodeViews.get(oid);
                      const pos = view?.position as { x: number; y: number } | undefined;
                      if (!pos) continue;
                      promises.push(areaPlugin.translate(oid, { x: pos.x + dx, y: pos.y + dy }));
                    }
                    await Promise.all(promises);
                  } finally {
                    multiDragTranslateDepth = Math.max(0, multiDragTranslateDepth - 1);
                  }
                }
              }
            }

            nodeEngine.updateNodePosition(nodeId, { x: position.x, y: position.y });
          }
        }
        return ctx;
      });
    }
  }

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

  function handleAddNode() {
    if (!addItem) return;
    addNode(addItem);
  }

  function handleToggleEngine() {
    if ($isRunningStore) {
      nodeEngine.stop();
      stopAllClientEffects();
      stopAllDeployedLoops();
    } else {
      nodeEngine.start();
    }
  }

  function handleClear() {
    if (confirm('Clear all nodes?')) {
      nodeEngine.clear();
      nodeGroups = [];
      groupFrames = [];
      groupDisabledNodeIds = new Set();
      editModeGroupId = null;
      editModeGroupBounds = null;
      clearGroupEditToast();
      clearGroupSelection();
      scheduleGroupHighlight();
    }
  }

  function downloadJson(payload: unknown, filename: string) {
    if (typeof document === 'undefined') return;
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  type NodeGraphFileV1 = { version: 1; kind: 'node-graph'; graph: GraphState };

  function parseNodeGraphFile(payload: unknown): GraphState | null {
    if (!payload || typeof payload !== 'object') return null;
    // Wrapped export
    const wrapped = payload as any;
    if (wrapped.kind === 'node-graph' && wrapped.version === 1 && wrapped.graph) {
      const graph = wrapped.graph as any;
      if (Array.isArray(graph.nodes) && Array.isArray(graph.connections))
        return graph as GraphState;
      return null;
    }
    // Backward/loose: accept raw GraphState
    const raw = payload as any;
    if (Array.isArray(raw.nodes) && Array.isArray(raw.connections)) return raw as GraphState;
    return null;
  }

  function exportGraph() {
    const raw = nodeEngine.exportGraph();
    // Strip runtime outputs to keep exported graphs deterministic and compact.
    const graph: GraphState = {
      nodes: (raw.nodes ?? []).map((n) => ({ ...n, outputValues: {} })),
      connections: (raw.connections ?? []).map((c) => ({ ...c })),
    };
    const file: NodeGraphFileV1 = { version: 1, kind: 'node-graph', graph };
    downloadJson(file, 'shugu-node-graph.json');
  }

  function importGraph() {
    importGraphInputEl?.click?.();
  }

  async function handleImportGraphChange(event: Event) {
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

    const graph = parseNodeGraphFile(parsed);
    if (!graph) {
      alert('Unsupported graph format.');
      return;
    }

    const ok = confirm('Load graph from file? This will replace the current graph.');
    if (!ok) return;
    nodeEngine.loadGraph(graph);
    nodeGroups = [];
    groupFrames = [];
    groupDisabledNodeIds = new Set();
    editModeGroupId = null;
    editModeGroupBounds = null;
    clearGroupEditToast();
    clearGroupSelection();
    scheduleGroupHighlight();
  }

  function exportTemplates() {
    const file = exportMidiTemplateFile(nodeEngine.exportGraph());
    downloadJson(file, 'shugu-midi-templates.json');
  }

  function importTemplates() {
    importTemplatesInputEl?.click?.();
  }

  function closeToolbarMenu() {
    isToolbarMenuOpen = false;
  }

  function toggleToolbarMenu() {
    isToolbarMenuOpen = !isToolbarMenuOpen;
  }

  function handleToolbarMenuPick(action: () => void) {
    closeToolbarMenu();
    action();
  }

  function viewportCenterGraphPos(): { x: number; y: number } {
    if (!container) return { x: 120 + nodeCount * 10, y: 120 + nodeCount * 6 };
    const rect = container.getBoundingClientRect();
    return computeGraphPosition(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  async function handleImportTemplatesChange(event: Event) {
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

    const templates = parseMidiTemplateFile(parsed);
    if (!templates) {
      alert('Unsupported template format (expected version: 1).');
      return;
    }

    const created = instantiateMidiBindings(templates, { anchor: viewportCenterGraphPos() });
    alert(`Imported ${created.length} template(s).`);
  }

  function handlePickerPick(item: PickerItem) {
    const nodeId = addNode(item.type, pickerGraphPos);
    if (!nodeId) return;

    if (pickerMode === 'connect' && pickerInitialSocket && item.matchPort) {
      const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
      const initial = pickerInitialSocket;
      const engineConn: EngineConnection =
        initial.side === 'output'
          ? {
              id: connId,
              sourceNodeId: initial.nodeId,
              sourcePortId: initial.key,
              targetNodeId: nodeId,
              targetPortId: item.matchPort.id,
            }
          : {
              id: connId,
              sourceNodeId: nodeId,
              sourcePortId: item.matchPort.id,
              targetNodeId: initial.nodeId,
              targetPortId: initial.key,
            };
      nodeEngine.addConnection(engineConn);
    }

    closePicker();
  }

  $: if (selectedNodeId && !graphState.nodes.some((n) => n.id === selectedNodeId)) {
    setSelectedNode('');
  }

  $: selectedNode = graphState.nodes.find((n) => n.id === selectedNodeId);

  onMount(async () => {
    if (!container) return;

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as any).__shuguNodeEngine = nodeEngine;
    }

    // MIDI nodes rely on the shared MIDI singleton. Keep the bridge alive;
    // request MIDI access lazily when MIDI nodes are present or user presses Learn.
    midiNodeBridge.init();
    midiUnsub = midiService.onMessage((event) => handleMidiActivity(event));

    refreshNumberParams();
    paramsUnsub = parameterRegistry.subscribe(() => refreshNumberParams());

    editor = new NodeEditor('fluffy-rete');
    // @ts-expect-error runtime constructor expects container element
    areaPlugin = new AreaPlugin(container);
    const connection: any = new ConnectionPlugin();
    connectionPlugin = connection;
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
            // Mimic classic flow: non-multiple inputs get replaced.
            if (desiredSide === 'input') {
              replaceSingleInputConnection(snapped.nodeId, snapped.key);
            } else {
              replaceSingleInputConnection(initialSocket.nodeId, initialSocket.key);
            }

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
    // @ts-expect-error preset type mismatch
    render.addPreset(
      // @ts-expect-error preset type mismatch
      SveltePresets.classic.setup({
        socketPositionWatcher:
          socketPositionWatcher ?? (socketPositionWatcher = new LiveDOMSocketPosition()),
        customize: {
          node: () => ReteNode,
          connection: () => ReteConnection,
          control: () => ReteControl,
        },
      })
    );

    await scheduleGraphSync(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => {
      if ((state.nodes ?? []).some((n) => String(n.type).startsWith('midi-'))) {
        void midiService.init();
      }
      void scheduleGraphSync(state);
    });

    loopsUnsub = localLoopsStore?.subscribe((loops) => {
      const nextLoops = Array.isArray(loops) ? loops : [];
      const prevLoopIds = new Set(localLoops.map((l) => l.id));
      const addedLoops = nextLoops.filter((l) => !prevLoopIds.has(l.id));

      // If a previously deployed loop disappears (e.g. user breaks the cycle), stop + remove it on client.
      const nextIds = new Set(nextLoops.map((l) => l.id));
      const vanished = localLoops.filter((l) => !nextIds.has(l.id));

      for (const loop of vanished) {
        const loopId = loop.id;
        const pending = deployPendingByLoopId.get(loopId);
        if (pending) clearLoopDeployPending(loopId);

        const knownClientId = deployedLoopClientIdByLoopId.get(loopId) ?? pending?.clientId ?? '';
        if (!knownClientId) continue;

        const hadDeployment = deployedLoopClientIdByLoopId.has(loopId) || Boolean(pending);
        if (!hadDeployment) continue;

        stopAndRemoveLoopById(loopId, knownClientId);
        const next = new Map(deployedLoopClientIdByLoopId);
        next.delete(loopId);
        deployedLoopClientIdByLoopId = next;
      }

      localLoops = nextLoops;
      recomputeLoopHighlightSets();
      requestLoopFramesUpdate();

      // When a new loop frame is established, push unrelated nodes out of the loop bounds
      // (same behavior as group creation push-out).
      if (addedLoops.length > 0) {
        const t = readAreaTransform();
        if (t) {
          for (const loop of addedLoops) {
            const bounds = computeLoopFrameBounds(loop, t);
            if (!bounds) continue;
            pushNodesOutOfBounds(bounds, new Set((loop.nodeIds ?? []).map((id) => String(id))));
          }
        }
      }
    });

    deployedLoopsUnsub = deployedLoopsStore?.subscribe((ids) => {
      deployedLoopIds = new Set(Array.isArray(ids) ? ids : []);
      recomputeLoopHighlightSets();
      requestLoopFramesUpdate();
    });

    sensorUnsub = sensorData.subscribe((map) => {
      for (const [clientId, msg] of map.entries()) {
        const m: any = msg as any;
        if (!m || m.sensorType !== 'custom') continue;
        const payload: any = m.payload ?? {};
        if (payload?.kind !== 'node-executor') continue;

        const serverTs = Number(m.serverTimestamp ?? 0);
        if (!Number.isFinite(serverTs) || serverTs <= 0) continue;
        if (executorLastServerTimestampByClient.get(clientId) === serverTs) continue;
        executorLastServerTimestampByClient.set(clientId, serverTs);

        const event = typeof payload.event === 'string' ? payload.event : 'unknown';
        const loopId = typeof payload.loopId === 'string' ? payload.loopId : null;
        const error = payload.error ? String(payload.error) : null;

        updateExecutorStatus(clientId, {
          at: serverTs,
          event,
          loopId,
          error,
          payload: payload as Record<string, unknown>,
        });

        if (loopId && event === 'removed') {
          const next = new Map(deployedLoopClientIdByLoopId);
          next.delete(loopId);
          deployedLoopClientIdByLoopId = next;
        }

        // Deploy ACK flow: only mark the loop as deployed once the client confirms.
        if (!loopId) continue;
        const pending = deployPendingByLoopId.get(loopId);
        if (!pending) continue;
        if (pending.clientId !== clientId) continue;

        if (event === 'deployed') {
          nodeEngine.markLoopDeployed(loopId, true);
          const next = new Map(deployedLoopClientIdByLoopId);
          next.set(loopId, clientId);
          deployedLoopClientIdByLoopId = next;
          clearLoopDeployPending(loopId);
          continue;
        }

        if (event === 'rejected' || event === 'error') {
          clearLoopDeployPending(loopId);
          alert(`Deploy failed: ${error ?? event}`);
        }
      }
    });

    bindEditorPipes();

    // Fit view on first render
    if (areaPlugin) {
      await AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
      requestMinimapUpdate();
      requestLoopFramesUpdate();
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

      // Prevent browser page zoom (trackpad pinch / ctrl+wheel) globally in Manager while NodeCanvas is mounted.
      // If the cursor is slightly outside the canvas, still treat it as a canvas zoom by clamping the origin.
      if (event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        // If the canvas isn't visible/measurable, we only want to block page zoom.
        if (!hasBounds) return;
      } else if (!within) {
        return;
      }

      // Don't zoom while interacting with overlays/minimap (but still block page zoom above).
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

      // Use a smooth exponential zoom so both mouse wheels (large deltas) and trackpads (small deltas) feel good.
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

      // Always zoom the canvas on wheel/trackpad gestures.
      // Note: ctrl+wheel is already prevented above (to disable page zoom globally).
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
      requestMinimapUpdate();
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
      if (!container) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;

      // Clicking on empty canvas clears the current marquee selection.
      if (!event.shiftKey && groupSelectionNodeIds.size > 0 && isMarqueeStartTarget(target)) {
        clearGroupSelection();
        return;
      }

      if (!event.shiftKey) return;
      if (!isMarqueeStartTarget(target)) return;

      event.preventDefault();
      event.stopPropagation();

      clearGroupSelection();
      isMarqueeDragging = true;
      marqueePointerId = event.pointerId;
      marqueeStart = toContainerPoint(event.clientX, event.clientY);
      marqueeCurrent = marqueeStart;

      const onMove = (ev: PointerEvent) => {
        if (!isMarqueeDragging) return;
        if (marqueePointerId !== null && ev.pointerId !== marqueePointerId) return;
        marqueeCurrent = toContainerPoint(ev.clientX, ev.clientY);
      };

      const onUp = (ev: PointerEvent) => {
        if (marqueePointerId !== null && ev.pointerId !== marqueePointerId) return;
        isMarqueeDragging = false;
        marqueePointerId = null;

        if (marqueeMoveHandler)
          window.removeEventListener('pointermove', marqueeMoveHandler, { capture: true } as any);
        if (marqueeUpHandler) {
          window.removeEventListener('pointerup', marqueeUpHandler, { capture: true } as any);
          window.removeEventListener('pointercancel', marqueeUpHandler, { capture: true } as any);
        }
        marqueeMoveHandler = null;
        marqueeUpHandler = null;

        const selLeft = Math.min(marqueeStart.x, marqueeCurrent.x);
        const selTop = Math.min(marqueeStart.y, marqueeCurrent.y);
        const selRight = Math.max(marqueeStart.x, marqueeCurrent.x);
        const selBottom = Math.max(marqueeStart.y, marqueeCurrent.y);

        const t = readAreaTransform();
        if (!t) return;

        const selected: string[] = [];
        for (const nodeId of nodeMap.keys()) {
          const b = readNodeBounds(nodeId, t);
          if (!b) continue;
          const intersects =
            b.right >= selLeft && b.left <= selRight && b.bottom >= selTop && b.top <= selBottom;
          if (!intersects) continue;
          selected.push(nodeId);
        }

        groupSelectionNodeIds = new Set(selected);
        scheduleGroupHighlight();
        computeGroupSelectionBounds();
      };

      marqueeMoveHandler = onMove;
      marqueeUpHandler = onUp;
      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      window.addEventListener('pointercancel', onUp, { capture: true });
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    pointerDownHandler = onPointerDown;

    const onPointerMove = (event: PointerEvent) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
    };
    container.addEventListener('pointermove', onPointerMove, { capture: true });
    pointerMoveHandler = onPointerMove;

    resizeObserver = new ResizeObserver(() => {
      // When switching away from Node Graph, this container becomes `display: none`, which reports
      // `0x0` here. Avoid clamping UI state to `(0,0)` so the minimap doesn't "jump" to the top-left.
      if (!isMinimapContainerReady()) return;

      const area = areaPlugin?.area;
      if (!area) return;
      isNodeDragging = false;
      // Re-apply current transform after layout changes (keeps pointer math consistent after resizes).
      normalizeAreaTransform(area);
      area.update?.();
      minimapUi = clampMinimapPosition(minimapUi);
      if (pendingMinimapPrefs && isMinimapContainerReady()) {
        applyMinimapPreferences(pendingMinimapPrefs);
        pendingMinimapPrefs = null;
      } else {
        requestMinimapUpdate();
      }
      requestLoopFramesUpdate();
    });
    resizeObserver.observe(container);

    minimapPrefsUnsub?.();
    minimapPrefsUnsub = minimapPreferences.subscribe((prefs) => {
      applyMinimapPreferences(prefs);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === 'Escape' && isToolbarMenuOpen) {
        event.preventDefault();
        closeToolbarMenu();
        return;
      }
      if (key === 'Escape' && isPickerOpen) {
        event.preventDefault();
        closePicker();
        return;
      }
      if (key === 'Escape' && groupSelectionNodeIds.size > 0) {
        event.preventDefault();
        clearGroupSelection();
        return;
      }
      if (key !== 'Backspace' && key !== 'Delete') return;

      const el = (event.target as HTMLElement | null) ?? document.activeElement;
      const tag = el?.tagName?.toLowerCase?.() ?? '';
      const isEditing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean((el as any)?.isContentEditable);
      if (isEditing) return;

      // If a marquee multi-selection exists, delete all selected nodes together.
      if (groupSelectionNodeIds.size > 0) {
        event.preventDefault();
        for (const id of groupSelectionNodeIds) {
          nodeEngine.removeNode(id);
        }
        clearGroupSelection();
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
    paramsUnsub?.();
    loopsUnsub?.();
    deployedLoopsUnsub?.();
    sensorUnsub?.();
    midiUnsub?.();
    if (midiHighlightTimeout) clearTimeout(midiHighlightTimeout);
    if (groupEditToastTimeout) clearTimeout(groupEditToastTimeout);
    for (const entry of deployPendingByLoopId.values()) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
    }
    if (wheelHandler) window.removeEventListener('wheel', wheelHandler, { capture: true } as any);
    if (contextMenuHandler)
      container?.removeEventListener('contextmenu', contextMenuHandler, { capture: true } as any);
    if (pointerDownHandler)
      container?.removeEventListener('pointerdown', pointerDownHandler, { capture: true } as any);
    if (pointerMoveHandler)
      container?.removeEventListener('pointermove', pointerMoveHandler, { capture: true } as any);
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
    if (toolbarMenuOutsideHandler)
      window.removeEventListener('pointerdown', toolbarMenuOutsideHandler, {
        capture: true,
      } as any);
    if (marqueeMoveHandler)
      window.removeEventListener('pointermove', marqueeMoveHandler, { capture: true } as any);
    if (marqueeUpHandler) {
      window.removeEventListener('pointerup', marqueeUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', marqueeUpHandler, { capture: true } as any);
    }
    resizeObserver?.disconnect();
    minimapPrefsUnsub?.();
    if (minimapRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(minimapRaf);
    if (loopFramesRaf && typeof cancelAnimationFrame !== 'undefined')
      cancelAnimationFrame(loopFramesRaf);
    socketPositionWatcher?.destroy();
    areaPlugin?.destroy?.();
    editor?.clear();
    nodeMap.clear();
    connectionMap.clear();

    // Node groups are currently UI-only; ensure we don't leave nodes disabled if the canvas unmounts.
    nodeEngine.clearDisabledNodes();

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      if ((window as any).__shuguNodeEngine === nodeEngine) {
        delete (window as any).__shuguNodeEngine;
      }
    }
  });
</script>

<div class="node-canvas-container">
  <input
    bind:this={importGraphInputEl}
    type="file"
    accept="application/json"
    on:change={handleImportGraphChange}
    style="display: none;"
  />
  <input
    bind:this={importTemplatesInputEl}
    type="file"
    accept="application/json"
    on:change={handleImportTemplatesChange}
    style="display: none;"
  />
  <NodeCanvasToolbar
    bind:toolbarMenuWrap
    isRunning={$isRunningStore}
    {nodeCount}
    lastError={$lastErrorStore}
    isMenuOpen={isToolbarMenuOpen}
    onToggleEngine={handleToggleEngine}
    onClear={handleClear}
    onToggleMenu={toggleToolbarMenu}
    onMenuPick={handleToolbarMenuPick}
    onImportGraph={importGraph}
    onExportGraph={exportGraph}
    onImportTemplates={importTemplates}
    onExportTemplates={exportTemplates}
  />

  {#if showExecutorLogs && logsClientId}
    <ExecutorLogsPanel
      clientId={logsClientId}
      status={logsStatus}
      onClose={() => (showExecutorLogs = false)}
    />
  {/if}

  <div
    class="canvas-wrapper"
    bind:this={container}
    role="application"
    aria-label="Node graph editor"
  >
    <div class="canvas-dimmer" class:active={$isRunningStore} aria-hidden="true" />

    <NodePickerOverlay
      isOpen={isPickerOpen}
      mode={pickerMode}
      initialSocket={pickerInitialSocket}
      connectTypeLabel={pickerInitialSocket
        ? (getPortDefForSocket(pickerInitialSocket)?.type ?? 'any')
        : 'any'}
      anchor={pickerAnchor}
      bind:query={pickerQuery}
      categories={pickerCategories}
      bind:selectedCategory={pickerSelectedCategory}
      items={pickerItems}
      onClose={closePicker}
      onPick={handlePickerPick}
      bind:pickerElement
    />

    <GroupFramesOverlay
      frames={groupFrames}
      editModeGroupId={editModeGroupId}
      toast={groupEditToast}
      onToggleDisabled={toggleGroupDisabled}
      onToggleEditMode={toggleGroupEditMode}
      onDisassemble={disassembleGroup}
      onRename={renameGroup}
    />

    <LoopFramesOverlay
      frames={loopFrames}
      {deployedLoopIds}
      {getLoopClientId}
      {executorStatusByClient}
      {showExecutorLogs}
      {logsClientId}
      isRunning={$isRunningStore}
      onToggleLogs={toggleLoopLogs}
      onStop={stopLoop}
      onDeploy={deployLoop}
      {isLoopDeploying}
      {loopHasDisabledNodes}
    />

    <MarqueeOverlay
      {marqueeRect}
      selectionBounds={groupSelectionBounds}
      selectionCount={groupSelectionNodeIds.size}
      onCreateGroup={createNodeGroupFromSelection}
    />

    <NodeCanvasMinimap
      {minimapUi}
      {minimap}
      zoomStep={MINIMAP_STEP}
      {toMiniX}
      {toMiniY}
      onZoom={zoomMinimap}
      onMovePointerDown={handleMinimapMovePointerDown}
      onMovePointerMove={handleMinimapMovePointerMove}
      onMovePointerUp={handleMinimapMovePointerUp}
      onPointerDown={handleMinimapPointerDown}
      onPointerMove={handleMinimapPointerMove}
      onPointerUp={handleMinimapPointerUp}
    />
  </div>
</div>

<style>
  .node-canvas-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    position: relative;
    min-width: 0;
    min-height: 0;
    background:
      radial-gradient(circle at 20% 0%, rgba(99, 102, 241, 0.18), transparent 45%),
      radial-gradient(circle at 80% 10%, rgba(168, 85, 247, 0.16), transparent 50%),
      linear-gradient(180deg, #0b0c14 0%, #070811 100%);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    border: 1px solid var(--border-color, #444);
  }

  .canvas-wrapper {
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    position: relative;
    z-index: 0;
    isolation: isolate;
    overflow: hidden;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      radial-gradient(circle at 30% 0%, rgba(99, 102, 241, 0.12), transparent 50%),
      radial-gradient(circle at 70% 10%, rgba(168, 85, 247, 0.1), transparent 55%),
      linear-gradient(180deg, rgba(10, 11, 20, 0.85) 0%, rgba(7, 8, 17, 0.95) 100%);
    background-size:
      32px 32px,
      32px 32px,
      auto,
      auto,
      auto;
    background-position: center, center, center, center, center;
  }

  .canvas-dimmer {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: rgba(0, 0, 0, 0.38);
    opacity: 0;
    pointer-events: none;
    transition: opacity 520ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .canvas-dimmer.active {
    opacity: 1;
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

  :global(.node-canvas-container .socket[title='color']) {
    background: rgba(236, 72, 153, 0.95) !important;
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
