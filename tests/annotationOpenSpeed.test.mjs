// Open speed (w29, 2026-09-24). "Package 2 - Rev 4 -- IC.pdf" (3,071 marks,
// a ~21 MB store, ~6 MB snapshot on the wire) took 6-10 s to show its marks.
// These guard the fixes:
//   * a reopen on the same device does not download an unchanged snapshot
//     row again (its saved copy records which row it holds), and a changed
//     row is still downloaded;
//   * a snapshot this device wrote becomes its saved copy, so the next open
//     here skips it too;
//   * the saved copy / snapshot is handed to the screen (onPreview) before the
//     rest of the open, and the preview writes nothing;
//   * the outbox compaction fast path stores the accepted state as-is only
//     when it holds everything the store has, and merges otherwise;
//   * a local copy that holds nothing new (the same deletions included) is
//     not re-sent, and one with a real local deletion still is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

const rect = (id, extra = {}) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  stroke: '#ff0000',
  strokeWidth: 2,
  fill: 'transparent',
  data: { id, type: 'rect' },
  ...extra,
});

// A stateful stand-in for the Supabase WAL + snapshot row, counting how often
// the snapshot BODY is read (a select that includes the `snapshot` column).
function createCloud(documentId) {
  const rows = [];
  let snapshot = null;
  const stats = { snapshotBodyReads: 0, snapshotIdentityReads: 0, appends: 0 };
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
          stats.appends += 1;
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
                  if (wantsBody) stats.snapshotBodyReads += 1;
                  else stats.snapshotIdentityReads += 1;
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
  return { rows, stats, makeClient, get snapshot() { return snapshot; } };
}

function open(client, { documentId, outboxStore, clientId, onPreview = null }) {
  return openAnnotationDoc({
    documentId,
    supabase: client.supabase,
    clientId,
    actorUserId: client.actor,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    onPreview,
  });
}

const ids = (byPage) => Object.values(byPage || {})
  .flatMap((page) => (page?.objects || []).map((object) => object?.data?.id))
  .sort();

test('a reopen on the same device skips an unchanged snapshot row and shows the same marks', async () => {
  const documentId = 'open-speed-skip';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const outbox = createMemoryAnnotationOutbox();

  const first = await open(alice, { documentId, outboxStore: outbox, clientId: 'a1' });
  first.applyByPage({ 1: { objects: [rect('r1'), rect('r2')] } });
  await first.drain();
  assert.equal(await first.flushSnapshot(), true, 'the checkpoint is written');
  await first.destroy();
  assert.ok(cloud.snapshot, 'a snapshot row exists');

  const bodyReadsBefore = cloud.stats.snapshotBodyReads;
  const second = await open(alice, { documentId, outboxStore: outbox, clientId: 'a2' });
  try {
    assert.equal(
      cloud.stats.snapshotBodyReads,
      bodyReadsBefore,
      'the unchanged row this device wrote is not downloaded again',
    );
    assert.deepEqual(ids(second.getByPage()), ['r1', 'r2']);
    // Still a working handle: a new mark is saved on top of that baseline.
    second.applyByPage({ 1: { objects: [...second.getByPage()[1].objects, rect('r3')] } });
    await second.drain();
  } finally {
    await second.destroy();
  }

  // Someone else on another device (no saved copy) sees all three.
  const bob = cloud.makeClient('user-b');
  const cold = await open(bob, { documentId, outboxStore: createMemoryAnnotationOutbox(), clientId: 'b1' });
  try {
    assert.deepEqual(ids(cold.getByPage()), ['r1', 'r2', 'r3']);
    assert.ok(cloud.stats.snapshotBodyReads > bodyReadsBefore, 'a device without the copy downloads the row');
  } finally {
    await cold.destroy();
  }
});

