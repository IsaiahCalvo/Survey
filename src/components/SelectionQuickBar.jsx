// Drawboard canvas audit, chunk 4 — the floating quick bar over a selection.
//
// Intended UX (owner brief, Drawboard PDF's selection menu, scratchpad
// drawboardDeep/CANVAS.md section 6):
//   - Select a mark on the desktop layout (a mouse, an iPad, a touch laptop)
//     and a small calm bar appears just above it: Colour, Line (width and
//     style), Duplicate, Delete and More. More opens the very right-click menu.
//   - Every control is a shortcut onto what already exists, so a change here is
//     the same save, sync and Undo step as the same change made elsewhere:
//       colour  -> the tool bar's own colour discs / swatch and picker
//                  (AppShell resolveAnnotationPaint, passed in as `paint`),
//       line    -> the tool bar's own width and style writes (the published
//                  tool-bar API),
//       Delete / Duplicate -> the page layer's Delete and Cmd/Ctrl+D keys,
//       More    -> the right-click menu, opened on the picked mark.
//   - It hides at once while the selection is moved, resized or rotated and
//     comes back as soon as the gesture ends (Drawboard's timing: no fade).
//   - It flips below the selection when there is no room above, never leaves
//     the viewer, and follows scroll and zoom by reading the selection frame's
//     on-screen box. It never reaches into the annotation layer's zoom
//     handling (CLAUDE.md: the SVG viewBox owns all zoom scaling).
//   - Several marks picked: only what applies to every one of them
//     (utils/selectionQuickBar.js planSelectionQuickBar).
//   - Survey Markers: the template's entity swatches in place of colour.
//   - The phone has its own selection strip; this bar is desktop layout only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import { QuickColourDots, QuickPaintSwatch } from './QuickStyleControls';
import { SurveyEntitySwatch } from './SurveyEntityBar';
import SurveyOverflowRow from './SurveyOverflowRow';
import { watchLightPopover } from './dismissRules.js';
import { useMenuFocus } from '../hooks/useMenuFocus.js';
import { HISTORY_PAGE_SELECTION_EVENT } from '../utils/historyMarkFilter.js';
import { LINE_STYLE_OPTIONS, LINE_STYLE_SAMPLE_ICONS } from '../utils/lineStyleOptions.js';
import {
  QUICK_BAR_WIDTHS,
  computeSelectionQuickBarPosition,
  isQuickBarWidth,
  planSelectionQuickBar,
  selectionCommandKey,
  selectionFrameRect,
  selectionItemSelector,
} from '../utils/selectionQuickBar.js';
import './SelectionQuickBar.css';

// How many entity swatches the bar draws before "All N" (SurveyOverflowRow).
const ENTITY_SWATCH_MAX = 6;
// About the height of the right-click menu on a mark (10 rows), for More.
const MORE_MENU_ROOM = 320;

const isMac = () => {
  try {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  } catch {
    return false;
  }
};

/** What is picked on every page, from the page layers' own broadcast. */
function useSelectedItems() {
  const [byPage, setByPage] = useState(() => new Map());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPick = (event) => {
      const page = Number(event?.detail?.pageNumber);
      if (!Number.isFinite(page)) return;
      const items = (event?.detail?.items || [])
        .filter((item) => item && item.id != null && item.typeKey)
        .map((item) => ({ id: String(item.id), typeKey: item.typeKey, pageNumber: page }));
      setByPage((current) => {
        const before = current.get(page) || [];
        if (before.length === items.length
          && before.every((item, i) => item.id === items[i].id && item.typeKey === items[i].typeKey)) return current;
        const next = new Map(current);
        if (items.length) next.set(page, items); else next.delete(page);
        return next;
      });
    };
    window.addEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
    return () => window.removeEventListener(HISTORY_PAGE_SELECTION_EVENT, onPick);
  }, []);
  return useMemo(() => [...byPage.values()].flat(), [byPage]);
}

// Every opened document tab keeps its viewer mounted (AppShell hides the
// others with display: none), so a plain querySelector can land in a hidden
// tab and the bar never showed on any tab but the first opened (batch-6
// verify). Prefer the element that is on screen.
const shownElement = (selector) => {
  const all = document.querySelectorAll(selector);
  for (const element of all) if (element.getClientRects().length > 0) return element;
  return all[0] || null;
};

