import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  buildPrintableRegularAnnotationPayload,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

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
const medianChannel = (pixels, channel) => {
  const values = pixels.map((pixel) => pixel[channel]).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : 0;
};
const colouredSlope = (image, bounds, predicate, pageWidth, pageHeight) => {
  const left = Math.max(0, Math.floor(bounds[0] * image.width / pageWidth));
  const top = Math.max(0, Math.floor(bounds[1] * image.height / pageHeight));
  const right = Math.min(image.width, Math.ceil(bounds[2] * image.width / pageWidth));
  const bottom = Math.min(image.height, Math.ceil(bounds[3] * image.height / pageHeight));
  const points = [];
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const offset = (y * image.width + x) * 4;
    const pixel = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    if (predicate(pixel)) points.push({ x, y });
  }
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length);
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length);
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return { count: points.length, slope: covariance / Math.max(1, varianceX) };
};

test('print-fidelity manifest covers every required app and native type on rotated and cropped pages', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const types = new Set(manifest.regions.map((entry) => entry.type));
  for (const required of [
    'pen', 'pen-edited', 'pen-erased', 'highlighter', 'rectangle', 'ellipse', 'line', 'arrow',
    'polygon', 'polyline', 'callout', 'textbox', 'counter', 'survey-marker', 'space', 'region',
    'highlight', 'underline', 'squiggle', 'strikethrough', 'link', 'redaction', 'native-square',
    'native-circle', 'native-polygon', 'native-ink', 'native-free-text', 'native-highlight',
    'native-cloud', 'native-arrow', 'native-strikeout', 'form-checkbox', 'form-text', 'native-stamp',
    'landscape-page',
  ]) assert.ok(types.has(required), `manifest must cover ${required}`);
  assert.deepEqual(manifest.pages.map((page) => page.rotation), [0, 90, 180, 270, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    manifest.pages.at(-1),
    { page: 11, rotation: 0, width: 792, height: 612 },
  );
  assert.deepEqual(manifest.pages[4].cropBox, [36, 72, 576, 720]);
  assert.equal(manifest.pages[5].requiresSurveyMode, true);
});

test('print payload emits a callout leader once when by-page state has its projected copy', () => {
  const callout = { id: 'callout-1', pageNumber: 1 };
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: { objects: [{ id: 'callout-1', type: 'group', data: { id: 'callout-1', type: 'callout' }, objects: [{ type: 'line' }] }] },
    },
    callouts: [callout],
  });
  assert.equal(payload.callouts.length, 1);
  assert.equal(payload.annotationsByPage[1], undefined, 'projected callout must not enter the fabric print pass');
});

