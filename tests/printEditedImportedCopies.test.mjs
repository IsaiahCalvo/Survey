// KAL-91 residual — the print path unconditionally dropped every
// isPdfImported/pdfAnnotationId object, with no edited-replacement exception.
// The printed document therefore showed the STALE unedited native annotation
// for an imported copy the user had edited in-app. These tests lock the print
// path onto the same P1 policy the export path implements
// ('export-edited-imported-copies', buildPdfExportAnnotationPlan): edited
// imported copies flatten into the print, and the native original of an
// edited copy is suppressed; unedited imported copies keep printing as their
// preserved native annots only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  buildPrintableRegularAnnotationPayload,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const editedImportedRect = (overrides = {}) => ({
  id: 'edited-imported-rect',
  type: 'rect',
  left: 60,
  top: 60,
  width: 20,
  height: 20,
  stroke: '#ff0000',
  strokeWidth: 2,
  isPdfImported: true,
  pdfAnnotationId: 'pdf-native-1',
  pdfImportedEditState: 'edited',
  ...overrides,
});

test('printable payload uses drawable imported copies as print truth, edited or not', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: {
        objects: [
          editedImportedRect(),
          { id: 'unedited-imported-circle', type: 'circle', left: 20, top: 20, radius: 8, isPdfImported: true, pdfAnnotationId: 'pdf-native-2' },
          { id: 'app-rect', type: 'rect', left: 10, top: 10, width: 20, height: 20 },
        ],
      },
    },
  });

  assert.deepEqual(
    payload.annotationsByPage[1].objects.map((obj) => obj.id),
    ['edited-imported-rect', 'unedited-imported-circle', 'app-rect'],
  );
  assert.equal(payload.diagnostics.included.editedImportedCopies, 2);
  assert.equal(payload.diagnostics.excluded.importedPdfNativePreserved, 0);
});

test('printable payload treats composite siblings of an edited member as part of the replacement', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: {
        objects: [
          editedImportedRect({
            id: 'edited-composite-member',
            data: { pdfAppearanceCompositeId: 'composite-1' },
          }),
          {
            id: 'unedited-composite-sibling',
            type: 'rect',
            left: 90,
            top: 60,
            width: 20,
            height: 20,
            isPdfImported: true,
            pdfAnnotationId: 'pdf-native-1',
            data: { pdfAppearanceCompositeId: 'composite-1' },
          },
          {
            id: 'unedited-other-composite',
            type: 'rect',
            left: 120,
            top: 60,
            width: 20,
            height: 20,
            isPdfImported: true,
            pdfAnnotationId: 'pdf-native-3',
            data: { pdfAppearanceCompositeId: 'composite-2' },
          },
        ],
      },
    },
  });

  assert.deepEqual(
    payload.annotationsByPage[1].objects.map((obj) => obj.id),
    ['edited-composite-member', 'unedited-composite-sibling', 'unedited-other-composite'],
  );
  assert.equal(payload.diagnostics.included.editedImportedCopies, 3);
  assert.equal(payload.diagnostics.excluded.importedPdfNativePreserved, 0);
});

test('printable payload includes scoped edited imported copies under the all-visible print contract', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: { objects: [editedImportedRect({ moduleId: 'module-a' })] },
    },
  });
  assert.deepEqual(payload.annotationsByPage[1].objects.map((obj) => obj.id), ['edited-imported-rect']);
  assert.equal(payload.diagnostics.excludedByScope.survey, 0);
});

const makeNativeSourcePdf = async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const nativeAnnot = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    F: 4,
    Contents: 'old native',
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), sourceDoc.context.obj([nativeAnnot]));
  const sourceBytes = await sourceDoc.save();
  return {
    nativeAnnot,
    pdfFile: {
      name: 'native-source.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(
          sourceBytes.byteOffset,
          sourceBytes.byteOffset + sourceBytes.byteLength,
        );
      },
    },
  };
};

const countNativeAnnots = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (let index = 0; index < doc.getPageCount(); index += 1) {
    const annots = doc.getPage(index).node.lookup(PDFName.of('Annots'));
    count += annots?.size?.() || 0;
  }
  return count;
};

const pageContentText = (doc, pageIndex = 0) => {
  const contents = doc.getPage(pageIndex).node.Contents();
  const values = contents instanceof PDFArray ? contents.asArray() : [contents];
  return values.filter(Boolean).map((value) => {
    const stream = doc.context.lookup(value);
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }).join('\n');
};

test('print flatten suppresses the native original of an edited imported copy', async () => {
  const { nativeAnnot, pdfFile } = await makeNativeSourcePdf();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    {
      1: {
        objects: [editedImportedRect({ pdfAnnotationId: `${nativeAnnot.objectNumber}R` })],
      },
    },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  // The edited replacement flattens as page CONTENT; the stale native
  // original must be gone (0 annotation objects remain).
  assert.equal(await countNativeAnnots(bytes), 0);
});

