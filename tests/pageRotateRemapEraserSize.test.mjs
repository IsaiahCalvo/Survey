import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';
import {
  eraserDiameterToScreenRadius,
} from '../src/utils/eraserSizing.js';

// Source contracts for remapped Eraser Size after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-eraser-size.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-eraser-size spec applies Size without a mouse remapper or bite', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-eraser-size.spec.mjs');
  assert.match(spec, /pickSizePreset\(page, 64\)/);
  assert.match(spec, /container-aware scale/);
  assert.match(spec, /Eraser Size is a tool pref — not undoable/);
  assert.match(spec, /letters rejected/);
  assert.match(spec, /Escape skip-commit does not apply Size/);
  assert.match(spec, /Counter Size must not rewrite Eraser Size/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview Eraser Size 0/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /eraseAlongStroke|startEraseAcrossId|data-eraser-mask-clone/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('Eraser Size is a separate 1–100 store; cursor uses container-aware scale', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setEraserSize\(Math\.min\(Math\.max\(parseInt\(value, 10\), 1\), 100\)\)/);
  assert.match(viewer, /eraserDiameterToScreenRadius\(eraserSize, scale\)/);
  const sizeHandlerAt = viewer.indexOf('const handleEraserSizeInputChange');
  const sizeHandlerEnd = viewer.indexOf('const [transferState, setTransferState]', sizeHandlerAt);
  assert.ok(sizeHandlerAt > 0 && sizeHandlerEnd > sizeHandlerAt);
  assert.doesNotMatch(viewer.slice(sizeHandlerAt, sizeHandlerEnd), /pushHistory|handleUndo/);

  const sizing = read('src/utils/eraserSizing.js');
  assert.match(sizing, /offsetWidth \/ pageWidth|effectiveScale|eraserDiameterToScreenRadius/);

  const screen = eraserDiameterToScreenRadius(64, 1.25);
  assert.ok(Number.isFinite(screen) && screen > 0);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
