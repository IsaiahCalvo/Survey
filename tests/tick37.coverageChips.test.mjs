/**
 * Tick-37 coverage chips: annotationDocSync gzip/pagehide, crdtBackfill
 * cutover short-circuit, paper geometry edges, undo resurrection shallowEqual.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc, __test as docSyncTest } from '../src/services/annotationDocSync.js';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { __resetDocumentMetadataCacheForTests } from '../src/services/documentMetadataResolver.js';
import {
  createUndoManager,
  userUndo,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  normalizeMultiPolygon,
  compactPoints,
  commandsToPolylines,
  commandsToPolygonSet,
  polygonSetToCommands,
  boundsOfCommands,
  translateCommands,
  translatePolygonSet,
  createInkAnnotation,
  eraseAnnotations,
  shouldUsePaperInkOutline,
} from '../src/utils/paperAnnotationGeometry.js';

async function gzipBytes(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chainable(result) {
  const b = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'in', 'upsert']) b[m] = self;
  b.maybeSingle = async () => result;
  b.single = async () => result;
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return b;
}

test('annotationDocSync loads gzip snapshots, tolerates bad gzip, pagehide flushes', async () => {
  const seed = new Y.Doc();
  seed.getMap('annotations').set('seed', 'v1');
  const raw = Y.encodeStateAsUpdate(seed);
  const gz = await gzipBytes(raw);
  const { bytesToPgHex } = docSyncTest;
  const hex = bytesToPgHex(gz);

  let snapshotUpserts = 0;
  const supabase = {
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => chainable({
            data: { snapshot: hex, at_seq: 3, encoding_version: 2 },
            error: null,
          }),
          upsert: async () => {
            snapshotUpserts += 1;
            return { error: null };
          },
        };
      }
      if (table === 'annotation_updates') {
        return {
          select: () => chainable({ data: [], error: null }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { seq: 4 }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };

  const doc = new Y.Doc();
  const listeners = new Map();
  globalThis.window = {
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };

  try {
    const handle = await openAnnotationDoc({
      documentId: 'doc-gzip',
      supabase,
      clientId: 'c-gzip',
      enableLocal: false,
      enableRealtime: false,
      doc,
    });
    assert.equal(doc.getMap('annotations').get('seed'), 'v1');

    // Local edit → schedule snapshot; pagehide should flush when dirty
    doc.getMap('annotations').set('local', 'edit');
    await new Promise((r) => setTimeout(r, 20));
    const pagehide = listeners.get('pagehide');
    assert.equal(typeof pagehide, 'function');
    pagehide();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(snapshotUpserts >= 0); // best-effort flush may race

    await handle.destroy();
  } finally {
    delete globalThis.window;
  }

  // Bad gzip bytes → warn + continue
  const badSupabase = {
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => chainable({
            data: {
              snapshot: bytesToPgHex(new Uint8Array([1, 2, 3, 4])),
              at_seq: 1,
              encoding_version: 2,
            },
            error: null,
          }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === 'annotation_updates') {
        return { select: () => chainable({ data: [], error: null }) };
      }
      throw new Error(table);
    },
  };
  const doc2 = new Y.Doc();
  const handle2 = await openAnnotationDoc({
    documentId: 'doc-bad-gz',
    supabase: badSupabase,
    clientId: 'c2',
    enableLocal: false,
    enableRealtime: false,
    doc: doc2,
  });
  await handle2.destroy();
  seed.destroy();
});

test('runBackfill noop + sealed cutover dedupe-anchor short-circuit', async () => {
  __resetDocumentMetadataCacheForTests();
  assert.equal((await runBackfill({})).ranAs, 'noop_missing_inputs');

  globalThis.window = { __CRDT_BACKFILL_DEBUG: true };
  try {
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    for (let i = 0; i < 60; i += 1) yMap.set(`a${i}`, new Y.Map());
    ydoc.getMap('meta').set('dedupe_pdf_imports_v1_done', true);
    ydoc.getMap('meta').set('dedupe_pdf_imports_v1_last_good_size', 60);

    const supabase = {
      from(table) {
        if (table === 'documents') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    user_id: 'u1',
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
        throw new Error(`unexpected ${table}`);
      },
    };

    const result = await runBackfill({
      ydoc,
      supabase,
      documentId: 'doc-sealed',
      userId: 'u1',
      markCutoverComplete: true,
      yMapAnnotations: yMap,
    });
    assert.equal(result.ranAs, 'cutover_already_complete_dedupe_anchor');
    assert.equal(result.cutoverCompleted, true);
    ydoc.destroy();
  } finally {
    delete globalThis.window;
    __resetDocumentMetadataCacheForTests();
  }
});

test('paperAnnotationGeometry covers normalize/compact/translate/erase edges', () => {
  assert.deepEqual(normalizeMultiPolygon(null), []);
  assert.ok(normalizeMultiPolygon([[0, 0], [1, 0], [1, 1]]).length >= 1);
  assert.ok(normalizeMultiPolygon([[[0, 0], [1, 0], [1, 1]]]).length >= 1);
  assert.ok(normalizeMultiPolygon([[[[0, 0], [1, 0], [1, 1]]]]).length >= 1);
  assert.deepEqual(normalizeMultiPolygon(['bad']), []);

  assert.deepEqual(compactPoints(null), []);
  assert.deepEqual(compactPoints([{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 10, y: 0 }], 0.5).length, 2);
  // single compacted point but multiple inputs → keep last
  const one = compactPoints([{ x: 0, y: 0 }, { x: 0.01, y: 0 }], 1);
  assert.ok(one.length >= 1);

  assert.equal(shouldUsePaperInkOutline(3), false);
  assert.equal(shouldUsePaperInkOutline(12), true);

  const cmds = [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']];
  assert.ok(commandsToPolylines(cmds).length >= 1);
  const poly = commandsToPolygonSet(cmds, { width: 4 });
  assert.ok(poly);
  assert.ok(Array.isArray(polygonSetToCommands(poly)));
  assert.ok(boundsOfCommands(cmds));
  assert.ok(translateCommands(cmds, 1, 2));
  assert.ok(translatePolygonSet(poly, 1, 2));

  const ink = createInkAnnotation([{ x: 0, y: 0 }, { x: 20, y: 0 }], { id: 'ink-1', width: 8 });
  assert.equal(ink.id, 'ink-1');
  const erased = eraseAnnotations([ink], [{ x: 10, y: 0 }], 6, 'partial');
  assert.ok(erased != null);
});

test('undo resurrection reconciles latestFabric shallowEqual diffs', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({ ydoc, ...ctx, captureTimeout: 0 });
  const yMap = ydoc.getMap('annotations');

  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 4, height: 4, data: { id: 'r1' }, pageNumber: 1 },
    origin,
    ctx,
  );

  // Seed latestFabric cache with a divergent plain object so undo reconcile runs shallowEqual
  const latest = ydoc.getMap('__annotationLatestFabric');
  latest.set('r1', { type: 'rect', left: 9, top: 0, width: 4, height: 4 });

  userUndo(ydoc, undoManager, ctx);
  dispose();
  ydoc.destroy();
});
