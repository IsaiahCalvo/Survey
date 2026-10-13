// 2026-10-06 — checkpoint work off the main thread.
//
// The checkpoint (Y.encodeStateAsUpdate of the accepted document, gzipped,
// as bytea hex text) is now built by a worker from its mirror of the
// accepted document. These tests pin that the stored checkpoint is byte for
// byte what the old main-thread code produced for the same document, that a
// failing worker falls back to the main thread without losing anything, and
// that edits made while the worker runs go into the next checkpoint.
//
// The worker here is an in-process stand-in that runs the same request
// handler as src/workers/annotationCheckpointWorker.js (runCheckpointRequest),
// with structuredClone + transfer lists like a real postMessage.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createAnnotationOutbox, createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { ANNOTATIONS_MAP, syncByPageToDoc } from '../src/services/annotationDocStore.js';
import {
  applyToCheckpointMirror,
  bytesToPgHex,
  createCheckpointMirror,
  encodeCheckpointFromMirror,
  gunzipBytes,
  pgHexToBytes,
  prepareCheckpointUpload,
  runCheckpointRequest,
} from '../src/services/annotationCheckpointCore.js';
import {
  __setCheckpointWorkerFactoryForTests,
  prepareCheckpointUploadOffThread,
} from '../src/services/annotationCheckpointOffload.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import {
  checkpointBodyFetch,
  enableCheckpointBodySubstitution,
  registerCheckpointBody,
  releaseCheckpointBody,
  substituteCheckpointBody,
} from '../src/services/checkpointBodyFetch.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the code as it was before 2026-10-06 (verbatim behaviour) -------------
async function legacyGzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function legacyBytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}
async function legacyCheckpointHex(doc) {
  return legacyBytesToPgHex(await legacyGzip(Y.encodeStateAsUpdate(doc)));
}

// ---- an in-process worker ----------------------------------------------------
class InProcessCheckpointWorker {
  constructor({ failOps = new Set(), gate = null, getOutbox = null } = {}) {
    this.getOutbox = getOutbox;
    this.mirrors = new Map();
    this.chain = Promise.resolve();
    this.ops = [];
    this.failOps = failOps;
    this.gate = gate;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(data, transfer = []) {
    // Like postMessage: a copy, with the listed buffers moved (the sender's
    // views of them become empty).
    const message = structuredClone(data, { transfer });
    this.ops.push(message.op);
    this.chain = this.chain.then(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      if (message.op === 'mirror-checkpoint' && this.gate) await this.gate();
      try {
        if (this.failOps.has(message.op)) throw new Error(`stand-in failure on ${message.op}`);
        const outcome = await runCheckpointRequest(this.mirrors, message, { getOutbox: this.getOutbox });
        if (message.requestId == null) return;
        const reply = structuredClone(
          { requestId: message.requestId, result: outcome?.reply ?? null },
          { transfer: outcome?.transfer || [] },
        );
        this.onmessage?.({ data: reply });
      } catch (error) {
        if (message.requestId == null) return;
        this.onmessage?.({ data: { requestId: message.requestId, error: String(error?.message || error) } });
      }
    });
  }

  terminate() {}
}

afterEach(() => __setCheckpointWorkerFactoryForTests(null));

