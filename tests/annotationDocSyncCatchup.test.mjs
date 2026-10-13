// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — the flat store's durable mark map is `marks` (store v3); these tests use it
// as a generic durable map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import * as Y from 'yjs';

import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import { getMetaValue, setMetaValue } from '../src/services/annotationDocStore.js';

const { bytesToPgHex, pgHexToBytes } = __test;

// Build the update bytes another device would have committed to the op log.
function makeRemoteOpHex(annotationId) {
  const remote = new Y.Doc();
  let captured;
  remote.on('update', (u) => { captured = u; });
  remote.getMap('marks').set(annotationId, { id: annotationId, pageNumber: 2, type: 'path' });
  return bytesToPgHex(captured);
}

function makeRemoteSpacesHex(spaces) {
  const remote = new Y.Doc();
  let captured;
  remote.on('update', (u) => { captured = u; });
  setMetaValue(remote, 'spaces', spaces, 'remote-test');
  return bytesToPgHex(captured);
}

function makeSeedAndDelete(annotationId) {
  const source = new Y.Doc();
  let captured = null;
  source.on('update', (update) => { captured = update; });
  source.getMap('marks').set(annotationId, {
    id: annotationId,
    pageNumber: 2,
    type: 'path',
  });
  const seed = captured;
  source.getMap('marks').delete(annotationId);
  return {
    seed,
    deleteHex: bytesToPgHex(captured),
  };
}

// Supabase double with a mutable annotation_updates log + a capturable
// realtime channel, so a test can drop a row into the log AFTER hydrate but
// BEFORE the channel confirms SUBSCRIBED — the exact open-time race window.
function makeSupabase() {
  const log = []; // rows: { seq, data, client_id }
  let subscribeCallback = null;
  let realtimeCallback = null;
  const supabase = {
    log,
    lastSnapshot: null,
    beforeInsert: null,
    failTailReads: false,
    failWrites: false,
    tailReadGate: null,
    fireSubscribed() { return subscribeCallback?.('SUBSCRIBED'); },
    fireStatus(status) { return subscribeCallback?.(status); },
    fireRealtime(row) { realtimeCallback?.({ new: row }); },
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_col, v) => { filters.gtSeq = Number(v); return builder; },
          order: () => builder,
          limit: () => builder,
          insert: (row) => ({
            select: () => ({
              single: async () => {
                if (supabase.failWrites) {
                  return { data: null, error: { code: 'XX000', message: 'offline' } };
                }
                if (supabase.beforeInsert) await supabase.beforeInsert(row);
                const committed = { ...row, seq: log.length + 1 };
                log.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: async (resolve) => {
            if (filters.gtSeq !== null && supabase.tailReadGate) {
              await supabase.tailReadGate;
            }
            if (filters.gtSeq !== null && supabase.failTailReads) {
              resolve({ data: null, error: { code: 'XX000', message: 'catch-up offline' } });
              return;
            }
            const rows = filters.gtSeq === null
              ? [] // the client_seq seed query
              : log.filter((r) => r.seq > filters.gtSeq);
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async (row) => {
            if (supabase.failWrites) {
              return { error: { code: 'XX000', message: 'snapshot offline' } };
            }
            supabase.lastSnapshot = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on(_event, _filter, callback) { realtimeCallback = callback; return this; },
      subscribe(cb) { subscribeCallback = cb; return this; },
    }),
  };
  return supabase;
}

function makeTwoClientSupabase() {
  const log = [];
  const channels = [];
  let broadcastEnabled = true;
  const supabase = {
    log,
    setBroadcastEnabled(value) { broadcastEnabled = value; },
    fireSubscribed(clientIndex = null) {
      const targets = clientIndex == null
        ? channels
        : channels.filter((_channel, index) => index === clientIndex);
      return Promise.all(targets.map((channel) => channel.status?.('SUBSCRIBED')));
    },
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_column, value) => { filters.gtSeq = Number(value); return builder; },
          order: () => builder,
          limit: () => builder,
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const committed = { ...row, seq: log.length + 1 };
                log.push(committed);
                if (broadcastEnabled) {
                  for (const channel of channels) channel.realtime?.({ new: committed });
                }
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => resolve({
            data: filters.gtSeq == null ? [] : log.filter((row) => row.seq > filters.gtSeq),
            error: null,
          }),
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel(topic) {
      const channel = {
        clientId: topic,
        realtime: null,
        status: null,
        on(_event, _filter, callback) { channel.realtime = callback; return channel; },
        subscribe(callback) { channel.status = callback; channels.push(channel); return channel; },
      };
      return channel;
    },
    removeChannel: async () => ({ status: 'ok' }),
  };
  return supabase;
}

test('open-time race: an op committed between hydrate and SUBSCRIBED is applied by the catch-up sweep', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-race', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  const changes = [];
  handle.onChange((byPage) => changes.push(byPage));

  // Hydrate saw an empty log. Another device now commits an op in the gap.
  supabase.log.push({ seq: 1, data: makeRemoteOpHex('missed-mark'), client_id: 'other-device' });

  // Realtime never forwards that row (it predates the join). SUBSCRIBED fires.
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(doc.getMap('marks').has('missed-mark'), 'the missed op is applied');
  assert.ok(changes.length >= 1, 'listeners are notified so the viewer re-renders');
  await handle.destroy();
});

test('status is not Up to date until realtime join and its catch-up sweep finish', async () => {
  const supabase = makeSupabase();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-honest-status', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc: new Y.Doc(),
  });

  assert.notEqual(handle.getSyncStatus().stage, 'idle', 'joining realtime is not Up to date');
  const catchup = supabase.fireSubscribed();
  assert.notEqual(handle.getSyncStatus().stage, 'idle', 'catch-up in flight is not Up to date');
  await catchup;
  assert.equal(handle.getSyncStatus().stage, 'idle', 'successful catch-up reaches Up to date');
  await handle.destroy();
});

