// w33 (2026-09-25) — fewer checkpoints, written by one screen.
//
// w32 measured today's main: 3 screens drawing 45 strokes made 45 WAL rows
// but 85 checkpoint uploads (every screen ~1.2 s after each of its own edits,
// and each refused upload re-downloaded the whole stored checkpoint). w34: 5
// paced strokes -> 5 checkpoints. A checkpoint only shortens reopen; the WAL
// row makes an edit durable and live. These tests pin the new policy against
// a stand-in that enforces the real store_annotation_snapshot rules
// (at_seq must be the WAL head; the stored row must be the caller's base):
//   * paced strokes on one screen: no checkpoint per stroke; an idle one only
//     once the tail is long enough, and only by the author of the newest row;
//   * a screen that only receives rows never checkpoints (not even on close);
//   * three screens drawing 45 strokes: one boundary checkpoint (the writer of
//     row 40), no whole-checkpoint re-download;
//   * a checkpoint refused because other rows landed first is retried by
//     reading just those rows, and still holds every row its at_seq claims;
//   * a big import (split rows) checkpoints once, after its last part;
//   * a reopen after all that shows every mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

const rect = (id) => ({
  type: 'rect', left: 10, top: 20, width: 100, height: 50,
  stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { id, type: 'rect' },
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(String(hex).slice(2), 'hex'));
}

