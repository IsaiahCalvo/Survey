import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Icon from '../Icons';
import DraggableBookmark from './DraggableBookmark';
import DraggableBookmarkFolder from './DraggableBookmarkFolder';
import DropSlot from './DropSlot';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const EXPAND_DELAY_MS = 320;
const COLLAPSE_DELAY_MS = 360;

// Helper to generate unique IDs
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const createSlotId = (parentId, index) =>
  parentId ? `${parentId}::slot::${index}` : `root::slot::${index}`;

const BookmarksPanel = ({
  bookmarks,
  onBookmarkCreate,
  onBookmarkUpdate,
  onBookmarkDelete,
  onNavigateToPage,
  pageNum,
  numPages
}) => {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [selectedBookmarkId, setSelectedBookmarkId] = useState(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
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
  const [recentlyDroppedId, setRecentlyDroppedId] = useState(null);
  const [draggedItemInfo, setDraggedItemInfo] = useState(null);
  const [pendingDropTarget, setPendingDropTarget] = useState(null);

  const expansionTimersRef = useRef(new Map());
  const collapseTimersRef = useRef(new Map());
  const autoExpandedFoldersRef = useRef(new Set());
  const lastHoverFolderRef = useRef(null);
  const lastCollisionRef = useRef([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 12,
      },
    }),
  );

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

  const bookmarkTree = useMemo(() => buildTree(bookmarks || []), [bookmarks, buildTree]);

  // Get all item IDs for SortableContext
  const getAllItemIds = useMemo(() => {
    const collect = (list) =>
      list.flatMap((item) =>
        item.type === 'folder' && item.children?.length
          ? [item.id, ...collect(item.children)]
          : [item.id]
      );
    return collect(bookmarkTree);
  }, [bookmarkTree]);

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

  const getActiveItem = useCallback((id) => {
    const lookup = (list) => {
      for (const entry of list) {
        if (entry.id === id) return entry;
        if (entry.type === 'folder' && entry.children) {
          const nested = lookup(entry.children);
          if (nested) return nested;
        }
      }
    };
    return lookup(bookmarkTree);
  }, [bookmarkTree]);

  const expandFolder = useCallback((folderId, options = {}) => {
    const { trackAuto = false } = options;
    let added = false;
    setExpandedFolders((prev) => {
      if (prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.add(folderId);
      added = true;
      return next;
    });
    if (trackAuto && added) {
      autoExpandedFoldersRef.current.add(folderId);
    }
  }, []);

  const collapseFolders = useCallback((folderIds) => {
    const ids = Array.from(folderIds);
    if (!ids.length) return;
    setExpandedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      ids.forEach((id) => {
        if (next.delete(id)) {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    ids.forEach((id) => autoExpandedFoldersRef.current.delete(id));
  }, []);

  const collapseAutoExpandedFolders = useCallback((keepId = null) => {
    const ids = Array.from(autoExpandedFoldersRef.current);
    autoExpandedFoldersRef.current.clear();
    const toCollapse = keepId ? ids.filter((id) => id !== keepId) : ids;
    if (toCollapse.length) {
      collapseFolders(toCollapse);
    }
  }, [collapseFolders]);

  const cancelExpansionTimer = useCallback((folderId) => {
    const timer = expansionTimersRef.current.get(folderId);
    if (timer) {
      clearTimeout(timer);
      expansionTimersRef.current.delete(folderId);
    }
  }, []);

  const cancelCollapseTimer = useCallback((folderId) => {
    const timer = collapseTimersRef.current.get(folderId);
    if (timer) {
      clearTimeout(timer);
      collapseTimersRef.current.delete(folderId);
    }
  }, []);

  const scheduleExpansion = useCallback((folderId) => {
    if (expansionTimersRef.current.has(folderId)) return;

    const timer = setTimeout(() => {
      expansionTimersRef.current.delete(folderId);
      expandFolder(folderId, { trackAuto: true });
      cancelCollapseTimer(folderId);
    }, EXPAND_DELAY_MS);

    expansionTimersRef.current.set(folderId, timer);
  }, [expandFolder, cancelCollapseTimer]);

  const scheduleCollapse = useCallback((folderId) => {
    if (collapseTimersRef.current.has(folderId)) return;

    const timer = setTimeout(() => {
      collapseTimersRef.current.delete(folderId);
      collapseFolders([folderId]);
    }, COLLAPSE_DELAY_MS);

    collapseTimersRef.current.set(folderId, timer);
  }, [collapseFolders]);

  const clearAllTimers = useCallback(() => {
    expansionTimersRef.current.forEach((timer) => clearTimeout(timer));
    collapseTimersRef.current.forEach((timer) => clearTimeout(timer));
    expansionTimersRef.current.clear();
    collapseTimersRef.current.clear();
  }, []);

  const handleDragStart = useCallback((event) => {
    const activeKey = event.active.id;
    setActiveId(activeKey);
    setRecentlyDroppedId(null);
    autoExpandedFoldersRef.current.clear();
    lastCollisionRef.current = [];

    const activeLocation = findItem(activeKey, bookmarkTree);
    const rect = event.active.rect.current;
    const height = rect?.initial?.height ?? 0;

    setDraggedItemInfo({
      id: activeKey,
      parentId: activeLocation?.parent?.id ?? null,
      height,
    });
    setPendingDropTarget(null);
  }, [findItem, bookmarkTree]);

  const handleDragOver = useCallback((event) => {
    const over = event.over;
    setOverId((over?.id) ?? null);

    const overData = over?.data.current;
    const draggingRect = event.draggingRect?.current;
    const overRect = over?.rect?.current;
    let hoveredFolderId = null;

    if (overData?.type === 'bookmark' || overData?.type === 'slot') {
      hoveredFolderId = overData.parentId;
      if (hoveredFolderId) {
        expandFolder(hoveredFolderId, { trackAuto: true });
        cancelCollapseTimer(hoveredFolderId);
      }
      setPendingDropTarget({
        parentId: overData.parentId ?? null,
      });
    } else if (overData?.type === 'folder') {
      hoveredFolderId = over.id;
      cancelCollapseTimer(hoveredFolderId);

      const folderIndex = bookmarkTree.findIndex((item) => item.id === hoveredFolderId);
      const isTopFolder = folderIndex === 0;
      const isBottomFolder = folderIndex === bookmarkTree.length - 1;

      let allowExpansion = true;
      if (draggingRect && overRect) {
        const midpoint = overRect.top + overRect.height / 2;
        const dragCenter = draggingRect.top + draggingRect.height / 2;
        if (isTopFolder && dragCenter < midpoint) {
          allowExpansion = false;
        } else if (isBottomFolder && dragCenter > midpoint) {
          allowExpansion = false;
        }
      }

      if (allowExpansion) {
        scheduleExpansion(hoveredFolderId);
      } else {
        cancelExpansionTimer(hoveredFolderId);
      }
      setPendingDropTarget(null);
    }

    const previousHover = lastHoverFolderRef.current;
    if (previousHover && previousHover !== hoveredFolderId) {
      cancelExpansionTimer(previousHover);
      scheduleCollapse(previousHover);
    }

    if (!hoveredFolderId && overData?.type !== 'folder') {
      expandedFolders.forEach((folderId) => scheduleCollapse(folderId));
    }

    lastHoverFolderRef.current = hoveredFolderId;
  }, [bookmarkTree, expandFolder, cancelCollapseTimer, cancelExpansionTimer, scheduleExpansion, scheduleCollapse, expandedFolders]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    clearAllTimers();
    lastHoverFolderRef.current = null;
    lastCollisionRef.current = [];

    setActiveId(null);
    setOverId(null);
    setDraggedItemInfo(null);
    setPendingDropTarget(null);

    if (!over) {
      collapseAutoExpandedFolders();
      return;
    }

    const activeKey = active.id;
    const overKey = over.id;
    if (activeKey === overKey) return;

    const overData = over.data.current;
    const activeLocation = findItem(activeKey, bookmarkTree);
    if (!activeLocation) return;

    const draggingRect = event.draggingRect?.current;
    const overRect = over.rect?.current;

    const computeDestination = () => {
      if (!overData) return null;

      if (overData.type === 'slot') {
        return { parentId: overData.parentId ?? null, index: overData.index };
      }

      if (overData.type === 'bookmark') {
        const overLocation = findItem(overKey, bookmarkTree);
        if (!overLocation) return null;

        const parentId = overData.parentId ?? null;
        let index = overLocation.index;

        if (draggingRect && overRect) {
          const midpoint = overRect.top + overRect.height / 2;
          const dragCenter = draggingRect.top + draggingRect.height / 2;
          if (dragCenter > midpoint) {
            index += 1;
          }
        } else if (
          parentId === activeLocation.parent?.id &&
          activeLocation.index < overLocation.index
        ) {
          index += 1;
        }

        return { parentId, index };
      }

      if (overData.type === 'folder') {
        const folderIndex = bookmarkTree.findIndex((item) => item.id === overKey);
        let index = folderIndex;

        if (draggingRect && overRect) {
          const midpoint = overRect.top + overRect.height / 2;
          const dragCenter = draggingRect.top + draggingRect.height / 2;
          if (dragCenter > midpoint) {
            index = folderIndex + 1;
          }

          const isTopFolder = folderIndex === 0;
          const isBottomFolder = bookmarkTree.length - 1;
          if (isTopFolder && dragCenter < midpoint) {
            index = folderIndex;
          }
          if (isBottomFolder && dragCenter > midpoint) {
            index = folderIndex + 1;
          }
        } else if (
          !activeLocation.parent &&
          activeLocation.index < folderIndex
        ) {
          index = folderIndex;
        } else {
          index = folderIndex + 1;
        }

        return { parentId: null, index };
      }

      return null;
    };

    const destination = computeDestination();
    if (!destination) {
      collapseAutoExpandedFolders();
      return;
    }

    // Update bookmark order and parentId
    const draggedItem = bookmarks.find(b => b.id === activeKey);
    if (!draggedItem) return;

    // Get all items at the destination level
    let destItems;
    if (destination.parentId) {
      destItems = bookmarks.filter(b => b.parentId === destination.parentId && b.id !== activeKey);
    } else {
      destItems = bookmarks.filter(b => !b.parentId && b.id !== activeKey);
    }
    destItems.sort((a, b) => (a.order || 0) - (b.order || 0));

    // Insert dragged item at destination index
    destItems.splice(destination.index, 0, draggedItem);

    // Update order for all items at this level
    destItems.forEach((item, idx) => {
      if (onBookmarkUpdate) {
        onBookmarkUpdate(item.id, {
          order: idx,
          parentId: destination.parentId
        });
      }
    });

    const targetFolderId = destination.parentId;
    if (targetFolderId) {
      setExpandedFolders((prevExpanded) => {
        const next = new Set(prevExpanded);
        next.add(targetFolderId);
        return next;
      });
    }

    setRecentlyDroppedId(activeKey);

    collapseAutoExpandedFolders(destination.parentId ?? null);
  }, [bookmarks, bookmarkTree, clearAllTimers, collapseAutoExpandedFolders, findItem, onBookmarkUpdate]);

  const handleDragCancel = useCallback(() => {
    clearAllTimers();
    lastHoverFolderRef.current = null;
    lastCollisionRef.current = [];
    setActiveId(null);
    setOverId(null);
    setDraggedItemInfo(null);
    setPendingDropTarget(null);
    collapseAutoExpandedFolders();
  }, [clearAllTimers, collapseAutoExpandedFolders]);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  const collisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    let collisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);

    if (!collisions || collisions.length === 0) {
      return lastCollisionRef.current || [];
    }

    const activeId = args?.active?.id;
    const activeInfo = activeId ? findItem(activeId, bookmarkTree) : null;
    const activeParentId = activeInfo?.parent?.id ?? null;

    const resolveContainerData = (collision) => {
      if (collision?.data?.droppableContainer?.data?.current) {
        return collision.data.droppableContainer.data.current;
      }

      const containers = args.droppableContainers;
      if (containers) {
        if (typeof containers.get === 'function') {
          return containers.get(collision.id)?.data?.current ?? null;
        }
        if (Array.isArray(containers)) {
          const match = containers.find((container) => container?.id === collision.id);
          return match?.data?.current ?? null;
        }
        if (typeof containers === 'object') {
          return containers[collision.id]?.data?.current ?? null;
        }
      }

      return null;
    };

    const containerEntries = collisions
      .map((collision) => {
        const data = resolveContainerData(collision);
        if (!data) return null;
        return { collision, data };
      })
      .filter(Boolean);

    const slotCollisions = containerEntries.filter(entry => entry.data.type === 'slot');
    const prioritizedSlots = slotCollisions.length
      ? [...slotCollisions].sort((a, b) => {
          const aSameParent = a.data.parentId === activeParentId;
          const bSameParent = b.data.parentId === activeParentId;
          if (aSameParent === bSameParent) return 0;
          return aSameParent ? -1 : 1;
        })
      : [];

    const prioritizedEntries = prioritizedSlots.length
      ? prioritizedSlots
      : containerEntries;

    if (prioritizedEntries.length === 0) {
      lastCollisionRef.current = collisions;
      return collisions;
    }

    const result = prioritizedEntries.map(entry => entry.collision);
    lastCollisionRef.current = result;
    return result;
  }, [bookmarkTree, findItem]);

  const activeItem = activeId ? getActiveItem(activeId) : null;

  const getIncomingPlaceholderHeight = useCallback((folderId) => {
    if (!draggedItemInfo || !pendingDropTarget) return 0;
    if (pendingDropTarget.parentId !== folderId) return 0;
    if (draggedItemInfo.parentId === pendingDropTarget.parentId) return 0;
    if (draggedItemInfo.id === folderId) return 0;
    return Math.max(0, draggedItemInfo.height);
  }, [draggedItemInfo, pendingDropTarget]);

  const toggleExpand = useCallback((folderId) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleNavigate = useCallback((pageIds) => {
    if (pageIds && pageIds.length > 0) {
      onNavigateToPage(pageIds[0]);
    }
  }, [onNavigateToPage]);

  const handleRename = useCallback((id, newName) => {
    if (onBookmarkUpdate) {
      onBookmarkUpdate(id, { name: newName });
    }
  }, [onBookmarkUpdate]);

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

  // Render bookmark tree item
  const renderBookmarkItem = (item, rootIndex) => {
    const isFolder = item.type === 'folder';
    const isExpanded = expandedFolders.has(item.id);

    if (isFolder) {
      return (
        <div key={item.id} style={{ marginBottom: '0.5px' }}>
          <DropSlot
            id={createSlotId(null, rootIndex)}
            parentId={null}
            index={rootIndex}
          />

          <DraggableBookmarkFolder
            item={item}
            isExpanded={isExpanded}
            onToggle={toggleExpand}
            isEditMode={isEditMode}
            onRename={handleRename}
            onDelete={handleDelete}
            onAddToGroup={handleOpenAddToGroup}
            isSelected={selectedBookmarkId === item.id}
            onSelect={setSelectedBookmarkId}
            incomingPlaceholderHeight={getIncomingPlaceholderHeight(item.id)}
          >
            {item.children && item.children.length > 0 ? (
              <>
                <DropSlot
                  id={createSlotId(item.id, 0)}
                  parentId={item.id}
                  index={0}
                  isInsideFolder
                />
                {item.children.map((child, childIndex) => (
                  <div key={child.id}>
                    <DraggableBookmark
                      item={child}
                      isNested
                      parentId={item.id}
                      isEditMode={isEditMode}
                      onNavigate={handleNavigate}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      onUpdate={onBookmarkUpdate}
                      numPages={numPages}
                      isSelected={selectedBookmarkId === child.id}
                      onSelect={setSelectedBookmarkId}
                      recentlyDropped={recentlyDroppedId === child.id}
                    />
                    <DropSlot
                      id={createSlotId(item.id, childIndex + 1)}
                      parentId={item.id}
                      index={childIndex + 1}
                      isInsideFolder
                    />
                  </div>
                ))}
              </>
            ) : (
              <DropSlot
                id={createSlotId(item.id, 0)}
                parentId={item.id}
                index={0}
                isInsideFolder
                isEmptyState
              />
            )}
          </DraggableBookmarkFolder>
        </div>
      );
    } else {
      return (
        <div key={item.id} style={{ marginBottom: '0.5px' }}>
          <DropSlot
            id={createSlotId(null, rootIndex)}
            parentId={null}
            index={rootIndex}
          />

          <DraggableBookmark
            item={item}
            parentId={null}
            isEditMode={isEditMode}
            onNavigate={handleNavigate}
            onRename={handleRename}
            onDelete={handleDelete}
            onUpdate={onBookmarkUpdate}
            numPages={numPages}
            isSelected={selectedBookmarkId === item.id}
            onSelect={setSelectedBookmarkId}
            recentlyDropped={recentlyDroppedId === item.id}
          />
        </div>
      );
    }
  };

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
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={getAllItemIds} strategy={verticalListSortingStrategy}>
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
              <>
                {bookmarkTree.map((item, index) => renderBookmarkItem(item, index))}
                <DropSlot
                  id={createSlotId(null, bookmarkTree.length)}
                  parentId={null}
                  index={bookmarkTree.length}
                />
              </>
            )}
          </SortableContext>

          {activeItem && (
            <DragOverlay>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderRadius: '8px',
                border: '2px solid #4A90E2',
                background: 'rgba(43, 43, 43, 0.9)',
                padding: '12px',
                boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(4px)',
                fontSize: '16px',
                color: '#4A90E2',
              }}>
                ☰
                {activeItem.type === 'folder' ? (
                  <>
                    <Icon name="folder" size={16} color="#999" />
                    <span style={{ fontWeight: '600', color: '#ddd' }}>{activeItem.name}</span>
                  </>
                ) : (
                  <span style={{ fontWeight: '500', color: '#ddd' }}>{activeItem.name}</span>
                )}
              </div>
            </DragOverlay>
          )}
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
