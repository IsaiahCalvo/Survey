/**
 * Spaces area drawing and point editing, matched to the Polygon markup tool
 * (owner 2026-10-28): check marks on the first and latest corner while a
 * polygon area is drawn, Shift locks each new side to the snap angle, a "+" on
 * each side of a picked free-form area adds a point there, and a plain
 * rectangle keeps side grabbers until it stops being one.
 *
 * Pure page-unit math (screen distances come in through `toScreen`), so the
 * Node test runner imports it directly.
 */
import { snapAngle } from './drawSnap.js';
import { polyDraftHitRadii } from './polyDraft.js';
import { SNAP_ANGLE_DEFAULT, readSnapAngle } from './annotationPreferences.js';

/** Default Shift step for a polygon area's new side; Settings can pick 45° or 90°. */
export const REGION_POLYGON_SNAP_DEG = SNAP_ANGLE_DEFAULT;
/** Fewest corners that make an area; the check marks show from here. */
export const REGION_POLYGON_MIN_CORNERS = 3;
/** A second press this close (screen px) to the latest corner adds nothing. */
export const REGION_POLYGON_SAME_POINT_PX = 3;

/** Screen-px radii for the check marks and the first-corner pull. */
export const regionPolygonHitRadii = ({ coarse = false } = {}) => {
  const { finishHitRadius, firstPointSnapRadius } = polyDraftHitRadii({ coarsePointer: coarse });
  return { checkHitPx: finishHitRadius, closePullPx: firstPointSnapRadius };
};

const gap = (a, b, toScreen) => {
  const sa = toScreen(a);
  const sb = toScreen(b);
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
};

/**
 * Where the next corner (or the rubber band's end) lands: on the first
 * corner when the pointer is within the pull and the area can close, else
 * locked to the snap angle (readSnapAngle) from the latest corner with
 * Shift, else where it is.
 * Returns { point, closing }.
 */
export function resolveRegionPolygonPoint(corners, point, { shiftKey = false, toScreen, closePullPx = 0 } = {}) {
  const list = Array.isArray(corners) ? corners : [];
  if (!point || list.length === 0) return { point, closing: false };
  if (list.length >= REGION_POLYGON_MIN_CORNERS && typeof toScreen === 'function' && closePullPx > 0
    && gap(list[0], point, toScreen) <= closePullPx) {
    return { point: { x: list[0].x, y: list[0].y }, closing: true };
  }
  if (shiftKey) return { point: snapAngle(list[list.length - 1], point, readSnapAngle()), closing: false };
  return { point: { x: point.x, y: point.y }, closing: false };
}

/**
 * What a press does while a polygon area is being drawn:
 * 'close' (on the first corner's check mark), 'finish' (on the latest
 * corner's check mark), 'ignore' (the second press of a double-click) or
 * 'add' (place a corner). The check marks exist from three corners.
 */
export function regionPolygonPressAction(corners, point, { toScreen, checkHitPx = 0 } = {}) {
  const list = Array.isArray(corners) ? corners : [];
  if (list.length === 0 || !point || typeof toScreen !== 'function') return 'add';
  const toLast = gap(list[list.length - 1], point, toScreen);
  if (list.length >= REGION_POLYGON_MIN_CORNERS) {
    const toFirst = gap(list[0], point, toScreen);
    if (toFirst <= checkHitPx || toLast <= checkHitPx) return toFirst <= toLast ? 'close' : 'finish';
  }
  if (toLast <= REGION_POLYGON_SAME_POINT_PX) return 'ignore';
  return 'add';
}

/**
 * True for four corners making a level rectangle (each side straight across
 * or straight down). `tolerance` is in page units.
 */
export function isLevelRectangle(coords, tolerance = 0.5) {
  if (!Array.isArray(coords) || coords.length !== 8) return false;
  const pts = [0, 1, 2, 3].map((i) => ({ x: Number(coords[i * 2]), y: Number(coords[i * 2 + 1]) }));
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  let across = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const flatX = Math.abs(a.y - b.y) <= tolerance && Math.abs(a.x - b.x) > tolerance;
    const flatY = Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) > tolerance;
    if (!flatX && !flatY) return false;
    if (flatX) across += 1;
  }
  return across === 2;
}

/**
 * True when side `sideIndex` draws as a straight line: neither end is a
 * smooth (curve) point. Flags that do not match the vertex count are stale
 * and draw straight (regionOutline.getRegionSmoothFlags).
 */
export function isRegionSideStraight(region, sideIndex) {
  const coords = region?.coordinates;
  const flags = region?.smoothVertices;
  if (!Array.isArray(coords) || !Array.isArray(flags) || flags.length * 2 !== coords.length) return true;
  const count = flags.length;
  return !flags[sideIndex] && !flags[(sideIndex + 1) % count];
}

/**
 * Copy of `region` with a point added halfway along straight side
 * `sideIndex` (from corner sideIndex to the next); the new point is a corner
 * (flag 0) when the area has curve flags. A curved side gets no point, since
 * its chord midpoint is off the drawn outline. Returns { region, vertexIndex }
 * or null.
 */
export function insertRegionSidePoint(region, sideIndex) {
  const coords = Array.isArray(region?.coordinates) ? region.coordinates : null;
  if (!coords || coords.length < 6) return null;
  const count = coords.length / 2;
  if (!Number.isInteger(sideIndex) || sideIndex < 0 || sideIndex >= count) return null;
  if (!isRegionSideStraight(region, sideIndex)) return null;
  const next = (sideIndex + 1) % count;
  const mx = (coords[sideIndex * 2] + coords[next * 2]) / 2;
  const my = (coords[sideIndex * 2 + 1] + coords[next * 2 + 1]) / 2;
  const at = sideIndex + 1;
  const coordinates = [...coords.slice(0, at * 2), mx, my, ...coords.slice(at * 2)];
  const out = { ...region, shapeType: 'polygon', coordinates };
  if (Array.isArray(region.smoothVertices) && region.smoothVertices.length === count) {
    out.smoothVertices = [...region.smoothVertices.slice(0, at), 0, ...region.smoothVertices.slice(at)];
  }
  return { region: out, vertexIndex: at };
}