test('a snapshot row someone else replaced is downloaded, and its marks show', async () => {
  const documentId = 'open-speed-changed-row';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const aliceOutbox = createMemoryAnnotationOutbox();

  const a1 = await open(alice, { documentId, outboxStore: aliceOutbox, clientId: 'a1' });
  a1.applyByPage({ 1: { objects: [rect('r1')] } });
  await a1.drain();
  await a1.flushSnapshot();
  await a1.destroy();

  // Bob adds a mark and writes a newer snapshot row.
  const b1 = await open(bob, { documentId, outboxStore: createMemoryAnnotationOutbox(), clientId: 'b1' });
  b1.applyByPage({ 1: { objects: [...b1.getByPage()[1].objects, rect('r2')] } });
  await b1.drain();
  await b1.flushSnapshot();
  await b1.destroy();

  const before = cloud.stats.snapshotBodyReads;
  const a2 = await open(alice, { documentId, outboxStore: aliceOutbox, clientId: 'a2' });
  try {
    assert.equal(cloud.stats.snapshotBodyReads, before + 1, 'the replaced row is downloaded');
    assert.deepEqual(ids(a2.getByPage()), ['r1', 'r2']);
  } finally {
    await a2.destroy();
  }
});

test('the saved copy is previewed before the open finishes, and the preview writes nothing', async () => {
  const documentId = 'open-speed-preview';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const outbox = createMemoryAnnotationOutbox();

  const first = await open(alice, { documentId, outboxStore: outbox, clientId: 'a1' });
  first.applyByPage({ 2: { objects: [rect('p1')] } });
  await first.drain();
  await first.flushSnapshot();
  await first.destroy();

  const appendsBefore = cloud.stats.appends;
  const previews = [];
  let resolved = false;
  const handlePromise = open(alice, {
    documentId,
    outboxStore: outbox,
    clientId: 'a2',
    onPreview: (byPage, info) => previews.push({ ids: ids(byPage), stage: info?.stage, resolved }),
  });
  const handle = await handlePromise;
  resolved = true;
  try {
    assert.ok(previews.length >= 1, 'the screen got an early paint');
    assert.equal(previews[0].stage, 'local-copy');
    assert.deepEqual(previews[0].ids, ['p1']);
    assert.equal(previews[0].resolved, false, 'before the handle resolved');
    assert.equal(cloud.stats.appends, appendsBefore, 'opening (and previewing) wrote nothing');
    assert.deepEqual(ids(handle.getByPage()), ['p1']);
  } finally {
    await handle.destroy();
  }

  // A device with no saved copy previews the downloaded snapshot instead.
  const coldPreviews = [];
  const cold = await open(cloud.makeClient('user-b'), {
    documentId,
    outboxStore: createMemoryAnnotationOutbox(),
    clientId: 'b1',
    onPreview: (byPage, info) => coldPreviews.push({ ids: ids(byPage), stage: info?.stage }),
  });
  try {
    assert.deepEqual(coldPreviews, [{ ids: ['p1'], stage: 'cloud-snapshot' }]);
  } finally {
    await cold.destroy();
  }

  // An empty document is never previewed.
  const emptyPreviews = [];
  const empty = await open(createCloud('open-speed-preview-empty').makeClient('user-a'), {
    documentId: 'open-speed-preview-empty',
    outboxStore: createMemoryAnnotationOutbox(),
    clientId: 'e1',
    onPreview: () => emptyPreviews.push(1),
  });
  await empty.destroy();
  assert.equal(emptyPreviews.length, 0);
});

