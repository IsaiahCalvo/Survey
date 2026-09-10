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
import {
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  buildPdfExportAnnotationPlan,
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { normalizeByPageAnnotationIdentities } from '../src/utils/annotationStorageIdentity.js';
import { markEditedImportedPdfAnnotationsOnPage } from '../src/viewerShared.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const PAGE_W = 200;
const PAGE_H = 200;

const directNativeFingerprint = ({
  subtype,
  rect,
  flags = 0,
  nm = '',
  contents = '',
  title = '',
  subject = '',
  quadPoints = [],
  inkList = [],
  line = [],
  vertices = [],
  calloutLine = [],
}) => ({
  subtype: String(subtype).toLowerCase(),
  rect,
  flags,
  nm,
  contents,
  title,
  subject,
  quadPoints,
  inkList,
  line,
  vertices,
  calloutLine,
});

const directNativeIdentity = ({
  pageNumber = 1,
  annotsIndex = 0,
  ...fingerprint
}) => ({
  v: 1,
  pageNumber,
  annotsIndex,
  fingerprint: directNativeFingerprint(fingerprint),
});

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

async function exportBytes(pdfFile, objects, options = {}) {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects } },
      { 1: { width: PAGE_W, height: PAGE_H } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        ...options,
      },
    );
  } finally {
    globalThis.window = originalWindow;
  }
}

test('durable full-delete tombstones remove imported shape and text-markup native dictionaries', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const shape = source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: 'native shape',
    P: page.ref,
  }));
  const markup = source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [60, 160, 100, 180],
    QuadPoints: [60, 180, 100, 180, 60, 160, 100, 160],
    Contents: 'native highlight',
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([shape, markup]));
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'native-delete-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };

  const bytes = await exportBytes(pdfFile, [], {
    deletedPdfAnnotations: [
      {
        pdfAnnotationId: `${shape.objectNumber}R`,
        pageNumber: 1,
        pdfAnnotationType: 'Square',
      },
      {
        pdfAnnotationId: `${markup.objectNumber}R`,
        pageNumber: 1,
        pdfAnnotationType: 'Highlight',
      },
    ],
  });
  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(dicts, []);
});

test('native delete tombstone removes only its page when two pages reuse one annotation name', async () => {
  const source = await PDFDocument.create();
  const firstPage = source.addPage([PAGE_W, PAGE_H]);
  const secondPage = source.addPage([PAGE_W, PAGE_H]);
  const makeNamedSquare = (page) => source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    NM: PDFString.of('shared-native-name'),
    P: page.ref,
  }));
  const first = makeNamedSquare(firstPage);
  const second = makeNamedSquare(secondPage);
  firstPage.node.set(PDFName.of('Annots'), source.context.obj([first]));
  secondPage.node.set(PDFName.of('Annots'), source.context.obj([second]));
  const sourceBytes = await source.save();
  const bytes = await exportBytes({
    name: 'same-name-two-pages.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: 'shared-native-name',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
    }],
  });
  const exported = await PDFDocument.load(bytes);
  const firstAnnots = exported.getPage(0).node.lookup(PDFName.of('Annots'));
  const secondAnnots = exported.getPage(1).node.lookup(PDFName.of('Annots'));
  assert.equal(firstAnnots?.asArray?.().length || 0, 0);
  assert.equal(secondAnnots?.asArray?.().length || 0, 1);
});

test('duplicate native names on one page fail closed', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const makeDuplicate = (contents) => source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    NM: PDFString.of('malformed-duplicate-name'),
    Contents: PDFString.of(contents),
    P: page.ref,
  }));
  const first = makeDuplicate('duplicate one');
  const second = makeDuplicate('duplicate two');
  page.node.set(PDFName.of('Annots'), source.context.obj([first, second]));
  const sourceBytes = await source.save();

  const bytes = await exportBytes({
    name: 'duplicate-native-name.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: 'malformed-duplicate-name',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
    }],
  });
  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(
    dicts.map((dict) => dict.get(PDFName.of('Contents'))?.decodeText?.()),
    ['duplicate one', 'duplicate two'],
  );
});

