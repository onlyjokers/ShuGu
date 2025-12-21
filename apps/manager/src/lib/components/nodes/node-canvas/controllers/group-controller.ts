/**
 * Purpose: Node group + marquee selection controller for NodeCanvas.
 */
import { get, writable, type Writable } from 'svelte/store';
import type { LocalLoop } from '$lib/nodes';
import type { GraphState, NodeInstance } from '$lib/nodes/types';
import { nodeRegistry } from '$lib/nodes';
import { readAreaTransform, readNodeBounds, type AreaTransform, type NodeBounds, unionBounds } from '../utils/view-utils';

export type NodeGroup = {
  id: string;
  parentId: string | null;
  name: string;
  nodeIds: string[];
  disabled: boolean;
};
export type GroupFrame = {
  group: NodeGroup;
  left: number;
  top: number;
  width: number;
  height: number;
  effectiveDisabled: boolean;
  depth: number;
};
export type GroupEditToast = { groupId: string; message: string } | null;

export type FrameInfo = {
  id: string;
  kind: 'group' | 'loop';
  nodeIds: Set<string>;
  bounds: NodeBounds;
};

export type FrameMoveContext = {
  movingFrameIds: Set<string>;
  frameById: Map<string, FrameInfo>;
  nodeToMovingFrameId: Map<string, string>;
  movedFrameIds: Set<string>;
};

export type GroupController = {
  nodeGroups: Writable<NodeGroup[]>;
  groupFrames: Writable<GroupFrame[]>;
  groupSelectionNodeIds: Writable<Set<string>>;
  groupSelectionBounds: Writable<{ left: number; top: number; width: number; height: number } | null>;
  editModeGroupId: Writable<string | null>;
  canvasToast: Writable<string | null>;
  groupEditToast: Writable<GroupEditToast>;
  groupDisabledNodeIds: Writable<Set<string>>;
  marqueeRect: Writable<{ left: number; top: number; width: number; height: number } | null>;
  requestFramesUpdate: () => void;
  applyHighlights: () => Promise<void>;
  scheduleHighlight: () => void;
  clearSelection: () => void;
  createGroupFromSelection: () => void;
  toggleGroupDisabled: (groupId: string) => void;
  disassembleGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  toggleGroupEditMode: (groupId: string) => void;
  autoAddNodeToGroupFromPosition: (nodeId: string, graphPos: { x: number; y: number }) => void;
  autoAddNodeToGroupFromConnectDrop: (
    initialNodeId: string,
    newNodeId: string,
    dropGraphPos: { x: number; y: number }
  ) => void;
  handleDroppedNodesAfterDrag: (nodeIds: string[]) => void;
  onPointerDown: (event: PointerEvent) => void;
  destroy: () => void;
  isProgrammaticTranslate: () => boolean;
  beginProgrammaticTranslate: () => void;
  endProgrammaticTranslate: () => void;
  computeLoopFrameBounds: (loop: LocalLoop) => NodeBounds | null;
  pushNodesOutOfBounds: (bounds: NodeBounds, excludeNodeIds: Set<string>, frameMoves?: FrameMoveContext) => void;
};

type GroupControllerOptions = {
  getContainer: () => HTMLDivElement | null;
  getAreaPlugin: () => any;
  getNodeMap: () => Map<string, any>;
  getGraphState: () => GraphState;
  getLocalLoops: () => LocalLoop[];
  getLoopConstraintLoops: () => LocalLoop[];
  getDeployedLoopIds: () => Set<string>;
  setNodesDisabled: (ids: string[], disabled: boolean) => void;
  requestLoopFramesUpdate: () => void;
  requestMinimapUpdate: () => void;
  isSyncingGraph: () => boolean;
  stopLoop: (loop: LocalLoop) => void;
};

