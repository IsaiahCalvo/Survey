import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../Icons';
import '../styles.css';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

const hexToRgba = (hex, alpha = 0.2) => {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getHexFromBallColor = (color) => {
  if (!color) return '#E3D1FB';
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return '#E3D1FB';
};

const getOpacityFromBallColor = (color) => {
  if (!color) return 100;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && match[4]) {
      const opacity = parseFloat(match[4]);
      return Math.round(opacity * 100);
    }
  }
  return 100;
};

const BallInCourtSortableRow = React.memo(function BallInCourtSortableRow({
  entity,
  selectedColorPickerId,
  onOpenColorPicker,
  onNameChange,
  onDelete,
  isAnyDragging,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entity.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative',
    width: '100%',
  };

  const isColorPickerSelected = selectedColorPickerId === entity.id;
  const currentHex = getHexFromBallColor(entity.color);
  const currentOpacity = getOpacityFromBallColor(entity.color);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '8px 10px',
          background: '#1b1b1b',
          border: '1px solid #2f2f2f',
          borderRadius: '8px',
          boxShadow: 'none',
          transition: 'border 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
        }}
      >
        <div
          {...attributes}
          {...listeners}
          data-ball-drag-handle
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: '#1f1f1f',
            border: '1px solid #2d2d2d',
            cursor: isDragging ? 'grabbing' : 'grab',
            color: '#777',
            flexShrink: 0,
            transition: 'background 0.15s ease, color 0.15s ease, border 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#bbb';
            e.currentTarget.style.background = '#262626';
            e.currentTarget.style.border = '1px solid #3a3a3a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#777';
            e.currentTarget.style.background = '#1f1f1f';
            e.currentTarget.style.border = '1px solid #2d2d2d';
          }}
          title="Drag to reorder"
        >
          <Icon name="grip" size={11} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
          <div data-color-picker-area style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div
                style={{
                  width: '40px',
                  height: '28px',
                  border: isColorPickerSelected ? '2px solid #4A90E2' : '1px solid #2f2f2f',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  position: 'relative',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  background: '#ffffff',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenColorPicker(entity.id, currentHex, currentOpacity);
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: currentHex || '#E3D1FB',
                    opacity: currentOpacity / 100,
                    mixBlendMode: 'multiply',
                    borderRadius: '5px',
                  }}
                />
              </div>
              <div style={{ fontSize: '9px', color: '#666', lineHeight: 1, textAlign: 'center', opacity: 0.7 }}>
                {currentOpacity}%
              </div>
            </div>
          </div>
          <input
            type="text"
            value={entity.name}
            onChange={(e) => onNameChange(entity.id, e.target.value)}
            placeholder="Entity name (e.g., GC, Subcontractor)"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: '#141414',
              color: '#ddd',
              border: '1px solid #2f2f2f',
              borderRadius: '6px',
              outline: 'none',
              fontSize: '13px',
              height: '28px',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <button
          data-ball-delete
          onClick={onDelete}
          title="Delete"
          className="btn btn-danger btn-icon-only btn-sm"
          style={{
            padding: '6px',
            minWidth: '28px',
            minHeight: '28px',
            flexShrink: 0,
            display: isAnyDragging ? 'none' : 'flex'
          }}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
});

