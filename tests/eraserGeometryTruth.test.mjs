import test from 'node:test';
import assert from 'node:assert/strict';

import { eraserStrokeTouchesObject } from '../src/utils/eraserHitTest.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { cullInkSliverPolygons } from '../src/utils/paperAnnotationGeometry.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

// 2026-07-19 eraser audit regressions: the hit test must share the SVG
// renderers' world geometry (center-based line endpoints, rotation about the
// visual center, stamps as boxes). Each case below was a confirmed
// "shape immune to the eraser" class before the fix.

const touch = (object, x, y, radius = 8) => eraserStrokeTouchesObject({
  eraserPoints: [{ x, y }],
  eraserRadius: radius,
  object,
});

test('slash "/" diagonal line is hittable along its whole visible length', () => {
  // Visible segment: (100, 200) -> (200, 100). Stored fabric-style:
  // bbox (100,100)-(200,200), endpoints CENTER-relative.
  const line = {
    type: 'line',
    left: 100,
    top: 100,
    width: 100,
    height: 100,
    x1: -50,
    y1: 50,
    x2: 50,
    y2: -50,
    stroke: '#d11b2d',
    strokeWidth: 3,
    tool: 'line',
  };
  assert.equal(touch(line, 100, 200), true, 'visible start');
  assert.equal(touch(line, 150, 150), true, 'visible middle');
  assert.equal(touch(line, 200, 100), true, 'visible end');
  assert.equal(touch(line, 130, 120), false, 'clear of the line');
});

test('backslash "\\" diagonal line is hittable on BOTH halves', () => {
  // Visible segment: (100, 100) -> (200, 200).
  const line = {
    type: 'line',
    left: 100,
    top: 100,
    width: 100,
    height: 100,
    x1: -50,
    y1: -50,
    x2: 50,
    y2: 50,
    stroke: '#d11b2d',
    strokeWidth: 3,
    tool: 'arrow',
  };
  assert.equal(touch(line, 125, 125), true, 'first half');
  assert.equal(touch(line, 185, 185), true, 'second half (was immune)');
  assert.equal(touch(line, 40, 40), false, 'phantom pre-start zone must NOT hit');
});

test('rotated rect: hit region follows the visible (center-pivoted) shape', () => {
  const rect = {
    type: 'rect',
    left: 100,
    top: 100,
    width: 120,
    height: 40,
    angle: 90,
    fill: null,
    stroke: '#116622',
    strokeWidth: 2,
  };
  // At 90° about the center (160, 120), the visible rect occupies
  // x in [140, 180], y in [60, 180]; its top edge midpoint is (160, 60).
  assert.equal(touch(rect, 160, 60), true, 'visible rotated edge');
  assert.equal(touch(rect, 100, 100, 4), false, 'old unrotated corner no longer hits');
});

test('rotated textbox: hit region follows the visible box', () => {
  const text = {
    type: 'Textbox',
    left: 200,
    top: 200,
    width: 100,
    height: 30,
    angle: 45,
    text: 'hello',
  };
  // Center (250, 215); the visible rotated box contains the center.
  assert.equal(touch(text, 250, 215, 4), true);
  // The unrotated far corner region is empty space now.
  assert.equal(touch(text, 208, 202, 1), false);
});

test('stamp (image) annotations are hittable as their box', () => {
  const stamp = {
    type: 'image',
    left: 300,
    top: 300,
    width: 80,
    height: 60,
    scaleX: 1,
    scaleY: 1,
  };
  assert.equal(touch(stamp, 340, 330), true, 'inside the stamp');
  assert.equal(touch(stamp, 500, 500), false, 'far away');
});

test('curved line (midpoint) is hittable along the drawn curve', () => {
  // Straight chord (0,0)->(100,0) bowed to pass through (50,30).
  const line = {
    type: 'line',
    left: 0,
    top: 0,
    width: 100,
    height: 0,
    x1: -50,
    y1: 0,
    x2: 50,
    y2: 0,
    stroke: '#d11b2d',
    strokeWidth: 3,
    data: { midpoint: { x: 50, y: 30 } },
  };
  assert.equal(touch(line, 50, 30, 5), true, 'curve apex');
  assert.equal(touch(line, 50, 0, 3), false, 'chord midpoint is off the drawn curve');
});

