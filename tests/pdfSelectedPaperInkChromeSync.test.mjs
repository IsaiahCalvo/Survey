// Selected paper-ink Color / Opacity / Width must stay as-is after Select.
// Live Pen / Highlighter store Color on fill and Width on sourceWidth.
// leftover stroke is 'transparent' and leftover strokeWidth is 0, so Select
// used to keep the sibling tool's Color / Opacity / Width until the picker
// was re-touched, and Color patches wrote leftover stroke so the screen
// stayed the old fill. Distinct from leftover-18, selected-shape Fill
// Opacity 0 sync, Pen / Highlighter first-stroke persist, and C-01 swatch
// / hex / Transparent apply. Do not invent a richTextEditor. Do not invent
// Line /AP. Do not stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPaperInkAnnotation } from '../src/viewerShared.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const paperInk = createProductionPaperInk({
  id: 'ink-1',
  tool: 'pen',
  points: [{ x: 10, y: 10 }, { x: 40, y: 18 }],
  color: 'rgba(255, 0, 0, 0.4)',
  width: 4,
  data: { id: 'ink-1' },
});

test('isPaperInkAnnotation keeps live Pen fill + sourceWidth (not leftover stroke)', () => {
  assert.equal(paperInk.type, 'path');
  assert.equal(paperInk.stroke, 'transparent');
  assert.equal(paperInk.strokeWidth, 0);
  assert.equal(paperInk.sourceWidth, 4);
  assert.match(String(paperInk.fill), /rgba\(255,\s*0,\s*0,\s*0\.4\)/);
  assert.equal(isPaperInkAnnotation(paperInk), true);
});

test('isPaperInkAnnotation rejects stroked shapes / leftover-empty fill', () => {
  assert.equal(isPaperInkAnnotation({
    type: 'line',
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 2,
  }), false);
  assert.equal(isPaperInkAnnotation({
    type: 'rect',
    fill: 'rgba(255, 255, 255, 0)',
    stroke: 'rgba(255, 0, 0, 1)',
    strokeWidth: 2,
  }), false);
  assert.equal(isPaperInkAnnotation({
    type: 'path',
    fill: 'transparent',
    stroke: 'rgba(0, 0, 255, 0.4)',
    strokeWidth: 2,
  }), false);
  assert.equal(isPaperInkAnnotation(null), false);
});

test('Select chrome + Color patch read paper-ink fill / sourceWidth', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /isPaperInkAnnotation/);
  assert.match(viewer, /paperInk \? annot\.fill : annot\.stroke/);
  assert.match(viewer, /paperInk \? Number\(annot\.sourceWidth\) : Number\(annot\.strokeWidth\)/);
  assert.match(viewer, /isPaperInkAnnotation\(annotation\)[\s\S]*handlePatchSelectedAnnotation\(\{ fill: rgba \}\)/);
  assert.match(viewer, /isPaperInkAnnotation\(annotation\)[\s\S]*handlePatchSelectedAnnotation\(\{ sourceWidth: width \}\)/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
