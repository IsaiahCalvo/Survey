// w36 (2026-09-25) — the server prunes old WAL rows a stored checkpoint
// already covers (supabase/proposed/20260925_w36_prune_annotation_wal_and_history.sql:
// rows below the checkpoint's at_seq minus a margin, older than a week, never
// the head). Every open reads the checkpoint and the rows AFTER it, so opens
// never need pruned rows. The one screen that could: a tab left open that
// slept or stayed offline past the retention window, whose catch-up replays
// from an older baseline. Before w36 it applied the surviving rows, turned
// green and silently missed the pruned edits. Now catch-up sees the gap
// (seqs are gapless per document) and takes the stored checkpoint in.
//
// Stand-in: the WAL + one checkpoint row with the real store_annotation_snapshot
// rules (as tests/annotationCheckpointPolicy.test.mjs), plus a prune with the
// proposed SQL's rule and per-screen Realtime that can drop and resubscribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

const rect = (id) => ({
  type: 'rect', left: 10, top: 20, width: 100, height: 50,
  stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { id, type: 'rect' },
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCloud(documentId) {
  let rows = [];
  let nextSeq = 1; // MAX(seq)+1 under the document lock: never reused
  let snapshot = null;
  const screens = new Map(); // actor -> { entry, online }
  const stats = { snapshotBodyReads: 0, identityReads: 0, walReads: 0 };
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
        stats.walReads += 1;
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
          seq: nextSeq,
        };
        nextSeq += 1;
        rows.push(row);
        for (const screen of screens.values()) {
          if (screen.online) setTimeout(() => screen.entry?.deliver({ new: { ...row } }), 1);
        }
        return { data: [{ seq: row.seq }], error: null };
      }
      if (name === 'store_annotation_snapshot') {
        const head = nextSeq - 1;
        const baseMatches = snapshot
          ? (
            snapshot.at_seq === args.p_expected_at_seq
            && snapshot.writer_id === args.p_expected_writer_id
            && snapshot.writer_epoch === args.p_expected_writer_epoch
            && snapshot.writer_epoch < args.p_writer_epoch
          )
          : (args.p_expected_at_seq == null && args.p_expected_writer_id == null && !args.p_expected_writer_epoch);
        if (head !== args.p_at_seq || !baseMatches) return { data: false, error: null };
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
        subscribe(cb) {
          status = cb;
          const screen = screens.get(actor) || { online: true };
          screen.entry = entry;
          screens.set(actor, screen);
          setTimeout(() => status?.('SUBSCRIBED'), 0);
          return channel;
        },
      };
      const entry = {
        deliver: (payload) => callback?.(payload),
        resubscribe: () => status?.('SUBSCRIBED'),
      };
      channel.__actor = actor;
      return channel;
    },
    removeChannel(channel) { screens.delete(channel?.__actor); return Promise.resolve(); },
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
  });
  return {
    stats,
    makeClient,
    get rows() { return rows; },
    get snapshot() { return snapshot; },
    // The proposed SQL's rule (age aside): only rows a stored checkpoint
    // covers, keepRows below its at_seq, never the head.
    prune(keepRows) {
      if (!snapshot) return 0;
      const head = nextSeq - 1;
      const before = rows.length;
      rows = rows.filter((row) => !(row.seq < snapshot.at_seq - keepRows && row.seq < head));
      return before - rows.length;
    },
    goOffline(actor) { screens.get(actor).online = false; },
    reconnect(actor) {
      const screen = screens.get(actor);
      screen.online = true;
      screen.entry.resubscribe();
    },
  };
}

