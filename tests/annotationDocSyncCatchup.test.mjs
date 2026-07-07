import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';

const { bytesToPgHex } = __test;

// Build the update bytes another device would have committed to the op log.
function makeRemoteOpHex(annotationId) {
  const remote = new Y.Doc();
  let captured;
  remote.on('update', (u) => { captured = u; });
  remote.getMap('annotations').set(annotationId, { id: annotationId, pageNumber: 2, type: 'path' });
  return bytesToPgHex(captured);
}

// Supabase double with a mutable annotation_updates log + a capturable
// realtime channel, so a test can drop a row into the log AFTER hydrate but
// BEFORE the channel confirms SUBSCRIBED — the exact open-time race window.
function makeSupabase() {
  const log = []; // rows: { seq, data, client_id }
  let subscribeCallback = null;
  const supabase = {
    log,
    fireSubscribed() { subscribeCallback?.('SUBSCRIBED'); },
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_col, v) => { filters.gtSeq = Number(v); return builder; },
          order: () => builder,
          limit: () => builder,
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: log.length + 1 }, error: null }) }) }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => {
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
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on() { return this; },
      subscribe(cb) { subscribeCallback = cb; return this; },
    }),
  };
  return supabase;
}

test('open-time race: an op committed between hydrate and SUBSCRIBED is applied by the catch-up sweep', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
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

  assert.ok(doc.getMap('annotations').has('missed-mark'), 'the missed op is applied');
  assert.ok(changes.length >= 1, 'listeners are notified so the viewer re-renders');
  await handle.destroy();
});

test('reconnect: a re-fired SUBSCRIBED sweeps ops missed while the channel was down', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
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

  assert.ok(doc.getMap('annotations').has('offline-1'), 'first missed op applied');
  assert.ok(doc.getMap('annotations').has('offline-2'), 'second missed op applied');
  await handle.destroy();
});

test('a row whose bytes fail to apply is retried on the next sweep — never permanently skipped', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-poison', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });

  supabase.log.push({ seq: 1, data: makeRemoteOpHex('good-1'), client_id: 'other' });
  supabase.log.push({ seq: 2, data: '\\xdeadbeef', client_id: 'other' }); // corrupt bytes — apply throws
  supabase.log.push({ seq: 3, data: makeRemoteOpHex('good-3'), client_id: 'other' });

  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(doc.getMap('annotations').has('good-1'), 'rows before the bad one are applied');
  assert.ok(!doc.getMap('annotations').has('good-3'), 'sweep stops AT the bad row instead of advancing past it');

  // The row is fixed server-side (e.g. it was a transient decode issue) — the
  // next SUBSCRIBED must resume from seq 1, not from past the bad row.
  supabase.log[1] = { seq: 2, data: makeRemoteOpHex('good-2'), client_id: 'other' };
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(doc.getMap('annotations').has('good-2'), 'the previously-failing seq is retried');
  assert.ok(doc.getMap('annotations').has('good-3'), 'rows after it are then applied too');

  await handle.destroy();
});

test('catch-up skips our own rows and does not notify when nothing new applied', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    documentId: 'doc-own', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  const changes = [];
  handle.onChange((byPage) => changes.push(byPage));

  // Only OUR OWN op sits past the covered seq (e.g. it was assigned a seq the
  // hydrate read didn't see). It's already in the doc — must not notify.
  supabase.log.push({ seq: 1, data: makeRemoteOpHex('mine'), client_id: 'me' });
  supabase.fireSubscribed();
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(changes.length, 0, 'no change notification for our own echoes');
  assert.ok(!doc.getMap('annotations').has('mine'), 'own row bytes are not re-applied by catch-up');
  await handle.destroy();
});