// ---- a cloud with the store_annotation_snapshot rules -------------------------
// `viaFetch`: the snapshot RPC goes over "HTTP" like supabase-js does it
// (JSON.stringify of the arguments, then the client's fetch, here the app's
// checkpointBodyFetch); the cloud reads the arguments back from the body
// bytes that reached the wire.
function createCloud(documentId, { viaFetch = false } = {}) {
  const rows = [];
  const wireBodies = [];
  let snapshot = null;
  const snapshotCalls = [];
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
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
        if (existing) return { data: [{ seq: existing.seq }], error: null };
        const row = {
          document_id: documentId,
          client_id: args.p_client_id,
          client_seq: args.p_client_seq,
          actor_user_id: 'user-a',
          data: args.p_data,
          seq: rows.length + 1,
        };
        rows.push(row);
        return { data: [{ seq: row.seq }], error: null };
      }
      if (name === 'store_annotation_snapshot') {
        if (viaFetch) {
          const body = JSON.stringify(args, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
          const realFetch = globalThis.fetch;
          let sent = null;
          globalThis.fetch = async (_url, init) => {
            sent = init.body;
            return { ok: true };
          };
          try {
            await checkpointBodyFetch('https://example.supabase.co/rest/v1/rpc/store_annotation_snapshot', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            });
          } finally {
            globalThis.fetch = realFetch;
          }
          const wire = typeof sent === 'string' ? Buffer.from(sent) : Buffer.from(await sent.arrayBuffer());
          wireBodies.push({ wire, rpcBody: body });
          args = JSON.parse(wire.toString('utf8'));
        }
        snapshotCalls.push({ ...args });
        const baseMatches = snapshot
          ? (
            snapshot.at_seq === args.p_expected_at_seq
            && snapshot.writer_id === args.p_expected_writer_id
            && snapshot.writer_epoch === args.p_expected_writer_epoch
          )
          : (args.p_expected_at_seq == null && args.p_expected_writer_id == null);
        if (rows.length !== args.p_at_seq || !baseMatches) return { data: false, error: null };
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
              abortSignal() { return b; },
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
  };
  if (viaFetch) enableCheckpointBodySubstitution(supabase);
  return { rows, snapshotCalls, wireBodies, supabase, get snapshot() { return snapshot; } };
}

function open(cloud, documentId, clientId = 'a', extra = {}) {
  return openAnnotationDoc({
    documentId,
    supabase: cloud.supabase,
    clientId,
    actorUserId: 'user-a',
    enableLocal: false,
    enableRealtime: false,
    doc: createDetachedYDoc(`checkpoint-worker-test:${documentId}:${clientId}`),
    outboxStore: createMemoryAnnotationOutbox(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    // Checkpoints only when the test asks (flushSnapshot).
    checkpointPolicy: { everyRows: 10_000, ownBytes: 1e12, idleMs: 3_600_000, dueQuietMs: 3_600_000 },
    ...extra,
  });
}

function activeState(documentId) {
  const states = [...(globalThis.__annotationDocSyncActiveStates__?.get(documentId) || [])];
  assert.equal(states.length, 1, 'one open handle');
  return states[0];
}

// Real marks: the Package 2 page-1 strokes (imported ink, ~25 KB each).
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/package2-page1-two-lane-erase.json', import.meta.url), 'utf8'));
const BASES = Object.values(FIXTURE.marks).map((mark) => mark.base);
const rect = (id, left = 10) => ({
  type: 'rect', left, top: 20, width: 100, height: 50,
  stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { id, type: 'rect' },
});

// A mix of adds, moves (overwrites) and deletes over a few pages.
async function drawSome(handle, rounds = 3) {
  const pages = { 1: [...BASES.map((base) => structuredClone(base))], 2: [], 3: [] };
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < 6; i += 1) pages[1 + (i % 3)].push(rect(`r${round}-${i}`, 10 + i));
    handle.applyByPage(Object.fromEntries(Object.entries(pages).map(([n, objects]) => [n, { objects: [...objects] }])));
    await handle.drain();
    pages[2] = pages[2].map((object, index) => (index % 2 ? { ...object, left: object.left + 5 } : object));
    pages[3] = pages[3].filter((_object, index) => index % 3 !== 0);
    handle.applyByPage(Object.fromEntries(Object.entries(pages).map(([n, objects]) => [n, { objects: [...objects] }])));
    await handle.drain();
  }
}

async function storedUpdate(cloud) {
  return gunzipBytes(pgHexToBytes(cloud.snapshot.snapshot));
}

const markIds = (byPage) => Object.values(byPage || {})
  .flatMap((page) => (page?.objects || []).map((object) => object?.data?.id || object?.id))
  .sort();

