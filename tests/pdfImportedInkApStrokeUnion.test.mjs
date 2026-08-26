// package2 page 9 Ink /AP stroke union must not leftover-skip the page.
// Live: styledStrokeCommandsToPolygonSet → mergeStyledStrokeGeometries
// union throws martinez `Cannot read properties of undefined (reading 'depth')`
// and processPage leftover-skipped all 1520 annotations on that page.
// Distinct from leftover-18, imported FreeText /RC, Square / Circle / Polygon
// stroke /CA, imported filled Ink /CA, imported-outline Width restroke, and
// inventing a create-ink tool.
// Do not stamp file.id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('package2 page 9 Ink /AP stroke union keeps the page and imports inks', { timeout: 120_000 }, async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'package2-rev4.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const policy = imported.nativeLayerPolicyByPage?.[9];
  const objects = imported.annotationsByPage?.[9]?.objects || [];
  const inks = objects.filter((object) => object?.pdfAnnotationType === 'Ink');
  const failed = Object.values(imported.diagnosticsByPage || {})
    .flatMap((diag) => diag?.importedAnnotations || [])
    .filter((entry) => entry?.importOutcomeReason === 'page-import-failed');

  assert.ok(policy, 'page 9 policy');
  assert.notEqual(policy.reason, 'page-import-failed', 'must not leftover-skip page 9');
  assert.equal(failed.length, 0, 'must not leftover-record page-import-failed');
  assert.ok(objects.length > 0, `page 9 must import objects, got ${objects.length}`);
  assert.ok(inks.length > 0, `page 9 must import Ink, got ${inks.length}`);
  assert.ok(
    objects.some((object) => object?.pdfAnnotationId === '4357R'),
    'Square 4357R must survive the leftover Ink /AP union throw',
  );
});

test('Ink /AP stroke-union leftover stays caught at convert + page, not replayed as create-ink', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /leftover-skipped the page\. Keep the live path instead of unioning/);
  assert.match(importer, /Ink \/AP stroke union failed; keeping live path/);
  assert.match(importer, /annotation \$\{annotation\?\.id \|\| annotation\?\.name \|\| '\?'\} failed; keeping page/);
  assert.match(importer, /converter-threw/);
  assert.doesNotMatch(importer, /create-ink tool/);
  const geometry = read('src/utils/paperAnnotationGeometry.js');
  assert.match(geometry, /Martinez can throw `depth` on self-touching \/AP stroke outlines/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
