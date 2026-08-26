// Selected-callout Color swatch must stamp Fill / Border Opacity as-is.
// Live Color Fill / Border already offer 0–100 (field min 0). Page view /
// spec / PAL already stamp 0–1, but PDFViewer selectedPreviewColors used
// Math.max(..., 0.08) / Math.max(..., 0.2) so a selected Fill of 0–7 or
// Border of 0–19 painted a ghost 8% / 20% swatch until the picker was
// re-touched. Distinct from leftover-18, callout Fill / Border Opacity
// screen floors, and C-01 swatch / hex / Transparent apply. Do not invent
// a floor of 0.08 or 0.2.
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
    fill: composeColorForPatch(style.fillColor || '#ffffff', borderOpacity * fillOpacityValue * 100),
  };
}

test('selected-callout toolbar swatch no longer floors Fill 0.08 or Border 0.2', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /borderOpacity = Math\.max\(0, Math\.min\(1, Number\(style\.borderOpacity \?\? 1\)\)\)/);
  assert.match(viewer, /fillOpacityValue = Math\.max\(0, Math\.min\(1, Number\(style\.fillOpacity \?\? 0\.4\)\)\)/);
  assert.doesNotMatch(viewer, /borderOpacity = Math\.max\(0\.2/);
  assert.doesNotMatch(viewer, /fillOpacityValue = Math\.max\(0\.08/);
});

test('selected swatch paints user-set Fill 5 and Border 10; missing still defaults', () => {
  assert.equal(
    selectedCalloutPreview({ fillColor: '#FFFFFF', fillOpacity: 0.05, borderColor: '#FF0000', borderOpacity: 1 }).fill,
    'rgba(255, 255, 255, 0.05)',
  );
  assert.equal(
    selectedCalloutPreview({ fillColor: '#FFFFFF', fillOpacity: 0.05, borderColor: '#FF0000', borderOpacity: 1 }).stroke,
    'rgba(255, 0, 0, 1)',
  );
  assert.equal(
    selectedCalloutPreview({ fillColor: '#FFFFFF', fillOpacity: 0.9, borderColor: '#FF0000', borderOpacity: 0.10 }).stroke,
    'rgba(255, 0, 0, 0.1)',
  );
  assert.equal(
    selectedCalloutPreview({ fillColor: '#FFFFFF', fillOpacity: 0, borderColor: '#FF0000', borderOpacity: 0 }).stroke,
    'rgba(255, 0, 0, 0)',
  );
  assert.equal(
    selectedCalloutPreview({ fillColor: '#FFFFFF', fillOpacity: 0.19, borderColor: '#FF0000', borderOpacity: 0.19 }).stroke,
    'rgba(255, 0, 0, 0.19)',
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
