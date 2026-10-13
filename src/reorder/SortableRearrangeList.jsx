/**
 * SortableRearrangeList.jsx — @dnd-kit vertical drag-to-reorder list primitives.
 *
 * Exports SortableRearrangeList (DndContext wrapper with vertical-axis
 * restriction, clamped drag bounds, and variableHeight collision tuning) and
 * SortableRearrangeRow (useSortable row with transform/opacity styling). Calls
 * onReorder via flushSync on drop and emits [SortableRearrange] drag-diagnostic
 * logs. Used wherever survey lists/rows are reordered by drag.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CALM_LIST_AUTO_SCROLL } from './dragAutoScroll.js';
import { getDragSlotRect } from './dragSlot.js';

export const DENSE_ROW_DRAG_OPACITY = 0.62;

const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

const pointerThenClosestCenter = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

/*
 * UX 2026-09-30 (owner: every drag must feel controlled) — slot hysteresis.
 * The raw detectors swap two rows the instant the finger crosses their shared
 * boundary, so a finger resting ON that line (or a trembling thumb) see-sawed
 * the rows back and forth. The target only moves once the finger is a few px
 * past the boundary; coming back needs the same few px the other way.
 */
const SLOT_HYSTERESIS_PX = 8;
export const holdSlotAtBoundary = (args, collisions, lastOverId) => {
  const candidateId = collisions?.[0]?.id ?? null;
  if (candidateId == null || lastOverId == null || candidateId === lastOverId) return collisions;
  const candidateRect = args.droppableRects?.get(candidateId);
  const lastRect = args.droppableRects?.get(lastOverId);
  const lastContainer = args.droppableContainers?.find((container) => container.id === lastOverId);
  if (!candidateRect || !lastRect || !lastContainer) return collisions;

  const pointer = args.pointerCoordinates;
  const pointerInCandidate = pointer
    && pointer.y >= candidateRect.top && pointer.y <= candidateRect.top + candidateRect.height
    && pointer.x >= candidateRect.left && pointer.x <= candidateRect.left + candidateRect.width;
  const movingDown = candidateRect.top >= lastRect.top;
  const point = pointerInCandidate
    ? pointer.y
    : args.collisionRect.top + args.collisionRect.height / 2;
  const boundary = pointerInCandidate
    ? (movingDown ? candidateRect.top : candidateRect.top + candidateRect.height)
    : ((lastRect.top + lastRect.height / 2) + (candidateRect.top + candidateRect.height / 2)) / 2;
  const margin = Math.min(SLOT_HYSTERESIS_PX, Math.min(candidateRect.height, lastRect.height) * 0.2);
  const pastBoundary = movingDown ? point - boundary : boundary - point;
  if (pastBoundary >= margin) return collisions;
  return [{ id: lastOverId, data: { droppableContainer: lastContainer, value: 0 } }];
};

const DropTransformSuppressionContext = createContext({
  activeId: null,
  isSuppressed: false,
});

const getSortableRearrangeItemNode = (id) => {
  const idValue = String(id ?? '');
  const matches = Array.from(document.querySelectorAll('[data-sortable-rearrange-item]'))
    .filter((node) => node.dataset.sortableRearrangeItem === idValue);
  // Responsive desktop/mobile trees coexist in the DOM and legitimately use
  // the same stable ids. Prefer the rendered node; measuring the hidden twin
  // produces zero-height collision geometry and makes touch reordering a no-op.
  return matches.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || matches[0];
};

const getDragLayoutSnapshot = (activeId) => {
  if (typeof document === 'undefined') return null;
  const activeNode = getSortableRearrangeItemNode(activeId);
  const listNode = activeNode?.closest?.('[data-sortable-rearrange-list]');
  if (!activeNode || !listNode) return null;

  const activeRect = activeNode.getBoundingClientRect();
  const listRect = listNode.getBoundingClientRect();
  const itemRects = Array.from(listNode.querySelectorAll('[data-sortable-rearrange-item]'))
    .filter((node) => node.closest?.('[data-sortable-rearrange-list]') === listNode)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.sortableRearrangeItem,
        top: Number((rect.top - listRect.top).toFixed(1)),
        height: Number(rect.height.toFixed(1)),
      };
    });

  return {
    activeHeight: Number(activeRect.height.toFixed(1)),
    activeTop: Number((activeRect.top - listRect.top).toFixed(1)),
    listHeight: Number(listRect.height.toFixed(1)),
    itemRects,
  };
};

