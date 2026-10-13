import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

// A minimal Supabase test double for the annotation op-log / snapshot path.
// `insertBehavior` decides what annotation_updates.insert resolves to, so a test
// can simulate a network failure on the per-op append while the snapshot upsert
// still succeeds (the BL-24 durability guarantee).
function makeSupabase({ insertBehavior }) {
  const calls = { inserts: 0, snapshotUpserts: 0 };
  const emptyThen = (result) => {
    // Chainable builder whose every method returns itself; awaiting/maybeSingle
    // resolves to `result`.
    const b = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = chain;
    b.maybeSingle = async () => result;
    b.single = async () => result;
    b.then = (res) => res(result); // make it awaitable as { data, error }
    return b;
  };
  return {
    calls,
    from(table) {
      if (table === 'annotation_updates') {
        return {
          // seed client_seq + tail reads → empty
          select: () => emptyThen({ data: [] }),
          insert: () => ({
            select: () => ({
              single: async () => {
                calls.inserts += 1;
                return insertBehavior(calls.inserts);
              },
            }),
          }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => emptyThen({ data: null }),
          upsert: async () => { calls.snapshotUpserts += 1; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('BL-24: a failed op append forces an eager snapshot so the mark is still durable', async () => {
  const supabase = makeSupabase({
    insertBehavior: () => ({ data: null, error: { message: 'network down', code: 'XX000' } }),
  });
  const doc = new Y.Doc();
  const statuses = [];
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-bl24', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: false, doc,
  });
  handle.onSyncStatus((s) => statuses.push(s));

  const snapshotsBefore = supabase.calls.snapshotUpserts;
  // A real user edit → append is attempted, fails, eager snapshot must run.
  handle.applyByPage({ 6: { objects: [{ type: 'path', data: { id: 'm1' }, pageNumber: 6 }] } });
  await handle.drain();
  // let the catch's async eager-snapshot settle
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(supabase.calls.inserts >= 1, 'the op append was attempted');
  assert.ok(
    supabase.calls.snapshotUpserts > snapshotsBefore,
    'a snapshot was written immediately after the append failed (durability preserved)',
  );
  // Snapshot succeeded → data is safe → health reports healthy (never silently lost).
  assert.equal(handle.isSyncHealthy(), true, 'eager snapshot success means the mark is durable');

  await handle.destroy();
});

test('BL-24: sync-health flips to failing only when BOTH the op AND the eager snapshot fail', async () => {
  // insert fails AND snapshot upsert fails → data genuinely at risk → unhealthy.
  const supabase = makeSupabase({
    insertBehavior: () => ({ data: null, error: { message: 'network down', code: 'XX000' } }),
  });
  // override snapshot upsert to also fail
  const origFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === 'annotation_snapshots') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        upsert: async () => ({ error: { message: 'snapshot store down' } }),
      };
    }
    return origFrom(table);
  };
  const doc = new Y.Doc();
  const statuses = [];
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-bl24b', supabase, clientId: 'clientB',
    enableLocal: false, enableRealtime: false, doc,
  });
  handle.onSyncStatus((s) => statuses.push(s));

  handle.applyByPage({ 3: { objects: [{ type: 'path', data: { id: 'm2' }, pageNumber: 3 }] } });
  await handle.drain();
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(handle.isSyncHealthy(), false, 'both writes failed → not healthy');
  assert.ok(statuses.some((s) => s.healthy === false && s.error), 'an unhealthy status with a reason was emitted');

  await handle.destroy();
});

