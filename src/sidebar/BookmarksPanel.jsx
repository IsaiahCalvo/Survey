/**
 * BookmarksPanel.jsx — sidebar panel for the PDF bookmark tree (create, rename, reorder, navigate).
 *
 * Default export BookmarksPanel renders a @dnd-kit sortable, nestable tree
 * (BookmarkTreeRow rows) with folders/bookmarks, drag-to-reparent with projection,
 * auto-expand-on-hover, and group/page navigation via onNavigateToPage. Calls
 * onBookmarkCreate/Update/Delete to mutate the flat bookmarks array owned by App.
 */
import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
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
  applyBookmarkTreeProjection,
  buildBookmarkTree,
  createBookmarkDragIntent,
  flattenBookmarkTreeForSort,
  mergeDragHandleProps,
  removeChildrenOf,
  resolveBookmarkDragIntent,
} from './bookmarkReorderUtils.js';
import { CALM_LIST_AUTO_SCROLL } from '../reorder/dragAutoScroll.js';
import { useTooltip } from '../components/Tooltip';
import SectionIconButton, { SectionIconActions } from '../components/SectionIconButton.jsx';

// The one interface font (tokens.css --font-ui, owner 2026-10-02).
const FONT_FAMILY = 'var(--font-ui)';
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

/*
 * UX 2026-10-01 (owner, iPhone: "still a little jitteriness … moving in and
 * out of bookmark groups before committing … super smooth, for any edge
 * case"). Measured frame by frame in headless Chromium (touch + mouse, ±3px
 * tremor), the jitter was not the intent rules but the motion around them:
 *   - the lifted row trailed the finger by one frame (React renders dnd-kit's
 *     move after the frame that delivered it: 20-35px behind on a quick
 *     drag), ~10px more while the list auto-scrolled, and lost the finger when
 *     a folder opened above it;
 *   - a folder that opened mid-drag dropped its children in at once, so every
 *     row under it jumped one row per child in a single frame; on desktop the
 *     open also stripped every row's sortable offset for 240ms, so the parted
 *     rows snapped shut and open again;
 *   - rows, the landing slot and the depth indent moved on three different
 *     clocks (200ms ease / 160ms ease / 120ms ease-out).
 * Now the lifted row is placed from the finger itself every frame
 * (placeLiftedBookmarkRow), a row whose layout moves mid-drag glides from
 * where it was drawn (glideBookmarkLayoutShift; new rows fade in), and every
 * drag motion shares one 180ms ease-out (a retargeted glide never stalls).
 */
const BOOKMARK_DRAG_GLIDE_MS = 180;
const BOOKMARK_DRAG_GLIDE_EASING = 'cubic-bezier(0.25, 0.5, 0.25, 1)';
const BOOKMARK_DRAG_GLIDE = `${BOOKMARK_DRAG_GLIDE_MS}ms ${BOOKMARK_DRAG_GLIDE_EASING}`;
export const BOOKMARK_SORT_TRANSITION = { duration: BOOKMARK_DRAG_GLIDE_MS, easing: BOOKMARK_DRAG_GLIDE_EASING };

// The drawn (transition-current) vertical offset of an element's transform.
const readDrawnTranslateY = (element) => {
  const value = getComputedStyle(element).transform;
  const match = value && value !== 'none' ? /^matrix(3d)?\((.+)\)$/.exec(value) : null;
  if (!match) return 0;
  const parts = match[2].split(',').map(Number);
  return (match[1] ? parts[13] : parts[5]) || 0;
};

// Keep the lifted row exactly under the finger: its top is where the finger
// is, minus where on the row it was grabbed, clamped to the rows' extent. It
// is read from the DOM every frame, so a scroll, a folder opening above it or
// a React render still on its way never moves it off the finger.
const placeLiftedBookmarkRow = (list, live) => {
  if (!list || live.done || live.pointerY == null) return;
  const outers = list.querySelectorAll('[data-bookmark-row-id]');
  if (!outers.length) return;
  const outer = Array.from(outers).find((node) => node.dataset.bookmarkRowId === live.id);
  const row = outer?.firstElementChild;
  if (!row) return;
  const first = outers[0].getBoundingClientRect().top;
  const last = outers[outers.length - 1].getBoundingClientRect().bottom;
  const top = Math.min(Math.max(live.pointerY - live.grabY, first), last - row.offsetHeight);
  row.style.transform = `translate3d(0px, ${Math.round((top - outer.getBoundingClientRect().top) * 10) / 10}px, 0)`;
};

// A row whose layout moved this commit (a folder opened or closed above it)
// starts from where it was drawn and glides to its new place.
const glideBookmarkLayoutShift = (row, shift) => {
  const target = row.style.transform;
  const from = readDrawnTranslateY(row) + shift;
  row.style.transition = 'none';
  row.style.transform = `translate3d(0px, ${from}px, 0)`;
  void row.offsetHeight;
  row.style.transition = `transform ${BOOKMARK_DRAG_GLIDE}`;
  row.style.transform = target;
};

// Mobile row indent per tree depth (demo BookmarkRow.tsx / styles.ts:1306-1391).
// Narrower than the desktop BOOKMARK_INDENTATION_WIDTH because the phone row is
// only ~315px wide; the drag PROJECTION still uses the desktop width so the
// nesting maths is identical on both.
const MOBILE_BOOKMARK_INDENT_PX = 14;