// WAL + one snapshot row + Realtime fan-out, with the SQL functions' rules.
function createCloud(documentId, { beforeSnapshot = null } = {}) {
  const rows = [];
  let snapshot = null;
  const channels = new Set();
  const stats = { snapshotCalls: [], refused: 0, snapshotBodyReads: 0, identityReads: 0 };
  const readBuilder = () => {
    let gtSeq = null;
    let selected = '';
    let limit = Infinity;
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit(value) { limit = Number(value); return builder; },
      abortSignal() { return builder; },
      then(resolve, reject) {
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') data = data.map((row) => ({ client_seq: row.client_seq })).sort((a, b) => b.client_seq - a.client_seq);
        data = data.slice(0, limit);
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
          // Realtime delivers every insert to every subscribed screen.
          for (const channel of channels) setTimeout(() => channel.deliver({ new: { ...row } }), 1);
          return { data: [{ seq: row.seq }], error: null };
        }
        if (name === 'store_annotation_snapshot') {
          if (beforeSnapshot) await beforeSnapshot(args);
          stats.snapshotCalls.push({ writer: args.p_writer_id, atSeq: args.p_at_seq, chars: args.p_snapshot.length });
          const head = rows.length;
          const baseMatches = snapshot
            ? (
              snapshot.at_seq === args.p_expected_at_seq
              && snapshot.writer_id === args.p_expected_writer_id
              && snapshot.writer_epoch === args.p_expected_writer_epoch
              && snapshot.writer_epoch < args.p_writer_epoch
            )
            : (args.p_expected_at_seq == null && args.p_expected_writer_id == null && !args.p_expected_writer_epoch);
          if (head !== args.p_at_seq || !baseMatches) {
            stats.refused += 1;
            return { data: false, error: null };
          }
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
      channel() {
        let callback = null;
        let status = null;
        const channel = {
          on(_event, _filter, cb) { callback = cb; return channel; },
          subscribe(cb) { status = cb; channels.add(entry); setTimeout(() => status?.('SUBSCRIBED'), 0); return channel; },
        };
        const entry = { channel, deliver: (payload) => callback?.(payload) };
        channel.__entry = entry;
        return channel;
      },
      removeChannel(channel) { channels.delete(channel?.__entry); return Promise.resolve(); },
      from(table) {
        if (table === 'annotation_updates') return readBuilder();
        if (table === 'annotation_snapshots') {
          return {
            select(columns) {
              const wantsBody = /(^|[,\s])snapshot([,\s]|$)/.test(columns);
              const b = {
                eq() { return b; },
                abortSignal() { return b; },
                async maybeSingle() {
                  if (wantsBody) stats.snapshotBodyReads += 1;
                  else stats.identityReads += 1;
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

function open(cloud, actor, clientId, documentId, extra = {}) {
  return openAnnotationDoc({
    documentId,
    supabase: cloud.makeClient(actor).supabase,
    clientId,
    actorUserId: actor,
    enableLocal: false,
    enableRealtime: true,
    doc: new Y.Doc(),
    outboxStore: createMemoryAnnotationOutbox(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    ...extra,
    checkpointPolicy: { dueQuietMs: 30, ...(extra.checkpointPolicy || {}) },
  });
}

// One stroke = one new mark on page 1 (the handle's own page list grows).
function strokeOn(handle, mine, id) {
  mine.push(rect(id));
  handle.applyByPage({ 1: { objects: [...mine] } });
}

const markIds = (byPage) => Object.values(byPage || {})
  .flatMap((page) => (page?.objects || []).map((object) => object?.data?.id))
  .sort();

async function settle(...handles) {
  for (let round = 0; round < 3; round += 1) {
    await wait(20);
    for (const handle of handles) await handle.drain();
  }
}

test('paced strokes on one screen: no checkpoint per stroke, one idle checkpoint once the tail is long enough', async () => {
  const documentId = 'checkpoint-paced';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, 'user-a', 'a', documentId, {
    checkpointPolicy: { idleMs: 60 },
  });
  const mine = [];
  for (let index = 0; index < 5; index += 1) {
    strokeOn(handle, mine, `p${index}`);
    await handle.drain();
    await wait(120); // longer than the idle delay: the old 1.2 s debounce fired here
  }
  assert.equal(cloud.rows.length, 5, 'one WAL row per stroke');
  assert.equal(cloud.stats.snapshotCalls.length, 0, '5 paced strokes: no checkpoint (tail under the minimum)');

  for (let index = 5; index < 8; index += 1) {
    strokeOn(handle, mine, `p${index}`);
    await handle.drain();
  }
  await wait(150);
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'a tail of 8 rows: exactly one idle checkpoint');
  assert.equal(cloud.snapshot.at_seq, 8);
  await wait(150);
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'nothing new: no second idle checkpoint');
  await handle.destroy();
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'closing right after a checkpoint writes none');
});

test('a screen that only receives rows never checkpoints, not even on close', async () => {
  const documentId = 'checkpoint-receiver';
  const cloud = createCloud(documentId);
  const writer = await open(cloud, 'user-a', 'a', documentId, { checkpointPolicy: { idleMs: 40 } });
  const receiver = await open(cloud, 'user-b', 'b', documentId, { checkpointPolicy: { idleMs: 40 } });
  await settle(writer, receiver);
  const mine = [];
  for (let index = 0; index < 45; index += 1) strokeOn(writer, mine, `s${index}`);
  await settle(writer, receiver);
  await wait(120);
  assert.deepEqual(markIds(receiver.getByPage()), markIds(writer.getByPage()), 'the receiver shows every stroke');
  assert.ok(cloud.stats.snapshotCalls.every((call) => call.writer !== receiver.writerId), 'receiver: 0 checkpoints');
  await receiver.destroy();
  assert.ok(cloud.stats.snapshotCalls.every((call) => call.writer !== receiver.writerId), 'receiver close: 0 checkpoints');
  await writer.destroy();
  assert.ok(cloud.stats.snapshotCalls.length <= 2, `45 strokes: ${cloud.stats.snapshotCalls.length} checkpoints`);
});

test('three screens, 45 strokes: the writer of row 40 checkpoints; no whole-checkpoint re-download', async () => {
  const documentId = 'checkpoint-three';
  const cloud = createCloud(documentId);
  const handles = [
    await open(cloud, 'user-a', 'a', documentId),
    await open(cloud, 'user-b', 'b', documentId),
    await open(cloud, 'user-c', 'c', documentId),
  ];
  await settle(...handles);
  const bodyReadsAfterOpen = cloud.stats.snapshotBodyReads;
  const mine = handles.map(() => []);
  for (let index = 0; index < 45; index += 1) {
    const who = index % 3;
    // Each screen repaints what the others drew, then adds its own stroke.
    const others = handles[who].getByPage()?.[1]?.objects || [];
    const own = rect(`t${index}`);
    mine[who].push(own);
    handles[who].applyByPage({ 1: { objects: [...others.filter((object) => !mine[who].some((m) => m.data.id === object?.data?.id)), ...mine[who]] } });
    await wait(5);
  }
  await settle(...handles);
  await wait(50);
  const routine = cloud.stats.snapshotCalls.filter((call) => call.atSeq >= 40);
  assert.equal(cloud.rows.length, 45);
  assert.ok(cloud.stats.snapshotCalls.length >= 1 && cloud.stats.snapshotCalls.length <= 3,
    `${cloud.stats.snapshotCalls.length} checkpoint calls for 45 strokes (was ~85)`);
  const writerOf40 = cloud.rows.find((row) => row.seq === 40).client_id;
  assert.ok(routine.every((call) => call.writer === writerOf40), 'only the writer of row 40 checkpointed');
  assert.equal(cloud.stats.snapshotBodyReads, bodyReadsAfterOpen, 'no whole-checkpoint re-download while drawing');
  for (const handle of handles) await handle.destroy();

  const reopened = await open(cloud, 'user-d', 'd', documentId, { enableRealtime: false });
  assert.equal(markIds(reopened.getByPage()).length, 45, 'a reopen shows every stroke');
  await reopened.destroy();
});

test('a checkpoint refused because rows landed first reads only those rows and still holds what at_seq claims', async () => {
  const documentId = 'checkpoint-head-moved';
  let other = null;
  let otherMine = [];
  let raced = false;
  const cloud = createCloud(documentId, {
    // The first checkpoint upload races another screen's stroke.
    async beforeSnapshot() {
      if (raced || !other) return;
      raced = true;
      strokeOn(other, otherMine, 'raced');
      await other.drain();
    },
  });
  const writer = await open(cloud, 'user-a', 'a', documentId, { checkpointPolicy: { everyRows: 4 } });
  other = await open(cloud, 'user-b', 'b', documentId, { checkpointPolicy: { everyRows: 1000 } });
  await settle(writer, other);
  const bodyReads = cloud.stats.snapshotBodyReads;
  const mine = [];
  for (let index = 0; index < 4; index += 1) {
    strokeOn(writer, mine, `w${index}`);
    await writer.drain();
  }
  await settle(writer, other);
  await wait(50);
  assert.ok(raced, 'the race happened');
  assert.ok(cloud.stats.refused >= 1, 'the first upload was refused (WAL head moved)');
  assert.equal(cloud.stats.snapshotBodyReads, bodyReads, 'the retry did not download the stored checkpoint');
  assert.equal(cloud.snapshot.at_seq, cloud.rows.length);
  const stored = new Y.Doc();
  Y.applyUpdate(stored, gunzipSync(hexToBytes(cloud.snapshot.snapshot)));
  assert.ok(stored.getMap('marks').has('raced'), 'the checkpoint holds the row its at_seq claims');
  await writer.destroy();
  await other.destroy();
});

test('an import written page by page (one transaction each) checkpoints once, at its end', async () => {
  const documentId = 'checkpoint-import-pages';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, 'user-a', 'a', documentId, { walUpdateMaxBytes: 16 * 1024 });
  const pages = {};
  for (let page = 1; page <= 6; page += 1) {
    pages[page] = { objects: Array.from({ length: 60 }, (_, index) => ({ ...rect(`pg${page}-${index}`), text: 'y'.repeat(2_000) })) };
    handle.applyByPage({ ...pages });
    await wait(5);
  }
  await handle.drain();
  await wait(120);
  await handle.drain();
  assert.ok(cloud.rows.length > 30, `${cloud.rows.length} rows`);
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'one checkpoint for the whole import');
  assert.equal(cloud.snapshot.at_seq, cloud.rows.length);
  await handle.destroy();
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'close right after it writes none');
});

test('a big import checkpoints once, after its last split part', async () => {
  const documentId = 'checkpoint-import';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, 'user-a', 'a', documentId, { walUpdateMaxBytes: 16 * 1024 });
  const big = [];
  for (let index = 0; index < 400; index += 1) {
    big.push({ ...rect(`i${index}`), text: 'x'.repeat(2_000) });
  }
  handle.applyByPage({ 1: { objects: big } });
  await handle.drain();
  await wait(120);
  await handle.drain();
  assert.ok(cloud.rows.length > 20, `split into ${cloud.rows.length} rows`);
  assert.equal(cloud.stats.snapshotCalls.length, 1, 'one checkpoint for the whole import');
  assert.equal(cloud.snapshot.at_seq, cloud.rows.length, 'after its last part');
  await handle.destroy();
});

// Review B (w33): an idle capture queued behind a slow checkpoint upload,
// with an own stroke landing in between, must not claim that stroke's row
// without holding it (at_seq over-claim = the stroke lost on reopen).
test('a checkpoint queued behind a slow one never claims a row its bytes lack', async () => {
  const documentId = 'checkpoint-queued-behind';
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const cloud = createCloud(documentId, {
    async beforeSnapshot() {
      calls += 1;
      if (calls === 1) await gate; // the first upload is slow
    },
  });
  const handle = await open(cloud, 'user-a', 'a', documentId, {
    checkpointPolicy: { everyRows: 4, idleMs: 60, minTailRows: 1 },
  });
  const mine = [];
  for (let index = 0; index < 4; index += 1) { strokeOn(handle, mine, `s${index}`); await handle.drain(); }
  await wait(60);
  assert.equal(calls, 1, 'the row-4 checkpoint is uploading');
  strokeOn(handle, mine, 's4');
  await wait(110); // the idle checkpoint queues behind it
  strokeOn(handle, mine, 's5');
  await wait(20);
  release();
  await wait(250);
  await handle.destroy();
  const reopened = await open(cloud, 'user-b', 'b', documentId, { enableRealtime: false });
  assert.deepEqual(markIds(reopened.getByPage()), ['s0', 's1', 's2', 's3', 's4', 's5']);
  await reopened.destroy();
});

// Review B (w33): the next boundary owned by a screen that did not write the
// stored checkpoint must not download it; a failed boundary checkpoint is
// still owed and written once the network is back.
test('three screens, 125 strokes: at most one stored-checkpoint download, tail under 80 rows, a failed one is retried', async () => {
  const documentId = 'checkpoint-ninety';
  let failing = false;
  const cloud = createCloud(documentId, {
    async beforeSnapshot() { if (failing) throw new Error('network down'); },
  });
  const handles = [
    await open(cloud, 'user-a', 'a', documentId),
    await open(cloud, 'user-b', 'b', documentId),
    await open(cloud, 'user-c', 'c', documentId),
  ];
  await settle(...handles);
  const bodyReads = cloud.stats.snapshotBodyReads;
  const mine = handles.map(() => []);
  const draw = async (from, to) => {
    for (let index = from; index < to; index += 1) {
      const who = index % 3;
      const others = handles[who].getByPage()?.[1]?.objects || [];
      mine[who].push(rect(`n${index}`));
      handles[who].applyByPage({ 1: { objects: [...others.filter((object) => !mine[who].some((m) => m.data.id === object?.data?.id)), ...mine[who]] } });
      await wait(5);
    }
    await settle(...handles);
    await wait(80);
  };
  await draw(0, 45);
  await draw(45, 90);
  // A screen that did not write the stored checkpoint skips its boundary
  // while that one is recent (under 2 x 40 rows behind), and takes it in
  // (one download) only past that, so the reopen tail stays under 80 rows.
  assert.ok(cloud.stats.snapshotBodyReads - bodyReads <= 1, `${cloud.stats.snapshotBodyReads - bodyReads} stored-checkpoint downloads`);
  assert.ok(cloud.stats.snapshotCalls.length <= 3, `${cloud.stats.snapshotCalls.length} uploads for 90 strokes`);
  assert.ok(cloud.rows.length - cloud.snapshot.at_seq < 80, `stored at ${cloud.snapshot.at_seq} of ${cloud.rows.length}`);

  failing = true;
  await draw(90, 125); // row 120 is due; its upload fails
  const storedBefore = cloud.snapshot.at_seq;
  failing = false;
  for (const handle of handles) await handle.destroy();
  assert.ok(cloud.snapshot.at_seq > storedBefore, `the owed checkpoint was written on close (${storedBefore} -> ${cloud.snapshot.at_seq})`);
  const reopened = await open(cloud, 'user-d', 'd', documentId, { enableRealtime: false });
  assert.equal(markIds(reopened.getByPage()).length, 125);
  await reopened.destroy();
});
