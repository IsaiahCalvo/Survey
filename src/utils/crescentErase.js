/**
 * crescentErase.js — routes a STROKED ink path through TRUE 2-D boolean
 * erasure so an eraser clipping the EDGE of a thick stroke bites a rounded,
 * partial-width crescent out of its side, instead of removing the stroke's
 * full width wherever the old centerline test said "touched".
 *
 * Two-stage pipeline, meant to be called once per candidate stroke — live,
 * per pointer-move, AND at commit:
 *
 *  1. GATE — decides CHEAPLY whether this stroke needs any work at all.
 *     - strokeWidth > 0 (not yet converted): inkEraser.js's exact
 *       swept-capsule centerline test, rEff = eraserRadius + strokeWidth/2.
 *       This inflation guarantees "touched" exactly matches "the eraser
 *       circle overlaps the VISIBLE stroke body", no matter where within
 *       the stroke's width it lands — correct and cheap.
 *     - strokeWidth === 0 (already a filled outline from a prior erase):
 *       there is no centerline to gate against, so touch is edge-distance
 *       (same capsule test, rEff = eraserRadius) OR the eraser sits fully
 *       INSIDE still-solid fill (a plain point-in-outline test on each
 *       capsule endpoint) — the edge test alone misses a brand-new hole
 *       punched in the untouched middle of a wide already-converted ribbon.
 *     The gate's own cut geometry is normally discarded — it is used only
 *     as a yes/no — except as the long-path fallback below.
 *  2. GEOMETRY — when touched, geometryEraser.js's booleanErasePath
 *     boolean-subtracts the eraser capsule(s) from the stroke's TRUE outline
 *     polygon: a strokeWidth>0 path is converted ONCE (lazily, on first
 *     contact) to a filled outline (round caps courtesy of strokeToPolygon);
 *     a strokeWidth===0 path is already a filled outline and is re-diffed
 *     directly, holes preserved as holes. This is exact under rotation/
 *     non-uniform scale (per-vertex world->local mapping), unlike the
 *     gate's scalar-radius approximation.
 *
 * Performance fallback: very long flattened paths (imported dense ink, still
 * strokeWidth>0) skip the boolean pipeline and reuse the gate's own
 * centerline-split result — full-width cut, the pre-crescent behavior — so
 * live-erasing a giant imported stroke never hitches. strokeWidth/fill stay
 * untouched in that case (isConvertedToOutline: false) so the object keeps
 * its cheap stroked representation. There is no equivalent shortcut once a
 * path is already a filled outline (its own centerline-split geometry would
 * be meaningless there) — the existing codebase already runs the full
 * boolean pipeline unconditionally for pre-existing "legacy ribbon" objects
 * at commit, so this is not a new performance risk.
 *
 * Pure and fabric-free: pathObj only needs to duck-type
 * { path, strokeWidth, pathOffset, calcTransformMatrix() } — see
 * tests/crescentErase.test.mjs for a plain-object stand-in (same pattern as
 * tests/geometryEraserPartialErase.test.mjs).
 */
import { erasePathWithCapsules } from './inkEraser.js';
import { booleanErasePath } from './geometryEraser.js';

// ponytail: full-width fallback on very long paths, boolean patch-localization if it matters
const LONG_PATH_SEGMENT_THRESHOLD = 600;

// Local copy of geometryEraser.js's private transform helper (itself copied
// from geometryHitTest.js for the same reason) — kept self-contained so this
// module stays pure/fabric-free and independently unit-testable.
const transformPointInverse = (point, matrix) => {
  if (!matrix) return point;
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return point;
  const invDet = 1 / det;
  const px = point.x - e;
  const py = point.y - f;
  return {
    x: (d * px - c * py) * invDet,
    y: (-b * px + a * py) * invDet,
  };
};

const countSegments = (pathData) => {
  if (!pathData) return 0;
  let n = 0;
  for (const cmd of pathData) {
    if (cmd[0] !== 'M') n += 1;
  }
  return n;
};

/**
 * Even-odd point-in-outline test over a filled M/L/Z path (the ONLY commands
 * booleanErasePath ever emits, so this is a complete test for any
 * strokeWidth===0 path this module encounters). Holes (inner rings) flip
 * parity, matching the fillRule:evenodd the SVG renderer already uses for
 * erased outlines.
 */
const isPointInsideOutline = (pathData, pt) => {
  let inside = false;
  let ring = [];
  const testRing = (r) => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  };
  for (const cmd of pathData || []) {
    if (cmd[0] === 'M') {
      if (ring.length >= 3) testRing(ring);
      ring = [[cmd[1], cmd[2]]];
    } else if (cmd[0] === 'L') {
      ring.push([cmd[1], cmd[2]]);
    } else if (cmd[0] === 'Z') {
      if (ring.length >= 3) testRing(ring);
      ring = [];
    }
  }
  if (ring.length >= 3) testRing(ring);
  return inside;
};

