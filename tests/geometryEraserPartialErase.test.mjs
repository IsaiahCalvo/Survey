/**
 * geometryEraserPartialErase.test.mjs — geometry contracts for partial erase.
 *
 * Desired behavior (Job-Board-PDF-style):
 *  - clipping the EDGE of a stroke takes a shallow crescent bite, leaving the
 *    far edge of the stroke intact
 *  - the eraser cut is a continuous SWEPT band between pointer samples, not a
 *    row of disconnected disks
 *  - the visible-ink outline has round end caps (like the rendered stroke)
 *  - repeat erase on an already-outlined stroke preserves punched holes
 *  - non-uniformly scaled objects erase with the true world-space eraser shape
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booleanErasePath } from '../src/utils/geometryEraser.js';

// Minimal fabric-path stand-in: identity transform unless a matrix is given.
const makePathObj = ({ path, strokeWidth = 4, matrix = [1, 0, 0, 1, 0, 0] }) => ({
  path,
  strokeWidth,
  pathOffset: { x: 0, y: 0 },
  calcTransformMatrix: () => matrix,
});

// Even-odd containment across ALL rings of the returned pathData commands —
// mirrors how the erased outline is rendered (fillRule: evenodd).
const pathDataContains = (pathData, x, y) => {
  const rings = [];
  let ring = null;
  for (const cmd of pathData) {
    if (cmd[0] === 'M') {
      if (ring && ring.length >= 3) rings.push(ring);
      ring = [[cmd[1], cmd[2]]];
    } else if (cmd[0] === 'L') {
      ring.push([cmd[1], cmd[2]]);
    } else if (cmd[0] === 'Z') {
      if (ring && ring.length >= 3) rings.push(ring);
      ring = null;
    }
  }
  if (ring && ring.length >= 3) rings.push(ring);
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
};

const HLINE = [['M', 0, 0], ['L', 100, 0]]; // horizontal stroke centerline

test('edge clip takes a shallow crescent bite, far edge stays intact', () => {
  // strokeWidth 4 → ribbon y ∈ [-2, 2]. Eraser r=4 centered at y=5 reaches
  // down to y=1: only the top sliver [1, 2] of the stroke may be removed.
  const obj = makePathObj({ path: HLINE, strokeWidth: 4 });
  const res = booleanErasePath(obj, { points: [{ x: 50, y: 5 }] }, 4);
  assert.ok(res && Array.isArray(res.pathData) && res.pathData.length > 0, 'stroke survives an edge clip');
  assert.equal(res.isConvertedToOutline, true);
  // bitten: just inside the eraser's reach
  assert.equal(pathDataContains(res.pathData, 50, 1.6), false, 'top sliver under the eraser is removed');
  // far edge intact: same x, opposite side of the centerline
  assert.equal(pathDataContains(res.pathData, 50, -1.5), true, 'far edge of the stroke is untouched');
  // body far from the eraser intact
  assert.equal(pathDataContains(res.pathData, 10, 0), true);
  assert.equal(pathDataContains(res.pathData, 90, 0), true);
});

test('eraser sweeps a continuous band between pointer samples', () => {
  // Two samples crossing the stroke, far apart: the gap between them must be
  // erased too (swept capsule), not just two disk-shaped punches.
  const obj = makePathObj({ path: HLINE, strokeWidth: 4 });
  const res = booleanErasePath(obj, { points: [{ x: 30, y: 0 }, { x: 70, y: 0 }] }, 3);
  assert.ok(res && res.pathData.length > 0, 'ends of the stroke survive');
  assert.equal(pathDataContains(res.pathData, 50, 0), false, 'midpoint between samples is erased');
  assert.equal(pathDataContains(res.pathData, 10, 0), true);
  assert.equal(pathDataContains(res.pathData, 90, 0), true);
});

test('visible-ink outline has round end caps', () => {
  // Round caps extend halfWidth beyond the endpoint along the tangent.
  const obj = makePathObj({ path: HLINE, strokeWidth: 4 });
  // erase far away so the outline geometry itself is what we inspect
  const res = booleanErasePath(obj, { points: [{ x: 50, y: 500 }] }, 4);
  assert.ok(res && res.pathData.length > 0);
  assert.equal(pathDataContains(res.pathData, 101.2, 0), true, 'end cap bulges past the last point');
  assert.equal(pathDataContains(res.pathData, -1.2, 0), true, 'start cap bulges past the first point');
  assert.equal(pathDataContains(res.pathData, 101.9, 1.9), false, 'cap is round, not square');
});

test('repeat erase preserves holes punched by an earlier erase', () => {
  // Thick stroke (w=20 → y ∈ [-10, 10]); first erase punches a hole fully
  // inside it. Then erase somewhere far away. The hole must stay a hole.
  const obj = makePathObj({ path: HLINE, strokeWidth: 20 });
  const first = booleanErasePath(obj, { points: [{ x: 50, y: 0 }] }, 5);
  assert.ok(first && first.pathData.length > 0);
  assert.equal(pathDataContains(first.pathData, 50, 0), false, 'first erase punches the hole');
  assert.equal(pathDataContains(first.pathData, 50, 8), true, 'ink above the hole remains');

  const outlined = makePathObj({ path: first.pathData, strokeWidth: 0 });
  const second = booleanErasePath(outlined, { points: [{ x: 200, y: 200 }] }, 5);
  assert.ok(second && second.pathData.length > 0);
  assert.equal(second.isConvertedToOutline, false);
  assert.equal(pathDataContains(second.pathData, 50, 0), false, 'hole survives the second erase');
  assert.equal(pathDataContains(second.pathData, 50, 8), true, 'ink above the hole still remains');
  assert.equal(pathDataContains(second.pathData, 10, 0), true);
});

test('non-uniform object scale uses the true world-space eraser shape', () => {
  // Object scaled 2x in X only. World eraser r=3 at (50, 3.5) maps to a local
  // ellipse with y-reach 3 (not 1.5): it must bite the local band y ∈ [-2, 2].
  const obj = makePathObj({ path: HLINE, strokeWidth: 4, matrix: [2, 0, 0, 1, 0, 0] });
  const res = booleanErasePath(obj, { points: [{ x: 50, y: 3.5 }] }, 3);
  assert.ok(res && res.pathData.length > 0);
  assert.equal(pathDataContains(res.pathData, 25, 1.5), false, 'eraser bites at full world-space reach');
  assert.equal(pathDataContains(res.pathData, 25, -1.5), true, 'far edge intact');
});

test('full crossing still cuts the stroke in two', () => {
  const obj = makePathObj({ path: HLINE, strokeWidth: 4 });
  const res = booleanErasePath(obj, { points: [{ x: 50, y: -6 }, { x: 50, y: 6 }] }, 4);
  assert.ok(res && res.pathData.length > 0);
  assert.equal(pathDataContains(res.pathData, 50, 0), false, 'crossing removes the full width');
  assert.equal(pathDataContains(res.pathData, 20, 0), true, 'left half remains');
  assert.equal(pathDataContains(res.pathData, 80, 0), true, 'right half remains');
});
