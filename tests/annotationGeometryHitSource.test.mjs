import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerAnnotationHitSource,
  getAnnotationHitSource,
  resolveGeometryHitAtPagePoint,
} from '../src/utils/annotationGeometryHitSource.js';

const PAGE = { pageWidth: 612, pageHeight: 792 };

const filledRect = (left, top, width, height, extra = {}) => ({
  type: 'rect',
  left,
  top,
  width,
  height,
  fill: '#ff0000',
  stroke: 'transparent',
  strokeWidth: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  ...extra,
});

test('registry: register, get, unregister', () => {
  const source = () => null;
  const unregister = registerAnnotationHitSource(3, source);
  assert.equal(getAnnotationHitSource(3), source);
  assert.equal(getAnnotationHitSource('3'), source);
  unregister();
  assert.equal(getAnnotationHitSource(3), null);
});

test('registry: unregister does not clobber a newer registration', () => {
  const first = () => null;
  const second = () => null;
  const unregisterFirst = registerAnnotationHitSource(4, first);
  registerAnnotationHitSource(4, second);
  unregisterFirst();
  assert.equal(getAnnotationHitSource(4), second);
  registerAnnotationHitSource(4, second)();
});

test('filled rect hits inside, misses outside', () => {
  const data = { ...PAGE, items: [{ obj: filledRect(100, 100, 50, 40), index: 0 }], callouts: [] };
  assert.deepEqual(resolveGeometryHitAtPagePoint({ x: 120, y: 120 }, data, 3), { annotationIndex: 0 });
  assert.equal(resolveGeometryHitAtPagePoint({ x: 300, y: 300 }, data, 3), null);
});

test('topmost (higher index) annotation wins on overlap', () => {
  const data = {
    ...PAGE,
    items: [
      { obj: filledRect(100, 100, 100, 100), index: 2 },
      { obj: filledRect(150, 150, 100, 100), index: 7 },
    ],
    callouts: [],
  };
  assert.deepEqual(resolveGeometryHitAtPagePoint({ x: 175, y: 175 }, data, 3), { annotationIndex: 7 });
  assert.deepEqual(resolveGeometryHitAtPagePoint({ x: 110, y: 110 }, data, 3), { annotationIndex: 2 });
});

test('stroke-only rect does not hit from its empty center', () => {
  const obj = filledRect(100, 100, 200, 200, { fill: 'transparent', stroke: '#000', strokeWidth: 2 });
  const data = { ...PAGE, items: [{ obj, index: 1 }], callouts: [] };
  assert.equal(resolveGeometryHitAtPagePoint({ x: 200, y: 200 }, data, 3), null);
  assert.deepEqual(resolveGeometryHitAtPagePoint({ x: 100, y: 200 }, data, 3), { annotationIndex: 1 });
});

test('filled outline path (canvas-presentation ink) hits inside the fill', () => {
  const obj = {
    type: 'path',
    left: 50,
    top: 50,
    width: 20,
    height: 20,
    // App convention (same one marqueeSelection relies on): a path point p
    // lands on canvas at left + (p - pathOffset).
    pathOffset: { x: 0, y: 0 },
    path: [['M', 0, 0], ['L', 20, 0], ['L', 20, 20], ['L', 0, 20], ['Z']],
    fill: '#0000ff',
    stroke: 'none',
    strokeWidth: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  };
  const data = { ...PAGE, items: [{ obj, index: 5 }], callouts: [] };
  assert.deepEqual(resolveGeometryHitAtPagePoint({ x: 60, y: 60 }, data, 3), { annotationIndex: 5 });
  assert.equal(resolveGeometryHitAtPagePoint({ x: 200, y: 400 }, data, 3), null);
});

const callout = (id) => ({
  id,
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.1 },
  knee: { x: 0.3, y: 0.1 },
  textBoxPosition: { x: 0.5, y: 0.05 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.1,
  style: { lineThickness: 2 },
});

test('callout hits on textbox and on arrow segment, not on empty bbox space', () => {
  const data = { ...PAGE, items: [], callouts: [callout('c-1')] };
  // Inside the textbox (0.5..0.7 x, 0.05..0.15 y in page units)
  assert.deepEqual(
    resolveGeometryHitAtPagePoint({ x: 0.6 * 612, y: 0.1 * 792 }, data, 3),
    { calloutId: 'c-1' },
  );
  // On the arrowTip→knee segment (y = 0.1 * 792, x between 0.1 and 0.3)
  assert.deepEqual(
    resolveGeometryHitAtPagePoint({ x: 0.2 * 612, y: 0.1 * 792 }, data, 3),
    { calloutId: 'c-1' },
  );
  // Inside the overall bbox but far from both the segments and the box:
  // deep below the arrow line, left of the textbox.
  assert.equal(
    resolveGeometryHitAtPagePoint({ x: 0.35 * 612, y: 0.45 * 792 }, data, 3),
    null,
  );
});

test('callout beats an annotation underneath (painter draws callouts on top)', () => {
  const under = filledRect(0.55 * 612, 0.06 * 792, 60, 60);
  const data = { ...PAGE, items: [{ obj: under, index: 0 }], callouts: [callout('c-2')] };
  assert.deepEqual(
    resolveGeometryHitAtPagePoint({ x: 0.6 * 612, y: 0.1 * 792 }, data, 3),
    { calloutId: 'c-2' },
  );
});

test('null/malformed entries are skipped without throwing', () => {
  const data = {
    ...PAGE,
    items: [null, { obj: null, index: 1 }, { obj: filledRect(10, 10, 10, 10), index: 'x' }],
    callouts: [null, { id: null }],
  };
  assert.equal(resolveGeometryHitAtPagePoint({ x: 15, y: 15 }, data, 3), null);
  assert.equal(resolveGeometryHitAtPagePoint({ x: 15, y: 15 }, null, 3), null);
});