test('worker path stores exactly the bytes the old main-thread code stored', async () => {
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker();
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-identical';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId);
  await drawSome(handle);
  assert.equal(await handle.flushSnapshot(), true, 'checkpoint stored');
  const state = activeState(documentId);
  assert.ok(state.checkpointMirror && !state.checkpointMirror.broken, 'the mirror was used and is healthy');
  assert.ok(workers[0].ops.includes('mirror-checkpoint'), 'the worker built the checkpoint');
  assert.equal(workers[0].ops.filter((op) => op === 'mirror-apply').length, state.checkpointMirror.applied);

  const oldHex = await legacyCheckpointHex(state.acceptedDoc);
  assert.equal(cloud.snapshot.snapshot, oldHex, 'stored hex text identical to the old path');
  assert.deepEqual(await storedUpdate(cloud), Y.encodeStateAsUpdate(state.acceptedDoc), 'same Yjs bytes');
  assert.equal(cloud.snapshot.at_seq, cloud.rows.length, 'at_seq is the WAL head');
  // The RPC arguments other than the body are what they always were.
  const call = cloud.snapshotCalls.at(-1);
  assert.deepEqual(
    Object.keys(call).sort(),
    ['p_at_seq', 'p_document_id', 'p_encoding_version', 'p_expected_at_seq', 'p_expected_writer_epoch',
      'p_expected_writer_id', 'p_snapshot', 'p_writer_epoch', 'p_writer_id'].sort(),
  );

  // More edits, a second checkpoint: still identical.
  await drawSome(handle, 2);
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  const expected = markIds(handle.getByPage());
  await handle.destroy();

  // A reopen without any worker reads that checkpoint and shows every mark.
  __setCheckpointWorkerFactoryForTests(null);
  const reopened = await open(cloud, documentId, 'b');
  assert.deepEqual(markIds(reopened.getByPage()), expected);
  await reopened.destroy();
});

test('no worker (tests, old WebViews): same bytes from the main thread', async () => {
  const documentId = 'checkpoint-worker-none';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId);
  const state = activeState(documentId);
  assert.equal(state.checkpointMirror, null, 'no Worker here: no mirror');
  await drawSome(handle);
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  await handle.destroy();
});

test('a worker that fails mid-checkpoint: the checkpoint is built on the main thread instead, same bytes', async () => {
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker({ failOps: new Set(['mirror-checkpoint']) });
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-fails';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId);
  await drawSome(handle);
  assert.equal(await handle.flushSnapshot(), true, 'still stored');
  const state = activeState(documentId);
  assert.equal(state.checkpointMirror.broken, true, 'the mirror is switched off after a failure');
  assert.equal(cloud.snapshotCalls.length, 1, 'one upload (the failed attempt never reached the server)');
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  // Later checkpoints keep working, on the main thread.
  await drawSome(handle, 1);
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  assert.equal(workers[0].ops.filter((op) => op === 'mirror-checkpoint').length, 1, 'not asked again');
  await handle.destroy();
});

test('a worker that cannot start: everything runs on the main thread', async () => {
  __setCheckpointWorkerFactoryForTests(() => { throw new Error('module workers unsupported'); });
  const documentId = 'checkpoint-worker-cannot-start';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId);
  const state = activeState(documentId);
  assert.equal(state.checkpointMirror, null);
  await drawSome(handle, 1);
  assert.equal(await handle.flushSnapshot(), true);
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  await handle.destroy();
});

