// Imported FreeText text color must keep /RC, not leftover /DS.
// se011 4631R has /RC #1172E8 and /DS #9643FC; convertFreeText preferred
// leftover /DS so the callout painted purple until Color was re-touched.
// Distinct from leftover-18, imported Ink/Polygon/PolyLine dash+opacity
// export, Square / Circle / Polygon stroke /CA, imported filled Ink /CA,
// imported-outline Width restroke, and inventing a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

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

function normalizeHex(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!rgb) return text;
  const hex = (value) => Math.max(0, Math.min(255, Math.round(Number(value))))
    .toString(16)
    .padStart(2, '0');
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
}

test('imported FreeText keeps /RC text color independent of leftover /DS', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '4631R',
    subtype: 'FreeText',
    rect: [454.371, 313.399, 712.733, 463.248],
    contents: 'wetrheynetrynrthrtwhwrth',
    color: [0, 0, 0],
    intent: 'FreeTextCallout',
    calloutLine: [454.599, 462.884, 592.233, 349.509, 604.233, 349.509],
    defaultAppearanceString: '0.5882 0.2627 0.9882 rg /Helv 12 Tf',
    defaultStyleString: 'font: Helvetica,sans-serif 12.0pt; text-align:left; color:#9643FC',
    richContent: '<?xml version="1.0"?><body style="color:#1272E8"><span style="color:#1172E8">wetrheynetrynrthrtwhwrth</span></body>',
  }, makeViewport());

  assert.equal(obj.type, 'textbox');
  assert.equal(obj.pdfAnnotationType, 'FreeText');
  const fill = normalizeHex(obj.fill);
  const styleColor = normalizeHex(obj.data?.pdfCalloutStyle?.textColor);
  assert.equal(fill, '#1172e8', `fill must keep /RC, not leftover /DS: ${obj.fill}`);
  assert.equal(styleColor, '#1172e8', `pdfCalloutStyle must keep /RC: ${obj.data?.pdfCalloutStyle?.textColor}`);
  assert.notEqual(fill, '#9643fc', 'must not leftover-paint /DS purple');
});

test('imported se011 FreeText 4631R keeps /RC blue, not leftover /DS purple', async (t) => {
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
  const fill = normalizeHex(freetext.fill);
  const styleColor = normalizeHex(freetext.data?.pdfCalloutStyle?.textColor);
  assert.equal(fill, '#1172e8', `fill must keep /RC ~#1172E8, not leftover /DS: ${freetext.fill}`);
  assert.equal(styleColor, '#1172e8', `pdfCalloutStyle must keep /RC: ${freetext.data?.pdfCalloutStyle?.textColor}`);
  assert.notEqual(fill, '#9643fc');
});

test('FreeText converter prefers /RC over leftover /DS; export leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /const parsedRc = parseRichContentFirstColor\(annotation\.richContent\);/);
  assert.match(
    importer,
    /const textColor = rcColorHex\s*\|\|\s*dsColorHex\s*\|\|\s*daColorHex/,
  );
  assert.match(importer, /\.\.\.\(rcText \? \{ richContent: rcText \} : \{\}\),/);
  assert.doesNotMatch(importer, /create-ink tool/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
