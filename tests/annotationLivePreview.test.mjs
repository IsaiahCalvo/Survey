// w30 (2026-09-24): live sync fast path.
//
// A stroke drawn on one screen used to reach another only as its WAL row came
// back through Postgres Changes (~1 s; several seconds on a big document). Now
// each small new mark is also broadcast the moment it is drawn, and other
// screens show it as a PREVIEW until its own WAL row arrives: display only,
// never in their Y.Doc. These tests pin:
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
import { writeAnnotationMark } from '../src/services/annotationDocStore.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';
import { mintPastedCloneIdentity } from '../src/utils/pasteCloneIdentity.js';

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
  // A message from outside any client (a forged or broken sender).
  cloud.inject = (payload) => {
    for (const live of liveChannels) {
      if (live.joined) queueMicrotask(() => live.handler?.({ payload }));
    }
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
              client.liveJoins = (client.liveJoins || 0) + 1;
              if (cloud.refuseLive) {
                // No channel policy: Realtime refuses the private join.
                queueMicrotask(() => callback('CHANNEL_ERROR', new Error('Unauthorized')));
                return api;
              }
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

const previewIds = (handle) => Object.values(handle.getLivePreviewByPage())
  .flatMap((objects) => objects.map((object) => object?.data?.id));

// What the app's screen holds: the document plus the overlay (useAnnotationDoc
// merges them the same way).
const screenOf = (handle) => {
  const byPage = handle.getByPage();
  for (const [pageNumber, objects] of Object.entries(handle.getLivePreviewByPage())) {
    const page = byPage[pageNumber] || { objects: [] };
    byPage[pageNumber] = { ...page, objects: [...(page.objects || []), ...objects] };
  }
  return byPage;
};

test('a new stroke reaches the other screen before its WAL row exists, with no log read, and leaves the overlay when its row lands', async () => {
  const documentId = 'live-preview-fast-path';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  await settle();
  let previewChanges = 0;
  let docChanges = 0;
  b.onLivePreviewChange(() => { previewChanges += 1; });
  b.onChange(() => { docChanges += 1; });
  const bobTailReadsBefore = bob.tailReads;

  const gate = deferred();
  alice.appendGate = gate.promise; // the WAL insert is slow
  a.applyByPage({ 1: { objects: [rect('stroke-1')] } });

  assert.equal(cloud.sent.length, 1, 'the new mark is broadcast at once');
  assert.equal(cloud.sent[0].rowsAtSend, 0, 'before its WAL row is written');
  assert.ok(await until(() => previewIds(b).includes('stroke-1')), 'the other screen shows it while the insert is still running');
  assert.equal(previewChanges, 1);
  assert.equal(hasMark(b, 'stroke-1'), false, 'shown beside the document, never in it');
  assert.equal(bob.tailReads, bobTailReadsBefore, 'no log read on the fast path');

  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => hasMark(b, 'stroke-1')), 'its row brings the real mark');
  assert.deepEqual(previewIds(b), [], 'and the overlay copy leaves');
  assert.ok(docChanges >= 1);

  // Bob can edit it normally now.
  const screen = b.getByPage();
  b.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, width: 222 })) } });
  await b.drain();
  assert.ok(await until(() => a.getByPage()[1].objects[0].width === 222));

  // Alice's next stroke is not her Yjs client's first struct: it is
  // previewed all the same.
  const gate2 = deferred();
  alice.appendGate = gate2.promise;
  const aliceScreen = a.getByPage();
  a.applyByPage({ 1: { ...aliceScreen[1], objects: [...aliceScreen[1].objects, rect('stroke-2')] } });
  assert.ok(await until(() => previewIds(b).includes('stroke-2')), 'a later stroke is previewed too');
  gate2.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => hasMark(b, 'stroke-2') && previewIds(b).length === 0));
  await a.destroy();
  await b.destroy();
});

