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
//   - It flips below the selection when there is no room above, or when the
//     rotate grabber is on top; it never covers a rotate grabber (a counter
//     pin's too) or the degree box beside it; it never leaves the viewer,
//     and follows scroll and zoom by reading the selection frame's on-screen
//     box. It never reaches into the annotation layer's zoom
//     handling (CLAUDE.md: the SVG viewBox owns all zoom scaling).
//   - Several marks picked: only what applies to every one of them
//     (utils/selectionQuickBar.js planSelectionQuickBar).
//   - Survey Markers: the template's entity swatches in place of colour.
//   - The phone has its own selection strip for colour and line, so there
//     (`phone`) the bar holds only Duplicate and Delete, sized for a finger
//     (owner 2026-10-28: a visible Delete, like Drawboard; long press still
//     opens the full menu).
import { isFeatureOn } from '../featureFlags.js';
import { authorChipText, authorGroups } from '../utils/authorChip.js';
import { getAnnotationRenderIdentity } from '../utils/annotationStorageIdentity.js';
import { dockedBarPosition, isSelectionBarDocked, useSelectionBarDocked } from '../utils/selectionBarDock.js';
import { isInTabBehind } from '../utils/tabBehind.js';
import { resolveViewerOcclusionInsets } from '../utils/searchMatchNavigation.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import { QuickColourDots, QuickPaintSwatch } from './QuickStyleControls';
import { FILL_QUICK_COLOURS, FILL_QUICK_COLOUR_NAMES, quickColoursForTool } from '../utils/quickStylePresets.js';
import { LineEndingsPanel, LineEndsSample } from './LineEndingsPicker.jsx';
import { parsePickedLineEnds } from '../utils/lineEndingDefaults.js';
import { SurveyEntitySwatch } from './SurveyEntityBar';
import SurveyOverflowRow from './SurveyOverflowRow';
import MeasureEditPopover from './MeasureEditPopover';
import { useHangingPopoverPlace } from './useHangingPopoverPlace.js';
import { watchLightPopover } from './dismissRules.js';
import { useMenuFocus } from '../hooks/useMenuFocus.js';
import { HISTORY_PAGE_SELECTION_EVENT } from '../utils/historyMarkFilter.js';
import { LINE_STYLE_SAMPLE_ICONS, lineStyleOptionsWith } from '../utils/lineStyleOptions.js';
import { setPropertiesPanelOpen, usePropertiesPanelOpen } from '../utils/propertiesPanelStore.js';
import {
  QUICK_BAR_FONT_FAMILIES,
  QUICK_BAR_WIDTHS,
  QUICK_BAR_OPACITIES,
  computeSelectionQuickBarPosition,
  isQuickBarWidth,
  nextTextAlign,
  planSelectionQuickBar,
  selectionCommandKey,
  selectionFrameRect,
  selectionItemSelector,
  selectionKeepOut,
  stepFontSize,
} from '../utils/selectionQuickBar.js';
import { linkGoToLabel } from '../utils/linkTool.js';
import { composeTextColor, splitTextColor } from '../utils/textColorOpacity.js';
import { SELECTION_CONTROLS } from '../utils/markMenuPlacement.js';
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
export function useSelectedItems() {
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

// Every opened document tab keeps its viewer mounted (a tab behind keeps real
// sizes, utils/tabBehind.js), so a plain querySelector can land in a hidden
// tab and the bar never showed on any tab but the first opened (batch-6
// verify). Prefer the element that is on screen.
const shownElement = (selector) => {
  const all = document.querySelectorAll(selector);
  for (const element of all) if (!isInTabBehind(element) && element.getClientRects().length > 0) return element;
  return all[0] || null;
};

const pageLayer = (pageNumber) => shownElement(`svg[data-svg-annotation-layer="${pageNumber}"]`);

const visibleRect = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
};

// A perfectly level or upright line (a Shift-snapped length, say) has no
// height or no width, so it framed nothing and the bar never showed for it.
// It is framed as wide as its end grabbers instead.
const HAIRLINE_PAD = 8;
const cssEscape = (value) => String(value).replace(/["\\]/g, '\\$&');
const hairlineRect = (element) => {
  const rect = element?.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0 || rect.height > 0)) return null;
  const padX = rect.width > 0 ? 0 : HAIRLINE_PAD;
  const padY = rect.height > 0 ? 0 : HAIRLINE_PAD;
  return { left: rect.left - padX, top: rect.top - padY, right: rect.right + padX, bottom: rect.bottom + padY };
};

