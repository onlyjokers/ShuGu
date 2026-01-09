/**
 * Purpose: Frame header drag interactions (move all nodes in a group/loop together).
 */

import { get } from 'svelte/store';
import type { GroupController } from './group-controller';
import type { LoopController } from './loop-controller';
import { readAreaTransform } from '../utils/view-utils';

export type FrameDragController = {
  startGroupHeaderDrag: (groupId: string, event: PointerEvent) => void;
  startLoopHeaderDrag: (loopId: string, event: PointerEvent) => void;
  destroy: () => void;
};

export type CreateFrameDragControllerOptions = {
  getAreaPlugin: () => any;
  groupController: GroupController;
  getLoopController: () => LoopController | null;
};

export function createFrameDragController(opts: CreateFrameDragControllerOptions): FrameDragController {
  const { getAreaPlugin, groupController, getLoopController } = opts;

  let groupHeaderDragPointerId: number | null = null;
  let groupHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let groupHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;

  let loopHeaderDragPointerId: number | null = null;
  let loopHeaderDragMoveHandler: ((event: PointerEvent) => void) | null = null;
  let loopHeaderDragUpHandler: ((event: PointerEvent) => void) | null = null;

  const clearGroupListeners = () => {
    if (groupHeaderDragMoveHandler)
      window.removeEventListener('pointermove', groupHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (groupHeaderDragUpHandler) {
      window.removeEventListener('pointerup', groupHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', groupHeaderDragUpHandler, { capture: true } as any);
    }
  };

  const clearLoopListeners = () => {
    if (loopHeaderDragMoveHandler)
      window.removeEventListener('pointermove', loopHeaderDragMoveHandler, {
        capture: true,
      } as any);
    if (loopHeaderDragUpHandler) {
      window.removeEventListener('pointerup', loopHeaderDragUpHandler, { capture: true } as any);
      window.removeEventListener('pointercancel', loopHeaderDragUpHandler, { capture: true } as any);
    }
  };

  // Dragging a group header moves all nodes in that group together.
  const startGroupHeaderDrag = (groupId: string, event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.group-frame-actions')) return;
    if (target?.closest?.('input')) return;

    const areaPlugin = getAreaPlugin();
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

    clearGroupListeners();

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

      clearGroupListeners();
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

    const areaPlugin = getAreaPlugin();
    const loopController = getLoopController();
    const effectiveLoops =
      loopController?.getEffectiveLoops?.() ?? (loopController ? get(loopController.localLoops) : []);
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

    clearLoopListeners();

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

      clearLoopListeners();
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

  const destroy = () => {
    clearGroupListeners();
    if (groupHeaderDragPointerId !== null) groupController.endProgrammaticTranslate();
    groupHeaderDragPointerId = null;
    groupHeaderDragMoveHandler = null;
    groupHeaderDragUpHandler = null;

    clearLoopListeners();
    if (loopHeaderDragPointerId !== null) groupController.endProgrammaticTranslate();
    loopHeaderDragPointerId = null;
    loopHeaderDragMoveHandler = null;
    loopHeaderDragUpHandler = null;
  };

  return { startGroupHeaderDrag, startLoopHeaderDrag, destroy };
}

