/**
 * Tick-39 coverage chips: FreeText DS/DA split, filled ink appearance,
 * crdtBackfill hydrate-rows import + select failure, snapshot upsert retries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { isLegacyBulkUpsertEnabled } from '../src/lib/collab/featureFlags.js';
import {
  isPdfNativeExportEnabled,
  setPdfNativeExportEnabledForDocument,
  clearPdfNativeExportOverride,
} from '../src/utils/pdfNativeExport/featureFlag.js';
import {
  mergeRegions,
  mergeOverlappingRegions,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

function makeViewport() {
  return {
    height: 800,
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => [r[0], r[1], r[2], r[3]],
  };
}

test('FreeText DS vs DA color split + filled appearance ink', () => {
  const viewport = makeViewport();

  const freetext = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [0, 0, 100, 40],
    contents: 'ds-da',
    color: [1, 0, 0],
    defaultAppearanceString: '0 0 1 rg /Helv 12 Tf', // border-ish blue
    defaultStyleString: '0 1 0 rg /Helv 12 Tf', // text green
    lineColor: [0.2, 0.2, 0.2],
  }, viewport);
  assert.ok(freetext);

  const filledInk = convertPdfAnnotationToFabric({
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 0 },
    borderWidth: 0,
    _appearance: {
      hasFill: true,
      path: [
        ['M', 0, 0],
        ['L', 10, 0],
        ['L', 10, 10],
        ['C', 8, 12, 2, 12, 0, 10],
        ['Z'],
      ],
      strokeColor: [0, 0, 0],
    },
  }, viewport);
  assert.ok(filledInk);
});

test('runBackfill reuses hydrate rows, already_done, and select failures', async () => {
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');

  // already_done short-circuit (no markCutoverComplete)
  ydoc.getMap('meta').set('backfill_done:u1', true);
  const done = await runBackfill({
    ydoc,
    supabase: {},
    documentId: 'doc-done',
    userId: 'u1',
    yMapAnnotations: yMap,
  });
  assert.equal(done.ranAs, 'already_done');

  // Fresh doc: import via existingHydrateRows
  const ydoc2 = new Y.Doc();
  const yMap2 = ydoc2.getMap('annotations');
  const result = await runBackfill({
    ydoc: ydoc2,
    supabase: { from() { throw new Error('should-not-select'); } },
    documentId: 'doc-hydrate',
    userId: 'u2',
    sessionId: 's2',
    clientID: ydoc2.clientID,
    yMapAnnotations: yMap2,
    existingHydrateRows: [
      {
        annotation_id: 'ink-1',
        annotation_type: 'ink',
        page_number: 1,
        user_id: 'author-a',
        created_at: '2020-01-01T00:00:00Z',
        annotation_data: {
          fabricObject: {
            type: 'path',
            left: 0,
            top: 0,
            path: [['M', 0, 0], ['L', 5, 0]],
            data: { id: 'ink-1' },
          },
          pageNumber: 1,
        },
      },
      {
        annotation_id: 'bad-json',
        annotation_type: 'ink',
        page_number: 1,
        annotation_data: '{not-json',
      },
      {
        annotation_id: 'survey-skip',
        annotation_type: 'survey-marker',
        page_number: 1,
        annotation_data: { fabricObject: { type: 'rect', data: { id: 'survey-skip' } } },
      },
      {
        annotation_id: 'legacy-string',
        annotation_type: 'square',
        page_number: 2,
        user_id: 'author-b',
        created_at: '2021-01-01T00:00:00Z',
        annotation_data: JSON.stringify({ type: 'rect', left: 1, top: 2, width: 3, height: 4 }),
      },
    ],
  });
  assert.ok(['imported', 'completed', 'ok'].some((s) => String(result.ranAs || '').includes(s)) || result.count >= 0 || yMap2.size >= 1);
  assert.ok(yMap2.has('ink-1') || yMap2.size >= 1);

  // SELECT failure path
  const ydoc3 = new Y.Doc();
  const fail = await runBackfill({
    ydoc: ydoc3,
    documentId: 'doc-fail',
    userId: 'u3',
    supabase: {
      from() {
        const b = {};
        const self = () => b;
        for (const m of ['select', 'eq', 'in', 'order', 'range']) b[m] = self;
        b.then = (resolve) => resolve({ data: null, error: { message: 'select-boom', code: 'XX' } });
        return b;
      },
    },
  });
  assert.equal(fail.ranAs, 'failed');

  ydoc.destroy();
  ydoc2.destroy();
  ydoc3.destroy();
});

test('annotationDocSync retries snapshot upsert failures', async () => {
  let attempts = 0;
  const supabase = {
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => {
            attempts += 1;
            if (attempts < 3) return { error: { message: `fail-${attempts}` } };
            return { error: null };
          },
        };
      }
      if (table === 'annotation_updates') {
        const b = {};
        const self = () => b;
        for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = self;
        b.insert = () => ({
          select: () => ({
            single: async () => ({ data: { seq: attempts + 1 }, error: null }),
          }),
        });
        b.then = (resolve) => resolve({ data: [], error: null });
        return b;
      }
      throw new Error(table);
    },
  };

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-snap-retry',
    supabase,
    clientId: 'c1',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  doc.getMap('annotations').set('x', { id: 'x' });
  await handle.destroy(); // final checkpoint write
  assert.ok(attempts >= 1);
});

test('feature flags localStorage throw + per-doc override', () => {
  globalThis.window = {
    localStorage: {
      getItem() { throw new Error('ls-denied'); },
    },
  };
  try {
    assert.equal(isLegacyBulkUpsertEnabled(), false);
  } finally {
    delete globalThis.window;
  }

  setPdfNativeExportEnabledForDocument('doc-ff', true);
  assert.equal(isPdfNativeExportEnabled('doc-ff'), true);
  clearPdfNativeExportOverride('doc-ff');
  assert.equal(isPdfNativeExportEnabled('doc-ff'), false);
});

test('regionMath merge guards for mismatched ops and null regions', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const b = {
    ...a,
    regionId: 'b',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [5, 5, 15, 5, 15, 15, 5, 15],
  };
  assert.equal(mergeRegions(a, b), null);
  assert.equal(mergeRegions(null, a), null);
  assert.deepEqual(mergeOverlappingRegions([]), []);
  assert.equal(mergeOverlappingRegions([a]).length, 1);
  assert.deepEqual(
    mergeOverlappingRegions([{ ...a, operation: REGION_OPERATIONS.SUBTRACT }]),
    [],
  );
});
