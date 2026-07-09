/**
 * crescentErase.test.mjs — the eraser must bite a rounded, partial-width
 * crescent out of the SIDE of a thick stroke when the eraser disk clips its
 * edge, instead of removing the stroke's full width wherever it is touched.
 *
 * Exercises eraseInkCrescent (src/utils/crescentErase.js), the pure helper
 * FabricEraserCanvas calls at both the live (per-mousemove) and commit
 * erase sites. Fabric-free: pathObj is a plain object duck-typing
 * { path, strokeWidth, stroke, pathOffset, calcTransformMatrix() } — same
 * pattern as tests/geometryEraserPartialErase.test.mjs's makePathObj.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { eraseInkCrescent } from '../src/utils/crescentErase.js';

const HLINE = [['M', 0, 0], ['L', 100, 0]]; // horizontal stroke centerline

const makeStrokeObj = ({ path, strokeWidth = 20, stroke = '#ff0000', matrix = [1, 0, 0, 1, 0, 0] }) => ({
  path,
  strokeWidth,
  stroke,
  fill: null,
  pathOffset: { x: 0, y: 0 },
  calcTransformMatrix: () => matrix,
});

// Even-odd containment across ALL rings of the returned pathData commands —
// mirrors how the erased outline is rendered (fillRule: evenodd). Same
// algorithm as geometryEraserPartialErase.test.mjs's pathDataContains.
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

test('edge graze bites a shallow, partial-width crescent — far edge survives', () => {
  // strokeWidth 20 -> ribbon y in [-10, 10]. Eraser r=5 centered at y=12
  // reaches down to y=7: only the top sliver [7, 10] may be removed.
  const obj = makeStrokeObj({ path: HLINE, strokeWidth: 20 });
  const res = eraseInkCrescent(obj, [{ x: 50, y: 12 }, { x: 50, y: 12 }], 5);
  assert.equal(res.changed, true);
  assert.equal(res.isConvertedToOutline, true, 'first touch converts stroke -> filled outline');
  assert.ok(Array.isArray(res.pathData) && res.pathData.length > 0, 'stroke survives an edge graze');
  // grazed sliver removed directly under the click x
  assert.equal(pathDataContains(res.pathData, 50, 8), false, 'grazed sliver under the eraser is removed');
  // far edge (opposite side of the centerline) stays intact -- the whole
  // point of a crescent bite instead of a full-width cut
  assert.equal(pathDataContains(res.pathData, 50, -8), true, 'far edge of the stroke is untouched');
  // body far from the eraser is untouched
  assert.equal(pathDataContains(res.pathData, 10, 0), true);
  assert.equal(pathDataContains(res.pathData, 90, 0), true);
});

test('full crossing splits the stroke into two filled regions', () => {
  const obj = makeStrokeObj({ path: HLINE, strokeWidth: 20 });
  const res = eraseInkCrescent(obj, [{ x: 50, y: -30 }, { x: 50, y: 30 }], 8);
  assert.equal(res.changed, true);
  assert.equal(pathDataContains(res.pathData, 50, 0), false, 'crossing removes the full width at the cut');
  assert.equal(pathDataContains(res.pathData, 10, 0), true, 'left region remains');
  assert.equal(pathDataContains(res.pathData, 90, 0), true, 'right region remains');
});

test('repeat erase on the converted outline works: new hole punched, old hole not resurrected', () => {
  const obj = makeStrokeObj({ path: HLINE, strokeWidth: 20 });

  // First bite: small centered erase, fully inside the wide ribbon -> an
  // enclosed hole (does not reach either edge).
  const first = eraseInkCrescent(obj, [{ x: 50, y: 0 }, { x: 50, y: 0 }], 5);
  assert.equal(first.changed, true);
  assert.equal(first.isConvertedToOutline, true);
  // Simulate the caller's one-time conversion exactly as FabricEraserCanvas does.
  obj.path = first.pathData;
  obj.strokeWidth = 0;
  obj.fill = obj.stroke;

  assert.equal(pathDataContains(obj.path, 50, 0), false, 'first erase punches a hole');
  assert.equal(pathDataContains(obj.path, 50, 8), true, 'ink above the hole remains');

  // Second bite: far from the first hole, deep in the still-solid middle of
  // the ribbon (10 units from either edge, well beyond a radius-5 eraser) --
  // this is exactly the case an edge-only touch test would miss.
  const second = eraseInkCrescent(obj, [{ x: 20, y: 0 }, { x: 20, y: 0 }], 5);
  assert.equal(second.changed, true, 'a new hole punched in solid interior fill must register as touched');
  assert.equal(second.isConvertedToOutline, false, 'already converted -- no re-conversion flag');
  assert.equal(pathDataContains(second.pathData, 50, 0), false, 'the first hole is not resurrected');
  assert.equal(pathDataContains(second.pathData, 20, 0), false, 'the second erase punches its own hole');
  assert.equal(pathDataContains(second.pathData, 80, 0), true, 'untouched ink elsewhere remains');
});

test('no contact just outside the tangency envelope: unchanged, path data untouched', () => {
  // rEff = eraserRadius(5) + strokeWidth/2(10) = 15. Placing the eraser 16
  // units from the centerline misses by exactly 1 unit.
  const obj = makeStrokeObj({ path: HLINE, strokeWidth: 20 });
  const originalPath = obj.path;
  const res = eraseInkCrescent(obj, [{ x: 50, y: 16 }, { x: 50, y: 16 }], 5);
  assert.equal(res.changed, false);
  assert.equal(res.pathData, null);
  assert.equal(obj.path, originalPath, 'path data reference must be untouched');
  assert.deepEqual(obj.path, HLINE);
});

test('first contact converts strokeWidth>0 -> {strokeWidth:0, fill:originalStroke} exactly once; untouched neighbor is byte-identical', () => {
  const touched = makeStrokeObj({ path: HLINE, strokeWidth: 20, stroke: '#112233' });
  const neighborPath = HLINE.map((cmd) => cmd.slice());
  const neighbor = makeStrokeObj({ path: neighborPath, strokeWidth: 20, stroke: '#445566' });
  const neighborSnapshot = {
    path: JSON.parse(JSON.stringify(neighbor.path)),
    strokeWidth: neighbor.strokeWidth,
    stroke: neighbor.stroke,
    fill: neighbor.fill,
    pathOffset: { ...neighbor.pathOffset },
  };

  const res = eraseInkCrescent(touched, [{ x: 50, y: 0 }, { x: 50, y: 0 }], 5);
  assert.equal(res.changed, true);
  assert.equal(res.isConvertedToOutline, true);

  // Simulate the caller's one-time conversion exactly as FabricEraserCanvas does.
  touched.path = res.pathData;
  touched.strokeWidth = 0;
  touched.fill = touched.stroke;
  assert.equal(touched.strokeWidth, 0);
  assert.equal(touched.fill, '#112233', 'fill takes the ORIGINAL stroke color');

  // A second bite on the SAME now-converted object must not re-flag conversion.
  const res2 = eraseInkCrescent(touched, [{ x: 5, y: 0 }, { x: 5, y: 0 }], 5);
  assert.equal(res2.isConvertedToOutline, false, 'second bite on an already-converted stroke must not re-convert');

  // eraseInkCrescent was never called on the neighbor -- it must be
  // byte-identical to how it started.
  assert.deepEqual(neighbor.path, neighborSnapshot.path);
  assert.equal(neighbor.strokeWidth, neighborSnapshot.strokeWidth);
  assert.equal(neighbor.stroke, neighborSnapshot.stroke);
  assert.equal(neighbor.fill, neighborSnapshot.fill);
  assert.deepEqual(neighbor.pathOffset, neighborSnapshot.pathOffset);
});

test('very long paths fall back to the full-width centerline cut and skip conversion', () => {
  // Build a path with > 600 segments so the long-path perf fallback engages.
  const path = [['M', 0, 0]];
  for (let i = 1; i <= 700; i += 1) {
    path.push(['L', i * 0.2, i % 2 === 0 ? 0 : 0.01]);
  }
  const obj = makeStrokeObj({ path, strokeWidth: 20 });
  const midX = 70;
  const res = eraseInkCrescent(obj, [{ x: midX, y: 0 }, { x: midX, y: 0 }], 5);
  assert.equal(res.changed, true);
  assert.equal(res.isConvertedToOutline, false, 'long-path fallback must not convert to a filled outline');
  // Fallback result is still legit centerline-split path data (M/L commands only).
  assert.ok(res.pathData.every((cmd) => cmd[0] === 'M' || cmd[0] === 'L'));
});
