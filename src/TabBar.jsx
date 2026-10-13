/**
 * TabBar.jsx — horizontal browser-style tab strip for the Home tab + open PDF documents.
 *
 * Default-export component built on @dnd-kit for drag-to-reorder of PDF tabs
 * (Home tab is pinned, non-draggable); calls onTabClick / onTabClose /
 * onTabReorder / onTabMenuAction.
 * Each tab shows an unsaved-annotation dot and a red dual-write-pending dot
 * sourced from a single useDocsPendingDualWrite() Set (called once, never in
 * the .map loop, to keep React hook counts stable when a tab closes).
 *
 * Drawboard shell audit, Chunk C (2026-10-13):
 *  - right-click (or the Menu key / Shift+F10) opens the tab menu at the
 *    pointer: Close tab, Close other tabs, Close all tabs, Download, Rename
 *    document. AppShell runs them through the same close path as the X.
 *  - middle-click closes the tab, like every browser.
 *  - when the tabs no longer fit, an "N ▾" button at the right end lists every
 *    open document, the current one marked.
 *  - the old page-drop target is gone: nothing in the app drags a page onto a
 *    tab any more, and a drop only ever showed a "being implemented" toast.
 */
import { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { createPortal, flushSync } from 'react-dom';
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CALM_STRIP_AUTO_SCROLL } from './reorder/dragAutoScroll.js';
import { restrictToHorizontalAxis } from './reorder/axisLock.js';
import { moveItem } from './reorder/flatReorderUtils.js';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icons';
import { useTooltip } from './components/Tooltip';
import DismissBarrier from './components/DismissBarrier';
import { canRenameTab } from './tabs/tabStrip.js';
import './TabBar.css';
// Phase 30 — per-tab subscription to the dual-write retry queue. Each tab
// renders its own dot independently when its documentId has at least one
// non-quarantined queue entry. CONTEXT.md AC-13 / 30-UI-SPEC.md Surface 3.
import { useDocsPendingDualWrite } from './hooks/useTabPendingDualWrite.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const TAB_HEIGHT = 32;
const HOME_TAB_WIDTH = 148;
const PDF_TAB_MIN_WIDTH = 168;
const PDF_TAB_MAX_WIDTH = 280;
const TAB_BAR_BG = 'var(--surface-0)';
const TAB_IDLE_BG = 'var(--surface-1)';
const TAB_ACTIVE_BG = 'var(--surface-2)';
/* UX 2026-09-22: this was var(--surface-3), which src/styles/tokens.css reserves
   for SELECTED ("--surface-3 is a SELECTED or a FIELD surface. It is never a
   hover"). Hovering an idle tab therefore painted it the active tab's colour, so
   the bar appeared to have two active tabs. Hover is --hover, press is
   --pressed, like every other control. */
const TAB_HOVER_BG = 'var(--hover)';
const TAB_PRESSED_BG = 'var(--pressed)';
const TAB_BORDER = 'var(--border)';
const TAB_TEXT = 'var(--text-3)';
const TAB_TEXT_ACTIVE = 'var(--text-1)';
const TAB_ACCENT = 'var(--accent)';

const createTabBoundsModifier = () => ({ active, activeNodeRect, transform }) => {
  const activeIdValue = String(active?.id ?? '');
  const activeNode = Array.from(document.querySelectorAll('[data-pdf-tab-id]'))
    .find((node) => node.dataset.pdfTabId === activeIdValue);
  const listNode = activeNode?.closest?.('[data-pdf-tab-list]');

  if (!activeNodeRect || !activeNode || !listNode) {
    return transform;
  }

  const itemRects = Array.from(listNode.querySelectorAll('[data-pdf-tab-id]'))
    .map((node) => ({
      left: node.offsetLeft,
      right: node.offsetLeft + node.offsetWidth,
    }))
    .filter((rect) => rect.right > rect.left);

  if (!itemRects.length) {
    return transform;
  }

  const left = Math.min(...itemRects.map((rect) => rect.left));
  const right = Math.max(...itemRects.map((rect) => rect.right));

  return {
    ...transform,
    x: Math.min(
      Math.max(transform.x, left - activeNode.offsetLeft),
      right - (activeNode.offsetLeft + activeNode.offsetWidth)
    ),
  };
};

