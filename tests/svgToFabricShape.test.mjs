/**
 * Phase 19 — AutoCAD Window + Crossing Selection
 * Adapter test: SVG-layer annotations and SVG callouts feed the existing
 * `doesRectIntersectObject` dispatcher without modifying the geometry library.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFabricShape } from '../src/utils/svgToFabricShape.js';

test('rect annotation: passes Fabric-style fields through', () => {
  const ann = {
    type: 'rect',
    left: 10,
    top: 20,
    width: 50,
    height: 40,
    strokeWidth: 2,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'rect');
  assert.equal(shape.left, 10);
  assert.equal(shape.top, 20);
  assert.equal(shape.width, 50);
  assert.equal(shape.height, 40);
  assert.equal(shape.strokeWidth, 2);
});

test('rect annotation: missing strokeWidth defaults to 0', () => {
  const ann = { type: 'rect', left: 0, top: 0, width: 10, height: 10 };
  const shape = toFabricShape(ann);
  assert.equal(shape.strokeWidth, 0);
});

test('circle annotation: passes radius + center fields through', () => {
  const ann = { type: 'circle', left: 100, top: 100, radius: 25, strokeWidth: 1 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'circle');
  assert.equal(shape.radius, 25);
});

test('ellipse annotation: preserves rx/ry', () => {
  const ann = { type: 'ellipse', left: 0, top: 0, rx: 30, ry: 10 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'ellipse');
  assert.equal(shape.rx, 30);
  assert.equal(shape.ry, 10);
});

test('line annotation: preserves endpoint fields', () => {
  const ann = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 50, strokeWidth: 1 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'line');
  assert.equal(shape.x1, 0);
  assert.equal(shape.y1, 0);
  assert.equal(shape.x2, 100);
  assert.equal(shape.y2, 50);
});

test('polyline annotation: preserves points array', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
  const ann = { type: 'polyline', points, strokeWidth: 2 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'polyline');
  assert.deepEqual(shape.points, points);
});

test('polygon annotation: preserves polygon type and points for fill-aware hit testing', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
  const ann = { type: 'polygon', points, strokeWidth: 2 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'polygon');
  assert.deepEqual(shape.points, points);
});

test('polygon annotation: degenerate (<=2 points) remains polygon', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  const ann = { type: 'polygon', points };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'polygon');
  assert.deepEqual(shape.points, points);
});

test('textbox annotation: preserves width/height', () => {
  const ann = { type: 'textbox', left: 5, top: 5, width: 100, height: 20, text: 'hi' };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'textbox');
  assert.equal(shape.width, 100);
});

test('path annotation: preserves path + strokeWidth', () => {
  const path = [['M', 0, 0], ['L', 10, 10]];
  const ann = {
    type: 'path',
    path,
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    strokeWidth: 3,
  };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'path');
  assert.equal(shape.strokeWidth, 3);
  assert.deepEqual(shape.path, path);
});

test('group annotation (arrow): preserves nested objects + transform', () => {
  const ann = {
    type: 'group',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    objects: [{ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
  };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'group');
  assert.ok(Array.isArray(shape.objects));
  assert.equal(shape.objects.length, 1);
});

test('triangle annotation: preserves width + height', () => {
  const ann = { type: 'triangle', left: 0, top: 0, width: 40, height: 30 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'triangle');
  assert.equal(shape.width, 40);
  assert.equal(shape.height, 30);
});

test('unknown type: falls back to rect signature derived from bbox', () => {
  const ann = { type: 'weird', left: 5, top: 5, width: 10, height: 10 };
  const shape = toFabricShape(ann);
  assert.equal(shape.type, 'rect');
  assert.equal(shape.left, 5);
  assert.equal(shape.width, 10);
});

test('callout kind: builds axis-aligned rect covering arrowTip + knee + textbox', () => {
  const callout = {
    id: 'c1',
    arrowTip: { x: 0.2, y: 0.3 },
    knee: { x: 0.25, y: 0.35 },
    textBoxPosition: { x: 0.3, y: 0.3 },
    textBoxWidth: 0.1,
    textBoxHeight: 0.05,
  };
  const shape = toFabricShape(callout, { pageWidth: 1000, pageHeight: 800, kind: 'callout' });
  assert.equal(shape.type, 'rect');
  // x anchors: 0.2, 0.25, 0.3, 0.4  => scaled 200, 250, 300, 400
  // y anchors: 0.3, 0.35, 0.3, 0.35 => scaled 240, 280, 240, 280
  assert.equal(shape.left, 200);
  assert.equal(shape.top, 240);
  assert.equal(shape.width, 200);
  assert.equal(shape.height, 40);
});

test('callout kind: strokeWidth is zero (bbox approximation, no outline)', () => {
  const callout = {
    id: 'c2',
    arrowTip: { x: 0, y: 0 },
    knee: { x: 0, y: 0 },
    textBoxPosition: { x: 0, y: 0 },
    textBoxWidth: 0.1,
    textBoxHeight: 0.1,
  };
  const shape = toFabricShape(callout, { pageWidth: 100, pageHeight: 100, kind: 'callout' });
  assert.equal(shape.strokeWidth, 0);
});

test('does not mutate the input annotation', () => {
  const ann = { type: 'rect', left: 1, top: 2, width: 3, height: 4 };
  const frozen = Object.freeze(ann);
  const shape = toFabricShape(frozen);
  assert.notEqual(shape, frozen); // new object
  assert.equal(shape.left, 1);
});