/** The viewer area the bar must stay inside: under the tool bars. */
export function viewerBounds(phone = false) {
  const container = shownElement('[data-testid="pdf-container"]')
    || shownElement('[data-mobile-pdf-surface="false"]');
  const rect = container?.getBoundingClientRect?.();
  let top = Math.max(rect ? rect.top : 0, 0);
  let bottom = Math.min(rect ? rect.bottom : window.innerHeight, window.innerHeight);
  const host = document.getElementById('chrome-sub-toolbar-host');
  const hostRect = host && getComputedStyle(host).display !== 'none' ? host.getBoundingClientRect() : null;
  if (hostRect && hostRect.height > 0 && hostRect.bottom < bottom) top = Math.max(top, hostRect.bottom);
  let left = Math.max(rect ? rect.left : 0, 0);
  let right = Math.min(rect ? rect.right : window.innerWidth, window.innerWidth);
  if (phone && rect) {
    // The phone's tool strip, tool rail, dock and sheets lie over the page.
    const occluders = Array.from(document.querySelectorAll('[data-viewer-occluder], .mobile-pdf-tools, .mobile-pdf-properties'))
      .filter((node) => !isInTabBehind(node) && node.getClientRects().length > 0)
      .map((node) => node.getBoundingClientRect());
    const insets = resolveViewerOcclusionInsets(rect, occluders);
    top = Math.max(top, rect.top + insets.top);
    bottom = Math.min(bottom, rect.bottom - insets.bottom);
    left = Math.max(left, rect.left + insets.left);
    right = Math.min(right, rect.right - insets.right);
  }
  return { left, top, right, bottom };
}

/** A grabber's turning point (data-turn-cx/cy, page units) on screen. */
function turnCentre(grabber) {
  const x = Number(grabber.getAttribute('data-turn-cx'));
  const y = Number(grabber.getAttribute('data-turn-cy'));
  const ctm = grabber.getScreenCTM?.();
  if (!Number.isFinite(x) || !Number.isFinite(y) || !ctm) return null;
  return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f };
}

/**
 * Reads the live selection off the page: its on-screen frame, whether a
 * move / resize / rotate is running, whether the picked tool may not touch it,
 * and whether a picked mark is locked.
 */
function readSelection(items, { measureEdit = false } = {}) {
  const pages = [...new Set(items.map((item) => item.pageNumber))];
  const rects = [];
  const handles = [];
  let gesture = false;
  let gestureLayer = null;
  let inert = false;
  let locked = false;
  for (const page of pages) {
    const svg = pageLayer(page);
    if (!svg) continue;
    if (svg.getAttribute('data-selection-gesture') === 'true') {
      gesture = true;
      gestureLayer = gestureLayer || svg;
    }
    if (svg.getAttribute('data-selection-chrome-inert') === 'true') inert = true;
    if (svg.querySelector('[data-selection-lock-badge]')) locked = true;
    svg.querySelectorAll(SELECTION_CONTROLS).forEach((overlay) => {
      const rect = visibleRect(overlay);
      if (rect) rects.push(rect);
    });
    // Rotate grabbers: a shape's (where its degree box opens too) and a
    // counter pin's, which floats out past the tail and outside the frame.
    // A dimension caption's turn circle (measure-plus) too.
    svg.querySelectorAll('[data-rotation-handle="mtr"], [data-counter-rotate-grabber], [data-caption-turn-grabber]').forEach((grabber) => {
      const rect = visibleRect(grabber);
      if (!rect) return;
      handles.push({
        rect,
        centre: turnCentre(grabber),
        pill: grabber.hasAttribute('data-rotation-handle'),
      });
    });
  }
  // Callout leaders and line ends can extend beyond the selection frame.
  for (const item of items) {
    const selector = selectionItemSelector(item);
    const element = selector ? pageLayer(item.pageNumber)?.querySelector(selector) : null;
    const rect = visibleRect(element) || hairlineRect(element);
    if (rect) rects.push(rect);
  }
  // A degree box already open (it can be held inside the page, away from
  // the spot selectionKeepOut keeps for it), and a finger's move grip under
  // the pick (Nightly 'box-drag-move').
  const open = [];
  document.querySelectorAll('[data-rotation-input-field], [data-box-move-grip]').forEach((field) => {
    const rect = visibleRect(field);
    if (rect) open.push(rect);
  });
  // A picked measurement's caption pill sits off its line: keep it in view
  // too, so a caption being edited (Measurement popover) is never covered.
  for (const item of measureEdit ? items : []) {
    const caption = pageLayer(item.pageNumber)?.querySelector(`[data-measure-for="${cssEscape(item.id)}"]`);
    const rect = visibleRect(caption);
    if (rect) open.push(rect);
  }
  return { frame: selectionFrameRect(rects), gesture, gestureLayer, inert, locked, ...selectionKeepOut({ handles, extra: open }) };
}

