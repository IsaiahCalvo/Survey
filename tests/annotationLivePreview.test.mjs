// w30 (2026-09-24): live sync fast path.
//
// A stroke drawn on one screen used to reach another only as its WAL row came
// back through Postgres Changes (~1 s; several seconds on a big document). Now
// each small local edit is also broadcast the moment it is made, and other
// screens show it as a PREVIEW: in the live doc only, never accepted,
// persisted or checkpointed until its own WAL row arrives. These tests pin:
//   * the broadcast leaves before (independent of) the WAL insert;
//   * the receiver applies it with no log read, and the later row causes no
//     second repaint;
//   * a preview is never checkpointed by the receiver;
//   * an edit made on top of a preview waits for the preview's row, and is
//     rolled back if that row never comes (the phantom leaves the screen);
//   * the compaction checkpoint no longer holds the append queue;
//   * a failed append still checkpoints the edit (lazy repair checkpoint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import * as Y from 'yjs';
import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';

const rect = (id, extra = {}) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  fill: 'transparent',
  stroke: '#ff0000',
  strokeWidth: 2,
  opacity: 1,
  meta: { authorId: 'user-a' },
  data: { id, type: 'shape', authorId: 'user-a' },
  ...extra,
});

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, { timeoutMs = 3_000, stepMs = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await settle(stepMs);
  }
  return false;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// One fake backend: a WAL table with Postgres-Changes delivery, a snapshot
// row, and a Broadcast topic per document. Each client has its own socket, so
// a broadcast reaches every OTHER client joined to the topic.
function createCloud(documentId) {
  const rows = [];
  const sent = [];
  let snapshot = null;
  const pgChannels = new Set();
  const liveChannels = new Set();
  const cloud = {
    rows,
    sent,
    get snapshot() { return snapshot; },
    snapshotGate: null,
    snapshotCalls: 0,
  };
  const deliverRow = (row) => {
    for (const channel of pgChannels) {
      if (channel.client.online) queueMicrotask(() => channel.insert?.({ new: row }));
    }
  };
  const readBuilder = (client) => {
    let gtSeq = null;
    let selected = '';
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      abortSignal() { return builder; },
      then(resolve, reject) {
        if (gtSeq != null) client.tailReads += 1;
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') {
          data = data.map((row) => ({ client_seq: row.client_seq }))
            .sort((l, r) => r.client_seq - l.client_seq);
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  cloud.makeClient = (actor) => {
    const client = {
      actor,
      online: true,
      appendCalls: 0,
      tailReads: 0,
      appendGate: null,     // a promise: appends wait for it
      appendError: null,    // { code, message }: appends fail with it
      liveTopics: [],
    };
    client.supabase = {
      async rpc(name, args) {
        if (name === 'append_annotation_update') {
          client.appendCalls += 1;
          if (client.appendGate) await client.appendGate;
          if (client.appendError) return { data: null, error: client.appendError };
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
          deliverRow(row);
          return { data: [{ seq: row.seq }], error: null };
        }
        if (name === 'store_annotation_snapshot') {
          cloud.snapshotCalls += 1;
          if (cloud.snapshotGate) await cloud.snapshotGate;
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
        if (table === 'annotation_updates') return readBuilder(client);
        if (table === 'annotation_snapshots') {
          return {
            select() {
              const b = { eq() { return b; }, async maybeSingle() { return { data: snapshot, error: null }; } };
              return b;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      channel(topic) {
        if (String(topic).startsWith('anno-live:')) {
          client.liveTopics.push(topic);
          const live = { client, topic, handler: null, joined: false };
          liveChannels.add(live);
          const api = {
            on(_type, _filter, callback) { live.handler = callback; return api; },
            subscribe(callback) {
              queueMicrotask(() => { live.joined = true; callback('SUBSCRIBED'); });
              return api;
            },
            send(message) {
              sent.push({ from: actor, at: Date.now(), rowsAtSend: rows.length, payload: message.payload });
              for (const other of liveChannels) {
                if (other === live || other.topic !== topic || !other.joined) continue;
                queueMicrotask(() => other.handler?.({ payload: message.payload }));
              }
              return Promise.resolve('ok');
            },
          };
          live.api = api;
          return api;
        }
        const channel = { client, insert: null };
        pgChannels.add(channel);
        client.pgChannel = channel;
        return {
          on(_event, _filter, callback) { channel.insert = callback; return this; },
          subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; },
        };
      },
      async removeChannel(channel) {
        for (const live of liveChannels) if (live.api === channel) liveChannels.delete(live);
        if (client.pgChannel) pgChannels.delete(client.pgChannel);
      },
    };
    return client;
  };
  return cloud;
}

const openFor = (client, documentId, extra = {}) => openAnnotationDoc({
  documentId,
  supabase: client.supabase,
  clientId: `${client.actor}-install`,
  actorUserId: client.actor,
  enableLocal: false,
  enableRealtime: true,
  doc: new Y.Doc(),
  livePreview: true,
  repairRetryDelayMs: 60_000,
  snapshotRetryDelayMs: 0,
  requestTimeoutMs: 2_000,
  ...extra,
});

const hasMark = (handle, id) => (handle.getByPage()?.[1]?.objects || [])
  .some((object) => object?.data?.id === id);

const snapshotHasMark = (cloud, id) => {
  if (!cloud.snapshot) return false;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, gunzipSync(__test.pgHexToBytes(cloud.snapshot.snapshot)));
  return doc.getMap('marks').has(id);
};

test('a stroke reaches the other screen before its WAL row exists, with no log read, and its row causes no second repaint', async () => {
  const documentId = 'live-preview-fast-path';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  await settle();
  let bobRepaints = 0;
  b.onChange(() => { bobRepaints += 1; });
  const bobTailReadsBefore = bob.tailReads;

  const gate = deferred();
  alice.appendGate = gate.promise; // the WAL insert is slow
  a.applyByPage({ 1: { objects: [rect('stroke-1')] } });

  assert.equal(cloud.sent.length, 1, 'the edit is broadcast at once');
  assert.equal(cloud.sent[0].rowsAtSend, 0, 'before its WAL row is written');
  assert.ok(await until(() => hasMark(b, 'stroke-1')), 'the other screen shows it while the insert is still running');
  assert.equal(cloud.rows.length, 0);
  assert.equal(bobRepaints, 1, 'one repaint for the preview');
  assert.equal(bob.tailReads, bobTailReadsBefore, 'no log read on the fast path');

  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => cloud.rows.length === 1));
  await settle(30);
  assert.equal(bobRepaints, 1, 'its row (already shown) does not repaint again');
  assert.ok(hasMark(b, 'stroke-1'));

  // Bob can edit it right away: the preview was confirmed by its row, so his
  // edit is not held.
  const screen = b.getByPage();
  b.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, width: 222 })) } });
  await b.drain();
  assert.ok(await until(() => a.getByPage()[1].objects[0].width === 222));
  await a.destroy();
  await b.destroy();
});

