// Spaces polygon area drawing and point editing (owner 2026-10-28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_POLYGON_SNAP_DEG,
  insertRegionSidePoint,
  isLevelRectangle,
  regionPolygonHitRadii,
  regionPolygonPressAction,
  resolveRegionPolygonPoint,
} from '../src/utils/regionPolygonEdit.js';

const toScreen = (p) => ({ x: p.x * 2, y: p.y * 2 });
const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

test('Shift locks the new side to 15° steps from the latest corner', () => {
  assert.equal(REGION_POLYGON_SNAP_DEG, 15);
  const { point } = resolveRegionPolygonPoint([{ x: 0, y: 0 }], { x: 100, y: 22 }, { shiftKey: true, toScreen });
  const deg = (Math.atan2(point.y, point.x) * 180) / Math.PI;
  assert.ok(Math.abs(deg - 15) < 1e-9, `got ${deg}`);
  const free = resolveRegionPolygonPoint([{ x: 0, y: 0 }], { x: 100, y: 22 }, { toScreen });
  assert.deepEqual(free.point, { x: 100, y: 22 });
});

test('the rubber band snaps onto the first corner from three corners', () => {
  const near = resolveRegionPolygonPoint(tri, { x: 4, y: 3 }, { toScreen, closePullPx: 14 });
  assert.equal(near.closing, true);
  assert.deepEqual(near.point, { x: 0, y: 0 });
  const two = resolveRegionPolygonPoint(tri.slice(0, 2), { x: 4, y: 3 }, { toScreen, closePullPx: 14 });
  assert.equal(two.closing, false);
});

test('presses on the check marks close or finish; elsewhere add a corner', () => {
  const { checkHitPx } = regionPolygonHitRadii();
  assert.equal(regionPolygonPressAction(tri, { x: 2, y: 2 }, { toScreen, checkHitPx }), 'close');
  assert.equal(regionPolygonPressAction(tri, { x: 98, y: 101 }, { toScreen, checkHitPx }), 'finish');
  assert.equal(regionPolygonPressAction(tri, { x: 50, y: 60 }, { toScreen, checkHitPx }), 'add');
  // Under three corners there are no check marks; a repeat press adds nothing.
  assert.equal(regionPolygonPressAction(tri.slice(0, 2), { x: 100.5, y: 0 }, { toScreen, checkHitPx }), 'ignore');
  assert.equal(regionPolygonPressAction(tri.slice(0, 2), { x: 92, y: 0 }, { toScreen, checkHitPx }), 'add');
});

test('finger hit areas are larger', () => {
  assert.ok(regionPolygonHitRadii({ coarse: true }).checkHitPx > regionPolygonHitRadii().checkHitPx);
});

test('level rectangles are told apart from other four-corner shapes', () => {
  assert.equal(isLevelRectangle([0, 0, 50, 0, 50, 30, 0, 30]), true);
  assert.equal(isLevelRectangle([0, 0, 0, 30, 50, 30, 50, 0]), true);
  assert.equal(isLevelRectangle([0, 0, 50, 0, 60, 30, 0, 30]), false);
  assert.equal(isLevelRectangle([0, 0, 50, 0, 50, 30, 20, 30, 0, 30]), false);
  // Tilted square.
  assert.equal(isLevelRectangle([0, 10, 10, 0, 20, 10, 10, 20]), false);
});

test('a point goes halfway along the side and curve flags stay aligned', () => {
  const region = { regionId: 'a', shapeType: 'rectangular', coordinates: [0, 0, 40, 0, 40, 20, 0, 20], smoothVertices: [0, 1, 0, 1] };
  const last = insertRegionSidePoint(region, 3);
  assert.equal(last.vertexIndex, 4);
  assert.deepEqual(last.region.coordinates, [0, 0, 40, 0, 40, 20, 0, 20, 0, 10]);
  assert.deepEqual(last.region.smoothVertices, [0, 1, 0, 1, 0]);
  assert.equal(last.region.shapeType, 'polygon');
  const first = insertRegionSidePoint(region, 0);
  assert.deepEqual(first.region.coordinates, [0, 0, 20, 0, 40, 0, 40, 20, 0, 20]);
  assert.equal(insertRegionSidePoint(region, 4), null);
  assert.deepEqual(region.coordinates, [0, 0, 40, 0, 40, 20, 0, 20]);
});