// --- Native paper ink: true visible-shape subtraction ----------------------

const drawInk = (id, points, width = 12) => createProductionPaperInk({
  id,
  tool: 'pen',
  points,
  color: '#d11b2d',
  width,
});

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

test('thick native pen and highlighter strokes take a shallow rounded edge bite while their center survives', async (t) => {
  for (const tool of ['pen', 'highlighter']) {
    await t.test(tool, () => {
      const ink = createProductionPaperInk({
        id: `${tool}-edge-bite`,
        tool,
        points: [{ x: 0, y: 50 }, { x: 200, y: 50 }],
        color: '#d11b2d',
        width: 20,
      });
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [ink] },
        eraserPoints: [{ x: 100, y: 38 }],
        eraserRadius: 7,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];

      assert.equal(result.didChange, true);
      assert.deepEqual(result.changedIds, [`${tool}-edge-bite`]);
      assert.deepEqual(result.deletedIds, []);
      assert.equal(survivor.fillRule, 'evenodd');
      assert.equal(survivor.strokeWidth, 0);
      assert.ok(Array.isArray(survivor.polygons) && survivor.polygons.length > 0);
      assert.equal(
        pointInPolygonSet({ x: 100, y: 41 }, survivor.polygons),
        false,
        'eraser removes the touched upper edge',
      );
      assert.equal(
        pointInPolygonSet({ x: 100, y: 50 }, survivor.polygons),
        true,
        'shallow edge contact must not cut through the center',
      );
      assert.equal(
        pointInPolygonSet({ x: 70, y: 41 }, survivor.polygons),
        true,
        'nearby untouched edge remains intact',
      );
    });
  }
});

test('repeated partial erases rebase on the already carved polygon instead of an original centerline', () => {
  const ink = drawInk('twice', [{ x: 0, y: 50 }, { x: 300, y: 50 }], 20);
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 80, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const second = erasePageAnnotations({
    pageAnnotations: first.pageAnnotations,
    eraserPoints: [{ x: 200, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const survivor = second.pageAnnotations.objects[0];

  assert.equal(second.didChange, true);
  assert.equal(survivor.fillRule, 'evenodd');
  assert.equal(pointInPolygonSet({ x: 80, y: 41 }, survivor.polygons), false, 'first bite persists');
  assert.equal(pointInPolygonSet({ x: 200, y: 41 }, survivor.polygons), false, 'second bite persists');
  assert.equal(pointInPolygonSet({ x: 80, y: 50 }, survivor.polygons), true, 'first center survives');
  assert.equal(pointInPolygonSet({ x: 200, y: 50 }, survivor.polygons), true, 'second center survives');
});

// --- Polygon-lane sliver cull ----------------------------------------------

test('sliver cull drops hairline ribbons and degenerate rings, keeps real ink', () => {
  const healthy = [[[0, 0], [40, 0], [40, 10], [0, 10], [0, 0]]];
  const hairline = [[[0, 20], [40, 20], [40, 20.3], [0, 20.3], [0, 20]]];
  const degenerate = [[[5, 5], [5, 5], [5, 5], [5, 5]]];
  const culled = cullInkSliverPolygons([healthy, hairline, degenerate], 10);
  assert.equal(culled.length, 1);
  assert.deepEqual(culled[0], healthy);
});

test('sliver cull keeps a full pen dot', () => {
  // Approximate a dot of radius 5 (width 10) as a 16-gon.
  const dot = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    dot.push([50 + 5 * Math.cos(a), 50 + 5 * Math.sin(a)]);
  }
  dot.push(dot[0]);
  const culled = cullInkSliverPolygons([[dot]], 10);
  assert.equal(culled.length, 1);
});