const getDragClampBounds = (layoutSnapshot) => {
  const rects = layoutSnapshot?.itemRects || [];
  if (!layoutSnapshot || rects.length === 0) return null;

  const slotTops = rects.map((rect) => rect.top);
  const firstSlotTop = Math.min(...slotTops);
  const lastSlotTop = Math.max(...slotTops);
  const lastSlotBottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  const slotTopMaxY = lastSlotTop - layoutSnapshot.activeTop;
  const containmentMaxY = lastSlotBottom - (layoutSnapshot.activeTop + layoutSnapshot.activeHeight);

  return {
    minY: firstSlotTop - layoutSnapshot.activeTop,
    maxY: Math.max(slotTopMaxY, containmentMaxY),
    mode: 'slot-or-containment',
    slotTopMaxY: Number(slotTopMaxY.toFixed(1)),
    containmentMaxY: Number(containmentMaxY.toFixed(1)),
  };
};

// The dashed landing slot (see ./dragSlot.js): this list's own rows, measured
// when the drag starts, in the list's coordinates.
const measureSlotRows = (listNode) => {
  if (!listNode) return null;
  const listRect = listNode.getBoundingClientRect();
  return Array.from(listNode.querySelectorAll('[data-sortable-rearrange-item]'))
    .filter((node) => node.closest('[data-sortable-rearrange-list]') === listNode)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.sortableRearrangeItem,
        top: rect.top - listRect.top - listNode.clientTop,
        height: rect.height,
      };
    });
};

const showDragSlot = (listNode, rect) => {
  if (!listNode || !rect) return;
  listNode.style.setProperty('--drag-slot-top', `${rect.top.toFixed(1)}px`);
  listNode.style.setProperty('--drag-slot-height', `${rect.height.toFixed(1)}px`);
  listNode.setAttribute('data-drag-slot', '');
};

const hideDragSlot = (listNode) => {
  listNode?.removeAttribute('data-drag-slot');
};

