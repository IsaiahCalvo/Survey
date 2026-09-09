import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { purgeYDocsByPrefix } from '../src/lib/collab/ydocRegistry.js';

const actorA = '83000000-0000-4000-8000-000000000001';
const actorB = '83000000-0000-4000-8000-000000000002';
const generationA = '83000000-0000-4000-8000-000000000003';
const generationB = '83000000-0000-4000-8000-000000000004';
const sha = hex => createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');

// Actual installed PostgREST builders and auth fetch wrapper; every HTTP call
// terminates here. No credentials, accounts, database, or provider are used.
function server(documentId, shared = { rows: [], snapshot: null, current: generationA }) {
  let actor = actorA, race = false;
  const { rows } = shared, requests = [];
  const client = createClient('https://generation-sdk.example.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://generation-sdk.example.test');
      assert.equal(options.method, 'POST');
      assert.match(parsed.pathname, /^\/rest\/v1\/rpc\/\w+_v2$/);
      const p = JSON.parse(options.body);
      const authorization = new Headers(options.headers).get('Authorization');
      const name = parsed.pathname.split('/').at(-1);
      requests.push({ name, p, authorization });
      assert.equal(p.p_document_id, documentId);
      const response = (body, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      });
      const current = shared.current;
      if (p.p_generation_id !== current) return response({ code: 'SG002', message: 'changed',
        details: JSON.stringify({ document_id: documentId, expected_generation_id: p.p_generation_id,
          current_generation_id: current }) }, 409);
      const envelope = { version: 2, document_id: documentId, generation_id: current };
      let result;
      if (name === 'read_annotation_snapshot_v2') result = { snapshot: shared.snapshot, wal_head: String(rows.length) };
      else if (name === 'read_annotation_writer_sequence_v2') result = {
        client_id: p.p_client_id, client_seq: rows.filter(r => r.client_id === p.p_client_id).at(-1)?.client_seq ?? '0',
      };
      else if (name === 'read_annotation_updates_v2') {
        const through = p.p_through_seq ?? String(rows.length);
        result = { rows: rows.filter(r => BigInt(r.seq) > BigInt(p.p_after_seq) && BigInt(r.seq) <= BigInt(through)),
          through_seq: through, has_more: false };
      } else if (name === 'append_annotation_update_v2') {
        const row = { seq: String(rows.length + 1), client_id: p.p_client_id, client_seq: p.p_client_seq,
          actor_user_id: authorization?.slice('Bearer synthetic-'.length), data: p.p_data };
        rows.push(row);
        result = { ...row, accepted: true, data_sha256: sha(p.p_data), is_current: true, current_generation_id: current };
      } else if (name === 'store_annotation_snapshot_v2') {
        shared.snapshot = { at_seq: p.p_at_seq, snapshot: p.p_snapshot, encoding_version: p.p_encoding_version,
          writer_id: p.p_writer_id, writer_epoch: p.p_writer_epoch };
        result = { stored: true, at_seq: p.p_at_seq, writer_id: p.p_writer_id, writer_epoch: p.p_writer_epoch,
          snapshot_sha256: sha(p.p_snapshot), encoding_version: p.p_encoding_version };
      } else throw new Error(`Unexpected RPC ${name}`);
      return response({ ...envelope, ...result });
    } },
  });
  client.auth.getSession = async () => {
    const session = actor ? { user: { id: actor }, access_token: `synthetic-${actor}` } : null;
    if (race) { race = false; queueMicrotask(() => { actor = actorB; }); }
    return { data: { session }, error: null };
  };
  return { client, requests, rows, setActor: value => { actor = value; },
    replace: () => { shared.current = generationB; }, raceNextSession: () => { race = true; } };
}

async function fixture(t) {
  const documentId = crypto.randomUUID(), shared = { rows: [], snapshot: null, current: generationA };
  const remote = server(documentId, shared), peer = server(documentId, shared), handles = [], stores = [];
  peer.setActor(actorB);
  const indexedDb = new IDBFactory();
  t.after(async () => {
    remote.setActor(actorA);
    for (const handle of handles) await handle.destroy();
    for (const store of stores) await store.close();
    purgeYDocsByPrefix(`annoflat:${documentId}:`);
  });
  return { documentId, remote, peer, async open({ actorUserId = actorA, backend = remote } = {}) {
    const store = await createAnnotationOutbox({ indexedDb }); stores.push(store);
    const handle = await openAnnotationDoc({ documentId, actorUserId, pdfGenerationId: generationA,
      supabase: backend.client, outboxStore: store, enableLocal: false, enableRealtime: false,
      snapshotRetryDelayMs: 0, repairRetryDelayMs: 60_000 });
    handles.push(handle); return { handle, store };
  } };
}

