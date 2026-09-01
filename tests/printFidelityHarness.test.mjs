import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import { savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

const fixtureUrl = new URL('../debug/fixtures/print-fidelity.pdf', import.meta.url);
const manifestUrl = new URL('../debug/fixtures/print-fidelity.manifest.json', import.meta.url);
const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const createEngine = async () => {
  const wasm = await readFile(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')));
  const native = new PdfiumNative(await init({ wasmBinary: toArrayBuffer(wasm) }), { fontFallback: null });
  return new PdfEngine(native, { imageConverter: async () => { throw new Error('raw render only'); } });
};

const regionPixels = (image, bounds, pageWidth = 612, pageHeight = 792) => {
  const left = Math.max(0, Math.floor(bounds[0] * image.width / pageWidth));
  const top = Math.max(0, Math.floor(bounds[1] * image.height / pageHeight));
  const right = Math.min(image.width, Math.ceil(bounds[2] * image.width / pageWidth));
  const bottom = Math.min(image.height, Math.ceil(bounds[3] * image.height / pageHeight));
  const out = [];
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const offset = (y * image.width + x) * 4;
    out.push([image.data[offset], image.data[offset + 1], image.data[offset + 2]]);
  }
  return out;
};
const coloured = (pixels) => pixels.filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 18 && Math.min(r, g, b) < 245);
const ratio = (pixels, predicate) => pixels.filter(predicate).length / Math.max(1, pixels.length);

test('print-fidelity manifest covers every required app and native type on rotated and cropped pages', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const types = new Set(manifest.regions.map((entry) => entry.type));
  for (const required of [
    'pen', 'pen-edited', 'pen-erased', 'highlighter', 'rectangle', 'ellipse', 'line', 'arrow',
    'polygon', 'polyline', 'callout', 'textbox', 'counter', 'survey-marker', 'space', 'region',
    'highlight', 'underline', 'squiggle', 'strikethrough', 'link', 'redaction', 'native-square',
    'native-circle', 'native-polygon', 'native-ink', 'native-free-text', 'native-highlight',
    'native-cloud', 'native-arrow', 'native-strikeout', 'form-checkbox', 'form-text', 'native-stamp',
  ]) assert.ok(types.has(required), `manifest must cover ${required}`);
  assert.deepEqual(manifest.pages.map((page) => page.rotation), [0, 90, 180, 270, 0]);
  assert.deepEqual(manifest.pages[4].cropBox, [36, 72, 576, 720]);
});

test('real print flattener uses app paint for untouched imports and bakes form state', async () => {
  const source = new Uint8Array(await readFile(fixtureUrl));
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const output = await savePDFWithFlattenedRegularAnnotationsForPrint(
    { name: manifest.pdfFile, async arrayBuffer() { return toArrayBuffer(source); } },
    manifest.annotationsByPage,
    Object.fromEntries(manifest.pages.map((page) => [page.page, page.rotation === 90 || page.rotation === 270 ? { width: 792, height: 612 } : page.cropBox ? { width: 540, height: 648 } : { width: 612, height: 792 }])),
    {
      actionType: 'test-print-fidelity',
      callouts: [manifest.annotationsByPage[2].objects.find((obj) => obj.id === 'callout-1')],
      surveyMarkers: manifest.surveyMarkers,
    },
  );

  const parsed = await PDFDocument.load(output);
  const pageOneAnnots = parsed.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(pageOneAnnots?.size?.() || 0, 0, 'drawable native marks and widgets must not bypass app paint');
  const pageFourAnnots = parsed.getPage(3).node.lookup(PDFName.of('Annots'));
  assert.equal(pageFourAnnots?.size?.() || 0, 1, 'AP-only native stamp stays native until it has an app flattener');

  const engine = await createEngine();
  let doc = null;
  try {
    doc = await engine.openDocumentBuffer({ id: 'print-fidelity', content: toArrayBuffer(output) }, { normalizeRotation: false }).toPromise();
    const image = await engine.renderPageRaw(doc, doc.pages[0], { scaleFactor: 2 }).toPromise();

    const square = coloured(regionPixels(image, [335, 75, 470, 165]));
    assert.ok(square.length > 20, 'imported square must paint');
    assert.ok(ratio(square, ([r, g, b]) => r > g && r > b && g > 70) > 0.5, 'imported square must keep its pale pink app stroke');

    const strike = coloured(regionPixels(image, [325, 210, 515, 265]));
    assert.ok(ratio(strike, ([r, g, b]) => g > r * 1.25 && g > b * 1.15) > 0.5, 'native strikeout must print green, not black');

    const checkbox = regionPixels(image, [340, 282, 385, 330]);
    assert.ok(ratio(checkbox, ([r, g, b]) => b > r * 1.25 && b > g * 1.08) > 0.01, 'checked widget must contain blue checked-state paint');
    assert.ok(ratio(checkbox, ([r, g, b]) => r > 245 && g > 245 && b > 245) < 0.97, 'checked widget must not print empty');

    const textField = regionPixels(image, [385, 280, 555, 335]);
    assert.ok(ratio(textField, ([r, g, b]) => b > r * 1.2 && b > g * 1.05) > 0.003, 'text field border must use the screen blue');
    assert.ok(ratio(textField, ([r, g, b]) => r < 90 && g < 90 && b < 90) > 0.003, 'text field value must be present');
  } finally {
    if (doc) await engine.closeDocument(doc).toPromise();
    await engine.destroy();
  }
});
