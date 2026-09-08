import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

// Exercise the public handle against an in-memory database boundary. Never
// contact Supabase; preserve real Yjs encoding, queues, and checkpoint logic.
function database() {
  const rows = [];
  const db = {
    rows,
    snapshot: null,
    snapshotWrites: 0,
    beforeInsert: null,
    beforeSnapshot: null,
    snapshotError: null,
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        return db.from('annotation_updates').insert({
          document_id: args.p_document_id, client_id: args.p_client_id,
          client_seq: args.p_client_seq, data: args.p_data,
        }).select().single();
      }
      assert.equal(name, 'store_annotation_snapshot');
      const current = db.snapshot;
      if ((current?.at_seq ?? null) !== args.p_expected_at_seq
        || (current?.writer_id ?? null) !== args.p_expected_writer_id
        || (current?.writer_epoch ?? 0) !== args.p_expected_writer_epoch) {
        return { data: { accepted: false }, error: null };
      }
      const result = await db.from('annotation_snapshots').upsert({
        document_id: args.p_document_id, at_seq: args.p_at_seq,
        snapshot: args.p_snapshot, encoding_version: args.p_encoding_version,
        writer_id: args.p_writer_id, writer_epoch: args.p_writer_epoch,
      });
      return { ...result, data: { accepted: !result.error } };
    },
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.snapshot }) }) }),
          upsert: async (row) => {
            db.snapshotWrites += 1;
            await db.beforeSnapshot?.(row);
            if (db.snapshotError) return { error: db.snapshotError };
            db.snapshot = row;
            return { error: null };
          },
        };
      }
      assert.equal(table, 'annotation_updates');
      let after = null;
      const query = {
        select: () => query,
        eq: () => query,
        gt: (_column, value) => { after = value; return query; },
        order: () => query,
        limit: () => query,
        then: (resolve) => resolve({ data: after == null ? [] : rows.filter((row) => row.seq > after) }),
        insert: (row) => ({ select: () => ({ single: async () => {
          await db.beforeInsert?.(row);
          const committed = { ...row, seq: rows.length + 1 };
          rows.push(committed);
          return { data: { seq: committed.seq }, error: null };
        } }) }),
      };
      return query;
    },
  };
  return db;
}

function open(db, documentId, options = {}) {
  return openAnnotationDoc({
    documentId, actorUserId: 'close-checkpoint-actor', supabase: db,
    enableLocal: false, enableRealtime: false,
    outboxStore: createMemoryAnnotationOutbox(), snapshotRetryDelayMs: 0,
    doc: new Y.Doc(), ...options,
  });
}

test('opening and closing a cloud document without edits does not upload a snapshot', async () => {
  const db = database();
  const handle = await open(db, 'no-edit-close');
  await handle.destroy();
  assert.equal(db.snapshotWrites, 0);
});

test('reading another writer\'s uncheckpointed updates does not cause an upload on close', async () => {
  const db = database();
  const writer = await open(db, 'reader-tail');
  writer.setMeta('note', 'another writer');
  await writer.drain();
  const reader = await open(db, 'reader-tail', { actorUserId: 'reader' });
  assert.equal(reader.getMeta('note'), 'another writer');
  await reader.destroy();
  assert.equal(db.snapshotWrites, 0);
  await writer.destroy();
  assert.equal(db.snapshotWrites, 1, 'the writer still checkpoints its own edit');
});

test('explicit snapshot saves still run without edits, but close does not repeat a saved checkpoint', async () => {
  const db = database();
  const handle = await open(db, 'explicit-save');
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(db.snapshotWrites, 1, 'explicit save keeps its force-checkpoint contract');
  handle.setMeta('note', 'saved edit');
  assert.equal(await handle.flushSnapshot(), true);
  const writesAfterSave = db.snapshotWrites;
  await handle.destroy();
  assert.equal(db.snapshotWrites, writesAfterSave, 'closing does not upload the same saved state');
  const cold = await open(db, 'explicit-save');
  assert.equal(cold.getMeta('note'), 'saved edit');
  await cold.destroy();
  assert.equal(db.snapshotWrites, writesAfterSave, 'reading an existing snapshot does not rewrite it');
});

test('a failed checkpoint is retried at close and retains the edit on a cold open', async () => {
  const db = database();
  const handle = await open(db, 'retry-failed-save');
  handle.setMeta('note', 'keep this');
  db.snapshotError = { code: 'XX000', message: 'temporary snapshot failure' };
  assert.equal(await handle.flushSnapshot(), false);
  const failedWrites = db.snapshotWrites;
  db.snapshotError = null;
  await handle.destroy();
  assert.equal(db.snapshotWrites, failedWrites + 1);
  const cold = await open(db, 'retry-failed-save');
  assert.equal(cold.getMeta('note'), 'keep this');
  await cold.destroy();
});

test('close waits for a pending successful checkpoint without uploading it again', { timeout: 3000 }, async () => {
  const db = database();
  let entered;
  let release;
  const started = new Promise((done) => { entered = done; });
  const gate = new Promise((done) => { release = done; });
  db.beforeSnapshot = async () => { entered(); await gate; };
  const handle = await open(db, 'pending-save-close');
  handle.setMeta('note', 'save in flight');
  const saving = handle.flushSnapshot();
  await started;
  let closed = false;
  const closing = handle.destroy().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  assert.equal(await saving, true);
  await closing;
  assert.equal(db.snapshotWrites, 1);
});

test('an edit made during a pending save still receives a final checkpoint at close', { timeout: 3000 }, async () => {
  const db = database();
  let entered;
  let release;
  const started = new Promise((done) => { entered = done; });
  const gate = new Promise((done) => { release = done; });
  db.beforeSnapshot = async () => {
    if (db.snapshotWrites === 1) { entered(); await gate; }
  };
  const handle = await open(db, 'newer-edit-close');
  handle.setMeta('note', 'old value');
  const saving = handle.flushSnapshot();
  await started;
  handle.setMeta('note', 'new value');
  const closing = handle.destroy();
  release();
  await saving;
  await closing;
  assert.equal(db.snapshotWrites, 2);
  const cold = await open(db, 'newer-edit-close');
  assert.equal(cold.getMeta('note'), 'new value');
  await cold.destroy();
});
