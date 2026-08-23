import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Source contracts for remapped Cloud bump after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-cloud-bump.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-cloud-bump spec applies Cloud + bump without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-cloud-bump.spec.mjs');
  assert.match(spec, /pdfCloudIntensity/);
  assert.match(spec, /Cloud bump size/);
  assert.match(spec, /setBump\(page, 8\)/);
  assert.match(spec, /omits Cloud/);
  assert.match(spec, /letters rejected/);
  assert.match(spec, /0→1 clamp/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /hubPreview Cloud bump 0/);
  assert.match(spec, /pointerClickHost/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
});

test('Cloud bump clamps 1–20; SVG viewBox stays container-owned', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /aria-label="Cloud bump size"/);
  assert.match(shell, /Math\.max\(1, Math\.min\(20, parseInt\(raw, 10\)\)\)/);
  assert.match(shell, /contextTool === 'rect' && bottomToolbarApi\.lineBorderStyle === 'cloud'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{\s*\n\s*strokeDashArray: null,\s*\n\s*data: \{ pdfCloudIntensity:/);
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ data: \{ pdfCloudIntensity: Math\.max\(1, Number\(next\) \|\| 2\) \} \}\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
});
