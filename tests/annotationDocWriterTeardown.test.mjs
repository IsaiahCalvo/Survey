// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — the flat store's durable mark map is `marks` (store v3); these tests use it
// as a generic durable map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { purgeYDoc } from '../src/lib/collab/ydocRegistry.js';
import { ERASE_OUTBOX_MAP } from '../src/utils/annotationEraseTransaction.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function backend({ blockFirstSnapshot = false, blockFirstAppend = false } = {}) {
  const snapshotEntered = deferred(); const snapshotGate = deferred();
  const appendEntered = deferred(); const appendGate = deferred();
  const updates = []; const snapshots = [];
  const result = (value) => {
    const builder = {};
    for (const method of ['select', 'eq', 'gt', 'order', 'limit']) builder[method] = () => builder;
    builder.maybeSingle = async () => value;
    builder.then = (done) => done(value);
    return builder;
  };
  return {
    updates, snapshots, snapshotEntered, snapshotGate, appendEntered, appendGate,
    from(table) {
      if (table === 'annotation_updates') return {
        select: () => result({ data: [] }),
        insert: (row) => ({ select: () => ({ single: async () => {
          updates.push(row);
          if (updates.length === 1) {
            appendEntered.resolve();
            if (blockFirstAppend) await appendGate.promise;
          }
          return { data: { seq: updates.length }, error: null };
        } }) }),
      };
      if (table === 'annotation_snapshots') return {
        select: () => result({ data: null }),
        upsert: async (row) => {
          snapshots.push(row);
          if (snapshots.length === 1) {
            snapshotEntered.resolve();
            if (blockFirstSnapshot) await snapshotGate.promise;
          }
          return { error: null };
        },
      };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}
const shape = (id) => ({ 1: { objects: [{ type: 'rect', left: 1, top: 2, width: 3, height: 4, data: { id } }] } });
function args(t, supabase) {
  const documentId = `writer-teardown-${crypto.randomUUID()}`;
  const actorUserId = 'test-actor';
  t.after(() => purgeYDoc(`annoflat:${documentId}:${actorUserId}`));
  return { documentId, actorUserId, supabase, enableLocal: false, enableRealtime: false,
    outboxStore: createMemoryAnnotationOutbox(),
  };
}

test('closing registry handle never writes a new owner edit while its final snapshot waits', async (t) => {
  const supabase = backend({ blockFirstSnapshot: true });
  const options = args(t, supabase);
  const first = await openAnnotationDoc(options);
  const closing = first.destroy();
  await supabase.snapshotEntered.promise;
  const second = await openAnnotationDoc(options);
  try {
    assert.equal(first.doc, second.doc, 'exercise the production shared registry, not isolated test docs');
    assert.throws(() => first.applyByPage(shape('stale-owner')), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.setMeta('stale-owner', true), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.applySurveyMarkers({ stale: {} }), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.applyEraserMutation(1, {}, { id: 'stale' }), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.applyEraseHistoryTransition({}, 'undo'), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.restoreEraseDeletion([]), { code: 'ANNOTATION_HANDLE_CLOSED' });
    assert.throws(() => first.repairStackedInkDuplicates(), { code: 'ANNOTATION_HANDLE_CLOSED' });
    await assert.rejects(first.commitEraseIntent({ mutationId: 'stale' }), { code: 'ANNOTATION_HANDLE_CLOSED' });
    await assert.rejects(first.flushSnapshot(), { code: 'ANNOTATION_HANDLE_CLOSED' });
    second.applyByPage(shape('new-owner'));
    await second.drain();
    assert.equal(supabase.updates.length, 1, 'one edit must produce one WAL write');
    assert.equal(supabase.updates[0].client_id, second.writerId);
  } finally {
    supabase.snapshotGate.resolve();
    await closing;
    assert.throws(() => first.applyByPage(shape('after-close')), { code: 'ANNOTATION_HANDLE_CLOSED' });
    await second.destroy();
  }
});

test('close drains edits queued before teardown and captures them in its final snapshot', async (t) => {
  const supabase = backend({ blockFirstAppend: true });
  const handle = await openAnnotationDoc(args(t, supabase));
  handle.applyByPage(shape('before-close'));
  await supabase.appendEntered.promise;
  const closing = handle.destroy();
  supabase.appendGate.resolve();
  await closing;
  assert.equal(supabase.updates.length, 1);
  assert.equal(supabase.snapshots.length, 1);
  const saved = supabase.snapshots[0];
  const compressed = Uint8Array.from(Buffer.from(saved.snapshot.slice(2), 'hex'));
  const decoded = new Uint8Array(await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer());
  const cold = new Y.Doc();
  try {
    Y.applyUpdate(cold, decoded);
    assert.ok(cold.getMap('marks').size > 0, 'final snapshot retains queued edit');
  } finally { cold.destroy(); }
});

test('repeated destroy requests share one close and one final snapshot', async (t) => {
  const supabase = backend({ blockFirstSnapshot: true });
  const handle = await openAnnotationDoc(args(t, supabase));
  const first = handle.destroy();
  await supabase.snapshotEntered.promise;
  const second = handle.destroy();
  supabase.snapshotGate.resolve();
  await Promise.all([first, second]);
  assert.equal(supabase.snapshots.length, 1);
});

test('an effect already running at close records its receipt before the final snapshot', { timeout: 3000 }, async (t) => {
  const supabase = backend();
  const effectEntered = deferred(); const effectGate = deferred();
  const handle = await openAnnotationDoc({
    ...args(t, supabase),
    eraseEffectConsumer: async () => { effectEntered.resolve(); await effectGate.promise; },
  });
  handle.doc.transact(() => handle.doc.getMap(ERASE_OUTBOX_MAP).set('erase-before-close', {
    mutationId: 'erase-before-close', actorUserId: 'test-actor', status: 'pending',
    effects: [{ idempotencyKey: 'one-effect', kind: 'history' }], acknowledgedEffectKeys: [],
  }), 'erase-local');
  await effectEntered.promise;
  const closing = handle.destroy();
  effectGate.resolve();
  await closing;
  assert.equal(supabase.updates.length, 2, 'core mutation and exact effect receipt both reach WAL');
  const saved = supabase.snapshots.at(-1);
  const compressed = Uint8Array.from(Buffer.from(saved.snapshot.slice(2), 'hex'));
  const decoded = new Uint8Array(await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer());
  const cold = new Y.Doc();
  try {
    Y.applyUpdate(cold, decoded);
    assert.equal(cold.getMap(ERASE_OUTBOX_MAP).get('erase-before-close').status, 'acknowledged');
  } finally { cold.destroy(); }
});
