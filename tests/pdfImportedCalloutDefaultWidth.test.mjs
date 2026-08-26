// Imported FreeTextCallout must keep native default Width 1, not leftover 2.
// se011 4631R has no /BS /W and /AP paints no `w` (PDF default 1pt).
// Import leftover-used fallback 0 so the adapter kept leftover
// defaultCalloutStyle.lineThickness 2 until Width was re-touched.
// Distinct from leftover-18, imported FreeTextCallout /LE OpenArrow,
// imported FreeText /RC color, FreeText /DS align, Square / Circle /
// Polygon stroke /CA, imported filled Ink /CA + sourceWidth, package2
// Ink /AP stroke union, imported-outline Width restroke, inventing
// Line /AP, and inventing a user-settable callout verticalAlign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { splitImportedCalloutsFromPage } from '../src/utils/calloutImportAdapter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const makeViewport = ({ pageHeight = 792 } = {}) => ({
  width: 1224,
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x, pageHeight - y],
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

test('imported FreeTextCallout missing /BS/W stamps Width 1, not leftover 2', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '4631R',
    subtype: 'FreeText',
    rect: [454.371, 313.399, 712.733, 463.248],
    contents: 'wetrheynetrynrthrtwhwrth',
    color: [0, 0, 0],
    intent: 'FreeTextCallout',
    calloutLine: [454.599, 462.884, 592.233, 349.509, 604.233, 349.509],
    lineEndings: ['OpenArrow'],
    defaultAppearanceString: '0.5882 0.2627 0.9882 rg /Helv 12 Tf',
    defaultStyleString: 'font: Helvetica,sans-serif 12.0pt; text-align:left; color:#9643FC',
    richContent: '<?xml version="1.0"?><body style="color:#1272E8"><span style="color:#1172E8">wetrheynetrynrthrtwhwrth</span></body>',
  }, makeViewport());

  assert.equal(obj.type, 'textbox');
  assert.equal(obj.data?.pdfCalloutStyle?.strokeWidth, 1);
  assert.notEqual(obj.data?.pdfCalloutStyle?.strokeWidth, 2);

  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 3, 1224, 792);
  assert.equal(calloutEntries.length, 1);
  assert.equal(calloutEntries[0].style.lineThickness, 1);
  assert.notEqual(calloutEntries[0].style.lineThickness, 2);
});

test('plain FreeText missing /BS/W stays borderless; callout leftover 0 becomes 1', () => {
  const plain = convertPdfAnnotationToFabric({
    id: 'plainR',
    subtype: 'FreeText',
    rect: [100, 100, 200, 140],
    contents: 'Hello',
    defaultAppearanceString: '/Helv 12 Tf 0 0 0 rg',
  }, makeViewport());
  assert.equal(plain.strokeWidth, 0);

  const leftoverZero = convertPdfAnnotationToFabric({
    id: 'zeroR',
    subtype: 'FreeText',
    rect: [100, 100, 200, 140],
    contents: 'Hello',
    intent: 'FreeTextCallout',
    calloutLine: [80, 120, 100, 120],
    borderWidth: 0,
    borderStyle: { width: 0 },
    defaultAppearanceString: '/Helv 12 Tf 0 0 0 rg',
  }, makeViewport());
  assert.equal(leftoverZero.data?.pdfCalloutStyle?.strokeWidth, 1);
  const { calloutEntries } = splitImportedCalloutsFromPage([leftoverZero], 1, 612, 792);
  assert.equal(calloutEntries[0]?.style?.lineThickness, 1);
});

test('imported se011 FreeTextCallout 4631R keeps native default Width 1', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'se011.pdf'));
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
    .find((object) => object?.pdfAnnotationId === '4631R');

  assert.ok(freetext, 'fixture FreeText 4631R');
  assert.equal(freetext.pdfAnnotationType, 'FreeText');
  assert.equal(
    freetext.data?.pdfCalloutStyle?.strokeWidth,
    1,
    `pdfCalloutStyle must keep native default 1: ${freetext.data?.pdfCalloutStyle?.strokeWidth}`,
  );
  assert.notEqual(freetext.data?.pdfCalloutStyle?.strokeWidth, 2);

  const { calloutEntries } = splitImportedCalloutsFromPage([freetext], 3, 1224, 792);
  assert.equal(calloutEntries[0]?.style?.lineThickness, 1);
  assert.notEqual(calloutEntries[0]?.style?.lineThickness, 2);
});

test('callout missing-width source stays dedicated; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /isCalloutIntent \? 1 : 0/);
  assert.match(importer, /allowExplicitZero: !isCalloutIntent/);
  assert.match(importer, /se011 4631R has no \/BS \/W and \/AP paints no `w`/);
  const adapter = read('src/utils/calloutImportAdapter.js');
  assert.match(adapter, /style\.lineThickness = pdfStyle\.strokeWidth/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
