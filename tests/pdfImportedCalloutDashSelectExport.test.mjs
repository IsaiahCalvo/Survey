// Imported FreeTextCallout /BS /S /D must re-export Line /BS dash after
// Select Width. Import leftover-omitted lineStyle so the adapter leftover-
// painted solid; Select Width then leftover-replaced native dashed /BS
// with leftover-solid Line /BS. Distinct from leftover-18, Square / Circle
// dash (class 21), imported Line / Poly dash (class 18/19), imported
// Callout /LE OpenArrow, and inventing Line /AP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  resolveImportedCalloutLineStyle,
  splitImportedCalloutsFromPage,
} from '../src/utils/calloutImportAdapter.js';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const makeViewport = ({ pageHeight = 792 } = {}) => ({
  width: 612,
  height: pageHeight,
  convertToViewportPoint: (x, y) => [x, pageHeight - y],
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

function importDashedCallout() {
  return convertPdfAnnotationToFabric({
    id: '5R',
    subtype: 'FreeText',
    rect: [220, 430, 380, 530],
    contents: 'e2e imported callout dash',
    color: [0.8, 0.15, 0.15],
    interiorColor: [1, 1, 1],
    intent: 'FreeTextCallout',
    calloutLine: [80, 420, 160, 480, 220, 480],
    lineEndings: ['OpenArrow', 'None'],
    borderStyle: { width: 3, style: 'D', dashArray: [6, 4] },
    borderStyleType: 'D',
    borderDashArray: [6, 4],
    defaultAppearanceString: '0.8 0.15 0.15 rg /Helv 12 Tf',
  }, makeViewport());
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  return {
    name: 'imported-callout-dash-select-export-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function readBsDash(dict) {
  const bsRef = dict.get(PDFName.of('BS'));
  if (!bsRef) return null;
  const bs = (typeof bsRef.get === 'function') ? bsRef : dict.context?.lookup?.(bsRef);
  if (!bs || typeof bs.get !== 'function') return null;
  const style = bs.get(PDFName.of('S'));
  const dash = bs.get(PDFName.of('D'));
  const width = bs.get(PDFName.of('W'));
  return {
    style: style?.decodeText ? style.decodeText() : String(style || ''),
    dash: dash?.asArray?.()?.map((n) => (n?.asNumber ? n.asNumber() : Number(n))) || null,
    width: width?.asNumber ? width.asNumber() : Number(width),
  };
}

test('imported FreeTextCallout /BS /D stamps dashed, not leftover solid', () => {
  const obj = importDashedCallout();
  assert.equal(obj.type, 'textbox');
  assert.equal(obj.data?.pdfIntent, 'FreeTextCallout');
  assert.equal(obj.data?.pdfCalloutStyle?.lineStyle, 'dashed');
  assert.deepEqual(obj.data?.pdfCalloutStyle?.strokeDashArray, [6, 4]);
  assert.notEqual(obj.data?.pdfCalloutStyle?.lineStyle, 'solid');

  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 1, 612, 792);
  assert.equal(calloutEntries.length, 1);
  assert.equal(calloutEntries[0].style.lineStyle, 'dashed');
});

test('imported FreeTextCallout pdf.js style 2 stamps dashed, not leftover solid', () => {
  const obj = convertPdfAnnotationToFabric({
    id: '6R',
    subtype: 'FreeText',
    rect: [220, 430, 380, 530],
    contents: 'style-2 dashed callout',
    color: [0.8, 0.15, 0.15],
    intent: 'FreeTextCallout',
    calloutLine: [80, 420, 160, 480, 220, 480],
    borderStyle: { width: 3, style: 2, dashArray: [6, 4] },
    defaultAppearanceString: '0.8 0.15 0.15 rg /Helv 12 Tf',
  }, makeViewport());
  assert.equal(obj.data?.pdfCalloutStyle?.lineStyle, 'dashed');
  const { calloutEntries } = splitImportedCalloutsFromPage([obj], 1, 612, 792);
  assert.equal(calloutEntries[0]?.style?.lineStyle, 'dashed');
});

test('fixture FreeTextCallout import via pdf.js stamps dashed, not leftover solid', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'e2e-imported-callout-dash.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const objects = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || []);
  const callout = objects.find((object) => (
    object?.data?.pdfIntent === 'FreeTextCallout'
    || object?.pdfAnnotationType === 'FreeText'
  ));
  assert.ok(callout, 'fixture FreeTextCallout');
  assert.equal(
    callout.data?.pdfCalloutStyle?.lineStyle,
    'dashed',
    `Callout leftover-solid: ${JSON.stringify(callout.data?.pdfCalloutStyle)}`,
  );
  const { calloutEntries } = splitImportedCalloutsFromPage([callout], 1, 612, 792);
  assert.equal(calloutEntries[0]?.style?.lineStyle, 'dashed');
});

test('edited imported dashed Callout export keeps Line /BS [6 4] + Width 8', async () => {
  const imported = importDashedCallout();
  const { calloutEntries } = splitImportedCalloutsFromPage([imported], 1, 612, 792);
  const entry = {
    ...calloutEntries[0],
    // Unedited imported copies preserve native /BS. Select Width is the
    // edited-replacement path — drop provenance so the stamped dashed
    // lineStyle is what the writer emits (same as live edited export).
    isPdfImported: false,
    pdfAnnotationId: null,
    style: {
      ...calloutEntries[0].style,
      lineThickness: 8,
    },
  };
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    { 1: { width: 612, height: 792 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'imported-callout-dash-select', callouts: [entry] },
  );
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const lines = annots.asArray()
    .map((ref) => doc.context.lookup(ref))
    .filter((dict) => String(dict.get(PDFName.of('Subtype'))?.decodeText?.() || '').replace(/^\//, '') === 'Line');
  assert.ok(lines.length >= 2, 'callout must export two Line pieces');
  for (const line of lines) {
    const bs = readBsDash(line);
    assert.ok(bs, 'Select Width must keep Line /BS dash, not leftover-solid');
    assert.equal(bs.style, 'D');
    assert.deepEqual(bs.dash, [6, 4]);
    assert.equal(bs.width, 8);
  }
});

test('edited imported callout group is not leftover-mapped to a solid Line', () => {
  const imported = importDashedCallout();
  const { calloutEntries } = splitImportedCalloutsFromPage([imported], 1, 612, 792);
  const entry = {
    ...calloutEntries[0],
    style: { ...calloutEntries[0].style, lineThickness: 8 },
    isPdfImported: true,
    pdfAnnotationId: '5R',
    pdfImportedEditState: 'edited',
  };
  const group = calloutToAnnotationObject(entry, { width: 612, height: 792 });
  group.pdfImportedEditState = 'edited';
  group.data = { ...(group.data || {}), pdfImportedEditState: 'edited' };
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: { 1: { objects: [group] } },
    pageSizes: { 1: { width: 612, height: 792 } },
  });
  const exported = plan.items || [];
  assert.equal(
    exported.filter((item) => item.type === 'line' || item.fabricType === 'line').length,
    0,
    'callout group must not leftover-export as Line',
  );
});

test('importer stamps Callout /BS /D; do not invent Line /AP leftover', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /leftover-omitted lineStyle/);
  assert.match(importer, /Do not invent Line \/AP/);
  assert.match(importer, /resolveImportedCalloutLineStyle/);
  const adapter = read('src/utils/calloutImportAdapter.js');
  assert.match(adapter, /style\.lineStyle = importedLineStyle/);
  assert.equal(resolveImportedCalloutLineStyle([6, 4]), 'dashed');
  assert.equal(resolveImportedCalloutLineStyle([2, 4]), 'dotted');
  assert.equal(resolveImportedCalloutLineStyle(null), null);
});