const pageLayer = (pageNumber) => shownElement(`svg[data-svg-annotation-layer="${pageNumber}"]`);

const visibleRect = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
};

/** The viewer area the bar must stay inside: under the tool bars. */
function viewerBounds() {
  const container = shownElement('[data-testid="pdf-container"]')
    || shownElement('[data-mobile-pdf-surface="false"]');
  const rect = container?.getBoundingClientRect?.();
  let top = Math.max(rect ? rect.top : 0, 0);
  const bottom = Math.min(rect ? rect.bottom : window.innerHeight, window.innerHeight);
  const host = document.getElementById('chrome-sub-toolbar-host');
  const hostRect = host && getComputedStyle(host).display !== 'none' ? host.getBoundingClientRect() : null;
  if (hostRect && hostRect.height > 0 && hostRect.bottom < bottom) top = Math.max(top, hostRect.bottom);
  const left = Math.max(rect ? rect.left : 0, 0);
  const right = Math.min(rect ? rect.right : window.innerWidth, window.innerWidth);
  return { left, top, right, bottom };
}

/**
 * Reads the live selection off the page: its on-screen frame, whether a
 * move / resize / rotate is running, whether the picked tool may not touch it,
 * and whether a picked mark is locked.
 */
function readSelection(items) {
  const pages = [...new Set(items.map((item) => item.pageNumber))];
  const rects = [];
  let gesture = false;
  let inert = false;
  let locked = false;
  for (const page of pages) {
    const svg = pageLayer(page);
    if (!svg) continue;
    if (svg.getAttribute('data-selection-gesture') === 'true') gesture = true;
    if (svg.getAttribute('data-selection-chrome-inert') === 'true') inert = true;
    if (svg.querySelector('[data-selection-lock-badge]')) locked = true;
    svg.querySelectorAll('.svg-selection-overlay').forEach((overlay) => {
      const rect = visibleRect(overlay);
      if (rect) rects.push(rect);
    });
  }
  // A pick drawn without the shared frame (a Survey Marker's own ring, say):
  // the picked marks' own boxes.
  if (rects.length === 0) {
    for (const item of items) {
      const selector = selectionItemSelector(item);
      const element = selector ? (pageLayer(item.pageNumber)?.querySelector(selector) || null) : null;
      const rect = visibleRect(element);
      if (rect) rects.push(rect);
    }
  }
  return { frame: selectionFrameRect(rects), gesture, inert, locked };
}

const sameLook = (a, b) => a.visible === b.visible && a.side === b.side && a.locked === b.locked && a.readOnly === b.readOnly;

