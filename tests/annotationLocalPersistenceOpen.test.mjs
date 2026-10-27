// Open speed, round 5 (2026-10-22): the local-persistence copy (y-indexeddb)
// no longer makes Yjs re-encode whole documents at open.
//   * Cold open: the cloud snapshot goes into the empty IndexedDB copy without
//     an 'update' encode, and the snapshot's own bytes are what gets stored.
//   * Reopen: the provider loads its stored updates without an 'update'
//     encode (its store ignores its own origin, so nothing was written).
// Both must leave every document and the stored copy in the same state: the
// stored copy loads to the live doc's state, and edits after the open are
// still stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { docToByPage } from '../src/services/annotationDocStore.js';
import { gunzipBytes, pgHexToBytes } from '../src/services/annotationCheckpointCore.js';

const rect = (id) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  stroke: '#ff0000',
  strokeWidth: 2,
  fill: 'transparent',
  data: { id, type: 'rect' },
});

// The WAL + snapshot row (same shape as annotationOpenSpeed.test.mjs).
function createCloud(documentId) {
  const rows = [];
  let snapshot = null;
  const control = { failAppends: false };
  const readBuilder = () => {
    let gtSeq = null;
    let selected = '';
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve, reject) {
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') data = data.map((row) => ({ client_seq: row.client_seq }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  const makeClient = (actor) => ({
    actor,
    supabase: {
      async rpc(name, args) {
        if (name === 'append_annotation_update') {
          if (control.failAppends) return { data: null, error: { message: 'Failed to fetch' } };
          const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
          if (existing) return { data: [{ seq: existing.seq }], error: null };
          const row = {
            document_id: documentId,
            client_id: args.p_client_id,
            client_seq: args.p_client_seq,
            actor_user_id: actor,
            data: args.p_data,
            seq: rows.length + 1,
          };
          rows.push(row);
          return { data: [{ seq: row.seq }], error: null };
        }
        if (name === 'store_annotation_snapshot') {
          if (control.failAppends) return { data: null, error: { message: 'Failed to fetch' } };
          snapshot = {
            snapshot: args.p_snapshot,
            at_seq: args.p_at_seq,
            encoding_version: args.p_encoding_version,
            writer_id: args.p_writer_id,
            writer_epoch: args.p_writer_epoch,
          };
          return { data: true, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      from(table) {
        if (table === 'annotation_updates') return readBuilder();
        if (table === 'annotation_snapshots') {
          return {
            select(columns) {
              const wantsBody = /(^|[,\s])snapshot([,\s]|$)/.test(columns);
              const b = {
                eq() { return b; },
                async maybeSingle() {
                  if (!snapshot) return { data: null, error: null };
                  if (wantsBody) return { data: { ...snapshot }, error: null };
                  const { snapshot: _body, ...identity } = snapshot;
                  return { data: identity, error: null };
                },
              };
              return b;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  });
  return { rows, control, makeClient, get snapshot() { return snapshot; } };
}

const ids = (byPage) => Object.values(byPage || {})
  .flatMap((page) => (page?.objects || []).map((object) => object?.data?.id))
  .sort();

// Every 'update' event a local-persistence doc emits. Yjs encodes a
// transaction's update only when it emits one, so none means no encode.
function watchPersistenceUpdates() {
  const seen = [];
  const original = Y.Doc.prototype.emit;
  Y.Doc.prototype.emit = function emit(name, args) {
    if (name === 'update' && String(this.guid).startsWith('persistence:')) {
      seen.push({ bytes: args[0].length, origin: args[1] });
    }
    return original.call(this, name, args);
  };
  return { seen, restore() { Y.Doc.prototype.emit = original; } };
}

function withFakeIndexedDb() {
  const previous = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  return () => {
    globalThis.indexedDB = previous.indexedDB;
    globalThis.IDBKeyRange = previous.IDBKeyRange;
  };
}

function readStoredUpdates(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const all = db.transaction('updates', 'readonly').objectStore('updates').getAll();
      all.onsuccess = () => { db.close(); resolve(all.result.map((u) => new Uint8Array(u))); };
      all.onerror = () => { db.close(); reject(all.error); };
    };
  });
}

async function storedCopy(name) {
  const doc = new Y.Doc();
  for (const update of await readStoredUpdates(name)) Y.applyUpdate(doc, update);
  return doc;
}

const sameDocState = (left, right) => (
  Buffer.from(Y.encodeStateAsUpdate(left)).equals(Buffer.from(Y.encodeStateAsUpdate(right)))
);

function openLocal(client, { documentId, outboxStore, clientId }) {
  return openAnnotationDoc({
    documentId,
    supabase: client.supabase,
    clientId,
    actorUserId: client.actor,
    enableLocal: true,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
  });
}

async function seedCloud(documentId, marks) {
  const cloud = createCloud(documentId);
  const writer = cloud.makeClient('writer');
  const handle = await openAnnotationDoc({
    documentId,
    supabase: writer.supabase,
    clientId: 'w1',
    actorUserId: writer.actor,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore: createMemoryAnnotationOutbox(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
  });
  handle.applyByPage({ 1: { objects: marks.map(rect) } });
  await handle.drain();
  assert.equal(await handle.flushSnapshot(), true, 'the checkpoint is written');
  await handle.destroy();
  return cloud;
}

async function snapshotBytes(cloud) {
  let bytes = pgHexToBytes(cloud.snapshot.snapshot);
  if (cloud.snapshot.encoding_version === 2 || bytes[0] === 0x1f) bytes = await gunzipBytes(bytes);
  return bytes;
}

test('a cold open stores the snapshot bytes in the empty local copy without re-encoding them', async () => {
  const restoreIdb = withFakeIndexedDb();
  const documentId = 'local-copy-cold';
  const cloud = await seedCloud(documentId, ['c1', 'c2', 'c3']);
  const reader = cloud.makeClient('reader');
  const dbName = `anno-${documentId}-actor-reader-g0`;
  const watch = watchPersistenceUpdates();
  let handle = null;
  try {
    handle = await openLocal(reader, { documentId, outboxStore: createMemoryAnnotationOutbox(), clientId: 'r1' });
    const duringOpen = watch.seen.length;
    assert.deepEqual(ids(handle.getByPage()), ['c1', 'c2', 'c3']);
    assert.equal(duringOpen, 0, 'no update was encoded for the local copy during the open');

    const snapshot = await snapshotBytes(cloud);
    const stored = await readStoredUpdates(dbName);
    assert.equal(
      stored.filter((u) => Buffer.from(u).equals(Buffer.from(snapshot))).length,
      1,
      'the snapshot is stored once, as its own bytes',
    );
    assert.ok(sameDocState(await storedCopy(dbName), handle.doc), 'the stored copy loads to the live state');

    // The provider's store is attached again: a later edit is stored.
    handle.applyByPage({ 1: { objects: [...handle.getByPage()[1].objects, rect('c4')] } });
    await handle.drain();
    assert.ok(watch.seen.length > duringOpen, 'edits after the open reach the local copy');
    const reloaded = await storedCopy(dbName);
    assert.ok(sameDocState(reloaded, handle.doc), 'the edit is in the stored copy');
  } finally {
    watch.restore();
    await handle?.destroy();
    restoreIdb();
  }
});

test('a reopen loads the local copy without re-encoding it, and keeps storing edits', async () => {
  const restoreIdb = withFakeIndexedDb();
  const documentId = 'local-copy-reopen';
  const cloud = await seedCloud(documentId, ['k1', 'k2']);
  const reader = cloud.makeClient('reader');
  const outbox = createMemoryAnnotationOutbox();
  const dbName = `anno-${documentId}-actor-reader-g0`;

  const first = await openLocal(reader, { documentId, outboxStore: outbox, clientId: 'r1' });
  first.applyByPage({ 1: { objects: [...first.getByPage()[1].objects, rect('k3')] } });
  await first.drain();
  await first.destroy();
  const storedBefore = await readStoredUpdates(dbName);

  const watch = watchPersistenceUpdates();
  let second = null;
  try {
    second = await openLocal(reader, { documentId, outboxStore: outbox, clientId: 'r2' });
    assert.deepEqual(ids(second.getByPage()), ['k1', 'k2', 'k3']);
    assert.equal(watch.seen.length, 0, 'loading the local copy encoded nothing');
    const storedAfterOpen = await readStoredUpdates(dbName);
    assert.ok(storedAfterOpen.length >= storedBefore.length, 'nothing stored was dropped');
    assert.ok(sameDocState(await storedCopy(dbName), second.doc), 'the stored copy still loads to the live state');

    second.applyByPage({ 1: { objects: [...second.getByPage()[1].objects, rect('k4')] } });
    await second.drain();
    assert.ok(watch.seen.length > 0, 'an edit after the reopen reaches the local copy');
    assert.ok(sameDocState(await storedCopy(dbName), second.doc), 'and is stored');
  } finally {
    watch.restore();
    await second?.destroy();
    restoreIdb();
  }
});

// Round 5, part 2: on a reopen the rest of the open (accepted shadow, the
// IndexedDB copy) waits until the viewer has drawn a page, after the saved
// copy is previewed. Only the timing moves: the same scenario with and
// without the wait ends in the same marks, sends the same rows and stores the
// same local copy.
async function reopenScenario({ gate, minBytes = 0 }) {
  const restoreIdb = withFakeIndexedDb();
  const documentId = 'local-copy-first-page';
  const cloud = await seedCloud(documentId, ['s1', 's2']);
  const reader = cloud.makeClient('reader');
  const outbox = createMemoryAnnotationOutbox();
  const dbName = `anno-${documentId}-actor-reader-g0`;
  const events = [];
  let second = null;
  try {
    const first = await openLocal(reader, { documentId, outboxStore: outbox, clientId: 'r1' });
    first.applyByPage({ 1: { objects: [...first.getByPage()[1].objects, rect('mine')] } });
    await first.drain();
    // Then one made offline: only this device has it (local copy, outbox).
    cloud.control.failAppends = true;
    first.applyByPage({ 1: { objects: [...first.getByPage()[1].objects, rect('offline')] } });
    await Promise.race([first.drain().catch(() => {}), new Promise((r) => setTimeout(r, 200))]);
    await first.destroy();
    cloud.control.failAppends = false;

    // Someone else adds a mark after the snapshot (a tail row on reopen).
    const writer = cloud.makeClient('writer');
    const other = await openAnnotationDoc({
      documentId,
      supabase: writer.supabase,
      clientId: 'w2',
      actorUserId: writer.actor,
      enableLocal: false,
      enableRealtime: false,
      doc: new Y.Doc(),
      outboxStore: createMemoryAnnotationOutbox(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
    });
    other.applyByPage({ 1: { objects: [...other.getByPage()[1].objects, rect('theirs')] } });
    await other.drain();
    await other.destroy();
    const rowsBefore = cloud.rows.length;

    let release = null;
    const opening = openAnnotationDoc({
      documentId,
      supabase: reader.supabase,
      clientId: 'r2',
      actorUserId: reader.actor,
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      outboxStore: outbox,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
      onPreview: (byPage, info) => events.push(`preview:${info?.stage}:${ids(byPage).join(',')}`),
      firstPageWaitMinBytes: minBytes,
      whenFirstPageDrawn: gate
        ? () => {
          events.push('waiting-for-page');
          return new Promise((resolve) => { release = resolve; });
        }
        : null,
    }).then((handle) => { events.push('open'); return handle; });
    if (gate && !minBytes) {
      for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.ok(release, 'the open waits for a drawn page after the preview');
      await new Promise((r) => setTimeout(r, 30));
      events.push('page-drawn');
      release();
    }
    second = await opening;
    await second.drain();
    return {
      events,
      marks: ids(second.getByPage()),
      rowsSent: cloud.rows.length - rowsBefore,
      stored: ids(docToByPage(await storedCopy(dbName))),
    };
  } finally {
    await second?.destroy();
    restoreIdb();
  }
}

test('a reopen draws the page before the shadow copies, and ends in the same state', async () => {
  const plain = await reopenScenario({ gate: false });
  const gated = await reopenScenario({ gate: true });
  // The wait comes right after the saved copy is shown, and the open
  // resolves only after the page is drawn; otherwise the same steps.
  assert.deepEqual(gated.events.slice(0, 3), [
    'preview:local-copy:mine,s1,s2',
    'waiting-for-page',
    'page-drawn',
  ]);
  assert.equal(gated.events.at(-1), 'open');
  assert.deepEqual(
    gated.events.filter((e) => e !== 'waiting-for-page' && e !== 'page-drawn'),
    plain.events,
  );
  assert.deepEqual(gated.marks, ['mine', 'offline', 's1', 's2', 'theirs']);
  assert.equal(gated.rowsSent, 1, 'the offline mark is sent once');
  assert.deepEqual(gated.marks, plain.marks);
  assert.equal(gated.rowsSent, plain.rowsSent, 'the same rows are sent');
  assert.deepEqual(gated.stored, plain.stored, 'the same local copy is stored');
});

test('a page that is never drawn does not hold the open back for good', async () => {
  const restoreIdb = withFakeIndexedDb();
  const documentId = 'local-copy-never-drawn';
  const cloud = await seedCloud(documentId, ['n1']);
  const reader = cloud.makeClient('reader');
  const outbox = createMemoryAnnotationOutbox();
  let handle = null;
  try {
    const first = await openLocal(reader, { documentId, outboxStore: outbox, clientId: 'r1' });
    await first.destroy();
    handle = await openAnnotationDoc({
      documentId,
      supabase: reader.supabase,
      clientId: 'r2',
      actorUserId: reader.actor,
      enableLocal: true,
      enableRealtime: false,
      doc: new Y.Doc(),
      outboxStore: outbox,
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
      onPreview: () => {},
      firstPageWaitMinBytes: 0,
      whenFirstPageDrawn: () => new Promise(() => {}),
    });
    assert.deepEqual(ids(handle.getByPage()), ['n1']);
  } finally {
    await handle?.destroy();
    restoreIdb();
  }
});

// A small saved copy's shadow work is a few ms, so it never waits for the
// page: a click right after a reload must not land on the preview blocker for
// up to 2.5 s (e2e selection-bar-clearance deleted nothing after a reload).
test('a small saved copy does not wait for a drawn page', async () => {
  const gated = await reopenScenario({ gate: true, minBytes: 1024 * 1024 });
  assert.ok(!gated.events.includes('waiting-for-page'), 'no wait for a small copy');
  const plain = await reopenScenario({ gate: false });
  assert.deepEqual(gated.events, plain.events);
  assert.deepEqual(gated.marks, plain.marks);
});
