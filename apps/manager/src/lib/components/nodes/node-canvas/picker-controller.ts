/**
 * Purpose: Node picker controller (add/connect) for NodeCanvas.
 */
import { derived, get, writable } from 'svelte/store';
import { tick } from 'svelte';
import type { NodeRegistry } from '@shugu/node-core';
import type { Connection as EngineConnection, NodePort, PortType } from '$lib/nodes/types';

export type PickerMode = 'add' | 'connect';
export type SocketData = { nodeId: string; side: 'input' | 'output'; key: string };

export type PickerItem = {
  type: string;
  label: string;
  category: string;
  matchPort?: { id: string; label: string; side: 'input' | 'output'; type: PortType };
};

type PickerControllerOptions = {
  nodeRegistry: NodeRegistry;
  getContainer: () => HTMLDivElement | null;
  computeGraphPosition: (clientX: number, clientY: number) => { x: number; y: number };
  getLastPointerClient: () => { x: number; y: number };
  getPortDefForSocket: (socket: SocketData) => NodePort | null;
  bestMatchingPort: (ports: NodePort[], requiredType: PortType, side: 'input' | 'output') => NodePort | null;
  addNode: (type: string, position?: { x: number; y: number }) => string | undefined;
  addConnection: (conn: EngineConnection) => void;
};

export function createPickerController(opts: PickerControllerOptions) {
  const isOpen = writable(false);
  const mode = writable<PickerMode>('add');
  const anchor = writable({ x: 0, y: 0 });
  const graphPos = writable({ x: 0, y: 0 });
  const selectedCategory = writable('Objects');
  const query = writable('');
  const initialSocket = writable<SocketData | null>(null);

  let pickerElement: HTMLDivElement | null = null;
  let lastConnectPickerOpenedAt = 0;

  const itemsByCategory = derived([mode, query, initialSocket], ([$mode, $query, $initialSocket]) => {
    const map = new Map<string, PickerItem[]>();
    const q = $query.trim().toLowerCase();

    const addItem = (item: PickerItem) => {
      if (q) {
        const hay = `${item.label} ${item.type} ${item.category}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    };

    if ($mode === 'connect' && $initialSocket) {
      const initial = $initialSocket;
      const initialPort = opts.getPortDefForSocket(initial);
      const requiredType = (initialPort?.type ?? 'any') as PortType;
      const neededSide: 'input' | 'output' = initial.side === 'output' ? 'input' : 'output';

      for (const def of opts.nodeRegistry.list()) {
        const ports = (neededSide === 'input' ? def.inputs : def.outputs) ?? [];
        const match = opts.bestMatchingPort(ports, requiredType, neededSide);
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
      for (const def of opts.nodeRegistry.list()) {
        addItem({ type: def.type, label: def.label, category: def.category });
      }
    }

    for (const [cat, list] of map) {
      list.sort((a, b) => a.label.localeCompare(b.label));
      map.set(cat, list);
    }

    return map;
  });

  const categories = derived(itemsByCategory, ($itemsByCategory) => {
    const cats = Array.from($itemsByCategory.keys());
    const rest = cats.filter((c) => c !== 'Objects').sort((a, b) => a.localeCompare(b));
    return cats.includes('Objects') ? ['Objects', ...rest] : rest;
  });

  const items = derived([itemsByCategory, selectedCategory], ([$itemsByCategory, $selectedCategory]) => {
    return $itemsByCategory.get($selectedCategory) ?? [];
  });

  categories.subscribe((cats) => {
    if (!get(isOpen)) return;
    if (cats.length > 0 && !cats.includes(get(selectedCategory))) {
      selectedCategory.set(cats[0] ?? '');
    }
  });

  const clampPickerToBounds = async () => {
    await tick();
    const container = opts.getContainer();
    if (!container || !pickerElement) return;
    const bounds = container.getBoundingClientRect();
    const w = pickerElement.offsetWidth;
    const h = pickerElement.offsetHeight;
    const pad = 10;

    let x = get(anchor).x;
    let y = get(anchor).y;

    if (x + w + pad > bounds.width) x = bounds.width - w - pad;
    if (y + h + pad > bounds.height) y = bounds.height - h - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    anchor.set({ x, y });
  };

  const openPicker = (optsOpen: {
    clientX: number;
    clientY: number;
    mode: PickerMode;
    initialSocket?: SocketData | null;
  }) => {
    const container = opts.getContainer();
    if (!container) return;
    const rect = container.getBoundingClientRect();
    anchor.set({ x: optsOpen.clientX - rect.left, y: optsOpen.clientY - rect.top });
    graphPos.set(opts.computeGraphPosition(optsOpen.clientX, optsOpen.clientY));
    mode.set(optsOpen.mode);
    initialSocket.set(optsOpen.initialSocket ?? null);
    query.set('');
    selectedCategory.set('Objects');
    isOpen.set(true);
    void clampPickerToBounds();
  };

  const openConnectPicker = (initial: SocketData) => {
    const now = Date.now();
    if (now - lastConnectPickerOpenedAt < 80) return;
    lastConnectPickerOpenedAt = now;
    const { x, y } = opts.getLastPointerClient();
    openPicker({ clientX: x, clientY: y, mode: 'connect', initialSocket: initial });
  };

  const closePicker = () => {
    isOpen.set(false);
    initialSocket.set(null);
  };

  const handlePick = (item: PickerItem) => {
    const nodeId = opts.addNode(item.type, get(graphPos));
    if (!nodeId) return;

    const initial = get(initialSocket);
    if (get(mode) === 'connect' && initial && item.matchPort) {
      const connId = `conn-${crypto.randomUUID?.() ?? Date.now()}`;
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
      opts.addConnection(engineConn);
    }

    closePicker();
  };

  const setPickerElement = (el: HTMLDivElement | null) => {
    pickerElement = el;
  };

  return {
    isOpen,
    mode,
    anchor,
    graphPos,
    selectedCategory,
    query,
    initialSocket,
    items,
    categories,
    setPickerElement,
    openPicker,
    openConnectPicker,
    closePicker,
    handlePick,
  };
}
