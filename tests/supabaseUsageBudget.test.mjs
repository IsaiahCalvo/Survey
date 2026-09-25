// w34 (2026-09-25): a usage budget for the annotation sync engine.
//
// The owner's worry after the 2026-09-24 sync rebuild: are we hammering
// Supabase (requests, Realtime messages, bytes) or maxing the plan? This test
// drives the REAL sync engine (openAnnotationDoc) for three screens on one
// document through a fake backend that counts every call, and fails when a
// change makes a scripted session cost more than the budget below.
//
// Session per screen: open, sit idle for five (mocked) minutes, draw 20
// strokes, erase 10, move 5, then let checkpoints settle. The budget pins:
//   * idle costs nothing: no request, no read, no broadcast in 5 minutes;
//   * one WAL row per edit at most (no per-frame or duplicate writes);
//   * checkpoints are debounced (a handful per session, not one per edit);
//   * a screen joins two channels per open document (log + live) and no more;
//   * previews go out only for new marks and each is small;
//   * a screen receiving the others' edits does not re-read the log for them;
//   * rows and checkpoints stay small for small marks (bytes budget).
// If a change needs more, raise the number here deliberately, in the same
// commit, with the reason — never just to make the test pass.
// The live-app counterpart is agent-cli/usage-budget-probe.mjs (+ usage-budget.json).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';

const BUDGET = {
  idle: { requests: 0, reads: 0, broadcasts: 0 },
  perScreen: {
    walAppendsPerEdit: 1,
    snapshotWrites: 4,         // measured 1 (debounced); slack for timing
    channelsPerOpen: 2,
    // w32 (2026-09-25, owner request: erases, moves and deletes show on
    // other screens in ~100 ms, not with their row): one live message per
    // edit as well as per new stroke = 20 strokes + 10 erases + 5 moves.
    // Edit messages carry only the changed fields (a delete ~40 B, a move of
    // a small mark ~100 B), so the bytes-per-message ceiling below is kept.
    // (No presence gating: sending to an empty channel delivers nothing.)
    broadcastsSent: 35,
    tailReadsWhileReceiving: 4, // realtime rows apply without re-reading the log
    walBytesPerStroke: 512,     // measured ~224 B for a small mark's row
    broadcastBytesPerStroke: 1_024, // measured ~560 B
    snapshotBytes: 4_096,       // measured ~1.9 KB gzipped for 30 small marks
  },
};

const STROKES = 20;
const ERASES = 10;
const MOVES = 5;
const SCREENS = 3;

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, { timeoutMs = 5_000, stepMs = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await settle(stepMs);
  }
  return false;
}

const hexBytes = (hex) => (typeof hex === 'string' ? Math.max(0, (hex.length - 2) / 2) : 0);

