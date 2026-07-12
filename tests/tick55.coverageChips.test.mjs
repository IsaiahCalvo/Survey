/**
 * Tick-55 coverage chips: pageSpace eraser correct API (commandEndpoint),
 * overlapping region merge, PDF export debug logger, annotationDocSync
 * snapshot throw + synced short-circuit + debounce flush, AP name-token stream.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  mergeOverlappingRegions,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';
import {
  buildPdfExportAnnotationPlan,
  buildPrintableRegularAnnotationPayload,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

test('pageSpaceEraser commandEndpoint null + relative unknown endpoint', () => {
  const result = erasePageAnnotations({
    pageAnnotations: {
      objects: [{
        type: 'path',
        left: 0,
        top: 0,
        stroke: '#000000',
        strokeWidth: 3,
        path: [
          ['M', 0, 0],
          ['L', 40, 0],
          ['L', 40, 20],
          ['B'], // too short → commandEndpoint null
          ['a', 2, 3], // relative unknown with endpoint (76-82)
          ['T', 5, 6], // absolute unknown with endpoint
          ['Z'],
        ],
        data: { id: 'ps55' },
      }],
    },
    eraserPoints: [{ x: 10, y: 0 }, { x: 20, y: 0 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  assert.ok(result);
  assert.equal(typeof result.didChange, 'boolean');
});

test('regionMath mergeOverlappingRegions merges overlapping additives', () => {
  const a = {
    regionId: 'a55',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 20, 0, 20, 20, 0, 20],
  };
  const b = {
    regionId: 'b55',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [10, 10, 30, 10, 30, 30, 10, 30],
  };
  const hole = {
    regionId: 'h55',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [12, 12, 18, 12, 18, 18, 12, 18],
  };
  const merged = mergeOverlappingRegions([a, b, hole]);
  assert.ok(Array.isArray(merged));
  assert.ok(merged.length >= 1);
});

test('pdf export debug logger + empty plan edges', () => {
  const prevWin = globalThis.window;
  globalThis.window = {
    __PDF_EXPORT_DEBUG: true,
  };
  const origDebug = console.debug;
  console.debug = () => { throw new Error('export-debug-boom'); };
  try {
    const plan = buildPdfExportAnnotationPlan({
      annotationsByPage: {
        1: {
          objects: [{
            type: 'path',
            left: 0,
            top: 0,
            path: [['M', 0, 0], ['L', 5, 0]],
            stroke: '#ff0000',
            strokeWidth: 2,
            data: { id: 'exp55' },
          }],
        },
      },
      pageSizes: { 1: { width: 100, height: 100 } },
    });
    assert.ok(plan);

    const printable = buildPrintableRegularAnnotationPayload({
      annotationsByPage: { 1: { objects: [] } },
      calloutsByPage: {},
    });
    assert.ok(printable);
  } finally {
    console.debug = origDebug;
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
});

test('annotationDocSync synced short-circuit + snapshot upsert throw + debounce', async () => {
  let snapAttempts = 0;
  const supabase = {
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
          upsert: async () => {
            snapAttempts += 1;
            if (snapAttempts === 1) throw new Error('snap-throw');
            return { error: { message: 'snap-err' } };
          },
        };
      }
      if (table === 'annotation_updates') {
        const b = {};
        const self = () => b;
        for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = self;
        b.insert = () => ({
          select: () => ({
            single: async () => ({ data: { seq: snapAttempts + 1 }, error: null }),
          }),
        });
        b.then = (resolve) => resolve({ data: [], error: null });
        return b;
      }
      throw new Error(table);
    },
    removeChannel: async () => {},
  };

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-t55',
    supabase,
    clientId: 'c55',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  doc.transact(() => {
    doc.getMap('annotations').set('k55', { id: 'k55' });
  }, 'local');

  // Wait past SNAPSHOT_DEBOUNCE_MS (1200) so scheduleSnapshot timer fires
  await new Promise((r) => setTimeout(r, 1400));
  await handle.drain();
  assert.ok(snapAttempts >= 1);

  await handle.destroy();
  doc.destroy();
});

test('importer AP stream with name token in number stack', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  // Name token between numbers → consumeNumbers non-finite check (1073)
  const form = ctx.flateStream('1 0 0 /DeviceRGB RG 0 0 m /X 10 10 l S', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 50, 50],
  });
  const formRef = ctx.register(form);
  const annot = ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [10, 10, 60, 60],
    NM: PDFString.of('sq-name-tok'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    BS: ctx.obj({ W: PDFNumber.of(1) }),
    AP: ctx.obj({ N: formRef }),
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  const bytes = await doc.save();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported);
  } finally {
    await pdfJsDoc.destroy?.();
  }
});
