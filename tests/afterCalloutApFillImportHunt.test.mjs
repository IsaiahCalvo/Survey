// Genuine hunt of imported-fixture leftovers after callout /AP fill
// (2bbfd646). No unique LIVE leftover proved. Do not invent one.
// Do not invent Line /AP, callout Rotation, user-settable callout
// verticalAlign, a richTextEditor, leftover-18, or 13246R /AP fill
// (native /GS0 ca 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('callout /AP fill helper stays callout-only; /C is still not the box', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /getImportedCalloutAppearanceFillHex/);
  assert.match(importer, /Prefer a visible \/AP fill for callouts only/);
  assert.match(importer, /Do not fall back to \/C/);
  assert.match(importer, /isCalloutIntent \? getImportedCalloutAppearanceFillHex\(annotation\) : null/);
});

test('package2 13246R /AP box fill is native-invisible (GS0 ca 0), not a leftover', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'package2-rev4.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const freetext = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '13246R');
  assert.ok(freetext, 'fixture FreeText 13246R');
  assert.equal(freetext.backgroundColor, 'transparent');
  assert.equal(freetext.fill, '#fa3237');
  assert.equal(freetext.textAlign, 'center');
});

test('se011 4631R already keeps callout /AP fill, /LE, Width 1, /RC color', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'se011.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const callout = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '4631R');
  assert.ok(callout, 'fixture FreeTextCallout 4631R');
  assert.match(String(callout.backgroundColor), /rgba\(\s*0,\s*0,\s*0,\s*1\s*\)/);
  assert.equal(callout.fill, '#1172e8');
  assert.equal(callout.strokeWidth, 1);
  assert.equal(callout.data?.pdfCalloutStyle?.arrowheadStyle, 'openTriangle');
});

test('se011 Highlight leftover /Rect pad stays ~2pt; not leftover-wide', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'se011.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const highlight = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '4636R');
  assert.ok(highlight, 'fixture Highlight 4636R');
  assert.match(String(highlight.fill), /rgba\(\s*255,\s*98,\s*0,\s*0\.399994\s*\)/);
  assert.ok(Math.abs(Number(highlight.width) - 358.186) < 0.5);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
