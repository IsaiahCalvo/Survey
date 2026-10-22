// Perf guard (dense-sheet drags): moved marks, the group frame and the snap
// guides draw outside the page's SVG layer while a move is live, and the moved
// marks follow the pointer through one CSS translate, so a drag frame does not
// repaint or re-raster a page layer holding hundreds of marks.
// Measured on 667 marks per sheet: raster during a 6-mark drag 2.6 s -> 0.15 s.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { liftedMoveIndices, liftTranslate } from '../src/utils/dragLift.js';

const LAYER = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('a pointer move or group move lifts its marks', () => {
  assert.deepEqual([...liftedMoveIndices({ id: 4, dx: 3, dy: 1 })], [4]);
  assert.deepEqual([...liftedMoveIndices({ id: 0, dx: 0, dy: 0 })], [0]);
  const group = new Set([1, 5, 9]);
  assert.equal(liftedMoveIndices({ id: 'group', dx: 2, dy: 2, affectedIds: group }), group);
});

test('nudges, resize, rotate, line edits, rebuilt previews and cross-page carries stay in the page layer', () => {
  for (const vt of [
    null,
    { id: 4, resize: { scaleX: 2 } },
    { id: 4, rotate: { deltaAngle: 10 } },
    { id: 4, lineEdit: {} },
    { id: 4, dx: 0, dy: 0, previewObjects: { 4: {} } },
    { id: 4, counterPointerAngle: 90 },
    { id: 4, dx: 9, dy: 0, crossPageAway: true },
    { id: 4, dx: 1, dy: 0, nudge: true },
    { id: 'group', dx: 1, dy: 1, affectedIds: new Set([1]), nudge: true },
    { id: 'group', dx: 1, dy: 1, affectedIds: new Set() },
    { id: 'callout', dx: 1, dy: 1 },
  ]) assert.equal(liftedMoveIndices(vt), null, JSON.stringify(vt));
});

test('the lift translate is in percent of the page, so the viewBox owns zoom', () => {
  assert.equal(liftTranslate({ dx: 306, dy: -198 }, 612, 792), 'translate(50%, -25%)');
  assert.equal(liftTranslate({ dx: 5, dy: 5 }, 0, 0), 'translate(0%, 0%)');
  assert.equal(liftTranslate(null, 612, 792), 'translate(0%, 0%)');
});

test('the page layer draws only the marks that are not lifted', () => {
  assert.match(LAYER, /const liftedMoveIndices = liftedMoveIndicesFor\(visualTransform\);/);
  assert.match(LAYER, /\.map\(\(element\) => cloneElement\(element, \{ transform: undefined \}\)\)/);
  assert.match(LAYER, /\{pageMarks\}/);
  assert.doesNotMatch(LAYER, /\{stackedMarks\}/);
  assert.match(LAYER, /\{!liftedMarks\.length && <SnapGuidesLayer guides=\{snapGuides\}/);
});

test('the lift layer is composited and moved by CSS only', () => {
  const start = LAYER.indexOf('data-svg-annotation-lift={pageNumber}');
  assert.ok(start > 0, 'lift layer not found');
  const block = LAYER.slice(start, start + 900);
  assert.match(block, /willChange: 'transform'/);
  assert.match(block, /transform: liftTranslate\(visualTransform, width, height\)/);
  assert.match(block, /pointerEvents: 'none'/);
  assert.match(block, /\{liftedGroupFrame\}/);
  // Never a second page layer: readPageLayers and every page lookup key on it.
  assert.doesNotMatch(block, /data-svg-annotation-layer=/);
});

test('a lifted drag still ends on the page layer', () => {
  // Lifting remounts the pressed mark, which drops the pointer capture it
  // held: the page layer takes it back, and the lift layer is inert so the
  // release never lands on a lifted copy (a counter pin's drop was lost and
  // the next Undo removed the pin).
  assert.match(LAYER, /if \(liftedMarks\.length && !e\.currentTarget\.hasPointerCapture\?\.\(e\.pointerId\)\) \{\s*try \{ e\.currentTarget\.setPointerCapture\(e\.pointerId\); \}/);
  const start = LAYER.indexOf('{liftedMarks.length > 0 && (');
  assert.match(LAYER.slice(start, start + 700), /<div\s+inert=""/);
});