export function createGroupController(opts: GroupControllerOptions): GroupController {
  const nodeGroups = writable<NodeGroup[]>([]);
  const groupFrames = writable<GroupFrame[]>([]);
  const groupSelectionNodeIds = writable<Set<string>>(new Set());
  const groupSelectionBounds = writable<{ left: number; top: number; width: number; height: number } | null>(
    null
  );
  const editModeGroupId = writable<string | null>(null);
  const canvasToast = writable<string | null>(null);
  const groupEditToast = writable<GroupEditToast>(null);
  const groupDisabledNodeIds = writable<Set<string>>(new Set());
  const marqueeRect = writable<{ left: number; top: number; width: number; height: number } | null>(null);

  let groupHighlightDirty = false;
  let groupEditToastTimeout: ReturnType<typeof setTimeout> | null = null;
  let canvasToastTimeout: ReturnType<typeof setTimeout> | null = null;

  let editModeGroupBounds: { left: number; top: number; right: number; bottom: number } | null = null;

  let isMarqueeDragging = false;
  let marqueeStart = { x: 0, y: 0 };
  let marqueeCurrent = { x: 0, y: 0 };
  let marqueePointerId: number | null = null;
  let marqueeMoveHandler: ((event: PointerEvent) => void) | null = null;
  let marqueeUpHandler: ((event: PointerEvent) => void) | null = null;

  let programmaticTranslateDepth = 0;
  const isProgrammaticTranslate = () => programmaticTranslateDepth > 0;
  const beginProgrammaticTranslate = () => {
    programmaticTranslateDepth += 1;
  };
  const endProgrammaticTranslate = () => {
    programmaticTranslateDepth = Math.max(0, programmaticTranslateDepth - 1);
  };

  let framesRaf = 0;

  const nodeLabel = (node: NodeInstance): string => {
    if (node.type === 'client-object') {
      const id = String(node.config?.clientId ?? '');
      return id ? `Client: ${id}` : 'Client';
    }
    return nodeRegistry.get(node.type)?.label ?? node.type;
  };

  const clearGroupEditToast = () => {
    groupEditToast.set(null);
    if (groupEditToastTimeout) {
      clearTimeout(groupEditToastTimeout);
      groupEditToastTimeout = null;
    }
  };

  const clearCanvasToast = () => {
    canvasToast.set(null);
    if (canvasToastTimeout) {
      clearTimeout(canvasToastTimeout);
      canvasToastTimeout = null;
    }
  };

  const showCanvasToast = (message: string, durationMs = 1400) => {
    const msg = String(message ?? '').trim();
    if (!msg) return;
    canvasToast.set(msg);
    if (canvasToastTimeout) clearTimeout(canvasToastTimeout);
    canvasToastTimeout = setTimeout(() => {
      canvasToast.set(null);
      canvasToastTimeout = null;
    }, durationMs);
  };

  const showGroupEditToast = (groupId: string, message: string) => {
    if (!groupId) return;
    groupEditToast.set({ groupId, message });
    if (groupEditToastTimeout) clearTimeout(groupEditToastTimeout);
    groupEditToastTimeout = setTimeout(() => {
      groupEditToast.set(null);
      groupEditToastTimeout = null;
    }, 1400);
  };

  const recomputeDisabledNodes = (nextGroups: NodeGroup[] = get(nodeGroups)) => {
    const prev = get(groupDisabledNodeIds);
    const next = new Set<string>();

    for (const g of nextGroups) {
      if (!g.disabled) continue;
      for (const nodeId of g.nodeIds ?? []) next.add(String(nodeId));
    }

    groupDisabledNodeIds.set(next);

    const toDisable = Array.from(next).filter((id) => !prev.has(id));
    const toEnable = Array.from(prev).filter((id) => !next.has(id));
    if (toDisable.length > 0) opts.setNodesDisabled(toDisable, true);
    if (toEnable.length > 0) opts.setNodesDisabled(toEnable, false);
    scheduleHighlight();
  };

  const scheduleHighlight = () => {
    groupHighlightDirty = true;
    if (!opts.isSyncingGraph()) void applyHighlights();
  };

  const applyHighlights = async () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin) return;
    if (!groupHighlightDirty) return;
    groupHighlightDirty = false;

    const disabled = get(groupDisabledNodeIds);
    const selected = get(groupSelectionNodeIds);
    const nodeMap = opts.getNodeMap();

    for (const [id, node] of nodeMap.entries()) {
      const nextDisabled = disabled.has(id);
      const nextSelected = selected.has(id);

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
  };

  const mergeBounds = (base: NodeBounds | null, next: NodeBounds | null): NodeBounds | null => {
    if (!next) return base;
    if (!base) return { ...next };
    return {
      left: Math.min(base.left, next.left),
      top: Math.min(base.top, next.top),
      right: Math.max(base.right, next.right),
      bottom: Math.max(base.bottom, next.bottom),
    };
  };

  const boundsIntersect = (a: NodeBounds, b: NodeBounds): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const pickMoveDelta = (bounds: NodeBounds, target: NodeBounds, margin: number) => {
    const moveLeft = bounds.left - margin - target.right;
    const moveRight = bounds.right + margin - target.left;
    const moveUp = bounds.top - margin - target.bottom;
    const moveDown = bounds.bottom + margin - target.top;

    const candidates = [
      { dx: moveLeft, dy: 0 },
      { dx: moveRight, dy: 0 },
      { dx: 0, dy: moveUp },
      { dx: 0, dy: moveDown },
    ];
    candidates.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
    return candidates[0] ?? null;
  };

  const buildGroupIndex = (groups: NodeGroup[]) => {
    const byId = new Map<string, NodeGroup>();
    const childrenByParentId = new Map<string, string[]>();

    for (const group of groups) {
      const id = String(group.id);
      const parentId = group.parentId ? String(group.parentId) : null;
      const normalized: NodeGroup = {
        ...group,
        id,
        parentId,
        nodeIds: (group.nodeIds ?? []).map((nodeId) => String(nodeId)),
      };
      byId.set(id, normalized);
      if (!parentId) continue;
      const list = childrenByParentId.get(parentId) ?? [];
      list.push(id);
      childrenByParentId.set(parentId, list);
    }

    return { byId, childrenByParentId };
  };

  // Include child frames so parent bounds reflect nested groups.
  const computeGroupFrameBoundsWithChildren = (
    groupId: string,
    t: AreaTransform,
    byId: Map<string, NodeGroup>,
    childrenByParentId: Map<string, string[]>,
    cache: Map<string, NodeBounds | null>,
    visiting: Set<string>
  ): NodeBounds | null => {
    const cached = cache.get(groupId);
    if (cached !== undefined) return cached;
    if (visiting.has(groupId)) return null;

    const group = byId.get(groupId);
    if (!group) return null;

    visiting.add(groupId);

    const paddingX = 52;
    const paddingTop = 64;
    const paddingBottom = 52;

    const loopPaddingX = 56;
    const loopPaddingTop = 64;
    const loopPaddingBottom = 64;

    let bounds: NodeBounds | null = null;

    const areaPlugin = opts.getAreaPlugin();
    bounds = mergeBounds(bounds, unionBounds(areaPlugin, group.nodeIds ?? [], t));

    const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
    for (const loop of opts.getLocalLoops()) {
      if (!loop?.nodeIds?.length) continue;
      const fullyContained = loop.nodeIds.every((id) => groupNodeSet.has(String(id)));
      if (!fullyContained) continue;
      const lb = unionBounds(areaPlugin, loop.nodeIds, t);
      if (!lb) continue;
      bounds = mergeBounds(bounds, {
        left: lb.left - loopPaddingX,
        top: lb.top - loopPaddingTop,
        right: lb.right + loopPaddingX,
        bottom: lb.bottom + loopPaddingBottom,
      });
    }

    const children = childrenByParentId.get(groupId) ?? [];
    for (const childId of children) {
      const childBounds = computeGroupFrameBoundsWithChildren(
        childId,
        t,
        byId,
        childrenByParentId,
        cache,
        visiting
      );
      bounds = mergeBounds(bounds, childBounds);
    }

    visiting.delete(groupId);

    if (!bounds) {
      cache.set(groupId, null);
      return null;
    }

    const padded = {
      left: bounds.left - paddingX,
      top: bounds.top - paddingTop,
      right: bounds.right + paddingX,
      bottom: bounds.bottom + paddingBottom,
    };
    cache.set(groupId, padded);
    return padded;
  };

  const computeGroupFrameBounds = (group: NodeGroup, t: AreaTransform): NodeBounds | null => {
    const groupsSnapshot = get(nodeGroups);
    const { byId, childrenByParentId } = buildGroupIndex(groupsSnapshot);
    const cache = new Map<string, NodeBounds | null>();
    return computeGroupFrameBoundsWithChildren(
      String(group.id),
      t,
      byId,
      childrenByParentId,
      cache,
      new Set()
    );
  };

  const computeLoopFrameBounds = (loop: LocalLoop): NodeBounds | null => {
    const paddingX = 56;
    const paddingTop = 64;
    const paddingBottom = 64;

    const t = readAreaTransform(opts.getAreaPlugin());
    if (!t) return null;
    const base = unionBounds(opts.getAreaPlugin(), loop.nodeIds ?? [], t);
    if (!base) return null;

    return {
      left: base.left - paddingX,
      top: base.top - paddingTop,
      right: base.right + paddingX,
      bottom: base.bottom + paddingBottom,
    };
  };

  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  const animateNodeTranslations = (
    updates: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[],
    durationMs = 320
  ) => {
    const areaPlugin = opts.getAreaPlugin();
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
      opts.requestLoopFramesUpdate();
      opts.requestMinimapUpdate();
    };

    requestAnimationFrame(step);
  };

  const pushNodesOutOfBounds = (bounds: NodeBounds, excludeNodeIds: Set<string>, frameMoves?: FrameMoveContext) => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin?.nodeViews) return;
    const t = readAreaTransform(areaPlugin);
    if (!t) return;

    const margin = 24;
    const updates: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
    const skipNodeIds = new Set(excludeNodeIds);

    // If a full frame was moved, push the whole frame as a unit.
    const moveFrame = (frameId: string): boolean => {
      if (!frameMoves) return false;
      if (!frameMoves.movingFrameIds.has(frameId)) return false;
      if (frameMoves.movedFrameIds.has(frameId)) return false;
      const frame = frameMoves.frameById.get(frameId);
      if (!frame) return false;
      if (!boundsIntersect(bounds, frame.bounds)) return false;

      const pick = pickMoveDelta(bounds, frame.bounds, margin);
      if (!pick) return false;

      const dx = pick.dx / t.k;
      const dy = pick.dy / t.k;

      for (const nodeId of frame.nodeIds) {
        const id = String(nodeId);
        if (skipNodeIds.has(id)) continue;
        const view = areaPlugin.nodeViews.get(id);
        const pos = view?.position as { x: number; y: number } | undefined;
        if (!pos) continue;
        updates.push({ id, from: { x: pos.x, y: pos.y }, to: { x: pos.x + dx, y: pos.y + dy } });
        skipNodeIds.add(id);
      }

      frameMoves.movedFrameIds.add(frameId);
      return true;
    };

    for (const nodeId of opts.getNodeMap().keys()) {
      const id = String(nodeId);
      if (skipNodeIds.has(id)) continue;
      const b = readNodeBounds(areaPlugin, id, t);
      if (!b) continue;

      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      const inside = cx > bounds.left && cx < bounds.right && cy > bounds.top && cy < bounds.bottom;
      if (!inside) continue;

      if (frameMoves) {
        const movingFrameId = frameMoves.nodeToMovingFrameId.get(id);
        if (movingFrameId && moveFrame(movingFrameId)) continue;
      }

      const pick = pickMoveDelta(bounds, b, margin);
      if (!pick) continue;

      const view = areaPlugin.nodeViews.get(id);
      const pos = view?.position as { x: number; y: number } | undefined;
      if (!pos) continue;

      const to = { x: pos.x + pick.dx / t.k, y: pos.y + pick.dy / t.k };
      updates.push({ id, from: { x: pos.x, y: pos.y }, to });
      skipNodeIds.add(id);
    }

    animateNodeTranslations(updates);
  };

  const handleDroppedNodesAfterDrag = (nodeIds: string[]) => {
    if (!nodeIds.length) return;
    if (isProgrammaticTranslate()) return;

    const t = readAreaTransform(opts.getAreaPlugin());
    if (!t) return;

    const nodeCenterCache = new Map<string, { cx: number; cy: number }>();
    const getNodeCenter = (nodeId: string) => {
      const id = String(nodeId);
      const cached = nodeCenterCache.get(id);
      if (cached) return cached;
      const b = readNodeBounds(opts.getAreaPlugin(), id, t);
      if (!b) return null;
      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      const v = { cx, cy };
      nodeCenterCache.set(id, v);
      return v;
    };

    const groupsSnapshot = get(nodeGroups);
    const loopsSnapshot = opts.getLoopConstraintLoops();

    const groupNodeSets = new Map<string, Set<string>>();
    for (const g of groupsSnapshot) {
      const gid = String(g.id);
      const set = new Set((g.nodeIds ?? []).map((id) => String(id)));
      groupNodeSets.set(gid, set);
    }

    const { byId, childrenByParentId } = buildGroupIndex(groupsSnapshot);

    const groupBoundsCache = new Map<string, NodeBounds | null>();
    const computeGroupBoundsCached = (groupId: string) =>
      computeGroupFrameBoundsWithChildren(
        groupId,
        t,
        byId,
        childrenByParentId,
        groupBoundsCache,
        new Set()
      );

    const frameById = new Map<string, FrameInfo>();
    const loopNodeSets = new Map<string, Set<string>>();

    for (const loop of loopsSnapshot) {
      const loopId = String(loop.id ?? '');
      if (!loopId) continue;
      const nodeIds = new Set((loop.nodeIds ?? []).map((id) => String(id)));
      loopNodeSets.set(loopId, nodeIds);
      const bounds = computeLoopFrameBounds(loop);
      if (!bounds) continue;
      frameById.set(`loop:${loopId}`, {
        id: `loop:${loopId}`,
        kind: 'loop',
        nodeIds,
        bounds,
      });
    }

    const editId = get(editModeGroupId);
    for (const group of groupsSnapshot) {
      const groupId = String(group.id ?? '');
      if (!groupId) continue;
      const nodeIds = groupNodeSets.get(groupId) ?? new Set();

      let bounds: NodeBounds | null = null;
      if (editId && editModeGroupBounds && editId === groupId) {
        bounds = {
          left: editModeGroupBounds.left * t.k + t.tx,
          top: editModeGroupBounds.top * t.k + t.ty,
          right: editModeGroupBounds.right * t.k + t.tx,
          bottom: editModeGroupBounds.bottom * t.k + t.ty,
        };
      } else {
        bounds = computeGroupBoundsCached(groupId);
      }
      if (!bounds) continue;
      frameById.set(`group:${groupId}`, {
        id: `group:${groupId}`,
        kind: 'group',
        nodeIds,
        bounds,
      });
    }

    const movedSet = new Set(nodeIds.map((id) => String(id)));
    const movingGroupIds = new Set<string>();

    for (const [groupId, nodeSet] of groupNodeSets.entries()) {
      if (nodeSet.size === 0) continue;
      let allMoved = true;
      for (const nid of nodeSet) {
        if (!movedSet.has(nid)) {
          allMoved = false;
          break;
        }
      }
      if (allMoved) movingGroupIds.add(groupId);
    }

    const prunedMovingGroupIds = new Set<string>(movingGroupIds);
    for (const groupId of movingGroupIds) {
      let cursor = byId.get(groupId)?.parentId ? String(byId.get(groupId)?.parentId) : null;
      while (cursor) {
        if (movingGroupIds.has(cursor)) {
          prunedMovingGroupIds.delete(groupId);
          break;
        }
        cursor = byId.get(cursor)?.parentId ? String(byId.get(cursor)?.parentId) : null;
      }
    }

    const movingGroupNodeIds = new Set<string>();
    for (const groupId of prunedMovingGroupIds) {
      const set = groupNodeSets.get(groupId);
      if (!set) continue;
      for (const nid of set) movingGroupNodeIds.add(nid);
    }

    const movingLoopIds = new Set<string>();
    for (const [loopId, nodeSet] of loopNodeSets.entries()) {
      if (nodeSet.size === 0) continue;
      let allMoved = true;
      for (const nid of nodeSet) {
        if (!movedSet.has(nid)) {
          allMoved = false;
          break;
        }
      }
      if (!allMoved) continue;

      let coveredByGroup = true;
      for (const nid of nodeSet) {
        if (!movingGroupNodeIds.has(nid)) {
          coveredByGroup = false;
          break;
        }
      }
      if (coveredByGroup) continue;

      movingLoopIds.add(loopId);
    }

    const movingFrameIds = new Set<string>();
    for (const groupId of prunedMovingGroupIds) {
      const frameId = `group:${groupId}`;
      if (frameById.has(frameId)) movingFrameIds.add(frameId);
    }
    for (const loopId of movingLoopIds) {
      const frameId = `loop:${loopId}`;
      if (frameById.has(frameId)) movingFrameIds.add(frameId);
    }

    const nodeToMovingFrameId = new Map<string, string>();
    for (const frameId of movingFrameIds) {
      const frame = frameById.get(frameId);
      if (!frame) continue;
      for (const nid of frame.nodeIds) {
        const id = String(nid);
        if (!nodeToMovingFrameId.has(id)) nodeToMovingFrameId.set(id, frameId);
      }
    }

    const frameMoves: FrameMoveContext | undefined =
      movingFrameIds.size > 0
        ? { movingFrameIds, frameById, nodeToMovingFrameId, movedFrameIds: new Set() }
        : undefined;

    for (const loop of loopsSnapshot) {
      const loopId = String(loop.id ?? '');
      if (!loopId) continue;
      const frame = frameById.get(`loop:${loopId}`);
      const bounds = frame?.bounds;
      if (!bounds) continue;
      const loopNodeSet = loopNodeSets.get(loopId) ?? new Set();

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

      pushNodesOutOfBounds(bounds, loopNodeSet, frameMoves);
    }

    if (editId && editModeGroupBounds) {
      const group = groupsSnapshot.find((g) => String(g.id) === String(editId)) ?? null;
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
          const inside = c.cx > bounds.left && c.cx < bounds.right && c.cy > bounds.top && c.cy < bounds.bottom;

          if (inside && !nextSet.has(id)) {
            nextSet.add(id);
            added.push(id);
            const node = opts.getGraphState().nodes.find((n) => String(n.id) === id);
            const nodeName = node ? nodeLabel(node) : id;
            showGroupEditToast(group.id, `Add ${nodeName} to ${group.name ?? 'Group'}`);
          }

          if (!inside && nextSet.has(id)) {
            nextSet.delete(id);
            removed.push(id);
            const node = opts.getGraphState().nodes.find((n) => String(n.id) === id);
            const nodeName = node ? nodeLabel(node) : id;
            showGroupEditToast(group.id, `Remove ${nodeName} from ${group.name ?? 'Group'}`);
          }
        }

        if (added.length > 0 || removed.length > 0) {
          const groupsSnapshot = get(nodeGroups);
          const byId = new Map<string, NodeGroup>();
          const childrenByParentId = new Map<string, string[]>();

          for (const g of groupsSnapshot) {
            byId.set(String(g.id), g);
            const pid = g.parentId ? String(g.parentId) : '';
            if (!pid) continue;
            const list = childrenByParentId.get(pid) ?? [];
            list.push(String(g.id));
            childrenByParentId.set(pid, list);
          }

          const targetAndAncestors = new Set<string>();
          let cursor: string | null = String(group.id);
          while (cursor) {
            if (targetAndAncestors.has(cursor)) break;
            targetAndAncestors.add(cursor);
            const parent = byId.get(cursor)?.parentId ? String(byId.get(cursor)?.parentId) : '';
            cursor = parent && byId.has(parent) ? parent : null;
          }

          const targetAndDescendants = new Set<string>();
          const stack = [String(group.id)];
          while (stack.length > 0) {
            const id = stack.pop();
            if (!id) continue;
            if (targetAndDescendants.has(id)) continue;
            targetAndDescendants.add(id);
            const children = childrenByParentId.get(id) ?? [];
            for (const childId of children) stack.push(childId);
          }

          const effectiveDisabled = Array.from(targetAndAncestors).some((id) => Boolean(byId.get(id)?.disabled));

          nodeGroups.update((groups) =>
            groups.map((g) => {
              const id = String(g.id);
              let changed = false;
              let nextNodeIds = Array.from((g.nodeIds ?? []).map((nid) => String(nid)));

              if (added.length > 0 && targetAndAncestors.has(id)) {
                const set = new Set(nextNodeIds);
                for (const nid of added) {
                  if (set.has(nid)) continue;
                  set.add(nid);
                  changed = true;
                }
                if (changed) nextNodeIds = Array.from(set);
              }

              if (removed.length > 0 && targetAndDescendants.has(id)) {
                const set = new Set(nextNodeIds);
                for (const nid of removed) {
                  if (!set.has(nid)) continue;
                  set.delete(nid);
                  changed = true;
                }
                if (changed) nextNodeIds = Array.from(set);
              }

              return changed ? { ...g, nodeIds: nextNodeIds } : g;
            })
          );
          recomputeDisabledNodes();
          opts.requestLoopFramesUpdate();

          if (effectiveDisabled && added.length > 0) {
            stopDeployedLoopsIntersecting(added.map(String));
          }
        }
      }
    }

    for (const group of groupsSnapshot) {
      if (editId && String(editId) === String(group.id)) continue;

      const frame = frameById.get(`group:${String(group.id)}`);
      const bounds = frame?.bounds ?? null;
      if (!bounds) continue;
      const groupNodeSet = groupNodeSets.get(String(group.id)) ?? new Set();

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

      pushNodesOutOfBounds(bounds, groupNodeSet, frameMoves);
    }
  };

  const pickGroupAtPoint = (groups: NodeGroup[], px: number, py: number, t: AreaTransform): NodeGroup | null => {
    let picked: NodeGroup | null = null;
    let pickedArea = Number.POSITIVE_INFINITY;

    for (const group of groups) {
      let bounds: NodeBounds | null = null;

      if (get(editModeGroupId) === group.id && editModeGroupBounds) {
        bounds = {
          left: editModeGroupBounds.left * t.k + t.tx,
          top: editModeGroupBounds.top * t.k + t.ty,
          right: editModeGroupBounds.right * t.k + t.tx,
          bottom: editModeGroupBounds.bottom * t.k + t.ty,
        };
      } else {
        bounds = computeGroupFrameBounds(group, t);
      }

      if (!bounds) continue;
      const inside = px >= bounds.left && px <= bounds.right && py >= bounds.top && py <= bounds.bottom;
      if (!inside) continue;

      const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
      if (area < pickedArea) {
        picked = group;
        pickedArea = area;
      }
    }

    return picked;
  };

  const addNodeToGroupChain = (groupId: string, nodeId: string) => {
    const rootId = String(groupId ?? '');
    const createdId = String(nodeId ?? '');
    if (!rootId || !createdId) return;

    const groupsSnapshot = get(nodeGroups);
    const byId = new Map<string, NodeGroup>();
    for (const g of groupsSnapshot) byId.set(String(g.id), g);

    const targetAndAncestors = new Set<string>();
    let cursor: string | null = rootId;
    while (cursor) {
      if (targetAndAncestors.has(cursor)) break;
      targetAndAncestors.add(cursor);
      const parent = byId.get(cursor)?.parentId ? String(byId.get(cursor)?.parentId) : '';
      cursor = parent && byId.has(parent) ? parent : null;
    }

    const effectiveDisabled = Array.from(targetAndAncestors).some((id) => Boolean(byId.get(id)?.disabled));

    let didAdd = false;
    nodeGroups.update((groups) =>
      groups.map((g) => {
        if (!targetAndAncestors.has(String(g.id))) return g;
        const set = new Set((g.nodeIds ?? []).map((id) => String(id)));
        if (set.has(createdId)) return g;
        set.add(createdId);
        if (String(g.id) === rootId) didAdd = true;
        return { ...g, nodeIds: Array.from(set) };
      })
    );

    if (!didAdd) return;

    recomputeDisabledNodes();
    opts.requestLoopFramesUpdate();
    opts.requestMinimapUpdate();

    if (effectiveDisabled) stopDeployedLoopsIntersecting([createdId]);
  };

  const autoAddNodeToGroupFromPosition = (nodeId: string, graphPos: { x: number; y: number }) => {
    const createdId = String(nodeId ?? '');
    if (!createdId) return;

    const t = readAreaTransform(opts.getAreaPlugin());
    if (!t) return;

    const gx = Number(graphPos?.x);
    const gy = Number(graphPos?.y);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;

    const px = gx * t.k + t.tx;
    const py = gy * t.k + t.ty;

    const groupsSnapshot = get(nodeGroups);
    if (groupsSnapshot.length === 0) return;

    const picked = pickGroupAtPoint(groupsSnapshot, px, py, t);
    if (!picked) return;

    addNodeToGroupChain(picked.id, createdId);
  };

  const autoAddNodeToGroupFromConnectDrop = (
    initialNodeId: string,
    newNodeId: string,
    dropGraphPos: { x: number; y: number }
  ) => {
    const initialId = String(initialNodeId ?? '');
    const createdId = String(newNodeId ?? '');
    if (!initialId || !createdId) return;

    const t = readAreaTransform(opts.getAreaPlugin());
    if (!t) return;

    const gx = Number(dropGraphPos?.x);
    const gy = Number(dropGraphPos?.y);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;

    // Convert the pick/drop graph position into the overlay coordinate space (container pixels).
    const px = gx * t.k + t.tx;
    const py = gy * t.k + t.ty;

    const candidates = get(nodeGroups).filter((g) => (g.nodeIds ?? []).some((id) => String(id) === initialId));
    if (candidates.length === 0) return;

    const picked = pickGroupAtPoint(candidates, px, py, t);

    if (!picked) return;
    addNodeToGroupChain(picked.id, createdId);
  };

  const createGroupFromSelection = () => {
    const selected = Array.from(get(groupSelectionNodeIds)).map((id) => String(id));
    if (selected.length === 0) return;

    const groups = get(nodeGroups);
    const byId = new Map<string, NodeGroup>();
    const groupNodeSets = new Map<string, Set<string>>();
    const nodeToGroupIds = new Map<string, string[]>();

    for (const g of groups) {
      const id = String(g.id);
      byId.set(id, { ...g, id, parentId: g.parentId ? String(g.parentId) : null });
      const set = new Set((g.nodeIds ?? []).map((nid) => String(nid)));
      groupNodeSets.set(id, set);
      for (const nid of set) {
        const list = nodeToGroupIds.get(nid) ?? [];
        list.push(id);
        nodeToGroupIds.set(nid, list);
      }
    }

    const depthCache = new Map<string, number>();
    const getDepth = (groupId: string, visiting = new Set<string>()): number => {
      const cached = depthCache.get(groupId);
      if (cached !== undefined) return cached;
      if (visiting.has(groupId)) return 0;
      visiting.add(groupId);

      const g = byId.get(groupId);
      const parentId = g?.parentId && byId.has(String(g.parentId)) ? String(g.parentId) : null;
      const depth = parentId ? getDepth(parentId, visiting) + 1 : 0;

      visiting.delete(groupId);
      depthCache.set(groupId, depth);
      return depth;
    };

    const getPrimaryGroupIdForNode = (nodeId: string): string | null => {
      const groupIds = nodeToGroupIds.get(String(nodeId)) ?? [];
      if (groupIds.length === 0) return null;

      let bestId: string | null = null;
      let bestDepth = -1;
      let bestSize = Number.POSITIVE_INFINITY;

      for (const gid of groupIds) {
        const depth = getDepth(gid);
        const size = groupNodeSets.get(gid)?.size ?? Number.POSITIVE_INFINITY;
        if (depth > bestDepth || (depth === bestDepth && size < bestSize)) {
          bestId = gid;
          bestDepth = depth;
          bestSize = size;
        }
      }

      return bestId;
    };

    let parentId: string | null = null;
    let parentDepth = -1;
    let parentSize = Number.POSITIVE_INFINITY;

    for (const g of groups) {
      const gid = String(g.id);
      const set = groupNodeSets.get(gid);
      if (!set) continue;
      const containsAll = selected.every((id) => set.has(String(id)));
      if (!containsAll) continue;

      const depth = getDepth(gid);
      const size = set.size;
      if (depth > parentDepth || (depth === parentDepth && size < parentSize)) {
        parentId = gid;
        parentDepth = depth;
        parentSize = size;
      }
    }

    const denied: string[] = [];
    const ids = new Set<string>();

    for (const nodeId of selected) {
      const primary = getPrimaryGroupIdForNode(nodeId);
      const allowed = parentId ? primary === parentId : primary === null;
      if (!allowed) {
        denied.push(nodeId);
        continue;
      }
      ids.add(nodeId);
    }

    if (denied.length > 0) showCanvasToast('无法创建跨组组合');
    if (ids.size === 0) return;

    const isEligibleLoopNode = (nodeId: string): boolean => {
      const primary = getPrimaryGroupIdForNode(nodeId);
      return parentId ? primary === parentId : primary === null;
    };

    for (const loop of opts.getLocalLoops()) {
      if (!loop?.nodeIds?.length) continue;
      const loopIds = loop.nodeIds.map((id) => String(id));
      if (!loopIds.some((id) => ids.has(id))) continue;
      if (!loopIds.every((id) => isEligibleLoopNode(id))) continue;
      for (const nid of loopIds) ids.add(nid);
    }

    const groupId = `group:${crypto.randomUUID?.() ?? Date.now()}`;
    const nextName = parentId
      ? `Sub Group ${(groups.filter((g) => String(g.parentId ?? '') === String(parentId)).length ?? 0) + 1}`
      : `Group ${groups.filter((g) => !g.parentId).length + 1}`;

    const group: NodeGroup = {
      id: groupId,
      parentId,
      name: nextName,
      nodeIds: Array.from(ids),
      disabled: false,
    };

    nodeGroups.set([...groups, group]);
    recomputeDisabledNodes();

    groupSelectionNodeIds.set(new Set());
    groupSelectionBounds.set(null);
    scheduleHighlight();
    opts.requestLoopFramesUpdate();

    const t = readAreaTransform(opts.getAreaPlugin());
    if (!t) return;
    const bounds = computeGroupFrameBounds(group, t);
    if (!bounds) return;
    pushNodesOutOfBounds(bounds, new Set(group.nodeIds.map((id) => String(id))));
  };

  const stopDeployedLoopsIntersecting = (nodeIds: string[]) => {
    const set = new Set(nodeIds.map((id) => String(id)));
    for (const loop of opts.getLocalLoops()) {
      if (!opts.getDeployedLoopIds().has(loop.id)) continue;
      if (!loop.nodeIds.some((id) => set.has(String(id)))) continue;
      opts.stopLoop(loop);
    }
  };

  const toggleGroupDisabled = (groupId: string) => {
    const group = get(nodeGroups).find((g) => g.id === groupId);
    if (!group) return;

    const nextDisabled = !group.disabled;
    nodeGroups.set(get(nodeGroups).map((g) => (g.id === groupId ? { ...g, disabled: nextDisabled } : g)));
    recomputeDisabledNodes();
    opts.requestLoopFramesUpdate();

    if (nextDisabled) stopDeployedLoopsIntersecting(group.nodeIds);
  };

  const disassembleGroup = (groupId: string) => {
    const rootId = String(groupId ?? '');
    if (!rootId) return;

    const groups = get(nodeGroups);
    if (!groups.some((g) => String(g.id) === rootId)) return;

    const childrenByParentId = new Map<string, string[]>();
    for (const g of groups) {
      const pid = g.parentId ? String(g.parentId) : '';
      if (!pid) continue;
      const list = childrenByParentId.get(pid) ?? [];
      list.push(String(g.id));
      childrenByParentId.set(pid, list);
    }

    const toRemove = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id) continue;
      if (toRemove.has(id)) continue;
      toRemove.add(id);
      const children = childrenByParentId.get(id) ?? [];
      for (const childId of children) stack.push(childId);
    }

    const editingId = get(editModeGroupId);
    if (editingId && toRemove.has(String(editingId))) {
      editModeGroupId.set(null);
      editModeGroupBounds = null;
      clearGroupEditToast();
      opts.requestLoopFramesUpdate();
    }

    nodeGroups.set(groups.filter((g) => !toRemove.has(String(g.id))));
    recomputeDisabledNodes(get(nodeGroups));
    opts.requestLoopFramesUpdate();
  };

  const renameGroup = (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!groupId || !trimmed) return;
    if (!get(nodeGroups).some((g) => g.id === groupId)) return;
    nodeGroups.set(get(nodeGroups).map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)));
    opts.requestLoopFramesUpdate();
  };

  const toggleGroupEditMode = (groupId: string) => {
    if (!groupId) return;
    const group = get(nodeGroups).find((g) => g.id === groupId) ?? null;
    if (!group) return;

    if (get(editModeGroupId) === groupId) {
      editModeGroupId.set(null);
      editModeGroupBounds = null;
      clearGroupEditToast();
      opts.requestLoopFramesUpdate();
      return;
    }

    const t = readAreaTransform(opts.getAreaPlugin());
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

    editModeGroupId.set(groupId);
    clearGroupEditToast();
    opts.requestLoopFramesUpdate();
  };

  const computeGroupFrames = () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin?.nodeViews || !areaPlugin?.area) {
      groupFrames.set([]);
      return;
    }
    const groups = get(nodeGroups);
    if (groups.length === 0) {
      groupFrames.set([]);
      return;
    }

    const t = readAreaTransform(areaPlugin);
    if (!t) {
      groupFrames.set([]);
      return;
    }

    const { byId, childrenByParentId } = buildGroupIndex(groups);

    const depthCache = new Map<string, number>();
    const getDepth = (groupId: string, visiting = new Set<string>()): number => {
      const cached = depthCache.get(groupId);
      if (cached !== undefined) return cached;
      if (visiting.has(groupId)) return 0;
      visiting.add(groupId);

      const g = byId.get(groupId);
      const parentId = g?.parentId && byId.has(String(g.parentId)) ? String(g.parentId) : null;
      const depth = parentId ? getDepth(parentId, visiting) + 1 : 0;

      visiting.delete(groupId);
      depthCache.set(groupId, depth);
      return depth;
    };

    const effectiveDisabledCache = new Map<string, boolean>();
    const getEffectiveDisabled = (groupId: string, visiting = new Set<string>()): boolean => {
      const cached = effectiveDisabledCache.get(groupId);
      if (cached !== undefined) return cached;
      if (visiting.has(groupId)) return false;
      visiting.add(groupId);

      const g = byId.get(groupId);
      const parentId = g?.parentId && byId.has(String(g.parentId)) ? String(g.parentId) : null;
      const effective = Boolean(g?.disabled) || (parentId ? getEffectiveDisabled(parentId, visiting) : false);

      visiting.delete(groupId);
      effectiveDisabledCache.set(groupId, effective);
      return effective;
    };

    const boundsCache = new Map<string, NodeBounds | null>();
    const computeBoundsCached = (groupId: string) =>
      computeGroupFrameBoundsWithChildren(groupId, t, byId, childrenByParentId, boundsCache, new Set());

    const frames: GroupFrame[] = [];
    for (const group of groups) {
      const depth = getDepth(String(group.id));
      const effectiveDisabled = getEffectiveDisabled(String(group.id));

      if (get(editModeGroupId) === group.id && editModeGroupBounds) {
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
          effectiveDisabled,
          depth,
        });
        continue;
      }

      const bounds = computeBoundsCached(String(group.id));
      if (!bounds) continue;

      frames.push({
        group,
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        effectiveDisabled,
        depth,
      });
    }

    frames.sort((a, b) => a.depth - b.depth);
    groupFrames.set(frames);
  };

  const computeSelectionBounds = () => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin?.area) {
      groupSelectionBounds.set(null);
      return;
    }
    if (get(groupSelectionNodeIds).size === 0) {
      groupSelectionBounds.set(null);
      return;
    }

    const t = readAreaTransform(areaPlugin);
    if (!t) {
      groupSelectionBounds.set(null);
      return;
    }

    const bounds = unionBounds(areaPlugin, Array.from(get(groupSelectionNodeIds)), t);
    if (!bounds) {
      groupSelectionBounds.set(null);
      return;
    }

    const pad = 18;
    groupSelectionBounds.set({
      left: bounds.left - pad,
      top: bounds.top - pad,
      width: bounds.right - bounds.left + pad * 2,
      height: bounds.bottom - bounds.top + pad * 2,
    });
  };

  const requestFramesUpdate = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (framesRaf) return;
    framesRaf = requestAnimationFrame(() => {
      framesRaf = 0;
      computeGroupFrames();
      computeSelectionBounds();
    });
  };

  const clearSelection = () => {
    if (get(groupSelectionNodeIds).size === 0) return;
    groupSelectionNodeIds.set(new Set());
    groupSelectionBounds.set(null);
    scheduleHighlight();
  };

  const toContainerPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const container = opts.getContainer();
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const isMarqueeStartTarget = (target: HTMLElement | null): boolean => {
    if (!target) return false;
    if (target.closest('.node')) return false;
    if (target.closest('.node-picker')) return false;
    if (target.closest('.marquee-actions')) return false;
    if (target.closest('.minimap')) return false;
    if (target.closest('.executor-logs')) return false;
    if (target.closest('.loop-frame-header')) return false;
    if (target.closest('.group-frame-header')) return false;
    return true;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;

    if (!event.shiftKey && get(groupSelectionNodeIds).size > 0 && isMarqueeStartTarget(target)) {
      clearSelection();
      return;
    }

    if (!event.shiftKey) return;
    if (!isMarqueeStartTarget(target)) return;

    event.preventDefault();
    event.stopPropagation();

    clearSelection();
    isMarqueeDragging = true;
    marqueePointerId = event.pointerId;
    marqueeStart = toContainerPoint(event.clientX, event.clientY);
    marqueeCurrent = marqueeStart;
    marqueeRect.set({
      left: marqueeStart.x,
      top: marqueeStart.y,
      width: 0,
      height: 0,
    });

    const onMove = (ev: PointerEvent) => {
      if (!isMarqueeDragging) return;
      if (marqueePointerId !== null && ev.pointerId !== marqueePointerId) return;
      marqueeCurrent = toContainerPoint(ev.clientX, ev.clientY);
      const left = Math.min(marqueeStart.x, marqueeCurrent.x);
      const top = Math.min(marqueeStart.y, marqueeCurrent.y);
      const width = Math.abs(marqueeStart.x - marqueeCurrent.x);
      const height = Math.abs(marqueeStart.y - marqueeCurrent.y);
      marqueeRect.set({ left, top, width, height });
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

      const t = readAreaTransform(opts.getAreaPlugin());
      if (!t) return;

      const selected: string[] = [];
      for (const nodeId of opts.getNodeMap().keys()) {
        const b = readNodeBounds(opts.getAreaPlugin(), nodeId, t);
        if (!b) continue;
        const intersects = b.right >= selLeft && b.left <= selRight && b.bottom >= selTop && b.top <= selBottom;
        if (!intersects) continue;
        selected.push(nodeId);
      }

      groupSelectionNodeIds.set(new Set(selected));
      scheduleHighlight();
      computeSelectionBounds();
      marqueeRect.set(null);
    };

    marqueeMoveHandler = onMove;
    marqueeUpHandler = onUp;
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
  };

  return {
    nodeGroups,
    groupFrames,
    groupSelectionNodeIds,
    groupSelectionBounds,
    editModeGroupId,
    canvasToast,
    groupEditToast,
    groupDisabledNodeIds,
    marqueeRect,
    requestFramesUpdate,
    applyHighlights,
    scheduleHighlight,
    clearSelection,
    createGroupFromSelection,
    toggleGroupDisabled,
    disassembleGroup,
    renameGroup,
    toggleGroupEditMode,
    autoAddNodeToGroupFromPosition,
    autoAddNodeToGroupFromConnectDrop,
    handleDroppedNodesAfterDrag,
    onPointerDown,
    destroy: () => {
      clearGroupEditToast();
      clearCanvasToast();
      if (framesRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(framesRaf);
      framesRaf = 0;
      if (marqueeMoveHandler)
        window.removeEventListener('pointermove', marqueeMoveHandler, { capture: true } as any);
      if (marqueeUpHandler) {
        window.removeEventListener('pointerup', marqueeUpHandler, { capture: true } as any);
        window.removeEventListener('pointercancel', marqueeUpHandler, { capture: true } as any);
      }
      marqueeMoveHandler = null;
      marqueeUpHandler = null;
    },
    isProgrammaticTranslate,
    beginProgrammaticTranslate,
    endProgrammaticTranslate,
    computeLoopFrameBounds,
    pushNodesOutOfBounds,
  };
}
