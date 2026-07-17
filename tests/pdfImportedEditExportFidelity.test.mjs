// Export-fidelity fixes for EDITED imported annotations + thin-stroke ink /AP.
// Items 1–3 of docs/research/INK-MODEL-AND-IMPORT-NORMALIZATION-2026-07-17.md:
//   1. edited imported rotated-ellipse ('ellipse' type) must be re-exported as
//      /Circle with the rotation baked into the /AP appearance matrix (it was
//      silently skipped 'unsupported-type', leaving the file stale).
//   2. edited imported Highlight / Text (sticky note) / Caret re-emit their
//      native PDF subtype instead of collapsing to /Square or /PolyLine.
//   3. thin-stroke ink export writes a baked /AP appearance so pen strokes
//      render identically in every viewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE_W = 200;
const PAGE_H = 200;

async function makePdfFileWithNativeAnnot(subtype = 'Circle') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const nativeAnnot = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: 'stale native shape',
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([nativeAnnot]));
  const bytes = await doc.save();
  return {
    nativeObjectNumber: nativeAnnot.objectNumber,
    pdfFile: {
      name: 'native-source.pdf',
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    },
  };
}

async function makePlainPdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function exportBytes(pdfFile, objects) {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects } },
      { 1: { width: PAGE_W, height: PAGE_H } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

async function getAnnotationDicts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const dicts = annots
    ? annots.asArray().map((ref) => doc.context.lookup(ref))
    : [];
  return { doc, dicts };
}

function numberArray(dict, key) {
  const arr = dict.get(PDFName.of(key));
  if (!arr) return null;
  return arr.asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
}