test('native delete tombstone matches a nonzero-generation pdf.js reference exactly', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const generatedRef = PDFRef.of(50, 2);
  source.context.assign(generatedRef, source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: PDFString.of('generation two native shape'),
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([generatedRef]));
  const sourceBytes = await source.save();

  const bytes = await exportBytes({
    name: 'nonzero-generation-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      // pdf.js Ref#toString emits "50R2" for object 50, generation 2.
      pdfAnnotationId: '50R2',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
    }],
  });

  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(dicts, []);
});

test('nonzero-generation import id retains raw native metadata lookup', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const generatedRef = PDFRef.of(50, 2);
  source.context.assign(generatedRef, source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    C: [1, 0, 0],
    BS: { W: 2 },
    BE: { S: 'C', I: 1 },
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([generatedRef]));
  const sourceBytes = await source.save();
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return { width: PAGE_W, height: PAGE_H };
        },
        async getAnnotations() {
          return [{
            id: '50R2',
            subtype: 'Square',
            rect: [20, 160, 40, 180],
            annotationFlags: 0,
            color: new Uint8ClampedArray([255, 0, 0]),
            borderStyle: { width: 2 },
            contentsObj: { str: '' },
            titleObj: { str: '' },
          }];
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });

  const object = imported.annotationsByPage[1].objects[0];
  assert.equal(object.pdfAnnotationId, '50R2');
  assert.ok(
    Array.isArray(object.data?.pdfCloudPathD),
    '50R2 raw /BE metadata must be found and converted to cloud geometry',
  );
});

test('import stores direct native identity independent of the shared pdf.js object-id suffix', async () => {
  const source = await PDFDocument.create();
  const sourcePage = source.addPage([PAGE_W, PAGE_H]);
  sourcePage.node.set(PDFName.of('Annots'), source.context.obj([
    source.context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [20, 160, 40, 180],
      Contents: PDFString.of('suffix independent'),
      P: sourcePage.ref,
    }),
  ]));
  const sourceBytes = await source.save();
  const annotations = [{
    id: 'annot_p0_7',
    subtype: 'Square',
    rect: [40.00000001, 180, 20, 160],
    annotationFlags: 0,
    contentsObj: { str: 'suffix independent' },
    titleObj: { str: '' },
    color: new Uint8ClampedArray([255, 0, 0]),
    borderStyle: { width: 1 },
  }];
  const viewport = {
    width: PAGE_W,
    height: PAGE_H,
    convertToViewportRectangle(rect) {
      return [rect[0], PAGE_H - rect[1], rect[2], PAGE_H - rect[3]];
    },
  };
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return viewport;
        },
        async getAnnotations() {
          return annotations;
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });

  const objects = imported.annotationsByPage[1].objects;
  assert.deepEqual(
    objects[0].data?.pdfNativeAnnotationIdentity,
    directNativeIdentity({
      subtype: 'Square',
      rect: [20, 160, 40, 180],
      contents: 'suffix independent',
    }),
  );
});

test('native delete tombstone removes a direct /Annots dictionary by durable identity, not annot suffix', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const indirect = source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [5, 175, 15, 185],
    Contents: PDFString.of('keep indirect'),
    P: page.ref,
  }));
  const firstDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Contents: PDFString.of('delete first direct'),
    P: page.ref,
  });
  const secondDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [60, 160, 100, 180],
    Contents: PDFString.of('keep second direct'),
    P: page.ref,
  });
  page.node.set(
    PDFName.of('Annots'),
    source.context.obj([indirect, firstDirect, secondDirect]),
  );
  const sourceBytes = await source.save();

  const bytes = await exportBytes({
    name: 'direct-annotation-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      // The shared pdf.js page counter may have advanced on images/patterns.
      // This suffix is intentionally unrelated to direct-dictionary position.
      pdfAnnotationId: 'annot_p0_7',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        annotsIndex: 1,
        subtype: 'Square',
        rect: [20, 160, 40, 180],
        contents: 'delete first direct',
      }),
    }],
  });

  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(
    dicts.map((dict) => dict.get(PDFName.of('Contents'))?.decodeText?.()),
    ['keep indirect', 'keep second direct'],
  );
});

