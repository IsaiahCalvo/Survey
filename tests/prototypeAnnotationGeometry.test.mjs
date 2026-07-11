import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOfCommands,
  createInkAnnotation,
  eraseAnnotations,
  normalizeMultiPolygon,
  sweptDiskPolygon,
  translateCommands,
} from '../src/prototype/annotationGeometry.js';

function pointInRing(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(geometry, point) {
  return normalizeMultiPolygon(geometry).some((polygon) => {
    if (!pointInRing(polygon[0], point)) return false;
    return !polygon.slice(1).some((hole) => pointInRing(hole, point));
  });
}

test('swept disk covers the entire pointer segment, including fast movement between samples', () => {
  const geometry = sweptDiskPolygon([{ x: 50, y: -30 }, { x: 50, y: 30 }], 5);
  assert.equal(pointInGeometry(geometry, { x: 50, y: 0 }), true);
  assert.equal(pointInGeometry(geometry, { x: 56, y: 0 }), false);
});

test('partial erase makes a side bite without deleting the thick stroke centerline', () => {
  const ink = createInkAnnotation([{ x: 0, y: 0 }, { x: 100, y: 0 }], {
    id: 'ink-1',
    color: '#111',
    width: 20,
  });
  const result = eraseAnnotations([ink], [{ x: 50, y: -12 }], 7, 'partial');

  assert.deepEqual(result.changedIds, ['ink-1']);
  assert.equal(result.annotations.length, 1);
  assert.equal(pointInGeometry(result.annotations[0].polygons, { x: 50, y: -8 }), false);
  assert.equal(pointInGeometry(result.annotations[0].polygons, { x: 50, y: 0 }), true);
});

test('partial erase crossing the stroke uses a swept capsule and splits visible geometry', () => {
  const ink = createInkAnnotation([{ x: 0, y: 0 }, { x: 100, y: 0 }], {
    id: 'ink-2',
    color: '#111',
    width: 20,
  });
  const result = eraseAnnotations(
    [ink],
    [{ x: 50, y: -40 }, { x: 50, y: 40 }],
    5,
    'partial',
  );

  assert.equal(result.annotations.length, 1);
  assert.equal(pointInGeometry(result.annotations[0].polygons, { x: 50, y: 0 }), false);
  assert.equal(pointInGeometry(result.annotations[0].polygons, { x: 35, y: 0 }), true);
  assert.equal(pointInGeometry(result.annotations[0].polygons, { x: 65, y: 0 }), true);
});

test('full erase removes a touched annotation and leaves distant annotations intact', () => {
  const touched = createInkAnnotation([{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: 'a', width: 12 });
  const distant = createInkAnnotation([{ x: 0, y: 80 }, { x: 100, y: 80 }], { id: 'b', width: 12 });
  const result = eraseAnnotations([touched, distant], [{ x: 50, y: 0 }], 10, 'full');

  assert.deepEqual(result.deletedIds, ['a']);
  assert.deepEqual(result.annotations.map((annotation) => annotation.id), ['b']);
});

test('partial erase splits thin imported ink without converting it to filled geometry', () => {
  const imported = {
    id: 'pdf-ink',
    type: 'mark',
    source: 'pdf',
    cmds: [['M', 0, 0], ['L', 100, 0]],
    fill: null,
    stroke: '#111',
    strokeWidth: 2,
  };
  const result = eraseAnnotations(
    [imported],
    [{ x: 50, y: -20 }, { x: 50, y: 20 }],
    5,
    'partial',
  );

  assert.deepEqual(result.changedIds, ['pdf-ink']);
  assert.equal(result.annotations.length, 1);
  assert.equal(result.annotations[0].stroke, '#111');
  assert.equal(result.annotations[0].fill, null);
  assert.equal(result.annotations[0].cmds.filter((command) => command[0] === 'M').length, 2);
});

test('translation keeps page-space dimensions and moves the bounds exactly', () => {
  const ink = createInkAnnotation([{ x: 10, y: 20 }, { x: 50, y: 20 }], { id: 'move', width: 10 });
  const before = boundsOfCommands(ink.cmds);
  const after = boundsOfCommands(translateCommands(ink.cmds, 7, -3));
  assert.ok(Math.abs(after.x - before.x - 7) < 1e-6);
  assert.ok(Math.abs(after.y - before.y + 3) < 1e-6);
  assert.ok(Math.abs(after.w - before.w) < 1e-6);
  assert.ok(Math.abs(after.h - before.h) < 1e-6);
});
