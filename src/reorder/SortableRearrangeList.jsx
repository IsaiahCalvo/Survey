import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

export function SortableRearrangeList({
  ids,
  onReorder,
  onDragStart,
  onDragEnd,
  onDragCancel,
  children,
  gap = 'inherit',
}) {
  const dndContextId = useId();
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
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
    ({ activeNodeRect, active, transform }) => {
      const activeIdValue = String(active?.id ?? '');
      const activeNode = Array.from(document.querySelectorAll('[data-sortable-rearrange-item]'))
        .find((node) => node.dataset.sortableRearrangeItem === activeIdValue);
      const listNode = activeNode?.closest?.('[data-sortable-rearrange-list]');

      if (!activeNodeRect || !listNode) {
        return transform;
      }

      const itemRects = Array.from(listNode.querySelectorAll('[data-sortable-rearrange-item]'))
        .map((node) => ({
          top: node.offsetTop,
          bottom: node.offsetTop + node.offsetHeight,
        }))
        .filter((rect) => rect.bottom > rect.top);

      if (!itemRects.length) {
        return transform;
      }

      const top = Math.min(...itemRects.map((rect) => rect.top));
      const bottom = Math.max(...itemRects.map((rect) => rect.bottom));

      return {
        ...transform,
        y: Math.min(
          Math.max(transform.y, top - activeNode.offsetTop),
          bottom - (activeNode.offsetTop + activeNode.offsetHeight)
        ),
      };
    },
  ], []);

  const handleDragEnd = useCallback(({ active, over }) => {
    const didReorder = Boolean(over && active.id !== over.id);
    if (didReorder) {
      flushSync(() => {
        onReorder(active.id, over.id);
      });
    }
    setActiveId(null);
    onDragEnd?.({
      activeId: active.id,
      overId: over?.id ?? null,
      didReorder,
    });
  }, [onDragEnd, onReorder]);

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      onDragStart={({ active }) => {
        setActiveId(active.id);
        onDragStart?.({ activeId: active.id });
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={({ active }) => {
        const cancelledActiveId = active?.id ?? activeId;
        setActiveId(null);
        onDragCancel?.({ activeId: cancelledActiveId });
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          data-sortable-rearrange-list={String(activeId ?? '')}
          style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', gap }}
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
  disableSettledTransition = false,
  draggingOpacity = 0.8,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id, disabled, animateLayoutChanges });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: disableSettledTransition && !isSorting ? undefined : transition,
    opacity: isDragging ? draggingOpacity : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative',
    width: '100%',
    flexShrink: 0,
  };

  return (
    <div ref={setNodeRef} data-sortable-rearrange-item={String(id)} style={style}>
      {children({
        attributes,
        listeners,
        isDragging,
        isSorting,
      })}
    </div>
  );
}
