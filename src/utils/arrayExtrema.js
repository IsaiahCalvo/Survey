/**
 * Linear min / max over arrays that can be LARGE.
 *
 * 2026-09-10 — `Math.min(...points.map((p) => p.x))` spreads one argument per
 * element onto the call stack. Past roughly 125,000 arguments V8 throws
 * `RangeError: Maximum call stack size exceeded`, and every array in this app
 * that carries SAMPLED geometry crosses that line on real drawings: a revision
 * cloud's outline is sampled at 100 points per cubic, so a full-sheet ARCH-E
 * rect cloud at Bump 2 (1,713 cubics) or a many-vertex polygon cloud produced
 * 171,300 points and threw inside getCloudPathBounds. The /Annots writer caught
 * the throw and silently DROPPED the cloud (the exported PDF carried 0
 * annotations while the screen showed the shape); the flattened print path did
 * not catch it and the whole print failed.
 *
 * These helpers keep `Math.min` / `Math.max` semantics exactly — ToNumber
 * coercion, NaN propagation, the -0 < +0 ordering, and the empty-array
 * identities (+Infinity / -Infinity) — so they are a drop-in replacement for a
 * spread, but run in constant stack space.
 */

/** `Math.min(...values)` without the spread. */
export const minOf = (values) => {
  let min = Infinity;
  const length = values?.length || 0;
  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index]);
    if (Number.isNaN(value)) return NaN;
    // `value < min` alone never replaces +0 with -0, which Math.min does.
    if (value < min || (value === 0 && min === 0 && Object.is(value, -0))) min = value;
  }
  return min;
};

/** `Math.max(...values)` without the spread. */
export const maxOf = (values) => {
  let max = -Infinity;
  const length = values?.length || 0;
  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index]);
    if (Number.isNaN(value)) return NaN;
    // Mirror of minOf: Math.max(-0, 0) is +0, so +0 must win a tie.
    if (value > max || (value === 0 && max === 0 && Object.is(max, -0))) max = value;
  }
  return max;
};

/**
 * Axis-aligned bounds of `{ x, y }` points in ONE pass — two minOf/maxOf pairs
 * would allocate two `.map()` arrays per axis over the same big point list.
 *
 * Returns null for an empty list. `coerce: true` reproduces the exact
 * expression the call sites already used — `Number(point?.x) || 0`, so NaN
 * (and only NaN, plus the zeroes it leaves alone) reads as 0.
 */
export const boundsOfPoints = (points, { coerce = false } = {}) => {
  const length = points?.length || 0;
  if (!length) return null;
  let minX = Infinity; let minY = Infinity;
  let maxX = -Infinity; let maxY = -Infinity;
  for (let index = 0; index < length; index += 1) {
    const point = points[index];
    const rawX = Number(point?.x);
    const rawY = Number(point?.y);
    const x = coerce ? (rawX || 0) : rawX;
    const y = coerce ? (rawY || 0) : rawY;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};