export function SortableRearrangeList({
  ids,
  onReorder,
  onDragStart,
  onDragMove,
  onDragOver,
  onBeforeDragEnd,
  onDragEnd,
  onDragCancel,
  variableHeight = false,
  children,
  gap = 'inherit',
  dropSettleMs = 0,
  suppressDropTransforms = false,
}) {
  const dndContextId = useId();
  const [activeId, setActiveId] = useState(null);
  const [isDropTransformSuppressed, setIsDropTransformSuppressed] = useState(false);
  const [dropTransformSuppressedActiveId, setDropTransformSuppressedActiveId] = useState(null);
  const dragDiagRef = useRef(null);
  const dragClampBoundsRef = useRef(null);
  const lastOverIdRef = useRef(null);
  const listRef = useRef(null);
  const slotRowsRef = useRef(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (activeId) {
      document.body.classList.add('drag-rearrange-dragging');
    } else {
      document.body.classList.remove('drag-rearrange-dragging');
    }
    return () => document.body.classList.remove('drag-rearrange-dragging');
  }, [activeId]);

  const modifiers = useMemo(() => [
    restrictToVerticalAxis,
    ({ transform }) => {
      const bounds = dragClampBoundsRef.current;
      if (!bounds) return transform;
      return {
        ...transform,
        y: Math.min(Math.max(transform.y, bounds.minY), bounds.maxY),
      };
    },
  ], []);

  const measuring = useMemo(() => (
    variableHeight
      ? { droppable: { strategy: MeasuringStrategy.Always } }
      : undefined
  ), [variableHeight]);
  const detectCollisions = useCallback((args) => {
    if (!variableHeight) return pointerThenClosestCenter(args);

    const activeTop = dragDiagRef.current?.layoutStart?.activeTop;
    const listNode = args.active?.id
      ? getSortableRearrangeItemNode(args.active.id)?.closest?.('[data-sortable-rearrange-list]')
      : null;
    const listTop = listNode?.getBoundingClientRect?.().top;
    const currentTop = typeof listTop === 'number'
      ? args.collisionRect.top - listTop
      : null;
    const isMovingUp = typeof activeTop === 'number' && typeof currentTop === 'number'
      ? currentTop < activeTop
      : false;

    if (isMovingUp) {
      const pointerCollisions = pointerWithin(args)
        .filter((collision) => collision.id !== args.active?.id);
      if (pointerCollisions.length > 0) return pointerCollisions;

      const layoutStart = dragDiagRef.current?.layoutStart;
      const activeIndex = layoutStart?.itemRects?.findIndex((rect) => rect.id === String(args.active?.id)) ?? -1;
      if (layoutStart && activeIndex > 0 && typeof currentTop === 'number') {
        const previousRects = layoutStart.itemRects.slice(0, activeIndex).reverse();
        const targetRect = previousRects.find((rect) => currentTop <= rect.top + rect.height);
        if (targetRect) {
          const droppableContainer = args.droppableContainers.find((container) => container.id === targetRect.id);
          if (droppableContainer) {
            return [{
              id: targetRect.id,
              data: {
                droppableContainer,
                value: Math.abs(currentTop - (targetRect.top + targetRect.height)),
              },
            }];
          }
        }
      }

      return closestCenter(args);
    }

    return closestCenter(args);
  }, [variableHeight]);
  const collisionDetection = useCallback((args) => {
    const collisions = holdSlotAtBoundary(args, detectCollisions(args), lastOverIdRef.current ?? args.active?.id);
    lastOverIdRef.current = collisions?.[0]?.id ?? lastOverIdRef.current;
    return collisions;
  }, [detectCollisions]);

  const finishDragDiag = useCallback((eventName, extra = {}) => {
    const diag = dragDiagRef.current;
    if (!diag) return;

    const endedAt = performance.now();
    const summary = {
      event: eventName,
      activeId: diag.activeId,
      durationMs: Math.round(endedAt - diag.startedAt),
      moveCount: diag.moveCount,
      overChangeCount: diag.overChangeCount,
      maxMoveGapMs: Math.round(diag.maxMoveGapMs),
      finalOverId: extra.overId ?? diag.overId ?? null,
      didReorder: !!extra.didReorder,
      itemCount: ids.length,
      layoutStart: diag.layoutStart,
      layoutEnd: getDragLayoutSnapshot(diag.activeId),
      clampBounds: diag.clampBounds,
    };
    console.log('[SortableRearrange]', JSON.stringify(summary));
    dragDiagRef.current = null;
  }, [ids.length]);

  const handleDragEnd = useCallback(({ active, over }) => {
    const didReorder = Boolean(over && active.id !== over.id);
    onBeforeDragEnd?.({
      activeId: active.id,
      overId: over?.id ?? null,
      didReorder,
    });
    if (didReorder) {
      flushSync(() => {
        if (suppressDropTransforms) {
          setIsDropTransformSuppressed(true);
          setDropTransformSuppressedActiveId(active.id);
        }
        onReorder(active.id, over.id);
      });
    }
    setActiveId(null);
    dragClampBoundsRef.current = null;
    slotRowsRef.current = null;
    hideDragSlot(listRef.current);
    finishDragDiag('end', {
      overId: over?.id ?? null,
      didReorder,
    });
    if (suppressDropTransforms && didReorder) {
      setTimeout(() => {
        setIsDropTransformSuppressed(false);
        setDropTransformSuppressedActiveId(null);
      }, dropSettleMs);
    }
    onDragEnd?.({
      activeId: active.id,
      overId: over?.id ?? null,
      didReorder,
    });
  }, [dropSettleMs, finishDragDiag, onBeforeDragEnd, onDragEnd, onReorder, suppressDropTransforms]);

  const dropTransformSuppressionValue = useMemo(() => ({
    activeId: dropTransformSuppressedActiveId,
    isSuppressed: isDropTransformSuppressed,
  }), [dropTransformSuppressedActiveId, isDropTransformSuppressed]);

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={modifiers}
      measuring={measuring}
      autoScroll={CALM_LIST_AUTO_SCROLL}
      onDragStart={({ active }) => {
        lastOverIdRef.current = active.id;
        const layoutStart = getDragLayoutSnapshot(active.id);
        const clampBounds = getDragClampBounds(layoutStart);
        dragClampBoundsRef.current = clampBounds;
        dragDiagRef.current = {
          activeId: active.id,
          startedAt: performance.now(),
          layoutStart,
          clampBounds,
          lastMoveAt: null,
          maxMoveGapMs: 0,
          moveCount: 0,
          overChangeCount: 0,
          overId: null,
        };
        console.log('[SortableRearrange]', JSON.stringify({
          event: 'start',
          activeId: active.id,
          itemCount: ids.length,
          layoutStart: dragDiagRef.current.layoutStart,
          clampBounds,
          useDragOverlay: false,
          variableHeight,
        }));
        slotRowsRef.current = measureSlotRows(listRef.current);
        showDragSlot(listRef.current, getDragSlotRect(slotRowsRef.current, active.id, active.id));
        setActiveId(active.id);
        onDragStart?.({ activeId: active.id });
      }}
      onDragMove={({ active, over, delta }) => {
        const diag = dragDiagRef.current;
        if (diag) {
          const now = performance.now();
          if (diag.lastMoveAt != null) {
            diag.maxMoveGapMs = Math.max(diag.maxMoveGapMs, now - diag.lastMoveAt);
          }
          diag.lastMoveAt = now;
          diag.moveCount += 1;
        }
        onDragMove?.({
          activeId: active.id,
          overId: over?.id ?? null,
          delta,
        });
      }}
      onDragOver={({ active, over }) => {
        const diag = dragDiagRef.current;
        const overId = over?.id ?? null;
        if (diag && diag.overId !== overId) {
          diag.overId = overId;
          diag.overChangeCount += 1;
        }
        if (slotRowsRef.current) {
          showDragSlot(listRef.current, getDragSlotRect(slotRowsRef.current, active.id, overId ?? active.id));
        }
        onDragOver?.({
          activeId: active.id,
          overId,
        });
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={({ active }) => {
        const cancelledActiveId = active?.id ?? activeId;
        setActiveId(null);
        dragClampBoundsRef.current = null;
        slotRowsRef.current = null;
        hideDragSlot(listRef.current);
        finishDragDiag('cancel', {
          overId: null,
          didReorder: false,
        });
        onDragCancel?.({ activeId: cancelledActiveId });
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <DropTransformSuppressionContext.Provider value={dropTransformSuppressionValue}>
          <div
            ref={listRef}
            data-sortable-rearrange-list={String(activeId ?? '')}
            // Owner 2026-09-22: no `minHeight: 100%` here. Inside a padded
            // scroll container it made the list taller than the container's
            // content box, so a ONE-row project file list showed a scrollbar.
            // The list is as tall as its rows; the scroll container decides.
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap }}
          >
            {children}
          </div>
        </DropTransformSuppressionContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

export function SortableRearrangeRow({
  id,
  children,
  disabled = false,
  animateLayoutChanges,
  customLayout = false,
  disableSettledTransition = false,
  draggingOpacity = DENSE_ROW_DRAG_OPACITY,
  forceDraggingVisual = false,
  // The shared "picked up" look (states.css [data-drag-lifted]). On by default
  // for every list; pass false only for a row that draws its own.
  lift = true,
  transition: transitionOption,
  wrapperStyle = null,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id, disabled, animateLayoutChanges, transition: transitionOption });
  const dropTransformSuppression = useContext(DropTransformSuppressionContext);
  const isDropTransformSuppressed = !!dropTransformSuppression.isSuppressed;
  const isSuppressedActiveRow = isDropTransformSuppressed
    && String(dropTransformSuppression.activeId ?? '') === String(id);
  const isDraggingVisual = isDragging || forceDraggingVisual || isSuppressedActiveRow;
  const rowTransition = transitionOption === null
    ? 'none'
    : (isDraggingVisual || isDropTransformSuppressed || (disableSettledTransition && !isSorting) ? 'none' : transition);

  const resolvedWrapperStyle = typeof wrapperStyle === 'function'
    ? wrapperStyle({
      id,
      isDragging: isDraggingVisual,
      isSorting,
    })
    : wrapperStyle;

  const style = {
    transform: isDropTransformSuppressed ? 'none' : CSS.Translate.toString(transform),
    transition: rowTransition,
    // A lifted row is solid (owner 2026-10-01: one uniform picked-up look);
    // a list that opts out of the lift keeps its ghost opacity.
    opacity: isDraggingVisual && !lift ? draggingOpacity : 1,
    zIndex: isDraggingVisual ? 1 : 0,
    position: 'relative',
    width: '100%',
    flexShrink: 0,
    ...(resolvedWrapperStyle || {}),
  };

  if (customLayout) {
    return children({
      attributes,
      listeners,
      isDragging: isDraggingVisual,
      isSorting,
      setNodeRef,
      setDraggableNodeRef,
      setDroppableNodeRef,
      style,
      itemAttributes: {
        'data-sortable-rearrange-item': String(id),
        ...(isDraggingVisual && lift ? { 'data-drag-lifted': '' } : {}),
      },
    });
  }

  return (
    <div
      ref={setNodeRef}
      data-sortable-rearrange-item={String(id)}
      data-drag-lifted={isDraggingVisual && lift ? '' : undefined}
      style={style}
    >
      {children({
        attributes,
        listeners,
        isDragging: isDraggingVisual,
        isSorting,
      })}
    </div>
  );
}
