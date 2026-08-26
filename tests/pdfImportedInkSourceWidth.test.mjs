// Imported filled Ink must stamp /BS/W into sourceWidth, not leftover 3.
// clickable-link-test 67R has native /BS/W 18. Filled-outline import
// leftover-omitted sourceWidth (strokeWidth stays 0) so Select Width
// leftover-stayed 3 until Width was re-touched. Distinct from leftover-18,
// imported filled Ink /CA, package2 Ink /AP stroke union, Square /
// Circle / Polygon stroke /CA, imported-outline Width restroke, and
// inventing a create-ink tool. Stamp /BS/W only — do not restroke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('imported filled Ink 67R stamps /BS/W into sourceWidth, not leftover 3', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'clickable-link-test.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const ink = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '67R');

  assert.ok(ink, 'fixture Ink 67R');
  assert.equal(ink.pdfAnnotationType, 'Ink');
  assert.equal(ink.paperInkGeometry, 'v1');
  assert.equal(ink.strokeWidth, 0, 'filled outline leftover strokeWidth stays 0');
  assert.equal(
    ink.sourceWidth,
    18,
    `sourceWidth must keep /BS/W 18, not leftover omit: ${ink.sourceWidth}`,
  );
  assert.notEqual(ink.sourceWidth, 3, 'must not leftover-omit sourceWidth so Select reads 3');
});

test('Ink converter stamps authored /BS/W into sourceWidth; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /const authoredSourceWidth = borderWidth > 0 \? borderWidth \* scale : 0;/);
  assert.match(
    importer,
    /\.\.\.\(authoredSourceWidth > 0 \? \{ sourceWidth: authoredSourceWidth \} : \{\}\)/,
  );
  assert.match(importer, /clickable-link-test 67R already has native \/BS\/W 18/);
  assert.match(importer, /Do not restroke imported outlines/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
