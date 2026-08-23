import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTER_SIZE_MAX,
  COUNTER_SIZE_MIN,
} from '../src/utils/annotationSize.js';
import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Source contracts for remapped Counter Size after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-counter-size.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-counter-size spec applies Size without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-counter-size.spec.mjs');
  assert.match(spec, /pickSizePreset\(page, 32\)/);
  assert.match(spec, /3→4 clamp/);
  assert.match(spec, /Escape skip-commit does not apply Size/);
  assert.match(spec, /Eraser Size must not rewrite remapped Counter/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview Counter Size 0/);
  assert.match(spec, /pointerClickHost/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('Counter Size clamps 4–76; SVG viewBox stays container-owned', () => {
  assert.equal(COUNTER_SIZE_MIN, 4);
  assert.equal(COUNTER_SIZE_MAX, 76);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const isCounterSize = activeTool === 'counter' \|\| getSelectedShapeMeta\(\)\.isCounter/);
  assert.match(viewer, /const minWidth = isCounterSize \? COUNTER_SIZE_MIN : 1/);
  assert.match(viewer, /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