// A move, resize or rotate hides the bar for its whole length, yet every frame
// of it rewrites the page and wakes the placement pass. While the same pick's
// page layer is still mid-gesture, nothing a full read finds can show the bar,
// and that read scans the whole viewer (a document-wide query per page, three
// more over every mark of the layer): about 2 ms a frame on a dense sheet.
// So the pass only checks that one flag until the gesture ends.
const gestureStillHeld = (held, items) => Boolean(held
  && held.items === items
  && held.layer.isConnected
  && held.layer.getAttribute('data-selection-gesture') === 'true'
  && held.layer.getClientRects().length > 0);

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
  // Comments on marks (Nightly): start a thread on the one picked mark.
  onComment = null,
  // The phone layout: Duplicate and Delete only (see the header).
  phone = false,
  tip,
  // Nightly 'author-chip': the marks, the viewer, the layers and the
  // document, so the bar can name who made the pick.
  annotationsByPage = null,
  viewerId = null,
  layerState = null,
  documentId = null,
  // Nightly 'mark-bar-by-kind' (KAL-651): the picked text box's or callout's
  // text settings (AppShell resolveTextFormatting), for size, bold and align.
  textFormat = null,
}) {
  const contextTip = useTooltip();
  const chromeTip = tip || contextTip;
  const items = useSelectedItems();
  const barRef = useRef(null);
  const protectedRects = useRef([]);
  const lineButtonRef = useRef(null);
  const linePopoverRef = useRef(null);
  const [look, setLook] = useState({ visible: false, side: 'above', locked: false, readOnly: false });
  const [lineOpen, setLineOpen] = useState(false);
  // The Measurement popover (Nightly 'measure-edit', MeasureEditPopover).
  const [measureOpen, setMeasureOpen] = useState(false);
  const closeMeasure = useCallback(() => setMeasureOpen(false), []);
  // Nightly 'mark-bar-by-kind' (KAL-651): the bar's front part goes by the
  // kind of mark. `kindOpen` is its open popover: 'fill', 'ends' or null.
  const [byKindOn] = useState(() => isFeatureOn('mark-bar-by-kind'));
  const [kindOpen, setKindOpen] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const editingText = Boolean(api?.richTextEditor);
  const active = Boolean(enabled && items.length > 0 && !editingText);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [phoneMoreOn] = useState(() => isFeatureOn('phone-mark-more'));
  // Nightly 'selection-count' (Drawboard PDF Pro push 2026-11-12, row B15): a
  // pick of two or more marks shows how many sit in it.
  const [selectionCountOn] = useState(() => isFeatureOn('selection-count'));
  // Nightly 'measure-edit': the bar also frames a level line and keeps clear of a
  // picked measurement's caption (readSelection).
  const [measureEditOn] = useState(() => isFeatureOn('measure-edit'));
  const measureEditRef = useRef(measureEditOn);
  // Nightly 'toolbar-settings' (VT-52): the bar can dock to the bottom of the
  // page area (selectionBarDock.js) instead of following the mark.
  const [dockOn] = useState(() => isFeatureOn('toolbar-settings'));
  const docked = useSelectionBarDocked() && dockOn;
  const dockOnRef = useRef(dockOn);
  // Nightly 'author-chip' (SS-03 / SS-04): who made the pick, and a table of
  // the pick by author with each mark's date and layer.
  const [authorChipOn] = useState(() => isFeatureOn('author-chip'));
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  // One placement pass: read the selection, place the bar, show or hide it.
  const frameRef = useRef(0);
  const turningRef = useRef(false);
  const heldGestureRef = useRef(null);
  const place = useCallback(() => {
    frameRef.current = 0;
    const bar = barRef.current;
    if (!bar) return;
    const readOnly = document.body?.getAttribute('data-readonly') === 'true';
    let next = { visible: false, side: 'above', locked: false, readOnly };
    if (activeRef.current && !readOnly && gestureStillHeld(heldGestureRef.current, itemsRef.current)) {
      // Hidden, as the full read would leave it; the pick (so its lock) is
      // the one that read saw when the gesture started.
      bar.setAttribute('data-visible', 'false');
      setLook((current) => {
        const held = { ...current, visible: false, side: 'above', readOnly };
        return sameLook(current, held) ? current : held;
      });
      return;
    }
    heldGestureRef.current = null;
    if (activeRef.current && !readOnly) {
      const selection = readSelection(itemsRef.current, { measureEdit: measureEditRef.current });
      if (selection.gestureLayer) heldGestureRef.current = { layer: selection.gestureLayer, items: itemsRef.current };
      protectedRects.current = [selection.frame, ...selection.keepOut].filter(Boolean);
      next.locked = selection.locked;
      if (selection.frame && !selection.gesture && !turningRef.current && !selection.inert) {
        const dockedNow = dockOnRef.current && !phoneRef.current && isSelectionBarDocked();
        const bounds = viewerBounds(phoneRef.current);
        const placed = computeSelectionQuickBarPosition({
          dock: dockedNow ? dockedBarPosition(bounds, bar.offsetWidth, bar.offsetHeight) : null,
          selectionRect: selection.frame,
          keepOut: selection.keepOut,
          preferBelow: selection.preferBelow,
          bounds,
          barWidth: bar.offsetWidth,
          barHeight: bar.offsetHeight,
        });
        if (placed) {
          bar.style.left = `${placed.left}px`;
          bar.style.top = `${placed.top}px`;
          // Docked, its popovers open upward, as they do over a mark.
          next = { ...next, visible: true, side: placed.side === 'docked' ? 'above' : placed.side };
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
  }, [place, items, active, api?.contextTool, api?.selectionCount, docked]);
  useEffect(() => {
    if (!active) return undefined;
    const onAny = () => schedule();
    // A counter pin's turn grabber is no selection gesture of the page layer
    // (data-selection-gesture), so the bar hides itself while one is held.
    const onPress = (event) => {
      if (!event.target?.closest?.('[data-counter-rotate-grabber], [data-caption-turn-grabber]')) return;
      turningRef.current = true;
      place();
    };
    const onRelease = () => {
      turningRef.current = false;
      schedule();
    };
    window.addEventListener('scroll', onAny, true);
    window.addEventListener('resize', onAny);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('pointercancel', onRelease, true);
    window.addEventListener('keyup', onAny, true);
    const root = shownElement('[data-testid="pdf-container"]')
      || shownElement('[data-mobile-pdf-surface="false"]')
      || document.body;
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onAny);
    observer?.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'transform', 'viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'd', 'points', 'data-selection-gesture', 'data-selection-chrome-inert'],
    });
    const bodyObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onAny);
    bodyObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-readonly'] });
    return () => {
      window.removeEventListener('scroll', onAny, true);
      window.removeEventListener('resize', onAny);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
      turningRef.current = false;
      window.removeEventListener('keyup', onAny, true);
      observer?.disconnect();
      bodyObserver?.disconnect();
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [active, place, schedule]);

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

  const propertiesPanelOn = useMemo(() => isFeatureOn('properties-panel'), []);
  const propertiesPanelOpen = usePropertiesPanelOpen();
  const plan = useMemo(() => planSelectionQuickBar({
    items,
    api,
    entityCount: Array.isArray(entities) ? entities.length : 0,
    locked: look.locked,
    readOnly: look.readOnly,
    byKind: byKindOn && !phone,
    textFormat,
  }), [api, entities, items, look.locked, look.readOnly, byKindOn, phone, textFormat]);

  const visible = active && look.visible && Boolean(plan);
  const chipLive = authorChipOn && !phone && Boolean(annotationsByPage);
  useEffect(() => {
    if (!chipLive || !active || !documentId) return undefined;
    let live = true;
    // Loaded on first use: the Supabase client opens a connection on import.
    Promise.all([import('../services/markComments.js'), import('../supabaseClient')])
      .then(([{ listCommentPeople }, { supabase }]) => listCommentPeople(supabase, documentId))
      .then((list) => { if (live) setPeople(list); })
      .catch(() => { /* "Someone" stands in */ });
    return () => { live = false; };
  }, [chipLive, active, documentId]);
  const authors = useMemo(() => {
    if (!chipLive || !items.length) return [];
    const objects = [];
    for (const item of items) {
      if (item.typeKey === 'surveyMarker') continue;
      const objs = annotationsByPage?.[item.pageNumber]?.objects || [];
      const found = item.typeKey === 'callout'
        ? objs.find((o) => o?.data?.type === 'callout' && String(o?.data?.id) === String(item.id))
        : objs.find((o) => String(getAnnotationRenderIdentity(o).annotationId ?? '') === String(item.id));
      if (found) objects.push(found);
    }
    const peopleById = new Map(people.map((p) => [String(p.id), p]));
    return authorGroups(objects, { viewerId, peopleById, layerState });
  }, [chipLive, items, annotationsByPage, people, viewerId, layerState]);
  const chipText = authorChipText(authors);
  useEffect(() => {
    if (!visible || !chipText) setAuthorsOpen(false);
  }, [visible, chipText]);
  useEffect(() => {
    if (!visible) setLineOpen(false);
  }, [visible]);
  useEffect(() => {
    if (!visible || (kindOpen === 'fill' && !plan?.fill) || (kindOpen === 'ends' && !plan?.ends)
      || ((kindOpen === 'font' || kindOpen === 'textColour') && !plan?.text)) setKindOpen(null);
  }, [visible, kindOpen, plan?.fill, plan?.ends]);
  useEffect(() => {
    if (!kindOpen) return undefined;
    return watchLightPopover({
      contains: (target) => Boolean(target?.closest?.('[data-selection-quick-bar-popover], [data-selection-quick-kind]')),
      close: () => setKindOpen(null),
    });
  }, [kindOpen]);
  useEffect(() => {
    if (!visible || !plan?.measure) setMeasureOpen(false);
  }, [visible, plan?.measure]);
  // The bar's size changes with what it holds; place it again for that size.
  useLayoutEffect(() => {
    if (active) place();
  }, [active, place, plan?.colour, plan?.width, plan?.style, plan?.remove, plan?.measure, plan?.link, plan?.note, plan?.equation, plan?.audio, plan?.fill, plan?.ends, plan?.text, propertiesPanelOpen]);

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
  const opacityMixed = Boolean(api?.selectionMixed?.strokeOpacity);
  const opacityValue = Math.round(Number(api?.strokeOpacity ?? 100));
  const setWidth = (width) => {
    api?.handleStrokeWidthInputChange?.({ target: { value: String(width) } });
    api?.handleStrokeWidthInputBlur?.({ currentTarget: { value: String(width) } });
  };
  // By kind: fill and text size, read the way the properties panel reads them.
  const fillMixed = Boolean(api?.selectionMixed?.fillColor || api?.selectionMixed?.fillOpacity);
  const fillNone = Boolean(paint?.fill) && !api?.selectionMixed?.fillOpacity && paint.fill.opacity <= 0;
  // "No fill" changes only the opacity, and a shape keeps one side visible.
  const clearFill = () => {
    if (paint?.shapeOneVisibleRule && (api?.strokeOpacity ?? 100) <= 0) api?.handleStrokeOpacityChange?.(100);
    api?.handleFillOpacityChange?.(0);
  };
  const textSize = Math.round(Number(textFormat?.state?.fontSize) || 16);
  // KAL-715, Drawboard's text bar: the font name and the words' colour.
  const fontFamily = textFormat?.state?.fontFamily || 'Arial';
  const textColour = splitTextColor(textFormat?.state?.fontColor);
  const canFont = plan?.text && typeof textFormat?.api?.setFontFamily === 'function';
  const canTextColour = plan?.text && typeof textFormat?.api?.setFontColor === 'function';
  const kindButton = (kind, label, children, extra = {}) => (
    <button
      type="button"
      className={`selection-quick-bar__button${extra.wide ? ' selection-quick-bar__button--font' : ''}${kindOpen === kind ? ' is-open' : ''}`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={kindOpen === kind}
      {...(kindOpen === kind ? {} : chromeTip(label, tipSide))}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => { setLineOpen(false); setKindOpen((open) => (open === kind ? null : kind)); }}
      {...(extra.data || {})}
    >
      {children}
    </button>
  );
  const lineEnds = plan?.ends ? parsePickedLineEnds(api?.selectedLineEnds) : null;

  // Nightly 'properties-panel': "Expand menu" opens Drawboard's panel; while
  // it is open the style buttons live there and the bar keeps its actions.
  const panelAllowed = !phone && propertiesPanelOn;
  const panelHoldsStyles = panelAllowed && propertiesPanelOpen;
  const groups = [];
  if (chipText) {
    groups.push(
      <span key="author" className="selection-quick-bar__group">
        <button
          type="button"
          className="selection-quick-bar__author"
          data-selection-author-chip="true"
          aria-expanded={authorsOpen}
          aria-haspopup="dialog"
          {...chromeTip('Who made these marks', tipSide)}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setAuthorsOpen((open) => !open)}
        >
          {chipText}
        </button>
      </span>,
    );
  }
  if (selectionCountOn && items.length > 1) {
    groups.push(
      <span key="count" className="selection-quick-bar__group">
        <span className="selection-quick-bar__count" data-selection-count={items.length} role="status" aria-label={`${items.length} marks picked`}>
          {items.length}
        </span>
      </span>,
    );
  }
  if (phone || panelHoldsStyles) {
    // Colour and line live on the phone's own strip.
  } else if (plan?.colour === 'dots' && paint) {
    groups.push(
      <span key="colour" className="selection-quick-bar__group" data-annotation-color-trigger>
        <QuickColourDots
          {...quickColoursForTool(api?.quickColourTool || api?.contextTool, isFeatureOn('tool-quick-colours'))}
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
  if (!phone && !panelHoldsStyles && (plan?.width || plan?.style || plan?.opacity)) {
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
          onClick={() => { setKindOpen(null); setLineOpen((open) => !open); }}
        >
          <Icon name={LINE_STYLE_SAMPLE_ICONS[styleMixed ? 'solid' : styleValue] || 'lineSampleSolid'} size={20} color="currentColor" />
        </button>
      </span>,
    );
  }
  // By kind (Nightly 'mark-bar-by-kind', KAL-651), as Drawboard's bar does:
  // open lines get Start and end, closed shapes and text get Fill, and marks
  // that hold words get size, bold and align. Each is the same write the
  // tool bar and the properties panel make.
  // One picked image: Drawboard's keep-proportions lock. On (the default) a
  // corner drag keeps its shape; off lets it stretch.
  if (plan?.imageLock) {
    const keep = api?.selectedImageShape?.keep !== false;
    groups.push(
      <span key="image-lock" className="selection-quick-bar__group" data-selection-quick-kind="image-lock">
        {button('Keep proportions', keep ? 'lock' : 'lockOpen', () => api?.setSelectedImageKeepShape?.(!keep), {
          'aria-pressed': keep,
          'data-selection-quick-image-lock': keep ? 'on' : 'off',
          className: `selection-quick-bar__button${keep ? ' is-open' : ''}`,
        })}
      </span>,
    );
  }
  if (!panelHoldsStyles && plan?.ends) {
    groups.push(
      <span key="ends" className="selection-quick-bar__group" data-selection-quick-kind="ends">
        <button
          type="button"
          className={`selection-quick-bar__button selection-quick-bar__button--wide${kindOpen === 'ends' ? ' is-open' : ''}`}
          aria-label="Start and end"
          aria-haspopup="dialog"
          aria-expanded={kindOpen === 'ends'}
          {...(kindOpen === 'ends' ? {} : chromeTip('Start and end', tipSide))}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => { setLineOpen(false); setKindOpen((open) => (open === 'ends' ? null : 'ends')); }}
        >
          <LineEndsSample start={lineEnds?.start} end={lineEnds?.end} width={26} height={16} w={1.4} />
        </button>
      </span>,
    );
  }
  if (!panelHoldsStyles && plan?.fill && paint?.fill) {
    groups.push(
      <span key="fill" className="selection-quick-bar__group" data-selection-quick-kind="fill">
        <button
          type="button"
          className={`selection-quick-bar__button${kindOpen === 'fill' ? ' is-open' : ''}`}
          aria-label="Fill"
          aria-haspopup="dialog"
          aria-expanded={kindOpen === 'fill'}
          {...(kindOpen === 'fill' ? {} : chromeTip('Fill', tipSide))}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => { setLineOpen(false); setKindOpen((open) => (open === 'fill' ? null : 'fill')); }}
        >
          <span
            className={`selection-quick-bar__fill${fillNone ? ' is-none' : ''}${fillMixed ? ' is-mixed' : ''}`}
            style={fillNone || fillMixed ? undefined : { background: paint.fill.color }}
            aria-hidden="true"
          />
        </button>
      </span>,
    );
  }
  if (!panelHoldsStyles && plan?.text) {
    const align = textFormat?.state?.textAlign || 'left';
    const alignLabel = { left: 'Align left', center: 'Align center', right: 'Align right' }[align] || 'Align left';
    groups.push(
      <span key="text" className="selection-quick-bar__group" data-selection-quick-kind="text">
        {canTextColour && kindButton('textColour', 'Text colour', (
          <span className="selection-quick-bar__text-colour" aria-hidden="true">
            <span className="selection-quick-bar__text-colour-letter">A</span>
            <span className="selection-quick-bar__text-colour-bar" style={{ background: textColour.hex }} />
          </span>
        ), { data: { 'data-selection-quick-text-colour': textColour.hex } })}
        {canFont && kindButton('font', `Font ${fontFamily}`, (
          <>
            <span className="selection-quick-bar__font-name" style={{ fontFamily }}>{fontFamily}</span>
            <Icon name="chevronDown" size={14} color="currentColor" />
          </>
        ), { wide: true, data: { 'data-selection-quick-font': fontFamily } })}
        {button('Smaller text', 'minus', () => textFormat.api.setFontSize(stepFontSize(textSize, -1)), { 'data-selection-quick-size-down': '' })}
        <span className="selection-quick-bar__size" data-selection-quick-size={textSize} aria-label={`Text size ${textSize} pt`}>{textSize}</span>
        {button('Larger text', 'plus', () => textFormat.api.setFontSize(stepFontSize(textSize, 1)), { 'data-selection-quick-size-up': '' })}
        {typeof textFormat.api.toggleBold === 'function' && button('Bold', 'formatBold', () => textFormat.api.toggleBold(), {
          'aria-pressed': Boolean(textFormat.state?.bold),
          'data-selection-quick-bold': '',
          className: `selection-quick-bar__button${textFormat.state?.bold ? ' is-open' : ''}`,
        })}
        {typeof textFormat.api.setTextAlign === 'function' && button(alignLabel, { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }[align] || 'alignLeft', () => textFormat.api.setTextAlign(nextTextAlign(align)), { 'data-selection-quick-align': align })}
      </span>,
    );
  }
  // Measurement (desktop and phone alike): one picked measurement's label,
  // depth, caption lines and caption size.
  if (plan?.measure) {
    groups.push(
      <span key="measure" className="selection-quick-bar__group" data-selection-quick-measure>
        <button
          type="button"
          className={`selection-quick-bar__button${measureOpen ? ' is-open' : ''}`}
          aria-label="Measurement"
          aria-haspopup="dialog"
          aria-expanded={measureOpen}
          {...(measureOpen ? {} : chromeTip('Measurement', tipSide))}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            setLineOpen(false);
            setMeasureOpen((open) => !open);
          }}
        >
          <Icon name="measureScale" size={20} color="currentColor" />
        </button>
      </span>,
    );
  }
  // Hyperlink (Nightly 'link-tool'): "Go to ..." follows the picked link
  // (a click on it only picks it, as in Drawboard); Link edits it.
  if (plan?.link && api?.selectedLink) {
    const goTo = linkGoToLabel(api.selectedLink.link);
    groups.push(
      <span key="link" className="selection-quick-bar__group" data-selection-quick-link>
        <button
          type="button"
          className="selection-quick-bar__button selection-quick-bar__button--text"
          aria-label={goTo}
          {...chromeTip(goTo, tipSide)}
          data-selection-quick-goto=""
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => api.followLink(api.selectedLink.link)}
          style={{ width: 'auto', padding: '0 8px', fontSize: 12, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {goTo}
        </button>
        {plan.linkEdit && button('Link', 'hyperlink', () => api.editSelectedLink(), { 'data-selection-quick-link-edit': '' })}
      </span>,
    );
  }
  // Audio note (Nightly 'audio-note'): Play plays the picked clip (again stops it).
  if (plan?.audio) {
    groups.push(
      <span key="audio" className="selection-quick-bar__group" data-selection-quick-audio>
        {button('Play audio note', 'play', () => api.playSelectedAudio(), { 'data-selection-quick-audio-play': '' })}
      </span>,
    );
  }
  // Equation (Nightly 'equation-tool'): Equation opens the picked one again.
  if (plan?.equation) {
    groups.push(
      <span key="equation" className="selection-quick-bar__group" data-selection-quick-equation>
        {button('Equation', 'equation', () => api.editSelectedEquation(), { 'data-selection-quick-equation-edit': '' })}
      </span>,
    );
  }
  // Sticky note (Nightly 'note-tool'): Note opens the picked note's words.
  if (plan?.note) {
    groups.push(
      <span key="note" className="selection-quick-bar__group" data-selection-quick-note>
        {button('Note', 'stickyNote', () => api.editSelectedNote(), { 'data-selection-quick-note-open': '' })}
      </span>,
    );
  }
  groups.push(
    <span key="actions" className="selection-quick-bar__group">
      {onComment && items.length === 1 && button('Comment', 'comment', () => onComment(items[0]), { 'data-selection-quick-comment': 'true' })}
      {plan?.duplicate && button('Duplicate', 'duplicate', () => runKey('duplicate'))}
      {plan?.remove && button('Delete', 'trash', () => runKey('delete'))}
    </span>,
  );
  if (panelAllowed && !propertiesPanelOpen) {
    groups.push(
      <span key="expand" className="selection-quick-bar__group">
        {button('Expand menu', 'expandMenu', () => setPropertiesPanelOpen(true), { 'data-selection-quick-expand': 'true' })}
      </span>,
    );
  }
  // The phone gets More too (Nightly, 'phone-mark-more'): the same mark menu a
  // long press opens, one tap away.
  if (plan?.more && (!phone || phoneMoreOn)) {
    groups.push(
      <span key="more" className="selection-quick-bar__group">
        {button('More', 'more', openMore, { 'aria-haspopup': 'menu' })}
      </span>,
    );
  }

  // KAL-793: each card opens away from the mark, but flips to the other side
  // of the bar (or scrolls) rather than run under the tool bars or off the
  // window, and slides sideways to stay inside the page area.
  const barSide = look.side === 'above' ? 'above' : 'below';
  const popoverBounds = useCallback(() => viewerBounds(phone), [phone]);
  const kindPopoverRef = useRef(null);
  const authorsPopoverRef = useRef(null);
  const linePlace = useHangingPopoverPlace(linePopoverRef, {
    open: Boolean(lineOpen && visible), preferred: barSide, getBounds: popoverBounds, protectedRects, deps: [plan?.width, plan?.opacity, plan?.style],
  });
  const kindPlace = useHangingPopoverPlace(kindPopoverRef, {
    open: Boolean(kindOpen && visible), preferred: barSide, getBounds: popoverBounds, protectedRects, deps: [kindOpen],
  });
  const authorsPlace = useHangingPopoverPlace(authorsPopoverRef, {
    open: Boolean(authorsOpen && visible), preferred: barSide, getBounds: popoverBounds, protectedRects, align: 'start', deps: [authors.length],
  });

  const linePopover = lineOpen && visible ? (
    <div
      ref={linePopoverRef}
      className="selection-quick-bar__popover"
      data-selection-quick-bar-popover="true"
      data-side={linePlace.side}
      style={linePlace.style}
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
      {plan?.opacity && (
        <div className="selection-quick-bar__opacities" role="group" aria-label="Opacity" data-selection-quick-opacity>
          {QUICK_BAR_OPACITIES.map((value) => {
            const current = !opacityMixed && opacityValue === value;
            return (
              <button
                key={value}
                type="button"
                className={`selection-quick-bar__opacity${current ? ' is-current' : ''}`}
                aria-label={`Opacity ${value}%`}
                aria-pressed={current}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => api?.handleStrokeOpacityChange?.(value, { phase: 'commit' })}
              >
                <span className="selection-quick-bar__opacity-sample" aria-hidden="true" style={{ opacity: value / 100 }} />
                <span className="selection-quick-bar__width-label" aria-hidden="true">{value}%</span>
              </button>
            );
          })}
        </div>
      )}
      {plan?.style && (
        <div className="selection-quick-bar__styles" role="group" aria-label="Line style">
          {lineStyleOptionsWith(isFeatureOn('line-dashes') && api?.contextTool !== 'callout')
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

  const kindPopover = kindOpen && visible ? (
    <div
      ref={kindPopoverRef}
      className="selection-quick-bar__popover"
      data-selection-quick-bar-popover="true"
      data-selection-quick-kind-popover={kindOpen}
      data-side={kindPlace.side}
      style={kindPlace.style}
      role="dialog"
      aria-label={{ fill: 'Fill', ends: 'Start and end', font: 'Font', textColour: 'Text colour' }[kindOpen]}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {kindOpen === 'fill' && paint?.fill && (
        <div className="selection-quick-bar__fill-row">
          <button
            type="button"
            className={`selection-quick-bar__fill is-none${fillNone ? ' is-current' : ''}`}
            data-selection-quick-fill-none=""
            aria-label="No fill"
            aria-pressed={fillNone}
            {...chromeTip('No fill', 'below')}
            onClick={clearFill}
          />
          <QuickColourDots
            value={fillNone || api?.selectionMixed?.fillColor ? null : paint.fill.color}
            colours={FILL_QUICK_COLOURS}
            names={FILL_QUICK_COLOUR_NAMES}
            onPick={(hex) => paint.fill.apply(hex, paint.fill.opacity > 0 ? paint.fill.opacity : 1)}
          />
        </div>
      )}
      {kindOpen === 'ends' && <LineEndingsPanel api={api} tool={api?.contextTool} tip={chromeTip} compact />}
      {kindOpen === 'textColour' && canTextColour && (
        <div className="selection-quick-bar__fill-row">
          {/* The fill's colours: white words read on a dark fill. */}
          <QuickColourDots
            value={textColour.hex}
            colours={FILL_QUICK_COLOURS}
            names={FILL_QUICK_COLOUR_NAMES}
            onPick={(hex) => textFormat.api.setFontColor(composeTextColor(hex, textColour.opacity))}
          />
        </div>
      )}
      {kindOpen === 'font' && canFont && (
        <div className="selection-quick-bar__fonts" role="menu" aria-label="Font">
          {QUICK_BAR_FONT_FAMILIES.map((family) => (
            <button
              key={family}
              type="button"
              role="menuitemradio"
              aria-checked={family === fontFamily}
              className="selection-quick-bar__font-option"
              data-selection-quick-font-option={family}
              style={{ fontFamily: family }}
              onClick={() => { textFormat.api.setFontFamily(family); setKindOpen(null); }}
            >
              {family}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  // A viewer that is not on screen draws nothing.
  if (typeof document === 'undefined' || !enabled) return null;
  return createPortal(
    <div
      ref={barRef}
      className="selection-quick-bar"
      data-selection-quick-bar="true"
      data-visible={visible ? 'true' : 'false'}
      data-side={look.side}
      data-docked={docked && !phone ? 'true' : undefined}
      data-phone={phone ? 'true' : undefined}
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
      {kindPopover}
      {authorsOpen && visible && authors.length > 0 && (
        <div
          ref={authorsPopoverRef}
          className="selection-quick-bar__popover selection-quick-bar__authors"
          data-selection-quick-bar-popover="true"
          data-selection-authors="true"
          data-side={authorsPlace.side}
          style={authorsPlace.style}
          role="dialog"
          aria-label="Who made these marks"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <table>
            <thead><tr><th scope="col">Author</th><th scope="col">Date</th><th scope="col">Layer</th></tr></thead>
            {authors.map((group) => (
              <tbody key={group.authorId || 'unknown'} data-author-group={group.label}>
                {group.marks.map((mark, index) => (
                  <tr key={index}>
                    <td>{index === 0 ? `${group.label}${group.marks.length > 1 ? ` (${group.marks.length})` : ''}` : ''}</td>
                    <td>{mark.date || '—'}</td>
                    <td>{mark.layer || '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {measureOpen && visible && plan?.measure && (
        <MeasureEditPopover
          key={api?.selectedMeasure?.id || 'measure'}
          measure={api?.selectedMeasure}
          onPatch={api?.patchSelectedMeasure}
          onClose={closeMeasure}
          side={look.side === 'above' ? 'above' : 'below'}
          tip={chromeTip}
          tipSide={look.side === 'above' ? 'above' : 'below'}
        />
      )}
    </div>,
    document.body,
  );
}
