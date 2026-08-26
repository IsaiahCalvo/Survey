// Selected-shape / textbox / path Color Fill / Border sync must keep
// rgba alpha 0. Live Color Fill / Border already offer 0–100 (field min 0).
// Persist / export / flatten / page view already stamp rgba(..., 0), but
// getOpacityFromEntityColor treated match[4] "0" as missing (falsy) so
// Select synced Fill / Border Opacity to 100 until the picker was
// re-touched. Distinct from leftover-18, selected-callout Color swatch
// floors, callout Fill / Border screen floors, and C-01 swatch / hex /
// Transparent apply. Do not invent a floor of 0 → 100.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOpacityFromEntityColor } from '../src/viewerShared.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('getOpacityFromEntityColor keeps rgba alpha 0 (does not invent 100)', () => {
  assert.equal(getOpacityFromEntityColor('rgba(255, 255, 255, 0)'), 0);
  assert.equal(getOpacityFromEntityColor('rgba(255, 0, 0, 0)'), 0);
  assert.equal(getOpacityFromEntityColor('rgba(255,255,255,0)'), 0);
});

test('getOpacityFromEntityColor keeps user-set 5 / 40 / 100; hex still 100', () => {
  assert.equal(getOpacityFromEntityColor('rgba(255, 255, 255, 0.05)'), 5);
  assert.equal(getOpacityFromEntityColor('rgba(255, 0, 0, 0.4)'), 40);
  assert.equal(getOpacityFromEntityColor('rgba(0, 0, 0, 1)'), 100);
  assert.equal(getOpacityFromEntityColor('#ffffff'), 100);
  assert.equal(getOpacityFromEntityColor('transparent'), 100);
  assert.equal(getOpacityFromEntityColor(''), 100);
});

test('Select sync still reads getOpacityFromEntityColor; no falsy-zero match[4]', () => {
  const shared = read('src/viewerShared.js');
  assert.match(shared, /match\[4\] != null && match\[4\] !== ''/);
  assert.doesNotMatch(shared, /if \(match && match\[4\]\) \{/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /getOpacityFromEntityColor\(fillSource\)/);
  assert.match(viewer, /getOpacityFromEntityColor\(strokeSource\)/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
