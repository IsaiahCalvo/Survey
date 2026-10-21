// The staged shadow doc (accepted state + pending local edits) is built only
// when something needs it: a document that is only viewed never pays for a
// third full copy of its marks, and local edits still reach the log.
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

test('viewing a document never builds the staged doc; the first local edit does and is saved', async () => {
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

  // A local edit builds it (from the accepted state) and reaches the log.
  const shown = handle.getByPage ? handle.getByPage() : null;
  const page1 = [...((shown && shown[1]?.objects) || [])];
  handle.applyByPage({ ...(shown || {}), 1: { objects: [...page1, { type: 'rect', data: { id: 'mine' }, pageNumber: 1 }] } });
  await handle.drain();
  assert.ok(supabase.log.some((row) => row.client_id !== 'other-device'), 'the edit is appended');
  assert.equal(stagedBuildCount(), before + 1, 'the first local edit builds the staged doc once');
  await handle.destroy();

  // A fresh open sees all three marks from the log alone.
  const reopened = new Y.Doc();
  const again = await openAnnotationDoc({
    actorUserId: 'test-actor', documentId: 'doc-lazy-staged', supabase, clientId: 'me-2',
    enableLocal: false, enableRealtime: false, doc: reopened,
  });
  const keys = [...reopened.getMap('marks').keys()];
  assert.ok(keys.includes('from-cloud') && keys.includes('later-cloud'), 'cloud marks are in the log');
  assert.ok(keys.some((k) => k.includes('mine')), `the local mark is in the log (${keys})`);
  await again.destroy();
});
