// Drawboard canvas audit, chunk 4 — the small floating bar over a selection
// (components/SelectionQuickBar.jsx). Everything here is pure so the rules can
// be tested without a browser.
//
// Intended UX (owner brief + Drawboard PDF 5.9.3, scratchpad drawboardDeep/
// CANVAS.md section 6):
//   - A calm bar sits just ABOVE the selection, centred on it, and drops BELOW
//     only when there is no room above inside the viewer. It never leaves the
//     viewer (10px margin) and hides when the selection is scrolled away.
//   - It holds the few things people change most: colour, line (width and
//     style), Duplicate, Delete and More (the right-click menu).
//   - Several marks picked together: only what applies to EVERY one of them.
//   - Survey Markers have no paint; their "colour" is their entity, so a pick
//     of markers only shows the template's entity swatches.
//   - A locked mark cannot be restyled or deleted: Duplicate and More only
//     (More holds Unlock).
import { computeTextSelectionQuickMenuPosition, unionClientRects } from './textSelectionQuickMenu.js';
import { showsPaintSwatch, showsQuickColourDots } from './toolbarColourGroup.js';

// Space kept between the bar and the edges of the viewer (Drawboard: 10px).
export const QUICK_BAR_MARGIN = 10;

// Marks that carry no paint the bar could change.
const NO_PAINT_KINDS = new Set(['surveyMarker', 'image', 'mark']);
// Marks with a line width the bar can set.
const WIDTH_KINDS = new Set(['rect', 'ellipse', 'line', 'arrow', 'polyline', 'polygon', 'cloud', 'pen', 'highlighter', 'text', 'callout']);
// Marks with a line style (solid / dashed / dotted / cloud).
const STYLE_KINDS = new Set(['rect', 'ellipse', 'line', 'arrow', 'polyline', 'polygon', 'cloud', 'text', 'callout']);

/**
 * Where the bar goes. The same placement rule as the floating menu next to a
 * PDF text selection (one rule for both floating menus): above, else below,
 * else pinned to whichever edge covers least of the selection.
 *
 * @param {{left,top,right,bottom}} selectionRect  the selection frame, handles
 *   included, in client pixels
 * @param {{left,top,right,bottom}} bounds          the visible viewer area
 * @returns {{left:number, top:number, side:'above'|'below'|'pinned'} | null}
 *   null when the selection is wholly out of view (the bar hides).
 */
export function computeSelectionQuickBarPosition({ selectionRect, bounds, barWidth, barHeight } = {}) {
  const placed = computeTextSelectionQuickMenuPosition({
    selectionRect,
    bounds,
    menuWidth: barWidth,
    menuHeight: barHeight,
    pointer: 'fine',
    margin: QUICK_BAR_MARGIN,
  });
  if (!placed) return null;
  return { left: placed.left, top: placed.top, side: placed.placement };
}

/** The selection frame: the union of the page layers' selection overlays. */
export function selectionFrameRect(rects) {
  return unionClientRects(rects);
}

/**
 * What the bar shows for the current pick.
 *
 * @param {object} args
 * @param {Array<{id: string, typeKey: string}>} args.items  the pick (every page)
 * @param {object|null} args.api       the published tool-bar state (PDFViewer)
 * @param {number} [args.entityCount]  the template's entities (Survey Markers)
 * @param {boolean} [args.locked]      a picked mark is user-locked
 * @param {boolean} [args.readOnly]    the document is read-only
 * @returns {null | { colour: 'dots'|'swatch'|'entity'|null, width: boolean,
 *   style: boolean, duplicate: boolean, remove: boolean, more: boolean }}
 */
export function planSelectionQuickBar({ items, api, entityCount = 0, locked = false, readOnly = false } = {}) {
  const list = Array.isArray(items) ? items.filter((item) => item && item.typeKey) : [];
  if (readOnly || list.length === 0) return null;
  const kinds = list.map((item) => item.typeKey);
  const every = (set) => kinds.every((kind) => set.has(kind));
  const markersOnly = kinds.every((kind) => kind === 'surveyMarker');
  const anyNoPaint = kinds.some((kind) => NO_PAINT_KINDS.has(kind));

  let colour = null;
  if (!locked) {
    if (markersOnly) colour = entityCount > 0 ? 'entity' : null;
    else if (!anyNoPaint && api) {
      if (showsQuickColourDots(api)) colour = 'dots';
      else if (showsPaintSwatch(api)) colour = 'swatch';
    }
  }
  const caps = api?.selectionCapabilities || null;
  const width = !locked && !anyNoPaint && every(WIDTH_KINDS)
    && typeof api?.handleStrokeWidthInputChange === 'function'
    && caps?.width !== false;
  const style = !locked && !anyNoPaint && every(STYLE_KINDS)
    && typeof api?.setLineBorderStyle === 'function'
    && caps?.lineStyle !== false;
  return {
    colour,
    width: Boolean(width),
    style: Boolean(style),
    duplicate: true,
    remove: !locked,
    more: true,
  };
}

const cssString = (value) => String(value).replace(/["\\]/g, '\\$&');

/**
 * The element a right-click on this picked item lands on — More opens the
 * right-click menu by sending it a contextmenu event there, so it is the very
 * menu (and the very group-promotion rule) a right-click gives.
 */
export function selectionItemSelector(item) {
  if (!item || item.id == null) return null;
  const id = cssString(item.id);
  if (item.typeKey === 'surveyMarker') return `[data-survey-marker-id="${id}"]`;
  if (item.typeKey === 'callout') return `[data-callout-id="${id}"]`;
  return `[data-annotation-id="${id}"]`;
}

/**
 * The key press each bar action stands for. Delete and Duplicate run through
 * the page layer's own keyboard handlers (SVGAnnotationLayer: Delete /
 * Backspace, Cmd/Ctrl+D), so a press on the bar is the same save, sync and
 * Undo step as the key — marks, callouts and Survey Markers alike.
 */
export function selectionCommandKey(command, { mac = false } = {}) {
  if (command === 'delete') {
    return { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true };
  }
  if (command === 'duplicate') {
    return { key: 'd', code: 'KeyD', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true };
  }
  return null;
}

/** The line widths offered in the bar's Line popover (pt). */
export const QUICK_BAR_WIDTHS = Object.freeze([1, 2, 3, 4, 6, 8]);

/** Is `value` (a width the bar shows) this preset? Tolerates "2" vs 2.0. */
export function isQuickBarWidth(value, width) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - width) < 0.05;
}
