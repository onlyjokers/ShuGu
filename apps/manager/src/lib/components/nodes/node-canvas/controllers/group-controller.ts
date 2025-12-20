/**
 * Purpose: Node group + marquee selection controller for NodeCanvas.
 */
import { get, writable, type Writable } from 'svelte/store';
import type { LocalLoop } from '$lib/nodes';
import type { GraphState, NodeInstance } from '$lib/nodes/types';
import { nodeRegistry } from '$lib/nodes';
import { readAreaTransform, readNodeBounds, type AreaTransform, type NodeBounds, unionBounds } from '../utils/view-utils';

export type NodeGroup = { id: string; name: string; nodeIds: string[]; disabled: boolean };
export type GroupFrame = { group: NodeGroup; left: number; top: number; width: number; height: number };
export type GroupEditToast = { groupId: string; message: string } | null;

export type GroupController = {
  nodeGroups: Writable<NodeGroup[]>;
  groupFrames: Writable<GroupFrame[]>;
  groupSelectionNodeIds: Writable<Set<string>>;
  groupSelectionBounds: Writable<{ left: number; top: number; width: number; height: number } | null>;
  editModeGroupId: Writable<string | null>;
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
  handleDroppedNodesAfterDrag: (nodeIds: string[]) => void;
  onPointerDown: (event: PointerEvent) => void;
  destroy: () => void;
  isProgrammaticTranslate: () => boolean;
  computeLoopFrameBounds: (loop: LocalLoop) => NodeBounds | null;
  pushNodesOutOfBounds: (bounds: NodeBounds, excludeNodeIds: Set<string>) => void;
};