test('failed catch-up cannot report Up to date', async () => {
  const supabase = makeSupabase();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-failed-honest-status', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc: new Y.Doc(),
  });

  supabase.failTailReads = true;
  await supabase.fireSubscribed();
  assert.notEqual(handle.getSyncStatus().stage, 'idle');
  assert.equal(handle.getSyncStatus().healthy, false);
  await handle.destroy();
});

test('Space page membership and Region geometry materialize through catch-up', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-space-region-catchup', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  const spaces = [{
    id: 'space-1',
    name: 'Shared floor',
    assignedPages: [{
      pageId: 1,
      label: 'Region 1',
      wholePageIncluded: false,
      regions: [{
        id: 'region-1',
        type: 'rect',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
      }],
    }],
  }];
  supabase.log.push({
    seq: 1,
    data: makeRemoteSpacesHex(spaces),
    client_id: 'owner-device',
  });

  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));

  assert.deepEqual(handle.getMeta('spaces'), spaces);
  await handle.destroy();
});

test('two clients sync Space and Region create, rename, geometry, delete, and reconnect exactly once', async () => {
  const supabase = makeTwoClientSupabase();
  const owner = await openAnnotationDoc({
    actorUserId: 'owner-user',
    documentId: 'doc-space-region-two-client',
    supabase,
    clientId: 'owner-client',
    enableLocal: false,
    enableRealtime: true,
    doc: new Y.Doc(),
  });
  const editor = await openAnnotationDoc({
    actorUserId: 'editor-user',
    documentId: 'doc-space-region-two-client',
    supabase,
    clientId: 'editor-client',
    enableLocal: false,
    enableRealtime: true,
    doc: new Y.Doc(),
  });
  await supabase.fireSubscribed();

  const created = [{
    id: 'space-shared',
    name: 'Owner floor',
    assignedPages: [{
      pageId: 1,
      label: 'Owner region',
      wholePageIncluded: false,
      regions: [{
        id: 'region-shared',
        type: 'rect',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
      }],
    }],
  }];
  owner.setMeta('spaces', created);
  await owner.drain();
  assert.deepEqual(editor.getMeta('spaces'), created, 'owner create reaches editor');

  const edited = structuredClone(editor.getMeta('spaces'));
  edited[0].name = 'Editor rename';
  edited[0].assignedPages[0].regions[0] = {
    ...edited[0].assignedPages[0].regions[0],
    x: 0.25,
    width: 0.5,
  };
  editor.setMeta('spaces', edited);
  await editor.drain();
  assert.deepEqual(owner.getMeta('spaces'), edited, 'editor rename and geometry reach owner');
  assert.equal(owner.getMeta('spaces').length, 1, 'Space is not duplicated');
  assert.equal(
    owner.getMeta('spaces')[0].assignedPages[0].regions.length,
    1,
    'Region is not duplicated',
  );

  // Miss one accepted owner update, then rejoin and catch it up.
  supabase.setBroadcastEnabled(false);
  const whileOffline = structuredClone(owner.getMeta('spaces'));
  whileOffline[0].assignedPages[0].label = 'Changed while editor offline';
  owner.setMeta('spaces', whileOffline);
  await owner.drain();
  assert.notDeepEqual(editor.getMeta('spaces'), whileOffline);
  supabase.setBroadcastEnabled(true);
  await supabase.fireSubscribed(1);
  assert.deepEqual(editor.getMeta('spaces'), whileOffline, 'reconnect catches up missed metadata');

  const regionDeleted = structuredClone(editor.getMeta('spaces'));
  regionDeleted[0].assignedPages[0].regions = [];
  editor.setMeta('spaces', regionDeleted);
  await editor.drain();
  assert.deepEqual(owner.getMeta('spaces'), regionDeleted, 'editor Region delete reaches owner');

  owner.setMeta('spaces', []);
  await owner.drain();
  assert.deepEqual(editor.getMeta('spaces'), [], 'owner Space delete reaches editor');

  await owner.destroy();
  await editor.destroy();
});