test('installed SDK carries scoped RPC bodies, exact counters and actor JWT through save and cold reopen', async t => {
  const f = await fixture(t), first = await f.open();
  first.handle.setMeta('saved', 'generation A'); await first.handle.drain();
  assert.equal(await first.handle.flushSnapshot(), true);
  await first.handle.destroy(); purgeYDocsByPrefix(`annoflat:${f.documentId}:`);
  const reopened = await f.open(); assert.equal(reopened.handle.getMeta('saved'), 'generation A');
  assert.equal(f.remote.rows.length, 1, 'cold hydration must not echo accepted state');
  for (const { p, authorization } of f.remote.requests) {
    assert.equal(authorization, `Bearer synthetic-${actorA}`);
    assert.equal(p.p_generation_id, generationA);
    for (const key of ['p_after_seq', 'p_through_seq', 'p_client_seq', 'p_at_seq', 'p_writer_epoch', 'p_expected_at_seq', 'p_expected_writer_epoch']) {
      if (p[key] != null) assert.match(p[key], /^(0|[1-9][0-9]*)$/, `${key} must travel as decimal text`);
    }
  }
  assert.ok(f.remote.requests.some(r => r.name === 'append_annotation_update_v2'));
  assert.ok(f.remote.requests.some(r => r.name === 'store_annotation_snapshot_v2'));
});

test('installed SDK preserves captured generation writer JWT during an account-switch race', async t => {
  const f = await fixture(t), { handle } = await f.open();
  f.remote.raceNextSession(); handle.setMeta('race', 'A'); await handle.drain();
  const appends = f.remote.requests.filter(r => r.name === 'append_annotation_update_v2');
  assert.equal(appends.length, 1); assert.equal(appends[0].authorization, `Bearer synthetic-${actorA}`);
  f.remote.setActor(actorA);
});

test('installed SDK sends no RPC when the active actor differs at generated open', async t => {
  const f = await fixture(t); f.remote.setActor(actorB);
  await assert.rejects(f.open(), { code: 'ANNOTATION_ACTOR_MISMATCH' });
  assert.equal(f.remote.requests.length, 0);
});

test('installed SDK generation error retains pending bytes in retired scope without legacy fallback', async t => {
  const f = await fixture(t), { handle, store } = await f.open();
  f.remote.replace(); handle.setMeta('keep', 'unsent A');
  await assert.rejects(handle.drain(), e => ['SG002', 'ANNOTATION_PDF_GENERATION_RETIRED'].includes(e.code));
  assert.equal(handle.getGenerationStatus().blocked, true);
  const retired = await store.readRetiredScope(f.documentId, actorA, 0, { pdfGenerationId: generationA });
  assert.equal(retired.retirement.replacementGenerationId, generationB);
  assert.equal(retired.quarantined.length, 1);
  const count = f.remote.requests.length; await handle.destroy();
  assert.equal(f.remote.requests.length, count, 'retired teardown sends no new RPC');
  assert.ok(!f.remote.requests.some(r => r.name === 'store_annotation_snapshot_v2'));
});

test('two installed SDK clients keep separate actors and converge on both edits after cold reopen', async t => {
  const f = await fixture(t), a = await f.open(), b = await f.open({ actorUserId: actorB, backend: f.peer });
  a.handle.setMeta('actor-a', 'A'); b.handle.setMeta('actor-b', 'B');
  await Promise.all([a.handle.drain(), b.handle.drain()]);
  assert.deepEqual(f.remote.rows.map(r => r.actor_user_id).sort(), [actorA, actorB]);
  await Promise.all([a.handle.destroy(), b.handle.destroy()]);
  purgeYDocsByPrefix(`annoflat:${f.documentId}:`);
  const reopenedA = await f.open(), reopenedB = await f.open({ actorUserId: actorB, backend: f.peer });
  for (const { handle } of [reopenedA, reopenedB]) {
    assert.equal(handle.getMeta('actor-a'), 'A'); assert.equal(handle.getMeta('actor-b'), 'B');
  }
  assert.equal(f.remote.rows.length, 2, 'no hydration echoes');
  assert.ok(f.remote.requests.every(r => r.authorization === `Bearer synthetic-${actorA}`));
  assert.ok(f.peer.requests.every(r => r.authorization === `Bearer synthetic-${actorB}`));
});
