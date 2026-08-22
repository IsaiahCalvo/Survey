import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getEraserOperation } from '../src/utils/eraserPolicy.js';

// Source contracts for D-03 / D-04 leftover: Eraser type
// (Partial erase vs Full stroke erase). Live proof:
// debug/scenarios/e2e-eraser-type.spec.mjs
// Distinct from D-04 Size presets, leftover-18, and the 96 proved IDs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Eraser type catalog is Partial / Full stroke; Shift+E forces partial', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /label="Eraser type"/);
  assert.match(shell, /dataMarker="data-eraser-type-menu"/);
  assert.match(shell, /\{ value: 'partial', label: 'Partial erase' \}/);
  assert.match(shell, /\{ value: 'entire', label: 'Full stroke erase' \}/);
  assert.match(shell, /onSelect=\{bottomToolbarApi\.setEraserMode\}/);
  assert.match(shell, /bottomToolbarApi\.activeTool === 'eraser' && bottomToolbarApi\.setEraserMode/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /localStorage\.getItem\('eraserMode'\)/);
  assert.match(viewer, /localStorage\.setItem\('eraserMode', eraserMode\)/);
  assert.match(viewer, /setActiveTool\('eraser'\);\s+return;/);
  assert.match(viewer, /setEraserMode\('partial'\);/);
  assert.match(viewer, /data-eraser-caret-button=\{isEraser \? 'true' : undefined\}/);
  assert.match(viewer, /data-eraser-caret-popup=\{isEraser \? 'true' : undefined\}/);
  assert.match(viewer, /setEraserMode\('entire'\);/);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /ariaLabel="Eraser mode"/);
  assert.match(mobile, /\{ value: 'partial', label: 'Partial Erase' \}/);
  assert.match(mobile, /\{ value: 'entire', label: 'Full Stroke' \}/);
  assert.match(mobile, /onChange=\{\(value\) => api\.setEraserMode\(value\)\}/);
});

test('partial skips non-ink; entire is the object-delete mode', () => {
  const rect = { type: 'rect', left: 10, top: 10, width: 40, height: 20 };
  const ink = { type: 'path', tool: 'pen', path: [['M', 0, 0], ['L', 20, 20]], stroke: '#111', strokeWidth: 4 };
  assert.equal(getEraserOperation(rect, 'partial'), 'skip');
  assert.equal(getEraserOperation(ink, 'partial'), 'partial');
  assert.equal(getEraserOperation(rect, 'entire'), 'entire');
  assert.equal(getEraserOperation(ink, 'entire'), 'entire');
});

test('live spec covers type catalog, skip/delete, E vs Shift+E, 390, hub, file.id', () => {
  const spec = read('debug/scenarios/e2e-eraser-type.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Eraser type intended \+ break \+ edge/);
  assert.match(spec, /390 Eraser mode intended \+ break \+ edge/);
  assert.match(spec, /activateTool\(page, 'Draw', 'Eraser'\)/);
  assert.match(spec, /annotation-dropdown__heading/);
  assert.match(spec, /desktop Eraser type catalog/);
  assert.match(spec, /partial must skip a rect/);
  assert.match(spec, /partial must bite ink/);
  assert.match(spec, /full stroke must delete rect A/);
  assert.match(spec, /full stroke isolates rect B/);
  assert.match(spec, /Pen hides Eraser type/);
  assert.match(spec, /Select hides Eraser type/);
  assert.match(spec, /Shift\+E forces Partial erase/);
  assert.match(spec, /zoom % INPUT does not steal E/);
  assert.match(spec, /data-eraser-caret-popup/);
  assert.match(spec, /data-diag-eraser-wrapper/);
  assert.match(spec, /eraseThroughRegion/);
  assert.match(spec, /function mobileEraserMode/);
  assert.match(spec, /undo restores rect A/);
  assert.match(spec, /hubPreview Eraser type must be 0/);
  assert.match(spec, /Eraser mode: Partial Erase/);
  assert.match(spec, /Eraser mode: Full Stroke/);
  assert.match(spec, /390 partial must skip a rect/);
  assert.match(spec, /390 full stroke must delete the rect/);
  assert.match(spec, /0 0 612 792/);
  assert.match(spec, /Do not stamp/);
  assert.match(spec, /file\.id/);

  const size = read('debug/scenarios/e2e-eraser-size-presets.spec.mjs');
  assert.match(size, /ERASER_PRESETS/);
  assert.doesNotMatch(size, /Shift\+E forces Partial erase/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