/*
 * UX 2026-09-30 — owner: on the phone a bookmark "won't even pick up" when
 * dragged; drag must work like Projects / Templates everywhere. This replaces
 * the 2026-09-17 long-press rule (a 250ms still hold; a grab-then-move scrolled
 * the sheet instead). Now both layouts use the reference lists' sensor
 * (SortableRearrangeList): one PointerSensor that activates after 6px of
 * movement. The grip is `touch-action: none`, so a drag from the grip starts at
 * once on touch, while a swipe anywhere else on the row still scrolls the
 * sheet. The 6px also keeps a plain click on a desktop folder's grip from
 * starting a drag (which folded and re-opened the folder: a flicker).
 */
export const BOOKMARK_DRAG_ACTIVATION = { distance: 6 };

// Desktop row height: the shared desktop row (tokens.css --row-h, 32), its 1px
// divider INSIDE that height (owner 2026-10-02, UI consistency audit: "Bookmarks
// have thicker rows than Spaces" - they were 38 + 1). The row's controls fill
// the part above the divider.
const BOOKMARK_ROW_HEIGHT_PX = 32;
const BOOKMARK_ROW_INNER_PX = BOOKMARK_ROW_HEIGHT_PX - 1;

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
  landingSlot = null,
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
    transition: BOOKMARK_SORT_TRANSITION,
    animateLayoutChanges: ({ isSorting, wasDragging }) => (
      isSorting || wasDragging || groupAnimationState || isGroupAnimationActive ? false : true
    ),
  });
  // A fold animation must never strip the parted rows' offsets mid-drag (they
  // snapped shut and open again while a drag-opened folder unfolded).
  const isFoldAnimating = (Boolean(groupAnimationState) || isGroupAnimationActive) && !isDraggingAny;

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
    : isGroupAnimationActive && !isDraggingAny
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
        // UX 2026-09-23 (owner: "These should not look like individual cards
        // … look how we made documents, projects, and templates look"): rows
        // are lines in the panel. No gap between them, and the depth indent
        // moved INSIDE the row (paddingLeft below) so every divider still runs
        // from edge to edge while nested rows step their content in.
        padding: 0,
        position: 'relative',
        zIndex: isActiveRow ? 2 : undefined,
        width: isClone ? `${cloneWidth}px` : 'auto',
        boxSizing: 'border-box',
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
        // The app's one picked-up look (states.css [data-drag-lifted], owner
        // 2026-10-01): solid raised surface, soft shadow, no inner block.
        data-drag-lifted={isClone || isActiveRow ? '' : undefined}
        onClick={() => {
          if (isClone || isEditMode) return;
          onSelect?.(item.id);
          // UX 2026-10-01 (owner: tapping a folder opens / closes it at once):
          // a click anywhere on a folder row folds it, like the phone row; a
          // bookmark row jumps to its page.
          if (isFolder) {
            if (item.children?.length) onToggle?.(item.id);
          } else {
            onNavigate?.(item);
          }
        }}
        style={{
          transform: isClone ? undefined : sortableTransform,
          // The lifted row eases its projected indent (the drag's one glide).
          transition: isFoldAnimating
            ? undefined
            : isActiveRow
              ? `padding-left ${BOOKMARK_DRAG_GLIDE}`
              : transition,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: BOOKMARK_ROW_HEIGHT_PX,
          // The grip box starts at the row's edge (nested rows add their
          // depth inset here); its glyph sits 8px in, which puts the visible
          // dots on the header's 12px edge gap (the same line as the "+" of
          // Add). The name starts at x 40 (--row-text-x), as in Spaces.
          padding: `0 12px 0 ${isClone ? 0 : rowInset}px`,
          borderRadius: 0,
          // Quiet states only: the hover step or the SELECTED surface, never
          // a gold box. The lifted (dragging) row takes the shared lift.
          // UX 2026-10-01 (owner): no gold tint on the folder a drag lands in
          // either; the neutral landing slot below says where it goes.
          background: isSelected && !isActiveRow ? 'var(--surface-3)' : 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-2)',
          boxShadow: 'none',
          cursor: isEditMode ? 'default' : 'pointer',
          pointerEvents: isSorting ? 'none' : undefined,
          marginLeft: isClone ? `${cloneRelativeInset}px` : undefined,
          width: isClone
            ? `calc(100% - ${cloneRelativeInset}px)`
            : '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(event) => {
          if (!isSelected && !isClone && !isActiveRow && !isDraggingAny) event.currentTarget.style.background = 'var(--hover)';
        }}
        onMouseLeave={(event) => {
          if (!isSelected && !isClone && !isActiveRow && !isDraggingAny) event.currentTarget.style.background = 'transparent';
        }}
      >
        <div
          {...mergeDragHandleProps(tip('Drag to reorder', 'below'), handleProps)}
          data-drag-handle=""
          style={{
            // 21px pad, glyph 8px in; the -6px cancels the row gap so the
            // icon starts at 21 and the name at 40.
            width: 21,
            marginRight: -6,
            paddingLeft: 8,
            boxSizing: 'border-box',
            height: BOOKMARK_ROW_INNER_PX,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            color: 'var(--text-3)',
            cursor: isDraggingAny ? 'grabbing' : 'grab',
            userSelect: 'none',
            touchAction: 'none',
            flexShrink: 0,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {/* The app's shared grip icon (it replaced a hamburger text glyph). */}
          <Icon name="grip" size={12} color="currentColor" />
        </div>
        {/* Fold arrow only on a folder that has something to fold — a row
            without children no longer keeps an empty arrow-sized gap. */}
        {isFolder && item.children?.length ? (
          <button
            className="tertiary"
            data-glyph-only
            onClick={(event) => {
              event.stopPropagation();
              onToggle?.(item.id);
            }}
            disabled={isClone}
            aria-label={(isCollapsed || isVisuallyCollapsed) ? 'Expand group' : 'Collapse group'}
            aria-expanded={!(isCollapsed || isVisuallyCollapsed)}
            {...tip((isCollapsed || isVisuallyCollapsed) ? 'Expand group' : 'Collapse group', 'below')}
            style={{
              width: 12,
              height: BOOKMARK_ROW_INNER_PX,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 0,
              padding: 0,
              background: 'transparent',
              color: 'var(--text-3)',
              cursor: isClone ? 'default' : 'pointer',
              transform: (isCollapsed || isVisuallyCollapsed) ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: `transform ${GROUP_COLLAPSE_ANIMATION_MS}ms ease`,
              flexShrink: 0,
            }}
          >
            <Icon name="chevronRight" size={12} color="currentColor" />
          </button>
        ) : null}
        <Icon name={isFolder ? 'folder' : 'bookmark'} size={13} color="var(--text-3)" />
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
              border: '1px solid var(--border-strong)',
              color: 'var(--text-2)',
              borderRadius: 5,
              height: 22,
              padding: '0 6px',
              // The name keeps its 13px while it is being renamed (it
              // shrank to 11).
              fontSize: 13,
              outline: 'none',
              fontFamily: FONT_FAMILY,
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: 'var(--text-1)',
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
                width: 34,
                background: 'var(--surface-0)',
                border: '1px solid var(--border-strong)',
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
              <span style={{ color: 'var(--text-3)', fontSize: 11, textAlign: 'right', flexShrink: 0, userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>
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
            className="tertiary"
            data-glyph-only
            // Glyph only (owner 2026-09-23: no boxes on lone icons) — it was a
            // bordered well; the invisible pad is the full row height.
            style={{
              width: 22,
              height: BOOKMARK_ROW_INNER_PX,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-3)',
              borderRadius: 0,
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="plus" size={11} color="var(--text-3)" />
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
      {isActiveRow && landingSlot ? (
        // Where the drop will land: the app's one drag slot (a quiet dashed
        // outline, --drag-slot-*) in the gap the rows opened, stepped in to
        // the projected depth (no gold — owner, 2026-10-01). It sits under
        // the lifted row and shows whenever the row is not right on top of
        // it (e.g. while a folder dwell holds it).
        // Its `top` is set from the live layout after each commit (the
        // panel's drag layout effect), so a folder opening mid-drag never
        // throws it off its gap.
        <div
          aria-hidden="true"
          data-bookmark-drop-slot
          style={{
            position: 'absolute',
            zIndex: -1,
            pointerEvents: 'none',
            left: landingSlot.depth * BOOKMARK_INDENTATION_WIDTH,
            right: 0,
            height: BOOKMARK_ROW_INNER_PX,
            boxSizing: 'border-box',
            background: 'var(--drag-slot-bg)',
            border: 'var(--drag-slot-border)',
            borderRadius: 'var(--drag-lift-radius)',
            transition: `top ${BOOKMARK_DRAG_GLIDE}, left ${BOOKMARK_DRAG_GLIDE}`,
          }}
        />
      ) : null}
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
 * touch-sized mobile skin. Activation is the desktop's too (UX 2026-09-30,
 * BOOKMARK_DRAG_ACTIVATION): a drag from the grip starts at once; a swipe
 * anywhere else on the row still scrolls the sheet and a tap still jumps to
 * the page. The one thing that differs from desktop: the row indents by
 * MOBILE_BOOKMARK_INDENT_PX per depth instead of the desktop width, because
 * the phone row is only ~315px wide.
 * The grip is the app's shared six-dot "grip" icon (UX 2026-09-23, owner:
 * phone bookmarks match desktop — it replaced a hamburger text glyph), and its hit
 * area is padded out to 44px via an invisible ::before so the row height never
 * changes.
 *
 * UX 2026-09-23 (owner: "the shit on this page is too bulky … match desktop
 * more closely") — the row reads like the desktop tree row: grip, fold arrow
 * column, small plain folder/bookmark glyph (no bubble), one line of name and
 * a quiet "P n" page tag on the right. Rows are lines in one list divided by
 * edge-to-edge hairlines, not a bordered card each; the old "Page n · PDF
 * outline" second line is gone because the page tag already says it.
 *
 * The sheet's own drag-to-dismiss cannot fight this: useMobileSheetMotion's
 * touch handlers are attached only to the 35px grab-handle strip at the top of
 * the sheet (PDFSidebar.jsx), never to the panel content, so a touch that
 * starts on a bookmark row never reaches them. No opt-out hook is needed.
 *
 * UX 2026-09-22 (owner ruling) — the row carries NO up/down reorder buttons.
 * Dragging the grip is the only reorder path on the phone; two chevrons beside a
 * working drag handle were redundant chrome on a 315px row, and they could only
 * ever swap same-parent siblings, never reparent. Accessibility is preserved
 * because the grip spreads @dnd-kit's `attributes` (role="button", tabIndex 0),
 * so the KeyboardSensor in `sensors` still reorders with Space + arrows.
 * The desktop tree never had these arrows, so nothing changes there.
 */
const MobileBookmarkRow = ({
  item,
  depth,
  projectedDepth,
  landingSlot = null,
  isEditMode = false,
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
    transition: BOOKMARK_SORT_TRANSITION,
    animateLayoutChanges: ({ isSorting, wasDragging }) => !(isSorting || wasDragging),
  });

  const isFolder = item.type === 'folder';
  const rowDepth = projectedDepth ?? depth;
  const isCollapsed = isFolder && item.collapsed && item.children?.length;
  const pageNumber = !isFolder ? item.pageIds?.[0] : null;
  // UX 2026-09-23 (owner: phone bookmarks match desktop) — the lifted row moves
  // vertically only, exactly like the desktop tree's active row; the projected
  // nesting depth shows as the row's own indent instead of a sideways slide.
  const rowTransform = isDragging && transform
    ? CSS.Translate.toString({ ...transform, x: 0 })
    : CSS.Translate.toString(transform);

  return (
    <div
      ref={setDroppableNodeRef}
      data-bookmark-row-id={item.id}
      className={`mobile-bookmark-slot${isDragging ? ' is-dragging' : ''}`}
    >
      <div
        ref={setDraggableNodeRef}
        className={`mobile-bookmark-row${isDragging ? ' is-dragging' : ''}`}
        data-drag-lifted={isDragging ? '' : undefined}
        style={{
          // The depth indent lives INSIDE the row (padding), so every row's
          // hairline still runs edge to edge while nested rows step in.
          '--mobile-bookmark-depth-inset': `${rowDepth * MOBILE_BOOKMARK_INDENT_PX}px`,
          transform: rowTransform,
          transition,
        }}
      >
        <div
          className="mobile-bookmark-grip"
          aria-label={`Drag to reorder ${item.name}`}
          // The shared grip marker: a sheet's swipe-down gesture ignores any
          // touch that starts inside [data-drag-handle].
          data-drag-handle=""
          {...attributes}
          {...listeners}
          // touch-action `none` (UX 2026-09-30, like DragRearrangeHandle): the
          // browser never claims a touch that starts on the grip for a scroll,
          // so the PointerSensor gets the move and the drag starts at once.
          style={{ touchAction: 'none' }}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="grip" size={14} color="currentColor" />
        </div>
        <button
          type="button"
          className="mobile-bookmark-open tertiary"
          aria-label={isFolder ? `Toggle ${item.name}` : `Open bookmark ${item.name}`}
          aria-expanded={isFolder ? !isCollapsed : undefined}
          onClick={() => {
            if (isFolder) {
              onToggle?.(item.id);
              return;
            }
            onNavigate?.(item);
          }}
        >
          {/* Fold arrow only on a folder with something to fold, as on
              desktop — a row without children keeps no empty gap. */}
          {isFolder && item.children?.length ? (
            <span
              className={`mobile-bookmark-caret${isCollapsed ? '' : ' is-open'}`}
              aria-hidden="true"
            >
              <Icon name="chevronRight" size={12} color="currentColor" />
            </span>
          ) : null}
          <span className="mobile-bookmark-icon" aria-hidden="true">
            <Icon name={isFolder ? 'folder' : 'bookmark'} size={14} color="currentColor" />
          </span>
          <span className="mobile-bookmark-title">{item.name}</span>
          {pageNumber ? (
            <span className="mobile-bookmark-page">P {pageNumber}</span>
          ) : null}
        </button>
        {/* Rename + delete show in Edit mode only, like the desktop tree. */}
        {isEditMode && (
        <div className="mobile-bookmark-moves">
          {!isFolder && (
            <button
              type="button"
              className="mobile-bookmark-move"
              aria-label={`Edit bookmark ${item.name}`}
              onClick={() => onEdit?.(item)}
            >
              <Icon name="edit" size={14} color="currentColor" />
            </button>
          )}
          <button
            type="button"
            className="mobile-bookmark-move mobile-bookmark-delete"
            aria-label={`Delete bookmark ${item.name}`}
            onClick={() => onDelete?.(item.id)}
          >
            <Icon name="trash" size={14} color="currentColor" />
          </button>
        </div>
        )}
      </div>
      {isDragging && landingSlot ? (
        // The desktop's landing slot (see BookmarkTreeRow), phone indent;
        // its `top` comes from the live layout, as on desktop.
        <div
          aria-hidden="true"
          data-bookmark-drop-slot
          className="mobile-bookmark-drop-slot"
          style={{
            left: landingSlot.depth * MOBILE_BOOKMARK_INDENT_PX,
          }}
        />
      ) : null}
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
  // Bumped whenever the drag intent (committed landing spot) changes, so the
  // rows re-render with the new projected depth / drop target.
  const [, setDragIntentVersion] = useState(0);
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
  const collapsedDragFolderIdRef = useRef(null);
  // The committed landing spot of the live drag (resolveBookmarkDragIntent).
  const dragIntentRef = useRef(null);
  const dragIntentWakeRef = useRef({ timer: null, at: null });
  // The rows' list node, the finger of the live drag ({ id, grabY, pointerY })
  // and the rows' layout tops at the last commit (see the drag layout effect).
  const bookmarkListRef = useRef(null);
  const liveDragRef = useRef(null);
  const dragLayoutRef = useRef(null);
  const dropSlotRef = useRef({ node: null, top: 0 });

  // Desktop and phone share the reference lists' sensor: a pointer drag (mouse
  // or touch) engages after BOOKMARK_DRAG_ACTIVATION's 6px of movement.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: BOOKMARK_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, {}),
  );

  // Build hierarchical tree from flat bookmarks array (sorted by `order` at
  // every depth — see buildBookmarkTree).
  const buildTree = useCallback((items) => buildBookmarkTree(items), []);

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

  const flattenedItemsRef = useRef(flattenedItems);
  flattenedItemsRef.current = flattenedItems;
  const dragIntent = activeId ? dragIntentRef.current : null;
  const projected = dragIntent
    ? { depth: dragIntent.depth, parentId: dragIntent.parentId }
    : null;

  /*
   * UX 2026-09-30 — collision detection IS the drag intent. dnd-kit calls this
   * on every render of the DndContext (each pointer move, and each wake-up
   * below); the resolver hit-tests the rows as they are drawn and only moves
   * the committed slot for a clear intent (see resolveBookmarkDragIntent).
   * Returning the committed slot as the single collision makes the sortable
   * rows part exactly where the drop will land, and nowhere else.
   */
  const bookmarkCollisionDetection = useCallback((args) => {
    const intent = dragIntentRef.current;
    const activeKey = args.active?.id;
    if (!intent || activeKey == null) return closestCenter(args);
    const activeRect = args.droppableRects.get(activeKey);
    const { intent: nextIntent, wakeAt } = resolveBookmarkDragIntent(intent, {
      items: flattenedItemsRef.current,
      activeId: activeKey,
      rects: args.droppableRects,
      centerY: args.collisionRect.top + args.collisionRect.height / 2,
      dx: activeRect ? args.collisionRect.left - activeRect.left : 0,
      now: performance.now(),
      indentationWidth: BOOKMARK_INDENTATION_WIDTH,
    });
    if (nextIntent !== intent) {
      dragIntentRef.current = nextIntent;
      queueMicrotask(() => setDragIntentVersion((version) => version + 1));
    }
    const wake = dragIntentWakeRef.current;
    if (wakeAt && wake.at !== wakeAt) {
      // A dwell is running: re-run collision when it elapses even if the
      // pointer is perfectly still (a resting finger sends no moves).
      wake.at = wakeAt;
      queueMicrotask(() => {
        if (wake.timer) clearTimeout(wake.timer);
        wake.timer = setTimeout(() => {
          wake.timer = null;
          if (dragIntentRef.current) setDragIntentVersion((version) => version + 1);
        }, Math.max(0, wakeAt - performance.now()) + 8);
      });
    }
    const container = args.droppableContainers.find((candidate) => candidate.id === nextIntent.overId);
    return container ? [{ id: nextIntent.overId, data: { droppableContainer: container, value: 0 } }] : [];
  }, []);
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
    if (expandedFolders.has(folderId) && !collapsingFolderIds.includes(folderId)) {
      // UX 2026-10-01 (owner: opening a folder was instant but closing it took
      // about a second) — a tap closes the folder in the same frame. It used
      // to run the 240ms fold-up (and on the phone, which has no fold-up
      // animation, simply wait 240ms with nothing changing, not even the
      // arrow) before the children went away. The animated fold stays for
      // folders a drag opened and closes again (animateCollapseFolders).
      const pendingExpand = expandTimeoutsRef.current.get(folderId);
      if (pendingExpand) {
        clearTimeout(pendingExpand);
        expandTimeoutsRef.current.delete(folderId);
      }
      setExpandingFolderIds((ids) => (ids.includes(folderId) ? ids.filter((id) => id !== folderId) : ids));
      setExpandedFolders((prev) => {
        if (!prev.has(folderId)) return prev;
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
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
  }, [collapsingFolderIds, expandedFolders, expandFolderOnly]);

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
    // Where on the row the finger / pointer grabbed it, and the rows' layout
    // before the drag folds anything (a dragged open folder hides its
    // children), so the first drag frame already glides.
    const list = bookmarkListRef.current;
    const outers = list ? Array.from(list.querySelectorAll('[data-bookmark-row-id]')) : [];
    const activeRow = outers.find((node) => node.dataset.bookmarkRowId === active.id)?.firstElementChild;
    const startEvent = typeof window !== 'undefined' ? window.event : null;
    liveDragRef.current = activeRow && typeof activatorEvent?.clientY === 'number'
      ? {
        id: active.id,
        grabY: activatorEvent.clientY - activeRow.getBoundingClientRect().top,
        pointerY: typeof startEvent?.clientY === 'number' ? startEvent.clientY : null,
        done: false,
      }
      : null;
    dragLayoutRef.current = new Map(outers.map((node) => [node.dataset.bookmarkRowId, node.offsetTop]));
    dropSlotRef.current = { node: null, top: 0 };
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
    dragIntentRef.current = createBookmarkDragIntent(flattenedItems, active.id);
    setActiveId(active.id);
    autoExpandedFoldersRef.current.clear();
    document.body.style.setProperty('cursor', 'grabbing');
    // The shared "a reorder is live" flag (SortableRearrangeList sets the same
    // class) — sheet gestures and other listeners can stand down while it is on.
    document.body.classList.add('drag-rearrange-dragging');
  }, [expandedFolders, flattenedItems]);

  const resetDragState = useCallback(() => {
    clearAutoExpandTimer();
    dragIntentRef.current = null;
    if (liveDragRef.current) liveDragRef.current.done = true;
    liveDragRef.current = null;
    dragLayoutRef.current = null;
    const wake = dragIntentWakeRef.current;
    if (wake.timer) clearTimeout(wake.timer);
    wake.timer = null;
    wake.at = null;
    autoExpandedFoldersRef.current.clear();
    setActiveId(null);
    document.body.style.setProperty('cursor', '');
    document.body.classList.remove('drag-rearrange-dragging');
  }, [clearAutoExpandTimer]);

  const handleDragEnd = useCallback(({ active, over }) => {
    const autoExpandedFolderIds = Array.from(autoExpandedFoldersRef.current);
    const draggedCollapsedFolderId = collapsedDragFolderIdRef.current;
    collapsedDragFolderIdRef.current = null;
    // The drop lands on the COMMITTED spot — exactly what the rows showed. A
    // dwell still running at release (e.g. about to enter a folder) is dropped.
    const intent = dragIntentRef.current;
    const finalParentId = intent?.parentId ?? null;
    const foldersToRecollapse = autoExpandedFolderIds.filter((folderId) => folderId !== finalParentId);

    if (intent && over) {
      const { parentId } = intent;
      const nextTree = applyBookmarkTreeProjection(bookmarkTree, active.id, intent.overId, intent);
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
  }, [animateCollapseFolders, bookmarkTree, expandFolderOnly, persistBookmarkTree, resetDragState]);

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
    if (dragIntentWakeRef.current.timer) clearTimeout(dragIntentWakeRef.current.timer);
    if (dragIntentRef.current) document.body.classList.remove('drag-rearrange-dragging');
  }, [clearAutoExpandTimer]);

  useEffect(() => {
    if (!optimisticBookmarkTree || activeId) return undefined;

    const timeout = setTimeout(() => {
      setOptimisticBookmarkTree(null);
    }, 220);

    return () => clearTimeout(timeout);
  }, [activeId, bookmarks, optimisticBookmarkTree]);

  // Resting on a CLOSED folder's middle (the drag is committed "into" it) for
  // GROUP_AUTO_EXPAND_DELAY_MS opens it, so the row can be placed among its
  // children; a folder opened this way closes again if the drop goes elsewhere.
  const autoExpandTargetId = (() => {
    const intoId = dragIntent?.intoId;
    if (!intoId || intoId === activeId) return null;
    const folder = flattenedItems.find((item) => item.id === intoId);
    return folder?.type === 'folder' && folder.collapsed && folder.children?.length > 0 ? intoId : null;
  })();

  useEffect(() => {
    if (!autoExpandTargetId) {
      clearAutoExpandTimer();
      return;
    }
    if (autoExpandFolderRef.current === autoExpandTargetId) return;

    clearAutoExpandTimer();
    autoExpandFolderRef.current = autoExpandTargetId;
    autoExpandTimerRef.current = setTimeout(() => {
      autoExpandedFoldersRef.current.add(autoExpandTargetId);
      // A drag coming up from below the folder holds the slot just under its
      // header: commit that spot to the first child, which is where the
      // header's bottom edge will be once the children are in (the row that
      // follows the folder now moves down past them).
      const intent = dragIntentRef.current;
      const items = flattenedItemsRef.current;
      const folderIndex = items.findIndex((item) => item.id === autoExpandTargetId);
      const firstChildId = items[folderIndex]?.children?.[0]?.id;
      if (
        intent && intent.intoId === autoExpandTargetId && firstChildId &&
        items.findIndex((item) => item.id === intent.overId) > folderIndex
      ) {
        dragIntentRef.current = { ...intent, overId: firstChildId };
      }
      // No fold-down keyframes mid-drag: the children appear at full height
      // and the rows under them glide down (the drag layout effect).
      expandFolderOnly(autoExpandTargetId);
      autoExpandTimerRef.current = null;
      autoExpandFolderRef.current = null;
    }, GROUP_AUTO_EXPAND_DELAY_MS);
  }, [autoExpandTargetId, clearAutoExpandTimer, expandFolderOnly]);

  // The lifted row follows the finger frame by frame (placeLiftedBookmarkRow),
  // not one React render behind it.
  useEffect(() => {
    const live = liveDragRef.current;
    if (!activeId || !live || live.id !== activeId) return undefined;
    const onPointerMove = (event) => {
      live.pointerY = event.clientY;
    };
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    let frame = requestAnimationFrame(function placeEachFrame() {
      placeLiftedBookmarkRow(bookmarkListRef.current, live);
      frame = live.done ? null : requestAnimationFrame(placeEachFrame);
    });
    return () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeId]);

  // Mid-drag layout changes glide: after each commit, a row whose layout top
  // moved (a folder opened or closed above it) starts from where it was drawn,
  // a row that just appeared fades in, and the landing slot is set from the
  // live layout of the committed spot (the over row's box) — so it holds its
  // gap when the lifted row's own layout moves.
  useLayoutEffect(() => {
    const list = bookmarkListRef.current;
    const previous = dragLayoutRef.current;
    if (!activeId || !list || !previous) return;
    const outers = Array.from(list.querySelectorAll('[data-bookmark-row-id]'));
    const layout = new Map(outers.map((node) => [node.dataset.bookmarkRowId, node.offsetTop]));
    dragLayoutRef.current = layout;
    outers.forEach((node) => {
      const id = node.dataset.bookmarkRowId;
      const row = node.firstElementChild;
      if (id === activeId || !row) return;
      if (!previous.has(id)) {
        row.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: BOOKMARK_DRAG_GLIDE_MS, easing: BOOKMARK_DRAG_GLIDE_EASING });
        return;
      }
      const shift = previous.get(id) - layout.get(id);
      if (shift) glideBookmarkLayoutShift(row, shift);
    });

    const activeIndex = outers.findIndex((node) => node.dataset.bookmarkRowId === activeId);
    const activeOuter = outers[activeIndex];
    const slot = activeOuter?.querySelector('[data-bookmark-drop-slot]');
    if (!slot) return;
    const overId = dragIntentRef.current?.overId ?? activeId;
    const overIndex = outers.findIndex((node) => node.dataset.bookmarkRowId === overId);
    const over = outers[overIndex];
    let top = 0;
    if (over && overIndex !== activeIndex) {
      top = (overIndex > activeIndex
        ? over.offsetTop + over.offsetHeight - activeOuter.offsetHeight
        : over.offsetTop) - activeOuter.offsetTop;
    }
    const state = dropSlotRef.current;
    const baseShift = previous.has(activeId) ? previous.get(activeId) - layout.get(activeId) : 0;
    if (state.node !== slot || baseShift) {
      // A new slot lands in place; a slot whose row moved keeps its drawn
      // spot and glides on from there.
      const transition = slot.style.transition;
      const from = state.node === slot ? parseFloat(getComputedStyle(slot).top) + baseShift : top;
      slot.style.transition = 'none';
      slot.style.top = `${from}px`;
      void slot.offsetHeight;
      slot.style.transition = transition;
    }
    if (state.node !== slot || state.top !== top || baseShift) slot.style.top = `${top}px`;
    dropSlotRef.current = { node: slot, top };
  });

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

    // A second "New bookmark" was refused as a duplicate name (bookmark names
    // are unique per type), so pick the next free "New bookmark N".
    const takenNames = new Set((bookmarks || [])
      .filter((b) => b?.type !== 'folder' && typeof b?.name === 'string')
      .map((b) => b.name.trim().toLowerCase()));
    let defaultName = 'New bookmark';
    for (let n = 2; takenNames.has(defaultName.toLowerCase()); n += 1) {
      defaultName = `New bookmark ${n}`;
    }

    onBookmarkCreate({
      id: generateId(),
      name: defaultName,
      type: 'bookmark',
      pageIds: initialPage ? [initialPage] : [],
      parentId: folderId,
      order: nextOrder,
    });
  }, [bookmarks, bookmarkTree, expandFolderOnly, findItem, numPages, onBookmarkCreate, pageNum]);

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
   * for the drag-first shape instead: make an EMPTY, named folder, then drag
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
    setShowCreateMenu(false);
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
    // Save with nothing changed just closes the form - no write, no undo step
    // (owner 2026-10-02: only a real change is saved).
    const unchanged = result.updates.name === item.name
      && Array.isArray(item.pageIds) && item.pageIds.length === 1
      && item.pageIds[0] === result.updates.pageIds[0];
    if (!unchanged) onBookmarkUpdate?.(item.id, result.updates);
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
    // The phone's Add is open while either inline editor (bookmark or folder)
    // is showing; its toggle then reads "Cancel".
    const isAddOpen = showCreateMenu || showMobileFolderEditor;
    // UX 2026-07-12 — Mobile bookmark list. Flat, touch-sized rows that mirror the
    // demo (BookmarkRow.tsx / HubTray bookmarks branch). flattenedItems already
    // honours folder collapse state and carries per-row depth. Tapping a folder
    // toggles it; tapping a bookmark navigates via the same handleNavigate path as
    // desktop. UX 2026-09-22 (owner ruling): reordering is grip drag only —
    // the old up/down chevrons are gone, and "New folder" in the action row makes
    // an empty folder to drag bookmarks into.
    // Note: the demo's markerId→survey jump does not apply here — the new app's
    // Bookmarks tab is the PDF outline (page-anchored), with no survey markerId and
    // no survey-open handler threaded to this panel, so page navigation is the
    // correct real behavior.
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={bookmarkCollisionDetection}
        modifiers={[restrictBookmarkTreeDrag]}
        measuring={bookmarkTreeMeasuring}
        autoScroll={CALM_LIST_AUTO_SCROLL}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <div
        ref={bookmarkListRef}
        className={`mobile-bookmark-list${activeId ? ' is-dragging-active' : ''}`}
        data-bookmark-tree-list
      >
        {/* UX 2026-09-23 (owner: "Add with a + sign on the left … Edit on the
            right … well integrated and perfectly aligned"; then "We don't need
            the title of bookmarks … the tab already says it") — the SAME
            header as the desktop panel and the Spaces panel: 44px on the phone
            with a hairline under it, "+ Add" left, "Edit" right. Both actions
            are quiet (text-2 ink, no fill, no border, the 44px-tall button box
            is the invisible tap pad); gold is only the "Done" word while
            editing. Edit mode is what shows each row's rename and delete
            glyphs, exactly as desktop hides them until Edit — so a resting row
            is just its grip, glyph, name and page. */}
        {/* Owner 2026-10-02: header actions are icons, right-aligned,
            [Edit] then [Add] (the [Select] [Add] order of every list
            header). Edit's glyph is gold while editing; Add turns into a
            close glyph while its line is open. */}
        <div className="mobile-bookmark-toolbar">
          <SectionIconActions phone className="mobile-bookmark-actions">
            <SectionIconButton
              phone
              action="edit"
              icon="edit"
              label={isEditMode ? 'Done editing bookmarks' : 'Edit bookmarks'}
              tooltip={isEditMode ? 'Done' : 'Edit'}
              active={isEditMode}
              onClick={() => {
                setIsEditMode((editing) => !editing);
                setMobileEditingBookmarkId(null);
              }}
            />
            <SectionIconButton
              phone
              action="add"
              icon={isAddOpen ? 'close' : 'plus'}
              label={isAddOpen ? 'Cancel new bookmark' : 'Add bookmark'}
              aria-expanded={isAddOpen}
              onClick={() => {
                const next = !isAddOpen;
                setShowCreateMenu(next);
                setShowMobileFolderEditor(false);
                setNewFolderName('');
              }}
            />
          </SectionIconActions>
        </div>
        {/* Add opens ONE inline line: the bookmark fields, or — via the quiet
            "New folder" switch under them (UX 2026-09-22 owner ruling: the
            phone can make a folder) — the folder-name field. This mirrors the
            desktop Add menu, which offers the bookmark form and "New bookmark
            group" in one place. */}
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
            <button type="button" className="tertiary" onClick={handleCreateMobileFolder}>Create</button>
          </div>
        )}
        {showCreateMenu && !showMobileFolderEditor && (
          <div className="mobile-bookmark-editor" aria-label="New bookmark">
            <input
              type="text"
              aria-label="Bookmark name"
              value={newBookmarkName}
              placeholder="Bookmark name"
              autoFocus
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
            <button type="button" className="tertiary" onClick={handleCreateBookmark}>Create</button>
          </div>
        )}
        {isAddOpen && (
          <div className="mobile-bookmark-addkind">
            <button
              type="button"
              className={`mobile-bookmark-newfolder tertiary${showMobileFolderEditor ? ' is-active' : ''}`}
              aria-label={showMobileFolderEditor ? 'Cancel new folder' : 'New folder'}
              aria-expanded={showMobileFolderEditor}
              onClick={() => {
                setShowMobileFolderEditor((shown) => !shown);
                setNewFolderName('');
              }}
            >
              <Icon name={showMobileFolderEditor ? 'bookmark' : 'folder'} size={14} color="currentColor" />
              {showMobileFolderEditor ? 'New bookmark instead' : 'New folder instead'}
            </button>
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
                  style={{ '--mobile-bookmark-depth-inset': `${depth * MOBILE_BOOKMARK_INDENT_PX}px` }}
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
                  <button type="button" className="tertiary" onClick={() => saveMobileBookmarkEdit(item)}>Save</button>
                  <button type="button" className="secondary tertiary" onClick={() => setMobileEditingBookmarkId(null)}>Cancel</button>
                </div>
              ) : (
                <MobileBookmarkRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  projectedDepth={item.id === activeId && projected ? projected.depth : null}
                  landingSlot={item.id === activeId && projected ? { depth: projected.depth } : null}
                  isEditMode={isEditMode}
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
      {/*
        UX 2026-09-23 (owner, desktop Bookmarks header): "Add with a + sign on
        the left … Edit on the right. Everything should look well integrated
        and perfectly aligned." The big gold footer bar is gone; Add opens the
        same create menu, now dropping DOWN from here. Later the same day: "We
        don't need the title of bookmarks in the middle … because the tab
        already says it" — so the row is just the two actions.
        Shared header spec with the Spaces panel (one design for both panels):
        40px row on desktop (44 on the phone) with a hairline under it; two
        quiet glyph-and-word actions of equal weight — text-2 ink, no fill, no
        border, the button box is an invisible full-height tap pad; hover/press
        only brighten the ink to text-1, never a plate (`tertiary` keeps
        states.css's press plate off). The 12px edge gaps are measured to the
        visible glyph/word. Gold appears only as the minimal "Done" accent
        while editing.
        Owner 2026-10-02: section header actions are ICONS ("The icons looked
        way better"), right-aligned in the [Select] [Add] order every list
        header uses: [Edit] [Add]. Edit's glyph turns gold while editing. The
        6px side pad puts each 28px box's glyph on the 12px edge.
      */}
      <div style={{
        position: 'relative',
        height: '40px',
        boxSizing: 'border-box',
        padding: '0 6px',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '2px',
        flexShrink: 0
      }}>
        <SectionIconButton
          action="edit"
          icon="edit"
          label={isEditMode ? 'Done editing bookmarks' : 'Edit bookmarks'}
          tooltip={isEditMode ? 'Done' : 'Edit'}
          active={isEditMode}
          onClick={() => setIsEditMode(!isEditMode)}
        />
        <div ref={menuRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <DismissBarrier
            active={showCreateMenu}
            insideRefs={createMenuInsideRefs}
            onDismiss={() => setShowCreateMenu(false)}
          />
          <SectionIconButton
            action="add"
            label="Add bookmark"
            aria-expanded={showCreateMenu}
            onClick={() => setShowCreateMenu(!showCreateMenu)}
          />
              {showCreateMenu && (
                <div style={{
                  position: 'absolute',
                  // Opens DOWN from the header now that Add lives there (was the
                  // footer bar, where it opened upward).
                  top: '100%',
                  left: '8px',
                  right: '8px',
                  marginTop: '4px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
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
                        border: '1px solid var(--border-strong)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontFamily: FONT_FAMILY,
                        marginBottom: '8px',
                        outline: 'none',
                        transition: 'border-color 0.15s ease'
                      }}
                      // UX 2026-09-23: focus lifts the border to a lighter
                      // neutral — no gold ring on a field (owner rule).
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--text-3)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                        border: '1px solid var(--border-strong)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontFamily: FONT_FAMILY,
                        marginBottom: '8px',
                        outline: 'none',
                        transition: 'border-color 0.15s ease'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--text-3)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                        border: '1px solid var(--border)',
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

      {/* Bookmarks List with Drag-and-Drop */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          // 0, not the old 6px: row dividers run to both panel edges.
          padding: 0,
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
              max-height: 39px;
              padding-top: 0;
              padding-bottom: 0;
            }
          }

          @keyframes bookmarkGroupCollapse {
            from {
              opacity: 1;
              max-height: 39px;
              padding-top: 0;
              padding-bottom: 0;
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
          collisionDetection={bookmarkCollisionDetection}
          modifiers={[restrictBookmarkTreeDrag]}
          measuring={bookmarkTreeMeasuring}
          autoScroll={CALM_LIST_AUTO_SCROLL}
          onDragStart={handleDragStart}
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
              <div ref={bookmarkListRef} data-bookmark-tree-list style={{ margin: 0, padding: 0 }}>
                {flattenedItems.map((item) => (
                  <BookmarkTreeRow
                    key={item.id}
                    item={item}
                    depth={item.depth}
                    projectedDepth={item.id === activeId && projected ? projected.depth : null}
                      landingSlot={item.id === activeId && projected ? { depth: projected.depth } : null}
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
                  border: '1px solid var(--border-strong)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                    color: 'var(--text-3)',
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
                                border: '1px solid var(--border-strong)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                                border: '1px solid var(--border-strong)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                          color: 'var(--danger-text)',
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
                      color: 'var(--text-3)',
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
                            fontFamily: FONT_FAMILY,
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
                    color: 'var(--text-3)',
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
                                border: '1px solid var(--border-strong)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                                border: '1px solid var(--border-strong)',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY,
                                outline: 'none'
                              }}
                              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
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
                          color: 'var(--danger-text)',
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
                      color: 'var(--text-3)',
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
                            fontFamily: FONT_FAMILY,
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
