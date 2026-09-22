/**
 * BookmarksPanel.jsx — sidebar panel for the PDF bookmark tree (create, rename, reorder, navigate).
 *
 * Default export BookmarksPanel renders a @dnd-kit sortable, nestable tree
 * (BookmarkTreeRow rows) with folders/bookmarks, drag-to-reparent with projection,
 * auto-expand-on-hover, and group/page navigation via onNavigateToPage. Calls
 * onBookmarkCreate/Update/Delete to mutate the flat bookmarks array owned by App.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { showToast } from '../utils/toast';
import Icon from '../Icons';
import DismissBarrier from '../components/DismissBarrier';
import { prepareAtomicBookmarkEdit } from './bookmarkEditUtils.js';
import {
  BOOKMARK_INDENTATION_WIDTH,
  GROUP_AUTO_EXPAND_OFFSET_PX,
  applyBookmarkTreeProjection,
  flattenBookmarkTreeForSort,
  getAutoExpandTargetFolder,
  getBookmarkProjection,
  mergeDragHandleProps,
  removeChildrenOf,
} from './bookmarkReorderUtils.js';
import { useTooltip } from '../components/Tooltip';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const BOOKMARK_TREE_CONTENT_WIDTH = 252;
const GROUP_AUTO_EXPAND_DELAY_MS = 420;
const GROUP_COLLAPSE_ANIMATION_MS = 240;
const GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS = 70;
const GROUP_POST_COLLAPSE_LAYOUT_LOCK_MS = 260;
const bookmarkTreeMeasuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

// Mobile row indent per tree depth (demo BookmarkRow.tsx / styles.ts:1306-1391).
// Narrower than the desktop BOOKMARK_INDENTATION_WIDTH because the phone row is
// only ~315px wide; the drag PROJECTION still uses the desktop width so the
// nesting maths is identical on both.
const MOBILE_BOOKMARK_INDENT_PX = 14;

/*
 * UX 2026-09-17 — owner ruling: "The bookmarks section on the phone is not like
 * it is in the web version, where you can drag and drop." Touch drag must start
 * on a long press, never immediately: the phone rows live inside a scrolling
 * bottom sheet, so an immediate touch activation would swallow the plain
 * vertical swipe that scrolls the list and the plain tap that jumps to the page.
 * 250ms / 5px is the iOS "lift to reorder" feel. Reference behaviour matched:
 * the desktop tree's drag result (reorder + reparent-into-folder projection),
 * only the activation gesture differs. Desktop keeps its immediate PointerSensor.
 */
export const MOBILE_BOOKMARK_DRAG_ACTIVATION = { delay: 250, tolerance: 5 };

// Helper to generate unique IDs
const generateId = () => crypto.randomUUID();

