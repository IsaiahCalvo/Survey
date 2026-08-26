// Imported FreeTextCallout must keep /LE, not leftover solidTriangle.
// se011 4631R has native /LE OpenArrow. Import leftover-omitted that
// ending so the callout leader leftover-painted solidTriangle until
// Arrowhead was re-touched. Distinct from leftover-18, imported FreeText
// /RC color, FreeText /DS align, Square / Circle / Polygon stroke /CA,
// imported filled Ink /CA + sourceWidth, package2 Ink /AP stroke union,
// imported-outline Width restroke, inventing Line /AP, and inventing a
// user-settable callout verticalAlign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  resolveImportedCalloutArrowheadStyle,
  splitImportedCalloutsFromPage,
} from '../src/utils/calloutImportAdapter.js';

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

test('imported FreeTextCallout /LE OpenArrow stamps openTriangle, not leftover solidTriangle', () => {
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
  assert.deepEqual(obj.data?.pdfLineEndings, ['OpenArrow', 'None']);
  assert.equal(obj.data?.pdfCalloutStyle?.arrowheadStyle, 'openTriangle');
  assert.notEqual(obj.data?.pdfCalloutStyle?.arrowheadStyle, 'solidTriangle');

  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 3, 1224, 792);
  assert.equal(calloutEntries.length, 1);
  assert.equal(calloutEntries[0].style.arrowheadStyle, 'openTriangle');
});

test('imported se011 FreeTextCallout 4631R keeps /LE OpenArrow as openTriangle', async (t) => {
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
    freetext.data?.pdfLineEndings?.[0],
    'OpenArrow',
    `pdfLineEndings must keep /LE OpenArrow: ${JSON.stringify(freetext.data?.pdfLineEndings)}`,
  );
  assert.equal(freetext.data?.pdfCalloutStyle?.arrowheadStyle, 'openTriangle');
  assert.notEqual(freetext.data?.pdfCalloutStyle?.arrowheadStyle, 'solidTriangle');

  const { calloutEntries } = splitImportedCalloutsFromPage([freetext], 3, 1224, 792);
  assert.equal(calloutEntries[0]?.style?.arrowheadStyle, 'openTriangle');
});

test('callout /LE resolver maps tip OpenArrow; leftovers stay untouched', () => {
  assert.equal(resolveImportedCalloutArrowheadStyle(['OpenArrow', 'None']), 'openTriangle');
  assert.equal(resolveImportedCalloutArrowheadStyle(['None', 'ClosedArrow']), 'solidTriangle');
  assert.equal(resolveImportedCalloutArrowheadStyle(['None', 'None']), 'none');
  assert.equal(resolveImportedCalloutArrowheadStyle(null), null);

  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /const lineEndings = isCalloutIntent/);
  assert.match(importer, /\.\.\.\(lineEndings \? \{ pdfLineEndings: lineEndings \} : \{\}\)/);
  assert.match(importer, /se011 4631R already has native \/LE OpenArrow/);
  const adapter = read('src/utils/calloutImportAdapter.js');
  assert.match(adapter, /resolveImportedCalloutArrowheadStyle/);
  assert.match(adapter, /style\.arrowheadStyle = importedHead/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
