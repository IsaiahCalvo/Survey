import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canRemovePolyVertex, insertPolyVertex, insertVertexOnNearestEdge, polyVertexMinimum, removePolyVertex,
} from '../src/utils/polyVertices.js';

const square = (extra = {}) => ({
  type: 'polygon', left: 10, top: 20, angle: 0, scaleX: 1, scaleY: 1,
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  ...extra,
});

// World position of every corner, mirroring the SVG renderer's transform chain.
const world = (obj) => {
  const xs = obj.points.map((p) => p.x);
  const ys = obj.points.map((p) => p.y);
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const cx = sx * (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = sy * (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = ((obj.angle || 0) * Math.PI) / 180;
  return obj.points.map((p) => {
    const dx = p.x * sx - cx;
    const dy = p.y * sy - cy;
    return { x: obj.left + cx + dx * Math.cos(r) - dy * Math.sin(r), y: obj.top + cy + dx * Math.sin(r) + dy * Math.cos(r) };
  });
};

test('minimums: polygon 3, polyline 2, others cannot lose points', () => {
  assert.equal(polyVertexMinimum({ type: 'polygon' }), 3);
  assert.equal(polyVertexMinimum({ type: 'Polyline' }), 2);
  assert.equal(canRemovePolyVertex({ type: 'rect', points: [1, 2, 3, 4] }), false);
  assert.equal(canRemovePolyVertex(square()), true);
  assert.equal(canRemovePolyVertex({ type: 'polygon', points: square().points.slice(0, 3) }), false);
  assert.equal(canRemovePolyVertex({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), false);
  assert.equal(canRemovePolyVertex({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] }), true);
});

test('removes one corner and leaves the original untouched', () => {
  const obj = square();
  const next = removePolyVertex(obj, 1);
  assert.equal(obj.points.length, 4);
  assert.deepEqual(next.points, [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  assert.equal(next.left, 10);
  assert.equal(next.top, 20);
});

test('refuses bad indexes and shapes at the minimum', () => {
  assert.equal(removePolyVertex(square(), 4), null);
  assert.equal(removePolyVertex(square(), -1), null);
  assert.equal(removePolyVertex(square(), 1.5), null);
  assert.equal(removePolyVertex({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, 0), null);
});

test('rotated + scaled shape: surviving corners keep their world positions', () => {
  const obj = square({ angle: 37, scaleX: 1.5, scaleY: 0.75, points: [{ x: 0, y: 0 }, { x: 140, y: 10 }, { x: 100, y: 100 }, { x: -20, y: 60 }] });
  const before = world(obj);
  const next = removePolyVertex(obj, 1);
  const after = world(next);
  [0, 2, 3].forEach((oldIndex, i) => {
    assert.ok(Math.abs(after[i].x - before[oldIndex].x) < 1e-9);
    assert.ok(Math.abs(after[i].y - before[oldIndex].y) < 1e-9);
  });
});

test('drops stored cloud per-vertex state, keeps other data', () => {
  const next = removePolyVertex(square({ data: { measure: { kind: 'area' }, pdfCloudVertexState: { a: 1 } } }), 0);
  assert.deepEqual(next.data, { measure: { kind: 'area' } });
});

const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test('insertVertexOnNearestEdge projects onto the nearest side', () => {
  const r = insertVertexOnNearestEdge(sq, { x: 40, y: 3 }, 5);
  assert.equal(r.index, 1);
  assert.equal(r.segmentIndex, 0);
  assert.deepEqual(r.points[1], { x: 40, y: 0 });
  assert.equal(r.points.length, 5);
});

test('insertVertexOnNearestEdge uses the closing side only when closed', () => {
  const closed = insertVertexOnNearestEdge(sq, { x: 2, y: 50 }, 5);
  assert.equal(closed.index, 4);
  assert.deepEqual(closed.points[4], { x: 0, y: 50 });
  assert.equal(insertVertexOnNearestEdge(sq, { x: 2, y: 50 }, 5, { closed: false }), null);
});

test('insertVertexOnNearestEdge rejects far points and corners', () => {
  assert.equal(insertVertexOnNearestEdge(sq, { x: 50, y: 50 }, 5), null);
  assert.equal(insertVertexOnNearestEdge(sq, { x: -3, y: -3 }, 10), null);
  assert.equal(insertVertexOnNearestEdge([{ x: 0, y: 0 }], { x: 0, y: 0 }), null);
});

test('insertPolyVertex keeps the shape and world positions', () => {
  const obj = square({ angle: 30, scaleX: 2, data: { pdfCloudVertexState: [1], keep: 1 } });
  const next = insertPolyVertex(obj, 3, 0.25);
  assert.equal(next.points.length, 5);
  assert.deepEqual(next.points[4], { x: 0, y: 75 });
  assert.equal(next.left, obj.left);
  assert.equal(next.top, obj.top);
  assert.deepEqual(next.data, { keep: 1 });
  const before = world(obj);
  const after = world(next);
  for (const [i, j] of [[0, 0], [1, 1], [2, 2], [3, 3]]) {
    assert.ok(Math.abs(before[i].x - after[j].x) < 1e-9 && Math.abs(before[i].y - after[j].y) < 1e-9);
  }
  assert.equal(insertPolyVertex({ ...obj, type: 'polyline' }, 3, 0.5), null);
  assert.equal(insertPolyVertex(obj, 0, 1), null);
});