test('a screen never writes, checkpoints or builds on another screen\'s preview, even when it edits it', async () => {
  const documentId = 'live-preview-never-written';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());

  const gate = deferred();
  alice.appendGate = gate.promise;
  a.applyByPage({ 1: { objects: [rect('shared-1')] } });
  assert.ok(await until(() => previewIds(b).includes('shared-1')));

  // Bob's screen holds the preview (as the app's page list does) and he moves
  // it before its row exists: nothing of it is written by Bob.
  const screen = screenOf(b);
  b.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 300 })) } });
  await b.drain();
  assert.equal(bob.appendCalls, 0, 'the preview is not Bob\'s edit');
  assert.equal(await b.flushSnapshot(), true);
  assert.equal(snapshotHasMark(cloud, 'shared-1'), false, 'nor in Bob\'s checkpoint');

  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => hasMark(b, 'shared-1')));
  assert.equal(b.getByPage()[1].objects[0].left, 10, 'Alice\'s stroke as she drew it');
  assert.deepEqual(cloud.rows.map((row) => row.actor_user_id), ['user-a']);
  await a.destroy();
  await b.destroy();
});

test('a refused stroke\'s preview leaves the screen and is never written, even by an Undo that brings it back', async () => {
  const documentId = 'live-preview-refused';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId, { livePreviewTimings: { expireMs: 80, sweepMs: 20 } });
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  // Alice's write is refused (e.g. the document was just locked).
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  a.applyByPage({ 1: { objects: [rect('refused-1')] } });
  assert.ok(await until(() => previewIds(b).includes('refused-1')), 'Bob sees the preview');
  const staleScreen = screenOf(b);
  assert.ok(await until(() => previewIds(b).length === 0), 'it expires');

  // An Undo restores a page list captured while it was on screen.
  b.applyByPage(staleScreen);
  b.applyByPage({ 1: { objects: [...(staleScreen[1]?.objects || []), rect('bob-1')] } });
  await b.drain();
  assert.equal(hasMark(b, 'refused-1'), false);
  assert.ok(hasMark(b, 'bob-1'), 'Bob\'s own new mark is written as usual');
  assert.deepEqual(cloud.rows.map((row) => row.actor_user_id), ['user-b']);
  assert.ok(await until(() => hasMark(a, 'bob-1')), 'and reaches Alice');
  assert.equal(b.isSyncHealthy(), true);
  await a.destroy();
  await b.destroy();
});

test('only brand-new marks are previewed; edits, deletions and forged or flooding messages are ignored', async () => {
  const documentId = 'live-preview-only-new';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  a.applyByPage({ 1: { objects: [rect('existing-1')] } });
  await a.drain();
  assert.ok(await until(() => hasMark(b, 'existing-1')));
  let previewChanges = 0;
  b.onLivePreviewChange(() => { previewChanges += 1; });

  // An edit of an existing mark needs structs the message does not carry.
  const gate = deferred();
  alice.appendGate = gate.promise;
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, stroke: '#0000ff' })) } });
  await settle(40);
  // w32 (owner request 2026-09-25, deliberate change of this w30 assertion):
  // edits of existing marks now reach other screens early too, but as a v2
  // display overlay (annotationLiveOverlay.js), never as a v1 new-mark
  // preview. What still holds from w30: no new-mark preview is made from an
  // edit, and the document does not change before the row.
  assert.deepEqual(previewIds(b), [], 'an edit is never a new-mark preview');
  assert.equal(b.getByPage()[1].objects[0].stroke, '#ff0000', 'the document waits for the row');
  assert.equal(
    b.withLiveOverlays(b.getByPage())[1].objects[0].stroke,
    '#0000ff',
    'the screen shows the edit at once (w32 overlay)',
  );
  assert.equal(previewChanges, 1, 'one overlay arrival');
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => b.getByPage()[1].objects[0].stroke === '#0000ff'));

  // Forged and malformed messages on the channel.
  const forge = (payload) => cloud.inject(payload);
  forge({ v: 1, w: 'x', s: 1, u: 'not base64 !!' });
  forge({ v: 1, w: 'x', s: 2, u: 'AAAA' });
  const deleter = new Y.Doc();
  deleter.getMap('marks').set('tmp', 1);
  const deleteOnly = Y.encodeStateAsUpdate(deleter);
  forge({ v: 1, w: 'x', s: 3, u: Buffer.from(deleteOnly).toString('base64') });
  await settle(20);
  assert.deepEqual(previewIds(b), [], 'malformed and delete-only messages show nothing');
  // A flood from one writer is capped per second.
  // RULED 2026-09-28 (flake fix, assertion unchanged): the receive cap is a
  // per-second window on Date.now(); under full-suite load the 120 forged
  // messages could straddle a second boundary and get 2 windows' worth
  // through. Pin the clock so the flood lands inside one window.
  const realNow = Date.now;
  const frozenNow = realNow();
  Date.now = () => frozenNow;
  try {
  for (let index = 0; index < 120; index += 1) {
    const flood = new Y.Doc();
    writeAnnotationMark(flood, `flood-${index}`, 1, rect(`flood-${index}`));
    const update = Y.encodeStateAsUpdate(flood);
    forge({ v: 1, w: 'flooder', s: index + 1, u: Buffer.from(update).toString('base64') });
  }
  await settle(40);
  } finally {
    Date.now = realNow;
  }
  const shown = previewIds(b).length;
  assert.ok(shown > 0 && shown <= 50, `a flood is capped per writer (${shown} shown)`);
  await a.destroy();
  await b.destroy();
});

