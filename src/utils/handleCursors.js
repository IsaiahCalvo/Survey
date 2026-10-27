/**
 * handleCursors.js — the mouse / pen cursor every selection grabber shows.
 *
 * Owner 2026-10-26: "copy how Drawboard shows an accurate cursor for whatever
 * they're doing". Read off Drawboard PDF's web app (Grippers.jsx in its bundle,
 * confirmed live on 2026-10-26 by hovering each grabber):
 *
 *   - The eight RESIZE grabbers (corners and edge midpoints of any frame) show
 *     a black double-headed arrow with a white edge, turned to the EXACT angle
 *     the grabber pulls in: the grabber's own direction plus the mark's
 *     rotation. A box turned 30 degrees gets arrows turned 30 degrees, not the
 *     nearest of the browser's four fixed resize cursors. The browser keyword
 *     stays behind it as the fallback.
 *   - POINT grabbers (a line's ends and bend, a callout's arrow tip, knee and
 *     leader, a polygon's corners) and the TURN grabber show the pointing hand.
 *   - The body of a selected mark shows the four-way move cursor (set where
 *     the body is drawn).
 *
 * Pan keeps its open / closed hand and Text Select its I-beam; drawing tools
 * keep their plain crosshair. Pure data in, CSS cursor strings out — no DOM.
 */
import { getCursorForHandle } from './svgTransformMath.js';

/** Point grabbers (ends, corners, bends, the callout's leader points). */
export const GRAB_HANDLE_CURSOR = 'pointer';
/** The turn grabber. Drawboard shows the pointing hand here too. */
export const ROTATE_HANDLE_CURSOR = 'pointer';

// The direction each resize grabber pulls, in screen degrees (y points down,
// so 90 is straight down): right edge 0, bottom-right corner 45, and so on.
const RESIZE_HANDLE_ANGLE = {
  mr: 0,
  br: 45,
  mb: 90,
  bl: 135,
  ml: 180,
  tl: 225,
  mt: 270,
  tr: 315,
};

// Region-tool grabbers use compass names; they pull the same ways.
const COMPASS_TO_HANDLE = {
  e: 'mr', se: 'br', s: 'mb', sw: 'bl', w: 'ml', nw: 'tl', n: 'mt', ne: 'tr',
};

const CURSOR_SIZE = 18;
const cursorCache = new Map();

// A double arrow along +x, centred in a 30 x 30 box: a white stroke under a
// black one so it reads on a white sheet and on dark drawings alike.
const ARROW_PATH = 'M3 15H27M3 15L8.5 10M3 15L8.5 20M27 15L21.5 10M27 15L21.5 20';

function arrowSvg(angle) {
  const stroke = (color, width) => (
    `<path d='${ARROW_PATH}' stroke='${color}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round' fill='none' transform='rotate(${angle} 15 15)'/>`
  );
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${CURSOR_SIZE}' height='${CURSOR_SIZE}' viewBox='0 0 30 30'>${stroke('white', 6)}${stroke('black', 2.5)}</svg>`;
}

/**
 * The turned double-arrow cursor for a pull direction, as a CSS cursor value.
 * A double arrow looks the same turned half a circle, so the angle is folded
 * into [0, 180) and rounded to a whole degree (one cached string per degree).
 *
 * @param {number} angleDeg - screen direction of the pull, degrees
 * @param {string} [fallback] - browser keyword if the image cannot be used
 * @returns {string}
 */
export function resizeArrowCursor(angleDeg, fallback = 'ew-resize') {
  const raw = Number(angleDeg);
  const folded = Number.isFinite(raw) ? ((Math.round(raw) % 180) + 180) % 180 : 0;
  const key = `${folded}|${fallback}`;
  let cursor = cursorCache.get(key);
  if (!cursor) {
    const half = CURSOR_SIZE / 2;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(arrowSvg(folded))}") ${half} ${half}, ${fallback}`;
    cursorCache.set(key, cursor);
  }
  return cursor;
}

/**
 * The cursor for one of the eight resize grabbers on a frame turned by
 * `rotationDeg` (clockwise on screen, the SVG rotate() sense). Unknown ids get
 * the plain arrow; the turn grabber ('mtr') gets the pointing hand.
 *
 * @param {string} handleId - tl, mt, tr, mr, br, mb, bl, ml (or n/ne/e/... compass names)
 * @param {number} [rotationDeg=0]
 * @returns {string}
 */
export function resizeHandleCursor(handleId, rotationDeg = 0) {
  if (handleId === 'mtr') return ROTATE_HANDLE_CURSOR;
  const id = COMPASS_TO_HANDLE[handleId] || handleId;
  const base = RESIZE_HANDLE_ANGLE[id];
  if (base === undefined) return 'default';
  const rotation = Number(rotationDeg) || 0;
  return resizeArrowCursor(base + rotation, getCursorForHandle(id, rotation));
}