test('print flatten removes a deleted imported native annotation', async () => {
  const { nativeAnnot, pdfFile } = await makeNativeSourcePdf();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    {},
    { 1: { width: 200, height: 200 } },
    {
      actionType: 'pdf-print-flattened-regular-annotations',
      documentId: 'doc-test',
      deletedPdfAnnotations: [{
        pageNumber: 1,
        pdfAnnotationId: `${nativeAnnot.objectNumber}R`,
        pdfAnnotationType: 'Square',
      }],
    },
  );

  assert.equal(await countNativeAnnots(bytes), 0);
});

test('print flatten strips native annotations that have no screen object', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const visibleButSkipped = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Sound', Rect: [20, 160, 40, 180], F: 4, P: page.ref,
  }));
  const hidden = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [50, 160, 70, 180], F: 6, P: page.ref,
  }));
  const printOnly = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [80, 160, 100, 180], F: 36, P: page.ref,
  }));
  const noPrintFlag = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [110, 160, 130, 180], F: 0, P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), sourceDoc.context.obj([
    visibleButSkipped, hidden, printOnly, noPrintFlag,
  ]));
  const sourceBytes = await sourceDoc.save();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'native-screen-parity.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    {},
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  assert.equal(await countNativeAnnots(bytes), 0);
});

test('print flatten gives translucent highlighter ink a Multiply ExtGState with stroke opacity', async () => {
  const sourceDoc = await PDFDocument.create();
  sourceDoc.addPage([200, 200]);
  const sourceBytes = await sourceDoc.save();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'translucent-highlighter.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    { 1: { objects: [{
      id: 'wash', type: 'path', left: 0, top: 0, pathOffset: { x: 0, y: 0 },
      scaleX: 1, scaleY: 1, stroke: '#facc15', strokeWidth: 18, opacity: 0.35,
      strokeLineCap: 'round', strokeLineJoin: 'round', globalCompositeOperation: 'multiply',
      path: [['M', 25, 80], ['L', 175, 80]],
    }] } },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  const flattened = await PDFDocument.load(bytes);
  const resources = flattened.getPage(0).node.Resources();
  const extGStates = resources?.lookup(PDFName.of('ExtGState'), PDFDict);
  const states = extGStates
    ? extGStates.keys().map((key) => extGStates.lookup(key, PDFDict))
    : [];
  assert.ok(states.some((state) => (
    state.lookup(PDFName.of('BM'))?.toString?.() === '/Multiply'
    && Math.abs((state.lookup(PDFName.of('CA'))?.asNumber?.() ?? 1) - 0.35) < 0.001
  )));
});

test('print flatten uses widget colours and DA size and wraps multiline text', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([240, 200]);
  const form = sourceDoc.getForm();
  const field = form.createTextField('notes');
  field.enableMultiline();
  field.setText('first line wraps inside the field\nsecond line');
  field.addToPage(page, { x: 20, y: 80, width: 90, height: 54 });
  field.setFontSize(9);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const fieldRef = annots.get(annots.size() - 1);
  const widget = sourceDoc.context.lookup(fieldRef, PDFDict);
  widget.set(PDFName.of('F'), sourceDoc.context.obj(4));
  widget.set(PDFName.of('MK'), sourceDoc.context.obj({
    BG: [1, 0.95, 0.8],
    BC: [0.1, 0.65, 0.2],
  }));
  widget.set(PDFName.of('BS'), sourceDoc.context.obj({ W: 2, S: 'S' }));
  const sourceBytes = await sourceDoc.save({ updateFieldAppearances: false });
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'multiline-form.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    { 1: { objects: [{
      type: 'form-field',
      data: {
        type: 'form-field', fieldId: `${fieldRef.objectNumber}R`,
        fieldName: 'notes', fieldType: 'Tx', value: 'first line wraps inside the field\nsecond line',
      },
    }] } },
    { 1: { width: 240, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  assert.equal(await countNativeAnnots(bytes), 0);
  const flattened = await PDFDocument.load(bytes);
  const content = pageContentText(flattened);
  assert.match(content, /1 0\.95 0\.8 rg/);
  assert.match(content, /0\.1 0\.65 0\.2 RG/);
  const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true });
  const renderedPage = await (await loadingTask.promise).getPage(1);
  const operatorList = await renderedPage.getOperatorList();
  const fontSizes = operatorList.fnArray
    .map((fn, index) => (fn === pdfjsLib.OPS.setFont ? Number(operatorList.argsArray[index]?.[1]) : null))
    .filter(Number.isFinite);
  const shownTextCount = operatorList.fnArray.filter((fn) => fn === pdfjsLib.OPS.showText).length;
  assert.ok(fontSizes.some((size) => Math.abs(size - 9) < 0.01), `expected 9pt text, got ${fontSizes}`);
  assert.ok(shownTextCount >= 3, `expected wrapped lines, got ${shownTextCount}`);
  await loadingTask.destroy();
});