test('the compaction checkpoint does not hold the append queue', async () => {
  const documentId = 'live-preview-compaction';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  // w33: the row-40 checkpoint waits for a quiet moment; none here.
  const a = await openFor(alice, documentId, { livePreview: false, checkpointPolicy: { dueQuietMs: 0 } });
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

test('a refused private join is not retried; edits still arrive through the log', async () => {
  const documentId = 'live-preview-refused-join';
  const cloud = createCloud(documentId);
  cloud.refuseLive = true;
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  await settle(30);
  a.applyByPage({ 1: { objects: [rect('log-only-1')] } });
  await a.drain();
  assert.equal(cloud.sent.length, 0, 'nothing is broadcast on a refused channel');
  assert.ok(await until(() => hasMark(b, 'log-only-1')), 'the WAL row still delivers it');
  await a.destroy();
  // Reopening within the back-off does not knock on the channel again.
  const again = await openFor(alice, documentId);
  await settle(30);
  assert.equal(alice.liveJoins, 1, 'one refused join, no retry storm');
  await Promise.all([again.destroy(), b.destroy()]);
});

test('a copy of a preview never gets written: not from a cached page list on reopen, not re-keyed, not by a second announcer', async () => {
  const documentId = 'live-preview-copies';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId, { livePreviewTimings: { expireMs: 80, sweepMs: 20 } });
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  a.applyByPage({ 1: { objects: [rect('cached-1')] } });
  assert.ok(await until(() => previewIds(b).includes('cached-1')));
  // What a display cache or a Save backup would hold: a JSON copy.
  const cachedList = JSON.parse(JSON.stringify(screenOf(b)));
  // The same key announced again by someone else is ignored.
  const other = new Y.Doc();
  writeAnnotationMark(other, 'cached-1', 1, rect('cached-1', { left: 999 }));
  cloud.inject({ v: 1, w: 'someone-else', s: 1, u: Buffer.from(Y.encodeStateAsUpdate(other)).toString('base64') });
  await settle(20);
  assert.equal(Object.values(b.getLivePreviewByPage()).flat().length, 1, 'one copy on screen');
  await b.destroy();

  // Bob reopens; the store is empty and the viewer seeds from its cached list.
  const b2 = await openFor(bob, documentId);
  b2.applyByPage(cachedList);
  // A re-keyed clone (a duplicate id repair) is still recognised.
  const rekeyed = JSON.parse(JSON.stringify(cachedList));
  rekeyed[1].objects = rekeyed[1].objects.map((o) => ({ ...o, data: { ...o.data, id: 'rect-fresh' } }));
  b2.applyByPage(rekeyed);
  await b2.drain();
  assert.equal(bob.appendCalls, 0, 'a preview copy is never Bob\'s edit');
  assert.equal(cloud.rows.length, 0);
  await Promise.all([a.destroy(), b2.destroy()]);
});

test('erasing across another screen\'s in-flight stroke writes nothing of it, not even an eraser lane', async () => {
  const documentId = 'live-preview-eraser';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  a.applyByPage({ 1: { objects: [rect('erased-1', { left: 777, stroke: '#123456' })] } });
  assert.ok(await until(() => previewIds(b).includes('erased-1')));
  const screen = screenOf(b);
  const base = screen[1].objects.find((o) => o.data.id === 'erased-1');
  const survivor = { ...base, width: 40 };
  b.applyEraserMutation(1, { ...screen[1], objects: [survivor] }, {
    id: 'erase-op-1',
    pageNumber: 1,
    points: [{ x: 1, y: 1 }],
    radius: 4,
    mode: 'partial',
    touchedIds: ['erased-1'],
    changedIds: ['erased-1'],
    deletedIds: [],
    objectMutations: [{ index: 0, storageKey: 'erased-1', annotationId: 'erased-1', base, deleted: false, survivor }],
  });
  await b.drain();
  assert.equal(bob.appendCalls, 0);
  assert.equal(JSON.stringify(b.doc.getMap('annotationEraserOps').toJSON()).includes('#123456'), false);
  await a.destroy();
  await b.destroy();
});

test('an erase gesture that involves a preview is cancelled; nothing of the preview reaches the erase outbox or the log', async () => {
  const documentId = 'live-preview-erase-intent';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  const gate = deferred();
  alice.appendGate = gate.promise;
  a.applyByPage({ 1: { objects: [rect('alice-new', { stroke: '#abcdef' })] } });
  assert.ok(await until(() => previewIds(b).includes('alice-new')));
  const screen = screenOf(b);
  const before = screen[1].objects.find((o) => o.data.id === 'alice-new');
  const intent = prepareEraseIntentForCommit({
    intent: buildEraseIntent({
      mutationId: 'erase-1',
      pageNumber: 1,
      renderer: 'svg',
      gesture: { points: [{ x: 1, y: 1 }], radius: 4, mode: 'full' },
      targets: [{
        domain: 'page-object', storageKey: 'alice-new', kind: 'rect', operation: 'delete',
        pageNumber: 1, index: 0, before, after: null,
      }],
    }),
    annotationsByPage: screen,
    userId: 'user-b',
    includeDeleteHistory: true,
  });
  const result = await b.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
  assert.equal(result.status, 'cancelled');
  assert.equal(JSON.stringify(b.doc.getMap('eraseOutbox').toJSON()).includes('#abcdef'), false);
  await b.drain();
  assert.equal(bob.appendCalls, 0);
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => hasMark(b, 'alice-new')), 'Alice\'s stroke is untouched');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('a paste of a preview is the user\'s own new mark and is saved', async () => {
  const pasted = mintPastedCloneIdentity({ ...rect('src'), __surveyLivePreview: true });
  assert.equal(pasted.__surveyLivePreview, undefined);
});

test('a checkpoint that finishes after a refusal does not turn the status back to healthy', async () => {
  const documentId = 'live-preview-compaction-refusal';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const a = await openFor(alice, documentId, { livePreview: false });
  const gate = deferred();
  cloud.snapshotGate = gate.promise;
  for (let index = 0; index < 40; index += 1) {
    a.setMeta(`k${index}`, index);
    await until(() => cloud.rows.length === index + 1, { timeoutMs: 1_000, stepMs: 2 });
  }
  assert.ok(await until(() => cloud.snapshotCalls >= 1), 'the 40-row checkpoint is uploading');
  alice.appendError = { code: '42501', message: 'permission revoked' };
  a.setMeta('refused', true);
  assert.ok(await until(() => a.isSyncHealthy() === false), 'the refusal turns the status red');
  gate.resolve();
  cloud.snapshotGate = null;
  await a.drain();
  await settle(20);
  assert.equal(a.isSyncHealthy(), false, 'and it stays red after the checkpoint lands');
  alice.appendError = null;
  await a.destroy();
});
