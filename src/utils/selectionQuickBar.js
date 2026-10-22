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
import { QUICK_MENU_GAP, unionClientRects } from './textSelectionQuickMenu.js';
import { ROTATION_PILL } from './rotationInputHelpers.js';
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
 * Where the degree box (RotationInputField) shows for a rotate grabber: out
 * past the grabber, on the line from the shape's centre through it — the
 * same rule as computeInputPosition, before it is held inside the page.
 *
 * @param {{left,top,right,bottom}} handleRect  the grabber, client pixels
 * @param {{x:number,y:number}} centre          the shape's turning point
 * @returns {{left,top,right,bottom} | null}
 */
export function rotationPillRect(handleRect, centre, pill = ROTATION_PILL) {
  if (!handleRect || !centre) return null;
  const width = Number(handleRect.right) - Number(handleRect.left);
  const height = Number(handleRect.bottom) - Number(handleRect.top);
  const hx = Number(handleRect.left) + width / 2;
  const hy = Number(handleRect.top) + height / 2;
  if (![hx, hy, centre.x, centre.y].every(Number.isFinite)) return null;
  const vx = hx - centre.x;
  const vy = hy - centre.y;
  const len = Math.hypot(vx, vy);
  const [ux, uy] = len > 0.0001 ? [vx / len, vy / len] : [0, -1];
  const reach = Math.max(width, height) / 2 + pill.gap + Math.max(pill.width, pill.height) / 2;
  const x = hx + ux * reach;
  const y = hy + uy * reach;
  return { left: x - pill.width / 2, top: y - pill.height / 2, right: x + pill.width / 2, bottom: y + pill.height / 2 };
}

/**
 * What the bar must keep clear of besides the selection frame, and which
 * side it takes. Owner 2026-10-22: the counter pin's turn grabber (out past
 * its tail) and the degree box next to a rotate grabber both ended up under
 * the bar. The rule: the bar never covers a grabber or the spot its degree
 * box opens in, and it takes the side AWAY from the rotate grabber — below
 * when the grabber points up (an upright shape), above when it points down
 * or sideways — so it still sits right next to the shape.
 *
 * @param {Array<{rect, centre, pill?:boolean}>} handles  rotate grabbers:
 *   their client box, the shape's turning point, and whether a degree box
 *   opens beside it
 * @param {Array<{left,top,right,bottom}>} [extra]  other boxes to keep clear
 *   (a degree box already open)
 * @returns {{ keepOut: Array<{left,top,right,bottom}>, preferBelow: boolean }}
 */
export function selectionKeepOut({ handles = [], extra = [] } = {}) {
  const keepOut = [];
  let rise = 0;
  for (const handle of handles || []) {
    const rect = handle?.rect;
    if (!rect) continue;
    keepOut.push(rect);
    if (handle.pill) {
      const pill = rotationPillRect(rect, handle.centre);
      if (pill) keepOut.push(pill);
    }
    if (handle.centre && Number.isFinite(handle.centre.y)) {
      rise += handle.centre.y - (Number(rect.top) + Number(rect.bottom)) / 2;
    }
  }
  for (const rect of extra || []) if (rect) keepOut.push(rect);
  return { keepOut, preferBelow: rise > 0.5 };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Where the bar goes: centred on the selection, just above or below
 * everything it must keep clear of (the frame, the rotate grabbers, the
 * degree box's spot). Above first, or below first when `preferBelow` (the
 * rotate grabber is on top). When neither fits, it pins to whichever edge of
 * the viewer covers least — a grabber or degree box first, then the
 * selection. Mouse menus share these numbers with the floating menu next to
 * a PDF text selection (textSelectionQuickMenu.js).
 *
 * @param {{left,top,right,bottom}} selectionRect  the selection frame, handles
 *   included, in client pixels
 * @param {Array<{left,top,right,bottom}>} [keepOut]  more boxes to keep clear
 * @param {boolean} [preferBelow]
 * @param {{left,top,right,bottom}} bounds          the visible viewer area
 * @returns {{left:number, top:number, side:'above'|'below'|'pinned'} | null}
 *   null when the selection is wholly out of view (the bar hides).
 */
export function computeSelectionQuickBarPosition({
  selectionRect,
  keepOut = [],
  preferBelow = false,
  bounds,
  barWidth,
  barHeight,
} = {}) {
  if (!selectionRect || !bounds) return null;
  const sel = unionClientRects([selectionRect]);
  const box = {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom),
  };
  if (!sel || !Object.values(box).every(Number.isFinite)) return null;
  if (sel.bottom <= box.top || sel.top >= box.bottom || sel.right <= box.left || sel.left >= box.right) return null;
  const margin = QUICK_BAR_MARGIN;
  const width = Math.max(1, Math.min(Number(barWidth) || 1, box.right - box.left - margin * 2));
  const height = Math.max(1, Number(barHeight) || 1);
  const minLeft = box.left + margin;
  const maxLeft = box.right - margin - width;
  const minTop = box.top + margin;
  const maxTop = box.bottom - margin - height;

  // Centred on the part of the selection that is on screen.
  const centre = (Math.max(sel.left, box.left) + Math.min(sel.right, box.right)) / 2;
  const left = Math.round(Math.max(minLeft, Math.min(maxLeft, centre - width / 2)));

  const guards = unionClientRects([sel, ...(keepOut || [])].map((r) => r && {
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
  })) || sel;
  const aboveTop = guards.top - QUICK_MENU_GAP - height;
  const belowTop = guards.bottom + QUICK_MENU_GAP;
  const order = preferBelow ? ['below', 'above'] : ['above', 'below'];
  for (const side of order) {
    if (side === 'above' && aboveTop >= minTop) return { left, top: Math.round(aboveTop), side };
    if (side === 'below' && belowTop <= maxTop) return { left, top: Math.round(belowTop), side };
  }

  // No room either side: pin to the edge that covers least — a grabber or
  // degree box costs far more than the selection (the bottom on a tie).
  const cost = (top) => {
    const bar = { left, top, right: left + width, bottom: top + height };
    const grabbers = (keepOut || []).reduce((sum, r) => sum + (r ? overlapArea(bar, r) : 0), 0);
    return grabbers * 1000 + overlapArea(bar, sel);
  };
  const low = Math.round(Math.max(minTop, maxTop));
  const high = Math.round(minTop);
  return { left, top: cost(high) < cost(low) ? high : low, side: 'pinned' };
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