test('reconnect: a re-fired SUBSCRIBED sweeps ops missed while the channel was down', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-reconnect', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.fireSubscribed(); // initial join, log empty
  await new Promise((r) => setTimeout(r, 5));

  // Channel drops; two ops land while we're not listening; channel rejoins.
  supabase.log.push({ seq: 1, data: makeRemoteOpHex('offline-1'), client_id: 'other' });
  supabase.log.push({ seq: 2, data: makeRemoteOpHex('offline-2'), client_id: 'other' });
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(doc.getMap('marks').has('offline-1'), 'first missed op applied');
  assert.ok(doc.getMap('marks').has('offline-2'), 'second missed op applied');
  await handle.destroy();
});

test('a row whose bytes fail to apply is retried on the next sweep — never permanently skipped', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-poison', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.log.push({ seq: 1, data: makeRemoteOpHex('good-1'), client_id: 'other' });
  supabase.log.push({ seq: 2, data: '\\xdeadbeef', client_id: 'other' }); // corrupt bytes — apply throws
  supabase.log.push({ seq: 3, data: makeRemoteOpHex('good-3'), client_id: 'other' });

  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(doc.getMap('marks').has('good-1'), 'rows before the bad one are applied');
  assert.ok(!doc.getMap('marks').has('good-3'), 'sweep stops AT the bad row instead of advancing past it');

  // The row is fixed server-side (e.g. it was a transient decode issue) — the
  // next SUBSCRIBED must resume from seq 1, not from past the bad row.
  supabase.log[1] = { seq: 2, data: makeRemoteOpHex('good-2'), client_id: 'other' };
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(doc.getMap('marks').has('good-2'), 'the previously-failing seq is retried');
  assert.ok(doc.getMap('marks').has('good-3'), 'rows after it are then applied too');

  await handle.destroy();
});

