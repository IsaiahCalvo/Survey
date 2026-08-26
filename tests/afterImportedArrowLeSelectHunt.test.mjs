// Genuine hunt of imported Arrow /LE after tip 3b5bbbc4 (class 19).
// Unique leftover: imported Line /LE OpenArrow leftover-omitted
// arrowheadStyle so Select Width leftover-remapped export /LE to
// ClosedArrow. Do not invent Font family chrome, stamp renderer,
// Note/Link create, create-poly tool, leftover-18 hosts, or stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('imported Arrow /LE OpenArrow stamps openTriangle and export keeps /LE', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /importedArrowheadStyle/);
  assert.match(importer, /resolveImportedCalloutArrowheadStyle/);
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /resolveImportedPdfLineEndingStyle/);
  assert.match(writer, /Select Width remapped native \/LE OpenArrow/);
  assert.match(writer, /Do not invent Line \/AP/);
});

test('live spec covers imported Arrow /LE Select Width + hub + 390 + file.id', () => {
  const spec = read('debug/scenarios/e2e-imported-arrow-le-select-export.spec.mjs');
  assert.match(spec, /testPdf=e2e-imported-arrow-le\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /imported Arrow Select Width 8 must ride/);
  assert.match(spec, /export must keep \/LE OpenArrow, not leftover ClosedArrow/);
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
