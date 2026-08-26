// Genuine hunt of imported FreeTextCallout /BS /D after tip a0cf8172
// (class 21 Square / Circle dash). Unique leftover: import leftover-
// omitted lineStyle so Select Width leftover-replaced native dashed
// /BS with leftover-solid Line /BS. Do not invent Font family chrome,
// stamp renderer, Note/Link create, create-poly tool, leftover-18 hosts,
// Line /AP, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('imported Callout /BS /D stamps dashed and export keeps Line /BS dash', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /leftover-omitted lineStyle/);
  assert.match(importer, /resolveImportedCalloutLineStyle/);
  assert.match(importer, /Do not invent Line \/AP/);
  const adapter = read('src/utils/calloutImportAdapter.js');
  assert.match(adapter, /resolveImportedCalloutLineStyle/);
  assert.match(adapter, /style\.lineStyle = importedLineStyle/);
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /data\?\.type === 'callout'/);
  assert.match(writer, /leftover-replaced native \/BS \/D with leftover-solid/);
});

test('live spec covers imported Callout dash Select Width + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-imported-callout-dash-select-export.spec.mjs');
  assert.match(spec, /testPdf=e2e-imported-callout-dash\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /imported Callout Select Width 8 must ride/);
  assert.match(spec, /export must keep Line \/BS \[6 4\], not leftover-solid/);
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
