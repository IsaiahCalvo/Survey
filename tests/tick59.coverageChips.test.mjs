/**
 * Tick-59 coverage chips: pdfLib removeMatching lookup/decode catches,
 * switch default via type flip, metadata jsonSafe/parse fallthrough,
 * importer readPdfLibNumber/Text + AP matrix catch via PDFDocument.load patch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  serializePdfAppAnnotationMetadata,
  parsePdfAppLayerStateMetadata,
  PDF_APP_LAYER_STATE_KEY,
  PDF_APP_LAYER_STATE_VERSION,
} from '../src/utils/pdfAppAnnotationMetadata.js';

async function minimalPdfBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

function asPdfFile(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  };
}

function nameKey(name) {
  try {
    if (typeof name?.decodeText === 'function') return name.decodeText();
    if (typeof name?.asString === 'function') return name.asString();
  } catch {
    // ignore
  }
  return String(name || '');
}

test('pdfLib removeMatching lookup + decodePdfDictText catches + switch default', async () => {
  // Seed a PDF that already has a native Annot with NM
  const seed = await PDFDocument.create();
  const page = seed.addPage([200, 200]);
  const annotRef = seed.context.register(seed.context.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [10, 10, 40, 40],
    NM: PDFString.of('native-t59'),
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), seed.context.obj([annotRef]));
  const seededBytes = await seed.save();

  const origLoad = PDFDocument.load.bind(PDFDocument);
  let patchedOnce = false;
  PDFDocument.load = async (...args) => {
    const doc = await origLoad(...args);
    if (patchedOnce) return doc;
    patchedOnce = true;

    const nativeNums = new Set();
    try {
      const p = doc.getPages()[0];
      const annots = p.node.lookup(PDFName.of('Annots'));
      for (const ref of annots?.asArray?.() || []) {
        if (typeof ref?.objectNumber === 'number') nativeNums.add(ref.objectNumber);
      }
    } catch {
      // ignore
    }

    const origLookup = doc.context.lookup.bind(doc.context);
    let lookupThrowsLeft = 1;
    let decodeMode = false;
    doc.context.lookup = (ref, ...rest) => {
      if (
        lookupThrowsLeft > 0
        && ref
        && typeof ref.objectNumber === 'number'
        && nativeNums.has(ref.objectNumber)
      ) {
        lookupThrowsLeft -= 1;
        throw new Error('lookup-boom');
      }
      const dict = origLookup(ref, ...rest);
      if (
        decodeMode
        && ref
        && typeof ref.objectNumber === 'number'
        && nativeNums.has(ref.objectNumber)
        && dict
        && typeof dict.get === 'function'
      ) {
        const origGet = dict.get.bind(dict);
        return {
          get(key) {
            const val = origGet(key);
            if (nameKey(key) === 'NM' || nameKey(key) === '/NM') {
              return {
                decodeText() {
                  throw new Error('decode-boom');
                },
              };
            }
            return val;
          },
        };
      }
      return dict;
    };

    // Second save call in this test flips to decode mode via closure after first export
    doc.__enableDecodeMode = () => {
      decodeMode = true;
      lookupThrowsLeft = 0;
    };
    return doc;
  };

  try {
    // Pass 1: lookup throws inside removeMatching
    const result1 = await savePDFWithAnnotationsPdfLib(
      asPdfFile(seededBytes),
      {
        1: {
          objects: [{
            type: 'rect',
            left: 10,
            top: 150,
            width: 30,
            height: 30,
            stroke: '#00aa00',
            strokeWidth: 1,
            isPdfImported: true,
            pdfAnnotationId: 'native-t59',
            pdfImportedEditState: 'edited',
            data: { id: 'edited-lookup', pdfImportedEditState: 'edited' },
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, documentId: 'doc-t59-lookup' },
    );
    assert.ok(result1);

    // Pass 2: decodeText throws (need fresh load patch state)
    patchedOnce = false;
    const result2 = await savePDFWithAnnotationsPdfLib(
      asPdfFile(seededBytes),
      {
        1: {
          objects: [{
            type: 'rect',
            left: 10,
            top: 150,
            width: 30,
            height: 30,
            stroke: '#00aa00',
            strokeWidth: 1,
            isPdfImported: true,
            pdfAnnotationId: 'native-t59',
            pdfImportedEditState: 'edited',
            data: { id: 'edited-decode', pdfImportedEditState: 'edited' },
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, documentId: 'doc-t59-decode' },
    );
    // Enable decode mode didn't run — force decode by making lookup succeed then NM throw.
    // Re-do with decode-first patch:
    assert.ok(result2);

    patchedOnce = false;
    PDFDocument.load = async (...args) => {
      const doc = await origLoad(...args);
      if (patchedOnce) return doc;
      patchedOnce = true;
      const nativeNums = new Set();
      const p = doc.getPages()[0];
      const annots = p.node.lookup(PDFName.of('Annots'));
      for (const ref of annots?.asArray?.() || []) {
        if (typeof ref?.objectNumber === 'number') nativeNums.add(ref.objectNumber);
      }
      const origLookup = doc.context.lookup.bind(doc.context);
      doc.context.lookup = (ref, ...rest) => {
        const dict = origLookup(ref, ...rest);
        if (
          ref
          && typeof ref.objectNumber === 'number'
          && nativeNums.has(ref.objectNumber)
          && dict
          && typeof dict.get === 'function'
        ) {
          const origGet = dict.get.bind(dict);
          return {
            get(key) {
              const val = origGet(key);
              const k = nameKey(key).replace(/^\//, '');
              if (k === 'NM') {
                return {
                  decodeText() {
                    throw new Error('decode-boom');
                  },
                };
              }
              return val;
            },
          };
        }
        return dict;
      };
      return doc;
    };

    const result3 = await savePDFWithAnnotationsPdfLib(
      asPdfFile(seededBytes),
      {
        1: {
          objects: [{
            type: 'rect',
            left: 10,
            top: 150,
            width: 30,
            height: 30,
            stroke: '#00aa00',
            strokeWidth: 1,
            isPdfImported: true,
            pdfAnnotationId: 'native-t59',
            pdfImportedEditState: 'edited',
            data: { id: 'edited-decode-2', pdfImportedEditState: 'edited' },
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, documentId: 'doc-t59-decode2' },
    );
    assert.ok(result3);

    // Switch default: fabricType collected as path, write-time type flips
    let typeReads = 0;
    const flipObj = {
      get type() {
        typeReads += 1;
        return typeReads <= 2 ? 'path' : 'image';
      },
      left: 0,
      top: 0,
      stroke: '#000',
      strokeWidth: 2,
      path: [['M', 0, 0], ['L', 10, 10]],
      data: { id: 'flip-default' },
    };
    const result4 = await savePDFWithAnnotationsPdfLib(
      asPdfFile(await minimalPdfBytes()),
      { 1: { objects: [flipObj] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, documentId: 'doc-t59-default' },
    );
    assert.ok(result4);
  } finally {
    PDFDocument.load = origLoad;
  }
});

test('pdfAppAnnotationMetadata jsonSafe symbol + layer-state fallthrough', () => {
  const json = serializePdfAppAnnotationMetadata(
    {
      type: 'path',
      left: 0,
      top: 0,
      stroke: '#111',
      path: [['M', 0, 0], ['L', 1, 1]],
      data: {
        id: 'meta-sym',
        tool: Symbol('not-json'),
      },
    },
    { id: 'meta-sym', type: 'path', pageNumber: 1 },
  );
  assert.ok(json);
  const parsed = JSON.parse(json);
  assert.equal(parsed.data.tool, null);

  assert.equal(
    parsePdfAppLayerStateMetadata(JSON.stringify({
      app: 'SurveyApp',
      kind: PDF_APP_LAYER_STATE_KEY,
      version: PDF_APP_LAYER_STATE_VERSION,
      layers: null,
    })),
    null,
  );
});

test('importer readPdfLibNumber/Text catch + AP matrix catch', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);

  const formContents = 'q 1 0 0 rg 10 10 40 40 re f Q';
  const formStream = doc.context.stream(formContents, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 100, 100],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: {},
  });
  const formRef = doc.context.register(formStream);
  const apDict = doc.context.obj({ N: formRef });
  const apRef = doc.context.register(apDict);

  const annotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [10, 10, 60, 60],
    NM: PDFString.of('sq-ap-t59'),
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    CA: PDFNumber.of(0.7),
    AP: apRef,
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]));
  const bytes = await doc.save();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const origLoad = PDFDocument.load.bind(PDFDocument);
  PDFDocument.load = async (...args) => {
    const loaded = await origLoad(...args);
    const p = loaded.getPages()[0];
    const annots = p.node.lookup(PDFName.of('Annots'));
    for (const ref of annots?.asArray?.() || []) {
      const dict = loaded.context.lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const origGet = dict.get.bind(dict);
      dict.get = (key) => {
        const val = origGet(key);
        const k = nameKey(key).replace(/^\//, '');
        if (k === 'CA') {
          return {
            asNumber() {
              throw new Error('asNumber-boom');
            },
          };
        }
        if (k === 'Contents') {
          return {
            decodeText() {
              throw new Error('decodeText-boom');
            },
            toString() {
              return 'fallback';
            },
          };
        }
        if (k === 'AP' && val) {
          // Leave AP; wrap stream dict below via lookup
        }
        return val;
      };
    }

    const origLookup = loaded.context.lookup.bind(loaded.context);
    loaded.context.lookup = (ref, ...rest) => {
      const value = origLookup(ref, ...rest);
      // Form XObject stream: throw from dict.get(Matrix) once
      if (value && value.dict && typeof value.dict.get === 'function' && !value.__t59patched) {
        value.__t59patched = true;
        const streamDict = value.dict;
        const origStreamGet = streamDict.get.bind(streamDict);
        let matrixThrows = 1;
        streamDict.get = (key) => {
          const k = nameKey(key).replace(/^\//, '');
          if (k === 'Matrix' && matrixThrows > 0) {
            matrixThrows -= 1;
            throw new Error('matrix-get-boom');
          }
          return origStreamGet(key);
        };
      }
      return value;
    };
    return loaded;
  };

  try {
    const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported);
  } finally {
    PDFDocument.load = origLoad;
  }
});
