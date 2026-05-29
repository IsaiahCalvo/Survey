import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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

const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

const pointerThenClosestCenter = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const getSortableRearrangeItemNode = (id) => {
  const idValue = String(id ?? '');
  return Array.from(document.querySelectorAll('[data-sortable-rearrange-item]'))
    .find((node) => node.dataset.sortableRearrangeItem === idValue);
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
}) {
  const dndContextId = useId();
  const [activeId, setActiveId] = useState(null);
  const dragDiagRef = useRef(null);
  const dragClampBoundsRef = useRef(null);
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
  const collisionDetection = useCallback((args) => {
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
        onReorder(active.id, over.id);
      });
    }
    setActiveId(null);
    dragClampBoundsRef.current = null;
    finishDragDiag('end', {
      overId: over?.id ?? null,
      didReorder,
    });
    onDragEnd?.({
      activeId: active.id,
      overId: over?.id ?? null,
      didReorder,
    });
  }, [finishDragDiag, onBeforeDragEnd, onDragEnd, onReorder]);

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={modifiers}
      measuring={measuring}
      onDragStart={({ active }) => {
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
        finishDragDiag('cancel', {
          overId: null,
          didReorder: false,
        });
        onDragCancel?.({ activeId: cancelledActiveId });
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          data-sortable-rearrange-list={String(activeId ?? '')}
          style={{ width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', gap }}
        >
          {children}
        </div>
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
  draggingOpacity = 0.8,
  forceDraggingVisual = false,
  transition: transitionOption,
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
  const rowTransition = transitionOption === null
    ? 'none'
    : (isDragging || forceDraggingVisual || (disableSettledTransition && !isSorting) ? 'none' : transition);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: rowTransition,
    opacity: isDragging || forceDraggingVisual ? draggingOpacity : 1,
    zIndex: isDragging || forceDraggingVisual ? 1 : 0,
    position: 'relative',
    width: '100%',
    flexShrink: 0,
  };

  if (customLayout) {
    return children({
      attributes,
      listeners,
      isDragging: isDragging || forceDraggingVisual,
      isSorting,
      setNodeRef,
      setDraggableNodeRef,
      setDroppableNodeRef,
      style,
      itemAttributes: {
        'data-sortable-rearrange-item': String(id),
      },
    });
  }

  return (
    <div ref={setNodeRef} data-sortable-rearrange-item={String(id)} style={style}>
      {children({
        attributes,
        listeners,
        isDragging: isDragging || forceDraggingVisual,
        isSorting,
      })}
    </div>
  );
}