function approxEqual(actual, expected, eps = 1e-4) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} ≈ ${expected} (±${eps})`,
  );
}

// ---------------------------------------------------------------------------
// Item 1 — edited imported rotated ellipse
// ---------------------------------------------------------------------------

const editedImportedEllipse = (pdfAnnotationId) => ({
  id: 'edited-imported-ellipse',
  type: 'ellipse',
  left: 60, // center (100, 100), rx 40, ry 20
  top: 80,
  rx: 40,
  ry: 20,
  angle: 30,
  fill: 'transparent',
  stroke: '#ff0000',
  strokeWidth: 2,
  isPdfImported: true,
  pdfAnnotationId,
  pdfImportedEditState: 'edited',
  pdfAnnotationType: 'Circle',
});

test('export plan includes an edited imported rotated ellipse instead of skipping it as unsupported', () => {
  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: PAGE_W, height: PAGE_H } },
    annotationsByPage: { 1: { objects: [editedImportedEllipse('7R')] } },
  });

  assert.equal(plan.diagnostics.skippedByReason['unsupported-type'], undefined,
    'edited imported ellipse must not be skipped as unsupported-type');
  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.deepEqual(plan.items.map((item) => item.id), ['edited-imported-ellipse']);
});

test('edited imported rotated ellipse is written as /Circle with appearance-matrix rotation and the stale native dict is removed', async () => {
  const { pdfFile, nativeObjectNumber } = await makePdfFileWithNativeAnnot('Circle');
  const bytes = await exportBytes(pdfFile, [editedImportedEllipse(`${nativeObjectNumber}R`)]);
  const { doc, dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1, 'stale native copy must be removed, edited copy written');
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Circle');
  assert.notEqual(dict.get(PDFName.of('Contents'))?.decodeText?.(), 'stale native shape');

  // /Rect must be the axis-aligned bounds of the ROTATED ellipse, centered on
  // the app-space center (100, 100) → PDF center (100, 100) on a 200pt page.
  const rect = numberArray(dict, 'Rect');
  const theta = (-30 * Math.PI) / 180; // fabric screen-CW 30° → PDF CCW −30°
  const halfW = Math.abs(40 * Math.cos(theta)) + Math.abs(20 * Math.sin(theta));
  const halfH = Math.abs(40 * Math.sin(theta)) + Math.abs(20 * Math.cos(theta));
  approxEqual(rect[0], 100 - halfW);
  approxEqual(rect[1], 100 - halfH);
  approxEqual(rect[2], 100 + halfW);
  approxEqual(rect[3], 100 + halfH);

  // /AP /N form: BBox carries the UN-rotated oblong dims, Matrix the rotation
  // — exactly what computeAppearanceRotationTransform inverts on import
  // (fabricAngleDeg = -atan2(b, a) → for fabric 30°: a=cos30, b=-sin30).
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  assert.ok(appearance, 'rotated ellipse export must carry an /AP dictionary');
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  assert.ok(normal, 'rotated ellipse export must carry an /AP /N form');
  const bbox = normal.dict.get(PDFName.of('BBox')).asArray()
    .map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
  approxEqual(Math.abs(bbox[2] - bbox[0]), 80); // 2·rx
  approxEqual(Math.abs(bbox[3] - bbox[1]), 40); // 2·ry
  const matrix = normal.dict.get(PDFName.of('Matrix')).asArray()
    .map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
  approxEqual(matrix[0], Math.cos(theta));
  approxEqual(matrix[1], Math.sin(theta));
  approxEqual(matrix[2], -Math.sin(theta));
  approxEqual(matrix[3], Math.cos(theta));
  const recoveredFabricAngle = -Math.atan2(matrix[1], matrix[0]) * (180 / Math.PI);
  approxEqual(recoveredFabricAngle, 30);

  // The form stream must actually paint an ellipse (bezier curves + stroke).
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.match(content, / c\n?/, 'appearance must draw bezier curves');
  assert.match(content, /RG/, 'appearance must set a stroke color');
  assert.match(content, /\bS\b|\bB\b/, 'appearance must stroke the ellipse');
});

// ---------------------------------------------------------------------------
// Item 2 — subtype-preserving export for edited imports
// ---------------------------------------------------------------------------

test('edited imported Highlight re-exports as /Highlight with QuadPoints derived from the rect', async () => {
  const { pdfFile, nativeObjectNumber } = await makePdfFileWithNativeAnnot('Highlight');
  const bytes = await exportBytes(pdfFile, [{
    id: 'edited-imported-highlight',
    type: 'rect',
    left: 10,
    top: 20,
    width: 40,
    height: 10,
    fill: '#ffff00',
    opacity: 0.4,
    stroke: null,
    strokeWidth: 0,
    isPdfImported: true,
    pdfAnnotationId: `${nativeObjectNumber}R`,
    pdfImportedEditState: 'edited',
    pdfAnnotationType: 'Highlight',
  }]);
  const { dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1);
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Highlight',
    'edited imported Highlight must not collapse to /Square');
  // Adobe QuadPoints order: TL, TR, BL, BR (same convention as the app's
  // survey-marker writer).
  assert.deepEqual(numberArray(dict, 'QuadPoints'), [
    10, PAGE_H - 20,
    50, PAGE_H - 20,
    10, PAGE_H - 30,
    50, PAGE_H - 30,
  ]);
  const color = numberArray(dict, 'C');
  approxEqual(color[0], 1);
  approxEqual(color[1], 1);
  approxEqual(color[2], 0);
});

test('edited imported Text sticky note re-exports as /Text preserving /Contents note text', async () => {
  const { pdfFile, nativeObjectNumber } = await makePdfFileWithNativeAnnot('Text');
  const bytes = await exportBytes(pdfFile, [{
    id: 'edited-imported-note',
    type: 'rect',
    left: 30,
    top: 40,
    width: 20,
    height: 20,
    fill: 'rgba(255, 235, 59, 0.92)',
    stroke: 'rgba(0, 0, 0, 0.4)',
    strokeWidth: 1,
    data: { type: 'note', noteText: 'Keep this note text', pdfNoteIcon: 'Comment' },
    isPdfImported: true,
    pdfAnnotationId: `${nativeObjectNumber}R`,
    pdfImportedEditState: 'edited',
    pdfAnnotationType: 'Text',
  }]);
  const { dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1);
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Text',
    'edited imported sticky note must not collapse to /Square');
  assert.equal(dict.get(PDFName.of('Contents')).decodeText(), 'Keep this note text');
  assert.equal(String(dict.get(PDFName.of('Name'))), '/Comment');
  assert.deepEqual(numberArray(dict, 'Rect'), [30, PAGE_H - 60, 50, PAGE_H - 40]);
});

test('edited imported Caret re-exports as /Caret instead of /PolyLine', async () => {
  const { pdfFile, nativeObjectNumber } = await makePdfFileWithNativeAnnot('Caret');
  const bytes = await exportBytes(pdfFile, [{
    id: 'edited-imported-caret',
    type: 'polyline',
    left: 5,
    top: 8,
    width: 12,
    height: 10,
    points: [{ x: 0, y: 10 }, { x: 6, y: 0 }, { x: 12, y: 10 }],
    fill: 'transparent',
    stroke: '#ff0000',
    strokeWidth: 1,
    isPdfImported: true,
    pdfAnnotationId: `${nativeObjectNumber}R`,
    pdfImportedEditState: 'edited',
    pdfAnnotationType: 'Caret',
  }]);
  const { dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1);
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Caret',
    'edited imported caret must not collapse to /PolyLine');
  assert.deepEqual(numberArray(dict, 'Rect'), [5, PAGE_H - 18, 17, PAGE_H - 8]);
  const color = numberArray(dict, 'C');
  approxEqual(color[0], 1);
  approxEqual(color[1], 0);
  approxEqual(color[2], 0);
});

test('app-created rect and polyline still export through the fabric-type switch defaults', async () => {
  const bytes = await exportBytes(await makePlainPdfFile(), [
    { id: 'app-rect', type: 'rect', left: 10, top: 10, width: 20, height: 20, stroke: '#111111' },
    { id: 'app-polyline', type: 'polyline', left: 0, top: 0, points: [{ x: 5, y: 5 }, { x: 50, y: 25 }], stroke: '#111111' },
  ]);
  const { dicts } = await getAnnotationDicts(bytes);
  const subtypes = dicts.map((dict) => dict.get(PDFName.of('Subtype')).decodeText()).sort();
  assert.deepEqual(subtypes, ['PolyLine', 'Square']);
});

// ---------------------------------------------------------------------------
// Item 3 — thin-stroke ink export bakes an /AP appearance
// ---------------------------------------------------------------------------

test('thin-stroke ink export writes a stroked /AP appearance alongside the editable /InkList', async () => {
  const bytes = await exportBytes(await makePlainPdfFile(), [{
    id: 'thin-ink',
    type: 'path',
    path: [['M', 10, 10], ['Q', 20, 5, 30, 10], ['L', 50, 30]],
    stroke: '#112233',
    strokeWidth: 2,
  }]);
  const { doc, dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1);
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');

  // Editable /InkList stays (spec-standard interop path).
  const inkList = dict.get(PDFName.of('InkList')).asArray();
  assert.equal(inkList.length, 1);

  // Baked /AP /N appearance: stroked polyline, correct color + width, round
  // caps/joins matching the on-screen pen.
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  assert.ok(appearance, 'thin-stroke ink must carry an /AP dictionary');
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  assert.ok(normal, 'thin-stroke ink must carry an /AP /N appearance stream');
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.match(content, /RG/, 'appearance must set the stroke color');
  assert.match(content, /\b2 w\b/, 'appearance must set the stroke width');
  assert.match(content, /\bS\b/, 'appearance must stroke, not fill');
  assert.match(content, /1 J/, 'appearance should use round line caps');
  assert.doesNotMatch(content, /f\*/, 'thin ink appearance must not use the filled-ink paint op');

  // /Rect is inflated by half the stroke width so no viewer clips the stroke.
  // App bounds (incl. the Q control point): x 10..50, y 5..30 → pad 1.
  assert.deepEqual(numberArray(dict, 'Rect'), [9, PAGE_H - 31, 51, PAGE_H - 4]);
});

test('filled paper ink export keeps its filled appearance path (unchanged by the thin-stroke AP fix)', async () => {
  const { createProductionPaperInk } = await import('../src/utils/productionPaperInk.js');
  const paperInk = createProductionPaperInk({
    id: 'paper-ink-ap-guard',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const bytes = await exportBytes(await makePlainPdfFile(), [paperInk]);
  const { doc, dicts } = await getAnnotationDicts(bytes);
  assert.equal(dicts.length, 1);
  const appearance = doc.context.lookup(dicts[0].get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  const content = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  assert.match(content, /f\*/, 'paper ink stays on the filled even-odd appearance');
});