test('same-install catch-up applies a stale handle delete and cannot snapshot the mark back', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const { seed, deleteHex } = makeSeedAndDelete('stale-mark');
  Y.applyUpdate(doc, seed);
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-own', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  const changes = [];
  handle.onChange((byPage) => changes.push(byPage));

  // Another live handle on this installation shares clientId='me'. Its delete
  // is not a self-echo for this stale handle and must be applied.
  supabase.log.push({ seq: 1, data: deleteHex, client_id: 'me' });
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(doc.getMap('marks').has('stale-mark'), false, 'same-install delete is applied');
  assert.ok(changes.length >= 1, 'listeners receive the deletion');
  // w33: a screen that only received rows writes no checkpoint on close; an
  // explicit save still does, and must not put the stale mark back.
  await handle.flushSnapshot();
  await handle.destroy();

  assert.equal(
    supabase.lastSnapshot?.at_seq,
    supabase.log.at(-1)?.seq,
    'checkpoint covers the delete plus any causally deleted persisted struct',
  );
  const checkpoint = new Y.Doc();
  Y.applyUpdate(checkpoint, gunzipSync(pgHexToBytes(supabase.lastSnapshot.snapshot)));
  assert.equal(
    checkpoint.getMap('marks').has('stale-mark'),
    false,
    'destroy cannot overwrite the backend with a stale mark at the delete seq',
  );
});

test('same-install realtime applies another live handle delete', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const { seed, deleteHex } = makeSeedAndDelete('realtime-stale-mark');
  Y.applyUpdate(doc, seed);
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-own-realtime', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.fireRealtime({ seq: 1, data: deleteHex, client_id: 'me' });
  await handle.drain();

  assert.equal(
    doc.getMap('marks').has('realtime-stale-mark'),
    false,
    'same-install realtime delete is applied instead of mistaken for a self-echo',
  );
  await handle.destroy();
});

test('an out-of-order realtime row cannot make a snapshot skip an unseen earlier delete', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-out-of-order-snapshot', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.fireRealtime({
    seq: 2,
    data: makeRemoteOpHex('arrived-second'),
    client_id: 'other',
  });
  await handle.flushSnapshot();

  assert.equal(
    supabase.lastSnapshot?.at_seq,
    0,
    'snapshot stays at the contiguous frontier so reopen replays missing seq 1',
  );
  await handle.destroy();
});

test('persisted-local reconciliation finishes before the handle exposes newer edits', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  doc.clientID = 0xfffffff0;
  setMetaValue(doc, 'K', 'older', 'indexeddb-preload');
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-initial-barrier', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  assert.equal(supabase.log.length, 1, 'older persisted delta is authorized during open');
  // Realtime join is deliberately withheld while the exposed handle accepts a
  // newer edit to the same high-client-id Yjs key.
  handle.setMeta('K', 'newer');
  await handle.drain();

  assert.equal(supabase.log.length, 2, 'newer exact update follows its persisted predecessor');
  const coldDoc = new Y.Doc();
  const coldHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-initial-barrier', supabase, clientId: 'cold',
    enableLocal: false, enableRealtime: false, doc: coldDoc,
  });
  assert.equal(coldHandle.getMeta('K'), 'newer', 'cold WAL replay cannot resolve back to older');

  await coldHandle.destroy();
  await handle.destroy();
});

test('no SUBSCRIBED event cannot deadlock drain, save, or destroy', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-no-subscribed', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  handle.setMeta('offline-after-load', 'durable');
  await Promise.race([
    handle.drain(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('drain timed out')), 250)),
  ]);
  assert.equal(supabase.log.length, 1, 'exact edit reaches WAL without waiting for Realtime');
  assert.equal(await Promise.race([
    handle.flushSnapshot(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('save timed out')), 250)),
  ]), true);
  await Promise.race([
    handle.destroy(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timed out')), 250)),
  ]);

  const coldDoc = new Y.Doc();
  for (const row of supabase.log) Y.applyUpdate(coldDoc, pgHexToBytes(row.data));
  assert.equal(getMetaValue(coldDoc, 'offline-after-load'), 'durable');
});