test('direct Line identity survives pdf.js endpoint normalization', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const rawLine = [80, 160, 20, 180];
  const pdfJsLine = [20, 160, 80, 180];
  const direct = source.context.obj({
    Type: 'Annot',
    Subtype: 'Line',
    Rect: [20, 160, 80, 180],
    L: rawLine,
    Contents: PDFString.of('reverse endpoint line'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([direct]));
  const sourceBytes = await source.save();
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return { width: PAGE_W, height: PAGE_H };
        },
        async getAnnotations() {
          return [{
            id: 'annot_p0_19',
            subtype: 'Line',
            rect: [20, 160, 80, 180],
            lineCoordinates: new Float32Array(pdfJsLine),
            annotationFlags: 0,
            contentsObj: { str: 'reverse endpoint line' },
            titleObj: { str: '' },
            color: new Uint8ClampedArray([255, 0, 0]),
            borderStyle: { width: 1 },
          }];
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });
  const identity = imported.annotationsByPage[1].objects[0]
    .data?.pdfNativeAnnotationIdentity;
  assert.deepEqual(identity, directNativeIdentity({
    subtype: 'Line',
    rect: [20, 160, 80, 180],
    contents: 'reverse endpoint line',
    line: rawLine,
  }));

  const bytes = await exportBytes({
    name: 'direct-line-normalized-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: 'annot_p0_19',
      pageNumber: 1,
      pdfAnnotationType: 'Line',
      pdfNativeAnnotationIdentity: identity,
    }],
  });
  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(dicts, []);
});

test('ambiguous identical direct dictionaries receive no identity and fail closed', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const firstDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Contents: PDFString.of('same duplicate contents'),
    TestMarker: PDFString.of('keep duplicate one'),
    P: page.ref,
  });
  const secondDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Contents: PDFString.of('same duplicate contents'),
    TestMarker: PDFString.of('delete duplicate two'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([firstDirect, secondDirect]));
  const sourceBytes = await source.save();
  const annotations = [31, 32].map((suffix) => ({
    id: `annot_p0_${suffix}`,
    subtype: 'Square',
    rect: [20, 160, 40, 180],
    annotationFlags: 0,
    contentsObj: { str: 'same duplicate contents' },
    titleObj: { str: '' },
    color: new Uint8ClampedArray([255, 0, 0]),
    borderStyle: { width: 1 },
  }));
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return { width: PAGE_W, height: PAGE_H };
        },
        async getAnnotations() {
          return annotations;
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });
  const objects = imported.annotationsByPage[1].objects;
  assert.deepEqual(
    objects.map((object) => object.data?.pdfNativeAnnotationIdentity),
    [undefined, undefined],
    'an ambiguous raw candidate must never be guessed',
  );

  const bytes = await exportBytes({
    name: 'duplicate-direct-annotation-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: objects[0].pdfAnnotationId,
      pageNumber: 1,
      pdfAnnotationType: 'Square',
    }],
  });

  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(
    dicts.map((dict) => dict.get(PDFName.of('TestMarker'))?.decodeText?.()),
    ['keep duplicate one', 'delete duplicate two'],
  );
});