test('the receiver never checkpoints a preview; a refused edit\'s phantom leaves the screen', async () => {
  const documentId = 'live-preview-refused';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId, {
    livePreviewTimings: { confirmMs: 40, expireMs: 120, sweepMs: 25, remoteRefWaitMs: 150 },
  });
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  // Alice's write will be refused (e.g. the document was just locked).
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  a.applyByPage({ 1: { objects: [rect('refused-1')] } });
  assert.ok(await until(() => hasMark(b, 'refused-1')), 'Bob sees the preview');

  assert.equal(await b.flushSnapshot(), true);
  assert.equal(snapshotHasMark(cloud, 'refused-1'), false, 'Bob\'s checkpoint holds only accepted rows');

  assert.ok(
    await until(() => !hasMark(b, 'refused-1'), { timeoutMs: 3_000 }),
    'a preview whose row never comes is taken off the screen',
  );
  // Bob keeps working normally afterwards (his edits are rebased).
  const screen = b.getByPage();
  b.applyByPage({ 1: { ...(screen[1] || {}), objects: [...(screen[1]?.objects || []), rect('bob-1')] } });
  await b.drain();
  assert.ok(cloud.rows.some((row) => row.actor_user_id === 'user-b'));
  assert.ok(await until(() => hasMark(a, 'bob-1')), 'Bob\'s later edit reaches Alice');
  assert.equal(b.isSyncHealthy(), true);
  await a.destroy();
  await b.destroy();
});

