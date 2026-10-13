/**
 * w63 — resizing a mark past its opposite side.
 *
 * Intended UX (Acrobat / Figma / Drawboard): the mark FLIPS through the fixed
 * corner and keeps growing on the other side; it never collapses to a speck.
 * Every mark keeps at least 4 page units per axis (or its own starting size if
 * it was already thinner). Shapes that cannot mirror (a text box) stop at the
 * minimum on the fixed side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_RESIZE_PAGE_UNITS,
  buildPointsShapeResize,
  clampResizeScale,
  minResizeScale,
  mirrorPointsInBox,
} from '../src/utils/resizeMinimum.js';

test('the floor is 4 page units', () => {
  assert.equal(MIN_RESIZE_PAGE_UNITS, 4);
  assert.equal(minResizeScale(100), 0.04);
  // A rect drawn at scale 2 (200 units wide): 4 units is still scale 0.04 of its raw 100.
  assert.equal(minResizeScale(100, 2), 0.04);
});

test('a mark that was already thinner than 4 is never blown up', () => {
  // A 1-unit-tall pen stroke: its own height is the floor.
  assert.equal(minResizeScale(1), 1);
  assert.equal(clampResizeScale(0.2, { rawSize: 1 }), 1);
  assert.equal(clampResizeScale(3, { rawSize: 1 }), 3);
});

test('dragging a flippable mark onto the opposite corner leaves 4 units, not a dot', () => {
  // 100 wide, pointer exactly on the anchor (scale 0) and just short of it.
  assert.equal(100 * clampResizeScale(0, { rawSize: 100 }), 4);
  assert.equal(100 * clampResizeScale(0.001, { rawSize: 100 }), 4);
});

test('dragging past the opposite corner flips and keeps growing', () => {
  assert.equal(clampResizeScale(-0.5, { rawSize: 100 }), -0.5);
  assert.equal(clampResizeScale(-1.5, { rawSize: 100 }), -1.5);
  // Just past the anchor: flipped, at the 4-unit floor.
  assert.equal(100 * clampResizeScale(-0.001, { rawSize: 100 }), -4);
});

test('a mark that cannot mirror stops at the minimum on the fixed side', () => {
  assert.equal(clampResizeScale(-0.8, { rawSize: 100, allowFlip: false }), 0.04);
  assert.equal(clampResizeScale(0.5, { rawSize: 100, allowFlip: false }), 0.5);
  // A text box uses its font size as the floor.
  assert.equal(100 * clampResizeScale(-2, { rawSize: 100, allowFlip: false, minSize: 12 }), 12);
});

test('an axis with no size stays invertible and untouched', () => {
  assert.equal(clampResizeScale(0.5, { rawSize: 0 }), 0.5);
  assert.equal(clampResizeScale(0, { rawSize: 0 }), Number.MIN_VALUE);
});

test('mirroring points keeps the bounding box and flips the drawing', () => {
  const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }];
  assert.deepEqual(mirrorPointsInBox(tri, { x: true, y: false }), [
    { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 20 },
  ]);
  assert.deepEqual(mirrorPointsInBox(tri, { x: false, y: true }), [
    { x: 0, y: 20 }, { x: 10, y: 20 }, { x: 0, y: 0 },
  ]);
  assert.equal(mirrorPointsInBox(tri, { x: false, y: false }), tri);
});

test('a flipped polygon saves mirrored points with a positive scale (preview == saved)', () => {
  const obj = {
    type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }],
    pathOffset: { x: 5, y: 10 },
    scaleX: 1,
    scaleY: 1,
    left: 100,
    top: 100,
    data: { pdfCloudIntensity: 1, pdfCloudVertexState: { stale: true }, id: 'a' },
  };
  const props = { pointsLocalMinX: 0, pointsLocalMinY: 0, pointsPathOffsetX: 5, pointsPathOffsetY: 10 };
  const out = buildPointsShapeResize(obj, { scaleX: -2, scaleY: 1, left: 80, top: 95 }, props);
  assert.equal(out.scaleX, 2);
  assert.equal(out.scaleY, 1);
  assert.deepEqual(out.points, [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 20 }]);
  // Visible left 80 -> object left = 80 - 2 * (0 - 5) = 90.
  assert.equal(out.left, 90);
  assert.equal(out.top, 105);
  // A flipped cloud drops its stale per-vertex fit, keeps everything else.
  assert.equal('pdfCloudVertexState' in out.data, false);
  assert.equal(out.data.id, 'a');
  // The input is untouched.
  assert.deepEqual(obj.points[0], { x: 0, y: 0 });
  assert.ok(obj.data.pdfCloudVertexState);
  // Unflipped: same points object, vertex state kept.
  const plain = buildPointsShapeResize(obj, { scaleX: 2, scaleY: 1, left: 80, top: 95 }, props);
  assert.equal(plain.points, obj.points);
  assert.ok(plain.data.pdfCloudVertexState);
});

test('an open cloud mirrored on one axis also reverses its order (crowns follow the mirror)', () => {
  const cloud = {
    type: 'polyline',
    points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 30, y: 0 }],
    pathOffset: { x: 15, y: 2.5 },
    scaleX: 1,
    scaleY: 1,
    left: 0,
    top: 0,
    data: { pdfCloudIntensity: 1 },
  };
  const props = { pointsLocalMinX: 0, pointsLocalMinY: 0, pointsPathOffsetX: 15, pointsPathOffsetY: 2.5 };
  // Mirrored top-to-bottom: (0,5) (10,0) (30,5), then reversed.
  const oneAxis = buildPointsShapeResize(cloud, { scaleX: 1, scaleY: -1, left: 0, top: 0 }, props);
  assert.deepEqual(oneAxis.points, [{ x: 30, y: 5 }, { x: 10, y: 0 }, { x: 0, y: 5 }]);
  // Both axes = a half turn: mirrored both ways, order kept.
  const both = buildPointsShapeResize(cloud, { scaleX: -1, scaleY: -1, left: 0, top: 0 }, props);
  assert.deepEqual(both.points, [{ x: 30, y: 5 }, { x: 20, y: 0 }, { x: 0, y: 5 }]);
  // A plain (non-cloud) polyline keeps its order, so its line ends stay put.
  const plain = buildPointsShapeResize({ ...cloud, data: {} }, { scaleX: 1, scaleY: -1, left: 0, top: 0 }, props);
  assert.deepEqual(plain.points, [{ x: 0, y: 5 }, { x: 10, y: 0 }, { x: 30, y: 5 }]);
});

test('a pointer exactly on the fixed corner counts as the unflipped side', () => {
  assert.equal(clampResizeScale(0, { rawSize: 100, startScale: -1 }), 0.04);
});
