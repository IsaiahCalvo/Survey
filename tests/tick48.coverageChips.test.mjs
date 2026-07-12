/**
 * Tick-48 coverage chips: richer AP ops (b, b-star, f-star, nested q/Q), FreeTextCallout,
 * corrupt raw PDF catch, cloudSync localStorage parse catch, TypedArray colors.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  importAnnotationsFromPdf,
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
} from '../src/utils/pdfAnnotationImporter.js';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { __resetDocumentMetadataCacheForTests } from '../src/services/documentMetadataResolver.js';
import {
  hasMigrationRun,
  resetMigrationFlag,
} from '../src/services/cloudSyncMigration.js';

async function buildApOpsPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const ctx = doc.context;

  const ops = [
    '1 w',
    '0 0 1 RG',
    '1 0 0 rg',
    '10 10 m',
    '40 10 l',
    '40 40 l',
    'b',
    'q',
    '0 G',
    '0 g',
    'Q',
    '15 15 m',
    '35 35 l',
    'b*',
    '20 20 m',
    '30 20 l',
    '30 30 l',
    'f*',
    '/Gs1 gs',
    '1 0 0 1 0 0 cm',
  ].join(' ');

  const formStream = ctx.flateStream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(80), PDFNumber.of(80)],
    Matrix: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
  });
  const formRef = ctx.register(formStream);

  // Empty-ish stream (ops with no path) → path.length===0 null branch after parse
  const emptyStream = ctx.flateStream('2 w 1 J', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(10), PDFNumber.of(10)],
  });
  const emptyRef = ctx.register(emptyStream);

  const refs = [];
  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [40, 300, 120, 380],
    NM: PDFString.of('sq-bops'),
    AP: ctx.obj({ N: formRef }),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    BS: ctx.obj({
      W: PDFNumber.of(2),
      S: PDFName.of('D'),
      D: ctx.obj([ctx.obj([PDFNumber.of(4), PDFNumber.of(2)])]),
    }),
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Circle'),
    Rect: [150, 300, 220, 370],
    NM: PDFString.of('circ-empty-ap'),
    AP: ctx.obj({ N: emptyRef }),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('FreeText'),
    Rect: [40, 100, 200, 180],
    NM: PDFString.of('ft-callout'),
    Contents: PDFString.of('callout'),
    IT: PDFName.of('FreeTextCallout'),
    CL: [
      PDFNumber.of(50), PDFNumber.of(110),
      PDFNumber.of(80), PDFNumber.of(140),
      PDFNumber.of(120), PDFNumber.of(150),
    ],
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
    DS: PDFString.of('font-family: Helv; color:#000000'),
    Q: PDFNumber.of(2),
    RD: [PDFNumber.of(2), PDFNumber.of(2), PDFNumber.of(2), PDFNumber.of(2)],
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('FreeText'),
    Rect: [250, 100, 380, 160],
    NM: PDFString.of('ft-q0'),
    Contents: PDFString.of('left'),
    DA: PDFString.of('0 0 0 rg /Helv 10 Tf'),
    Q: PDFNumber.of(0),
    P: page.ref,
  })));

  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  return doc.save();
}

test('importer AP b/b*/f* + nested dash + FreeTextCallout + corrupt bytes', async () => {
  const bytes = await buildApOpsPdf();
  const u8 = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);

  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported?.annotationsByPage);
  } finally {
    await pdfJsDoc.destroy?.();
  }

  // Corrupt bytes → buildRawAnnotationMetadata catch
  const bad = await importAnnotationsFromPdf(
    {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100, convertToViewportPoint: (x, y) => [x, y], convertToViewportRectangle: (r) => r }),
        getAnnotations: async () => [],
      }),
    },
    { rawPdfBytes: new Uint8Array([1, 2, 3, 4, 5]) },
  );
  assert.ok(bad);

  const viewport = {
    height: 500,
    convertToViewportPoint: (x, y) => [x, 500 - y],
    convertToViewportRectangle: (r) => [r[0], 500 - r[3], r[2], 500 - r[1]],
  };
  const callout = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [40, 100, 200, 180],
    contents: 'c',
    intent: 'FreeTextCallout',
    calloutLine: [50, 110, 80, 140, 120, 150],
    color: [1, 0, 0],
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
  }, viewport, 1, {
    calloutLine: [50, 110, 80, 140, 120, 150],
    intent: 'FreeTextCallout',
    rectangleDifferences: [2, 2, 2, 2],
  });
  assert.ok(callout);
});

test('ink TypedArray / object color + point-list object form', () => {
  const viewport = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const ink = convertInkToFabricPath({
    subtype: 'Ink',
    color: { 0: 10, 1: 20, 2: 30 },
    borderStyle: { width: 1 },
    inkLists: [
      new Float32Array([0, 0, 10, 0, 10, 10]),
      { 0: 20, 1: 20, 2: 30, 3: 20 },
    ],
  }, viewport);
  assert.ok(ink?.path?.length);

  const poly = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 40, 40],
    vertices: [[0, 0], [40, 0], [20, 40]],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(poly);
});

test('cloudSync localStorage JSON catch + backfill sealed empty wait', async () => {
  globalThis.localStorage = {
    getItem(key) {
      if (String(key).includes('annotationsByPage') || String(key).includes('callouts')) {
        return '{not-json';
      }
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  try {
    assert.equal(hasMigrationRun('u', 'd'), false);
    resetMigrationFlag('u', 'd');
  } finally {
    delete globalThis.localStorage;
  }

  // Sealed cutover + empty Y.Map exercises the IndexedDB wait loop (~1.5s)
  __resetDocumentMetadataCacheForTests();
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  const supabase = {
    from(table) {
      if (table === 'documents') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'u-wait',
                  cutover_completed_at: '2026-01-01T00:00:00Z',
                  annotations_changed_at: null,
                  locked_at: null,
                  locked_by: null,
                  locked_label: null,
                  tool_preferences: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      // legacy count / select during recovery — return empty
      const b = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'in', 'order', 'range', 'is', 'not']) b[m] = self;
      b.then = (resolve) => resolve({ data: [], error: null, count: 0 });
      return b;
    },
  };
  const started = Date.now();
  const result = await runBackfill({
    ydoc,
    supabase,
    documentId: 'doc-wait-empty',
    userId: 'u-wait',
    markCutoverComplete: true,
    yMapAnnotations: yMap,
  });
  assert.ok(Date.now() - started >= 1000); // waited for empty map
  assert.ok(result?.ranAs);
  ydoc.destroy();
  __resetDocumentMetadataCacheForTests();
});