test('edits made while the worker builds a checkpoint go into the next one, nothing is lost', async () => {
  let release = null;
  let gateHit = null;
  const gateReached = new Promise((resolve) => { gateHit = resolve; });
  let gated = true;
  __setCheckpointWorkerFactoryForTests(() => new InProcessCheckpointWorker({
    gate: () => {
      if (!gated) return null;
      gated = false;
      gateHit();
      return new Promise((resolve) => { release = resolve; });
    },
  }));
  const documentId = 'checkpoint-worker-concurrent-edit';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId);
  await drawSome(handle, 1);
  const state = activeState(documentId);
  const rowsAtRequest = cloud.rows.length;
  const acceptedAtRequest = Y.encodeStateAsUpdate(state.acceptedDoc);
  const flushing = handle.flushSnapshot();
  await gateReached;
  // While the worker is busy: a new stroke, accepted by the cloud.
  const mine = handle.getByPage()?.[1]?.objects || [];
  handle.applyByPage({ ...handle.getByPage(), 1: { objects: [...mine, rect('during-checkpoint', 300)] } });
  await wait(20);
  assert.ok(cloud.rows.length > rowsAtRequest, 'the new stroke reached the WAL meanwhile');
  release();
  await flushing;
  // A consistent checkpoint: it holds every row up to its at_seq (the stroke
  // drawn meanwhile is either merged in with a later at_seq, as the old code
  // did when rows landed before the upload, or left to the WAL tail).
  const stored = await storedUpdate(cloud);
  const storedVector = Y.encodeStateVectorFromUpdate(stored);
  for (const row of cloud.rows.filter((r) => r.seq <= cloud.snapshot.at_seq)) {
    const missing = Y.diffUpdate(pgHexToBytes(row.data), storedVector);
    assert.equal(Y.decodeUpdate(missing).structs.length, 0, `row ${row.seq} is in the checkpoint`);
  }
  if (cloud.snapshot.at_seq === rowsAtRequest) assert.deepEqual(stored, acceptedAtRequest);
  await handle.drain();
  const expected = markIds(handle.getByPage());
  assert.ok(expected.includes('during-checkpoint'));
  await handle.destroy();
  __setCheckpointWorkerFactoryForTests(null);
  const reopened = await open(cloud, documentId, 'b');
  assert.deepEqual(markIds(reopened.getByPage()), expected, 'the reopen shows the stroke drawn mid-checkpoint');
  await reopened.destroy();
});

// ---- the pure module ------------------------------------------------------------