function open(cloud, actor, clientId, documentId, extra = {}) {
  return openAnnotationDoc({
    documentId,
    supabase: cloud.makeClient(actor),
    clientId,
    actorUserId: actor,
    enableLocal: false,
    enableRealtime: true,
    doc: new Y.Doc(),
    outboxStore: createMemoryAnnotationOutbox(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    ...extra,
    // No routine checkpoints: the test says when one is written.
    checkpointPolicy: { everyRows: 100_000, idleMs: 600_000, dueQuietMs: 30, ...(extra.checkpointPolicy || {}) },
  });
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

async function draw(handle, mine, prefix, count) {
  for (let index = 0; index < count; index += 1) {
    mine.push(rect(`${prefix}${index}`));
    handle.applyByPage({ 1: { objects: [...mine] } });
    await handle.drain();
  }
}

test('a tab that missed rows the server then pruned takes the stored checkpoint in on reconnect', async () => {
  const documentId = 'prune-sleeping-tab';
  const cloud = createCloud(documentId);
  const a = await open(cloud, 'user-a', 'a', documentId);
  const b = await open(cloud, 'user-b', 'b', documentId);
  await settle(a, b);
  const mine = [];
  await draw(a, mine, 'early', 3);
  await settle(a, b);
  assert.equal(markIds(b.getByPage()).length, 3, 'B saw the first strokes live');

  // B's laptop sleeps with the tab open. A keeps drawing and checkpoints; the
  // server prunes the covered rows (a week later, in real life).
  cloud.goOffline('user-b');
  await draw(a, mine, 'late', 30);
  await a.flushSnapshot();
  assert.equal(cloud.snapshot?.at_seq, 33, 'A checkpointed the head');
  const pruned = cloud.prune(5);
  assert.ok(pruned >= 25, `pruned ${pruned} rows`);
  assert.equal(markIds(b.getByPage()).length, 3, 'B is behind while asleep');

  const bodyReads = cloud.stats.snapshotBodyReads;
  cloud.reconnect('user-b');
  await settle(a, b);
  await wait(30);
  await settle(a, b);
  assert.deepEqual(markIds(b.getByPage()), markIds(a.getByPage()), 'B shows every stroke, including the pruned ones');
  assert.equal(markIds(b.getByPage()).length, 33);
  assert.equal(cloud.stats.snapshotBodyReads, bodyReads + 1, 'exactly one checkpoint download to recover');

  // Recovered state is a sound base: B keeps editing, checkpoints, and a fresh
  // open shows everything.
  const bMine = [];
  await draw(b, bMine, 'b-after', 2);
  await settle(a, b);
  await b.flushSnapshot();
  assert.equal(cloud.snapshot.at_seq, cloud.rows.at(-1).seq, 'B\'s checkpoint claims the head');
  assert.equal(markIds(a.getByPage()).length, 35, 'A sees B\'s new strokes');

  // A later reconnect does not download the checkpoint again (baseline moved).
  const reads = cloud.stats.snapshotBodyReads;
  cloud.goOffline('user-b');
  cloud.reconnect('user-b');
  await settle(a, b);
  assert.equal(cloud.stats.snapshotBodyReads, reads, 'no second recovery');

  await a.destroy();
  await b.destroy();
  const fresh = await open(cloud, 'user-c', 'c', documentId, { enableRealtime: false });
  assert.equal(markIds(fresh.getByPage()).length, 35, 'a fresh open after the prune shows every mark');
  await fresh.destroy();
});

test('a tab that slept and made its own edits keeps them through the recovery', async () => {
  const documentId = 'prune-sleeping-editor';
  const cloud = createCloud(documentId);
  const a = await open(cloud, 'user-a', 'a', documentId);
  const b = await open(cloud, 'user-b', 'b', documentId);
  await settle(a, b);
  const aMine = [];
  await draw(a, aMine, 'a', 2);
  await settle(a, b);

  // B loses Realtime only (its writes still reach the server): its own rows
  // interleave with A's while it cannot see A's.
  cloud.goOffline('user-b');
  const bMine = [];
  for (let index = 0; index < 20; index += 1) {
    await draw(a, aMine, `a-late${index}-`, 1);
    const shown = b.getByPage()?.[1]?.objects || [];
    bMine.push(rect(`b-late${index}`));
    b.applyByPage({ 1: { objects: [...shown.filter((o) => !bMine.some((m) => m.data.id === o?.data?.id)), ...bMine] } });
    await b.drain();
  }
  await settle(a);
  await a.flushSnapshot().catch(() => {});
  await settle(a);
  if (cloud.snapshot?.at_seq !== cloud.rows.at(-1).seq) await a.flushSnapshot();
  cloud.prune(3);

  cloud.reconnect('user-b');
  await settle(a, b);
  await wait(30);
  await settle(a, b);
  const expected = markIds(a.getByPage());
  assert.deepEqual(markIds(b.getByPage()), expected, 'both screens converge');
  assert.ok(expected.includes('b-late19') && expected.includes('a-late19-0'), 'nobody\'s edits lost');
  await a.destroy();
  await b.destroy();
});

test('an ordinary reconnect (nothing pruned) never downloads the checkpoint', async () => {
  const documentId = 'prune-none';
  const cloud = createCloud(documentId);
  const a = await open(cloud, 'user-a', 'a', documentId);
  const b = await open(cloud, 'user-b', 'b', documentId);
  await settle(a, b);
  const mine = [];
  await draw(a, mine, 'x', 3);
  await a.flushSnapshot();
  await settle(a, b);
  cloud.goOffline('user-b');
  await draw(a, mine, 'y', 10);
  const reads = cloud.stats.snapshotBodyReads;
  cloud.reconnect('user-b');
  await settle(a, b);
  assert.equal(markIds(b.getByPage()).length, 13);
  assert.equal(cloud.stats.snapshotBodyReads, reads, 'the gap guard stays quiet when rows are all there');
  await a.destroy();
  await b.destroy();
});