test('outbox compaction stores the accepted state as-is only when it holds everything saved', async () => {
  const outbox = createMemoryAnnotationOutbox();
  const documentId = 'compaction-fast-path';
  const actor = 'user-a';
  const docA = new Y.Doc();
  docA.getMap('marks').set('a', 1);
  const a = Y.encodeStateAsUpdate(docA);

  assert.equal(await outbox.compactAccepted(documentId, actor, a, true, 0, {
    covered: { token: null, checkpointUpdate: null, recordKeys: new Set() },
    identity: { atSeq: 3, writerId: 'w1', writerEpoch: 2 },
    token: 't1',
  }), true);
  let clean = await outbox.loadCleanState(documentId, actor);
  assert.equal(clean.checkpointToken, 't1');
  assert.deepEqual(clean.snapshotIdentity, { atSeq: 3, writerId: 'w1', writerEpoch: 2 });

  // Another writer compacts with content this caller never saw (token t2).
  const other = new Y.Doc();
  other.getMap('marks').set('b', 2);
  await outbox.compactAccepted(documentId, actor, Y.encodeStateAsUpdate(other), true, 0, {
    covered: { token: 'not-t1', checkpointUpdate: null, recordKeys: new Set() },
    token: 't2',
  });
  clean = await outbox.loadCleanState(documentId, actor);
  let merged = new Y.Doc();
  Y.applyUpdate(merged, clean.checkpointUpdate);
  assert.deepEqual(merged.getMap('marks').toJSON(), { a: 1, b: 2 }, 'unknown checkpoint → merged, nothing lost');
  assert.deepEqual(
    clean.snapshotIdentity,
    { atSeq: 3, writerId: 'w1', writerEpoch: 2 },
    'a merge keeps the identity of a row the previous checkpoint held',
  );

  // A caller still holding t1 (stale) compacts only its own state: merged.
  await outbox.compactAccepted(documentId, actor, a, true, 0, {
    covered: { token: 't1', checkpointUpdate: null, recordKeys: new Set() },
    token: 't3',
  });
  clean = await outbox.loadCleanState(documentId, actor);
  merged = new Y.Doc();
  Y.applyUpdate(merged, clean.checkpointUpdate);
  assert.deepEqual(merged.getMap('marks').toJSON(), { a: 1, b: 2 }, 'a stale token never drops newer content');

  // The current holder (t3) stores its superset as-is.
  const full = new Y.Doc();
  Y.applyUpdate(full, clean.checkpointUpdate);
  full.getMap('marks').set('c', 3);
  const fullUpdate = Y.encodeStateAsUpdate(full);
  await outbox.compactAccepted(documentId, actor, fullUpdate, true, 0, {
    covered: { token: 't3', checkpointUpdate: null, recordKeys: new Set() },
    token: 't4',
  });
  clean = await outbox.loadCleanState(documentId, actor);
  assert.deepEqual(new Uint8Array(clean.checkpointUpdate), fullUpdate, 'stored as-is, no re-merge');
});

