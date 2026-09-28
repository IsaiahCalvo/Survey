// w52 (2026-09-28) "annotations are annotations": an EDITED imported stamp
// (the image proxy the app paints in place of a native /Stamp) must reach the
// exported PDF, drawn exactly as print draws it. It used to be skipped as
// 'unsupported-type', so the export kept the stale native stamp at its old
// spot while the screen and print showed it moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE = 200;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4mAAAAAElFTkSuQmCC';

const stampProxy = (pdfAnnotationId, overrides = {}) => ({
  id: 'stamp-proxy',
  type: 'image',
  src: PNG,
  left: 100,
  top: 100,
  width: 40,
  height: 20,
  isPdfImported: true,
  pdfAnnotationId,
  pdfAnnotationType: 'Stamp',
  pdfImportedEditState: 'edited',
  data: { pdfStampAppearanceRotationBaked: false },
  ...overrides,
});

async function sourceWithNativeStamp() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE, PAGE]);
  const appearance = doc.context.register(doc.context.flateStream(
    'q 1 0 0 RG 2 w 0 0 40 20 re S Q',
    { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 40, 20], Resources: {} },
  ));
  const native = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: [20, 160, 60, 180], F: 4, NM: 'native-stamp', AP: { N: appearance }, P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([native]));
  const bytes = await doc.save();
  return {
    nativeObjectNumber: native.objectNumber,
    pdfFile: {
      name: 'stamp.pdf',
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
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
      { 1: { width: PAGE, height: PAGE } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

const numbers = (dict, key) => dict.get(PDFName.of(key)).asArray().map((n) => n.asNumber());

test('export plan keeps an edited imported stamp proxy instead of skipping it as unsupported', () => {
  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: PAGE, height: PAGE } },
    annotationsByPage: { 1: { objects: [stampProxy('9R')] } },
  });
  assert.equal(plan.diagnostics.skippedByReason['unsupported-type'], undefined);
  assert.deepEqual(plan.items.map((item) => item.id), ['stamp-proxy']);
});

test('an edited imported stamp is written as a /Stamp with an image /AP at its new place, replacing the native original', async () => {
  const { pdfFile, nativeObjectNumber } = await sourceWithNativeStamp();
  const bytes = await exportBytes(pdfFile, [stampProxy(`${nativeObjectNumber}R`)]);
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  assert.equal(dicts.length, 1, 'stale native stamp removed, edited copy written');
  const dict = dicts[0];
  assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Stamp');
  assert.notEqual(dict.get(PDFName.of('NM'))?.decodeText?.(), 'native-stamp');
  // App box (100,100)-(140,120) on a 200pt page -> PDF y 80..100, padded 0.25.
  const rect = numbers(dict, 'Rect');
  [99.75, 79.75, 140.25, 100.25].forEach((expected, index) => {
    assert.ok(Math.abs(rect[index] - expected) < 1e-6, `Rect[${index}] ${rect[index]} ~ ${expected}`);
  });
  const ap = doc.context.lookup(doc.context.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const xobjects = ap.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('XObject'));
  const images = xobjects.keys().map((key) => doc.context.lookup(xobjects.get(key)))
    .filter((stream) => stream?.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
  assert.equal(images.length, 1, 'the appearance draws the stamp PNG');
});

test('a rotated edited stamp grows its /Rect to the rotated box', async () => {
  const { pdfFile, nativeObjectNumber } = await sourceWithNativeStamp();
  const bytes = await exportBytes(pdfFile, [stampProxy(`${nativeObjectNumber}R`, { angle: 90 })]);
  const doc = await PDFDocument.load(bytes);
  const dict = doc.context.lookup(doc.getPage(0).node.lookup(PDFName.of('Annots')).get(0));
  const rect = numbers(dict, 'Rect');
  // 40x20 box centred at (120,110) turned 90 degrees -> 20 wide, 40 tall.
  assert.ok(Math.abs((rect[2] - rect[0]) - 20.5) < 1e-6);
  assert.ok(Math.abs((rect[3] - rect[1]) - 40.5) < 1e-6);
});