type GroupControllerOptions = {
  getContainer: () => HTMLDivElement | null;
  getAreaPlugin: () => any;
  getNodeMap: () => Map<string, any>;
  getGraphState: () => GraphState;
  getLocalLoops: () => LocalLoop[];
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
  const groupEditToast = writable<GroupEditToast>(null);
  const groupDisabledNodeIds = writable<Set<string>>(new Set());
  const marqueeRect = writable<{ left: number; top: number; width: number; height: number } | null>(null);

  let groupHighlightDirty = false;
  let groupEditToastTimeout: ReturnType<typeof setTimeout> | null = null;

  let editModeGroupBounds: { left: number; top: number; right: number; bottom: number } | null = null;

  let isMarqueeDragging = false;
  let marqueeStart = { x: 0, y: 0 };
  let marqueeCurrent = { x: 0, y: 0 };
  let marqueePointerId: number | null = null;
  let marqueeMoveHandler: ((event: PointerEvent) => void) | null = null;
  let marqueeUpHandler: ((event: PointerEvent) => void) | null = null;

  let programmaticTranslateDepth = 0;
  const isProgrammaticTranslate = () => programmaticTranslateDepth > 0;

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

  const computeGroupFrameBounds = (group: NodeGroup, t: AreaTransform): NodeBounds | null => {
    const paddingX = 52;
    const paddingTop = 64;
    const paddingBottom = 52;

    const loopPaddingX = 56;
    const loopPaddingTop = 64;
    const loopPaddingBottom = 64;

    const base = unionBounds(opts.getAreaPlugin(), group.nodeIds ?? [], t);
    if (!base) return null;

    let bounds = { ...base };
    const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
    for (const loop of opts.getLocalLoops()) {
      if (!loop?.nodeIds?.length) continue;
      const fullyContained = loop.nodeIds.every((id) => groupNodeSet.has(String(id)));
      if (!fullyContained) continue;
      const lb = unionBounds(opts.getAreaPlugin(), loop.nodeIds, t);
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

  const pushNodesOutOfBounds = (bounds: NodeBounds, excludeNodeIds: Set<string>) => {
    const areaPlugin = opts.getAreaPlugin();
    if (!areaPlugin?.nodeViews) return;
    const t = readAreaTransform(areaPlugin);
    if (!t) return;

    const margin = 24;
    const updates: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];

    for (const nodeId of opts.getNodeMap().keys()) {
      const id = String(nodeId);
      if (excludeNodeIds.has(id)) continue;
      const b = readNodeBounds(areaPlugin, id, t);
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
      candidates.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
      const pick = candidates[0];
      if (!pick) continue;

      const view = areaPlugin.nodeViews.get(id);
      const pos = view?.position as { x: number; y: number } | undefined;
      if (!pos) continue;

      const to = { x: pos.x + pick.dx / t.k, y: pos.y + pick.dy / t.k };
      updates.push({ id, from: { x: pos.x, y: pos.y }, to });
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

    for (const loop of opts.getLocalLoops()) {
      const bounds = computeLoopFrameBounds(loop);
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

    const editId = get(editModeGroupId);
    if (editId && editModeGroupBounds) {
      const group = get(nodeGroups).find((g) => g.id === editId) ?? null;
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
          nodeGroups.update((groups) =>
            groups.map((g) => (g.id === group.id ? { ...g, nodeIds: Array.from(nextSet) } : g))
          );
          recomputeDisabledNodes();
          opts.requestLoopFramesUpdate();

          if (group.disabled && added.length > 0) {
            stopDeployedLoopsIntersecting(added.map(String));
          }
        }
      }
    }

    for (const group of get(nodeGroups)) {
      if (get(editModeGroupId) === group.id) continue;

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
  };

  const createGroupFromSelection = () => {
    const initialIds = Array.from(get(groupSelectionNodeIds)).map((id) => String(id));
    if (initialIds.length === 0) return;

    const ids = new Set(initialIds);
    for (const loop of opts.getLocalLoops()) {
      if (!loop?.nodeIds?.some((id) => ids.has(String(id)))) continue;
      for (const nid of loop.nodeIds) ids.add(String(nid));
    }

    const groupId = `group:${crypto.randomUUID?.() ?? Date.now()}`;
    const nextName = `Group ${get(nodeGroups).length + 1}`;
    const group: NodeGroup = {
      id: groupId,
      name: nextName,
      nodeIds: Array.from(ids),
      disabled: false,
    };
    nodeGroups.set([...get(nodeGroups), group]);
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
    if (!groupId) return;
    if (!get(nodeGroups).some((g) => g.id === groupId)) return;
    if (get(editModeGroupId) === groupId) {
      editModeGroupId.set(null);
      editModeGroupBounds = null;
      clearGroupEditToast();
    }
    nodeGroups.set(get(nodeGroups).filter((g) => g.id !== groupId));
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
    if (get(nodeGroups).length === 0) {
      groupFrames.set([]);
      return;
    }

    const t = readAreaTransform(areaPlugin);
    if (!t) {
      groupFrames.set([]);
      return;
    }

    const paddingX = 52;
    const paddingTop = 64;
    const paddingBottom = 52;

    const loopPaddingX = 56;
    const loopPaddingTop = 64;
    const loopPaddingBottom = 64;

    const frames: GroupFrame[] = [];
    for (const group of get(nodeGroups)) {
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
        });
        continue;
      }

      const base = unionBounds(areaPlugin, group.nodeIds, t);
      if (!base) continue;

      let bounds = { ...base };
      const groupNodeSet = new Set((group.nodeIds ?? []).map((id) => String(id)));
      for (const loop of opts.getLocalLoops()) {
        if (!loop?.nodeIds?.length) continue;
        const fullyContained = loop.nodeIds.every((id) => groupNodeSet.has(String(id)));
        if (!fullyContained) continue;
        const lb = unionBounds(areaPlugin, loop.nodeIds, t);
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
    handleDroppedNodesAfterDrag,
    onPointerDown,
    destroy: () => {
      clearGroupEditToast();
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
    computeLoopFrameBounds,
    pushNodesOutOfBounds,
  };
}