function createCountingCloud(documentId) {
  const rows = [];
  let snapshot = null;
  const pgChannels = new Set();
  const liveChannels = new Set();
  const cloud = { rows, get snapshot() { return snapshot; }, clients: [] };
  const deliverRow = (row) => {
    for (const channel of pgChannels) {
      channel.client.count.pgDelivered += 1;
      queueMicrotask(() => channel.insert?.({ new: row }));
    }
  };
  cloud.makeClient = (actor) => {
    const count = {
      requests: 0, reads: 0, tailReads: 0, walAppends: 0, walBytes: 0,
      snapshotWrites: 0, snapshotBytes: 0, snapshotReads: 0,
      channels: 0, joins: 0, broadcastsSent: 0, broadcastBytes: 0, broadcastsRecv: 0,
      pgDelivered: 0, other: [],
    };
    const client = { actor, count };
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
        abortSignal() { return builder; },
        then(resolve, reject) {
          count.requests += 1;
          count.reads += 1;
          if (gtSeq != null) count.tailReads += 1;
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
    client.supabase = {
      async rpc(name, args) {
        count.requests += 1;
        if (name === 'append_annotation_update') {
          count.walAppends += 1;
          count.walBytes += hexBytes(args.p_data);
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
          count.snapshotWrites += 1;
          count.snapshotBytes = hexBytes(args.p_snapshot);
          snapshot = {
            snapshot: args.p_snapshot,
            at_seq: args.p_at_seq,
            encoding_version: args.p_encoding_version,
            writer_id: args.p_writer_id,
            writer_epoch: args.p_writer_epoch,
          };
          return { data: true, error: null };
        }
        count.other.push(`rpc ${name}`);
        return { data: null, error: null };
      },
      from(table) {
        if (table === 'annotation_updates') return readBuilder();
        if (table === 'annotation_snapshots') {
          return {
            select() {
              const b = {
                eq() { return b; },
                async maybeSingle() {
                  count.requests += 1;
                  count.reads += 1;
                  count.snapshotReads += 1;
                  return { data: snapshot, error: null };
                },
              };
              return b;
            },
          };
        }
        count.other.push(`from ${table}`);
        throw new Error(`unexpected table ${table}`);
      },
      channel(topic) {
        count.channels += 1;
        if (String(topic).startsWith('anno-live:')) {
          const live = { client, topic, handler: null, joined: false };
          liveChannels.add(live);
          const api = {
            on(_type, _filter, callback) { live.handler = callback; return api; },
            subscribe(callback) {
              count.joins += 1;
              queueMicrotask(() => { live.joined = true; callback('SUBSCRIBED'); });
              return api;
            },
            send(message) {
              count.broadcastsSent += 1;
              count.broadcastBytes += JSON.stringify(message.payload ?? null).length;
              for (const other of liveChannels) {
                if (other === live || other.topic !== topic || !other.joined) continue;
                other.client.count.broadcastsRecv += 1;
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
          subscribe(callback) {
            count.joins += 1;
            queueMicrotask(() => callback('SUBSCRIBED'));
            return this;
          },
        };
      },
      async removeChannel(channel) {
        for (const live of liveChannels) if (live.api === channel) liveChannels.delete(live);
        if (client.pgChannel) pgChannels.delete(client.pgChannel);
      },
    };
    cloud.clients.push(client);
    return client;
  };
  return cloud;
}

// A pen stroke as the viewer stores it (small, like a short real stroke).
const stroke = (id, index) => ({
  type: 'path',
  path: [['M', 20, 30 + index * 10], ['Q', 40, 28 + index * 10, 60, 32 + index * 10], ['L', 90, 30 + index * 10]],
  left: 20, top: 28 + index * 10, width: 70, height: 4,
  fill: null, stroke: '#ff0000', strokeWidth: 2, opacity: 1,
  meta: { authorId: 'user' },
  data: { id, type: 'pen' },
});

const openFor = (client, documentId) => openAnnotationDoc({
  documentId,
  supabase: client.supabase,
  clientId: `${client.actor}-install`,
  actorUserId: client.actor,
  enableLocal: false,
  enableRealtime: true,
  doc: new Y.Doc(),
  livePreview: true,
  snapshotRetryDelayMs: 0,
  requestTimeoutMs: 2_000,
});

const snapshotOf = (count) => ({ ...count, other: [...count.other] });
const diff = (after, before) => Object.fromEntries(Object.keys(after)
  .filter((key) => typeof after[key] === 'number')
  .map((key) => [key, after[key] - before[key]]));

test('usage budget: three screens, idle 5 min, 20 strokes + 10 erases + 5 moves each', async () => {
  const documentId = 'usage-budget-session';
  const cloud = createCountingCloud(documentId);
  const clients = Array.from({ length: SCREENS }, (_, i) => cloud.makeClient(`user-${i}`));
  const handles = [];
  for (const client of clients) handles.push(await openFor(client, documentId));
  assert.ok(await until(() => handles.every((h) => h.isRealtimeReady())), 'every screen joined realtime');
  await settle(200);

  for (const client of clients) {
    assert.ok(
      client.count.channels <= BUDGET.perScreen.channelsPerOpen,
      `${client.actor} opened ${client.count.channels} channels for one document`,
    );
  }

  // (Idle is its own test below: its fake clock must be on BEFORE the screens
  // open, or a poll armed at open would keep running on the real clock.)

  // --- the editing session, all three screens at once ----------------------
  const beforeEdit = clients.map((c) => snapshotOf(c.count));
  const ids = handles.map((_, s) => Array.from({ length: STROKES }, (__, i) => `s${s}-stroke-${i}`));
  const mine = (handle, s) => (handle.getByPage()?.[1]?.objects || []).filter((o) => o?.data?.id?.startsWith(`s${s}-`));
  const others = (handle, s) => (handle.getByPage()?.[1]?.objects || []).filter((o) => !o?.data?.id?.startsWith(`s${s}-`));
  const write = (handle, s, nextMine) => handle.applyByPage({ 1: { objects: [...others(handle, s), ...nextMine] } });

  await Promise.all(handles.map(async (handle, s) => {
    for (let i = 0; i < STROKES; i += 1) {
      write(handle, s, [...mine(handle, s), stroke(ids[s][i], i)]);
      await handle.drain();
      await settle(5);
    }
    for (let i = 0; i < ERASES; i += 1) {
      write(handle, s, mine(handle, s).filter((o) => o.data.id !== ids[s][i]));
      await handle.drain();
      await settle(5);
    }
    for (let k = 0; k < MOVES; k += 1) {
      const target = ids[s][ERASES + k];
      write(handle, s, mine(handle, s).map((o) => (o.data.id === target ? { ...o, left: o.left + 25 } : o)));
      await handle.drain();
      await settle(5);
    }
  }));
  const expectedMarks = SCREENS * (STROKES - ERASES);
  assert.ok(
    await until(() => handles.every((h) => (h.getByPage()?.[1]?.objects || []).length === expectedMarks), { timeoutMs: 10_000 }),
    'every screen converged on the same marks',
  );
  // Let the debounced checkpoints land.
  await settle(2_000);
  for (const handle of handles) await handle.drain();

  const edits = STROKES + ERASES + MOVES;
  for (const [i, client] of clients.entries()) {
    const used = diff(client.count, beforeEdit[i]);
    const label = client.actor;
    assert.ok(used.walAppends <= edits * BUDGET.perScreen.walAppendsPerEdit, `${label}: ${used.walAppends} WAL rows for ${edits} edits`);
    assert.ok(used.walAppends >= edits, `${label}: every edit reached the log (${used.walAppends}/${edits})`);
    assert.ok(used.snapshotWrites <= BUDGET.perScreen.snapshotWrites, `${label}: ${used.snapshotWrites} checkpoints in one session`);
    assert.ok(used.broadcastsSent <= BUDGET.perScreen.broadcastsSent, `${label}: ${used.broadcastsSent} live previews sent`);
    assert.ok(used.tailReads <= BUDGET.perScreen.tailReadsWhileReceiving, `${label}: ${used.tailReads} log re-reads while receiving`);
    assert.equal(used.channels, 0, `${label}: opened channels mid-session`);
    assert.equal(used.joins, 0, `${label}: re-joined mid-session`);
    const strokeRows = used.walAppends || 1;
    assert.ok(used.walBytes / strokeRows <= BUDGET.perScreen.walBytesPerStroke, `${label}: ${Math.round(used.walBytes / strokeRows)} bytes per WAL row`);
    if (used.broadcastsSent) {
      assert.ok(used.broadcastBytes / used.broadcastsSent <= BUDGET.perScreen.broadcastBytesPerStroke, `${label}: ${Math.round(used.broadcastBytes / used.broadcastsSent)} bytes per preview`);
    }
    assert.ok(client.count.snapshotBytes <= BUDGET.perScreen.snapshotBytes, `${label}: checkpoint is ${client.count.snapshotBytes} bytes`);
    assert.deepEqual(client.count.other, [], `${label}: unexpected backend calls`);
  }
  if (process.env.USAGE_BUDGET_REPORT) {
    console.log(JSON.stringify(clients.map((c, i) => ({ actor: c.actor, ...diff(c.count, beforeEdit[i]), snapshotBytes: c.count.snapshotBytes })), null, 2));
  }
  for (const handle of handles) await handle.destroy();
});

// Idle: three screens open a document that already holds marks and a
// checkpoint, then nobody touches anything for five minutes. The fake clock
// is on from before the first open, so any timer the engine arms at open or
// later (a poll, a retry loop, a sweep) runs on it and is counted.
const realImmediate = setImmediate;
const turn = () => new Promise((resolve) => realImmediate(resolve));
async function pump(ms, stepMs = 50) {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    mock.timers.tick(stepMs);
    for (let i = 0; i < 5; i += 1) await turn();
  }
}
async function pumpUntil(predicate, maxMs = 30_000) {
  for (let elapsed = 0; elapsed < maxMs; elapsed += 50) {
    if (await predicate()) return true;
    await pump(50);
  }
  return false;
}

test('usage budget: five idle minutes with three screens open cost nothing', async () => {
  const documentId = 'usage-budget-idle';
  const cloud = createCountingCloud(documentId);
  // Seed the document the way a real one looks: some rows and a checkpoint.
  const seeder = cloud.makeClient('seeder');
  const seed = await openFor(seeder, documentId);
  assert.ok(await until(() => seed.isRealtimeReady()));
  seed.applyByPage({ 1: { objects: Array.from({ length: 5 }, (_, i) => stroke(`seed-${i}`, i)) } });
  await seed.drain();
  assert.equal(await seed.flushSnapshot(), true);
  await seed.destroy();

  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handles = [];
  try {
    const clients = Array.from({ length: SCREENS }, (_, i) => cloud.makeClient(`idle-${i}`));
    for (const client of clients) {
      const opening = openFor(client, documentId);
      let opened = null;
      opening.then((handle) => { opened = handle; });
      assert.ok(await pumpUntil(() => opened !== null), `${client.actor} opened`);
      handles.push(opened);
    }
    assert.ok(await pumpUntil(() => handles.every((h) => h.isRealtimeReady())), 'every screen joined realtime');
    // Let open-time work finish (catch-up, first checkpoint if any).
    await pump(60_000, 250);
    for (const client of clients) {
      assert.ok(client.count.channels <= BUDGET.perScreen.channelsPerOpen, `${client.actor} opened ${client.count.channels} channels`);
    }
    const before = clients.map((c) => snapshotOf(c.count));
    await pump(5 * 60_000, 1_000);
    for (const [i, client] of clients.entries()) {
      const idle = diff(client.count, before[i]);
      assert.equal(idle.requests, BUDGET.idle.requests, `${client.actor} made ${idle.requests} requests while idle`);
      assert.equal(idle.reads, BUDGET.idle.reads, `${client.actor} read ${idle.reads} times while idle`);
      assert.equal(idle.broadcastsSent, BUDGET.idle.broadcasts, `${client.actor} broadcast while idle`);
      assert.equal(idle.joins, 0, `${client.actor} re-joined while idle`);
    }
  } finally {
    const closing = Promise.all(handles.map((h) => h.destroy()));
    await pump(2_000);
    await closing;
    mock.timers.reset();
  }
});

// Paced drawing (a stroke every ~1.4 s, longer than the 1.2 s checkpoint
// debounce) with two screens only watching. w32 measured on 2026-09-25: 3
// screens x 45 strokes -> 85 checkpoint uploads (~128 KB each on a tiny
// document), because every screen, watchers included, checkpoints ~1.2 s
// after each change it sees. The WAL row is what makes an edit durable; the
// checkpoint only shortens reopen, so a paced session must not cost one full
// checkpoint per stroke per screen.
const PACED_STROKES = 5;
const PACE_MS = 1_400;

async function pacedSession() {
  const documentId = 'usage-budget-paced';
  const cloud = createCountingCloud(documentId);
  const [writer, ...watchers] = Array.from({ length: 3 }, (_, i) => cloud.makeClient(`paced-${i}`));
  const handles = [];
  for (const client of [writer, ...watchers]) handles.push(await openFor(client, documentId));
  assert.ok(await until(() => handles.every((h) => h.isRealtimeReady())));
  await settle(200);
  const before = [writer, ...watchers].map((c) => snapshotOf(c.count));
  for (let i = 0; i < PACED_STROKES; i += 1) {
    const current = handles[0].getByPage()?.[1]?.objects || [];
    handles[0].applyByPage({ 1: { objects: [...current, stroke(`paced-${i}`, i)] } });
    await handles[0].drain();
    await settle(PACE_MS);
  }
  assert.ok(await until(() => handles.every((h) => (h.getByPage()?.[1]?.objects || []).length === PACED_STROKES)));
  await settle(1_500);
  const used = [writer, ...watchers].map((c, i) => diff(c.count, before[i]));
  for (const handle of handles) await handle.destroy();
  return { writer: used[0], watchers: used.slice(1) };
}

let pacedResult = null;
const paced = async () => { pacedResult ||= await pacedSession(); return pacedResult; };

test('usage budget (hard ceiling today): paced strokes cost at most one checkpoint per stroke per screen', async () => {
  const { writer, watchers } = await paced();
  assert.equal(writer.walAppends, PACED_STROKES, 'one WAL row per stroke');
  for (const used of [writer, ...watchers]) {
    assert.ok(used.snapshotWrites <= PACED_STROKES + 1, `${used.snapshotWrites} checkpoints for ${PACED_STROKES} strokes`);
  }
  for (const used of watchers) assert.equal(used.walAppends, 0, 'a watcher writes no rows');
  if (process.env.USAGE_BUDGET_REPORT) console.log(JSON.stringify({ writer, watchers }, null, 2));
});

test('usage budget (target, w33): watchers never checkpoint and the writer checkpoints by size, not per stroke', {
  todo: 'w33 (claude/w33-open-size) is changing the checkpoint cadence: one elected writer, by rows/bytes since the last checkpoint, receivers never. Drop this todo when that lands.',
}, async () => {
  const { writer, watchers } = await paced();
  for (const used of watchers) assert.equal(used.snapshotWrites, 0, `a watcher uploaded ${used.snapshotWrites} checkpoints`);
  assert.ok(writer.snapshotWrites <= 2, `the writer uploaded ${writer.snapshotWrites} checkpoints for ${PACED_STROKES} paced strokes`);
});
