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
// Nightly 'mark-bar-by-kind' (KAL-651, Drawboard's bar, recorded 2026-11-16):
// the bar's front part goes by the kind of mark picked.
// Closed shapes and text carry a fill.
const FILL_KINDS = new Set(['rect', 'ellipse', 'polygon', 'cloud', 'text', 'callout']);
// Open lines carry a start and an end style.
const ENDS_KINDS = new Set(['line', 'arrow', 'polyline']);
// Marks that hold words: size, bold and align.
const TEXT_KINDS = new Set(['text', 'callout']);

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

/** Keep the whole bar inside the viewer and clear of the selection and its handles. */
export function computeSelectionQuickBarPosition({
  selectionRect,
  keepOut = [],
  dock = null,
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
  const width = Math.max(1, Number(barWidth) || 1);
  const height = Math.max(1, Number(barHeight) || 1);
  const minLeft = box.left + margin;
  const maxLeft = box.right - margin - width;
  const minTop = box.top + margin;
  const maxTop = box.bottom - margin - height;

  if (maxLeft < minLeft || maxTop < minTop) return null;

  // Centred on the part of the selection that is on screen.
  const centre = (Math.max(sel.left, box.left) + Math.min(sel.right, box.right)) / 2;
  const left = Math.round(Math.max(minLeft, Math.min(maxLeft, centre - width / 2)));

  const guards = unionClientRects([sel, ...(keepOut || [])].map((r) => r && {
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
  })) || sel;
  const clear = (x, y) => x + width <= guards.left - QUICK_MENU_GAP
    || x >= guards.right + QUICK_MENU_GAP || y + height <= guards.top - QUICK_MENU_GAP
    || y >= guards.bottom + QUICK_MENU_GAP;
  const fits = (x, y) => x >= minLeft && x <= maxLeft && y >= minTop && y <= maxTop;
  // The docked spot keeps its own gap to the viewer's bottom (DOCKED_BAR_GAP,
  // 8 px), closer than the floating margin, so only ask that it stays clear of
  // the selection; asking it to fit the floating margin sent every docked bar
  // back beside its mark.
  if (dock && clear(dock.left, dock.top)) return dock;
  const above = { left, top: Math.floor(guards.top - QUICK_MENU_GAP - height), side: 'above' };
  const below = { left, top: Math.ceil(guards.bottom + QUICK_MENU_GAP), side: 'below' };
  const middle = (Math.max(sel.top, box.top) + Math.min(sel.bottom, box.bottom) - height) / 2;
  const top = Math.round(Math.min(maxTop, Math.max(minTop, middle)));
  const candidates = [
    ...(preferBelow ? [below, above] : [above, below]),
    { left: Math.ceil(guards.right + QUICK_MENU_GAP), top, side: 'right' },
    { left: Math.floor(guards.left - QUICK_MENU_GAP - width), top, side: 'left' },
  ];
  return candidates.find((spot) => fits(spot.left, spot.top) && clear(spot.left, spot.top)) || null;
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
 * @param {boolean} [args.byKind]      Nightly 'mark-bar-by-kind' is on
 * @param {object|null} [args.textFormat]  the text settings of the pick (AppShell resolveTextFormatting)
 * @returns {null | { colour: 'dots'|'swatch'|'entity'|null, width: boolean,
 *   style: boolean, duplicate: boolean, remove: boolean, more: boolean }}
 */
export function planSelectionQuickBar({ items, api, entityCount = 0, locked = false, readOnly = false, byKind = false, textFormat = null } = {}) {
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
  // One link mark (Nightly 'link-tool'): "Go to ..." follows it; Link edits
  // its target, style and colour (its own style tiles stand in for Line).
  const link = list.length === 1
    && typeof api?.followLink === 'function'
    && api?.selectedLink?.link != null
    && String(api.selectedLink.id) === String(list[0].id);
  // One sticky note (Nightly 'note-tool'): Note opens its words.
  const note = list.length === 1
    && typeof api?.editSelectedNote === 'function'
    && api?.selectedNote != null
    && String(api.selectedNote.id) === String(list[0].id);
  // One equation (Nightly 'equation-tool'): Equation opens it again.
  const equation = !locked && list.length === 1
    && typeof api?.editSelectedEquation === 'function'
    && api?.selectedEquation != null
    && String(api.selectedEquation.id) === String(list[0].id);
  // One audio note (Nightly 'audio-note'): Play plays it (also when locked).
  const audio = list.length === 1
    && typeof api?.playSelectedAudio === 'function'
    && api?.selectedAudio != null
    && String(api.selectedAudio.id) === String(list[0].id);
  const style = !link && !locked && !anyNoPaint && every(STYLE_KINDS)
    && typeof api?.setLineBorderStyle === 'function'
    && caps?.lineStyle !== false;
  // Measurement (Nightly 'measure-edit'): the published pick
  // (api.selectedMeasure) is this very mark, or (tester report #1629) every
  // picked mark is one of the measurements it publishes for a group.
  const measureIds = Array.isArray(api?.selectedMeasure?.ids) ? api.selectedMeasure.ids.map(String) : null;
  const measure = !locked
    && typeof api?.patchSelectedMeasure === 'function'
    && api?.selectedMeasure?.mark != null
    && (list.length === 1
      ? String(api.selectedMeasure.id) === String(list[0].id)
      : Boolean(measureIds) && list.every((item) => measureIds.includes(String(item.id))));
  // By kind (Nightly 'mark-bar-by-kind'): fill for closed shapes and text,
  // start / end for open lines, size / bold / align for words. A mixed pick
  // shows a part only when every mark picked can take it.
  const kindParts = {};
  if (byKind && !locked && !anyNoPaint) {
    if (every(FILL_KINDS) && typeof api?.handleFillOpacityChange === 'function' && caps?.fill !== false) kindParts.fill = true;
    if (every(ENDS_KINDS) && api?.selectedLineEnds && caps?.arrowheads !== false) kindParts.ends = true;
    if (every(TEXT_KINDS) && typeof textFormat?.api?.setFontSize === 'function') kindParts.text = true;
    // Opacity sits in the Line pop-up beside width (Drawboard keeps width,
    // colour and opacity in one pop-up): the panel's Opacity slider write.
    if (every(WIDTH_KINDS) && typeof api?.handleStrokeOpacityChange === 'function' && caps?.stroke !== false) kindParts.opacity = true;
  }
  // One picked image (Nightly 'mark-bar-by-kind'): the keep-proportions lock,
  // when the published pick is that very image.
  const imageLock = byKind && !locked && list.length === 1 && kinds[0] === 'image'
    && typeof api?.setSelectedImageKeepShape === 'function'
    && api?.selectedImageShape != null
    && String(api.selectedImageShape.id) === String(list[0].id);
  return {
    colour,
    width: Boolean(width),
    ...(imageLock ? { imageLock: true } : {}),
    style: Boolean(style),
    ...kindParts,
    // Only present when shown, so every other pick plans exactly as before.
    ...(measure ? { measure: true } : {}),
    ...(link ? { link: true, linkEdit: !locked && typeof api?.editSelectedLink === 'function' } : {}),
    ...(note ? { note: true } : {}),
    ...(equation ? { equation: true } : {}),
    ...(audio ? { audio: true } : {}),
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

/**
 * The fonts the text bar offers (Drawboard's text bar shows the font name).
 * The same list as the text row while editing (AppShell). Single names only:
 * a fallback stack makes Fabric's text cursor drift (CLAUDE.md, 2026-04-08).
 */
export const QUICK_BAR_FONT_FAMILIES = Object.freeze(['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana']);

/** Opacity presets in the Line pop-up, in percent (the panel slider's ticks). */
export const QUICK_BAR_OPACITIES = Object.freeze([25, 50, 75, 100]);

/** The font sizes the bar's size stepper walks through (pt). */
export const QUICK_BAR_FONT_SIZES = Object.freeze([6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 64, 72]);

/** The next size up (`dir` 1) or down (-1) from `size`; stays at the ends. */
export function stepFontSize(size, dir) {
  const n = Number(size);
  const list = QUICK_BAR_FONT_SIZES;
  if (!Number.isFinite(n)) return 12;
  if (dir > 0) return list.find((v) => v > n + 0.01) ?? list[list.length - 1];
  return [...list].reverse().find((v) => v < n - 0.01) ?? list[0];
}

/** Align goes left, centre, right, then left again. */
export function nextTextAlign(value) {
  if (value === 'center') return 'right';
  if (value === 'right') return 'left';
  return 'center';
}