function seededRandom(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

test('a mirror fed the same updates encodes byte for byte like the original (random edits, out-of-order delivery)', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = seededRandom(seed);
    const writers = [0, 1, 2].map((index) => createDetachedYDoc(`writer-${seed}-${index}`));
    const updates = [];
    for (const writer of writers) writer.on('update', (update) => updates.push(update));
    for (let step = 0; step < 60; step += 1) {
      const writer = writers[Math.floor(random() * writers.length)];
      const map = writer.getMap(random() < 0.7 ? 'annotations' : 'eraserOps');
      const key = `k${Math.floor(random() * 12)}`;
      const roll = random();
      if (roll < 0.15 && map.has(key)) map.delete(key);
      else if (roll < 0.3) {
        const nested = new Y.Map();
        map.set(key, nested);
        nested.set('v', step);
      } else {
        map.set(key, { step, path: Array.from({ length: Math.floor(random() * 20) }, () => random()) });
      }
      // Writers sometimes sync with each other (concurrent edits merge).
      if (random() < 0.2) {
        const other = writers[Math.floor(random() * writers.length)];
        if (other !== writer) Y.applyUpdate(other, Y.encodeStateAsUpdate(writer, Y.encodeStateVector(other)), 'peer');
      }
    }
    // Delivered to the accepted document out of order (pending structs).
    const order = updates.map((update, index) => ({ update, key: random() + (index % 7 === 0 ? 1 : 0) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.update);
    const accepted = createDetachedYDoc(`accepted-${seed}`);
    const mirror = createCheckpointMirror(`m-${seed}`);
    for (const update of order) {
      Y.applyUpdate(accepted, update, 'hydrate');
      applyToCheckpointMirror(mirror, new Uint8Array(update));
    }
    const fromMirror = encodeCheckpointFromMirror(mirror, {
      expectedApplied: order.length,
      expectedVector: Y.encodeStateVector(accepted),
    });
    assert.deepEqual(fromMirror, Y.encodeStateAsUpdate(accepted), `seed ${seed}`);
  }
});

test('a mirror that missed an update refuses to encode (the caller then encodes on the main thread)', () => {
  const writer = createDetachedYDoc('writer-missed');
  const updates = [];
  writer.on('update', (update) => updates.push(update));
  writer.getMap('annotations').set('a', 1);
  writer.getMap('annotations').set('b', 2);
  const accepted = createDetachedYDoc('accepted-missed');
  const mirror = createCheckpointMirror('m-missed');
  updates.forEach((update) => Y.applyUpdate(accepted, update));
  applyToCheckpointMirror(mirror, updates[0]);
  assert.throws(() => encodeCheckpointFromMirror(mirror, {
    expectedApplied: 2,
    expectedVector: Y.encodeStateVector(accepted),
  }), /out of step/);
  assert.throws(() => encodeCheckpointFromMirror(mirror, {
    expectedApplied: 1,
    expectedVector: Y.encodeStateVector(accepted),
  }), /state vector differs/);
});

test('upload preparation: same hex as the old code; worker and main thread agree', async () => {
  const doc = createDetachedYDoc('prepare-doc');
  syncByPageToDoc(doc, { 1: { objects: BASES }, 2: { objects: [rect('x')] } });
  const update = Y.encodeStateAsUpdate(doc);
  const legacy = legacyBytesToPgHex(await legacyGzip(update));
  const here = await prepareCheckpointUpload(update);
  assert.equal(here.hex, legacy);
  assert.deepEqual(here.stateVector, Y.encodeStateVectorFromUpdate(update));
  __setCheckpointWorkerFactoryForTests(() => new InProcessCheckpointWorker());
  const viaWorker = await prepareCheckpointUploadOffThread(update);
  assert.equal(viaWorker.hex, legacy);
  assert.equal(viaWorker.gzippedLength, here.gzippedLength);
  assert.equal(update.length > 0, true, 'the caller keeps its bytes (a copy is transferred)');
  // Every byte value round-trips through the hex text like before.
  const all = Uint8Array.from({ length: 256 }, (_v, i) => i);
  assert.equal(bytesToPgHex(all), legacyBytesToPgHex(all));
  assert.deepEqual(pgHexToBytes(legacyBytesToPgHex(all)), all);
});

test('a routine (due) checkpoint is built by the worker, same bytes as the old code', async () => {
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker();
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-routine';
  const cloud = createCloud(documentId);
  const handle = await openAnnotationDoc({
    documentId,
    supabase: cloud.supabase,
    clientId: 'a',
    actorUserId: 'user-a',
    enableLocal: false,
    enableRealtime: false,
    doc: createDetachedYDoc(`checkpoint-worker-test:${documentId}`),
    outboxStore: createMemoryAnnotationOutbox(),
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    // Every 4th row owes a checkpoint, written 10 ms after the last append.
    checkpointPolicy: { everyRows: 4, dueQuietMs: 10, idleMs: 3_600_000 },
  });
  await drawSome(handle, 1);
  for (let waited = 0; !cloud.snapshot && waited < 3000; waited += 10) await wait(10);
  await wait(50);
  await handle.drain();
  assert.ok(cloud.snapshot, 'a due checkpoint was written');
  assert.ok(workers[0].ops.includes('mirror-checkpoint'), 'by the worker');
  const state = activeState(documentId);
  assert.equal(cloud.snapshot.at_seq, cloud.rows.length);
  assert.equal(cloud.snapshot.snapshot, await legacyCheckpointHex(state.acceptedDoc));
  await handle.destroy();
});

test('the app client path: the request body on the wire is byte for byte JSON.stringify of the old arguments', async () => {
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker();
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-wire';
  const cloud = createCloud(documentId, { viaFetch: true });
  const handle = await open(cloud, documentId);
  await drawSome(handle, 2);
  assert.equal(await handle.flushSnapshot(), true);
  await drawSome(handle, 1);
  assert.equal(await handle.flushSnapshot(), true);
  const state = activeState(documentId);
  assert.equal(cloud.wireBodies.length, 2);
  for (const { rpcBody } of cloud.wireBodies) {
    assert.ok(rpcBody.length < 2000, 'the main thread only stringified a short marker');
  }
  // The last upload, rebuilt the old way from the same document: identical.
  const last = cloud.snapshotCalls.at(-1);
  const oldArgs = { ...last, p_snapshot: await legacyCheckpointHex(state.acceptedDoc) };
  const oldBody = Buffer.from(JSON.stringify(oldArgs));
  assert.ok(cloud.wireBodies.at(-1).wire.equals(oldBody), 'same request bytes as before');
  assert.equal(cloud.snapshot.snapshot, oldArgs.p_snapshot);
  assert.ok(workers[0].ops.includes('mirror-checkpoint'));
  await handle.destroy();
});

test('checkpoint body markers: swapped for their exact bytes; an unknown marker is never sent', async () => {
  const hex = legacyBytesToPgHex(Uint8Array.from({ length: 300 }, (_v, i) => (i * 7) % 256));
  const marker = registerCheckpointBody(new TextEncoder().encode(JSON.stringify(hex)));
  const args = { p_document_id: 'd', p_at_seq: 3, p_snapshot: marker, p_writer_epoch: 2 };
  const swapped = substituteCheckpointBody(JSON.stringify(args));
  assert.equal(await swapped.text(), JSON.stringify({ ...args, p_snapshot: hex }));
  assert.equal(substituteCheckpointBody('{"a":1}'), '{"a":1}', 'other bodies pass through untouched');
  releaseCheckpointBody(marker);
  assert.throws(() => substituteCheckpointBody(JSON.stringify(args)), /no longer available/);
  await assert.rejects(checkpointBodyFetch('https://x/rpc', { method: 'POST', body: JSON.stringify(args) }), /no longer available/);
});

// ---- the device's saved copy (IndexedDB outbox) --------------------------------

async function idbPair() {
  const { IDBFactory } = await import('fake-indexeddb');
  const indexedDb = new IDBFactory();
  const page = await createAnnotationOutbox({ indexedDb, timeoutMs: 5000 });
  // The worker opens its own connection to the same database.
  let workerOutbox = null;
  const getOutbox = () => {
    workerOutbox ??= createAnnotationOutbox({ indexedDb, timeoutMs: 5000 });
    return workerOutbox;
  };
  return { page, getOutbox, close: async () => { await page.close(); await (await workerOutbox)?.close(); } };
}

test('with an IndexedDB outbox the written checkpoint is saved locally by the worker, same bytes as the upload', async () => {
  const idb = await idbPair();
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker({ getOutbox: idb.getOutbox });
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-idb-save';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId, 'a', { outboxStore: idb.page });
  await drawSome(handle, 2);
  assert.equal(await handle.flushSnapshot(), true);
  const state = activeState(documentId);
  assert.ok(workers[0].ops.includes('outbox-compact'), 'saved by the worker');
  const clean = await idb.page.loadCleanState(documentId, 'user-a');
  assert.deepEqual(clean.checkpointUpdate, await storedUpdate(cloud), 'the saved copy is the uploaded checkpoint');
  assert.equal(clean.checkpointToken, state.cleanCheckpointToken, 'and this screen knows it is');
  assert.equal(clean.snapshotIdentity?.atSeq, cloud.snapshot.at_seq);
  assert.deepEqual(clean.records, [], 'every accepted row is folded into it');
  await handle.destroy();
  await idb.close();
});

test('every 40 accepted rows the local compaction runs in the worker from the mirror', async () => {
  const idb = await idbPair();
  const workers = [];
  __setCheckpointWorkerFactoryForTests(() => {
    const worker = new InProcessCheckpointWorker({ getOutbox: idb.getOutbox });
    workers.push(worker);
    return worker;
  });
  const documentId = 'checkpoint-worker-idb-compact';
  const cloud = createCloud(documentId);
  const handle = await open(cloud, documentId, 'a', { outboxStore: idb.page });
  const mine = [];
  for (let index = 0; index < 45; index += 1) {
    mine.push(rect(`c${index}`, index));
    handle.applyByPage({ 1: { objects: [...mine] } });
    await handle.drain();
  }
  await wait(20);
  const state = activeState(documentId);
  assert.ok(workers[0].ops.includes('outbox-compact'), 'the worker compacted');
  const clean = await idb.page.loadCleanState(documentId, 'user-a');
  assert.ok(clean.records.length < 40, `compacted (${clean.records.length} rows left)`);
  // The saved copy plus the rows after it is the accepted document.
  const rebuilt = createDetachedYDoc('rebuilt-from-saved-copy');
  Y.applyUpdate(rebuilt, clean.checkpointUpdate);
  for (const record of clean.records) Y.applyUpdate(rebuilt, record.update);
  const accepted = state.acceptedDoc.getMap(ANNOTATIONS_MAP).toJSON();
  assert.equal(Object.keys(accepted).length, 45, 'all 45 marks accepted');
  assert.deepEqual(rebuilt.getMap(ANNOTATIONS_MAP).toJSON(), accepted);
  assert.equal(cloud.rows.length, 45);
  await handle.destroy();
  await idb.close();
});
