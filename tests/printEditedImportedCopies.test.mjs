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
import { PDFDocument, PDFName } from 'pdf-lib';

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
