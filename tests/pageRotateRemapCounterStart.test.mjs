import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Source contracts for remapped Counter Start after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-counter-start.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-counter-start spec applies Start without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-counter-start.spec.mjs');
  assert.match(spec, /setStart\(page, 10\)/);
  assert.match(spec, /letters strip then commit 1/);
  assert.match(spec, /Escape skip-commit does not apply Start/);
  assert.match(spec, /Size must not rewrite Start/);
  assert.match(spec, /Start must not rewrite Size/);
  assert.match(spec, /series continuity after remapped Start 7/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview Counter Start 0/);
  assert.match(spec, /pointerClickHost/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('Counter Start is a lone-series 1+ store; SVG viewBox stays container-owned', () => {
  const field = read('src/components/CounterStartNumberField.jsx');
  assert.match(field, /aria-label="Counter start number"/);
  assert.match(field, /skipCommitRef/);
  assert.match(field, /replace\(\/\[\^0-9\]\/g, ''\)/);
  assert.match(field, /Math\.max\(1, Math\.floor\(Number\(event\.currentTarget\.value\) \|\| 1\)\)/);

  const viewer = read('src/PDFViewer.jsx');
  const startAt = viewer.indexOf('const handleSelectedCounterSeriesStartChange');
  const startEnd = viewer.indexOf('const handleStrokeColorChange', startAt);
  assert.ok(startAt > 0 && startEnd > startAt);
  const startHandler = viewer.slice(startAt, startEnd);
  assert.match(startHandler, /seriesStart: parsed/);
  assert.match(startHandler, /if \(\(series\?\.count \|\| 0\) !== 1\) return/);
  assert.match(startHandler, /handleCounterGroupUpdateRef/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
