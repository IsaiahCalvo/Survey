/**
 * resizeMinimum.js — one rule for how small a resize drag may make a mark,
 * and what happens when a grabber is dragged past the opposite side.
 *
 * Intended UX (w63, 2026-09-28): Acrobat, Figma and Drawboard all let a
 * corner or edge grabber pass through the opposite side. The mark FLIPS —
 * it mirrors and keeps growing on the other side of the fixed corner — and
 * it never collapses to a speck on the way through. Survey used to allow a
 * 1 % (or 10 %, or 0) sliver, so a drag that ended near the opposite corner
 * left a near-invisible dot you could hardly find, let alone grab.
 *
 * The floor is in PAGE units (it is part of the mark, so it scales with the
 * page like the mark does — project zoom convention). It is never larger than
 * the mark already was: a hairline pen stroke is not blown up to 4 units just
 * because a corner was touched. Shapes that cannot mirror (a text box, an
 * arrow group, a counter) stop at the floor on the fixed side instead.
 */

/** The smallest a resized mark may get along either axis, in page units. */
export const MIN_RESIZE_PAGE_UNITS = 4;

/**
 * The smallest |scale| allowed for one axis.
 *
 * @param {number} rawSize       the axis length at scale 1 (page units)
 * @param {number} [startScale]  the axis scale when the drag started
 * @param {number} [minSize]     floor in page units
 * @returns {number} a positive scale magnitude, or 0 when there is no size
 */
export function minResizeScale(rawSize, startScale = 1, minSize = MIN_RESIZE_PAGE_UNITS) {
  const size = Math.abs(Number(rawSize));
  if (!Number.isFinite(size) || size <= 0) return 0;
  const start = Math.abs(Number(startScale));
  const startSize = Number.isFinite(start) && start > 0 ? size * start : size;
  const floor = Math.max(0, Number(minSize) || 0);
  return Math.min(floor, startSize) / size;
}

/**
 * Clamp one axis of a resize.
 *
 * @param {number} scale  the signed scale the pointer asks for
 * @param {object} opts
 * @param {number} opts.rawSize      axis length at scale 1 (page units)
 * @param {number} [opts.startScale] axis scale at drag start (default 1)
 * @param {boolean} [opts.allowFlip] true: keep the sign (mirror through);
 *                                   false: never below +floor
 * @param {number} [opts.minSize]    floor in page units (default 4)
 * @returns {number} the scale to use for BOTH the preview and the save
 */
export function clampResizeScale(scale, {
  rawSize,
  startScale = 1,
  allowFlip = true,
  minSize = MIN_RESIZE_PAGE_UNITS,
} = {}) {
  const s = Number(scale);
  const floor = minResizeScale(rawSize, startScale, minSize);
  if (!Number.isFinite(s)) return floor > 0 ? floor : 1;
  if (!allowFlip) return Math.max(floor, s);
  if (floor <= 0) {
    // No measurable size on this axis: only keep the transform invertible.
    return s === 0 ? Number.MIN_VALUE : s;
  }
  // The pointer's scale is measured from the grabber, so exactly zero ("on
  // the fixed corner") counts as the unflipped side.
  const sign = s < 0 ? -1 : 1;
  return sign * Math.max(Math.abs(s), floor);
}

/**
 * Mirror a polygon / polyline's local points across its own bounding-box
 * centre, one axis at a time. The bounding box (and so pathOffset and the
 * visible-bbox formulas the resize uses) is unchanged; only the drawing is
 * mirrored. This is how a points shape shows and saves a flip without ever
 * carrying a negative scale.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {{ x: boolean, y: boolean }} flip
 * @returns {Array<{x:number,y:number}>} new points (input untouched)
 */
export function mirrorPointsInBox(points, flip) {
  if (!Array.isArray(points) || points.length === 0) return points;
  if (!flip?.x && !flip?.y) return points;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of points) {
    const x = Number(p?.x) || 0;
    const y = Number(p?.y) || 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sumX = minX + maxX;
  const sumY = minY + maxY;
  return points.map((p) => ({
    ...p,
    x: flip.x ? sumX - (Number(p?.x) || 0) : p.x,
    y: flip.y ? sumY - (Number(p?.y) || 0) : p.y,
  }));
}

/**
 * The points shape a resize shows and saves: |scale|, visible-bbox top-left
 * converted to object space, and the points mirrored on any flipped axis.
 * Used by the live preview AND the pointer-up commit so the two can never
 * disagree (w59 rule: preview == saved).
 *
 * @param {object} obj           the polygon / polyline at drag start
 * @param {object} resize        { scaleX, scaleY, left, top } — signed scale,
 *                               visible-bbox left/top
 * @param {object} props         drag-start originalProps (pointsLocalMinX…)
 * @returns {object} a new object
 */
export function buildPointsShapeResize(obj, resize, props) {
  const sx = Math.abs(Number(resize.scaleX) || 0);
  const sy = Math.abs(Number(resize.scaleY) || 0);
  const flipX = Number(resize.scaleX) < 0;
  const flipY = Number(resize.scaleY) < 0;
  const next = {
    ...obj,
    scaleX: sx,
    scaleY: sy,
    left: resize.left - sx * (props.pointsLocalMinX - props.pointsPathOffsetX),
    top: resize.top - sy * (props.pointsLocalMinY - props.pointsPathOffsetY),
  };
  if (flipX || flipY) {
    next.points = mirrorPointsInBox(obj.points, { x: flipX, y: flipY });
    // An OPEN revision cloud draws its crowns on the left of its direction of
    // travel. A mirror on ONE axis swaps left and right, so the order is
    // reversed too and the crowns land where a mirror puts them. (Both axes
    // = a half turn, which keeps the side. A closed cloud orients itself.)
    const isOpenCloud = String(obj.type || '').toLowerCase() === 'polyline'
      && obj.data && obj.data.pdfCloudIntensity != null;
    if (isOpenCloud && flipX !== flipY) next.points = next.points.slice().reverse();
    // A revision cloud's remembered per-vertex fit belongs to the unmirrored
    // outline; after a flip the cloud re-fits fresh, as after any resize.
    if (next.data && next.data.pdfCloudVertexState) {
      const { pdfCloudVertexState: _dropped, ...rest } = next.data;
      next.data = rest;
    }
  }
  return next;
}
