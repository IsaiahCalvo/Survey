// Selected paper-ink Width must rebuild the baked filled outline.
// Live Pen / Highlighter store Width on sourceWidth, but the page / export
// paint path + polygons. Select Width used to patch leftover sourceWidth
// only, so the screen stayed the old baked width until a new stroke was
// drawn. Distinct from leftover-18, selected paper-ink Select chrome
// (fill / sourceWidth), Pen / Highlighter first-stroke persist, and C-01
// swatch / hex / Transparent apply. Do not invent a richTextEditor. Do
// not invent Line /AP. Do not stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPaperInkAnnotation } from '../src/viewerShared.js';
import {
  createProductionPaperInk,
  rebuildProductionPaperInkWidth,
} from '../src/utils/productionPaperInk.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function outlineHeight(polygons) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons || []) {
    for (const ring of polygon || []) {
      for (const point of ring || []) {
        if (!Array.isArray(point) || point.length < 2) continue;
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
      }
    }
  }
  return Number.isFinite(maxY - minY) ? maxY - minY : 0;
}

const thin = createProductionPaperInk({
  id: 'ink-width-1',
  tool: 'pen',
  points: [{ x: 10, y: 40 }, { x: 80, y: 40 }],
  color: 'rgba(255, 0, 0, 0.4)',
  width: 4,
  data: { id: 'ink-width-1' },
});

test('rebuildProductionPaperInkWidth restrokes baked polygons from sourceWidth', () => {
  assert.equal(isPaperInkAnnotation(thin), true);
  assert.equal(thin.sourceWidth, 4);
  assert.equal(thin.strokeWidth, 0);
  const thinH = outlineHeight(thin.polygons);
  assert.ok(thinH > 3 && thinH < 6, `thin outline height ${thinH}`);

  const next = rebuildProductionPaperInkWidth(thin, 20);
  assert.equal(next.sourceWidth, 20);
  assert.equal(next.strokeWidth, 0);
  assert.equal(next.stroke, 'transparent');
  const thickH = outlineHeight(next.polygons);
  assert.ok(thickH > 16, `rebuilt outline height ${thickH} must leave leftover 4`);
  assert.ok(thickH > thinH * 3, 'baked polygons must grow with Width 20');
  assert.notDeepEqual(next.path, thin.path);
  assert.ok(next.height > thin.height);
});

test('rebuildProductionPaperInkWidth skips invented centerline and eraser cuts', () => {
  assert.deepEqual(rebuildProductionPaperInkWidth({
    type: 'path',
    fill: 'rgba(255, 0, 0, 1)',
    stroke: 'transparent',
    strokeWidth: 0,
  }, 20), { sourceWidth: 20 });
  assert.deepEqual(rebuildProductionPaperInkWidth({
    ...thin,
    paperEraserGeometry: 'v1',
  }, 20), { sourceWidth: 20 });
  assert.deepEqual(rebuildProductionPaperInkWidth({
    ...thin,
    paperEraserCuts: [[[[0, 0], [1, 0], [1, 1], [0, 1]]]],
  }, 20), { sourceWidth: 20 });
});

test('Select Width patch restrokes paper-ink instead of leftover sourceWidth only', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /rebuildProductionPaperInkWidth/);
  assert.match(viewer, /isPaperInkAnnotation\(annotation\)[\s\S]*rebuildProductionPaperInkWidth\(annotation, width\)/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(next\)/);
  assert.doesNotMatch(
    viewer,
    /isPaperInkAnnotation\(annotation\) \{\s*handlePatchSelectedAnnotation\(\{ sourceWidth: width \}\)/,
  );
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