test('BL-24 fix: concurrent snapshot writes are serialized — never two in flight at once', async () => {
  // Track how many snapshot upserts overlap. A slow upsert lets a second one
  // start if serialization is broken (the pre-fix bug reproduced 2 concurrent).
  let inFlight = 0;
  let maxConcurrent = 0;
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        const empty = { data: [] };
        const b = {};
        for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = () => b;
        b.then = (res) => res(empty);
        return {
          select: () => b,
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: 1 }, error: null }) }) }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => {
            inFlight += 1;
            maxConcurrent = Math.max(maxConcurrent, inFlight);
            await new Promise((r) => setTimeout(r, 15));
            inFlight -= 1;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-serial', supabase, clientId: 'clientS',
    enableLocal: false, enableRealtime: false, doc,
  });
  // Fire many snapshot writes as fast as possible.
  await Promise.all([
    handle.flushSnapshot(), handle.flushSnapshot(), handle.flushSnapshot(),
    handle.flushSnapshot(), handle.flushSnapshot(),
  ]);
  assert.equal(maxConcurrent, 1, 'snapshot writes never overlap (serialized)');
  await handle.destroy();
});

test('BL-24 fix: a stale snapshot completing after a newer edit still leaves a tab-close flush pending', async () => {
  // Reproduce the round-2 defect: edit A -> its snapshot goes in flight (slow) ->
  // edit B arrives while A's snapshot is pending -> A's snapshot completes. The
  // newer edit B must NOT be marked saved, so a pagehide-driven flush still runs.
  const g = globalThis;
  const hadWindow = 'window' in g;
  const hadDocument = 'document' in g;
  const listeners = {};
  g.window = {
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    removeEventListener: (ev) => { delete listeners[ev]; },
  };
  g.document = { visibilityState: 'hidden' };

  let releaseFirstUpsert;
  let markFirstUpsertStarted;
  let markSubsequentUpsertStarted;
  let upsertCount = 0;
  const gate = new Promise((r) => { releaseFirstUpsert = r; });
  const firstUpsertStarted = new Promise((r) => { markFirstUpsertStarted = r; });
  const subsequentUpsertStarted = new Promise((r) => { markSubsequentUpsertStarted = r; });
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        const b = {};
        for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = () => b;
        b.then = (res) => res({ data: [] });
        return {
          select: () => b,
          // op append succeeds instantly so we isolate the snapshot-generation logic
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: ++upsertCount }, error: null }) }) }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => {
            const n = ++snapUpserts;
            if (n === 1) {
              markFirstUpsertStarted();
              await gate; // hold the first snapshot in flight
            } else {
              markSubsequentUpsertStarted();
            }
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  let snapUpserts = 0;
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-stale', supabase, clientId: 'clientG',
    enableLocal: false, enableRealtime: false, doc,
    // w33: a tab-close checkpoint needs this screen's rows past a minimum
    // tail; one uncaptured row is enough here.
    checkpointPolicy: { minTailRows: 1 },
  });
  try {
    // Edit A → start a snapshot that will hang on the gate.
    handle.applyByPage({ 1: { objects: [{ type: 'path', data: { id: 'A' }, pageNumber: 1 }] } });
    const firstSnap = handle.flushSnapshot();
    await Promise.race([
      firstUpsertStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('first snapshot did not start')), 1000)),
    ]);
    // Edit B arrives while A's snapshot is still in flight.
    handle.applyByPage({ 1: { objects: [
      { type: 'path', data: { id: 'A' }, pageNumber: 1 },
      { type: 'path', data: { id: 'B' }, pageNumber: 1 },
    ] } });
    // Let A's snapshot finish (it captured only A).
    releaseFirstUpsert();
    await firstSnap;
    await new Promise((r) => setTimeout(r, 5));
    const before = snapUpserts;
    // Tab close: because B is uncaptured, a flush MUST run.
    listeners.pagehide?.();
    await Promise.race([
      subsequentUpsertStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('tab-close snapshot did not start')), 1000)),
    ]);
    assert.ok(snapUpserts > before, 'a tab-close flush runs because the newer edit was not captured');
  } finally {
    await handle.destroy();
    if (hadWindow) { /* leave */ } else { delete g.window; }
    if (hadDocument) { /* leave */ } else { delete g.document; }
  }
});

