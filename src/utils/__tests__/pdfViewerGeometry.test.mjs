import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsMatch } from '../pdfViewerGeometry.js';

test('boundsMatch: identical bounds match', () => {
  const b = { x: 10, y: 20, width: 100, height: 50 };
  assert.equal(boundsMatch(b, { ...b }), true);
});

test('boundsMatch: null/undefined inputs never match', () => {
  const b = { x: 10, y: 20, width: 100, height: 50 };
  assert.equal(boundsMatch(null, b), false);
  assert.equal(boundsMatch(b, undefined), false);
  assert.equal(boundsMatch(null, null), false);
});

test('boundsMatch: within default tolerance (<5) matches, at/above does not', () => {
  const base = { x: 10, y: 20, width: 100, height: 50 };
  // 4.9px drift on x stays under the 5px tolerance
  assert.equal(boundsMatch(base, { x: 14.9, y: 20, width: 100, height: 50 }), true);
  // 5px drift on x is NOT < tolerance -> fails
  assert.equal(boundsMatch(base, { x: 15, y: 20, width: 100, height: 50 }), false);
});

test('boundsMatch: each dimension is checked independently', () => {
  const base = { x: 100, y: 100, width: 200, height: 200 };
  assert.equal(boundsMatch(base, { x: 100, y: 199, width: 200, height: 200 }), false, 'y drift caught');
  assert.equal(boundsMatch(base, { x: 100, y: 100, width: 400, height: 200 }), false, 'width drift caught');
  assert.equal(boundsMatch(base, { x: 100, y: 100, width: 200, height: 400 }), false, 'height drift caught');
});

test('boundsMatch: left/top/right/bottom shape is equivalent to x/y/width/height', () => {
  // {left:10,top:20,right:110,bottom:70} == {x:10,y:20,width:100,height:50}
  const rect = { left: 10, top: 20, right: 110, bottom: 70 };
  const xywh = { x: 10, y: 20, width: 100, height: 50 };
  assert.equal(boundsMatch(rect, xywh), true);
});

test('boundsMatch: custom tolerance is honored', () => {
  const base = { x: 100, y: 100, width: 10, height: 10 };
  const drifted = { x: 108, y: 100, width: 10, height: 10 };
  assert.equal(boundsMatch(base, drifted, 5), false, '8px drift fails at tolerance 5');
  assert.equal(boundsMatch(base, drifted, 10), true, '8px drift passes at tolerance 10');
});

test('boundsMatch: documents the 0-coordinate ||-fallback quirk (preserved verbatim)', () => {
  // The original helper uses `bounds.x || bounds.left`, so a literal 0 is falsy and
  // falls back to the (undefined) left/top field -> NaN -> no match. This is a real
  // quirk of the extracted-verbatim code; asserting it here flags any future change.
  const atOrigin = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(boundsMatch(atOrigin, { ...atOrigin }), false, 'x:0/y:0 hits the ||-fallback (0->undefined left) and does not match');
  // Asymmetric: the left/top shape at origin DOES match, because x is undefined so
  // `x || left` resolves to left's 0 (undefined is falsy, 0 is the fallback value).
  const originRect = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(boundsMatch(originRect, { ...originRect }), true, 'left:0/top:0 matches (undefined x falls back to 0)');
});
