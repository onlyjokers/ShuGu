/**
 * GraphViewAdapter - Renderer-agnostic interface for Node Graph view operations.
 *
 * This abstraction allows controllers (group, loop, minimap, midi-highlight) to
 * operate independently of the underlying renderer (Rete or XYFlow).
 */

export interface ViewportTransform {
  /** Zoom scale (1 = 100%) */
  k: number;
  /** Translate X in pixels */
  tx: number;
  /** Translate Y in pixels */
  ty: number;
}

export interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type NodeVisualState = {
  selected?: boolean;
  groupDisabled?: boolean;
  groupSelected?: boolean;
  localLoop?: boolean;
  deployedLoop?: boolean;
  active?: boolean;
  activeInputs?: string[];
  activeOutputs?: string[];
};

export type ConnectionVisualState = {
  localLoop?: boolean;
  deployedLoop?: boolean;
  active?: boolean;
};

export interface GraphViewAdapter {
  // ─────────────────────────────────────────────────────────────────────────────
  // Viewport
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get current viewport transform (zoom + pan). */
  getViewportTransform(): ViewportTransform;

  /** Set viewport transform. */
  setViewportTransform(transform: ViewportTransform): void;

  /** Zoom to fit specified nodes in view. */
  zoomToNodes(nodeIds: string[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Node Position & Bounds
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get node position in graph coordinates. Returns null if node not found. */
  getNodePosition(nodeId: string): { x: number; y: number } | null;

  /** Set node position in graph coordinates. */
  setNodePosition(nodeId: string, x: number, y: number): void;

  /** Get node bounding box in graph coordinates. Returns null if node not found. */
  getNodeBounds(nodeId: string): NodeBounds | null;

  /** Translate multiple nodes by delta. */
  translateNodes(nodeIds: string[], dx: number, dy: number): void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Visual State
  // ─────────────────────────────────────────────────────────────────────────────

  /** Read the current node visual state (renderer-specific backing store). */
  getNodeVisualState(nodeId: string): NodeVisualState | null;

  /** Patch node visual state (loop/group/midi highlights, port activity, selection). */
  setNodeVisualState(nodeId: string, patch: Partial<NodeVisualState>): Promise<void>;

  /** Read the current connection visual state (renderer-specific backing store). */
  getConnectionVisualState(connId: string): ConnectionVisualState | null;

  /** Patch connection visual state (loop/midi highlights). */
  setConnectionVisualState(connId: string, patch: Partial<ConnectionVisualState>): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Hit Testing
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get node IDs that intersect with the given rect (graph coordinates). */
  getNodesInRect(rect: NodeBounds): string[];

  /** Convert client (screen) coordinates to graph coordinates. */
  clientToGraph(clientX: number, clientY: number): { x: number; y: number };

  /** Convert graph coordinates to client (screen) coordinates. */
  graphToClient(graphX: number, graphY: number): { x: number; y: number };

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Requests
  // ─────────────────────────────────────────────────────────────────────────────

  /** Request a render frame update (debounced). */
  requestUpdate(): void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Container
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get the container DOM element. */
  getContainer(): HTMLDivElement | null;
}
