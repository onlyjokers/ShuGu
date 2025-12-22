/**
 * XYFlowAdapter - GraphViewAdapter implementation for @xyflow/svelte.
 *
 * Provides renderer-agnostic interface for controllers when using Svelte Flow.
 */
import type { Node, Edge, Viewport } from '@xyflow/svelte';
import type {
  GraphViewAdapter,
  ViewportTransform,
  NodeBounds,
  NodeVisualState,
  ConnectionVisualState,
} from './graph-view-adapter';

export interface XYFlowAdapterOptions {
  getContainer: () => HTMLDivElement | null;
  getNodes: () => Node[];
  getEdges: () => Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => void;
  requestUpdate: () => void;
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
}

export function createXYFlowAdapter(opts: XYFlowAdapterOptions): GraphViewAdapter {
  const { getContainer, getNodes, getEdges, setNodes, setEdges, getViewport, setViewport, requestUpdate } = opts;

  const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const next = value.map((v) => String(v)).filter(Boolean);
    next.sort();
    return next;
  };

  const pendingNodePatches = new Map<string, Partial<NodeVisualState>>();
  const pendingConnPatches = new Map<string, Partial<ConnectionVisualState>>();
  let flushRaf: number | null = null;

  const scheduleFlush = () => {
    if (flushRaf !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      flush();
      return;
    }
    flushRaf = requestAnimationFrame(() => {
      flushRaf = null;
      flush();
    });
  };

  const flush = () => {
    if (pendingNodePatches.size > 0) {
      const patches = new Map(pendingNodePatches);
      pendingNodePatches.clear();

      const currentNodes = getNodes();
      const updated = currentNodes.map((n) => {
        const patch = patches.get(String(n.id));
        if (!patch) return n;

        const nextData = { ...(n.data ?? {}) } as Record<string, unknown>;
        let nextSelected = n.selected;

        if ('selected' in patch) nextSelected = Boolean(patch.selected);
        if ('groupDisabled' in patch) nextData.groupDisabled = Boolean(patch.groupDisabled);
        if ('groupSelected' in patch) nextData.groupSelected = Boolean(patch.groupSelected);
        if ('localLoop' in patch) nextData.localLoop = Boolean(patch.localLoop);
        if ('deployedLoop' in patch) nextData.deployedLoop = Boolean(patch.deployedLoop);
        if ('active' in patch) nextData.active = Boolean(patch.active);
        if ('activeInputs' in patch) nextData.activeInputs = normalizeStringArray(patch.activeInputs);
        if ('activeOutputs' in patch) nextData.activeOutputs = normalizeStringArray(patch.activeOutputs);

        return {
          ...n,
          selected: nextSelected,
          data: nextData,
        };
      });

      setNodes(updated);
    }

    if (pendingConnPatches.size > 0) {
      const patches = new Map(pendingConnPatches);
      pendingConnPatches.clear();

      const currentEdges = getEdges();
      const updated = currentEdges.map((e) => {
        const patch = patches.get(String(e.id));
        if (!patch) return e;

        const nextData = { ...(e.data ?? {}) } as Record<string, unknown>;
        if ('localLoop' in patch) nextData.localLoop = Boolean(patch.localLoop);
        if ('deployedLoop' in patch) nextData.deployedLoop = Boolean(patch.deployedLoop);
        if ('active' in patch) nextData.active = Boolean(patch.active);

        return {
          ...e,
          data: nextData,
        };
      });

      setEdges(updated);
    }

    requestUpdate();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Viewport
  // ─────────────────────────────────────────────────────────────────────────────

  const getViewportTransform = (): ViewportTransform => {
    const vp = getViewport();
    return {
      k: vp.zoom ?? 1,
      tx: vp.x ?? 0,
      ty: vp.y ?? 0,
    };
  };

  const setViewportTransform = (transform: ViewportTransform): void => {
    setViewport({
      x: transform.tx,
      y: transform.ty,
      zoom: transform.k,
    });
    requestUpdate();
  };

  const zoomToNodes = async (nodeIds: string[]): Promise<void> => {
    const container = getContainer();
    if (!container) return;

    const ids = nodeIds.length > 0 ? nodeIds : getNodes().map((n) => String(n.id));
    const bounds = (() => {
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;

      for (const id of ids) {
        const b = getNodeBounds(String(id));
        if (!b) continue;
        left = Math.min(left, b.left);
        top = Math.min(top, b.top);
        right = Math.max(right, b.right);
        bottom = Math.max(bottom, b.bottom);
      }

      if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
        return null;
      }
      return { left, top, right, bottom };
    })();

    if (!bounds) return;

    const padding = 80;
    const boundsW = Math.max(1, bounds.right - bounds.left);
    const boundsH = Math.max(1, bounds.bottom - bounds.top);

    const vw = Math.max(1, container.clientWidth);
    const vh = Math.max(1, container.clientHeight);

    const scale = Math.min((vw - padding * 2) / boundsW, (vh - padding * 2) / boundsH);
    const minZoom = 0.2;
    const maxZoom = 2.5;
    const zoom = Math.max(minZoom, Math.min(maxZoom, scale));

    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    const tx = vw / 2 - cx * zoom;
    const ty = vh / 2 - cy * zoom;

    setViewport({ x: tx, y: ty, zoom });
    requestUpdate();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Node Position & Bounds
  // ─────────────────────────────────────────────────────────────────────────────

  const getNodePosition = (nodeId: string): { x: number; y: number } | null => {
    const nodes = getNodes();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    return { x: node.position.x, y: node.position.y };
  };

  const setNodePosition = (nodeId: string, x: number, y: number): void => {
    const nodes = getNodes();
    const updated = nodes.map((n) => (n.id === nodeId ? { ...n, position: { x, y } } : n));
    setNodes(updated);
    opts.onNodePositionChange?.(String(nodeId), { x, y });
    requestUpdate();
  };

  const getNodeBounds = (nodeId: string): NodeBounds | null => {
    const nodes = getNodes();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    // XYFlow stores measured dimensions if available
    const width = (node as any).measured?.width ?? (node as any).width ?? 230;
    const height = (node as any).measured?.height ?? (node as any).height ?? 100;

    return {
      left: node.position.x,
      top: node.position.y,
      right: node.position.x + width,
      bottom: node.position.y + height,
    };
  };

  const translateNodes = (nodeIds: string[], dx: number, dy: number): void => {
    const nodes = getNodes();
    const idsSet = new Set(nodeIds);
    const updated = nodes.map((n) =>
      idsSet.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n
    );
    setNodes(updated);
    for (const n of updated) {
      if (!idsSet.has(n.id)) continue;
      opts.onNodePositionChange?.(String(n.id), { x: n.position.x, y: n.position.y });
    }
    requestUpdate();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Visual State
  // ─────────────────────────────────────────────────────────────────────────────

  const getNodeVisualState = (nodeId: string): NodeVisualState | null => {
    const node = getNodes().find((n) => String(n.id) === String(nodeId));
    if (!node) return null;
    const data = (node.data ?? {}) as any;
    return {
      selected: Boolean(node.selected),
      groupDisabled: Boolean(data.groupDisabled),
      groupSelected: Boolean(data.groupSelected),
      localLoop: Boolean(data.localLoop),
      deployedLoop: Boolean(data.deployedLoop),
      active: Boolean(data.active),
      activeInputs: normalizeStringArray(data.activeInputs),
      activeOutputs: normalizeStringArray(data.activeOutputs),
    };
  };

  const setNodeVisualState = async (nodeId: string, patch: Partial<NodeVisualState>): Promise<void> => {
    const existing = pendingNodePatches.get(String(nodeId)) ?? {};
    const merged: Partial<NodeVisualState> = { ...existing, ...patch };
    pendingNodePatches.set(String(nodeId), merged);
    scheduleFlush();
  };

  const getConnectionVisualState = (connId: string): ConnectionVisualState | null => {
    const edge = getEdges().find((e) => String(e.id) === String(connId));
    if (!edge) return null;
    const data = (edge.data ?? {}) as any;
    return {
      localLoop: Boolean(data.localLoop),
      deployedLoop: Boolean(data.deployedLoop),
      active: Boolean(data.active),
    };
  };

  const setConnectionVisualState = async (connId: string, patch: Partial<ConnectionVisualState>): Promise<void> => {
    const existing = pendingConnPatches.get(String(connId)) ?? {};
    const merged: Partial<ConnectionVisualState> = { ...existing, ...patch };
    pendingConnPatches.set(String(connId), merged);
    scheduleFlush();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Hit Testing
  // ─────────────────────────────────────────────────────────────────────────────

  const getNodesInRect = (rect: NodeBounds): string[] => {
    const nodes = getNodes();
    const result: string[] = [];

    for (const node of nodes) {
      const bounds = getNodeBounds(node.id);
      if (!bounds) continue;

      const intersects =
        bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top;

      if (intersects) {
        result.push(node.id);
      }
    }
    return result;
  };

  const clientToGraph = (clientX: number, clientY: number): { x: number; y: number } => {
    const container = getContainer();
    const t = getViewportTransform();
    if (!container) return { x: 0, y: 0 };

    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left - t.tx) / t.k;
    const y = (clientY - rect.top - t.ty) / t.k;
    return { x, y };
  };

  const graphToClient = (graphX: number, graphY: number): { x: number; y: number } => {
    const container = getContainer();
    const t = getViewportTransform();
    if (!container) return { x: 0, y: 0 };

    const rect = container.getBoundingClientRect();
    const x = graphX * t.k + t.tx + rect.left;
    const y = graphY * t.k + t.ty + rect.top;
    return { x, y };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Return adapter
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    getViewportTransform,
    setViewportTransform,
    zoomToNodes,
    getNodePosition,
    setNodePosition,
    getNodeBounds,
    translateNodes,
    getNodeVisualState,
    setNodeVisualState,
    getConnectionVisualState,
    setConnectionVisualState,
    getNodesInRect,
    clientToGraph,
    graphToClient,
    requestUpdate,
    getContainer,
  };
}
