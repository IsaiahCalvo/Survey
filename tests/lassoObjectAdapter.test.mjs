import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annotationToLassoGeometry,
  calloutToLassoGeometry,
} from '../src/utils/lassoObjectAdapter.js';
import { isGeometryFullyInsideLasso, resolveLassoHits } from '../src/utils/lassoSelection.js';

const box = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top },
  { x: right, y: bottom }, { x: left, y: bottom },
];

test('rotated rectangle adapter exposes the transformed outline', () => {
  const geometry = annotationToLassoGeometry({
    type: 'rect', left: 40, top: 40, width: 20, height: 10, angle: 90, fill: '#fff',
  });
  assert.ok(geometry);
  assert.equal(Math.round(geometry.bounds.left), 45);
  assert.equal(Math.round(geometry.bounds.right), 55);
  assert.equal(Math.round(geometry.bounds.top), 35);
  assert.equal(Math.round(geometry.bounds.bottom), 55);
});

test('curved arrow adapter follows the curve and includes the arrowhead', () => {
  const geometry = annotationToLassoGeometry({
    type: 'line', tool: 'arrow', left: 10, top: 10, width: 80, height: 0,
    x1: -40, y1: 0, x2: 40, y2: 0, strokeWidth: 1,
    data: { midpoint: { x: 50, y: 50 } },
  });
  assert.ok(geometry.bounds.bottom >= 50, 'curve reaches its stored midpoint');
  assert.ok(geometry.bounds.top <= 6, 'arrowhead width is part of the outline');
});

test('group is atomic: full enclosure selects it and partial enclosure does not', () => {
  const geometry = annotationToLassoGeometry({
    type: 'group', left: 20, top: 20, width: 60, height: 30,
    objects: [{ type: 'line', x1: 0, y1: 0, x2: 60, y2: 30, strokeWidth: 4 }],
  });
  assert.equal(isGeometryFullyInsideLasso(geometry, box(0, 0, 100, 100)), true);
  assert.equal(isGeometryFullyInsideLasso(geometry, box(0, 0, 50, 50)), false);
});

test('hidden, deleted, blocked, and fully locked objects are excluded', () => {
  const annotations = { objects: [
    { type: 'rect', left: 10, top: 10, width: 10, height: 10, visible: false },
    { type: 'rect', left: 20, top: 10, width: 10, height: 10, deleted: true },
    { type: 'rect', left: 30, top: 10, width: 10, height: 10, blocked: true },
    { type: 'rect', left: 40, top: 10, width: 10, height: 10,
      lockMovementX: true, lockMovementY: true,
      lockScalingX: true, lockScalingY: true, lockRotation: true },
    { type: 'rect', left: 50, top: 10, width: 10, height: 10, lockMovementX: true },
  ] };
  const result = resolveLassoHits({
    lassoPolygon: box(0, 0, 100, 100), annotations, callouts: [],
    pageWidth: 100, pageHeight: 100,
    // The renderer registry owns visibility. The hidden object is absent.
    selectableAnnotationIndices: [1, 2, 3, 4],
  });
  assert.deepEqual(result.annotationIndices, [4]);
});

test('callout adapter includes its leader, text box, and line width', () => {
  const geometry = calloutToLassoGeometry({
    id: 'c1', arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.1 }, textBoxWidth: 0.2, textBoxHeight: 0.1,
    style: { lineThickness: 6 },
  }, 100, 100);
  assert.ok(geometry.bounds.left < 10);
  assert.ok(geometry.bounds.right >= 50);
  assert.equal(isGeometryFullyInsideLasso(geometry, box(0, 0, 60, 40)), true);
  assert.equal(isGeometryFullyInsideLasso(geometry, box(12, 0, 60, 40)), false);
});

test('counter adapter follows the real bubble and nub outline', () => {
  const geometry = annotationToLassoGeometry({
    type: 'circle', left: 40, top: 40, radius: 10,
    data: { type: 'counter', pointerAngle: 0, displayNumber: 1 },
  });
  assert.equal(Math.round(geometry.bounds.left), 40);
  assert.equal(Math.round(geometry.bounds.right), 65);
  assert.equal(Math.round(geometry.bounds.top), 40);
  assert.equal(Math.round(geometry.bounds.bottom), 60);
  assert.ok(geometry.outlines[0].some((point) => point.x === 65 && point.y === 50));
});

test('group adapter applies parent scale before rotation', () => {
  const geometry = annotationToLassoGeometry({
    type: 'group', left: 10, top: 10, scaleX: 2, scaleY: 3, angle: 90,
    objects: [{ type: 'rect', left: 0, top: 0, width: 10, height: 10 }],
  });
  assert.equal(Math.round(geometry.bounds.right - geometry.bounds.left), 30);
  assert.equal(Math.round(geometry.bounds.bottom - geometry.bounds.top), 20);
});

test('adapter covers ink, highlighter, text, image, note, counter, and arrow shapes', () => {
  const cases = [
    { type: 'path', path: [['M', 10, 10], ['L', 30, 20]], stroke: '#000', strokeWidth: 3 },
    { type: 'path', tool: 'highlighter', path: [['M', 10, 10], ['L', 30, 20]], stroke: '#ff0', strokeWidth: 12 },
    { type: 'textbox', left: 10, top: 10, width: 20, height: 10, text: 'A' },
    { type: 'image', left: 10, top: 10, width: 20, height: 10 },
    { type: 'group', left: 10, top: 10, width: 20, height: 20, data: { type: 'sticky_note' } },
    { type: 'circle', left: 10, top: 10, radius: 8, data: { type: 'counter' } },
    { type: 'line', left: 10, top: 10, width: 20, height: 10, x1: -10, y1: -5, x2: 10, y2: 5, tool: 'arrow' },
  ];
  for (const annotation of cases) {
    const geometry = annotationToLassoGeometry(annotation);
    assert.ok(geometry?.outlines?.length > 0, `${annotation.tool || annotation.data?.type || annotation.type} has outline`);
  }
});