const BookmarkTreeRow = ({
  item,
  depth,
  projectedDepth,
  activeDepth,
  cloneWidthOverride = null,
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

  // KAL-65: sidebar controls use the app's instant shared tooltip, never a
  // native title= (the OS tooltip takes ~1.5s and is OS-styled, so mixing the
  // two showed users two different tooltips on the same control).
  const tip = useTooltip();
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
  const cloneWidth = cloneWidthOverride ?? (BOOKMARK_TREE_CONTENT_WIDTH - cloneBaseInset);
  const dragTranslateY = transform?.y ?? 0;
  const isActiveRow = isDragging && !isClone;
  const sortableTransform = isActiveRow
    ? CSS.Translate.toString({ x: 0, y: dragTranslateY, scaleX: 1, scaleY: 1 })
    : isGroupAnimationActive
      ? undefined
      : CSS.Translate.toString(transform);

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
      showToast(numPages ? `Please enter a page number between 1 and ${numPages}.` : 'Please enter a valid page number.', 'warn');
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
        padding: '1px 0',
        opacity: isDragging && !isClone ? 0.92 : 1,
        position: 'relative',
        width: isClone ? `${cloneWidth}px` : 'auto',
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
          gap: 3,
          height: 31,
          padding: '3px 4px',
          borderRadius: 5,
          background: isClone ? 'var(--surface-2)' : isSelected ? 'var(--surface-3)' : 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          boxShadow: isClone ? '0 12px 24px rgba(0,0,0,0.32)' : 'none',
          cursor: isEditMode ? 'default' : 'pointer',
          pointerEvents: isSorting ? 'none' : undefined,
          marginLeft: isClone ? `${cloneRelativeInset}px` : isActiveRow ? `${rowInset}px` : undefined,
          width: isClone
            ? `calc(100% - ${cloneRelativeInset}px)`
            : isActiveRow
              ? `calc(100% - ${rowInset}px)`
              : '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(event) => {
          if (!isSelected && !isClone) event.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(event) => {
          if (!isSelected && !isClone) event.currentTarget.style.background = 'var(--surface-1)';
        }}
      >
        <div
          {...mergeDragHandleProps(tip('Drag to reorder', 'below'), handleProps)}
          style={{
            width: 18,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-3)',
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
          {...tip((isCollapsed || isVisuallyCollapsed) ? 'Expand group' : 'Collapse group', 'below')}
          style={{
            width: 16,
            height: 18,
            border: 0,
            padding: 0,
            background: 'transparent',
            color: isFolder && item.children?.length ? 'var(--text-3)' : 'transparent',
            cursor: isFolder && item.children?.length && !isClone ? 'pointer' : 'default',
            transform: (isCollapsed || isVisuallyCollapsed) ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: `transform ${GROUP_COLLAPSE_ANIMATION_MS}ms ease`,
            flexShrink: 0,
          }}
        >
          ▾
        </button>
        <Icon name={isFolder ? 'folder' : 'bookmark'} size={11} color={isFolder ? '#7ab7e6' : 'var(--text-3)'} />
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
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              borderRadius: 5,
              height: 22,
              padding: '0 6px',
              fontSize: 11,
              outline: 'none',
              fontFamily: FONT_FAMILY,
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: 'var(--text-2)',
              fontSize: 12,
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
                width: 34,
                background: 'var(--surface-0)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
                borderRadius: 5,
                height: 22,
                padding: '0 5px',
                fontSize: 11,
                textAlign: 'center',
                outline: 'none',
                fontFamily: FONT_FAMILY,
              }}
            />
          ) : (
            item.pageIds?.[0] ? (
              <span style={{ width: 36, color: 'var(--text-3)', fontSize: 10, textAlign: 'right', flexShrink: 0, userSelect: 'none' }}>
                P {item.pageIds[0]}
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
            {...tip('Add bookmark to group', 'below')}
            aria-label="Add bookmark to group"
            style={{
              width: 24,
              height: 22,
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              color: '#7ab7e6',
              borderRadius: 5,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="plus" size={11} color="#7ab7e6" />
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
            {...tip('Delete', 'below')}
            aria-label="Delete"
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
            <Icon name="trash" size={12} color="var(--danger)" />
          </button>
        )}
        {isClone && childCount > 1 && (
          <span style={{
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'var(--accent-text)',
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

/*
 * MobileBookmarkRow — the phone sheet's bookmark/folder row.
 *
 * UX 2026-09-17 (owner ruling: the phone bookmarks list must drag and drop the
 * way the web one does): this is the SAME @dnd-kit sortable row as the desktop
 * tree — same item ids, same SortableContext, same projection, so a drag ends
 * with the same reorder / reparent-into-folder result — wearing the demo's
 * touch-sized mobile skin. Only two things differ from desktop:
 *   1. activation is a long press on the grip (MOBILE_BOOKMARK_DRAG_ACTIVATION),
 *      so a plain vertical swipe still scrolls the sheet list and a plain tap
 *      still jumps to the page;
 *   2. the row indents by MOBILE_BOOKMARK_INDENT_PX per depth instead of the
 *      desktop width, because the phone row is only ~315px wide.
 * The grip is deliberately the same ☰ affordance the desktop row uses, and its
 * hit area is padded out to 44px via ::before so the row height never changes.
 *
 * The sheet's own drag-to-dismiss cannot fight this: useMobileSheetMotion's
 * touch handlers are attached only to the 35px grab-handle strip at the top of
 * the sheet (PDFSidebar.jsx), never to the panel content, so a touch that
 * starts on a bookmark row never reaches them. No opt-out hook is needed.
 *
 * UX 2026-09-22 (owner ruling) — the row carries NO up/down reorder buttons.
 * Long-press drag is the only reorder path on the phone; two chevrons beside a
 * working drag handle were redundant chrome on a 315px row, and they could only
 * ever swap same-parent siblings, never reparent. Accessibility is preserved
 * because the grip spreads @dnd-kit's `attributes` (role="button", tabIndex 0),
 * so the KeyboardSensor in `mobileSensors` still reorders with Space + arrows.
 * The desktop tree never had these arrows, so nothing changes there.
 */
const MobileBookmarkRow = ({
  item,
  depth,
  projectedDepth,
  isDraggingAny,
  onToggle,
  onNavigate,
  onEdit,
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
  } = useSortable({
    id: item.id,
    animateLayoutChanges: ({ isSorting, wasDragging }) => !(isSorting || wasDragging),
  });

  const isFolder = item.type === 'folder';
  const rowDepth = projectedDepth ?? depth;
  const pageLabel = isFolder
    ? 'Folder'
    : (item.pageIds?.[0] ? `Page ${item.pageIds[0]}` : 'Bookmark');

  return (
    <div
      ref={setDroppableNodeRef}
      data-bookmark-row-id={item.id}
      className="mobile-bookmark-slot"
      style={{ marginLeft: rowDepth * MOBILE_BOOKMARK_INDENT_PX }}
    >
      <div
        ref={setDraggableNodeRef}
        className={`mobile-bookmark-row${isDragging ? ' is-dragging' : ''}`}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
        }}
      >
        <div
          className="mobile-bookmark-grip"
          aria-label={`Drag to reorder ${item.name}`}
          {...attributes}
          {...listeners}
          // touch-action stays `manipulation` while idle so a swipe that happens
          // to start on the grip still scrolls the list; it flips to `none` for
          // the duration of a drag so the browser cannot pan underneath it.
          style={{ touchAction: isDraggingAny ? 'none' : 'manipulation' }}
          onClick={(event) => event.stopPropagation()}
        >
          ☰
        </div>
        <button
          type="button"
          className="mobile-bookmark-open"
          aria-label={isFolder ? `Toggle ${item.name}` : `Open bookmark ${item.name}`}
          onClick={() => {
            if (isFolder) {
              onToggle?.(item.id);
              return;
            }
            onNavigate?.(item);
          }}
        >
          <span className="mobile-bookmark-bubble">
            <Icon name={isFolder ? 'layers' : 'bookmark'} size={13} color={isFolder ? '#8fb7ff' : '#a8b0bf'} />
          </span>
          <span className="mobile-bookmark-copy">
            <span className="mobile-bookmark-title">{item.name}</span>
            <span className="mobile-bookmark-meta">{pageLabel} · PDF outline</span>
          </span>
        </button>
        <div className="mobile-bookmark-moves">
          {!isFolder && (
            <button
              type="button"
              className="mobile-bookmark-move"
              aria-label={`Edit bookmark ${item.name}`}
              onClick={() => onEdit?.(item)}
            >
              <Icon name="edit" size={13} color="currentColor" />
            </button>
          )}
          <button
            type="button"
            className="mobile-bookmark-move mobile-bookmark-delete"
            aria-label={`Delete bookmark ${item.name}`}
            onClick={() => onDelete?.(item.id)}
          >
            <Icon name="trash" size={13} color="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
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
  rowDragFeel = false,
  // UX 2026-07-12 — mobileMode swaps the desktop @dnd-kit bookmark tree for the
  // demo's touch-sized bookmark rows (min-height 38, depth·14 indent, icon
  // bubbles, up/down move buttons; BookmarkRow.tsx / styles.ts:1306-1391) inside
  // the bottom sheet. Reuses the same navigate + onBookmarkUpdate(order) paths as
  // desktop; no new store writes. Desktop rendering is untouched.
  mobileMode = false
}) => {
  const tip = useTooltip();
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(initialExpandedFolders));
  const [selectedBookmarkId, setSelectedBookmarkId] = useState(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(initialEditMode);
  const [newBookmarkName, setNewBookmarkName] = useState('');
  const [newBookmarkPages, setNewBookmarkPages] = useState('');
  // Phone-only "New folder" inline editor (owner ruling 2026-09-22).
  const [showMobileFolderEditor, setShowMobileFolderEditor] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [mobileEditingBookmarkId, setMobileEditingBookmarkId] = useState(null);
  const [mobileEditName, setMobileEditName] = useState('');
  const [mobileEditPage, setMobileEditPage] = useState('');
  const [showBookmarkGroupModal, setShowBookmarkGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupBookmarks, setGroupBookmarks] = useState([]);
  const [showAddToGroupModal, setShowAddToGroupModal] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState(null);
  const [addToGroupBookmarks, setAddToGroupBookmarks] = useState([]);
  const menuRef = useRef(null);
  const createMenuInsideRefs = useMemo(() => [menuRef], []);

  // Drag-and-drop state
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [dragMotionTick, setDragMotionTick] = useState(0);
  const [collapsingFolderIds, setCollapsingFolderIds] = useState([]);
  const [expandingFolderIds, setExpandingFolderIds] = useState([]);
  const [collapseLayoutLock, setCollapseLayoutLock] = useState(false);
  const [optimisticBookmarkTree, setOptimisticBookmarkTree] = useState(null);

  const collapseTimeoutsRef = useRef(new Map());
  const expandTimeoutsRef = useRef(new Map());
  const collapseLayoutLockTimeoutRef = useRef(null);
  const autoExpandedFoldersRef = useRef(new Set());
  const autoExpandTimerRef = useRef(null);
  const autoExpandFolderRef = useRef(null);
  const pointerPositionRef = useRef(null);
  const pointerMoveListenerRef = useRef(null);
  const collapsedDragFolderIdRef = useRef(null);

  // Desktop: pointer drag engages immediately (unchanged).
  const sensors = useSensors(useSensor(PointerSensor, {}), useSensor(KeyboardSensor, {}));
  // Phone: a single PointerSensor cannot hold a touch-only activation
  // constraint (a delay there would also lag the mouse), so the mobile sheet
  // uses the Mouse + Touch pair instead — mouse stays immediate (a desktop
  // browser sitting in the phone layout), touch waits for the long press.
  const mobileSensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, { activationConstraint: MOBILE_BOOKMARK_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, {}),
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

  const bookmarkTree = useMemo(() => {
    const applyCollapseState = (items) => items.map((item) => {
      const children = applyCollapseState(item.children || []);
      return {
        ...item,
        children,
        collapsed: item.type === 'folder' && children.length ? !expandedFolders.has(item.id) : undefined,
      };
    });
    return applyCollapseState(optimisticBookmarkTree ?? buildTree(bookmarks || []));
  }, [bookmarks, buildTree, expandedFolders, optimisticBookmarkTree]);

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
  const restrictBookmarkTreeDrag = useMemo(() => ({ active, transform }) => {
    const minimumX = -((activeSortableItem?.depth ?? 0) * BOOKMARK_INDENTATION_WIDTH);
    const activeRow = active?.id
      ? document.querySelector(`[data-bookmark-row-id="${active.id}"]`)
      : null;
    const listNode = activeRow?.closest?.('[data-bookmark-tree-list]');

    if (!activeRow || !listNode) {
      return {
        ...transform,
        x: Math.max(transform.x, minimumX),
      };
    }

    const rowRects = Array.from(listNode.querySelectorAll('[data-bookmark-row-id]'))
      .map((row) => ({
        top: row.offsetTop,
        bottom: row.offsetTop + row.offsetHeight,
      }))
      .filter((rect) => rect.bottom > rect.top);

    if (!rowRects.length) {
      return {
        ...transform,
        x: Math.max(transform.x, minimumX),
      };
    }

    const top = Math.min(...rowRects.map((rect) => rect.top));
    const bottom = Math.max(...rowRects.map((rect) => rect.bottom));

    return {
      ...transform,
      x: Math.max(transform.x, minimumX),
      y: Math.min(
        Math.max(transform.y, top - activeRow.offsetTop),
        bottom - (activeRow.offsetTop + activeRow.offsetHeight)
      ),
    };
  }, [activeSortableItem?.depth]);
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

  const getDescendantFolderIds = useCallback((folderId, sourceTree = bookmarkTree) => {
    const rootItem = findItem(folderId, sourceTree)?.item;
    const descendantIds = [];

    const collect = (items = []) => {
      items.forEach((item) => {
        if (item.type === 'folder') {
          descendantIds.push(item.id);
        }
        if (item.children?.length) {
          collect(item.children);
        }
      });
    };

    collect(rootItem?.children || []);
    return descendantIds;
  }, [bookmarkTree, findItem]);

  const expandFolderOnly = useCallback((folderId, sourceTree = bookmarkTree) => {
    if (!folderId) return;
    const descendantFolderIds = getDescendantFolderIds(folderId, sourceTree);

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      descendantFolderIds.forEach((descendantId) => next.delete(descendantId));
      next.add(folderId);
      return next;
    });
    setExpandingFolderIds((ids) => ids.filter((id) => !descendantFolderIds.includes(id)));
    setCollapsingFolderIds((ids) => ids.filter((id) => !descendantFolderIds.includes(id)));
  }, [bookmarkTree, getDescendantFolderIds]);

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
    expandFolderOnly(folderId);
    setExpandingFolderIds((ids) => [...new Set([...ids, folderId])]);
    const timeout = setTimeout(() => {
      setExpandingFolderIds((ids) => ids.filter((id) => id !== folderId));
      expandTimeoutsRef.current.delete(folderId);
    }, GROUP_COLLAPSE_ANIMATION_MS);
    expandTimeoutsRef.current.set(folderId, timeout);
  }, [animateCollapseFolders, expandedFolders, expandFolderOnly]);

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
    const activeItem = flattenedItems.find((item) => item.id === active.id);
    if (
      activeItem?.type === 'folder' &&
      activeItem.children?.length > 0 &&
      expandedFolders.has(active.id)
    ) {
      collapsedDragFolderIdRef.current = active.id;
      setExpandedFolders((prev) => {
        if (!prev.has(active.id)) return prev;
        const next = new Set(prev);
        next.delete(active.id);
        return next;
      });
      setCollapsingFolderIds((ids) => ids.filter((id) => id !== active.id));
      setExpandingFolderIds((ids) => ids.filter((id) => id !== active.id));
    }
    setActiveId(active.id);
    setOverId(active.id);
    setDragMotionTick(0);
    autoExpandedFoldersRef.current.clear();
    // The TouchSensor's activator is a TouchEvent, which carries no clientX/Y of
    // its own — read the first touch so hover-to-auto-expand works on the phone
    // exactly as it does under the mouse.
    const activatorTouch = activatorEvent?.touches?.[0] ?? activatorEvent?.changedTouches?.[0] ?? null;
    if (typeof activatorEvent?.clientX === 'number' && typeof activatorEvent?.clientY === 'number') {
      pointerPositionRef.current = { x: activatorEvent.clientX, y: activatorEvent.clientY };
    } else if (activatorTouch) {
      pointerPositionRef.current = { x: activatorTouch.clientX, y: activatorTouch.clientY };
    }
    pointerMoveListenerRef.current = (event) => {
      const touch = event.touches?.[0];
      if (touch) {
        pointerPositionRef.current = { x: touch.clientX, y: touch.clientY };
        return;
      }
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', pointerMoveListenerRef.current, { passive: true });
    window.addEventListener('mousemove', pointerMoveListenerRef.current, { passive: true });
    window.addEventListener('touchmove', pointerMoveListenerRef.current, { passive: true });
    document.body.style.setProperty('cursor', 'grabbing');
  }, [expandedFolders, flattenedItems]);

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
      window.removeEventListener('touchmove', pointerMoveListenerRef.current);
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
    const draggedCollapsedFolderId = collapsedDragFolderIdRef.current;
    collapsedDragFolderIdRef.current = null;
    const finalParentId = projected?.parentId ?? null;
    const foldersToRecollapse = autoExpandedFolderIds.filter((folderId) => folderId !== finalParentId);

    if (projected && over) {
      const { parentId } = projected;
      const nextTree = applyBookmarkTreeProjection(bookmarkTree, active.id, over.id, projected);
      if (nextTree !== bookmarkTree) {
        setOptimisticBookmarkTree(nextTree);
        persistBookmarkTree(nextTree);
        if (parentId) {
          expandFolderOnly(parentId, nextTree);
        }
      }
    }

    resetDragState();
    if (draggedCollapsedFolderId) {
      setTimeout(() => {
        expandFolderOnly(draggedCollapsedFolderId);
      }, GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS);
    }
    if (foldersToRecollapse.length) {
      setTimeout(() => {
        animateCollapseFolders(foldersToRecollapse);
      }, GROUP_DRAG_SETTLE_COLLAPSE_DELAY_MS);
    }
  }, [animateCollapseFolders, bookmarkTree, expandFolderOnly, persistBookmarkTree, projected, resetDragState]);

  const handleDragCancel = useCallback(() => {
    const foldersToRecollapse = Array.from(autoExpandedFoldersRef.current);
    const draggedCollapsedFolderId = collapsedDragFolderIdRef.current;
    collapsedDragFolderIdRef.current = null;
    resetDragState();
    if (draggedCollapsedFolderId) {
      expandFolderOnly(draggedCollapsedFolderId);
    }
    animateCollapseFolders(foldersToRecollapse);
  }, [animateCollapseFolders, expandFolderOnly, resetDragState]);

  useEffect(() => () => {
    clearAutoExpandTimer();
    collapseTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    expandTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    if (collapseLayoutLockTimeoutRef.current) clearTimeout(collapseLayoutLockTimeoutRef.current);
  }, [clearAutoExpandTimer]);

  useEffect(() => {
    if (!optimisticBookmarkTree || activeId) return undefined;

    const timeout = setTimeout(() => {
      setOptimisticBookmarkTree(null);
    }, 220);

    return () => clearTimeout(timeout);
  }, [activeId, bookmarks, optimisticBookmarkTree]);

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
      expandFolderOnly(autoExpandTarget.id);
      setExpandingFolderIds((ids) => [...new Set([...ids, autoExpandTarget.id])]);
      setTimeout(() => {
        setExpandingFolderIds((ids) => ids.filter((id) => id !== autoExpandTarget.id));
      }, GROUP_COLLAPSE_ANIMATION_MS);
      autoExpandTimerRef.current = null;
      autoExpandFolderRef.current = null;
    }, GROUP_AUTO_EXPAND_DELAY_MS);
  }, [activeId, clearAutoExpandTimer, dragMotionTick, expandFolderOnly, flattenedItems, getAutoExpandTargetFromPointer, offsetLeft, overId]);

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

    expandFolderOnly(folderId);

    onBookmarkCreate({
      id: generateId(),
      name: 'New bookmark',
      type: 'bookmark',
      pageIds: initialPage ? [initialPage] : [],
      parentId: folderId,
      order: nextOrder,
    });
  }, [bookmarkTree, expandFolderOnly, findItem, numPages, onBookmarkCreate, pageNum]);

  const handleDelete = useCallback((id) => {
    if (onBookmarkDelete) {
      onBookmarkDelete(id);
    }
  }, [onBookmarkDelete]);

  /*
   * UX 2026-09-22 (owner ruling) — "New folder" on the phone.
   *
   * Desktop's only folder route is the "New bookmark group" MODAL, which refuses
   * to save until the group already contains at least one bookmark. That flow
   * needs a two-column picker and cannot fit a phone sheet, and the owner asked
   * for the drag-first shape instead: make an EMPTY, named folder, then long-press
   * an existing bookmark onto it to nest. So the phone gets an inline name field
   * (the same one-line editor the phone already uses for "Add bookmark") and
   * writes exactly the record the desktop modal writes for its folder —
   * { type: 'folder', children: [] } through onBookmarkCreate. No new store, no
   * new shape: folders are just rows in the same flat `bookmarks` array, carried
   * by the same create/update/delete handlers in PDFViewer, so persistence and
   * sync treat a phone-made folder exactly as they treat a desktop-made one.
   *
   * The folder lands at root with the next free root `order`, so it appears at
   * the bottom of the list where the user just created it.
   */
  const handleCreateMobileFolder = useCallback(() => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      showToast('Please enter a folder name.', 'warn');
      return;
    }
    if (!onBookmarkCreate) return;

    const rootOrders = (bookmarks || [])
      .filter((b) => !b?.parentId)
      .map((b) => (typeof b?.order === 'number' ? b.order : 0));
    const nextOrder = rootOrders.length ? Math.max(...rootOrders) + 1 : 0;

    onBookmarkCreate({
      id: generateId(),
      name: trimmedName,
      type: 'folder',
      parentId: null,
      order: nextOrder,
      children: [],
    });

    setNewFolderName('');
    setShowMobileFolderEditor(false);
  }, [bookmarks, newFolderName, onBookmarkCreate]);

  // Existing create/modal handlers remain the same
  const handleCreateBookmark = useCallback(() => {
    const trimmedName = newBookmarkName.trim();
    if (!trimmedName) return;

    const trimmedPage = newBookmarkPages.trim();
    if (!trimmedPage) {
      showToast('Please enter a page number.', 'warn');
      return;
    }

    const pageNumber = parseInt(trimmedPage, 10);
    if (isNaN(pageNumber) || pageNumber < 1) {
      showToast('Please enter a valid page number.', 'warn');
      return;
    }

    if (numPages && pageNumber > numPages) {
      showToast(`Please enter a page number between 1 and ${numPages}.`, 'warn');
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

  const beginMobileBookmarkEdit = useCallback((item) => {
    setMobileEditingBookmarkId(item.id);
    setMobileEditName(item.name || '');
    setMobileEditPage(item.pageIds?.[0]?.toString() || '');
  }, []);

  const saveMobileBookmarkEdit = useCallback((item) => {
    const result = prepareAtomicBookmarkEdit({
      bookmarks,
      bookmark: item,
      name: mobileEditName,
      page: mobileEditPage,
      numPages,
    });
    if (!result.ok) {
      showToast(result.error, 'warn');
      return;
    }
    onBookmarkUpdate?.(item.id, result.updates);
    setMobileEditingBookmarkId(null);
  }, [bookmarks, mobileEditName, mobileEditPage, numPages, onBookmarkUpdate]);

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
      showToast('Please enter a name for the bookmark group', 'warn');
      return;
    }

    if (groupBookmarks.length === 0) {
      showToast('Please add at least one bookmark to the group', 'warn');
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
      showToast('Please ensure all new bookmarks have both a name and a valid page number within the PDF page range.', 'warn');
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
      id: `temp-${crypto.randomUUID()}`,
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
      id: `temp-${crypto.randomUUID()}`,
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
      showToast('Please add at least one bookmark to the group', 'warn');
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
      showToast('Please ensure all new bookmarks have both a name and a valid page number within the PDF page range.', 'warn');
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

  if (mobileMode) {
    // UX 2026-07-12 — Mobile bookmark list. Flat, touch-sized rows that mirror the
    // demo (BookmarkRow.tsx / HubTray bookmarks branch). flattenedItems already
    // honours folder collapse state and carries per-row depth. Tapping a folder
    // toggles it; tapping a bookmark navigates via the same handleNavigate path as
    // desktop. UX 2026-09-22 (owner ruling): reordering is long-press drag only —
    // the old up/down chevrons are gone, and "New folder" in the action row makes
    // an empty folder to drag bookmarks into.
    // Note: the demo's markerId→survey jump does not apply here — the new app's
    // Bookmarks tab is the PDF outline (page-anchored), with no survey markerId and
    // no survey-open handler threaded to this panel, so page navigation is the
    // correct real behavior.
    return (
      <DndContext
        sensors={mobileSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictBookmarkTreeDrag]}
        measuring={bookmarkTreeMeasuring}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <div
        className={`mobile-bookmark-list${activeId ? ' is-dragging-active' : ''}`}
        data-bookmark-tree-list
      >
        <div className="mobile-bookmark-toolbar">
          {/* UX 2026-09-22 (owner ruling): folder creation lives in the phone
              panel's own action row, beside "Add bookmark". It is a neutral
              pill whose glyph turns gold while its name field is open — the
              app's phone control language (gold glyph marks the active
              control, never a gold fill). */}
          <button
            type="button"
            className={`mobile-bookmark-newfolder${showMobileFolderEditor ? ' is-active' : ''}`}
            aria-label={showMobileFolderEditor ? 'Cancel new folder' : 'New folder'}
            aria-expanded={showMobileFolderEditor}
            onClick={() => {
              setShowMobileFolderEditor((shown) => !shown);
              setNewFolderName('');
              setShowCreateMenu(false);
            }}
          >
            <Icon name={showMobileFolderEditor ? 'close' : 'folder'} size={13} color="currentColor" />
            {showMobileFolderEditor ? 'Cancel' : 'New folder'}
          </button>
          <button
            type="button"
            className="mobile-bookmark-add"
            aria-label={showCreateMenu ? 'Cancel new bookmark' : 'Add bookmark'}
            onClick={() => {
              setShowCreateMenu((shown) => !shown);
              setShowMobileFolderEditor(false);
            }}
          >
            <Icon name={showCreateMenu ? 'close' : 'plus'} size={13} color="currentColor" />
            {showCreateMenu ? 'Cancel' : 'Add bookmark'}
          </button>
        </div>
        {showMobileFolderEditor && (
          <div className="mobile-bookmark-editor mobile-bookmark-editor-folder" aria-label="New folder">
            <input
              type="text"
              aria-label="Folder name"
              value={newFolderName}
              placeholder="Folder name"
              autoFocus
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreateMobileFolder();
                if (event.key === 'Escape') {
                  setNewFolderName('');
                  setShowMobileFolderEditor(false);
                }
              }}
            />
            <button type="button" onClick={handleCreateMobileFolder}>Create folder</button>
          </div>
        )}
        {showCreateMenu && (
          <div className="mobile-bookmark-editor" aria-label="New bookmark">
            <input
              type="text"
              aria-label="Bookmark name"
              value={newBookmarkName}
              placeholder="Bookmark name"
              onChange={(event) => setNewBookmarkName(event.target.value)}
            />
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max={numPages || undefined}
              aria-label="Bookmark page"
              value={newBookmarkPages}
              placeholder="Page"
              onChange={(event) => setNewBookmarkPages(event.target.value)}
            />
            <button type="button" onClick={handleCreateBookmark}>Create</button>
          </div>
        )}
        {flattenedItems.length === 0 ? (
          <div className="mobile-bookmark-empty">
            <Icon name="bookmark" size={20} color="var(--text-3)" />
            <span>No bookmarks yet</span>
          </div>
        ) : (
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
          {flattenedItems.map((item) => {
            const isFolder = item.type === 'folder';
            const depth = item.depth || 0;
            return (
              mobileEditingBookmarkId === item.id && !isFolder ? (
                <div
                  key={item.id}
                  className="mobile-bookmark-editor mobile-bookmark-editor-existing"
                  aria-label={`Edit bookmark ${item.name}`}
                  style={{ marginLeft: depth * 14 }}
                >
                  <input
                    type="text"
                    aria-label="Bookmark name"
                    value={mobileEditName}
                    onChange={(event) => setMobileEditName(event.target.value)}
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={numPages || undefined}
                    aria-label="Bookmark page"
                    value={mobileEditPage}
                    onChange={(event) => setMobileEditPage(event.target.value)}
                  />
                  <button type="button" onClick={() => saveMobileBookmarkEdit(item)}>Save</button>
                  <button type="button" className="secondary" onClick={() => setMobileEditingBookmarkId(null)}>Cancel</button>
                </div>
              ) : (
                <MobileBookmarkRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  projectedDepth={item.id === activeId && projected ? projected.depth : null}
                  isDraggingAny={Boolean(activeId)}
                  onToggle={toggleExpand}
                  onNavigate={handleNavigate}
                  onEdit={beginMobileBookmarkEdit}
                  onDelete={handleDelete}
                />
              )
            );
          })}
          </SortableContext>
        )}
      </div>
      </DndContext>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: FONT_FAMILY,
      background: 'var(--surface-1)'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        height: '50px',
        boxSizing: 'border-box',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: '600',
          color: 'var(--text-2)'
        }}>
          Bookmarks
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            style={{
              height: '26px',
              /* UX: this button must answer the pointer. It rests one step
                 below its own hover (--surface-2 -> --surface-3), exactly like
                 the five secondary buttons further down this panel; the gold
                 "Done" state rests on --accent and hovers to --accent-light,
                 the gold hover step tokens.css defines. */
              background: isEditMode ? 'var(--accent)' : 'var(--surface-2)',
              color: isEditMode ? 'var(--accent-text)' : 'var(--text-2)',
              border: 'none',
              borderRadius: '6px',
              padding: '0 10px',
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
                e.currentTarget.style.background = 'var(--hover)';
              } else {
                e.currentTarget.style.background = 'var(--accent-light)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isEditMode) {
                e.currentTarget.style.background = 'var(--surface-2)';
              } else {
                e.currentTarget.style.background = 'var(--accent)';
              }
            }}
          >
            <Icon name="edit" size={12} color={isEditMode ? 'var(--accent-text)' : 'var(--text-2)'} />
            {isEditMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Bookmarks List with Drag-and-Drop */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px',
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
              max-height: 33px;
              padding-top: 1px;
              padding-bottom: 1px;
            }
          }

          @keyframes bookmarkGroupCollapse {
            from {
              opacity: 1;
              max-height: 33px;
              padding-top: 1px;
              padding-bottom: 1px;
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
          modifiers={[restrictBookmarkTreeDrag]}
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
                color: 'var(--text-3)',
                fontSize: '13px'
              }}>
                No bookmarks yet. Create one to get started.
              </div>
            ) : (
              <div data-bookmark-tree-list style={{ margin: 0, padding: 0 }}>
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
        </DndContext>
      </div>

      {/* Add Button at Bottom */}
      <div style={{
        padding: '12px',
        background: 'var(--surface-1)',
        borderTop: '1px solid var(--border)'
      }}>
        <div style={{ position: 'relative' }} ref={menuRef}>
          <DismissBarrier
            active={showCreateMenu}
            insideRefs={createMenuInsideRefs}
            onDismiss={() => setShowCreateMenu(false)}
          />
          <button
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            style={{
              width: '100%',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
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
            /* UX: a gold control hovers UP to --accent-light and only presses
               DOWN to --accent-press (tokens.css "HOW STATES ARE BUILT"). This
               used to darken on hover, which reads as already-pressed. */
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-light)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
          >
            <Icon name="plus" size={14} color="var(--accent-text)" />
            Add bookmark
          </button>
          {showCreateMenu && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: '4px',
              background: 'var(--surface-3)',
              border: '1px solid var(--border-strong)',
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
                  color: 'var(--text-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <Icon name="folder" size={14} color="var(--text-3)" />
                New bookmark group
              </button>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                <input
                  type="text"
                  placeholder="Bookmark name"
                  value={newBookmarkName}
                  onChange={(e) => setNewBookmarkName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                />
                <input
                  type="text"
                  placeholder="Page number"
                  value={newBookmarkPages}
                  onChange={(e) => handleNewBookmarkPageChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    outline: 'none',
                    transition: 'border-color 0.15s ease'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '8px',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                >
                  Current page
                </button>
                <button
                  onClick={handleCreateBookmark}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: 'var(--accent)',
                    /* UX: the label ON a gold fill is --accent-text. --text-1 on
                       --accent-light measures 1.5:1; --accent-text is 8.6:1. */
                    color: 'var(--accent-text)',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-light)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
                >
                  Create bookmark
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
          // UX (KAL-62): the app's one modal scrim — warm-dark dim plus an 8px
          // blur, identical to every other dialog, so this one no longer reads
          // as heavier and colder than the rest.
          background: 'rgba(13, 15, 20, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }} onClick={() => setShowBookmarkGroupModal(false)}>
          <div style={{
            background: 'var(--surface-1)',
            borderRadius: '12px',
            padding: '24px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border)',
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
                color: 'var(--text-2)'
              }}>
                Create bookmark group
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
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
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
                color: 'var(--text-3)',
                marginBottom: '8px'
              }}>
                Group name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter bookmark group name"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                  color: 'var(--text-3)'
                }}>
                  Bookmarks ({groupBookmarks.length})
                </label>
                <button
                  onClick={handleAddNewBookmark}
                  style={{
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
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
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                >
                  <Icon name="plus" size={12} />
                  New bookmark
                </button>
              </div>

              <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--surface-1)'
              }}>
                {groupBookmarks.length === 0 ? (
                  <div style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: 'var(--text-disabled)',
                    fontSize: '13px'
                  }}>
                    No bookmarks added yet. Add existing bookmarks or create new ones.
                  </div>
                ) : (
                  groupBookmarks.map((bookmark, index) => (
                    <div key={index} style={{
                      padding: '12px',
                      borderBottom: index < groupBookmarks.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start'
                    }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {bookmark.isExisting ? (
                          <>
                            <div style={{
                              fontSize: '13px',
                              color: 'var(--text-2)',
                              fontWeight: '500'
                            }}>
                              {bookmark.name}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: 'var(--text-3)'
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
                                background: 'var(--surface-2)',
                                color: 'var(--text-2)',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                                background: 'var(--surface-2)',
                                color: 'var(--text-2)',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          flexShrink: 0
                        }}
                        {...tip('Remove', 'below')}
                        aria-label="Remove"
                        onMouseEnter={(e) => {
                          tip('Remove', 'below').onMouseEnter(e);
                          e.currentTarget.style.background = 'var(--danger-soft)';
                        }}
                        onMouseLeave={(e) => {
                          tip('Remove', 'below').onMouseLeave(e);
                          e.currentTarget.style.background = 'transparent';
                        }}
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
                  color: 'var(--text-3)',
                  marginBottom: '8px'
                }}>
                  Add existing bookmarks
                </label>
                <div style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--surface-1)',
                  padding: '8px'
                }}>
                  {bookmarks.filter(b => b.type === 'bookmark' && !b.parentId).length === 0 ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: 'var(--text-disabled)',
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
                            color: 'var(--text-2)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '4px'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>{bookmark.name}</span>
                          <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>
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
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBookmarkGroup}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent)',
                  /* UX: the label ON a gold fill is --accent-text. --text-1 on
                     --accent-light measures 1.5:1; --accent-text is 8.6:1. */
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-light)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
              >
                Create group
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
          // UX (KAL-62): the app's one modal scrim — warm-dark dim plus an 8px
          // blur, identical to every other dialog, so this one no longer reads
          // as heavier and colder than the rest.
          background: 'rgba(13, 15, 20, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
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
            background: 'var(--surface-1)',
            borderRadius: '12px',
            padding: '24px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border)',
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
                color: 'var(--text-2)'
              }}>
                Add bookmarks to group
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
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
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
                    color: 'var(--text-3)',
                    marginBottom: '8px'
                  }}>
                    Group name
                  </label>
                  <div style={{
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
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
                  color: 'var(--text-3)'
                }}>
                  Bookmarks ({addToGroupBookmarks.length})
                </label>
                <button
                  onClick={handleAddNewBookmarkToGroup}
                  style={{
                    background: 'var(--surface-2)',
                    color: 'var(--text-2)',
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
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                >
                  <Icon name="plus" size={12} />
                  New bookmark
                </button>
              </div>

              <div style={{
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--surface-1)'
              }}>
                {addToGroupBookmarks.length === 0 ? (
                  <div style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: 'var(--text-disabled)',
                    fontSize: '13px'
                  }}>
                    No bookmarks added yet. Add existing bookmarks or create new ones.
                  </div>
                ) : (
                  addToGroupBookmarks.map((bookmark, index) => (
                    <div key={index} style={{
                      padding: '12px',
                      borderBottom: index < addToGroupBookmarks.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start'
                    }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {bookmark.isExisting ? (
                          <>
                            <div style={{
                              fontSize: '13px',
                              color: 'var(--text-2)',
                              fontWeight: '500'
                            }}>
                              {bookmark.name}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: 'var(--text-3)'
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
                                background: 'var(--surface-2)',
                                color: 'var(--text-2)',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                                background: 'var(--surface-2)',
                                color: 'var(--text-2)',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
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
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                          flexShrink: 0
                        }}
                        {...tip('Remove', 'below')}
                        aria-label="Remove"
                        onMouseEnter={(e) => {
                          tip('Remove', 'below').onMouseEnter(e);
                          e.currentTarget.style.background = 'var(--danger-soft)';
                        }}
                        onMouseLeave={(e) => {
                          tip('Remove', 'below').onMouseLeave(e);
                          e.currentTarget.style.background = 'transparent';
                        }}
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
                  color: 'var(--text-3)',
                  marginBottom: '8px'
                }}>
                  Add existing bookmarks
                </label>
                <div style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--surface-1)',
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
                      color: 'var(--text-disabled)',
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
                            color: 'var(--text-2)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '4px'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <span>{bookmark.name}</span>
                          <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>
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
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAddToGroup}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent)',
                  /* UX: the label ON a gold fill is --accent-text. --text-1 on
                     --accent-light measures 1.5:1; --accent-text is 8.6:1. */
                  color: 'var(--accent-text)',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: FONT_FAMILY
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-light)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
              >
                Add bookmarks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookmarksPanel;
