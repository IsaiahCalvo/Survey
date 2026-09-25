import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { getMetaValue } from '../src/services/annotationDocStore.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { purgeYDoc } from '../src/lib/collab/ydocRegistry.js';

function server(shared = { rows: [] }) {
  let actor = 'actor-a';
  let role = 'editor';
  let switchAfterSession = false;
  let onStatus;
  const requests = [];
  const client = createClient('https://annotation-transport.example.test', 'test-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      const path = new URL(url).pathname;
      const authorization = new Headers(options.headers).get('Authorization');
      const method = options.method;
      requests.push({ path, authorization, method });
      const mutation = method === 'POST';
      if (mutation && role !== 'editor') return new Response(JSON.stringify({ code: '42501', message: 'annotation write is not permitted' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
      let data = [];
      if (path.endsWith('append_annotation_update')) {
        const body = JSON.parse(options.body);
        let row = shared.rows.find((item) => item.client_id === body.p_client_id && item.client_seq === body.p_client_seq);
        if (!row) {
          row = { seq: shared.rows.length + 1, document_id: body.p_document_id,
            client_id: body.p_client_id, client_seq: body.p_client_seq, data: body.p_data,
            actor_id: authorization?.replace('Bearer test-', '') };
          shared.rows.push(row);
        }
        data = [{ seq: row.seq }];
      } else if (path.endsWith('store_annotation_snapshot')) data = true;
      else if (path.endsWith('annotation_updates')) data = [...shared.rows];
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  // No real credentials or network. Real PostgREST builders + fetchWithAuth
  // exercise request headers; only the session source and HTTP server are fake.
  client.auth.getSession = async () => {
    const session = actor ? { user: { id: actor }, access_token: `test-${actor}` } : null;
    if (switchAfterSession) { switchAfterSession = false; queueMicrotask(() => { actor = 'actor-b'; }); }
    return { data: { session }, error: null };
  };
  client.channel = () => {
    const channel = { on: () => channel, subscribe: (callback) => { onStatus = callback; return channel; } };
    return channel;
  };
  client.removeChannel = async () => 'ok';
  return { client, requests, setActor: (value) => { actor = value; }, setRole: (value) => { role = value; },
    raceNextSession: () => { switchAfterSession = true; },
    reconnect: () => onStatus('SUBSCRIBED'),
  };
}
async function open(t, remote, outboxStore = createMemoryAnnotationOutbox(), options = {}) {
  const documentId = options.documentId ?? `actor-transport-${crypto.randomUUID()}`;
  const actorUserId = options.actorUserId ?? 'actor-a';
  const handle = await openAnnotationDoc({
    documentId, actorUserId, supabase: remote.client,
    enableLocal: false, enableRealtime: options.enableRealtime ?? false, outboxStore,
    repairRetryDelayMs: 60_000, snapshotRetryDelayMs: 1,
  });
  t.after(async () => { await handle.destroy(); purgeYDoc(`annoflat:${documentId}:${actorUserId}`); });
  return { handle, documentId, outboxStore };
}

for (const nextActor of ['actor-b', null]) {
  test(`queued A edit is retained without writes when the active session becomes ${nextActor ?? 'signed out'}`, async (t) => {
    const remote = server();
    const { handle, documentId, outboxStore } = await open(t, remote);
    let release;
    const gate = new Promise((done) => { release = done; });
    const put = outboxStore.put.bind(outboxStore);
    outboxStore.put = async (row) => { await gate; return put(row); };
    handle.setMeta('private-note', 'authored by A');
    remote.setActor(nextActor);
    release();
    await handle.drain();
    assert.equal(remote.requests.filter((request) => request.method === 'POST').length, 0);
    assert.equal((await outboxStore.list(documentId, 'actor-a')).length, 1);
    assert.equal(handle.getSyncStatus().healthy, false);
    remote.setActor('actor-a');
    assert.equal(await handle.flushSnapshot(), true, 'matching actor may safely recover its pending work');
    assert.equal((await outboxStore.list(documentId, 'actor-a')).length, 0);
    assert.ok(remote.requests.filter((request) => request.method === 'POST').every((request) => request.authorization === 'Bearer test-actor-a'));
  });
}

test('an account switch after session capture cannot change the outgoing request actor', async (t) => {
  const remote = server();
  const { handle } = await open(t, remote);
  remote.raceNextSession();
  handle.setMeta('race', 'A');
  await handle.drain();
  const appends = remote.requests.filter((request) => request.path.endsWith('append_annotation_update'));
  assert.equal(appends.length, 1);
  assert.equal(appends[0].authorization, 'Bearer test-actor-a');
  remote.setActor('actor-a');
});

test('opening actor A under actor B cannot read or hydrate the A cache', async () => {
  const remote = server();
  remote.setActor('actor-b');
  const outboxStore = createMemoryAnnotationOutbox();
  let checkpoints = 0;
  outboxStore.compactAccepted = async () => { checkpoints += 1; };
  const doc = new Y.Doc();
  try {
    await assert.rejects(openAnnotationDoc({
      documentId: `wrong-actor-open-${crypto.randomUUID()}`, actorUserId: 'actor-a',
      supabase: remote.client, enableLocal: false, enableRealtime: false, outboxStore, doc,
    }), { code: 'ANNOTATION_ACTOR_MISMATCH' });
    assert.equal(remote.requests.length, 0, 'mismatch must fail before any authenticated HTTP read');
    assert.equal(checkpoints, 0, 'no accepted cloud bytes may enter the actor cache');
    assert.equal(getMetaValue(doc, 'owned-by-b'), undefined);
  } finally { doc.destroy(); }
});

for (const role of ['viewer', 'revoked']) test(`captured actor credentials still obey ${role} write responses`, async (t) => {
  const remote = server();
  const { handle, documentId, outboxStore } = await open(t, remote);
  handle.setMeta('accepted-before-role-change', 'keep');
  await handle.drain();
  remote.setRole(role);
  handle.setMeta('denied', 'must not survive');
  await handle.drain();
  assert.equal(handle.getMeta('denied'), undefined);
  assert.equal(handle.getMeta('accepted-before-role-change'), 'keep');
  assert.equal(handle.getSyncStatus().healthy, false);
  assert.ok((await outboxStore.listQuarantined(documentId, 'actor-a')).length > 0);
  assert.equal(remote.requests.filter((request) => request.path.endsWith('append_annotation_update')).length, 2);
  assert.ok(remote.requests.filter((request) => request.method === 'POST').every((request) => request.authorization === 'Bearer test-actor-a'));
});

test('two authenticated actors keep unrelated edits across concurrent writes and cold reopen', async (t) => {
  const shared = { rows: [] };
  const a = server(shared);
  const b = server(shared);
  b.setActor('actor-b');
  const documentId = `multi-actor-${crypto.randomUUID()}`;
  const first = await open(t, a, undefined, { documentId });
  const second = await open(t, b, undefined, { documentId, actorUserId: 'actor-b' });
  first.handle.setMeta('owned-by-a', 'A');
  second.handle.setMeta('owned-by-b', 'B');
  await Promise.all([first.handle.drain(), second.handle.drain()]);
  assert.deepEqual(shared.rows.map((row) => row.actor_id).sort(), ['actor-a', 'actor-b']);
  await Promise.all([first.handle.destroy(), second.handle.destroy()]);
  purgeYDoc(`annoflat:${documentId}:actor-a`);
  purgeYDoc(`annoflat:${documentId}:actor-b`);
  const reopenedA = await open(t, a, undefined, { documentId });
  const reopenedB = await open(t, b, undefined, { documentId, actorUserId: 'actor-b' });
  for (const { handle } of [reopenedA, reopenedB]) {
    assert.equal(handle.getMeta('owned-by-a'), 'A');
    assert.equal(handle.getMeta('owned-by-b'), 'B');
  }
  assert.equal(shared.rows.length, 2, 'hydration must not echo another actor as a new local write');
});

test('reconnect refuses another session then catches up once the original actor returns', async (t) => {
  const shared = { rows: [] };
  const a = server(shared);
  const b = server(shared);
  b.setActor('actor-b');
  const documentId = `actor-reconnect-${crypto.randomUUID()}`;
  const first = await open(t, a, undefined, { documentId, enableRealtime: true });
  const second = await open(t, b, undefined, { documentId, actorUserId: 'actor-b' });
  second.handle.setMeta('remote-edit', 'B');
  await second.handle.drain();
  a.setActor('actor-b');
  const before = a.requests.length;
  await a.reconnect();
  assert.equal(a.requests.length, before, 'wrong actor catch-up must send no HTTP read');
  assert.equal(first.handle.getMeta('remote-edit'), undefined);
  assert.equal(first.handle.isSyncHealthy(), false);
  a.setActor('actor-a');
  await a.reconnect();
  assert.equal(first.handle.getMeta('remote-edit'), 'B');
  assert.equal(first.handle.isSyncHealthy(), true);
  assert.equal(shared.rows.length, 1, 'remote catch-up must not echo a new mutation');
});
