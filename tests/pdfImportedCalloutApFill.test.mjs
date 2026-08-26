// Imported FreeTextCallout must keep native /AP box fill, not leftover transparent.
// se011 4631R has no /IC, but /AP paints the box with `0 g` + `B` (black fill).
// Import leftover-required /IC so the adapter leftover-painted fillOpacity 0
// until Fill was re-touched. Distinct from leftover-18, imported FreeTextCallout
// missing /BS/W Width, /LE OpenArrow, imported FreeText /RC color, FreeText
// /DS align, Square / Circle / Polygon stroke /CA, imported filled Ink /CA +
// sourceWidth, package2 Ink /AP stroke union, imported-outline Width restroke,
// inventing Line /AP, and inventing a user-settable callout verticalAlign.
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

const calloutBase = {
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
};

test('imported FreeTextCallout /AP fill stamps black box, not leftover transparent', () => {
  const obj = convertPdfAnnotationToFabric({
    ...calloutBase,
    _appearance: {
      hasFill: true,
      fillColor: [0, 0, 0],
      paintOperations: [{ fill: true, fillAlpha: 1, fillColor: [0, 0, 0] }],
    },
  }, makeViewport());

  assert.equal(obj.type, 'textbox');
  assert.match(String(obj.backgroundColor), /rgba\(\s*0,\s*0,\s*0,\s*1\s*\)/);
  assert.notEqual(obj.backgroundColor, 'transparent');
  assert.match(String(obj.data?.pdfCalloutStyle?.backgroundColor), /rgba\(\s*0,\s*0,\s*0,\s*1\s*\)/);

  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 3, 1224, 792);
  assert.equal(calloutEntries.length, 1);
  assert.equal(calloutEntries[0].style.fillColor, '#000000');
  assert.equal(calloutEntries[0].style.fillOpacity, 1);
  assert.notEqual(calloutEntries[0].style.fillOpacity, 0);
});

test('callout without /IC and without /AP fill stays clear; /C is not the box', () => {
  const obj = convertPdfAnnotationToFabric(calloutBase, makeViewport());
  assert.equal(obj.backgroundColor, 'transparent');
  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 3, 1224, 792);
  assert.equal(calloutEntries[0]?.style?.fillOpacity, 0);
});

test('plain FreeText still ignores /AP fill fallback (callout-only)', () => {
  const plain = convertPdfAnnotationToFabric({
    id: 'plainR',
    subtype: 'FreeText',
    rect: [100, 100, 200, 140],
    contents: 'Hello',
    defaultAppearanceString: '/Helv 16 Tf 0.98 0.2 0.22 rg',
    _appearance: {
      hasFill: true,
      fillColor: [0, 0, 0],
      paintOperations: [{ fill: true, fillAlpha: 1, fillColor: [0, 0, 0] }],
    },
  }, makeViewport());
  assert.equal(plain.strokeWidth, 0);
  assert.equal(plain.backgroundColor, 'transparent');
});

test('imported se011 FreeTextCallout 4631R keeps /AP black fill, not leftover transparent', async (t) => {
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
  assert.match(
    String(freetext.backgroundColor),
    /rgba\(\s*0,\s*0,\s*0,\s*1\s*\)/,
    `backgroundColor must keep /AP black fill: ${freetext.backgroundColor}`,
  );
  assert.notEqual(freetext.backgroundColor, 'transparent');

  const { calloutEntries } = splitImportedCalloutsFromPage([freetext], 3, 1224, 792);
  assert.equal(calloutEntries[0]?.style?.fillColor, '#000000');
  assert.equal(calloutEntries[0]?.style?.fillOpacity, 1);
  assert.notEqual(calloutEntries[0]?.style?.fillOpacity, 0);
});

test('callout /AP fill source stays dedicated; leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /getImportedCalloutAppearanceFillHex/);
  assert.match(importer, /se011 4631R has no \/IC, but \/AP paints the box/);
  assert.match(importer, /Do not fall back to \/C/);
  const adapter = read('src/utils/calloutImportAdapter.js');
  assert.match(adapter, /style\.fillColor = `#\$\{toHex\(r\)\}/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
