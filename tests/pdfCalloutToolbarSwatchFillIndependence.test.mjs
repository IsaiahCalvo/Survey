// Selected-callout Color Fill swatch must stay independent of Border.
// Live Color Fill / Border already offer 0–100 and persist / export /
// flatten / page view already honor the 0–1 values, but selectedPreviewColors
// multiplied leftover Border into Fill so a Fill of 90 + Border of 10
// painted the Fill disc at 9% until Fill was re-touched. Distinct from
// leftover-18, selected-callout swatch floor 0.08 / 0.2, callout Fill /
// Border Opacity screen floors, and C-01 swatch / hex / Transparent apply.
// Do not invent a floor of 0.08 or 0.2. Do not stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function selectedCalloutPreview(style = {}) {
  const borderOpacity = Math.max(0, Math.min(1, Number(style.borderOpacity ?? 1)));
  const fillOpacityValue = Math.max(0, Math.min(1, Number(style.fillOpacity ?? 0.4)));
  return {
    stroke: composeColorForPatch(style.borderColor || '#1e293b', borderOpacity * 100),
    fill: composeColorForPatch(style.fillColor || '#ffffff', fillOpacityValue * 100),
  };
}

test('selected-callout Fill swatch no longer multiplies leftover Border', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /fill: effectivePreviewColor\(fill, fillOpacityValue\)/);
  assert.doesNotMatch(viewer, /borderOpacity \* fillOpacityValue/);
});

test('selected swatch paints Fill 90 with Border 10 as-is; missing still defaults', () => {
  assert.equal(
    selectedCalloutPreview({
      fillColor: '#FFFFFF',
      fillOpacity: 0.9,
      borderColor: '#FF0000',
      borderOpacity: 0.10,
    }).fill,
    'rgba(255, 255, 255, 0.9)',
  );
  assert.equal(
    selectedCalloutPreview({
      fillColor: '#FFFFFF',
      fillOpacity: 0.9,
      borderColor: '#FF0000',
      borderOpacity: 0.10,
    }).stroke,
    'rgba(255, 0, 0, 0.1)',
  );
  assert.notEqual(
    selectedCalloutPreview({
      fillColor: '#FFFFFF',
      fillOpacity: 0.9,
      borderColor: '#FF0000',
      borderOpacity: 0.10,
    }).fill,
    'rgba(255, 255, 255, 0.09)',
  );
  assert.equal(
    selectedCalloutPreview({
      fillColor: '#FFFFFF',
      fillOpacity: 0.05,
      borderColor: '#FF0000',
      borderOpacity: 1,
    }).fill,
    'rgba(255, 255, 255, 0.05)',
  );

  const missing = selectedCalloutPreview({ fillColor: '#FFFFFF', borderColor: '#FF0000' });
  assert.equal(missing.fill, 'rgba(255, 255, 255, 0.4)');
  assert.equal(missing.stroke, 'rgba(255, 0, 0, 1)');
});

test('Color picker minOpacity stays 0; do not invent a floor of 0.08 or 0.2', () => {
  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /minOpacity = 0/);
  const catalog = read('src/utils/annotationStyleCatalog.js');
  assert.match(catalog, /export function clampOpacityPercent\(raw, minOpacity = 0\)/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