test('direct native identity flags keep a hidden twin from shifting the visible ordinal', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const hiddenDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    F: 32,
    Contents: PDFString.of('same twin contents'),
    T: PDFString.of('same twin title'),
    Subj: PDFString.of('same twin subject'),
    TestMarker: PDFString.of('hidden twin'),
    P: page.ref,
  });
  const visibleDirect = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Contents: PDFString.of('same twin contents'),
    T: PDFString.of('same twin title'),
    Subj: PDFString.of('same twin subject'),
    TestMarker: PDFString.of('visible twin'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([hiddenDirect, visibleDirect]));
  const sourceBytes = await source.save();
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return { width: PAGE_W, height: PAGE_H };
        },
        async getAnnotations() {
          // Mirrors pdf.js default display intent: `/F 32` NoView is filtered.
          return [{
            id: 'annot_p0_17',
            subtype: 'Square',
            rect: [20, 160, 40, 180],
            annotationFlags: 0,
            contentsObj: { str: 'same twin contents' },
            titleObj: { str: 'same twin title' },
            color: new Uint8ClampedArray([255, 0, 0]),
            borderStyle: { width: 1 },
          }];
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });
  const identity = imported.annotationsByPage[1].objects[0]
    .data?.pdfNativeAnnotationIdentity;
  assert.deepEqual(identity, directNativeIdentity({
    annotsIndex: 1,
    subtype: 'Square',
    rect: [20, 160, 40, 180],
    flags: 0,
    contents: 'same twin contents',
    title: 'same twin title',
    subject: 'same twin subject',
  }));

  const bytes = await exportBytes({
    name: 'hidden-direct-twin-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: 'annot_p0_17',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: identity,
    }],
  });

  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(
    dicts.map((dict) => dict.get(PDFName.of('TestMarker'))?.decodeText?.()),
    ['hidden twin'],
    'the visible exact match is removed; hidden native twin remains',
  );
});

test('direct native identity geometry skips a malformed markup twin at an earlier index', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const invalidQuadPoints = [20, 180, 40, 180];
  const rawValidQuadPoints = [40, 160, 20, 160, 40, 180, 20, 180];
  const pdfJsValidQuadPoints = [20, 180, 40, 180, 20, 160, 40, 160];
  const malformed = source.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [20, 160, 40, 180],
    QuadPoints: invalidQuadPoints,
    Contents: PDFString.of('same markup contents'),
    TestMarker: PDFString.of('malformed twin'),
    P: page.ref,
  });
  const visible = source.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [20, 160, 40, 180],
    // pdf.js canonicalizes valid quads before exposing them. Persisted native
    // identity must still retain the exact raw array used for export matching.
    QuadPoints: rawValidQuadPoints,
    Contents: PDFString.of('same markup contents'),
    TestMarker: PDFString.of('visible markup'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([malformed, visible]));
  const sourceBytes = await source.save();
  const imported = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        getViewport() {
          return { width: PAGE_W, height: PAGE_H };
        },
        async getAnnotations() {
          return [{
            id: 'annot_p0_23',
            subtype: 'Highlight',
            rect: [20, 160, 40, 180],
            annotationFlags: 0,
            contentsObj: { str: 'same markup contents' },
            titleObj: { str: '' },
            quadPoints: new Float32Array(pdfJsValidQuadPoints),
            color: new Uint8ClampedArray([255, 255, 0]),
          }];
        },
      };
    },
  }, { rawPdfBytes: sourceBytes });
  const identity = imported.annotationsByPage[1].objects[0]
    .data?.pdfNativeAnnotationIdentity;
  assert.deepEqual(identity, directNativeIdentity({
    annotsIndex: 1,
    subtype: 'Highlight',
    rect: [20, 160, 40, 180],
    contents: 'same markup contents',
    quadPoints: rawValidQuadPoints,
  }));

  const bytes = await exportBytes({
    name: 'malformed-direct-markup-twin-delete.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [], {
    deletedPdfAnnotations: [{
      pdfAnnotationId: 'annot_p0_23',
      pageNumber: 1,
      pdfAnnotationType: 'Highlight',
      pdfNativeAnnotationIdentity: identity,
    }],
  });
  const { dicts } = await getAnnotationDicts(bytes);
  assert.deepEqual(
    dicts.map((dict) => dict.get(PDFName.of('TestMarker'))?.decodeText?.()),
    ['malformed twin'],
  );
});