test('a local copy with nothing new is not re-sent; a real local deletion still is', async () => {
  const previousIndexedDb = globalThis.indexedDB;
  try {
    for (const withLocalDeletion of [false, true]) {
      const documentId = `open-speed-persisted-${withLocalDeletion}`;
      const cloud = createCloud(documentId);
      const alice = cloud.makeClient('user-a');
      // Cloud: two marks, one of them later deleted (the delete set is not
      // empty, which used to force a full probe copy on every open).
      const seed = await open(alice, { documentId, outboxStore: createMemoryAnnotationOutbox(), clientId: 's1' });
      seed.applyByPage({ 1: { objects: [rect('k1'), rect('k2'), rect('gone')] } });
      await seed.drain();
      seed.applyByPage({ 1: { objects: seed.getByPage()[1].objects.filter((o) => o.data.id !== 'gone') } });
      await seed.drain();
      await seed.destroy();

      // This device's local copy: exactly the cloud state (+ optionally k2 deleted offline).
      const cloudDoc = new Y.Doc();
      for (const row of cloud.rows) {
        Y.applyUpdate(cloudDoc, new Uint8Array(Buffer.from(row.data.replace(/^\\x/, ''), 'hex')));
      }
      const persisted = new Y.Doc();
      Y.applyUpdate(persisted, Y.encodeStateAsUpdate(cloudDoc));
      if (withLocalDeletion) persisted.getMap('marks').delete('k2');

      const appendsBefore = cloud.stats.appends;
      // The local-persistence path only runs where IndexedDB exists.
      globalThis.indexedDB = {};
      const handle = await openAnnotationDoc({
        documentId,
        supabase: alice.supabase,
        clientId: 'a2',
        actorUserId: alice.actor,
        enableLocal: true,
        enableRealtime: false,
        doc: new Y.Doc(),
        outboxStore: createMemoryAnnotationOutbox(),
        localPersistenceFactory: async (_name, target) => {
          Y.applyUpdate(target, Y.encodeStateAsUpdate(persisted));
          return { synced: true, destroy() {} };
        },
        legacyPersistenceFactory: async () => ({ synced: true, destroy() {}, async clearDocument() {} }),
      });
      try {
        await handle.drain();
        const expected = withLocalDeletion ? ['k1'] : ['k1', 'k2'];
        assert.deepEqual(ids(handle.getByPage()), expected);
        assert.equal(
          cloud.stats.appends - appendsBefore,
          withLocalDeletion ? 1 : 0,
          withLocalDeletion ? 'the offline deletion is sent' : 'nothing is re-sent',
        );
      } finally {
        await handle.destroy();
        globalThis.indexedDB = previousIndexedDb;
      }
    }
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('a merged checkpoint is never claimed as covered, and onlyIfCovered never merges (review A)', async () => {
  const outbox = createMemoryAnnotationOutbox();
  const documentId = 'compaction-merge-then-fast';
  const actor = 'user-a';
  const encode = (entries) => {
    const doc = new Y.Doc();
    for (const [key, value] of Object.entries(entries)) doc.getMap('marks').set(key, value);
    return { doc, update: Y.encodeStateAsUpdate(doc) };
  };
  // Tab 2 stores snapshot Y's content {r} with identity Y.
  const y = encode({ r: 1 });
  await outbox.compactAccepted(documentId, actor, y.update, true, 0, {
    covered: { token: null, checkpointUpdate: null, recordKeys: new Set() },
    identity: { atSeq: 5, writerId: 'w2', writerEpoch: 1 },
    token: 'y',
  });
  // Tab 1 (never saw r) compacts: token mismatch → merged, and says so.
  const one = encode({ a: 1 });
  const outcome = {};
  await outbox.compactAccepted(documentId, actor, one.update, true, 0, {
    covered: { token: 'tab1-old', checkpointUpdate: null, recordKeys: new Set() },
    identity: null,
    token: 'm1',
    outcome,
  });
  assert.equal(outcome.merged, true, 'the caller learns it was a merge');
  // A caller that (wrongly) kept the merged token would store its own state
  // as-is and drop r; the identity must then not fall back to Y.
  one.doc.getMap('marks').set('b', 2);
  await outbox.compactAccepted(documentId, actor, Y.encodeStateAsUpdate(one.doc), true, 0, {
    covered: { token: 'm1', checkpointUpdate: null, recordKeys: new Set() },
    identity: null,
    token: 'm2',
  });
  const clean = await outbox.loadCleanState(documentId, actor);
  assert.equal(clean.snapshotIdentity, null, 'an as-is store never inherits an identity it may not contain');

  // onlyIfCovered: a stale token does nothing at all (no merge, records kept).
  const before = await outbox.loadCleanState(documentId, actor);
  const skipped = await outbox.compactAccepted(documentId, actor, encode({ z: 9 }).update, true, 0, {
    covered: { token: 'stale', checkpointUpdate: null, recordKeys: new Set() },
    identity: { atSeq: 9, writerId: 'w9', writerEpoch: 9 },
    token: 'never',
    onlyIfCovered: true,
  });
  assert.equal(skipped, false);
  const after = await outbox.loadCleanState(documentId, actor);
  assert.equal(after.checkpointToken, before.checkpointToken);
  assert.deepEqual(after.snapshotIdentity, before.snapshotIdentity);
});