test('an edit made on a preview waits for the preview\'s row, then goes through', async () => {
  const documentId = 'live-preview-dependent-edit';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());

  const gate = deferred();
  alice.appendGate = gate.promise;
  a.applyByPage({ 1: { objects: [rect('moved-1')] } });
  assert.ok(await until(() => hasMark(b, 'moved-1')));

  // Bob moves Alice's stroke before its row exists.
  const screen = b.getByPage();
  b.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 300 })) } });
  await settle(60);
  assert.equal(bob.appendCalls, 0, 'Bob\'s row waits: it builds on a struct not yet in the log');

  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => bob.appendCalls === 1), 'released once Alice\'s row arrived');
  await b.drain();
  assert.deepEqual(cloud.rows.map((row) => row.actor_user_id), ['user-a', 'user-b'], 'log order: the stroke, then the move');
  assert.ok(await until(() => a.getByPage()[1].objects[0].left === 300), 'Alice sees Bob\'s move');
  // A fresh open from the log alone holds both.
  const carol = cloud.makeClient('user-c');
  const c = await openFor(carol, documentId, { livePreview: false });
  assert.equal(c.getByPage()[1].objects[0].left, 300);
  await Promise.all([a.destroy(), b.destroy(), c.destroy()]);
});

test('an edit made on a preview that never reaches the log is rolled back', async () => {
  const documentId = 'live-preview-dependent-refused';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId, {
    livePreviewTimings: { confirmMs: 40, expireMs: 120, sweepMs: 25, remoteRefWaitMs: 150 },
  });
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  const quarantines = [];
  b.onHistoryQuarantine((event) => quarantines.push(event));

  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  a.applyByPage({ 1: { objects: [rect('ghost-1')] } });
  assert.ok(await until(() => hasMark(b, 'ghost-1')));
  const screen = b.getByPage();
  b.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 400 })) } });

  assert.ok(await until(() => quarantines.length > 0, { timeoutMs: 3_000 }), 'the dependent edit is rolled back');
  assert.equal(quarantines[0].reason, 'unconfirmed-remote-edit');
  assert.equal(cloud.rows.length, 0, 'nothing that builds on the refused stroke reached the log');
  assert.ok(await until(() => !hasMark(b, 'ghost-1'), { timeoutMs: 3_000 }));
  await a.destroy();
  await b.destroy();
});

test('the compaction checkpoint does not hold the append queue', async () => {
  const documentId = 'live-preview-compaction';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const a = await openFor(alice, documentId, { livePreview: false });
  const gate = deferred();
  cloud.snapshotGate = gate.promise; // a slow multi-MB checkpoint upload
  for (let index = 0; index < 45; index += 1) {
    a.setMeta(`k${index}`, index);
    // Let each row land before the next edit, as separate strokes would.
    await until(() => cloud.rows.length === index + 1, { timeoutMs: 1_000, stepMs: 2 });
  }
  assert.ok(cloud.snapshotCalls >= 1, 'the 40-row checkpoint started');
  assert.equal(cloud.rows.length, 45, 'rows kept flowing while it uploads');
  gate.resolve();
  cloud.snapshotGate = null;
  await a.destroy();
});

test('a failed append still checkpoints the edit (repair checkpoint rebuilt on demand)', async () => {
  const documentId = 'live-preview-lazy-checkpoint';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const a = await openFor(alice, documentId, { livePreview: false });
  a.applyByPage({ 1: { objects: [rect('kept-1')] } });
  await a.drain();
  alice.appendError = { code: 'XX000', message: 'network down' };
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: [...screen[1].objects, rect('kept-2')] } });
  await a.drain();
  await settle(30);
  assert.equal(a.isSyncHealthy(), true, 'the repair checkpoint closed the gap');
  assert.ok(snapshotHasMark(cloud, 'kept-1'));
  assert.ok(snapshotHasMark(cloud, 'kept-2'), 'the edit whose append failed is in the checkpoint');
  alice.appendError = null;
  await a.destroy();
});

test('live previews are off unless asked for: no live channel is joined', async () => {
  const documentId = 'live-preview-off';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const a = await openFor(alice, documentId, { livePreview: false });
  a.applyByPage({ 1: { objects: [rect('plain-1')] } });
  await a.drain();
  assert.deepEqual(alice.liveTopics, []);
  assert.equal(cloud.sent.length, 0);
  await a.destroy();
});