test('legacy or mismatched synthetic native identity fails closed', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const direct = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [20, 160, 40, 180],
    Contents: PDFString.of('must survive mismatches'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([direct]));
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'direct-annotation-fail-closed.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };

  for (const deletedPdfAnnotation of [
    {
      pdfAnnotationId: 'annot_p0_1',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      // Legacy: no pdfNativeAnnotationIdentity.
    },
    {
      pdfAnnotationId: 'annot_p0_1',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        subtype: 'Square',
        rect: [21, 160, 40, 180],
        contents: 'must survive mismatches',
      }),
    },
    {
      pdfAnnotationId: 'annot_p0_1',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        pageNumber: 2,
        subtype: 'Square',
        rect: [20, 160, 40, 180],
        contents: 'must survive mismatches',
      }),
    },
    {
      pdfAnnotationId: 'annot_p0_1',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        annotsIndex: 1,
        subtype: 'Square',
        rect: [20, 160, 40, 180],
        contents: 'must survive mismatches',
      }),
    },
  ]) {
    const bytes = await exportBytes(pdfFile, [], {
      deletedPdfAnnotations: [deletedPdfAnnotation],
    });
    const { dicts } = await getAnnotationDicts(bytes);
    assert.equal(dicts.length, 1);
    assert.equal(
      dicts[0].get(PDFName.of('Contents'))?.decodeText?.(),
      'must survive mismatches',
    );
  }
});

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

function freezeRecursively(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeRecursively);
  return Object.freeze(value);
}

