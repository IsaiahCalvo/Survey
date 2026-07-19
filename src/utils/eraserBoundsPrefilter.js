/**
 * eraserBoundsPrefilter.js — pure AABB fast-reject geometry for the eraser.
 *
 * The eraser hot path snapshots every annotation's page-unit bounds once at
 * pointer-down, then gates the expensive per-object hit test behind a cheap
 * axis-aligned overlap test against the current pointer segment. For that gate
 * to be safe it must NEVER reject an object the real hit test would accept, i.e.
 * the cached bounds must be a SUPERSET of the object's true hit region minus the
 * eraser radius (the radius is added on the query side).
 *
 * The real hit test (geometryHitTest.isPointOnObject) treats a point as ON an
 * object when its distance to the geometry centerline is within
 * `strokeWidth / 2 + eraserRadius`. But the cached bounds are captured with
 * SVG getBBox(), which returns the GEOMETRY (centerline) box and EXCLUDES the
 * stroke. So the cached box under-reaches by `strokeWidth / 2`. On wide imported
 * ink (highlighter/pen strokeWidth well past 8 page units) that made the
 * fast-reject drop legitimate near-edge hits — the intermittent "a swipe over
 * ink sometimes doesn't carve" regression the 2026-07-19 speedup introduced.
 * Inflating each cached box by its own stroke half-width restores the superset
 * invariant while keeping the per-move O(near-objects) win.
 */

// px slop for stroke antialias / round caps, on top of the exact stroke term.
export const BOUNDS_PAD = 4;

// Extra page-unit slack for callout bounds: the callout hit test adds an 8px
// line tolerance beyond the geometry (getCalloutHitIds `lineTolerance`), so the
// cached callout box must be inflated to match or a graze near a callout line
// could be fast-rejected before the real test runs.
export const CALLOUT_BOUNDS_PAD = 8;

// Half the widest stroke that can make a point count as ON this object. Paths /
// shapes carry a single strokeWidth; groups may nest children with their own,
// so union over any children too (whole-delete stamps/text have small or zero
// stroke, so this is a no-op for them). Matches geometryHitTest's strokeWidth/2
// reach exactly, so the inflated box can never under-reach a real hit.
export const objectStrokeInflation = (object) => {
  if (!object || typeof object !== 'object') return 0;
  let widest = Number(object.strokeWidth) || 0;
  const children = Array.isArray(object.objects) ? object.objects : null;
  if (children) {
    for (const child of children) {
      const childStroke = Number(child?.strokeWidth) || 0;
      if (childStroke > widest) widest = childStroke;
    }
  }
  return widest / 2;
};

// Grow an {minX,minY,maxX,maxY} box outward by `amount` on every side.
export const inflateBounds = (box, amount) => {
  if (!box || !(Number(amount) > 0)) return box;
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
  };
};

// Tight AABB of the current pointer segment, padded by the eraser radius (the
// hit test's own reach) plus BOUNDS_PAD. Returns null when no finite point.
export const segmentQueryBounds = (points, radius, pad = BOUNDS_PAD) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX)) return null;
  const grow = (Number(radius) || 0) + (Number(pad) || 0);
  return { minX: minX - grow, minY: minY - grow, maxX: maxX + grow, maxY: maxY + grow };
};

export const boundsIntersect = (a, b) => (
  !!a && !!b
  && a.minX <= b.maxX && a.maxX >= b.minX
  && a.minY <= b.maxY && a.maxY >= b.minY
);