function BallInCourtReorderPanel() {
  const dndContextId = useId();
  const [selectedColorPickerId, setSelectedColorPickerId] = useState(null);
  const [activeBallEntityId, setActiveBallEntityId] = useState(null);
  const [ballInCourtEntities, setBallInCourtEntities] = useState([
    { id: 'entity-1', name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
    { id: 'entity-2', name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
    { id: 'entity-3', name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
    { id: 'entity-4', name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
    { id: 'entity-5', name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) },
  ]);

  const ballSensors = useSensors(useSensor(MouseSensor, {}), useSensor(TouchSensor, {}), useSensor(KeyboardSensor, {}));
  const isAnyBallEntityDragging = Boolean(activeBallEntityId);

  useEffect(() => {
    if (isAnyBallEntityDragging) {
      document.body.classList.add('ball-in-court-dragging');
    } else {
      document.body.classList.remove('ball-in-court-dragging');
    }
    return () => {
      document.body.classList.remove('ball-in-court-dragging');
    };
  }, [isAnyBallEntityDragging]);

  const handleBallDragStart = useCallback(({ active }) => {
    setActiveBallEntityId(active.id);
  }, []);
  const handleBallDragEnd = useCallback(({ active, over }) => {
    setActiveBallEntityId(null);
    if (!over || active.id === over.id) return;
    setBallInCourtEntities((prevEntities) => {
      const oldIndex = prevEntities.findIndex((entity) => entity.id === active.id);
      const newIndex = prevEntities.findIndex((entity) => entity.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prevEntities;
      return arrayMove(prevEntities, oldIndex, newIndex);
    });
  }, []);
  const handleBallDragCancel = useCallback(() => {
    setActiveBallEntityId(null);
  }, []);

  const addBallInCourtEntity = () => {
    setBallInCourtEntities((prev) => {
      const usedNames = new Set(prev.map((entity) => normalizeName(entity?.name)).filter(Boolean));
      let counter = prev.length + 1;
      let candidateName = `Entity ${counter}`;
      while (usedNames.has(normalizeName(candidateName))) {
        counter += 1;
        candidateName = `Entity ${counter}`;
      }
      return [
        ...prev,
        {
          id: `entity-${Date.now()}-${Math.random()}`,
          name: candidateName,
          color: hexToRgba('#E3D1FB', 0.2),
        },
      ];
    });
  };

  const handleBallColorPickerOpen = (entityId) => {
    setSelectedColorPickerId(entityId);
  };

  const handleBallEntityNameChange = (entityId, name) => {
    setBallInCourtEntities((prev) => prev.map((entity) => (entity.id === entityId ? { ...entity, name } : entity)));
  };

  const handleBallEntityDelete = (entityId) => {
    setBallInCourtEntities((prev) => prev.filter((entity) => entity.id !== entityId));
    if (selectedColorPickerId === entityId) {
      setSelectedColorPickerId(null);
    }
  };

  return (
    <div
      style={{ marginTop: '16px', width: 'min(720px, 100%)', padding: '12px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px' }}
    >
      <style>{`
        body.ball-in-court-dragging [data-ball-delete] {
          display: none !important;
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Ball in Court</div>
        <button
          onClick={addBallInCourtEntity}
          className="btn btn-secondary btn-sm"
          style={{ padding: '6px 10px', fontSize: '12px' }}
        >
          + Add Entity
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Define entities and their highlight colors for responsibility tracking</div>
      <DndContext
        id={dndContextId}
        sensors={ballSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleBallDragStart}
        onDragEnd={handleBallDragEnd}
        onDragCancel={handleBallDragCancel}
      >
        <SortableContext items={ballInCourtEntities.map((entity) => entity.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ballInCourtEntities.map((entity) => (
              <BallInCourtSortableRow
                key={entity.id}
                entity={entity}
                selectedColorPickerId={selectedColorPickerId}
                onOpenColorPicker={handleBallColorPickerOpen}
                onNameChange={handleBallEntityNameChange}
                onDelete={() => handleBallEntityDelete(entity.id)}
                isAnyDragging={isAnyBallEntityDragging}
              />
            ))}
            {ballInCourtEntities.length === 0 && (
              <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic', padding: '12px' }}>
                No entities defined. Add at least one entity for Ball in Court tracking.
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

const initialBookmarks = [
  { id: 'bookmark-1', name: 'Cover Sheet', type: 'bookmark', pageIds: [1], children: [] },
  { id: 'bookmark-2', name: 'Electrical Notes', type: 'bookmark', pageIds: [4], children: [] },
  { id: 'bookmark-3', name: 'Riser Diagram', type: 'bookmark', pageIds: [8], children: [] },
  {
    id: 'folder-1',
    name: 'Installation Details',
    type: 'folder',
    pageIds: [],
    collapsed: false,
    children: [
      { id: 'bookmark-4', name: 'Panel Schedule', type: 'bookmark', pageIds: [12], children: [] },
      { id: 'bookmark-5', name: 'Lighting Controls', type: 'bookmark', pageIds: [18], children: [] },
      { id: 'bookmark-6', name: 'Device Legend', type: 'bookmark', pageIds: [24], children: [] },
    ],
  },
];

const bookmarkTreeMeasuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

const BOOKMARK_INDENTATION_WIDTH = 34;
const BOOKMARK_TREE_CONTENT_WIDTH = 404;
const GROUP_AUTO_EXPAND_DELAY_MS = 420;
const GROUP_AUTO_EXPAND_OFFSET_PX = 24;
const GROUP_COLLAPSE_ANIMATION_MS = 240;
const GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS = 70;
const GROUP_POST_COLLAPSE_LAYOUT_LOCK_MS = 260;

const getDragDepth = (offset, indentationWidth) => Math.round(offset / indentationWidth);

const flattenBookmarkTree = (items, parentId = null, depth = 0) => (
  items.reduce((acc, item, index) => [
    ...acc,
    { ...item, parentId, depth, index },
    ...flattenBookmarkTree(item.children || [], item.id, depth + 1),
  ], [])
);

const removeChildrenOf = (items, ids) => {
  const excludedParentIds = [...ids];
  return items.filter((item) => {
    if (item.parentId && excludedParentIds.includes(item.parentId)) {
      if (item.children?.length) {
        excludedParentIds.push(item.id);
      }
      return false;
    }
    return true;
  });
};

const buildBookmarkTree = (flattenedItems) => {
  const root = { id: 'root', children: [] };
  const nodes = { root };
  const items = flattenedItems.map(({ depth, index, parentId, ...item }) => ({
    ...item,
    parentId,
    children: [],
  }));

  for (const item of items) {
    const parentId = item.parentId ?? 'root';
    const parent = nodes[parentId] ?? items.find((candidate) => candidate.id === parentId) ?? root;
    delete item.parentId;
    nodes[item.id] = item;
    parent.children.push(item);
  }

  const normalizeNodeTypes = (list) => (
    list.map((item) => {
      const children = normalizeNodeTypes(item.children || []);
      return {
        ...item,
        children,
        type: children.length ? 'folder' : item.type,
        collapsed: children.length ? Boolean(item.collapsed) : undefined,
      };
    })
  );

  return normalizeNodeTypes(root.children);
};

const getBookmarkProjection = (items, activeId, overId, dragOffset, indentationWidth) => {
  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  if (overItemIndex === -1 || activeItemIndex === -1) return null;

  const activeItem = items[activeItemIndex];
  const newItems = arrayMove(items, activeItemIndex, overItemIndex);
  const previousItem = newItems[overItemIndex - 1];
  const nextItem = newItems[overItemIndex + 1];
  const canNestUnderPrevious = previousItem?.type === 'folder';
  const maxDepth = previousItem ? previousItem.depth + (canNestUnderPrevious ? 1 : 0) : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const dragDepth = getDragDepth(dragOffset, indentationWidth);
  const projectedDepth = activeItem.depth + dragDepth;
  const depth = Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  const getParentId = () => {
    if (depth === 0 || !previousItem) return null;
    if (depth === previousItem.depth) return previousItem.parentId;
    if (depth > previousItem.depth) {
      return previousItem.type === 'folder' ? previousItem.id : previousItem.parentId;
    }

    return newItems
      .slice(0, overItemIndex)
      .reverse()
      .find((item) => item.depth === depth)?.parentId ?? null;
  };

  return { depth, maxDepth, minDepth, parentId: getParentId() };
};

const getAutoExpandTargetFolder = (items, activeId, overId, dragOffset) => {
  if (dragOffset < GROUP_AUTO_EXPAND_OFFSET_PX) return null;

  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  if (overItemIndex === -1 || activeItemIndex === -1) return null;

  const reorderedItems = arrayMove(items, activeItemIndex, overItemIndex);
  const reorderedOverIndex = reorderedItems.findIndex(({ id }) => id === overId);
  const candidates = [
    items[overItemIndex],
    items[overItemIndex - 1],
    items[overItemIndex + 1],
    reorderedItems[reorderedOverIndex],
    reorderedItems[reorderedOverIndex - 1],
    reorderedItems[reorderedOverIndex + 1],
  ].filter((item, index, list) => item && list.findIndex((candidate) => candidate?.id === item.id) === index);

  return candidates.find((item) => (
    item?.type === 'folder' &&
    item.id !== activeId &&
    item.collapsed &&
    item.children?.length > 0
  )) ?? null;
};

const setTreeItemProperty = (items, id, property, setter) => (
  items.map((item) => {
    if (item.id === id) {
      return { ...item, [property]: setter(item[property]) };
    }
    if (item.children?.length) {
      return { ...item, children: setTreeItemProperty(item.children, id, property, setter) };
    }
    return item;
  })
);

const updateTreeItem = (items, id, updater) => (
  items.map((item) => {
    if (item.id === id) {
      return updater(item);
    }
    if (item.children?.length) {
      return { ...item, children: updateTreeItem(item.children, id, updater) };
    }
    return item;
  })
);

const removeTreeItem = (items, id) => (
  items
    .filter((item) => item.id !== id)
    .map((item) => ({
      ...item,
      children: item.children?.length ? removeTreeItem(item.children, id) : [],
    }))
);

function BookmarkTreeRow({
  item,
  depth,
  projectedDepth,
  activeDepth,
  isEditMode = false,
  isClone = false,
  isDraggingAny = false,
  isVisuallyCollapsed = false,
  groupAnimationState = null,
  isGroupAnimationActive = false,
  childCount = 0,
  onToggle,
  onRename,
  onPageChange,
  onAddChild,
  onDelete,
}) {
  const {
    attributes,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({
    id: item.id,
    animateLayoutChanges: ({ isSorting, wasDragging }) => (
      isSorting || wasDragging || groupAnimationState || isGroupAnimationActive ? false : true
    ),
  });

  const rowDepth = projectedDepth ?? depth;
  const isFolder = item.type === 'folder';
  const isCollapsed = isFolder && item.collapsed && item.children?.length;
  const handleProps = isClone ? {} : { ...attributes, ...listeners };
  const rowInset = rowDepth * BOOKMARK_INDENTATION_WIDTH;
  const cloneBaseInset = isClone ? (activeDepth ?? depth) * BOOKMARK_INDENTATION_WIDTH : 0;
  const cloneRelativeInset = isClone ? (rowDepth - (activeDepth ?? depth)) * BOOKMARK_INDENTATION_WIDTH : 0;
  const cloneWidth = BOOKMARK_TREE_CONTENT_WIDTH - cloneBaseInset;
  const dragTranslateY = transform?.y ?? 0;
  const isActiveRow = isDragging && !isClone;
  const sortableTransform = isActiveRow
    ? CSS.Translate.toString({ x: 0, y: dragTranslateY, scaleX: 1, scaleY: 1 })
    : isGroupAnimationActive
      ? undefined
      : CSS.Translate.toString(transform);
  const fixedRightInset = isActiveRow
    ? Math.max(0, (rowDepth - (activeDepth ?? depth)) * BOOKMARK_INDENTATION_WIDTH)
    : 0;

  const row = (
    <div
      ref={isClone ? undefined : setDroppableNodeRef}
      data-bookmark-row-id={isClone ? undefined : item.id}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '2px 0',
        opacity: isDragging && !isClone ? 0.32 : 1,
        position: 'relative',
        width: isClone ? `${cloneWidth}px` : isActiveRow ? `${BOOKMARK_TREE_CONTENT_WIDTH}px` : 'auto',
        boxSizing: 'border-box',
        marginLeft: (isClone || isActiveRow) ? undefined : `${rowInset}px`,
        paddingLeft: 0,
        overflow: groupAnimationState ? 'hidden' : undefined,
        transition: isClone ? 'padding-left 120ms ease-out' : undefined,
        transformOrigin: 'top center',
        animation: groupAnimationState === 'expanding'
          ? `bookmarkGroupExpand ${GROUP_COLLAPSE_ANIMATION_MS}ms ease-out both`
          : groupAnimationState === 'collapsing'
            ? `bookmarkGroupCollapse ${GROUP_COLLAPSE_ANIMATION_MS}ms ease-in both`
            : undefined,
      }}
    >
        <div
          ref={isClone ? undefined : setDraggableNodeRef}
          style={{
            transform: isClone ? undefined : sortableTransform,
          transition: groupAnimationState || isGroupAnimationActive ? undefined : transition,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 34,
          padding: '4px 6px',
          borderRadius: 6,
          background: isClone ? '#2b2b2b' : '#252525',
          border: '1px solid #333',
          color: '#ddd',
          boxShadow: isClone ? '0 12px 24px rgba(0,0,0,0.32)' : 'none',
          pointerEvents: isSorting ? 'none' : undefined,
          marginLeft: isClone ? `${cloneRelativeInset}px` : isActiveRow ? `${rowInset}px` : undefined,
          width: isClone
            ? `calc(100% - ${cloneRelativeInset}px)`
            : isActiveRow
              ? `calc(100% - ${rowInset + fixedRightInset}px)`
              : '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          {...handleProps}
          title="Drag to reorder"
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            cursor: isDraggingAny ? 'grabbing' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
            flexShrink: 0,
          }}
        >
          ☰
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.(item.id);
          }}
          disabled={!isFolder || !item.children?.length || isClone}
          title={(isCollapsed || isVisuallyCollapsed) ? 'Expand group' : 'Collapse group'}
          style={{
            width: 20,
            height: 20,
            border: 0,
            padding: 0,
            background: 'transparent',
            color: isFolder && item.children?.length ? '#aaa' : 'transparent',
            cursor: isFolder && item.children?.length && !isClone ? 'pointer' : 'default',
            transform: (isCollapsed || isVisuallyCollapsed) ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: `transform ${GROUP_COLLAPSE_ANIMATION_MS}ms ease`,
            flexShrink: 0,
          }}
        >
          ▾
        </button>
        <Icon name={isFolder ? 'folder' : 'bookmark'} size={13} color={isFolder ? '#8fb7ff' : '#aaa'} />
        {isEditMode && !isClone ? (
          <input
            value={item.name}
            onChange={(event) => onRename?.(item.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              background: '#1b1b1b',
              border: '1px solid #3a3a3a',
              color: '#ddd',
              borderRadius: 5,
              height: 24,
              padding: '0 7px',
              fontSize: 12,
              outline: 'none',
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: '#ddd',
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {item.name}
          </span>
        )}
        {!isFolder && (
          isEditMode && !isClone ? (
            <input
              value={item.pageIds?.[0] ?? ''}
              onChange={(event) => onPageChange?.(item.id, event.target.value)}
              onClick={(event) => event.stopPropagation()}
              inputMode="numeric"
              pattern="[0-9]*"
              style={{
                width: 34,
                background: '#1b1b1b',
                border: '1px solid #3a3a3a',
                color: '#ddd',
                borderRadius: 5,
                height: 24,
                padding: '0 6px',
                fontSize: 12,
                textAlign: 'center',
                outline: 'none',
              }}
            />
          ) : (
            item.pageIds?.[0] ? (
              <span
                style={{
                  width: 56,
                  color: '#aaa',
                  fontSize: 12,
                  textAlign: 'right',
                  flexShrink: 0,
                  userSelect: 'none',
                }}
              >
                Page {item.pageIds[0]}
              </span>
            ) : null
          )
        )}
        {isFolder && !isClone && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddChild?.(item.id);
            }}
            title="Add bookmark to group"
            style={{
              width: 34,
              height: 24,
              background: '#1b1b1b',
              border: '1px solid #3a3a3a',
              color: '#8fb7ff',
              borderRadius: 5,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = '#223147';
              event.currentTarget.style.border = '1px solid #4A90E2';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = '#1b1b1b';
              event.currentTarget.style.border = '1px solid #3a3a3a';
            }}
          >
            <Icon name="plus" size={12} color="#8fb7ff" />
          </button>
        )}
        {isEditMode && !isClone && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete?.(item.id);
            }}
            title="Delete"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 4px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = '#3a1f1f';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
          >
            <Icon name="trash" size={12} color="#ff6b6b" />
          </button>
        )}
        {isClone && childCount > 1 && (
          <span style={{
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            background: '#4A90E2',
            color: '#fff',
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
          }}>
            {childCount}
          </span>
        )}
      </div>
    </div>
  );

  return row;
}

const countTreeChildren = (items, id) => {
  const find = (list) => {
    for (const item of list) {
      if (item.id === id) return item;
      const child = find(item.children || []);
      if (child) return child;
    }
    return null;
  };
  const count = (list) => list.reduce((sum, item) => sum + 1 + count(item.children || []), 0);
  const item = find(items);
  return item ? count(item.children || []) : 0;
};

function BookmarkReorderPanel() {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [dragMotionTick, setDragMotionTick] = useState(0);
  const [collapsingFolderIds, setCollapsingFolderIds] = useState([]);
  const [expandingFolderIds, setExpandingFolderIds] = useState([]);
  const [collapseLayoutLock, setCollapseLayoutLock] = useState(false);
  const autoExpandTimerRef = useRef(null);
  const autoExpandFolderRef = useRef(null);
  const autoExpandedFoldersRef = useRef(new Set());
  const pointerPositionRef = useRef(null);
  const pointerMoveListenerRef = useRef(null);
  const nextBookmarkIdRef = useRef(7);
  const collapseTimeoutsRef = useRef(new Map());
  const expandTimeoutsRef = useRef(new Map());
  const collapseLayoutLockTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (collapseLayoutLockTimeoutRef.current) {
      clearTimeout(collapseLayoutLockTimeoutRef.current);
    }
  }, []);

  const flattenedItems = useMemo(() => {
    const flattenedTree = flattenBookmarkTree(bookmarks);
    const collapsedItems = flattenedTree.reduce((acc, { children, collapsed, id }) => (
      collapsed && children?.length ? [...acc, id] : acc
    ), []);
    return removeChildrenOf(flattenedTree, activeId ? [activeId, ...collapsedItems] : collapsedItems);
  }, [activeId, bookmarks]);

  const projected = activeId && overId
    ? getBookmarkProjection(flattenedItems, activeId, overId, offsetLeft, BOOKMARK_INDENTATION_WIDTH)
    : null;
  const sortedIds = useMemo(() => flattenedItems.map(({ id }) => id), [flattenedItems]);
  const activeItem = activeId ? flattenedItems.find(({ id }) => id === activeId) : null;
  const sensors = useSensors(useSensor(PointerSensor, {}), useSensor(KeyboardSensor, {}));
  const restrictPastRootLeft = useMemo(() => ({ transform }) => {
    const minimumX = -((activeItem?.depth ?? 0) * BOOKMARK_INDENTATION_WIDTH);
    return {
      ...transform,
      x: Math.max(transform.x, minimumX),
    };
  }, [activeItem?.depth]);
  const lockBookmarkTreeHorizontalVisual = useMemo(() => ({ transform }) => ({
    ...transform,
    x: 0,
  }), []);

  const visibleItemById = useMemo(() => (
    new Map(flattenedItems.map((item) => [item.id, item]))
  ), [flattenedItems]);

  const getGroupAnimationState = useCallback((item) => {
    let currentParentId = item.parentId;
    while (currentParentId) {
      if (collapsingFolderIds.includes(currentParentId)) return 'collapsing';
      if (expandingFolderIds.includes(currentParentId)) return 'expanding';
      currentParentId = visibleItemById.get(currentParentId)?.parentId;
    }
    return null;
  }, [collapsingFolderIds, expandingFolderIds, visibleItemById]);

  const animateCollapseFolders = useCallback((folderIds) => {
    const uniqueFolderIds = [...new Set(folderIds.filter(Boolean))];
    if (!uniqueFolderIds.length) return;

    setExpandingFolderIds((ids) => ids.filter((folderId) => !uniqueFolderIds.includes(folderId)));
    setCollapsingFolderIds((ids) => [...new Set([...ids, ...uniqueFolderIds])]);

    uniqueFolderIds.forEach((folderId) => {
      const pendingCollapse = collapseTimeoutsRef.current.get(folderId);
      if (pendingCollapse) {
        clearTimeout(pendingCollapse);
      }

      const timeout = setTimeout(() => {
        if (collapseLayoutLockTimeoutRef.current) {
          clearTimeout(collapseLayoutLockTimeoutRef.current);
        }
        setCollapseLayoutLock(true);
        setBookmarks((items) => setTreeItemProperty(items, folderId, 'collapsed', () => true));
        setCollapsingFolderIds((ids) => ids.filter((id) => id !== folderId));
        collapseTimeoutsRef.current.delete(folderId);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            collapseLayoutLockTimeoutRef.current = setTimeout(() => {
              setCollapseLayoutLock(false);
              collapseLayoutLockTimeoutRef.current = null;
            }, GROUP_POST_COLLAPSE_LAYOUT_LOCK_MS);
          });
        });
      }, GROUP_COLLAPSE_ANIMATION_MS);

      collapseTimeoutsRef.current.set(folderId, timeout);
    });
  }, []);

  const handleCollapse = useCallback((id) => {
    const item = visibleItemById.get(id);
    const isCollapsed = Boolean(item?.collapsed);

    if (isCollapsed) {
      const pendingCollapse = collapseTimeoutsRef.current.get(id);
      if (pendingCollapse) {
        clearTimeout(pendingCollapse);
        collapseTimeoutsRef.current.delete(id);
      }
      setCollapsingFolderIds((ids) => ids.filter((folderId) => folderId !== id));
      setBookmarks((items) => setTreeItemProperty(items, id, 'collapsed', () => false));
      setExpandingFolderIds((ids) => [...new Set([...ids, id])]);
      const timeout = setTimeout(() => {
        setExpandingFolderIds((ids) => ids.filter((folderId) => folderId !== id));
        expandTimeoutsRef.current.delete(id);
      }, GROUP_COLLAPSE_ANIMATION_MS);
      expandTimeoutsRef.current.set(id, timeout);
      return;
    }

    animateCollapseFolders([id]);
  }, [animateCollapseFolders, visibleItemById]);

  useEffect(() => () => {
    collapseTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    expandTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
  }, []);

  const handleRename = useCallback((id, name) => {
    setBookmarks((items) => updateTreeItem(items, id, (item) => ({ ...item, name })));
  }, []);

  const handlePageChange = useCallback((id, value) => {
    const numericValue = value.replace(/[^\d]/g, '');
    setBookmarks((items) => updateTreeItem(items, id, (item) => ({
      ...item,
      pageIds: numericValue ? [Number(numericValue)] : [],
    })));
  }, []);

  const handleAddChildBookmark = useCallback((folderId) => {
    const nextId = nextBookmarkIdRef.current;
    nextBookmarkIdRef.current += 1;

    setBookmarks((items) => updateTreeItem(items, folderId, (item) => ({
      ...item,
      type: 'folder',
      collapsed: false,
      children: [
        ...(item.children || []),
        {
          id: `bookmark-${nextId}`,
          name: 'New Bookmark',
          type: 'bookmark',
          pageIds: [],
          children: [],
        },
      ],
    })));
  }, []);

  const handleDelete = useCallback((id) => {
    setBookmarks((items) => removeTreeItem(items, id));
  }, []);

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandFolderRef.current = null;
  }, []);

  const getAutoExpandTargetFromPointer = useCallback(() => {
    if (offsetLeft < GROUP_AUTO_EXPAND_OFFSET_PX || !pointerPositionRef.current) return null;

    const { y } = pointerPositionRef.current;
    const candidates = flattenedItems
      .filter((item) => (
        item.id !== activeId &&
        item.type === 'folder' &&
        item.collapsed &&
        item.children?.length > 0
      ))
      .map((item) => {
        const element = document.querySelector(`[data-bookmark-row-id="${item.id}"]`);
        const rect = element?.getBoundingClientRect();
        if (!rect) return null;
        const topZone = rect.top - 14;
        const bottomZone = rect.bottom + 30;
        if (y < topZone || y > bottomZone) return null;
        return {
          item,
          distance: Math.abs(y - (rect.top + rect.height / 2)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    return candidates[0]?.item ?? null;
  }, [activeId, flattenedItems, offsetLeft]);

  const handleDragStart = useCallback(({ active, activatorEvent }) => {
    setActiveId(active.id);
    setOverId(active.id);
    setDragMotionTick(0);
    autoExpandedFoldersRef.current.clear();
    if (typeof activatorEvent?.clientX === 'number' && typeof activatorEvent?.clientY === 'number') {
      pointerPositionRef.current = {
        x: activatorEvent.clientX,
        y: activatorEvent.clientY,
      };
    }
    pointerMoveListenerRef.current = (event) => {
      pointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };
    window.addEventListener('pointermove', pointerMoveListenerRef.current, { passive: true });
    window.addEventListener('mousemove', pointerMoveListenerRef.current, { passive: true });
    document.body.style.setProperty('cursor', 'grabbing');
  }, []);

  const handleDragMove = useCallback(({ delta }) => {
    setOffsetLeft(delta.x);
    setDragMotionTick((value) => value + 1);
  }, []);

  const handleDragOver = useCallback(({ over }) => {
    setOverId(over?.id ?? null);
  }, []);

  const resetDragState = useCallback(() => {
    clearAutoExpandTimer();
    if (pointerMoveListenerRef.current) {
      window.removeEventListener('pointermove', pointerMoveListenerRef.current);
      window.removeEventListener('mousemove', pointerMoveListenerRef.current);
      pointerMoveListenerRef.current = null;
    }
    pointerPositionRef.current = null;
    autoExpandedFoldersRef.current.clear();
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
    setDragMotionTick(0);
    document.body.style.setProperty('cursor', '');
  }, [clearAutoExpandTimer]);

  const handleDragEnd = useCallback(({ active, over }) => {
    const autoExpandedFolderIds = Array.from(autoExpandedFoldersRef.current);
    const finalParentId = projected?.parentId ?? null;
    const foldersToRecollapse = autoExpandedFolderIds.filter((folderId) => folderId !== finalParentId);
    if (projected && over) {
      const { depth, parentId } = projected;
      setBookmarks((items) => {
        const clonedItems = JSON.parse(JSON.stringify(flattenBookmarkTree(items)));
        const overIndex = clonedItems.findIndex(({ id }) => id === over.id);
        const activeIndex = clonedItems.findIndex(({ id }) => id === active.id);
        if (overIndex === -1 || activeIndex === -1) return items;
        clonedItems[activeIndex] = { ...clonedItems[activeIndex], depth, parentId };
        return buildBookmarkTree(arrayMove(clonedItems, activeIndex, overIndex));
      });
    }
    resetDragState();
    if (foldersToRecollapse.length) {
      setTimeout(() => {
        animateCollapseFolders(foldersToRecollapse);
      }, GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS);
    }
  }, [animateCollapseFolders, projected, resetDragState]);

  const handleDragCancel = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

  useEffect(() => {
    window.__REORDER_PLAYGROUND_BOOKMARK_TREE__ = bookmarks;
  }, [bookmarks]);

  useEffect(() => {
    if (!activeId) {
      clearAutoExpandTimer();
      return;
    }

    const autoExpandTarget = (
      (overId && activeId !== overId
        ? getAutoExpandTargetFolder(flattenedItems, activeId, overId, offsetLeft)
        : null) ??
      getAutoExpandTargetFromPointer()
    );
    const canAutoExpand = (
      autoExpandTarget &&
      autoExpandTarget.id !== activeId
    );

    if (!canAutoExpand) {
      clearAutoExpandTimer();
      return;
    }

    if (autoExpandFolderRef.current === autoExpandTarget.id) {
      return;
    }

    clearAutoExpandTimer();
    autoExpandFolderRef.current = autoExpandTarget.id;
    autoExpandTimerRef.current = setTimeout(() => {
      autoExpandedFoldersRef.current.add(autoExpandTarget.id);
      setBookmarks((items) => setTreeItemProperty(items, autoExpandTarget.id, 'collapsed', () => false));
      autoExpandTimerRef.current = null;
      autoExpandFolderRef.current = null;
    }, GROUP_AUTO_EXPAND_DELAY_MS);
  }, [activeId, overId, offsetLeft, dragMotionTick, flattenedItems, clearAutoExpandTimer, getAutoExpandTargetFromPointer]);

  useEffect(() => clearAutoExpandTimer, [clearAutoExpandTimer]);

  return (
    <div style={{ width: 420, minHeight: 520, border: '1px solid #3a3a3a', background: '#252525', overflow: 'hidden', fontFamily: FONT_FAMILY }}>
      <div style={{ padding: 12, borderBottom: '1px solid #3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Bookmarks</div>
        <button
          onClick={() => setIsEditMode((value) => !value)}
          style={{
            background: isEditMode ? '#4A90E2' : '#3a3a3a',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: FONT_FAMILY,
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = isEditMode ? '#357abd' : '#444';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = isEditMode ? '#4A90E2' : '#3a3a3a';
          }}
        >
          <Icon name="edit" size={12} color="#fff" />
          {isEditMode ? 'Done' : 'Edit'}
        </button>
      </div>
      <style>{`
        @keyframes bookmarkGroupExpand {
          from {
            opacity: 0;
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
          }
          to {
            opacity: 1;
            max-height: 40px;
            padding-top: 2px;
            padding-bottom: 2px;
          }
        }

        @keyframes bookmarkGroupCollapse {
          from {
            opacity: 1;
            max-height: 40px;
            padding-top: 2px;
            padding-bottom: 2px;
          }
          to {
            opacity: 0;
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
          }
        }
      `}</style>
      <div style={{ padding: 8 }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictPastRootLeft]}
          measuring={bookmarkTreeMeasuring}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            <div style={{ margin: 0, padding: 0 }}>
              {flattenedItems.map((item) => (
                <BookmarkTreeRow
                  key={item.id}
                  item={item}
                  depth={item.depth}
                  projectedDepth={item.id === activeId && projected ? projected.depth : null}
                  activeDepth={activeItem?.depth}
                  isEditMode={isEditMode}
                  isDraggingAny={Boolean(activeId)}
                  isVisuallyCollapsed={collapsingFolderIds.includes(item.id)}
                  groupAnimationState={getGroupAnimationState(item)}
                  isGroupAnimationActive={collapseLayoutLock || collapsingFolderIds.length > 0 || expandingFolderIds.length > 0}
                  onToggle={handleCollapse}
                  onRename={handleRename}
                  onPageChange={handlePageChange}
                  onAddChild={handleAddChildBookmark}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay modifiers={[lockBookmarkTreeHorizontalVisual]} dropAnimation={null}>
            {activeItem ? (
              <BookmarkTreeRow
                item={activeItem}
                depth={projected ? projected.depth : activeItem.depth}
                activeDepth={activeItem.depth}
                isEditMode={isEditMode}
                isClone
                isDraggingAny
                childCount={countTreeChildren(bookmarks, activeItem.id) + 1}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

function ReorderPlayground() {
  const [activeTab, setActiveTab] = useState('entities');
  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0b', color: '#eaeaea', fontFamily: FONT_FAMILY, padding: 32 }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #262626', marginBottom: 28 }}>
          {[
            ['entities', 'Ball in Court'],
            ['bookmarks', 'PDF Bookmarks'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                border: 0,
                borderBottom: activeTab === id ? '2px solid #4A90E2' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === id ? '#fff' : '#999',
                padding: '10px 12px',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {activeTab === 'entities' ? <BallInCourtReorderPanel /> : <BookmarkReorderPanel />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ReorderPlayground />);