/**
 * @param {{path:Array, strokeWidth:number, pathOffset:{x:number,y:number}, calcTransformMatrix:() => number[]}} pathObj
 *   Fabric-like path object. `path` is fabric path command tuples; `strokeWidth`
 *   is 0 once a prior call has converted this object to a filled outline.
 * @param {{x:number,y:number}[]} worldPoints - eraser pointer samples in
 *   WORLD/scene space, length >= 2 (consecutive pairs form swept capsules).
 * @param {number} worldRadius - eraser radius in WORLD/scene space (raw —
 *   NOT inflated by strokeWidth; the outline polygon already carries the
 *   stroke's own width once converted).
 * @returns {{changed:boolean, pathData:Array|null, isConvertedToOutline:boolean}}
 *   isConvertedToOutline is true exactly when THIS call performed the
 *   one-time stroke->fill conversion — the caller should then set the
 *   fabric object to strokeWidth:0, fill:<original stroke color> (the
 *   existing legacy-ribbon format the codebase already re-erases, hit-tests,
 *   renders, and syncs).
 */
export function eraseInkCrescent(pathObj, worldPoints, worldRadius) {
  if (!pathObj || !pathObj.path || !Array.isArray(worldPoints) || worldPoints.length < 2) {
    return { changed: false, pathData: null, isConvertedToOutline: false };
  }

  const matrix = typeof pathObj.calcTransformMatrix === 'function' ? pathObj.calcTransformMatrix() : null;
  const pathOffset = pathObj.pathOffset || { x: 0, y: 0 };
  const scale = matrix ? (Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]) || 1) : 1;
  const toLocal = (pt) => {
    const local = transformPointInverse(pt, matrix);
    return { x: local.x + pathOffset.x, y: local.y + pathOffset.y };
  };
  const localRadius = worldRadius / scale;
  const strokeWidth = pathObj.strokeWidth || 0;

  const localCapsules = [];
  for (let i = 0; i < worldPoints.length - 1; i += 1) {
    localCapsules.push({ a: toLocal(worldPoints[i]), b: toLocal(worldPoints[i + 1]) });
  }

  let touched = false;
  // Centerline-split result — only ever a geometrically valid fallback when
  // strokeWidth>0 (a real centerline+width model). Left null otherwise.
  let safeFallbackPathData = null;

  if (strokeWidth > 0) {
    const rEff = localRadius + strokeWidth / 2;
    let gate;
    try {
      gate = erasePathWithCapsules(pathObj.path, localCapsules, rEff);
    } catch (_) {
      return { changed: false, pathData: null, isConvertedToOutline: false };
    }
    touched = gate.changed;
    if (touched) safeFallbackPathData = gate.pathData;
  } else {
    let edgeTouched = false;
    try {
      edgeTouched = erasePathWithCapsules(pathObj.path, localCapsules, localRadius).changed;
    } catch (_) { /* fall through to the interior check */ }
    const interiorTouched = localCapsules.some(
      (cap) => isPointInsideOutline(pathObj.path, cap.a) || isPointInsideOutline(pathObj.path, cap.b)
    );
    touched = edgeTouched || interiorTouched;
  }

  if (!touched) {
    return { changed: false, pathData: null, isConvertedToOutline: false };
  }

  // ponytail: full-width fallback on very long paths, boolean patch-localization if it matters
  if (safeFallbackPathData && countSegments(pathObj.path) > LONG_PATH_SEGMENT_THRESHOLD) {
    return { changed: true, pathData: safeFallbackPathData, isConvertedToOutline: false };
  }

  let result;
  try {
    result = booleanErasePath(pathObj, { points: worldPoints }, worldRadius);
  } catch (_) {
    if (safeFallbackPathData) {
      return { changed: true, pathData: safeFallbackPathData, isConvertedToOutline: false };
    }
    return { changed: false, pathData: null, isConvertedToOutline: false };
  }
  if (!result) {
    if (safeFallbackPathData) {
      return { changed: true, pathData: safeFallbackPathData, isConvertedToOutline: false };
    }
    return { changed: false, pathData: null, isConvertedToOutline: false };
  }
  if (Array.isArray(result)) {
    // Fully erased (booleanErasePath's bare-[] convention).
    return { changed: true, pathData: [], isConvertedToOutline: strokeWidth > 0 };
  }
  return {
    changed: true,
    pathData: result.pathData,
    isConvertedToOutline: result.isConvertedToOutline,
  };
}