test('async-imported native ink partial erase is stamped, exported, and replaces the native original', async () => {
  const { pdfFile, nativeObjectNumber } = await makePdfFileWithNativeAnnot('Ink');
  const pdfAnnotationId = `${nativeObjectNumber}R`;
  const seededInk = createProductionPaperInk({
    id: 'transient-import-id',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const { id: _transientId, ...withoutTopLevelId } = seededInk;
  const rawAsyncImport = {
    ...withoutTopLevelId,
    data: { tool: 'pen', authorId: 'user-a' },
    isPdfImported: true,
    pdfAnnotationId,
    pdfAnnotationType: 'Ink',
  };
  const materializedImport = normalizeByPageAnnotationIdentities({
    1: { objects: [rawAsyncImport] },
  }).byPage[1].objects[0];
  const carvedImport = erasePageAnnotations({
    pageAnnotations: { objects: [materializedImport] },
    eraserPoints: [{ x: 90, y: 58 }],
    eraserRadius: 7,
    mode: 'partial',
  }).pageAnnotations.objects[0];

  assert.notDeepEqual(carvedImport.polygons, materializedImport.polygons);
  assert.equal(carvedImport.data.id, pdfAnnotationId);
  const frozenPrevious = freezeRecursively({ objects: [rawAsyncImport] });
  const frozenIncoming = freezeRecursively({ objects: [carvedImport] });
  const normalizedPrevious = normalizeByPageAnnotationIdentities({
    1: frozenPrevious,
  }).byPage[1];
  const normalizedIncoming = normalizeByPageAnnotationIdentities({
    1: frozenIncoming,
  }).byPage[1];
  const markedIncoming = markEditedImportedPdfAnnotationsOnPage(
    normalizedIncoming,
    normalizedPrevious,
    {
      source: 'eraser:commit',
      userId: 'user-a',
      pageNumber: 1,
    },
  );
  const markedInk = markedIncoming.objects[0];

  assert.equal(rawAsyncImport.data.id, undefined, 'frozen async-import snapshot stays untouched');
  assert.equal(markedInk.data.id, pdfAnnotationId);
  assert.equal(markedInk.pdfImportedEditState, 'edited');
  assert.equal(markedInk.data.pdfImportedEditState, 'edited');

  const plan = buildPdfExportAnnotationPlan({
    pageSizes: { 1: { width: PAGE_W, height: PAGE_H } },
    annotationsByPage: { 1: markedIncoming },
  });
  assert.equal(plan.diagnostics.objectsExported, 1);
  assert.equal(plan.diagnostics.editedImportedCopiesExported, 1);
  assert.equal(plan.diagnostics.importedNativeCopiesSkipped, 0);
  assert.equal(plan.diagnostics.skippedByReason['imported-pdf-native-preserved'], undefined);
  assert.equal(plan.items[0].object.pdfAnnotationId, pdfAnnotationId);

  const bytes = await exportBytes(pdfFile, [markedInk]);
  const { dicts } = await getAnnotationDicts(bytes);
  assert.equal(dicts.length, 1, 'old native Ink is removed and carved app Ink is written once');
  assert.equal(dicts[0].get(PDFName.of('Subtype')).decodeText(), 'Ink');
  assert.notEqual(dicts[0].get(PDFName.of('Contents'))?.decodeText?.(), 'stale native shape');
});

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

  // CONTRACT CHANGE (2026-09-09): the appearance box is the ellipse box PLUS
  // the outer half of the stroke. It used to be the exact ellipse box, so the
  // form CLIPPED half the outline away - measured as 1.25pt of missing stroke
  // against the app's own flattened print in poppler, cairo and Quartz
  // (scripts/cloud-export-fidelity.mjs --shapes plain, case
  // plain-ellipse-rotated). /RD records the pad, so a re-import still recovers
  // rx / ry (tests/pdfPlainShapeAppearance.test.mjs covers that round trip).
  const pad = 2 / 2 + 0.25; // strokeWidth / 2 + PLAIN_APPEARANCE_EXTRA_PAD
  // /Rect must be the axis-aligned bounds of the ROTATED, padded ellipse,
  // centered on the app-space center (100, 100) → PDF center (100, 100) on a
  // 200pt page.
  const rect = numberArray(dict, 'Rect');
  const theta = (-30 * Math.PI) / 180; // fabric screen-CW 30° → PDF CCW −30°
  const halfW = Math.abs((40 + pad) * Math.cos(theta)) + Math.abs((20 + pad) * Math.sin(theta));
  const halfH = Math.abs((40 + pad) * Math.sin(theta)) + Math.abs((20 + pad) * Math.cos(theta));
  approxEqual(rect[0], 100 - halfW);
  approxEqual(rect[1], 100 - halfH);
  approxEqual(rect[2], 100 + halfW);
  approxEqual(rect[3], 100 + halfH);
  const rd = numberArray(dict, 'RD');
  assert.equal(rd.length, 4, 'the pad is recorded in /RD');
  rd.forEach((value) => approxEqual(value, pad));

  // /AP /N form: BBox carries the UN-rotated oblong dims, Matrix the rotation
  // — exactly what computeAppearanceRotationTransform inverts on import
  // (fabricAngleDeg = -atan2(b, a) → for fabric 30°: a=cos30, b=-sin30).
  const appearance = doc.context.lookup(dict.get(PDFName.of('AP')));
  assert.ok(appearance, 'rotated ellipse export must carry an /AP dictionary');
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  assert.ok(normal, 'rotated ellipse export must carry an /AP /N form');
  const bbox = normal.dict.get(PDFName.of('BBox')).asArray()
    .map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
  approxEqual(Math.abs(bbox[2] - bbox[0]), 80 + 2 * pad); // 2·rx + the stroke pad
  approxEqual(Math.abs(bbox[3] - bbox[1]), 40 + 2 * pad); // 2·ry + the stroke pad
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

test('edited imported annotation replaces a nonzero-generation native reference', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const generatedRef = PDFRef.of(50, 2);
  source.context.assign(generatedRef, source.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: PDFString.of('stale generation two native shape'),
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([generatedRef]));
  const sourceBytes = await source.save();

  const bytes = await exportBytes({
    name: 'nonzero-generation-edit.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [editedImportedEllipse('50R2')]);
  const { dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1, 'stale generation-2 copy must be replaced, not duplicated');
  assert.equal(dicts[0].get(PDFName.of('Subtype')).decodeText(), 'Circle');
  assert.notEqual(
    dicts[0].get(PDFName.of('Contents'))?.decodeText?.(),
    'stale generation two native shape',
  );
});

test('edited imported annotation replaces its direct native dictionary by durable identity', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const direct = source.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: PDFString.of('stale direct native shape'),
    P: page.ref,
  });
  page.node.set(PDFName.of('Annots'), source.context.obj([direct]));
  const sourceBytes = await source.save();
  const edited = editedImportedEllipse('annot_p0_12');
  edited.data = {
    pdfNativeAnnotationIdentity: directNativeIdentity({
      subtype: 'Circle',
      rect: [20, 160, 40, 180],
      contents: 'stale direct native shape',
    }),
  };

  const bytes = await exportBytes({
    name: 'direct-native-edit.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  }, [edited]);
  const { dicts } = await getAnnotationDicts(bytes);

  assert.equal(dicts.length, 1, 'stale direct copy must be replaced, not duplicated');
  assert.equal(dicts[0].get(PDFName.of('Subtype')).decodeText(), 'Circle');
  assert.notEqual(
    dicts[0].get(PDFName.of('Contents'))?.decodeText?.(),
    'stale direct native shape',
  );
});

test('direct delete + edited removals use original indices in either tombstone order', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const deleteFirst = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [10, 160, 30, 180],
    Contents: PDFString.of('delete original index zero'),
    P: page.ref,
  });
  const deleteSecond = source.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [40, 160, 60, 180],
    Contents: PDFString.of('delete original index one'),
    P: page.ref,
  });
  const editThird = source.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [70, 160, 90, 180],
    Contents: PDFString.of('replace original index two'),
    P: page.ref,
  });
  page.node.set(
    PDFName.of('Annots'),
    source.context.obj([deleteFirst, deleteSecond, editThird]),
  );
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'multi-direct-native-removal.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };
  const tombstones = [
    {
      pdfAnnotationId: 'annot_p0_40',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        annotsIndex: 0,
        subtype: 'Square',
        rect: [10, 160, 30, 180],
        contents: 'delete original index zero',
      }),
    },
    {
      pdfAnnotationId: 'annot_p0_41',
      pageNumber: 1,
      pdfAnnotationType: 'Square',
      pdfNativeAnnotationIdentity: directNativeIdentity({
        annotsIndex: 1,
        subtype: 'Square',
        rect: [40, 160, 60, 180],
        contents: 'delete original index one',
      }),
    },
  ];
  const edited = editedImportedEllipse('annot_p0_42');
  edited.data = {
    pdfNativeAnnotationIdentity: directNativeIdentity({
      annotsIndex: 2,
      subtype: 'Circle',
      rect: [70, 160, 90, 180],
      contents: 'replace original index two',
    }),
  };

  for (const deletedPdfAnnotations of [tombstones, [...tombstones].reverse()]) {
    const bytes = await exportBytes(pdfFile, [edited], { deletedPdfAnnotations });
    const { dicts } = await getAnnotationDicts(bytes);
    assert.equal(dicts.length, 1, 'only the newly written edited circle remains');
    assert.equal(dicts[0].get(PDFName.of('Subtype')).decodeText(), 'Circle');
    assert.notEqual(
      dicts[0].get(PDFName.of('Contents'))?.decodeText?.(),
      'replace original index two',
    );
  }
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