test('real print flattener uses app paint for untouched imports and bakes form state', async () => {
  const source = new Uint8Array(await readFile(fixtureUrl));
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const importedHighlight = manifest.annotationsByPage[3].objects.find((obj) => obj.id === 'imported-native-highlight');
  importedHighlight.pdfAnnotationId = 'annot_p2_999';
  delete importedHighlight.pdfNativeAnnotationIdentity;
  if (importedHighlight.data) delete importedHighlight.data.pdfNativeAnnotationIdentity;
  const output = await savePDFWithFlattenedRegularAnnotationsForPrint(
    { name: manifest.pdfFile, async arrayBuffer() { return toArrayBuffer(source); } },
    manifest.annotationsByPage,
    Object.fromEntries(manifest.pages.map((page) => [page.page, page.cropBox
      ? { width: 540, height: 648 }
      : page.rotation === 90 || page.rotation === 270
        ? { width: page.height, height: page.width }
        : { width: page.width, height: page.height }])),
    {
      actionType: 'test-print-fidelity',
      callouts: manifest.callouts,
      surveyMarkers: manifest.surveyMarkers,
    },
  );

  const parsed = await PDFDocument.load(output);
  const pageOneAnnots = parsed.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(pageOneAnnots?.size?.() || 0, 0, 'drawable native marks and widgets must not bypass app paint');
  const importedPageAnnots = parsed.getPage(2).node.lookup(PDFName.of('Annots'));
  assert.equal(importedPageAnnots?.size?.() || 0, 0, 'runtime-id native highlight must not paint over its translucent app copy');
  const stampPageAnnots = parsed.getPage(7).node.lookup(PDFName.of('Annots'));
  assert.equal(stampPageAnnots?.size?.() || 0, 0, 'stamp proxy must flatten before its native original is removed');

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
    // Widgets print with their own /MK colours (black fallback), not the screen's blue chrome.
    assert.ok(ratio(checkbox, ([r, g, b]) => r < 90 && g < 90 && b < 90) > 0.01, 'checked widget must contain dark checked-state paint');
    assert.ok(ratio(checkbox, ([r, g, b]) => r > 245 && g > 245 && b > 245) < 0.97, 'checked widget must not print empty');

    const textField = regionPixels(image, [385, 280, 555, 335]);
    assert.ok(ratio(textField, ([r, g, b]) => r < 235 || g < 235 || b < 235) > 0.01, 'text field must print its own /MK border, not the screen chrome');
    assert.ok(ratio(textField, ([r, g, b]) => r < 90 && g < 90 && b < 90) > 0.003, 'text field value must be present');

    const highlighterRoundCap = regionPixels(image, [30, 246, 40, 264]);
    assert.ok(
      ratio(highlighterRoundCap, ([r, g, b]) => r > 200 && g > 150 && b < 180) > 0.08,
      'round-capped screen highlighter must not flatten with a square cap',
    );

    const textPage = await engine.renderPageRaw(doc, doc.pages[1], { scaleFactor: 2 }).toPromise();
    const textSlope = colouredSlope(
      textPage,
      [45, 60, 315, 175],
      ([r, g, b]) => b > 120 && r > 60 && r > g * 1.2,
      792,
      612,
    );
    assert.ok(textSlope.count > 100, 'formatted text must paint');
    assert.ok(Math.abs(textSlope.slope) > 0.05, `formatted text must keep its rotation, slope=${textSlope.slope}`);

    const textbox = regionPixels(textPage, [45, 50, 315, 165], 792, 612);
    assert.ok(
      ratio(textbox, ([r, g, b]) => r > 225 && g > 195 && b < 205) > 0.08,
      'textbox must print its pale fill',
    );
    assert.ok(
      ratio(textbox, ([r, g, b]) => b > g * 1.45 && b > r * 1.25) > 0.006,
      'textbox must print its violet border and text',
    );

    const counter = regionPixels(textPage, [350, 90, 394, 134], 792, 612);
    assert.ok(
      ratio(counter, ([r, g, b]) => r > 180 && r > g * 1.8 && r > b * 1.8) > 0.25,
      'counter must print its red pin body',
    );
    assert.ok(
      ratio(counter, ([r, g, b]) => r > 245 && g > 245 && b > 245) > 0.01,
      'counter must print a white number inside the pin',
    );

    const importedPage = await engine.renderPageRaw(doc, doc.pages[2], { scaleFactor: 2 }).toPromise();
    // Page 3 is /Rotate 180: the seeded highlight sits where the viewer shows it.
    const highlight = regionPixels(importedPage, [37, 432, 297, 492]);
    const yellow = highlight.filter(([r, g, b]) => r > 200 && g > 130 && b < 245);
    assert.ok(yellow.length > 100, 'imported highlight must paint');
    assert.ok(medianChannel(yellow, 2) > 90, 'imported highlight must stay translucent, not opaque yellow');
    assert.ok(ratio(highlight, ([r, g, b]) => r < 80 && g < 80 && b < 80) < 0.002, 'imported highlight must stay borderless');

    const stampPage = await engine.renderPageRaw(doc, doc.pages[7], { scaleFactor: 2 }).toPromise();
    const stamp = regionPixels(stampPage, [100, 210, 270, 315]);
    assert.ok(
      ratio(stamp, ([r, g, b]) => r > 180 && r > g * 2 && r > b * 2) > 0.02,
      'flattened stamp PNG must keep the red native appearance',
    );

    const resources = parsed.getPage(2).node.lookup(PDFName.of('Resources'), PDFDict);
    const pageFonts = resources?.lookup(PDFName.of('Font'), PDFDict);
    const baseFonts = pageFonts?.keys?.().map((key) => {
      const fontDict = pageFonts.lookup(key, PDFDict);
      return String(fontDict?.get(PDFName.of('BaseFont')) || '');
    }) || [];
    assert.ok(baseFonts.some((name) => name.includes('Times-Roman')), `imported FreeText must use Times-Roman: ${baseFonts.join(', ')}`);
  } finally {
    if (doc) await engine.closeDocument(doc).toPromise();
    await engine.destroy();
  }
});