test('catch-up failure leaves a bounded outbox that a later reconnect authorizes', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-catchup-offline', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  supabase.failTailReads = true;
  supabase.failWrites = true;
  handle.setMeta('offline-outbox', 'survives');

  await Promise.race([
    handle.drain(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('drain timed out')), 4000)),
  ]);
  assert.equal(await Promise.race([
    handle.flushSnapshot(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('save timed out')), 4000)),
  ]), false);
  assert.equal(
    handle.getSyncStatus().queueSize,
    1,
    'failed WAL and snapshot keep one durable outbox record pending',
  );
  assert.equal(getMetaValue(doc, 'offline-outbox'), 'survives', 'local/IDB projection retains the outbox');

  supabase.failWrites = false;
  supabase.fireSubscribed();
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (supabase.lastSnapshot) {
    assert.equal(supabase.lastSnapshot.at_seq, 0, 'autonomous repair claims only the safe empty WAL frontier');
    const autonomousCold = new Y.Doc();
    Y.applyUpdate(autonomousCold, gunzipSync(pgHexToBytes(supabase.lastSnapshot.snapshot)));
    assert.equal(getMetaValue(autonomousCold, 'offline-outbox'), 'survives');
  }

  supabase.failTailReads = false;
  supabase.fireSubscribed();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(supabase.lastSnapshot, 'autonomous or reconnect repair checkpoints the staged outbox');
  const cold = new Y.Doc();
  Y.applyUpdate(cold, gunzipSync(pgHexToBytes(supabase.lastSnapshot.snapshot)));
  assert.equal(getMetaValue(cold, 'offline-outbox'), 'survives');

  await Promise.race([
    handle.destroy(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timed out')), 500)),
  ]);
});

test('a channel close invalidates an in-flight catch-up and cannot turn status green', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-close-during-catchup', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  let releaseTailRead;
  supabase.tailReadGate = new Promise((resolve) => { releaseTailRead = resolve; });
  const catchup = supabase.fireSubscribed();
  await Promise.resolve();
  assert.equal(handle.getSyncStatus().stage, 'hydrating');

  supabase.fireStatus('CLOSED');
  assert.equal(handle.getSyncStatus().healthy, false);

  releaseTailRead();
  await catchup;
  assert.equal(handle.getSyncStatus().healthy, false);
  assert.notEqual(handle.getSyncStatus().stage, 'idle');

  await handle.destroy();
});

test('an exact persisted delta cannot resurrect a backend delete committed at reconciliation', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const { seed, deleteHex } = makeSeedAndDelete('deleted-at-barrier');
  Y.applyUpdate(doc, seed);
  let injected = false;
  supabase.beforeInsert = async () => {
    if (injected) return;
    injected = true;
    const deleted = {
      seq: 1,
      data: deleteHex,
      client_id: 'remote-delete',
      client_seq: 1,
      document_id: 'doc-delete-at-barrier',
    };
    supabase.log.push(deleted);
    supabase.fireRealtime(deleted);
  };
  const handle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-delete-at-barrier', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.fireSubscribed();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await handle.drain();
  assert.equal(
    doc.getMap('marks').has('deleted-at-barrier'),
    false,
    'the remote delete covers the original persisted struct',
  );

  supabase.beforeInsert = null;
  const coldDoc = new Y.Doc();
  const coldHandle = await openAnnotationDoc({ actorUserId: 'test-actor',
    documentId: 'doc-delete-at-barrier', supabase, clientId: 'cold',
    enableLocal: false, enableRealtime: false, doc: coldDoc,
  });
  assert.equal(
    coldDoc.getMap('marks').has('deleted-at-barrier'),
    false,
    'delete followed by the original causal delta stays deleted on cold replay',
  );

  await coldHandle.destroy();
  await handle.destroy();
});
