// 390 mobile stroke Color Opacity must leave 100 on rect / ellipse /
// rect-mapped imported polygons. Live probe proved slider min=100 and
// typing 40 stayed 100. Distinct from leftover-18, desktop AppShell
// Border minOpacity 0 (2161fa7f), Polygon /BS /CA (28f352f4), and C-03
// Line stroke continuum. Do not invent a create-poly tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clampOpacityPercent } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('clampOpacityPercent(40, 0) is 40; the old 390 floor of 1 locked 40 at 100', () => {
  assert.equal(clampOpacityPercent(40, 0), 40);
  assert.equal(clampOpacityPercent(0, 0), 0);
  assert.equal(clampOpacityPercent(40, 1), 100);
  assert.equal(clampOpacityPercent(0, 1), 100);
});

test('390 stroke picker minOpacity is 0; one-visible stays the onChange bump', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /minOpacity: 0/);
  assert.doesNotMatch(mobile, /minOpacity:\s*1/);
  assert.match(mobile, /live fade never reached persist/);
  assert.match(mobile, /One-visible is the onChange bump/);
  assert.match(
    mobile,
    /tool === 'rect' \|\| tool === 'ellipse'\) && next <= 0 && \(api\.fillOpacity/,
  );
  assert.match(
    mobile,
    /tool === 'rect' \|\| tool === 'ellipse'\) && next <= 0 && \(api\.strokeOpacity/,
  );
  assert.match(mobile, /firstPreset: \{ kind: 'match', color: toHexColor\(api\.fillColor/);
  assert.doesNotMatch(mobile, /value: 'polygon'|label: 'Polygon'/);
});

test('desktop AppShell Border minOpacity stays 0; one-visible bump unchanged', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /minOpacity=\{0\}/);
  assert.match(shell, /live fade never reached persist \/ Polygon \/CA/);
  assert.match(shell, /shapeOneVisibleRule && alpha <= 0 && otherAlpha <= 0/);
  assert.doesNotMatch(shell, /minOpacity=\{\(shapeOneVisibleRule && !onFillTab\) \? 1 : 0\}/);
});

test('390 stroke leftover host still names the contract; isolated 8448 / 75/250 standing', () => {
  const spec = read('debug/scenarios/e2e-mobile-stroke-min-opacity.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /390 rect Border Opacity can leave 100/);
  assert.match(spec, /390 imported polygon Border Opacity can leave 100/);
  assert.match(spec, /slider min must be 0/);
  assert.match(spec, /hubPreview Open stroke color picker must be 0/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /value: 'polygon'|label: 'Polygon'/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
