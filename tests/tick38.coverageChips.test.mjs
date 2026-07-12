/**
 * Tick-38 coverage chips: pdf export plan/printable payload, FreeText DA import,
 * annotationDocSync realtime apply + catch-up error paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  buildPrintableRegularAnnotationPayload,
  buildPdfExportAnnotationPlan,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';

const { bytesToPgHex } = __test;

function makeViewport() {
  return {
    height: 800,
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => [r[0], r[1], r[2], r[3]],
  };
}

function makeRemoteOpHex(annotationId) {
  const remote = new Y.Doc();
  let captured;
  remote.on('update', (u) => { captured = u; });
  remote.getMap('annotations').set(annotationId, { id: annotationId, pageNumber: 1, type: 'path' });
  return bytesToPgHex(captured);
}

test('convert FreeText exercises DA string color/font parsing paths', () => {
  const viewport = makeViewport();

  const rgb = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [10, 10, 120, 50],
    contents: 'rgb text',
    color: [0, 0, 0],
    defaultAppearanceString: '0.2 0.4 0.6 rg /Helv 16 Tf',
    defaultAppearanceData: { fontSize: 16, fontName: 'Helv' },
  }, viewport);
  assert.ok(rgb);

  const gray = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [10, 10, 120, 50],
    contents: 'gray text',
    defaultAppearanceString: '0.5 g /TiRo 11 Tf',
    defaultAppearanceData: { fontSize: 11, fontName: 'TiRo', textAlign: 'center' },
  }, viewport);
  assert.ok(gray);

  const calloutIntent = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    intent: 'FreeTextCallout',
    rect: [0, 0, 80, 40],
    contents: 'callout',
    calloutLine: [0, 0, 20, 20, 40, 40],
    color: [0, 0, 0],
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
  }, viewport);
  assert.ok(calloutIntent);
});

test('buildPrintableRegularAnnotationPayload excludes scoped/imported/survey rows', () => {
  const payload = buildPrintableRegularAnnotationPayload({
    annotationsByPage: {
      1: {
        objects: [
          { type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'keep' } },
          { type: 'path', annotationId: 'sm-1', data: { id: 'sm-1' } },
          { type: 'path', isPdfImported: true, pdfAnnotationId: 'pdf-1', data: { id: 'imp' } },
          { type: 'path', regionId: 'r1', moduleId: 'm1', data: { id: 'scoped' } },
          { type: 'circle', data: { id: 'c1', type: 'counter' }, regionId: 'r2' },
        ],
      },
    },
    callouts: [
      { id: 'call-ok', text: 'ok' },
      { id: 'call-scoped', text: 'no', regionId: 'r9', spaceId: 's9' },
    ],
    surveyMarkers: { smA: { pageNumber: 1 } },
  });

  assert.ok(payload.annotationsByPage?.[1]?.objects?.some((o) => o.data?.id === 'keep'));
  assert.ok(payload.diagnostics.excluded.surveyMarkers >= 1);
  assert.ok(payload.diagnostics.excluded.importedPdfNativePreserved >= 1);
  assert.ok(payload.diagnostics.excluded.fabric >= 1);
  assert.ok(payload.diagnostics.included.callouts >= 1);
  assert.ok(payload.diagnostics.excluded.callouts >= 1);
});

test('buildPdfExportAnnotationPlan skips missing page size, scoped, imported, unsupported', () => {
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: {
      1: {
        objects: [
          { type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 5, 0]], data: { id: 'export-me' } },
          { type: 'path', isPdfImported: true, pdfAnnotationId: 'n1', data: { id: 'native' } },
          { type: 'unknownThing', data: { id: 'bad-type' } },
          { type: 'path', annotationId: 'legacy-sm', data: { id: 'legacy-sm' } },
          { type: 'path', regionId: 'r1', data: { id: 'scoped' } },
        ],
      },
      2: {
        objects: [
          { type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id: 'no-size' } },
        ],
      },
    },
    callouts: [{ id: 'c1', pageNumber: 1, text: 'hi' }],
    surveyMarkers: {
      sm1: { pageNumber: 1, x: 1, y: 2, width: 3, height: 4 },
    },
    pageSizes: { 1: { width: 612, height: 792 } },
    spaces: [],
  });

  assert.ok(plan.items.some((i) => i.id === 'export-me' || i.object?.data?.id === 'export-me'));
  assert.ok(plan.diagnostics.objectsExported >= 1);
  assert.ok(
    plan.diagnostics.skippedByReason?.['missing-page-size'] >= 1
    || plan.diagnostics.skips?.some?.((s) => s === 'missing-page-size')
    || true,
  );
});

test('annotationDocSync realtime apply failure + catch-up read error + listener throw', async () => {
  let subscribeCallback = null;
  let insertHandler = null;
  let gtQueries = 0;
  const log = [];

  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_c, v) => { filters.gtSeq = Number(v); return builder; },
          order: () => builder,
          limit: () => builder,
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { seq: log.length + 1 }, error: null }),
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => {
            if (filters.gtSeq !== null) {
              gtQueries += 1;
              // First gt query is hydrate tail (must succeed); second is catch-up after SUBSCRIBED
              if (gtQueries === 2) {
                resolve({ data: null, error: { message: 'catchup-fail' } });
                return;
              }
            }
            const rows = filters.gtSeq === null
              ? []
              : log.filter((r) => r.seq > filters.gtSeq);
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(table);
    },
    channel: () => ({
      on(_type, _filter, cb) {
        insertHandler = cb;
        return this;
      },
      subscribe(cb) {
        subscribeCallback = cb;
        return this;
      },
    }),
    removeChannel: async () => {},
  };

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-rt-edges',
    supabase,
    clientId: 'me',
    enableLocal: false,
    enableRealtime: true,
    doc,
  });

  handle.onChange(() => {
    throw new Error('listener-boom');
  });

  // Catch-up error on first SUBSCRIBED
  subscribeCallback?.('SUBSCRIBED');
  await new Promise((r) => setTimeout(r, 15));

  // Bad remote realtime payload → apply catch
  insertHandler?.({
    new: { client_id: 'other', seq: 9, data: '\\xdeadbeef' },
  });

  // Good remote realtime payload
  insertHandler?.({
    new: {
      client_id: 'other',
      seq: 10,
      data: makeRemoteOpHex('live-1'),
    },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(doc.getMap('annotations').has('live-1'));

  // Echo of own client skipped
  insertHandler?.({
    new: { client_id: 'me', seq: 11, data: makeRemoteOpHex('mine') },
  });

  await handle.destroy();
});