test('print flatten removes a native link border without inventing screen-hidden paint', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const linkRef = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [20, 140, 160, 165], F: 4,
    Border: [0, 0, 3], C: [1, 0, 0], P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), sourceDoc.context.obj([linkRef]));
  const sourceBytes = await sourceDoc.save();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'native-link.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    { 1: { objects: [{
      id: 'link', type: 'group', fill: '#2563eb', stroke: '#2563eb', opacity: 1,
      isPdfImported: true, pdfAnnotationId: `${linkRef.objectNumber}R`, pdfAnnotationType: 'Link',
      data: { type: 'text-markup', markupType: 'link', quads: [{
        x1: 20, y1: 35, x2: 160, y2: 35, x3: 20, y3: 60, x4: 160, y4: 60,
      }] },
    }] } },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );
  assert.equal(await countNativeAnnots(bytes), 0);
  const flattened = await PDFDocument.load(bytes);
  assert.doesNotMatch(pageContentText(flattened), /\b(?:RG|m|l)\b/, 'an invisible screen link must add no painted line');
});

test('print flatten keeps the visible line for an app-created link', async () => {
  const sourceDoc = await PDFDocument.create();
  sourceDoc.addPage([200, 200]);
  const sourceBytes = await sourceDoc.save();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'app-link.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    { 1: { objects: [{
      id: 'app-link', type: 'group', fill: '#2563eb', stroke: '#2563eb', opacity: 1,
      data: { type: 'text-markup', markupType: 'link', quads: [{
        x1: 20, y1: 35, x2: 160, y2: 35, x3: 20, y3: 60, x4: 160, y4: 60,
      }] },
    }] } },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );
  const flattened = await PDFDocument.load(bytes);
  assert.match(pageContentText(flattened), /\bRG\b[\s\S]*\bm\b[\s\S]*\bl\b/);
});

test('print flatten defaults thick pen paths to round caps and joins', async () => {
  const sourceDoc = await PDFDocument.create();
  sourceDoc.addPage([200, 200]);
  const sourceBytes = await sourceDoc.save();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'round-pen.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    { 1: { objects: [{
      id: 'pen', type: 'path', left: 0, top: 0, pathOffset: { x: 0, y: 0 },
      scaleX: 1, scaleY: 1, stroke: '#7c3aed', strokeWidth: 20,
      path: [['M', 20, 100], ['L', 180, 100]],
    }] } },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );
  const flattened = await PDFDocument.load(bytes);
  const content = pageContentText(flattened);
  assert.match(content, /(?:^|\n)1 j(?:\n|$)/);
  assert.match(content, /(?:^|\n)1 J(?:\n|$)/);
});

test('print flatten replaces the native original of a drawable UNEDITED imported copy', async () => {
  const { nativeAnnot, pdfFile } = await makeNativeSourcePdf();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    {
      1: {
        objects: [{
          id: 'unedited-imported-rect',
          type: 'rect',
          left: 60,
          top: 60,
          width: 20,
          height: 20,
          isPdfImported: true,
          pdfAnnotationId: `${nativeAnnot.objectNumber}R`,
        }],
      },
    },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  assert.equal(await countNativeAnnots(bytes), 0);
});

test('print flatten embeds an imported stamp PNG and removes its native original', async () => {
  const sourceDoc = await PDFDocument.create();
  const page = sourceDoc.addPage([200, 200]);
  const appearance = sourceDoc.context.register(sourceDoc.context.flateStream(
    'q 1 0 0 RG 2 w 0 0 40 20 re S Q',
    { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 40, 20], Resources: {} },
  ));
  const nativeAnnot = sourceDoc.context.register(sourceDoc.context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: [20, 160, 60, 180], F: 4, NM: 'print-stamp', AP: { N: appearance }, P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), sourceDoc.context.obj([nativeAnnot]));
  const sourceBytes = await sourceDoc.save();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw4mAAAAAElFTkSuQmCC';
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    {
      name: 'native-stamp.pdf',
      async arrayBuffer() {
        return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      },
    },
    {
      1: { objects: [{
        id: 'stamp-proxy', type: 'image', src: png,
        left: 20, top: 20, width: 40, height: 20,
        angle: 90,
        isPdfImported: true,
        pdfAnnotationId: `${nativeAnnot.objectNumber}R`,
        pdfAnnotationType: 'Stamp',
        data: { pdfStampAppearanceRotationBaked: false },
      }] },
    },
    { 1: { width: 200, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-test' },
  );

  assert.equal(await countNativeAnnots(bytes), 0);
  const flattened = await PDFDocument.load(bytes);
  assert.ok(flattened.getPage(0).node.get(PDFName.of('Contents')));
  const loadingTask = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true });
  const flattenedPage = await (await loadingTask.promise).getPage(1);
  const operatorList = await flattenedPage.getOperatorList();
  assert.ok(operatorList.fnArray.some((fn, index) => (
    fn === pdfjsLib.OPS.transform
    && Math.abs(Number(operatorList.argsArray[index]?.[1])) > 0.9
    && Math.abs(Number(operatorList.argsArray[index]?.[2])) > 0.9
  )), 'flattened stamp image must retain its 90 degree rotation');
});
