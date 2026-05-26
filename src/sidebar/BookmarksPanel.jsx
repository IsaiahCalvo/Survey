import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../Icons';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const BOOKMARK_INDENTATION_WIDTH = 34;
const BOOKMARK_TREE_CONTENT_WIDTH = 404;
const GROUP_AUTO_EXPAND_DELAY_MS = 420;
const GROUP_AUTO_EXPAND_OFFSET_PX = 24;
const GROUP_COLLAPSE_ANIMATION_MS = 240;
const GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS = 70;
const GROUP_POST_COLLAPSE_LAYOUT_LOCK_MS = 260;
const bookmarkTreeMeasuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

// Helper to generate unique IDs
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});

const getDragDepth = (offset, indentationWidth) => Math.round(offset / indentationWidth);

const flattenBookmarkTreeForSort = (items, parentId = null, depth = 0) => (
  items.reduce((acc, item, index) => [
    ...acc,
    { ...item, parentId, depth, index },
    ...flattenBookmarkTreeForSort(item.children || [], item.id, depth + 1),
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

const buildSortableBookmarkTree = (flattenedItems) => {
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

  return root.children.map((item) => ({
    ...item,
    children: item.children || [],
  }));
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

const BookmarkTreeRow = ({
  item,
  depth,
  projectedDepth,
  activeDepth,
  isEditMode,
  isClone = false,
  isDraggingAny = false,
  isVisuallyCollapsed = false,
  groupAnimationState = null,
  isGroupAnimationActive = false,
  childCount = 0,
  isSelected = false,
  numPages,
  onToggle,
  onNavigate,
  onSelect,
  onRename,
  onPageChange,
  onAddChild,
  onDelete,
}) => {
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

  const [editName, setEditName] = React.useState(item.name || '');
  const [editPage, setEditPage] = React.useState(item.pageIds?.[0]?.toString() ?? '');

  React.useEffect(() => {
    setEditName(item.name || '');
  }, [item.name]);

  React.useEffect(() => {
    setEditPage(item.pageIds?.[0]?.toString() ?? '');
  }, [item.pageIds]);

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

  const commitName = () => {
    const nextName = editName.trim();
    if (nextName && nextName !== item.name) {
      onRename?.(item.id, nextName);
    } else {
      setEditName(item.name || '');
    }
  };

  const handlePageInputChange = (value) => {
    const sanitized = value.replace(/[^\d]/g, '');
    if (!sanitized) {
      setEditPage('');
      return;
    }
    const numericValue = parseInt(sanitized, 10);
    if (Number.isNaN(numericValue) || numericValue < 1) {
      setEditPage('');
      return;
    }
    setEditPage(numPages && numericValue > numPages ? numPages.toString() : numericValue.toString());
  };

  const commitPage = () => {
    const originalPage = item.pageIds?.[0]?.toString() ?? '';
    const trimmedValue = editPage.trim();
    if (!trimmedValue) {
      setEditPage(originalPage);
      return;
    }

    const pageNumber = parseInt(trimmedValue, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1 || (numPages && pageNumber > numPages)) {
      alert(numPages ? `Please enter a page number between 1 and ${numPages}.` : 'Please enter a valid page number.');
      setEditPage(originalPage);
      return;
    }

    if (item.pageIds?.[0] !== pageNumber) {
      onPageChange?.(item.id, pageNumber);
    }
  };

  return (
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
        onClick={() => {
          if (isClone || isEditMode) return;
          onSelect?.(item.id);
          if (!isFolder) onNavigate?.(item);
        }}
        style={{
          transform: isClone ? undefined : sortableTransform,
          transition: groupAnimationState || isGroupAnimationActive ? undefined : transition,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 34,
          padding: '4px 6px',
          borderRadius: 6,
          background: isClone ? '#2b2b2b' : isSelected ? '#30343a' : '#252525',
          border: '1px solid #333',
          color: '#ddd',
          boxShadow: isClone ? '0 12px 24px rgba(0,0,0,0.32)' : 'none',
          cursor: isEditMode ? 'default' : 'pointer',
          pointerEvents: isSorting ? 'none' : undefined,
          marginLeft: isClone ? `${cloneRelativeInset}px` : isActiveRow ? `${rowInset}px` : undefined,
          width: isClone
            ? `calc(100% - ${cloneRelativeInset}px)`
            : isActiveRow
              ? `calc(100% - ${rowInset + fixedRightInset}px)`
              : '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(event) => {
          if (!isSelected && !isClone) event.currentTarget.style.background = '#2b2b2b';
        }}
        onMouseLeave={(event) => {
          if (!isSelected && !isClone) event.currentTarget.style.background = '#252525';
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
          onClick={(event) => event.stopPropagation()}
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
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setEditName(item.name || '');
                event.currentTarget.blur();
              }
            }}
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
              fontFamily: FONT_FAMILY,
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
              value={editPage}
              onChange={(event) => handlePageInputChange(event.target.value)}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitPage();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  setEditPage(item.pageIds?.[0]?.toString() ?? '');
                  event.currentTarget.blur();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              inputMode="numeric"
              pattern="[0-9]*"
              style={{
                width: 38,
                background: '#1b1b1b',
                border: '1px solid #3a3a3a',
                color: '#ddd',
                borderRadius: 5,
                height: 24,
                padding: '0 6px',
                fontSize: 12,
                textAlign: 'center',
                outline: 'none',
                fontFamily: FONT_FAMILY,
              }}
            />
          ) : (
            item.pageIds?.[0] ? (
              <span style={{ width: 56, color: '#aaa', fontSize: 12, textAlign: 'right', flexShrink: 0, userSelect: 'none' }}>
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
          >
            <Icon name="plus" size={12} color="#8fb7ff" />
          </button>
        )}
        {isEditMode && !isClone && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm(`Delete ${isFolder ? 'group' : 'bookmark'} "${item.name}"?`)) {
                onDelete?.(item.id);
              }
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
};

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

const BookmarksPanel = ({
  bookmarks,
  onBookmarkCreate,
  onBookmarkUpdate,
  onBookmarkDelete,
  onNavigateToPage,
  pageNum,
  numPages,
  initialEditMode = false,
  initialExpandedFolders = [],
  rowDragFeel = false
}) => {
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(initialExpandedFolders));
  const [selectedBookmarkId, setSelectedBookmarkId] = useState(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [newBookmarkName, setNewBookmarkName] = useState('');
  const [newBookmarkPages, setNewBookmarkPages] = useState('');
  const [showBookmarkGroupModal, setShowBookmarkGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupBookmarks, setGroupBookmarks] = useState([]);
  const [showAddToGroupModal, setShowAddToGroupModal] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState(null);
  const [addToGroupBookmarks, setAddToGroupBookmarks] = useState([]);
  const menuRef = useRef(null);

  // Drag-and-drop state
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [dragMotionTick, setDragMotionTick] = useState(0);
  const [collapsingFolderIds, setCollapsingFolderIds] = useState([]);
  const [expandingFolderIds, setExpandingFolderIds] = useState([]);
  const [collapseLayoutLock, setCollapseLayoutLock] = useState(false);

  const collapseTimeoutsRef = useRef(new Map());
  const expandTimeoutsRef = useRef(new Map());
  const collapseLayoutLockTimeoutRef = useRef(null);
  const autoExpandedFoldersRef = useRef(new Set());
  const autoExpandTimerRef = useRef(null);
  const autoExpandFolderRef = useRef(null);
  const pointerPositionRef = useRef(null);
  const pointerMoveListenerRef = useRef(null);

  const sensors = useSensors(useSensor(PointerSensor, {}), useSensor(KeyboardSensor, {}));

  // Build hierarchical tree from flat bookmarks array
  const buildTree = useCallback((items) => {
    if (!items || !Array.isArray(items)) {
      return [];
    }

    const itemMap = new Map();
    const rootItems = [];

    items.forEach(item => {
      if (item && item.id && item.name && item.name.trim()) {
        itemMap.set(item.id, { ...item, children: [] });
      }
    });

    items.forEach(item => {
      if (!item || !item.id) return;

      const node = itemMap.get(item.id);
      if (!node) return;

      if (item.parentId) {
        const parent = itemMap.get(item.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          rootItems.push(node);
        }
      } else {
        rootItems.push(node);
      }
    });

    // Sort by order
    const sortByOrder = (a, b) => (a.order || 0) - (b.order || 0);
    rootItems.sort(sortByOrder);
    rootItems.forEach(item => {
      if (item.children && item.children.length > 0) {
        item.children.sort(sortByOrder);
      }
    });

    return rootItems;
  }, []);

  const bookmarkTree = useMemo(() => {
    const applyCollapseState = (items) => items.map((item) => {
      const children = applyCollapseState(item.children || []);
      return {
        ...item,
        children,
        collapsed: item.type === 'folder' && children.length ? !expandedFolders.has(item.id) : undefined,
      };
    });
    return applyCollapseState(buildTree(bookmarks || []));
  }, [bookmarks, buildTree, expandedFolders]);

  const flattenedItems = useMemo(() => {
    const flattenedTree = flattenBookmarkTreeForSort(bookmarkTree);
    const collapsedItems = flattenedTree.reduce((acc, { children, collapsed, id }) => (
      collapsed && children?.length ? [...acc, id] : acc
    ), []);
    return removeChildrenOf(flattenedTree, activeId ? [activeId, ...collapsedItems] : collapsedItems);
  }, [activeId, bookmarkTree]);

  const projected = activeId && overId
    ? getBookmarkProjection(flattenedItems, activeId, overId, offsetLeft, BOOKMARK_INDENTATION_WIDTH)
    : null;
  const sortedIds = useMemo(() => flattenedItems.map(({ id }) => id), [flattenedItems]);
  const activeSortableItem = activeId ? flattenedItems.find(({ id }) => id === activeId) : null;

  // Find item in tree
  const findItem = useCallback((id, list, parent = null) => {
    for (let i = 0; i < list.length; i += 1) {
      const current = list[i];
      if (current.id === id) {
        return { item: current, index: i, list, parent };
      }
      if (current.type === 'folder' && current.children) {
        const found = findItem(id, current.children, current);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandFolderRef.current = null;
  }, []);

  const getGroupAnimationState = useCallback((item) => {
    let currentParentId = item.parentId;
    while (currentParentId) {
      if (collapsingFolderIds.includes(currentParentId)) return 'collapsing';
      if (expandingFolderIds.includes(currentParentId)) return 'expanding';
      currentParentId = flattenedItems.find((candidate) => candidate.id === currentParentId)?.parentId;
    }
    return null;
  }, [collapsingFolderIds, expandingFolderIds, flattenedItems]);

  const animateCollapseFolders = useCallback((folderIds) => {
    const uniqueFolderIds = [...new Set(folderIds.filter(Boolean))];
    if (!uniqueFolderIds.length) return;

    setExpandingFolderIds((ids) => ids.filter((folderId) => !uniqueFolderIds.includes(folderId)));
    setCollapsingFolderIds((ids) => [...new Set([...ids, ...uniqueFolderIds])]);

    uniqueFolderIds.forEach((folderId) => {
      const pendingCollapse = collapseTimeoutsRef.current.get(folderId);
      if (pendingCollapse) clearTimeout(pendingCollapse);

      const timeout = setTimeout(() => {
        if (collapseLayoutLockTimeoutRef.current) clearTimeout(collapseLayoutLockTimeoutRef.current);
        setCollapseLayoutLock(true);
        setExpandedFolders((prev) => {
          if (!prev.has(folderId)) return prev;
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
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

  const toggleExpand = useCallback((folderId) => {
    if (expandedFolders.has(folderId)) {
      animateCollapseFolders([folderId]);
      return;
    }

    const pendingCollapse = collapseTimeoutsRef.current.get(folderId);
    if (pendingCollapse) {
      clearTimeout(pendingCollapse);
      collapseTimeoutsRef.current.delete(folderId);
    }
    setCollapsingFolderIds((ids) => ids.filter((id) => id !== folderId));
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
    setExpandingFolderIds((ids) => [...new Set([...ids, folderId])]);
    const timeout = setTimeout(() => {
      setExpandingFolderIds((ids) => ids.filter((id) => id !== folderId));
      expandTimeoutsRef.current.delete(folderId);
    }, GROUP_COLLAPSE_ANIMATION_MS);
    expandTimeoutsRef.current.set(folderId, timeout);
  }, [animateCollapseFolders, expandedFolders]);

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
        return { item, distance: Math.abs(y - (rect.top + rect.height / 2)) };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    return candidates[0]?.item ?? null;
  }, [activeId, flattenedItems, offsetLeft]);

  const persistBookmarkTree = useCallback((nextTree) => {
    if (!onBookmarkUpdate) return;
    flattenBookmarkTreeForSort(nextTree).forEach((item) => {
      onBookmarkUpdate(item.id, {
        order: item.index,
        parentId: item.parentId ?? null,
      });
    });
  }, [onBookmarkUpdate]);

  const handleDragStart = useCallback(({ active, activatorEvent }) => {
    setActiveId(active.id);
    setOverId(active.id);
    setDragMotionTick(0);
    autoExpandedFoldersRef.current.clear();
    if (typeof activatorEvent?.clientX === 'number' && typeof activatorEvent?.clientY === 'number') {
      pointerPositionRef.current = { x: activatorEvent.clientX, y: activatorEvent.clientY };
    }
    pointerMoveListenerRef.current = (event) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
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
      const clonedItems = JSON.parse(JSON.stringify(flattenBookmarkTreeForSort(bookmarkTree)));
      const overIndex = clonedItems.findIndex(({ id }) => id === over.id);
      const activeIndex = clonedItems.findIndex(({ id }) => id === active.id);
      if (overIndex !== -1 && activeIndex !== -1) {
        clonedItems[activeIndex] = { ...clonedItems[activeIndex], depth, parentId };
        const nextTree = buildSortableBookmarkTree(arrayMove(clonedItems, activeIndex, overIndex));
        persistBookmarkTree(nextTree);
        if (parentId) {
          setExpandedFolders((prev) => {
            const next = new Set(prev);
            next.add(parentId);
            return next;
          });
        }
      }
    }

    resetDragState();
    if (foldersToRecollapse.length) {
      setTimeout(() => {
        animateCollapseFolders(foldersToRecollapse);
      }, GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS);
    }
  }, [animateCollapseFolders, bookmarkTree, persistBookmarkTree, projected, resetDragState]);

  const handleDragCancel = useCallback(() => {
    const foldersToRecollapse = Array.from(autoExpandedFoldersRef.current);
    resetDragState();
    animateCollapseFolders(foldersToRecollapse);
  }, [animateCollapseFolders, resetDragState]);

  useEffect(() => () => {
    clearAutoExpandTimer();
    collapseTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    expandTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    if (collapseLayoutLockTimeoutRef.current) clearTimeout(collapseLayoutLockTimeoutRef.current);
  }, [clearAutoExpandTimer]);

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

    if (!autoExpandTarget || autoExpandTarget.id === activeId) {
      clearAutoExpandTimer();
      return;
    }

    if (autoExpandFolderRef.current === autoExpandTarget.id) return;

    clearAutoExpandTimer();
    autoExpandFolderRef.current = autoExpandTarget.id;
    autoExpandTimerRef.current = setTimeout(() => {
      autoExpandedFoldersRef.current.add(autoExpandTarget.id);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(autoExpandTarget.id);
        return next;
      });
      setExpandingFolderIds((ids) => [...new Set([...ids, autoExpandTarget.id])]);
      setTimeout(() => {
        setExpandingFolderIds((ids) => ids.filter((id) => id !== autoExpandTarget.id));
      }, GROUP_COLLAPSE_ANIMATION_MS);
      autoExpandTimerRef.current = null;
      autoExpandFolderRef.current = null;
    }, GROUP_AUTO_EXPAND_DELAY_MS);
  }, [activeId, clearAutoExpandTimer, dragMotionTick, flattenedItems, getAutoExpandTargetFromPointer, offsetLeft, overId]);

  const handleNavigate = useCallback((pageRef) => {
    const parseOneBasedPage = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      const page = Math.trunc(numeric);
      if (page > 0) return page;
      // Some imported bookmark payloads may store zero-based page values.
      if (page === 0) return 1;
      return null;
    };

    const parseFromIndex = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      const index = Math.trunc(numeric);
      return index >= 0 ? index + 1 : null;
    };

    const resolvePage = (value) => {
      if (value === null || value === undefined) return null;

      if (Array.isArray(value)) {
        for (const entry of value) {
          const nextPage = resolvePage(entry);
          if (nextPage) return nextPage;
        }
        return null;
      }

      if (typeof value === 'object') {
        const directCandidates = [
          value.pageIds,
          value.pageId,
          value.page,
          value.Page,
          value.pageNumber,
          value.PageNumber,
          value.targetPage,
          value.destination,
          value.destinationPage,
          value.destinations,
          value.target?.page,
          value.target?.pageId,
          value.target?.pageNumber,
          value.destination?.page,
          value.destination?.pageId,
          value.destination?.pageNumber,
          value.dest?.pageNumber,
          value.dest?.PageNumber,
          value.dest?.page
        ];
        for (const candidate of directCandidates) {
          const nextPage = resolvePage(candidate);
          if (nextPage) return nextPage;
        }

        const indexCandidates = [
          value.pageIndex,
          value.PageIndex,
          value.pageIdx,
          value.destination?.pageIndex,
          value.destination?.PageIndex,
          value.dest?.pageIndex,
          value.dest?.PageIndex,
          value.dest?.index,
          value.destination?.index
        ];
        for (const candidate of indexCandidates) {
          const nextPage = parseFromIndex(candidate);
          if (nextPage) return nextPage;
        }

        if (Array.isArray(value.children)) {
          for (const child of value.children) {
            const nextPage = resolvePage(child);
            if (nextPage) return nextPage;
          }
        }

        return null;
      }

      return parseOneBasedPage(value);
    };

    const page = resolvePage(pageRef);
    if (typeof onNavigateToPage !== 'function') return;

    const bookmarkSourceId =
      pageRef && typeof pageRef === 'object' && typeof pageRef.sourceId === 'string'
        ? pageRef.sourceId
        : null;
    const bookmarkDest =
      pageRef && typeof pageRef === 'object'
        ? (pageRef.dest ?? null)
        : null;
    const manualPageOverride = Boolean(
      pageRef &&
      typeof pageRef === 'object' &&
      pageRef.manualPageOverride === true
    );
    const disableSourceNavigation = Boolean(
      pageRef &&
      typeof pageRef === 'object' &&
      pageRef.disableSourceNavigation === true
    );
    const canUseSourceNavigation = Boolean(
      (bookmarkSourceId || bookmarkDest) &&
      !manualPageOverride &&
      !disableSourceNavigation
    );

    const navigationOptions = {
      bypassActiveSpace: true,
      fromBookmark: true,
      preferBookmarkSource: canUseSourceNavigation,
      ...(canUseSourceNavigation
        ? { bookmarkSourceId, bookmarkDest }
        : {})
    };

    if (canUseSourceNavigation) {
      onNavigateToPage(null, {
        ...navigationOptions,
        bookmarkFallbackPage: page || null
      });
      return;
    }

    if (page) {
      onNavigateToPage(page, navigationOptions);
      return;
    }
  }, [onNavigateToPage]);

  const handleRename = useCallback((id, newName) => {
    if (onBookmarkUpdate) {
      onBookmarkUpdate(id, { name: newName });
    }
  }, [onBookmarkUpdate]);

  const handlePageChange = useCallback((id, pageNumber) => {
    if (onBookmarkUpdate) {
      onBookmarkUpdate(id, { pageIds: [pageNumber] });
    }
  }, [onBookmarkUpdate]);

  const handleAddChildBookmark = useCallback((folderId) => {
    if (!onBookmarkCreate) return;
    const parent = findItem(folderId, bookmarkTree)?.item;
    const nextOrder = parent?.children?.length ?? 0;
    const initialPage = pageNum && pageNum > 0
      ? (numPages ? Math.min(pageNum, numPages) : pageNum)
      : null;

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });

    onBookmarkCreate({
      id: generateId(),
      name: 'New Bookmark',
      type: 'bookmark',
      pageIds: initialPage ? [initialPage] : [],
      parentId: folderId,
      order: nextOrder,
    });
  }, [bookmarkTree, findItem, numPages, onBookmarkCreate, pageNum]);

  const handleDelete = useCallback((id) => {
    if (onBookmarkDelete) {
      onBookmarkDelete(id);
    }
  }, [onBookmarkDelete]);

  // Existing create/modal handlers remain the same
  const handleCreateBookmark = useCallback(() => {
    const trimmedName = newBookmarkName.trim();
    if (!trimmedName) return;

    const trimmedPage = newBookmarkPages.trim();
    if (!trimmedPage) {
      alert('Please enter a page number.');
      return;
    }

    const pageNumber = parseInt(trimmedPage, 10);
    if (isNaN(pageNumber) || pageNumber < 1) {
      alert('Please enter a valid page number.');
      return;
    }

    if (numPages && pageNumber > numPages) {
      alert(`Please enter a page number between 1 and ${numPages}.`);
      return;
    }

    if (onBookmarkCreate) {
      onBookmarkCreate({
        name: trimmedName,
        pageIds: [pageNumber],
        type: 'bookmark'
      });
    }

    setNewBookmarkName('');
    setNewBookmarkPages('');
    setShowCreateMenu(false);
  }, [newBookmarkName, newBookmarkPages, onBookmarkCreate, numPages]);

  const handleNewBookmarkPageChange = useCallback((value) => {
    const sanitized = value.replace(/[^\d]/g, '');
    if (!sanitized) {
      setNewBookmarkPages('');
      return;
    }
    const numericValue = parseInt(sanitized, 10);
    if (isNaN(numericValue) || numericValue < 1) {
      setNewBookmarkPages('');
      return;
    }
    if (numPages && numericValue > numPages) {
      setNewBookmarkPages(numPages.toString());
      return;
    }
    setNewBookmarkPages(numericValue.toString());
  }, [numPages]);

  const handleCreateFolder = useCallback(() => {
    setShowBookmarkGroupModal(true);
    setGroupName('');
    setGroupBookmarks([]);
    setShowCreateMenu(false);
  }, []);

  const handleSaveBookmarkGroup = useCallback(() => {
    if (!groupName.trim()) {
      alert('Please enter a name for the bookmark group');
      return;
    }

    if (groupBookmarks.length === 0) {
      alert('Please add at least one bookmark to the group');
      return;
    }

    const invalidBookmarks = groupBookmarks.filter(b => {
      if (b.isExisting) return false;
      if (!b.name || !b.name.trim()) return true;
      if (!b.pageIds || b.pageIds.length === 0) return true;
      const pageValue = b.pageIds[0];
      if (pageValue < 1) return true;
      if (numPages && pageValue > numPages) return true;
      return false;
    });

    if (invalidBookmarks.length > 0) {
      alert('Please ensure all new bookmarks have both a name and a valid page number within the PDF page range.');
      return;
    }

    const folderId = generateId();

    const newBookmarks = groupBookmarks
      .filter(b => !b.isExisting)
      .filter(b => {
        if (!b.name || !b.name.trim() || !b.pageIds || b.pageIds.length === 0) {
          return false;
        }
        const pageValue = b.pageIds[0];
        if (pageValue < 1) return false;
        if (numPages && pageValue > numPages) return false;
        return true;
      })
      .map(b => ({
        id: generateId(),
        name: b.name.trim(),
        type: 'bookmark',
        pageIds: b.pageIds || [],
        parentId: folderId
      }));

    const existingBookmarkIds = groupBookmarks
      .filter(b => b.isExisting && b.id)
      .map(b => b.id);

    if (onBookmarkCreate) {
      onBookmarkCreate({
        id: folderId,
        name: groupName.trim(),
        type: 'folder',
        children: []
      });
    }

    newBookmarks.forEach(bookmark => {
      if (onBookmarkCreate) {
        onBookmarkCreate(bookmark);
      }
    });

    existingBookmarkIds.forEach(bookmarkId => {
      if (onBookmarkUpdate) {
        onBookmarkUpdate(bookmarkId, { parentId: folderId });
      }
    });

    setShowBookmarkGroupModal(false);
    setGroupName('');
    setGroupBookmarks([]);
  }, [groupName, groupBookmarks, onBookmarkCreate, onBookmarkUpdate, numPages]);

  const handleAddExistingBookmark = useCallback((bookmarkId) => {
    const bookmark = bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark || bookmark.type === 'folder') return;

    if (groupBookmarks.some(b => b.id === bookmarkId && b.isExisting)) {
      return;
    }

    setGroupBookmarks(prev => [...prev, {
      id: bookmark.id,
      name: bookmark.name,
      pageIds: bookmark.pageIds || [],
      isExisting: true
    }]);
  }, [bookmarks, groupBookmarks]);

  const handleAddNewBookmark = useCallback(() => {
    let initialPage = null;
    if (pageNum && pageNum > 0) {
      initialPage = numPages ? Math.min(pageNum, numPages) : pageNum;
    } else if (numPages && numPages > 0) {
      initialPage = 1;
    }
    const newBookmark = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: '',
      pageIds: initialPage ? [initialPage] : [],
      isExisting: false
    };
    setGroupBookmarks(prev => [...prev, newBookmark]);
  }, [pageNum, numPages]);

  const handleUpdateGroupBookmark = useCallback((index, updates) => {
    setGroupBookmarks(prev => prev.map((b, i) => i === index ? { ...b, ...updates } : b));
  }, []);

  const handleRemoveGroupBookmark = useCallback((index) => {
    setGroupBookmarks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleOpenAddToGroup = useCallback((groupId) => {
    setTargetGroupId(groupId);
    setAddToGroupBookmarks([]);
    setShowAddToGroupModal(true);
  }, []);

  const handleAddExistingBookmarkToGroup = useCallback((bookmarkId) => {
    const bookmark = bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark || bookmark.type === 'folder') return;
    if (bookmark.parentId === targetGroupId) return;

    if (addToGroupBookmarks.some(b => b.id === bookmarkId && b.isExisting)) {
      return;
    }

    setAddToGroupBookmarks(prev => [...prev, {
      id: bookmark.id,
      name: bookmark.name,
      pageIds: bookmark.pageIds || [],
      isExisting: true
    }]);
  }, [bookmarks, targetGroupId, addToGroupBookmarks]);

  const handleAddNewBookmarkToGroup = useCallback(() => {
    let initialPage = null;
    if (pageNum && pageNum > 0) {
      initialPage = numPages ? Math.min(pageNum, numPages) : pageNum;
    } else if (numPages && numPages > 0) {
      initialPage = 1;
    }
    const newBookmark = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: '',
      pageIds: initialPage ? [initialPage] : [],
      isExisting: false
    };
    setAddToGroupBookmarks(prev => [...prev, newBookmark]);
  }, [pageNum, numPages]);

  const handleUpdateAddToGroupBookmark = useCallback((index, updates) => {
    setAddToGroupBookmarks(prev => prev.map((b, i) => i === index ? { ...b, ...updates } : b));
  }, []);

  const handleRemoveAddToGroupBookmark = useCallback((index) => {
    setAddToGroupBookmarks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSaveAddToGroup = useCallback(() => {
    if (!targetGroupId) return;

    if (addToGroupBookmarks.length === 0) {
      alert('Please add at least one bookmark to the group');
      return;
    }

    const invalidBookmarks = addToGroupBookmarks.filter(b => {
      if (b.isExisting) return false;
      if (!b.name || !b.name.trim()) return true;
      if (!b.pageIds || b.pageIds.length === 0) return true;
      const pageValue = b.pageIds[0];
      if (pageValue < 1) return true;
      if (numPages && pageValue > numPages) return true;
      return false;
    });

    if (invalidBookmarks.length > 0) {
      alert('Please ensure all new bookmarks have both a name and a valid page number within the PDF page range.');
      return;
    }

    const newBookmarks = addToGroupBookmarks
      .filter(b => !b.isExisting)
      .filter(b => {
        if (!b.name || !b.name.trim() || !b.pageIds || b.pageIds.length === 0) {
          return false;
        }
        const pageValue = b.pageIds[0];
        if (pageValue < 1) return false;
        if (numPages && pageValue > numPages) return false;
        return true;
      })
      .map(b => ({
        id: generateId(),
        name: b.name.trim(),
        type: 'bookmark',
        pageIds: b.pageIds || [],
        parentId: targetGroupId
      }));

    const existingBookmarkIds = addToGroupBookmarks
      .filter(b => b.isExisting && b.id)
      .map(b => b.id);

    newBookmarks.forEach(bookmark => {
      if (onBookmarkCreate) {
        onBookmarkCreate(bookmark);
      }
    });

    existingBookmarkIds.forEach(bookmarkId => {
      if (onBookmarkUpdate) {
        onBookmarkUpdate(bookmarkId, { parentId: targetGroupId });
      }
    });

    setShowAddToGroupModal(false);
    setTargetGroupId(null);
    setAddToGroupBookmarks([]);
  }, [targetGroupId, addToGroupBookmarks, onBookmarkCreate, onBookmarkUpdate, numPages]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowCreateMenu(false);
      }
    };

    if (showCreateMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCreateMenu]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: '#252525'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        background: '#252525',
        borderBottom: '1px solid #3a3a3a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: '600',
          color: '#ddd'
        }}>
          Bookmarks
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            style={{
              background: isEditMode ? '#4A90E2' : '#3a3a3a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: FONT_FAMILY
            }}
            onMouseEnter={(e) => {
              if (!isEditMode) {
                e.currentTarget.style.background = '#444';
              } else {
                e.currentTarget.style.background = '#357abd';
              }
            }}
            onMouseLeave={(e) => {
              if (!isEditMode) {
                e.currentTarget.style.background = '#3a3a3a';
              } else {
                e.currentTarget.style.background = '#4A90E2';
              }
            }}
          >
            <Icon name="edit" size={12} color="#ffffff" />
            {isEditMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Bookmarks List with Drag-and-Drop */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          position: 'relative'
        }}
      >
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          measuring={bookmarkTreeMeasuring}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            {bookmarkTree.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#999',
                fontSize: '13px'
              }}>
                No bookmarks yet. Create one to get started.
              </div>
            ) : (
              <div style={{ margin: 0, padding: 0 }}>
                {flattenedItems.map((item) => (
                  <BookmarkTreeRow
                    key={item.id}
                    item={item}
                    depth={item.depth}
                    projectedDepth={item.id === activeId && projected ? projected.depth : null}
                    activeDepth={activeSortableItem?.depth}
                    isEditMode={isEditMode}
                    isDraggingAny={Boolean(activeId)}
                    isVisuallyCollapsed={collapsingFolderIds.includes(item.id)}
                    groupAnimationState={getGroupAnimationState(item)}
                    isGroupAnimationActive={collapseLayoutLock || collapsingFolderIds.length > 0 || expandingFolderIds.length > 0}
                    isSelected={selectedBookmarkId === item.id}
                    numPages={numPages}
                    onToggle={toggleExpand}
                    onNavigate={handleNavigate}
                    onSelect={setSelectedBookmarkId}
                    onRename={handleRename}
                    onPageChange={handlePageChange}
                    onAddChild={handleAddChildBookmark}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </SortableContext>

          <DragOverlay modifiers={[restrictToVerticalAxis]} dropAnimation={null}>
            {activeSortableItem ? (
              <BookmarkTreeRow
                item={activeSortableItem}
                depth={projected ? projected.depth : activeSortableItem.depth}
                activeDepth={activeSortableItem.depth}
                isEditMode={isEditMode}
                isClone
                isDraggingAny
                childCount={countTreeChildren(bookmarkTree, activeSortableItem.id) + 1}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Add Button at Bottom */}
      <div style={{
        padding: '12px',
        background: '#252525',
        borderTop: '1px solid #3a3a3a'
      }}>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            style={{
              width: '100%',
              background: '#4A90E2',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontFamily: FONT_FAMILY
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#357abd'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#4A90E2'}
          >
            <Icon name="plus" size={14} color="#ffffff" />
            Add Bookmark
          </button>
          {showCreateMenu && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: '4px',
              background: '#333',
              border: '1px solid #444',
              borderRadius: '8px',
              padding: '4px',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}>
              <button
                onClick={handleCreateFolder}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: '#ddd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#2b2b2b'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <Icon name="folder" size={14} color="#999" />
                New Bookmark Group
              </button>
              <div style={{ padding: '8px 12px', borderTop: '1px solid #3a3a3a' }}>
                <input
                  type="text"
                  placeholder="Bookmark name"
                  value={newBookmarkName}
                  onChange={(e) => setNewBookmarkName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: '#2b2b2b',
                    color: '#ddd',
                    border: '1px solid #3a3a3a',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                />
                <input
                  type="text"
                  placeholder="Page number"
                  value={newBookmarkPages}
                  onChange={(e) => handleNewBookmarkPageChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: '#2b2b2b',
                    color: '#ddd',
                    border: '1px solid #3a3a3a',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <button
                  onClick={() => {
                    if (pageNum) {
                      const clampedPage = numPages ? Math.min(pageNum, numPages) : pageNum;
                      if (clampedPage > 0) {
                        handleNewBookmarkPageChange(clampedPage.toString());
                      }
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: '#3a3a3a',
                    color: '#ddd',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#3a3a3a'}
                >
                  Current Page
                </button>
                <button
                  onClick={handleCreateBookmark}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: '#4A90E2',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#357abd'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#4A90E2'}
                >
                  Create Bookmark
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals remain the same as before... (I'll include the complete modal code) */}
      {/* Bookmark Group Creation Modal */}
      {showBookmarkGroupModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }} onClick={() => setShowBookmarkGroupModal(false)}>
          <div style={{
            background: '#252525',
            borderRadius: '12px',
            padding: '24px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid #3a3a3a',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#ddd'
              }}>
                Create Bookmark Group
              </h3>
              <button
                onClick={() => {
                  setShowBookmarkGroupModal(false);
                  setGroupName('');
                  setGroupBookmarks([]);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#999',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3a3a3a';
                  e.currentTarget.style.color = '#ddd';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#999';
                }}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: '#aaa',
                marginBottom: '8px'
              }}>
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter bookmark group name"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#2b2b2b',
                  color: '#ddd',
                  border: '1px solid #3a3a3a',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <label style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#aaa'
                }}>
                  Bookmarks ({groupBookmarks.length})
                </label>
                <button
                  onClick={handleAddNewBookmark}
                  style={{
                    background: '#3a3a3a',
                    color: '#ddd',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: FONT_FAMILY
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#3a3a3a'}
                >
                  <Icon name="plus" size={12} />
                  New Bookmark
                </button>
              </div>

              <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                background: '#1f1f1f'
              }}>
                {groupBookmarks.length === 0 ? (
                  <div style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '13px'
                  }}>
                    No bookmarks added yet. Add existing bookmarks or create new ones.
                  </div>
                ) : (
                  groupBookmarks.map((bookmark, index) => (
                    <div key={index} style={{
                      padding: '12px',
                      borderBottom: index < groupBookmarks.length - 1 ? '1px solid #2a2a2a' : 'none',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start'
                    }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {bookmark.isExisting ? (
                          <>
                            <div style={{
                              fontSize: '13px',
                              color: '#ddd',
                              fontWeight: '500'
                            }}>
                              {bookmark.name}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: '#999'
                            }}>
                              Page {bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : 'N/A'}
                            </div>
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={bookmark.name || ''}
                              onChange={(e) => handleUpdateGroupBookmark(index, { name: e.target.value })}
                              placeholder="Bookmark name"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                background: '#2b2b2b',
                                color: '#ddd',
                                border: '1px solid #3a3a3a',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                              onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                            />
                            <input
                              type="text"
                              value={bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : ''}
                              onChange={(e) => {
                                const sanitized = e.target.value.replace(/[^\d]/g, '');
                                if (!sanitized) {
                                  handleUpdateGroupBookmark(index, { pageIds: [] });
                                  return;
                                }
                                const numericValue = parseInt(sanitized, 10);
                                if (isNaN(numericValue) || numericValue < 1) {
                                  handleUpdateGroupBookmark(index, { pageIds: [] });
                                  return;
                                }
                                const clampedValue = numPages && numericValue > numPages ? numPages : numericValue;
                                handleUpdateGroupBookmark(index, { pageIds: [clampedValue] });
                              }}
                              placeholder="Page number"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                background: '#2b2b2b',
                                color: '#ddd',
                                border: '1px solid #3a3a3a',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                              onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                              inputMode="numeric"
                              pattern="[0-9]*"
                            />
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveGroupBookmark(index)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          flexShrink: 0
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#3a1f1f'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        title="Remove"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {bookmarks && bookmarks.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#aaa',
                  marginBottom: '8px'
                }}>
                  Add Existing Bookmarks
                </label>
                <div style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  border: '1px solid #3a3a3a',
                  borderRadius: '6px',
                  background: '#1f1f1f',
                  padding: '8px'
                }}>
                  {bookmarks.filter(b => b.type === 'bookmark' && !b.parentId).length === 0 ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: '#666',
                      fontSize: '12px'
                    }}>
                      No existing bookmarks available
                    </div>
                  ) : (
                    bookmarks
                      .filter(b => b.type === 'bookmark' && !b.parentId)
                      .filter(b => !groupBookmarks.some(gb => gb.id === b.id && gb.isExisting))
                      .map(bookmark => (
                        <button
                          key={bookmark.id}
                          onClick={() => handleAddExistingBookmark(bookmark.id)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            color: '#ddd',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '4px'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#2b2b2b'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>{bookmark.name}</span>
                          <span style={{ color: '#999', fontSize: '11px' }}>
                            Page {bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : 'N/A'}
                          </span>
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowBookmarkGroupModal(false);
                  setGroupName('');
                  setGroupBookmarks([]);
                }}
                style={{
                  padding: '8px 16px',
                  background: '#3a3a3a',
                  color: '#ddd',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#3a3a3a'}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBookmarkGroup}
                style={{
                  padding: '8px 16px',
                  background: '#4A90E2',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#357abd'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#4A90E2'}
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Bookmarks to Existing Group Modal */}
      {showAddToGroupModal && targetGroupId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }} onClick={() => {
          setShowAddToGroupModal(false);
          setTargetGroupId(null);
          setAddToGroupBookmarks([]);
        }}>
          <div style={{
            background: '#252525',
            borderRadius: '12px',
            padding: '24px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid #3a3a3a',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#ddd'
              }}>
                Add Bookmarks to Group
              </h3>
              <button
                onClick={() => {
                  setShowAddToGroupModal(false);
                  setTargetGroupId(null);
                  setAddToGroupBookmarks([]);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#999',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3a3a3a';
                  e.currentTarget.style.color = '#ddd';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#999';
                }}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {(() => {
              const targetGroup = bookmarks.find(b => b.id === targetGroupId);
              return targetGroup ? (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#aaa',
                    marginBottom: '8px'
                  }}>
                    Group Name
                  </label>
                  <div style={{
                    padding: '10px 12px',
                    background: '#2b2b2b',
                    color: '#ddd',
                    border: '1px solid #3a3a3a',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY
                  }}>
                    {targetGroup.name}
                  </div>
                </div>
              ) : null;
            })()}

            <div style={{ marginBottom: '20px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <label style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#aaa'
                }}>
                  Bookmarks ({addToGroupBookmarks.length})
                </label>
                <button
                  onClick={handleAddNewBookmarkToGroup}
                  style={{
                    background: '#3a3a3a',
                    color: '#ddd',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: FONT_FAMILY
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#3a3a3a'}
                >
                  <Icon name="plus" size={12} />
                  New Bookmark
                </button>
              </div>

              <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid #3a3a3a',
                borderRadius: '6px',
                background: '#1f1f1f'
              }}>
                {addToGroupBookmarks.length === 0 ? (
                  <div style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '13px'
                  }}>
                    No bookmarks added yet. Add existing bookmarks or create new ones.
                  </div>
                ) : (
                  addToGroupBookmarks.map((bookmark, index) => (
                    <div key={index} style={{
                      padding: '12px',
                      borderBottom: index < addToGroupBookmarks.length - 1 ? '1px solid #2a2a2a' : 'none',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start'
                    }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {bookmark.isExisting ? (
                          <>
                            <div style={{
                              fontSize: '13px',
                              color: '#ddd',
                              fontWeight: '500'
                            }}>
                              {bookmark.name}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: '#999'
                            }}>
                              Page {bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : 'N/A'}
                            </div>
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={bookmark.name || ''}
                              onChange={(e) => handleUpdateAddToGroupBookmark(index, { name: e.target.value })}
                              placeholder="Bookmark name"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                background: '#2b2b2b',
                                color: '#ddd',
                                border: '1px solid #3a3a3a',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                              onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                            />
                            <input
                              type="text"
                              value={bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : ''}
                              onChange={(e) => {
                                const sanitized = e.target.value.replace(/[^\d]/g, '');
                                if (!sanitized) {
                                  handleUpdateAddToGroupBookmark(index, { pageIds: [] });
                                  return;
                                }
                                const numericValue = parseInt(sanitized, 10);
                                if (isNaN(numericValue) || numericValue < 1) {
                                  handleUpdateAddToGroupBookmark(index, { pageIds: [] });
                                  return;
                                }
                                const clampedValue = numPages && numericValue > numPages ? numPages : numericValue;
                                handleUpdateAddToGroupBookmark(index, { pageIds: [clampedValue] });
                              }}
                              placeholder="Page number"
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                background: '#2b2b2b',
                                color: '#ddd',
                                border: '1px solid #3a3a3a',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = '#4A90E2'}
                              onBlur={(e) => e.currentTarget.style.borderColor = '#3a3a3a'}
                              inputMode="numeric"
                              pattern="[0-9]*"
                            />
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveAddToGroupBookmark(index)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          flexShrink: 0
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#3a1f1f'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        title="Remove"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {bookmarks && bookmarks.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#aaa',
                  marginBottom: '8px'
                }}>
                  Add Existing Bookmarks
                </label>
                <div style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  border: '1px solid #3a3a3a',
                  borderRadius: '6px',
                  background: '#1f1f1f',
                  padding: '8px'
                }}>
                  {bookmarks.filter(b => {
                    return b.type === 'bookmark' &&
                      b.parentId !== targetGroupId &&
                      !addToGroupBookmarks.some(gb => gb.id === b.id && gb.isExisting);
                  }).length === 0 ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: '#666',
                      fontSize: '12px'
                    }}>
                      No existing bookmarks available
                    </div>
                  ) : (
                    bookmarks
                      .filter(b => {
                        return b.type === 'bookmark' &&
                          b.parentId !== targetGroupId &&
                          !addToGroupBookmarks.some(gb => gb.id === b.id && gb.isExisting);
                      })
                      .map(bookmark => (
                        <button
                          key={bookmark.id}
                          onClick={() => handleAddExistingBookmarkToGroup(bookmark.id)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            color: '#ddd',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '4px'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#2b2b2b'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>{bookmark.name}</span>
                          <span style={{ color: '#999', fontSize: '11px' }}>
                            Page {bookmark.pageIds && bookmark.pageIds.length > 0 ? bookmark.pageIds[0] : 'N/A'}
                          </span>
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowAddToGroupModal(false);
                  setTargetGroupId(null);
                  setAddToGroupBookmarks([]);
                }}
                style={{
                  padding: '8px 16px',
                  background: '#3a3a3a',
                  color: '#ddd',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#3a3a3a'}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAddToGroup}
                style={{
                  padding: '8px 16px',
                  background: '#4A90E2',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#357abd'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#4A90E2'}
              >
                Add Bookmarks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarksPanel;
