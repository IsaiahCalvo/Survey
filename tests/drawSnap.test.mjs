import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapAngle, nearestEndpoint, polyWorldPoints, lineWorldEndpoints,
  collectEndpointCandidates, resolveDrawSnap,
} from '../src/utils/drawSnap.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('snapAngle locks to 0/45/90 steps keeping length', () => {
  assert.deepEqual(snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 }), { x: 10.04987562112089, y: 0 });
  const d = snapAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
  close(d.x, d.y);
  close(Math.hypot(d.x, d.y), Math.hypot(10, 9));
  const v = snapAngle({ x: 5, y: 5 }, { x: 6, y: -20 });
  assert.equal(v.x, 5);
  assert.deepEqual(snapAngle({ x: 1, y: 1 }, { x: 1, y: 1 }), { x: 1, y: 1 });
  const r = snapAngle({ x: 0, y: 0 }, { x: 10, y: 4 }, 90);
  assert.equal(r.y, 0);
});

test('nearestEndpoint picks the closest within tolerance', () => {
  const c = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 0 }];
  assert.deepEqual(nearestEndpoint({ x: 10.8, y: 0 }, c, 2), { x: 11, y: 0, distance: 0.1999999999999993 });
  assert.equal(nearestEndpoint({ x: 50, y: 0 }, c, 2), null);
  assert.equal(nearestEndpoint({ x: 0, y: 0 }, c, 0), null);
});

test('polyWorldPoints applies translate/scale/pathOffset/rotation', () => {
  const plain = polyWorldPoints({ type: 'polygon', left: 10, top: 20, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], pathOffset: { x: 0, y: 0 } });
  assert.deepEqual(plain, [{ x: 10, y: 20 }, { x: 14, y: 20 }]);
  const rot = polyWorldPoints({ left: 0, top: 0, angle: 90, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] });
  close(rot[0].x, 2); close(rot[0].y, -2); close(rot[1].x, 2); close(rot[1].y, 2);
});

test('lineWorldEndpoints honours left/top/width/height and angle', () => {
  const [a, b] = lineWorldEndpoints({ type: 'line', left: 0, top: 0, width: 10, height: 0, x1: -5, y1: 0, x2: 5, y2: 0 });
  assert.deepEqual([a, b], [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const [c, d] = lineWorldEndpoints({ type: 'line', left: 0, top: 0, width: 10, height: 0, x1: -5, y1: 0, x2: 5, y2: 0, angle: 90 });
  close(c.x, 5); close(c.y, -5); close(d.x, 5); close(d.y, 5);
});

test('collectEndpointCandidates skips excluded mark, own dragged corner and other types', () => {
  const objs = [
    { type: 'line', left: 0, top: 0, width: 10, height: 0, x1: -5, y1: 0, x2: 5, y2: 0 },
    { type: 'rect', left: 0, top: 0, width: 5, height: 5 },
    { type: 'polyline', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] },
  ];
  assert.equal(collectEndpointCandidates(objs).length, 5);
  assert.equal(collectEndpointCandidates(objs, { excludeIndex: 0 }).length, 3);
  const own = collectEndpointCandidates(objs, { own: { index: 2, skip: new Set([1]) } });
  assert.equal(own.length, 4);
  assert.ok(!own.some((p) => p.x === 2 && p.y === 2));
});

test('resolveDrawSnap: endpoint wins over Shift; Alt/off falls back to angle lock', () => {
  const candidates = [{ x: 10, y: 3 }];
  const hit = resolveDrawSnap({ x: 0, y: 0 }, { x: 9, y: 3 }, { shiftKey: true, candidates, tolPage: 2 });
  assert.deepEqual(hit, { point: { x: 10, y: 3 }, endpoint: { x: 10, y: 3 } });
  const off = resolveDrawSnap({ x: 0, y: 0 }, { x: 9, y: 3 }, { shiftKey: true, endpointSnap: false, candidates, tolPage: 2 });
  assert.equal(off.endpoint, null);
  close(off.point.y, 0);
  const raw = resolveDrawSnap({ x: 0, y: 0 }, { x: 30, y: 3 }, { candidates, tolPage: 2 });
  assert.deepEqual(raw, { point: { x: 30, y: 3 }, endpoint: null });
});
