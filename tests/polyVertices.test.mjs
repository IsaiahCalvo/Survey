import test from 'node:test';
import assert from 'node:assert/strict';

import { canRemovePolyVertex, polyVertexMinimum, removePolyVertex } from '../src/utils/polyVertices.js';

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
