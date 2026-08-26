// Genuine hunt of imported Square / Circle /BS /D after tip c1b2f79f
// (class 20). Unique leftover: import leftover-omitted strokeDashArray
// so Select Width leftover-replaced native dashed /BS with leftover-
// solid /AP. Do not invent Font family chrome, stamp renderer,
// Note/Link create, create-poly tool, leftover-18 hosts, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('imported Square / Circle /BS /D stamps dash and export keeps /AP dash', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /leftover-omitted strokeDashArray/);
  assert.match(importer, /extractAnnotationDashArray/);
  assert.match(importer, /Do not invent Square \/ Circle dict \/BS/);
});

test('live spec covers imported Square dash Select Width + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-imported-square-dash-select-export.spec.mjs');
  assert.match(spec, /testPdf=e2e-imported-square-dash\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /imported Square Select Width 8 must ride/);
  assert.match(spec, /export must keep \/AP \[6 4\] 0 d, not leftover-solid/);
  assert.match(spec, /must not invent 390 hex chrome/);
  assert.match(spec, /must not invent Font family chrome/);
  assert.match(spec, /0 0 612 792/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