test('BL-24: a later append cannot hide an unreconstructible predecessor gap', async () => {
  let failFirst = true;
  const supabase = makeSupabase({
    insertBehavior: () => {
      if (failFirst) { failFirst = false; return { data: null, error: { message: 'blip', code: 'XX000' } }; }
      return { data: { seq: 42 }, error: null };
    },
  });
  // snapshot upsert also fails so the first failure genuinely marks unhealthy
  const origFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === 'annotation_snapshots') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        upsert: async () => ({ error: { message: 'snap down' } }),
      };
    }
    return origFrom(table);
  };
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-bl24c', supabase, clientId: 'clientC',
    enableLocal: false, enableRealtime: false, doc,
  });

  handle.applyByPage({ 1: { objects: [{ type: 'path', data: { id: 'first' }, pageNumber: 1 }] } });
  await handle.drain();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(handle.isSyncHealthy(), false, 'first append failed → unhealthy');

  handle.applyByPage({ 1: { objects: [
    { type: 'path', data: { id: 'first' }, pageNumber: 1 },
    { type: 'path', data: { id: 'second' }, pageNumber: 1 },
  ] } });
  await handle.drain();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    handle.isSyncHealthy(),
    false,
    'a later append does not repair the earlier update missing from WAL and snapshots',
  );

  await handle.destroy();
});

test('BL-24: fresh clients recover missing predecessors only after a full repair snapshot', async () => {
  const rows = [];
  let failFirstAppend = true;
  let snapshotsWritable = false;
  let snapshot = null;
  const emptyThen = (result) => {
    const builder = {};
    for (const method of ['select', 'eq', 'gt', 'order', 'limit']) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = async () => result;
    builder.then = (resolve) => resolve(result);
    return builder;
  };
  const supabase = {
    from(table) {
      if (table === 'annotation_updates') {
        return {
          select: () => emptyThen({ data: rows, error: null }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                if (failFirstAppend) {
                  failFirstAppend = false;
                  return { data: null, error: { code: 'XX000', message: 'first WAL write lost' } };
                }
                const committed = { ...row, seq: rows.length + 1 };
                rows.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => emptyThen({ data: snapshot, error: null }),
          upsert: async (row) => {
            if (!snapshotsWritable) return { error: { code: 'XX000', message: 'snapshot unavailable' } };
            snapshot = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const ids = (handle) => Object.values(handle.getByPage())
    .flatMap((page) => page?.objects || [])
    .map((object) => object?.data?.id)
    .sort();

  const writer = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-gap-repair',
    supabase,
    clientId: 'gap-writer',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });
  writer.applyByPage({ 1: { objects: [{ type: 'path', data: { id: 'A' } }] } });
  await writer.drain();
  writer.applyByPage({ 1: { objects: [
    { type: 'path', data: { id: 'A' } },
    { type: 'path', data: { id: 'B' } },
  ] } });
  await writer.drain();

  assert.equal(writer.isSyncHealthy(), false);
  const beforeRepair = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-gap-repair',
    supabase,
    clientId: 'fresh-before',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: createMemoryAnnotationOutbox(),
    doc: new Y.Doc(),
  });
  assert.notDeepEqual(ids(beforeRepair), ['A', 'B'], 'WAL row B alone cannot reconstruct missing predecessor A');

  snapshotsWritable = true;
  assert.equal(await writer.flushSnapshot(), true);
  assert.equal(writer.isSyncHealthy(), true);

  const afterRepair = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-gap-repair',
    supabase,
    clientId: 'fresh-after',
    enableLocal: false,
    enableRealtime: false,
    outboxStore: createMemoryAnnotationOutbox(),
    doc: new Y.Doc(),
  });
  assert.deepEqual(ids(afterRepair), ['A', 'B'], 'accepted full snapshot repairs fresh-client replay');

  await Promise.all([beforeRepair.destroy(), afterRepair.destroy(), writer.destroy()]);
});
