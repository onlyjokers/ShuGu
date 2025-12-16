<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy, tick } from 'svelte';
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
  import type { NodeInstance, NodePort, PortType, Connection as EngineConnection } from '$lib/nodes/types';
  import { BooleanControl, ClientPickerControl, ClientSensorValueControl, SelectControl } from './rete-controls';

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
  let contextMenuHandler: ((event: MouseEvent) => void) | null = null;
  let pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let lastPointerClient = { x: 0, y: 0 };

  let queuedGraphState: { nodes: NodeInstance[]; connections: EngineConnection[] } | null = null;
  let syncLoop: Promise<void> | null = null;

  type MiniNode = { id: string; x: number; y: number; width: number; height: number; selected: boolean };
  type MinimapState = {
    size: number;
    nodes: MiniNode[];
    viewport: { x: number; y: number; width: number; height: number };
    bounds: { minX: number; minY: number; width: number; height: number };
    scale: number;
    offsetX: number;
    offsetY: number;
  };

  const minimapSize = 190;
  let minimap: MinimapState = {
    size: minimapSize,
    nodes: [],
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
      const out: any = new ClassicPreset.Output(socketFor(output.type), output.label ?? output.id);
      if (instance.type === 'proc-client-sensors') {
        out.control = new ClientSensorValueControl({ nodeId: instance.id, portId: output.id });
      }
      node.addOutput(output.id, out);
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

  function isCompatible(sourceType: PortType, targetType: PortType) {
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
  }

  function getPortDefForSocket(socket: SocketData): NodePort | null {
    const instance = nodeEngine.getNode(socket.nodeId);
    if (!instance) return null;
    const def = nodeRegistry.get(instance.type);
    if (!def) return null;
    if (socket.side === 'output') return (def.outputs ?? []).find((p) => p.id === socket.key) ?? null;
    return (def.inputs ?? []).find((p) => p.id === socket.key) ?? null;
  }

  function bestMatchingPort(ports: NodePort[], requiredType: PortType, portSide: 'input' | 'output') {
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

  function findPortRowSocketAt(clientX: number, clientY: number, desiredSide: 'input' | 'output'): SocketData | null {
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
      const input = pickerElement?.querySelector?.('input.picker-search') as HTMLInputElement | null;
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

  $: if (isPickerOpen && pickerCategories.length > 0 && !pickerCategories.includes(pickerSelectedCategory)) {
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

        const targetNode = nodeMap.get(c.targetNodeId);
        const input = targetNode?.inputs?.[c.targetPortId];
        if (input?.control) {
          input.showControl = false;
          await areaPlugin.update('node', c.targetNodeId);
        }
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

        const targetNode = nodeMap.get(targetId);
        const input = targetNode?.inputs?.[portId];
        if (input?.control) {
          const stillConnected = editor
            .getConnections()
            .some((c2: any) => String(c2.target) === targetId && String(c2.targetInput) === portId);
          input.showControl = !stillConnected;
          await areaPlugin.update('node', targetId);
        }
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
    } finally {
      isSyncingGraph = false;
      requestMinimapUpdate();
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

    const hasNodes = nodes.length > 0;
    let minX = hasNodes ? nodes[0]?.x ?? 0 : viewport.x;
    let minY = hasNodes ? nodes[0]?.y ?? 0 : viewport.y;
    let maxX = hasNodes ? (nodes[0]?.x ?? 0) + (nodes[0]?.width ?? 0) : viewport.x + viewport.width;
    let maxY = hasNodes ? (nodes[0]?.y ?? 0) + (nodes[0]?.height ?? 0) : viewport.y + viewport.height;

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

    const size = minimapSize;
    const margin = 10;
    const extent = Math.max(width, height, 1);
    const scale = (size - margin * 2) / extent;
    const offsetX = (size - width * scale) / 2;
    const offsetY = (size - height * scale) / 2;

    minimap = {
      size,
      nodes,
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

    const area = areaPlugin.area;
    const k = Number(area.transform?.k ?? 1) || 1;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    void area.translate(cx - graphX * k, cy - graphY * k);
    requestMinimapUpdate();
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
          setSelectedNode(String(ctx.data?.id ?? ''));
        }
        if (ctx?.type === 'nodetranslate') {
          isNodeDragging = true;
        }
        if (ctx?.type === 'nodedragged') {
          isNodeDragging = false;
        }
        if (ctx?.type === 'translated' || ctx?.type === 'zoomed' || ctx?.type === 'nodetranslated') {
          requestMinimapUpdate();
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
    } else {
      nodeEngine.start();
    }
  }

  function handleClear() {
    if (confirm('Clear all nodes?')) {
      nodeEngine.clear();
    }
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
          const snapped = findPortRowSocketAt(lastPointerClient.x, lastPointerClient.y, desiredSide);
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
        customize: {
          node: () => ReteNode,
          control: () => ReteControl,
        },
      })
    );

    await scheduleGraphSync(get(graphStateStore));
    graphUnsub = graphStateStore?.subscribe((state) => {
      void scheduleGraphSync(state);
    });

    bindEditorPipes();

    // Fit view on first render
    if (areaPlugin) {
      await AreaExtensions.zoomAt(areaPlugin, Array.from(nodeMap.values()));
      requestMinimapUpdate();
    }

    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const within =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!within) return;
      if (target?.closest?.('.node-picker')) return;
      if (target?.closest?.('.minimap')) return;
      const tag = target?.tagName?.toLowerCase?.() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const area = areaPlugin?.area;
      if (!area) return;

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

      // Always zoom the canvas on wheel/trackpad gestures (incl. pinch-as-wheel on macOS).
      event.preventDefault();
      event.stopPropagation();

      const ox = (rect.left - event.clientX) * ratio;
      const oy = (rect.top - event.clientY) * ratio;
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

    const onPointerMove = (event: PointerEvent) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
    };
    container.addEventListener('pointermove', onPointerMove, { capture: true });
    pointerMoveHandler = onPointerMove;

    resizeObserver = new ResizeObserver(() => {
      const area = areaPlugin?.area;
      if (!area) return;
      isNodeDragging = false;
      // Re-apply current transform after layout changes (keeps drag math consistent after resizes).
      void area.zoom(Number(area.transform?.k ?? 1) || 1, 0, 0);
      requestMinimapUpdate();
    });
    resizeObserver.observe(container);

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === 'Escape' && isPickerOpen) {
        event.preventDefault();
        closePicker();
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
    if (wheelHandler) window.removeEventListener('wheel', wheelHandler, { capture: true } as any);
    if (contextMenuHandler)
      container?.removeEventListener('contextmenu', contextMenuHandler, { capture: true } as any);
    if (pointerMoveHandler)
      container?.removeEventListener('pointermove', pointerMoveHandler, { capture: true } as any);
    if (keydownHandler) window.removeEventListener('keydown', keydownHandler);
    resizeObserver?.disconnect();
    if (minimapRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(minimapRaf);
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

  <div
    class="canvas-wrapper"
    bind:this={container}
    role="application"
    aria-label="Node graph editor"
  >
    {#if isPickerOpen}
      <div class="picker-overlay" on:pointerdown={closePicker}>
        <div
          class="node-picker"
          bind:this={pickerElement}
          style="left: {pickerAnchor.x}px; top: {pickerAnchor.y}px;"
          on:pointerdown|stopPropagation
          on:wheel|stopPropagation
        >
          <div class="picker-header">
            <div class="picker-title">
              {#if pickerMode === 'connect' && pickerInitialSocket}
                Connect: {getPortDefForSocket(pickerInitialSocket)?.type ?? 'any'}
              {:else}
                Add node
              {/if}
            </div>
            <input
              class="picker-search"
              placeholder="Search…"
              bind:value={pickerQuery}
              on:pointerdown|stopPropagation
            />
          </div>
          <div class="picker-body">
            <div class="picker-categories">
              {#each pickerCategories as cat (cat)}
                <button
                  type="button"
                  class="picker-category {cat === pickerSelectedCategory ? 'active' : ''}"
                  on:click={() => (pickerSelectedCategory = cat)}
                >
                  {cat}
                </button>
              {/each}
            </div>
            <div class="picker-items">
              {#if pickerItems.length === 0}
                <div class="picker-empty">No matches</div>
              {:else}
                {#each pickerItems as item (item.type)}
                  <button type="button" class="picker-item" on:click={() => handlePickerPick(item)}>
                    <div class="picker-item-title">{item.label}</div>
                    <div class="picker-item-subtitle">
                      {#if pickerMode === 'connect' && item.matchPort}
                        {item.matchPort.side}: {item.matchPort.label}
                      {:else}
                        {item.type}
                      {/if}
                    </div>
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}

    <div class="minimap" on:pointerdown={handleMinimapPointerDown}>
      <svg
        width={minimap.size}
        height={minimap.size}
        viewBox={`0 0 ${minimap.size} ${minimap.size}`}
        aria-label="Minimap"
      >
        <rect
          x="0"
          y="0"
          width={minimap.size}
          height={minimap.size}
          rx="12"
          fill="rgba(2, 6, 23, 0.62)"
          stroke="rgba(255, 255, 255, 0.12)"
        />

        {#each minimap.nodes as n (n.id)}
          <rect
            x={toMiniX(n.x)}
            y={toMiniY(n.y)}
            width={Math.max(2, n.width * minimap.scale)}
            height={Math.max(2, n.height * minimap.scale)}
            rx="3"
            fill={n.selected ? 'rgba(99, 102, 241, 0.65)' : 'rgba(148, 163, 184, 0.38)'}
            stroke={n.selected ? 'rgba(99, 102, 241, 0.95)' : 'rgba(255, 255, 255, 0.18)'}
          />
        {/each}

        <rect
          x={toMiniX(minimap.viewport.x)}
          y={toMiniY(minimap.viewport.y)}
          width={Math.max(4, minimap.viewport.width * minimap.scale)}
          height={Math.max(4, minimap.viewport.height * minimap.scale)}
          rx="4"
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.82)"
          stroke-width="2"
          stroke-dasharray="6 4"
        />
      </svg>
    </div>
  </div>
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

  .picker-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
  }

  .node-picker {
    position: absolute;
    width: 420px;
    max-height: min(520px, calc(100% - 20px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.96);
    border: 1px solid rgba(99, 102, 241, 0.35);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(16px);
  }

  .picker-header {
    padding: 12px 12px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .picker-title {
    font-size: 12px;
    letter-spacing: 0.2px;
    color: rgba(255, 255, 255, 0.78);
  }

  .picker-search {
    width: 100%;
    box-sizing: border-box;
    border-radius: 12px;
    padding: 8px 10px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    outline: none;
    font-size: 12px;
  }

  .picker-search:focus {
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  }

  .picker-body {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .picker-categories {
    width: 132px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    padding: 6px;
    overflow: auto;
  }

  .picker-category {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.74);
    font-size: 12px;
    cursor: pointer;
  }

  .picker-category:hover {
    background: rgba(99, 102, 241, 0.12);
  }

  .picker-category.active {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.35);
    color: rgba(255, 255, 255, 0.92);
  }

  .picker-items {
    flex: 1;
    min-width: 0;
    padding: 8px;
    overflow: auto;
  }

  .picker-item {
    width: 100%;
    text-align: left;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 10px 12px;
    background: rgba(2, 6, 23, 0.22);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .picker-item:hover {
    border-color: rgba(99, 102, 241, 0.45);
    background: rgba(2, 6, 23, 0.3);
  }

  .picker-item-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .picker-item-subtitle {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.66);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-empty {
    padding: 10px 12px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
  }

  .minimap {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 20;
    width: 190px;
    height: 190px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 16px 50px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    cursor: pointer;
    user-select: none;
  }

  .minimap svg {
    display: block;
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
