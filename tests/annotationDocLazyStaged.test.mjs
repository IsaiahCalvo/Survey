// The staged shadow doc (accepted state + pending local edits) is built only
// when something reads it: a document that is only viewed never pays for a
// third full copy of its marks, an ordinary edit only writes it (kept until a
// build, so the first edit on a big set no longer stalls ~0.7 s at its drop),
// and local edits still reach the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';

const { bytesToPgHex, stagedBuildCount } = __test;

function remoteOpHex(annotationId) {
  const remote = new Y.Doc();
  let captured;
  remote.on('update', (u) => { captured = u; });
  remote.getMap('marks').set(annotationId, { id: annotationId, pageNumber: 1, type: 'path' });
  return bytesToPgHex(captured);
}

function makeSupabase() {
  const log = [];
  let subscribeCallback = null;
  const supabase = {
    log,
    rejectNextInsert: false,
    fireSubscribed() { return subscribeCallback?.('SUBSCRIBED'); },
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
                if (supabase.rejectNextInsert) {
                  supabase.rejectNextInsert = false;
                  return { data: null, error: { code: '42501', message: 'permission denied' } };
                }
                const committed = { ...row, seq: log.length + 1 };
                log.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => resolve({
            data: filters.gtSeq === null ? [] : log.filter((r) => r.seq > filters.gtSeq),
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
    channel: () => ({
      on() { return this; },
      subscribe(cb) { subscribeCallback = cb; return this; },
    }),
    removeChannel: async () => ({ status: 'ok' }),
  };
  return supabase;
}

const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function addMark(handle, id) {
  const shown = handle.getByPage ? handle.getByPage() : null;
  const page1 = [...((shown && shown[1]?.objects) || [])];
  handle.applyByPage({ ...(shown || {}), 1: { objects: [...page1, { type: 'rect', data: { id }, pageNumber: 1 }] } });
}

async function reopenKeys(supabase, documentId, clientId) {
  const reopened = new Y.Doc();
  const again = await openAnnotationDoc({
    actorUserId: 'test-actor', documentId, supabase, clientId,
    enableLocal: false, enableRealtime: false, doc: reopened,
  });
  const keys = [...reopened.getMap('marks').keys()];
  await again.destroy();
  return keys;
}

test('viewing a document never builds the staged doc; local edits do not either and are saved', async () => {
  const supabase = makeSupabase();
  supabase.log.push({ seq: 1, data: remoteOpHex('from-cloud'), client_id: 'other-device' });
  const doc = new Y.Doc();
  const before = stagedBuildCount();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor', documentId: 'doc-lazy-staged', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: true, doc,
  });
  assert.ok(doc.getMap('marks').has('from-cloud'), 'the cloud mark is loaded');

  // Another device's row arrives through the catch-up sweep.
  supabase.log.push({ seq: 2, data: remoteOpHex('later-cloud'), client_id: 'other-device' });
  await supabase.fireSubscribed();
  await until(() => doc.getMap('marks').has('later-cloud'));
  assert.equal(stagedBuildCount(), before, 'open and remote rows do not build the staged doc');

  // Local edits only write the staged doc: kept, not built, and they reach the log.
  addMark(handle, 'mine');
  await handle.drain();
  addMark(handle, 'mine-too');
  await handle.drain();
  assert.equal(supabase.log.filter((row) => row.client_id !== 'other-device').length, 2, 'both edits are appended');
  assert.equal(stagedBuildCount(), before, 'ordinary edits do not build the staged doc');
  await handle.destroy();

  // A fresh open sees all three marks from the log alone.
  const reopened = new Y.Doc();
  const again = await openAnnotationDoc({
    actorUserId: 'test-actor', documentId: 'doc-lazy-staged', supabase, clientId: 'me-2',
    enableLocal: false, enableRealtime: false, doc: reopened,
  });
  const keys = [...reopened.getMap('marks').keys()];
  assert.ok(keys.includes('from-cloud') && keys.includes('later-cloud'), 'cloud marks are in the log');
  assert.ok(keys.some((k) => k.includes('mine')) && keys.some((k) => k.includes('mine-too')), `the local marks are in the log (${keys})`);
  await again.destroy();
});

test('a rejected edit is dropped with the kept writes; the next edit builds the staged doc without it', async () => {
  const supabase = makeSupabase();
  supabase.log.push({ seq: 1, data: remoteOpHex('from-cloud'), client_id: 'other-device' });
  const doc = new Y.Doc();
  const before = stagedBuildCount();
  const handle = await openAnnotationDoc({
    actorUserId: 'test-actor', documentId: 'doc-lazy-staged-rejected', supabase, clientId: 'me',
    enableLocal: false, enableRealtime: false, doc,
  });
  addMark(handle, 'kept');
  await handle.drain();
  supabase.rejectNextInsert = true;
  addMark(handle, 'denied');
  await handle.drain();
  assert.equal(stagedBuildCount(), before, 'nothing has read the staged doc yet');
  // After a rejection later edits are rebased onto the staged doc, which reads it.
  addMark(handle, 'after');
  await handle.drain();
  assert.equal(stagedBuildCount(), before + 1, 'the rebase builds it once');
  await handle.destroy();

  const keys = await reopenKeys(supabase, 'doc-lazy-staged-rejected', 'me-2');
  assert.ok(keys.includes('from-cloud'), `cloud mark kept (${keys})`);
  assert.ok(keys.some((k) => k.includes('kept')), `the accepted edit is in the log (${keys})`);
  assert.ok(keys.some((k) => k.includes('after')), `the edit after the rejection is in the log (${keys})`);
  assert.ok(!keys.some((k) => k.includes('denied')), `the rejected edit never reaches the log (${keys})`);
});