function TabItem({
  tab,
  isActive,
  isHome,
  isSorting = false,
  isDragging = false,
  hasPendingDualWrite,
  onTabClick,
  onTabClose,
  onOpenMenu,
  sortableAttributes = {},
  sortableListeners = {},
  setNodeRef = null,
  style: sortableStyle = {},
}) {
  const keyboardMenuAtRef = useRef(-Infinity);
  const handleTabCloseClick = (e) => {
    e.stopPropagation();
    onTabClose(tab.id);
  };

  // KAL-65: the app's shared chip instead of the OS tooltip. The tab's own
  // name only gets one when the strip has cut it short - a chip repeating a
  // name you can already read, popping up instantly as the pointer crosses
  // the strip, would be noise. The dots always explain themselves.
  const tip = useTooltip();
  const nameTip = tip(tab.name, 'below');
  const onlyWhenCut = (show) => (show
    ? (e) => {
      const el = e.currentTarget;
      if (el && el.scrollWidth > el.clientWidth) show(e);
    }
    : undefined);
  const truncatedNameTip = {
    ...nameTip,
    onMouseEnter: onlyWhenCut(nameTip.onMouseEnter),
    onPointerEnter: onlyWhenCut(nameTip.onPointerEnter),
  };

  return (
    <div
      ref={setNodeRef}
      {...sortableAttributes}
      {...sortableListeners}
      data-pdf-tab-id={!isHome ? tab.id : undefined}
      data-app-tab=""
      data-tab-active={isActive ? 'true' : undefined}
      // Owner 2026-10-01: the held tab takes the app's one picked-up look
      // (states.css [data-drag-lifted]): solid raised surface, soft shadow,
      // no gold edge, fully opaque so no neighbour shows through.
      data-drag-lifted={isDragging ? '' : undefined}
      onClick={() => onTabClick(tab.id)}
      // KAL-66: a keyboard user can reach and open every tab. The Home tab
      // has no sortable attributes, so it gets its own role and tab stop.
      // Enter opens a tab; Space stays the keyboard "pick up to reorder" key
      // (the KeyboardSensor below starts a drag on Space only).
      role={isHome ? 'button' : sortableAttributes.role}
      tabIndex={isHome ? 0 : sortableAttributes.tabIndex}
      aria-current={isActive ? 'page' : undefined}
      // Chunk C: right-click opens the tab menu at the pointer (Drawboard).
      onContextMenu={isHome ? undefined : (e) => {
        e.preventDefault();
        // The Menu key / Shift+F10 already opened it (onKeyDown); the
        // browser's own contextmenu event that follows is not a second open.
        if (performance.now() - keyboardMenuAtRef.current < 600) return;
        onOpenMenu?.(tab.id, { x: e.clientX, y: e.clientY }, e.currentTarget, false);
      }}
      // Middle-click closes, like every browser. The press itself (below)
      // never starts a drag or the platform's auto-scroll.
      onAuxClick={isHome ? undefined : (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onTabClose(tab.id);
      }}
      onKeyDown={(e) => {
        if (!isHome && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          keyboardMenuAtRef.current = performance.now();
          const rect = e.currentTarget.getBoundingClientRect();
          onOpenMenu?.(tab.id, { x: rect.left + 8, y: rect.bottom }, e.currentTarget, true);
          return;
        }
        sortableListeners.onKeyDown?.(e);
        if (e.defaultPrevented || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || (isHome && e.key === ' ')) {
          e.preventDefault();
          onTabClick(tab.id);
        }
      }}
      style={{
        ...sortableStyle,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: isHome ? `${HOME_TAB_WIDTH}px` : `${PDF_TAB_MIN_WIDTH}px`,
        maxWidth: isHome ? `${HOME_TAB_WIDTH}px` : `${PDF_TAB_MAX_WIDTH}px`,
        width: isHome ? `${HOME_TAB_WIDTH}px` : 'auto',
        height: `${TAB_HEIGHT}px`,
        padding: '0 10px',
        background: isActive ? TAB_ACTIVE_BG : TAB_IDLE_BG,
        borderRight: `1px solid ${TAB_BORDER}`,
        borderTop: isActive ? `2px solid ${TAB_ACCENT}` : '2px solid transparent',
        cursor: isHome ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
        userSelect: 'none',
        transition: isDragging
          ? 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease'
          : [sortableStyle.transition, 'background 0.15s ease', 'border-color 0.15s ease', 'box-shadow 0.15s ease'].filter(Boolean).join(', '),
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: isActive ? TAB_TEXT_ACTIVE : TAB_TEXT,
        zIndex: isDragging ? 5 : undefined,
        boxShadow: 'none',
        touchAction: isHome ? undefined : 'none',
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isSorting) {
          e.currentTarget.style.background = TAB_HOVER_BG;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive && !isSorting) {
          e.currentTarget.style.background = TAB_IDLE_BG;
        }
      }}
      /* A tab is a draggable div, not a <button>, so the app-wide :active rule
         in src/styles/states.css cannot reach it — it needs the press painted
         by hand. Pressing the ACTIVE tab still darkens, because pressing the
         tab you are already on should still feel like a press.
         It must also forward to the sortable's own onMouseDown (spread above):
         this prop replaced it, so the MouseSensor never saw a press and
         document tabs could not be dragged with a mouse (fix 2026-09-30). */
      onMouseDown={(e) => {
        // A middle press only closes (onAuxClick): no drag, no auto-scroll
        // cursor, no pressed fill. A right press only opens the menu.
        if (e.button === 1) {
          e.preventDefault();
          return;
        }
        if (e.button !== 0) return;
        sortableListeners.onMouseDown?.(e);
        if (!isSorting) {
          e.currentTarget.style.background = TAB_PRESSED_BG;
        }
      }}
      onMouseUp={(e) => {
        if (e.button === 0 && !isSorting) {
          e.currentTarget.style.background = isActive ? TAB_ACTIVE_BG : TAB_HOVER_BG;
        }
      }}
    >
      {isHome ? (
        <Icon
          name="homeTab"
          size={13}
          style={{ marginRight: '7px', flexShrink: 0 }}
        />
      ) : tab.hasUnsavedAnnotations ? (
        <span
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: TAB_ACCENT,
            display: 'inline-block',
            marginRight: '7px',
            flexShrink: 0
          }}
          role="img"
          aria-label="Unsaved changes (Cmd/Ctrl+S to save)"
          {...tip('Unsaved changes (Cmd/Ctrl+S to save)', 'below')}
          data-drag-keep-fill
        />
      ) : (
        <div style={{ width: '12px', marginRight: '7px', flexShrink: 0 }} />
      )}

      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: isActive ? '500' : '400'
        }}
        {...truncatedNameTip}
      >
        {tab.name}
      </span>

      {!isHome && hasPendingDualWrite && (
        <span
          role="status"
          aria-label="This document has unsaved changes"
          {...tip('This document has unsaved changes', 'below')}
          data-drag-keep-fill
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--danger)',
            display: 'inline-block',
            marginRight: '7px',
            flexShrink: 0
          }}
        />
      )}

      {!isHome && (
        <button
          onClick={handleTabCloseClick}
          // Polish round 2 (2026-10-04): the X had no name ("button").
          aria-label={`Close ${tab.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          // Pressing the X must not also paint the whole tab's pressed fill
          // (the tab's own onMouseDown) - that read as a grey box behind the X
          // (owner 2026-10-02, test plan U2). It never started a drag anyway:
          // the pointerdown above already stops the sortable.
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            marginLeft: '7px',
            padding: '3px',
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-3)',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
          // Owner 2026-10-02 (test plan U2, "an X ... a grey box shows behind
          // it"): the close X paints no hover plate. Its glyph brightens and
          // grows, and presses, like every chrome icon (states.css section 5).
          onMouseEnter={(e) => {
            e.currentTarget.style.color = TAB_TEXT_ACTIVE;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = TAB_TEXT;
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

function SortablePdfTab(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id: props.tab.id });

  return (
    <TabItem
      {...props}
      isDragging={isDragging}
      isSorting={isSorting}
      setNodeRef={setNodeRef}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    />
  );
}

// Up/Down/Home/End move between a popup's enabled items; Tab leaves (closes).
const moveFocusAmong = (container, selector, key) => {
  if (!container) return false;
  const items = Array.from(container.querySelectorAll(selector)).filter((node) => !node.disabled);
  if (!items.length) return false;
  const index = items.indexOf(document.activeElement);
  let next = null;
  if (key === 'ArrowDown') next = items[(index + 1) % items.length];
  else if (key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
  else if (key === 'Home') next = items[0];
  else if (key === 'End') next = items[items.length - 1];
  if (!next) return false;
  next.focus();
  return true;
};

const placeNear = (el, x, y, setPos) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = rect.width || 200;
  const height = rect.height || 180;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  let top = y + 2;
  if (top + height > window.innerHeight - 8) top = Math.max(8, y - height - 2);
  setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
};

const TAB_MENU_ITEMS = [
  { action: 'close', label: 'Close tab' },
  { action: 'closeOthers', label: 'Close other tabs' },
  { action: 'closeAll', label: 'Close all tabs' },
  null,
  { action: 'download', label: 'Download' },
  { action: 'rename', label: 'Rename document' },
];

function TabContextMenu({ menu, tab, documentTabCount, signedIn, onAction, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    placeNear(ref.current, menu.x, menu.y, setPos);
  }, [menu.x, menu.y]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    });
    const returnTo = menu.returnFocus;
    const viaKeyboard = menu.viaKeyboard;
    return () => {
      cancelAnimationFrame(frame);
      // A menu opened from the keyboard hands focus back to its tab.
      if (viaKeyboard && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [menu]);

  const disabledFor = (action) => {
    if (action === 'closeOthers') return documentTabCount < 2;
    if (action === 'rename') return !canRenameTab(tab, signedIn);
    return false;
  };

  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={`${tab.name} tab`}
        data-tab-context-menu=""
        className="tab-strip-menu"
        style={pos ? { left: pos.left, top: pos.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (moveFocusAmong(ref.current, '[role="menuitem"]', e.key)) {
            e.preventDefault();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {TAB_MENU_ITEMS.map((item, index) => (item ? (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            className="tab-strip-menu__item"
            disabled={disabledFor(item.action)}
            onClick={() => {
              onClose();
              onAction(item.action, tab.id);
            }}
          >
            {item.label}
          </button>
        ) : <div key={`rule-${index}`} role="separator" className="tab-strip-menu__rule" />))}
      </div>
    </>,
    document.body,
  );
}

function TabListPanel({ anchor, documentTabs, activeTabId, onPick, onCloseTab, onCloseAll, onClose }) {
  const ref = useRef(null);
  // A long name gets the app's chip, only when the row has cut it short.
  const tip = useTooltip();
  const nameTipWhenCut = (name) => {
    const binding = tip(name, 'left');
    const onlyWhenCut = (show) => (show
      ? (e) => {
        const el = e.currentTarget;
        if (el && el.scrollWidth > el.clientWidth) show(e);
      }
      : undefined);
    return {
      ...binding,
      onMouseEnter: onlyWhenCut(binding.onMouseEnter),
      onPointerEnter: onlyWhenCut(binding.onPointerEnter),
    };
  };
  const left = Math.max(8, Math.min(anchor.right - 300, window.innerWidth - 308));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const current = root.querySelector('[aria-current="page"] .tab-strip-list__open')
        || root.querySelector('.tab-strip-list__open');
      current?.scrollIntoView?.({ block: 'nearest' });
      current?.focus({ preventScroll: true });
    });
    const returnTo = anchor.button;
    return () => {
      cancelAnimationFrame(frame);
      if (returnTo?.isConnected && ref.current?.contains(document.activeElement)) returnTo.focus({ preventScroll: true });
    };
  }, [anchor]);

  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
      <div
        ref={ref}
        id="tab-strip-list"
        role="dialog"
        aria-label="Open documents"
        data-tab-list-panel=""
        className="tab-strip-list"
        style={{ left, top: anchor.bottom + 4 }}
        onKeyDown={(e) => {
          if (moveFocusAmong(ref.current, '.tab-strip-list__open', e.key)) e.preventDefault();
        }}
      >
        <div className="tab-strip-list__head">
          <span>{`Open documents (${documentTabs.length})`}</span>
          <button type="button" className="tab-strip-list__close-all" onClick={() => { onClose(); onCloseAll(); }}>
            Close all
          </button>
        </div>
        <div className="tab-strip-list__rows" role="list">
          {documentTabs.map((tab) => {
            const current = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="listitem"
                className="tab-strip-list__row"
                aria-current={current ? 'page' : undefined}
                data-tab-list-row={tab.id}
              >
                <button
                  type="button"
                  className="tab-strip-list__open"
                  onClick={() => { onClose(); onPick(tab.id); }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }}
                >
                  <span
                    className={`tab-strip-list__dot${tab.hasUnsavedAnnotations ? '' : ' tab-strip-list__dot--none'}`}
                    aria-hidden="true"
                  />
                  <span className="tab-strip-list__name" {...nameTipWhenCut(tab.name)}>{tab.name}</span>
                </button>
                <button
                  type="button"
                  className="tab-strip-list__x"
                  aria-label={`Close ${tab.name}`}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}

const TabBar = ({ tabs, activeTabId, onTabClick, onTabClose, onTabReorder, onTabMenuAction, signedIn = false }) => {
  const scrollerRef = useRef(null);
  const overflowButtonRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [listAnchor, setListAnchor] = useState(null);
  const [overflowing, setOverflowing] = useState(false);

  // Phase 30 — fix 2026-04-29: previously each tab in the .map() loop called
  // useTabPendingDualWrite individually; the hook count changed when a tab
  // was closed, triggering React's "Rendered fewer hooks than expected"
  // crash on every PDF close. Now we call the hook ONCE at the top with no
  // arguments and get back a Set of documentIds with stuck queue entries.
  // The .map() consults the Set — no hooks inside the loop.
  const pendingDualWriteDocIds = useDocsPendingDualWrite();

  // Use drag-to-reorder for tabs (excluding home tab)
  const pdfTabs = tabs.filter(t => !t.isHome);
  const homeTab = tabs.find(t => t.isHome);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 5 } }),
    // Space picks a tab up to reorder it; Enter is left free to open the tab.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    })
  );
  const tabModifiers = useMemo(() => [
    restrictToHorizontalAxis,
    createTabBoundsModifier(),
  ], []);

  const handleTabDragEnd = useCallback(({ active, over }) => {
    if (!over || active.id === over.id) return;

    const fromIndex = pdfTabs.findIndex((tab) => tab.id === active.id);
    const toIndex = pdfTabs.findIndex((tab) => tab.id === over.id);
    const reorderedPdfTabs = moveItem(pdfTabs, fromIndex, toIndex);

    if (reorderedPdfTabs === pdfTabs) return;

    flushSync(() => {
      onTabReorder(homeTab ? [homeTab, ...reorderedPdfTabs] : reorderedPdfTabs);
    });
  }, [homeTab, onTabReorder, pdfTabs]);

  const openMenu = useCallback((tabId, point, tabNode, viaKeyboard = false) => {
    setListAnchor(null);
    setMenu({
      tabId,
      x: point.x,
      y: point.y,
      returnFocus: tabNode || null,
      viaKeyboard,
    });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeList = useCallback(() => setListAnchor(null), []);

  // Chunk C: the "N ▾" list only appears when the tabs no longer fit.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const measure = () => {
      const next = scroller.scrollWidth > scroller.clientWidth + 1;
      setOverflowing((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [tabs.length]);

  // The active tab is always in view: picking one from the list, opening a
  // document or closing a neighbour scrolls the strip to it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !activeTabId) return;
    const node = Array.from(scroller.querySelectorAll('[data-pdf-tab-id]'))
      .find((candidate) => candidate.dataset.pdfTabId === activeTabId);
    if (!node) return;
    const start = node.offsetLeft;
    const end = start + node.offsetWidth;
    if (start < scroller.scrollLeft) scroller.scrollLeft = start;
    else if (end > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = end - scroller.clientWidth;
  }, [activeTabId, tabs.length, overflowing]);

  const menuTab = menu ? pdfTabs.find((tab) => tab.id === menu.tabId) : null;

  // The list closes itself once the last document is gone.
  useEffect(() => {
    if (listAnchor && pdfTabs.length === 0) setListAnchor(null);
  }, [listAnchor, pdfTabs.length]);

  return (
    <div
      style={{
        display: 'flex',
        background: TAB_BAR_BG,
        borderBottom: `1px solid ${TAB_BORDER}`,
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      <style>{`
        .tab-bar::-webkit-scrollbar {
          height: 6px;
        }
        .tab-bar::-webkit-scrollbar-track {
          background: ${TAB_BAR_BG};
        }
        .tab-bar::-webkit-scrollbar-thumb {
          background: ${TAB_BORDER};
          border-radius: 3px;
        }
        .tab-bar::-webkit-scrollbar-thumb:hover {
          background: var(--surface-3);
        }
      `}</style>
      <div
        ref={scrollerRef}
        data-tab-strip-scroller=""
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
          scrollbarColor: `${TAB_BORDER} ${TAB_BAR_BG}`
        }}
      >
        <div
          className="tab-bar"
          style={{
            display: 'flex',
            minWidth: '100%',
            width: 'max-content',
            height: `${TAB_HEIGHT}px`
          }}
        >
          {homeTab && (
            <TabItem
              tab={homeTab}
              isActive={homeTab.id === activeTabId}
              isHome
              hasPendingDualWrite={false}
              onTabClick={onTabClick}
              onTabClose={onTabClose}
            />
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={tabModifiers}
            autoScroll={CALM_STRIP_AUTO_SCROLL}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext items={pdfTabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
              <div data-pdf-tab-list style={{ display: 'flex', height: `${TAB_HEIGHT}px` }}>
                {pdfTabs.map((tab) => {
                  // Phase 30 — per-tab dual-write dot. We do NOT call a hook here
                  // (closing a tab would change the hook count and crash render).
                  // Consult the Set computed once at the top of TabBar instead.
                  const tabDocId = tab.documentId || tab.id;
                  const hasPendingDualWrite = pendingDualWriteDocIds.has(tabDocId);
                  const isActive = tab.id === activeTabId;

                  return (
                    <SortablePdfTab
                      key={tab.id}
                      tab={tab}
                      isActive={isActive}
                      isHome={false}
                      hasPendingDualWrite={hasPendingDualWrite}
                      onTabClick={onTabClick}
                      onTabClose={onTabClose}
                      onOpenMenu={openMenu}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
      {overflowing && pdfTabs.length > 0 && (
        <button
          ref={overflowButtonRef}
          type="button"
          className="tab-strip-overflow"
          aria-label={`All open documents (${pdfTabs.length})`}
          aria-haspopup="dialog"
          aria-expanded={listAnchor ? 'true' : 'false'}
          aria-controls={listAnchor ? 'tab-strip-list' : undefined}
          data-tab-strip-overflow=""
          onClick={(e) => {
            if (listAnchor) {
              setListAnchor(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu(null);
            setListAnchor({ right: rect.right, bottom: rect.bottom, button: e.currentTarget });
          }}
        >
          <span>{pdfTabs.length}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      )}
      {menu && menuTab && (
        <TabContextMenu
          menu={menu}
          tab={menuTab}
          documentTabCount={pdfTabs.length}
          signedIn={signedIn}
          onAction={(action, tabId) => onTabMenuAction?.(action, tabId)}
          onClose={closeMenu}
        />
      )}
      {listAnchor && pdfTabs.length > 0 && (
        <TabListPanel
          anchor={listAnchor}
          documentTabs={pdfTabs}
          activeTabId={activeTabId}
          onPick={onTabClick}
          onCloseTab={onTabClose}
          onCloseAll={() => onTabMenuAction?.('closeAll', null)}
          onClose={closeList}
        />
      )}
    </div>
  );
};

export default TabBar;
