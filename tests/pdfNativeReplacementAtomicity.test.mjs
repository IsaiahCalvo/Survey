import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDFDocument,
  PDFName,
  PDFString,
} from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const PAGE_WIDTH = 200;
const PAGE_HEIGHT = 200;

async function makePdfWithNativeInk() {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const native = source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: [20, 120, 180, 140],
    InkList: [[[20, 130, 180, 130]]],
    Border: [0, 0, 10],
    Contents: PDFString.of('original native ink'),
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([native]));
  const bytes = await source.save();
  return {
    pdfAnnotationId: `${native.objectNumber}R`,
    pdfFile: {
      name: 'native-ink.pdf',
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    },
  };
}

async function exportEditedNativeInk(path) {
  const { pdfFile, pdfAnnotationId } = await makePdfWithNativeInk();
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {
        1: {
          objects: [{
            id: 'edited-native-ink',
            type: 'path',
            path,
            stroke: '#ff0000',
            strokeWidth: 10,
            isPdfImported: true,
            pdfAnnotationId,
            pdfAnnotationType: 'Ink',
            pdfImportedEditState: 'edited',
          }],
        },
      },
      { 1: { width: PAGE_WIDTH, height: PAGE_HEIGHT } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'native-replacement-atomicity',
      },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

async function readAnnotationSummaries(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
  return (annots?.asArray() || []).map((entry) => {
    const dict = pdf.context.lookup(entry);
    return {
      subtype: dict.get(PDFName.of('Subtype'))?.decodeText?.(),
      contents: dict.get(PDFName.of('Contents'))?.decodeText?.(),
      name: dict.get(PDFName.of('NM'))?.decodeText?.(),
    };
  });
}

test('empty edited native path preserves the original annotation when replacement creation fails', async () => {
  const bytes = await exportEditedNativeInk([]);

  assert.deepEqual(await readAnnotationSummaries(bytes), [{
    subtype: 'Ink',
    contents: 'original native ink',
    name: undefined,
  }]);
});

test('successful edited native replacement removes its original annotation', async () => {
  const bytes = await exportEditedNativeInk([
    ['M', 30, 70],
    ['L', 170, 70],
  ]);

  assert.deepEqual(await readAnnotationSummaries(bytes), [{
    subtype: 'Ink',
    contents: '',
    name: 'edited-native-ink',
  }]);
});