export default function SelectionQuickBar({
  enabled = true,
  api = null,
  paint = null,
  swatch = null,
  onOpenColourPicker,
  entities = null,
  surveyMarkers = null,
  onPickEntity,
  tip,
}) {
  const contextTip = useTooltip();
  const chromeTip = tip || contextTip;
  const items = useSelectedItems();
  const barRef = useRef(null);
  const lineButtonRef = useRef(null);
  const linePopoverRef = useRef(null);
  const [look, setLook] = useState({ visible: false, side: 'above', locked: false, readOnly: false });
  const [lineOpen, setLineOpen] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const editingText = Boolean(api?.richTextEditor);
  const active = Boolean(enabled && items.length > 0 && !editingText);
  const activeRef = useRef(active);
  activeRef.current = active;

  // One placement pass: read the selection, place the bar, show or hide it.
  const frameRef = useRef(0);
  const place = useCallback(() => {
    frameRef.current = 0;
    const bar = barRef.current;
    if (!bar) return;
    const readOnly = document.body?.getAttribute('data-readonly') === 'true';
    let next = { visible: false, side: 'above', locked: false, readOnly };
    if (activeRef.current && !readOnly) {
      const selection = readSelection(itemsRef.current);
      next.locked = selection.locked;
      if (selection.frame && !selection.gesture && !selection.inert) {
        const placed = computeSelectionQuickBarPosition({
          selectionRect: selection.frame,
          bounds: viewerBounds(),
          barWidth: bar.offsetWidth,
          barHeight: bar.offsetHeight,
        });
        if (placed) {
          bar.style.left = `${placed.left}px`;
          bar.style.top = `${placed.top}px`;
          next = { ...next, visible: true, side: placed.side };
        }
      }
    }
    // Hide straight away (a drag has started): no waiting for React.
    bar.setAttribute('data-visible', next.visible ? 'true' : 'false');
    setLook((current) => (sameLook(current, next) ? current : next));
  }, []);
  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(place);
  }, [place]);

  // Re-place whenever the pick changes, and follow scroll, zoom, resize and
  // every change to the page layers (a drag starting or ending flips
  // data-selection-gesture; a zoom rewrites the page boxes).
  useLayoutEffect(() => {
    place();
  }, [place, items, active, api?.contextTool, api?.selectionCount]);
  useEffect(() => {
    if (!active) return undefined;
    const onAny = () => schedule();
    window.addEventListener('scroll', onAny, true);
    window.addEventListener('resize', onAny);
    window.addEventListener('pointerup', onAny, true);
    window.addEventListener('keyup', onAny, true);
    const root = shownElement('[data-testid="pdf-container"]')
      || shownElement('[data-mobile-pdf-surface="false"]')
      || document.body;
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onAny);
    observer?.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'transform', 'viewBox', 'width', 'height', 'x', 'y', 'd', 'points', 'data-selection-gesture', 'data-selection-chrome-inert'],
    });
    const bodyObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onAny);
    bodyObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-readonly'] });
    return () => {
      window.removeEventListener('scroll', onAny, true);
      window.removeEventListener('resize', onAny);
      window.removeEventListener('pointerup', onAny, true);
      window.removeEventListener('keyup', onAny, true);
      observer?.disconnect();
      bodyObserver?.disconnect();
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [active, schedule]);

  // A wheel over the bar scrolls (or, with Ctrl/Cmd, zooms) the page under it.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const onWheel = (event) => {
      if (event.target?.closest?.('[data-selection-quick-bar-popover]')) return;
      const scroller = shownElement('[data-mobile-pdf-surface="false"]');
      if (!scroller) return;
      event.preventDefault();
      // The same hand-off the viewer's own scroll rails make
      // (PdfjsViewerContainer forwardRailWheel): a zoom goes to the scroller
      // as a wheel event at the same point, a scroll scrolls it.
      if (event.ctrlKey || event.metaKey) {
        scroller.dispatchEvent(new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          bubbles: true,
          cancelable: true,
        }));
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollBy({ left: event.deltaX * unit, top: event.deltaY * unit });
    };
    bar.addEventListener('wheel', onWheel, { passive: false });
    return () => bar.removeEventListener('wheel', onWheel);
  }, [enabled]);

  const plan = useMemo(() => planSelectionQuickBar({
    items,
    api,
    entityCount: Array.isArray(entities) ? entities.length : 0,
    locked: look.locked,
    readOnly: look.readOnly,
  }), [api, entities, items, look.locked, look.readOnly]);

  const visible = active && look.visible && Boolean(plan);
  useEffect(() => {
    if (!visible) setLineOpen(false);
  }, [visible]);
  // The bar's size changes with what it holds; place it again for that size.
  useLayoutEffect(() => {
    if (active) place();
  }, [active, place, plan?.colour, plan?.width, plan?.style, plan?.remove]);

  // The Line popover's dismiss rules (outside press, Escape) are the app's.
  // KAL-66: opened from a keyboard, focus goes into it and Up / Down move
  // through its buttons; closing hands focus back to the Line button.
  useMenuFocus(linePopoverRef, lineOpen && visible);
  useEffect(() => {
    if (!lineOpen) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(target?.closest?.('[data-selection-quick-bar-popover], [data-selection-quick-line]')),
      close: () => setLineOpen(false),
    });
  }, [lineOpen]);

  const runKey = useCallback((command) => {
    const init = selectionCommandKey(command, { mac: isMac() });
    if (!init || typeof document === 'undefined') return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    document.body.dispatchEvent(new KeyboardEvent('keyup', init));
  }, []);

  const openMore = useCallback((button) => {
    const list = itemsRef.current;
    const item = list[0];
    const selector = selectionItemSelector(item);
    const target = selector
      ? (pageLayer(item.pageNumber)?.querySelector(selector) || shownElement(selector))
      : null;
    if (!target) return;
    // The menu opens with its corner at this point (and flips up / left
    // where it would not fit, like any right-click menu). Under the button
    // when a full menu fits below it; otherwise beside the bar's end, so a
    // menu that has to grow upward never covers the button that opened it.
    // (The menu keeps inside the page it belongs to, so the room is the page's.)
    const rect = button.getBoundingClientRect();
    const pageRect = shownElement(`.survey-pdfjs-page-div[data-page-number="${item.pageNumber}"]`)?.getBoundingClientRect?.();
    const roomBelow = Math.min(pageRect ? pageRect.bottom : Infinity, viewerBounds().bottom, window.innerHeight) - rect.bottom;
    const point = roomBelow >= MORE_MENU_ROOM
      ? { x: rect.left, y: rect.bottom + 4 }
      : { x: rect.right + 4, y: rect.top };
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 2,
      clientX: Math.round(point.x),
      clientY: Math.round(point.y),
    }));
  }, []);

  const markerIds = useMemo(
    () => items.filter((item) => item.typeKey === 'surveyMarker').map((item) => item.id),
    [items],
  );
  const markerEntityId = markerIds.length ? (surveyMarkers?.[markerIds[0]]?.entityId || null) : null;
  const tipSide = look.side === 'above' ? 'above' : 'below';
  const button = (label, icon, onActivate, extra = {}) => (
    <button
      type="button"
      className="selection-quick-bar__button"
      aria-label={label}
      {...chromeTip(label, tipSide)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => onActivate(event.currentTarget)}
      {...extra}
    >
      <Icon name={icon} size={18} color="currentColor" />
    </button>
  );

  const styleValue = (api?.lineBorderStyle === 'cloud' && !api?.supportsCloudStyle) ? 'solid' : (api?.lineBorderStyle || 'solid');
  const styleMixed = Boolean(api?.selectionMixed?.lineStyle);
  const widthMixed = Boolean(api?.selectionMixed?.width);
  const widthValue = api?.strokeWidthInputValue;
  const setWidth = (width) => {
    api?.handleStrokeWidthInputChange?.({ target: { value: String(width) } });
    api?.handleStrokeWidthInputBlur?.({ currentTarget: { value: String(width) } });
  };

  const groups = [];
  if (plan?.colour === 'dots' && paint) {
    groups.push(
      <span key="colour" className="selection-quick-bar__group" data-annotation-color-trigger>
        <QuickColourDots
          value={api?.selectionMixed?.strokeColor ? null : paint.quick.color}
          customActive={api?.selectionMixed?.strokeColor ? false : undefined}
          onPick={(hex) => paint.quick.apply(hex, paint.quick.opacity)}
          onOpenPicker={onOpenColourPicker}
        />
      </span>,
    );
  } else if (plan?.colour === 'swatch' && swatch) {
    groups.push(
      <span key="colour" className="selection-quick-bar__group" data-annotation-color-trigger>
        <QuickPaintSwatch
          variant={swatch.variant}
          ring={swatch.ring}
          center={swatch.center}
          mixed={swatch.mixed}
          onOpen={onOpenColourPicker}
        />
      </span>,
    );
  } else if (plan?.colour === 'entity') {
    const list = (entities || []).filter((entity) => entity && entity.id != null);
    groups.push(
      <SurveyOverflowRow
        key="colour"
        className="selection-quick-bar__group quick-style quick-style--colours"
        data-selection-quick-entities="true"
        items={list}
        currentId={markerEntityId}
        recentIds={[]}
        sections={[{
          id: 'entities',
          label: null,
          items: list.map((entity) => ({ id: entity.id, label: entity.name || 'Untitled entity', swatch: entity.color || null })),
        }]}
        noun="entities"
        searchPlaceholder="Find an entity"
        tip={chromeTip}
        max={ENTITY_SWATCH_MAX}
        onPickFromList={(entry) => onPickEntity?.(entry.id, markerIds)}
        renderItem={(entity) => (
          <SurveyEntitySwatch
            key={entity.id}
            entity={entity}
            current={entity.id === markerEntityId}
            tip={chromeTip}
            tipSide={tipSide}
            onPick={() => onPickEntity?.(entity.id, markerIds)}
          />
        )}
      />,
    );
  }
  if (plan?.width || plan?.style) {
    groups.push(
      <span key="line" className="selection-quick-bar__group" data-selection-quick-line>
        <button
          ref={lineButtonRef}
          type="button"
          className={`selection-quick-bar__button${lineOpen ? ' is-open' : ''}`}
          aria-label="Line"
          aria-haspopup="dialog"
          aria-expanded={lineOpen}
          {...(lineOpen ? {} : chromeTip('Line', tipSide))}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setLineOpen((open) => !open)}
        >
          <Icon name={LINE_STYLE_SAMPLE_ICONS[styleMixed ? 'solid' : styleValue] || 'lineSampleSolid'} size={20} color="currentColor" />
        </button>
      </span>,
    );
  }
  groups.push(
    <span key="actions" className="selection-quick-bar__group">
      {plan?.duplicate && button('Duplicate', 'duplicate', () => runKey('duplicate'))}
      {plan?.remove && button('Delete', 'trash', () => runKey('delete'))}
    </span>,
  );
  if (plan?.more) {
    groups.push(
      <span key="more" className="selection-quick-bar__group">
        {button('More', 'more', openMore, { 'aria-haspopup': 'menu' })}
      </span>,
    );
  }

  const linePopover = lineOpen && visible ? (
    <div
      ref={linePopoverRef}
      className="selection-quick-bar__popover"
      data-selection-quick-bar-popover="true"
      data-side={look.side === 'above' ? 'above' : 'below'}
      role="dialog"
      aria-label="Line"
    >
      {plan?.width && (
        <div className="selection-quick-bar__widths" role="group" aria-label="Line width">
          {QUICK_BAR_WIDTHS.map((width) => {
            const current = !widthMixed && isQuickBarWidth(widthValue, width);
            return (
              <button
                key={width}
                type="button"
                className={`selection-quick-bar__width${current ? ' is-current' : ''}`}
                aria-label={`Width ${width} pt`}
                aria-pressed={current}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setWidth(width)}
              >
                <span className="selection-quick-bar__width-line" aria-hidden="true" style={{ height: `${Math.min(6, width)}px` }} />
                <span className="selection-quick-bar__width-label" aria-hidden="true">{width}</span>
              </button>
            );
          })}
        </div>
      )}
      {plan?.style && (
        <div className="selection-quick-bar__styles" role="group" aria-label="Line style">
          {LINE_STYLE_OPTIONS
            .filter((option) => option.value !== 'cloud' || api?.supportsCloudStyle)
            .map((option) => {
              const current = !styleMixed && option.value === styleValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`selection-quick-bar__style${current ? ' is-current' : ''}`}
                  aria-pressed={current}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => api?.setLineBorderStyle?.(option.value)}
                >
                  <Icon name={LINE_STYLE_SAMPLE_ICONS[option.value]} size={24} color="currentColor" />
                  <span>{option.label}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  ) : null;

  // The phone layout (and a viewer that is not on screen) draws nothing.
  if (typeof document === 'undefined' || !enabled) return null;
  return createPortal(
    <div
      ref={barRef}
      className="selection-quick-bar"
      data-selection-quick-bar="true"
      data-visible={visible ? 'true' : 'false'}
      data-side={look.side}
      role="toolbar"
      aria-label="Selection actions"
      aria-hidden={visible ? undefined : 'true'}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group, index) => (
        <span key={group.key} style={{ display: 'contents' }}>
          {index > 0 && <span className="selection-quick-bar__divider" aria-hidden="true" />}
          {group}
        </span>
      ))}
      {linePopover}
    </div>,
    document.body,
  );
}
