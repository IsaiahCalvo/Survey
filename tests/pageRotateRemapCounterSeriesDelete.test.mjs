import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Source contracts for remapped Counter series Delete after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-counter-series-delete.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-series-delete spec wipes two remapped pins without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-counter-series-delete.spec.mjs');
  assert.match(spec, /openSeriesContextDelete\(page, 2\)/);
  assert.match(spec, /Delete count/);
  assert.match(spec, /cancel invents 0/);
  assert.match(spec, /Delete with no selection invents 0/);
  assert.match(spec, /undo restores remapped series ids/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview series Delete 0/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /first\/middle\/last|delete first: remaining/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('series Delete is confirm-gated; SVG viewBox stays container-owned', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /data-counter-series-context-menu/);
  assert.match(shell, /onDeleteCounterSeries\?\.\(seriesId\)/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handleDeleteCounterSeriesFromToolbar/);
  assert.match(viewer, /onDeleteCounterSeries: handleDeleteCounterSeriesFromToolbar/);

  const confirm = read('src/components/collab/ConfirmDeleteModal.jsx');
  assert.match(confirm, /Delete count/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
