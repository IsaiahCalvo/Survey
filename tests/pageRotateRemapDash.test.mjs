import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Source contracts for remapped Style dash after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-dash.spec.mjs
// Fallback leftover after DEV query-fixture hunt found none unique.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-dash spec applies Style without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-dash.spec.mjs');
  assert.match(spec, /strokeDashArray/);
  assert.match(spec, /Dashed/);
  assert.match(spec, /Dotted/);
  assert.match(spec, /omits Cloud/);
  assert.match(spec, /Escape skip-commit does not apply/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview Style 0/);
  assert.match(spec, /pointerClickHost/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('Style patch writes [6,4] / [2,4]; SVG viewBox stays container-owned', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /else if \(next === 'dashed'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[6, 4\]/);
  assert.match(viewer, /else if \(next === 'dotted'\) \{\s*\n\s*handlePatchSelectedAnnotation\(\{ strokeDashArray: \[2, 4\]/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
