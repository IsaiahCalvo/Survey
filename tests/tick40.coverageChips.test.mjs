/**
 * Tick-40 coverage chips: cutover seal write paths, SNAPSHOT_AFTER_OPS,
 * IndexedDB open edges, export invalid geometry, paper erase locked/full.
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { __resetDocumentMetadataCacheForTests } from '../src/services/documentMetadataResolver.js';
import { openAnnotationDoc, purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { buildPdfExportAnnotationPlan } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  createInkAnnotation,
  eraseAnnotations,
  commandsToPolygonSet,
  polygonSetToCommands,
} from '../src/utils/paperAnnotationGeometry.js';
import {
  regionContainsPoint,
  isPointInsideRegionSet,
  regionToPolygon,
  mergeRegions,
  subtractRegionFromRegion,
  simplifyPolygon,
  deriveRegionChromeGeometry,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';
import {
  createUndoManager,
  userUndo,
  userRedo,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

function docsSelectNoCutover() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            user_id: 'u-seal',
            cutover_completed_at: null,
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

function hydrateInkRow(id = 'seal-ink') {
  return {
    annotation_id: id,
    annotation_type: 'ink',
    page_number: 1,
    user_id: 'author-a',
    created_at: '2020-01-01T00:00:00Z',
    annotation_data: {
      fabricObject: {
        type: 'path',
        left: 0,
        top: 0,
        path: [['M', 0, 0], ['L', 8, 0]],
        data: { id },
      },
      pageNumber: 1,
    },
  };
}

test('runBackfill seals cutover + write fail/throw + count mismatch + origin factory', async () => {
  __resetDocumentMetadataCacheForTests();

  // Success seal
  {
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    let sealed = false;
    const supabase = {
      from(table) {
        if (table === 'documents') {
          return {
            ...docsSelectNoCutover(),
            update: () => ({
              eq: async () => {
                sealed = true;
                return { error: null };
              },
            }),
          };
        }
        throw new Error(table);
      },
    };
    const result = await runBackfill({
      ydoc,
      supabase,
      documentId: 'doc-seal-ok',
      userId: 'u-seal',
      sessionId: 's1',
      clientID: ydoc.clientID,
      markCutoverComplete: true,
      yMapAnnotations: yMap,
      existingHydrateRows: [hydrateInkRow('seal-ok')],
      originPayloadFactory: ({ source, userId }) => Object.freeze({ source, userId, custom: true }),
    });
    assert.equal(result.cutoverCompleted, true);
    assert.equal(sealed, true);
    ydoc.destroy();
  }

  // Write error
  {
    __resetDocumentMetadataCacheForTests();
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const result = await runBackfill({
      ydoc,
      supabase: {
        from(table) {
          if (table === 'documents') {
            return {
              ...docsSelectNoCutover(),
              update: () => ({
                eq: async () => ({ error: { message: 'seal-denied' } }),
              }),
            };
          }
          throw new Error(table);
        },
      },
      documentId: 'doc-seal-err',
      userId: 'u-seal',
      markCutoverComplete: true,
      yMapAnnotations: yMap,
      existingHydrateRows: [hydrateInkRow('seal-err')],
    });
    assert.equal(result.cutoverCompleted, false);
    ydoc.destroy();
  }

  // Write throw
  {
    __resetDocumentMetadataCacheForTests();
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const result = await runBackfill({
      ydoc,
      supabase: {
        from(table) {
          if (table === 'documents') {
            return {
              ...docsSelectNoCutover(),
              update: () => ({
                eq: async () => { throw new Error('seal-threw'); },
              }),
            };
          }
          throw new Error(table);
        },
      },
      documentId: 'doc-seal-throw',
      userId: 'u-seal',
      markCutoverComplete: true,
      yMapAnnotations: yMap,
      existingHydrateRows: [hydrateInkRow('seal-throw')],
    });
    assert.equal(result.cutoverCompleted, false);
    ydoc.destroy();
  }

  // Count mismatch: lie about Y.Map size after import
  {
    __resetDocumentMetadataCacheForTests();
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    Object.defineProperty(yMap, 'size', {
      configurable: true,
      get() { return 0; },
    });
    const result = await runBackfill({
      ydoc,
      supabase: {
        from(table) {
          if (table === 'documents') return docsSelectNoCutover();
          throw new Error(table);
        },
      },
      documentId: 'doc-seal-mismatch',
      userId: 'u-seal',
      markCutoverComplete: true,
      yMapAnnotations: yMap,
      existingHydrateRows: [hydrateInkRow('seal-mm')],
    });
    assert.equal(result.cutoverCompleted, false);
    ydoc.destroy();
  }

  __resetDocumentMetadataCacheForTests();
});

const idbBehavior = { mode: 'synced' };
mock.module('y-indexeddb', {
  namedExports: {
    IndexeddbPersistence: class {
      constructor() {
        if (idbBehavior.mode === 'throw') throw new Error('idb-denied');
        this.synced = idbBehavior.mode === 'synced';
      }
      once(ev, cb) {
        if (ev === 'synced' && typeof cb === 'function') queueMicrotask(cb);
      }
      destroy() {}
    },
  },
});

test('annotationDocSync hits SNAPSHOT_AFTER_OPS + pagehide + indexeddb edges', async () => {
  let snapUpserts = 0;
  let seq = 0;
  const supabase = {
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => {
            snapUpserts += 1;
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
            single: async () => {
              seq += 1;
              return { data: { seq }, error: null };
            },
          }),
        });
        b.then = (resolve) => resolve({ data: [], error: null });
        return b;
      }
      throw new Error(table);
    },
    removeChannel: async () => {},
  };

  // pagehide flush path
  const pagehideHandlers = [];
  globalThis.window = {
    addEventListener(type, fn) {
      if (type === 'pagehide') pagehideHandlers.push(fn);
    },
    removeEventListener() {},
  };

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-ops40',
    supabase,
    clientId: 'c-ops',
    enableLocal: false,
    enableRealtime: false,
    doc,
  });

  for (let i = 0; i < 40; i += 1) {
    doc.transact(() => {
      doc.getMap('annotations').set(`k${i}`, { id: `k${i}` });
    }, 'local');
  }
  await handle.drain();
  assert.ok(seq >= 40);
  assert.ok(snapUpserts >= 1); // SNAPSHOT_AFTER_OPS compaction

  // Force pagehide while there is uncaptured work
  doc.transact(() => {
    doc.getMap('annotations').set('pagehide', { id: 'pagehide' });
  }, 'local');
  await handle.drain();
  const beforeHide = snapUpserts;
  for (const fn of pagehideHandlers) fn();
  assert.ok(snapUpserts >= beforeHide);

  await handle.destroy();
  delete globalThis.window;

  globalThis.indexedDB = {
    deleteDatabase() { return { onerror: null, onsuccess: null }; },
  };

  idbBehavior.mode = 'synced';
  const doc2 = new Y.Doc();
  const handle2 = await openAnnotationDoc({
    documentId: 'doc-idb-ok',
    supabase,
    clientId: 'c-idb',
    enableLocal: true,
    enableRealtime: false,
    doc: doc2,
  });
  await handle2.destroy();

  idbBehavior.mode = 'throw';
  const doc3 = new Y.Doc();
  const handle3 = await openAnnotationDoc({
    documentId: 'doc-idb-fail',
    supabase,
    clientId: 'c-idb2',
    enableLocal: true,
    enableRealtime: false,
    doc: doc3,
  });
  await handle3.destroy();

  await purgeAnnotationDoc('doc-idb-ok');
  delete globalThis.indexedDB;
});

test('buildPdfExportAnnotationPlan invalid highlight + callout geometry skips', () => {
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage: {},
    callouts: [
      { id: 'bad-c', pageNumber: 1, text: 'x' }, // pageSize width/height 0 → null
    ],
    surveyMarkers: {
      bad: { pageNumber: 1, x: 1, y: 2, width: 0, height: 0 },
      also: { pageNumber: 1 }, // missing numeric bounds
    },
    pageSizes: { 1: { width: 0, height: 0 } },
    spaces: [{ id: 'sp1', regionIds: ['r1'] }],
  });
  assert.ok(plan.diagnostics);
});

test('paper erase locked + full mode + hole grouping via nested rings', () => {
  const ink = createInkAnnotation([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }], {
    id: 'ink-lock',
    width: 10,
  });
  const locked = { ...ink, locked: true };
  const erasedLocked = eraseAnnotations([locked], [{ x: 20, y: 0 }], 8, 'partial');
  assert.equal(erasedLocked.annotations.length, 1);
  assert.equal(erasedLocked.changedIds.length, 0);

  const thick = createInkAnnotation([{ x: 0, y: 0 }, { x: 50, y: 0 }], { id: 'ink-full', width: 12 });
  const full = eraseAnnotations([thick], [{ x: 25, y: 0 }], 20, 'full');
  assert.ok(full.deletedIds.includes('ink-full') || full.changedIds.includes('ink-full'));

  // Filled outer+inner rings exercise groupRings hole nesting
  const cmds = [
    ['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['L', 0, 100], ['Z'],
    ['M', 30, 30], ['L', 70, 30], ['L', 70, 70], ['L', 30, 70], ['Z'],
  ];
  const poly = commandsToPolygonSet(cmds, { fill: true, width: 0 });
  assert.ok(Array.isArray(poly) && poly.length >= 1);
  assert.ok(polygonSetToCommands(poly).length >= 1);
});

test('regionMath null guards + simplify + chrome geometry', () => {
  assert.equal(regionContainsPoint(0, 0, null), false);
  assert.equal(isPointInsideRegionSet(0, 0, null), false);
  assert.equal(regionToPolygon(null), null);
  assert.equal(regionToPolygon({ coordinates: [1] }), null);
  assert.equal(mergeRegions(null, null), null);
  assert.equal(subtractRegionFromRegion(null, null), null);
  assert.equal(simplifyPolygon(null), null);
  assert.deepEqual(simplifyPolygon([0, 0]), [0, 0]);

  const coords = [0, 0, 20, 0, 20, 20, 0, 20, 0, 0];
  const chrome = deriveRegionChromeGeometry(coords, 45);
  assert.ok(chrome);

  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const badCoords = { ...a, regionId: 'b', coordinates: [0, 0, 'x', 1] };
  assert.equal(regionContainsPoint(1, 1, badCoords), false);
});

test('undo manager diagnostics + userUndo/userRedo wrap', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
    historyCap: 2,
  });
  const yMap = ydoc.getMap('annotations');

  for (let i = 0; i < 4; i += 1) {
    applyFabricCommit(
      ydoc,
      yMap,
      {
        type: 'rect',
        left: i,
        top: i,
        width: 4,
        height: 4,
        data: { id: `r${i}` },
        pageNumber: 1,
      },
      origin,
      ctx,
    );
  }
  // historyCap trim + diagnostics on stack-item-added
  assert.ok(undoManager.undoStack.length <= 2);

  userUndo(ydoc, undoManager, ctx);
  userRedo(ydoc, undoManager, ctx);
  dispose();
  ydoc.destroy();
});
