import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';
import {
  eraserDiameterToPageRadius,
  eraserDiameterToScreenRadius,
} from '../src/utils/eraserSizing.js';

// Source contracts for Eraser Size catalog (1–100, 11 presets + custom field).
// Distinct from D-05 stroke Width ([1,2,3,4,6,8,10,12,16,20,32,50], 1–50)
// and from Counter Size ([5,8,12,16,24,32,48,64], 4–76).
// Live proof: debug/scenarios/e2e-eraser-size-presets.spec.mjs

const ERASER_PRESETS = [1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Eraser Size catalog is 11 discrete presets, 1–100, not Width or Counter', () => {
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /eraser: \[1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100\]/);
  assert.match(size, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);
  assert.match(size, /counter: \[5, 8, 12, 16, 24, 32, 48, 64\]/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /ANNOTATION_SIZE_PRESETS\.eraser/);
  assert.match(shell, /activeTool === 'eraser'\s*\n\s*\? 100/);
  assert.match(shell, /contextTool === 'counter' \|\| bottomToolbarApi\.activeTool === 'eraser' \? 'Size' : 'Width'/);
  assert.match(shell, /activeTool === 'eraser' \? bottomToolbarApi\.eraserSizeInputValue : bottomToolbarApi\.strokeWidthInputValue/);
  assert.match(shell, /handleEraserSizeInputChange/);
  assert.match(shell, /handleStrokeWidthInputChange/);
  assert.doesNotMatch(shell, /type="range"[^>]*eraser/i);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /ANNOTATION_SIZE_PRESETS\.eraser/);
  assert.match(mobile, /isEraser \? 100/);
  assert.match(mobile, /isEraser \|\| tool === 'counter' \? 'Size' : 'Width'/);

  for (const n of ERASER_PRESETS) {
    assert.equal(normalizeAnnotationSize(n, 1, 100), n);
  }
  assert.equal(normalizeAnnotationSize(0, 1, 100), 1);
  assert.equal(normalizeAnnotationSize(999, 1, 100), 100);
  assert.equal(normalizeAnnotationSize('abc', 1, 100), 1);
  assert.equal(sanitizeAnnotationSizeDraft('40'), '40');
  assert.equal(sanitizeAnnotationSizeDraft('abc'), null);
  assert.equal(sanitizeAnnotationSizeDraft('12.5'), null);
});

test('eraser diameter is page-space; screen radius uses displayScale, not pageSize*scale', () => {
  assert.equal(eraserDiameterToPageRadius(1), 0.5);
  assert.equal(eraserDiameterToPageRadius(100), 50);
  assert.equal(eraserDiameterToScreenRadius(24, 1), 12);
  assert.equal(eraserDiameterToScreenRadius(24, 0.84), 10.08);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setEraserSize\(Math\.min\(Math\.max\(parseInt\(value, 10\), 1\), 100\)\)/);
  assert.match(viewer, /const clamped = Math\.min\(Math\.max\(parsed, 1\), 100\)/);
  assert.match(viewer, /viewerScale=\{layerScale\}/);
  assert.match(viewer, /eraserSize=\{eraserSize\}/);
  assert.match(viewer, /zoomGeneration=\{zoomGeneration\}/);

  const fabric = read('src/components/FabricEraserCanvas.jsx');
  assert.match(fabric, /eraserDiameterToPageRadius\(eraserSizeRef\.current\)/);
  assert.match(fabric, /const diameter = Math\.max\(1, Number\(eraserSizeRef\.current\) \|\| 20\) \* displayScale/);
  assert.match(fabric, /data-eraser-cursor="true"/);
  assert.match(fabric, /zoomGeneration/);
  assert.doesNotMatch(fabric, /pageSize\.width \* scale/);
});
