import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { META_MAP } from '../src/services/annotationDocStore.js';
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
  let actor = actorA, race = false, appendGate = null;
  const { rows } = shared, requests = [], channels = [];
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
        if (shared.tailFault && p.p_after_seq === '1') {
          if (shared.tailFault === 'failed-page') return response({ code: 'ETIMEDOUT', message: 'fixture later page failed' }, 503);
          return response({ ...envelope, rows: [], through_seq: through, has_more: false });
        }
        const eligible = rows.filter(r => BigInt(r.seq) > BigInt(p.p_after_seq) && BigInt(r.seq) <= BigInt(through));
        const page = eligible.slice(0, shared.pageSize ?? eligible.length);
        result = { rows: page, through_seq: through, has_more: eligible.length > page.length };
      } else if (name === 'append_annotation_update_v2') {
        if (appendGate) { const gate = appendGate; appendGate = null; gate.entered.resolve(); await gate.release.promise; }
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
  // Only realtime delivery is synthetic; RPCs still traverse the real SDK's
  // PostgREST builders/auth fetch wrapper above. Never open a WebSocket.
  client.channel = () => {
    const channel = { handlers: [], on(_type, filter, cb) { this.handlers.push({ filter, cb }); return this; },
      subscribe(cb) { this.status = cb; return this; } };
    channels.push(channel); return channel;
  };
  client.removeChannel = async () => {};
  return { client, requests, rows, channels, setActor: value => { actor = value; },
    holdAppend() { const gate = { entered: deferred(), release: deferred() }; appendGate = gate; return gate; },
    replace: () => { shared.current = generationB; }, raceNextSession: () => { race = true; } };
}

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await tick(); }
  assert.fail('bounded SDK fixture condition was not reached');
}
async function fixture(t, { realtime = false } = {}) {
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
  return { documentId, remote, peer, shared, async open({ actorUserId = actorA, backend = remote } = {}) {
    const store = await createAnnotationOutbox({ indexedDb }); stores.push(store);
    const handle = await openAnnotationDoc({ documentId, actorUserId, pdfGenerationId: generationA,
      supabase: backend.client, outboxStore: store, enableLocal: false, enableRealtime: realtime,
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

for (const fault of ['missing-page', 'failed-page']) {
  test(`installed SDK ${fault} keeps the whole tail detached and unsent bytes intact for both actors`, { timeout: 10000 }, async t => {
    const f = await fixture(t, { realtime: true });
    const a = await f.open(), b = await f.open({ actorUserId: actorB, backend: f.peer });
    const peers = [{ ...a, actor: actorA, remote: f.remote, key: 'local-a' },
      { ...b, actor: actorB, remote: f.peer, key: 'local-b' }];
    await Promise.all(peers.map(p => p.remote.channels[0].status('SUBSCRIBED')));
    const gates = peers.map(p => p.remote.holdAppend());
    try {
      for (const p of peers) p.handle.setMeta(p.key, 'not sent yet');
      await Promise.all(gates.map(g => g.entered.promise));
      assert.equal(f.shared.rows.length, 0, 'neither blocked append was accepted remotely');
      for (const p of peers) {
        await p.handle.flushLocalDurability();
        p.pending = await p.store.list(f.documentId, p.actor, { pdfGenerationId: generationA });
        assert.equal(p.pending.length, 1);
      }
      const remoteDoc = new Y.Doc();
      for (const [key, value] of [['peer-first', 'one'], ['peer-second', 'two']]) {
        const before = Y.encodeStateVector(remoteDoc); remoteDoc.getMap(META_MAP).set(key, value);
        f.shared.rows.push({ seq: String(f.shared.rows.length + 1), client_id: 'remote-causal-writer',
          client_seq: String(f.shared.rows.length + 1), actor_user_id: actorB,
          data: '\\x' + Buffer.from(Y.encodeStateAsUpdate(remoteDoc, before)).toString('hex') });
      }
      remoteDoc.destroy(); f.shared.pageSize = 1; f.shared.tailFault = fault;
      const signal = p => p.remote.channels[0].handlers[0].cb({ new: { document_id: f.documentId,
        generation_id: generationA, last_seq: '2', snapshot_writer_epoch: '0', wake_revision: '1' } });
      const starts = peers.map(p => p.remote.requests.length);
      peers.forEach(signal);
      await until(() => peers.every(p => p.handle.getSyncStatus().error === 'The server did not confirm this annotation generation request'));
      for (const [i, p] of peers.entries()) {
        assert.equal(p.handle.getMeta('peer-first'), undefined, 'valid earlier page never becomes visible');
        assert.equal(p.handle.getMeta('peer-second'), undefined);
        assert.equal(p.handle.getMeta(p.key), 'not sent yet');
        assert.equal(p.handle.doc.store.pendingStructs, null);
        const pending = await p.store.list(f.documentId, p.actor, { pdfGenerationId: generationA });
        assert.equal(pending.length, 1); assert.equal(pending[0].key, p.pending[0].key);
        assert.deepEqual(pending[0].update, p.pending[0].update, 'exact unsent update remains durable');
        const clean = await p.store.loadCleanState(f.documentId, p.actor, { pdfGenerationId: generationA });
        const accepted = new Y.Doc();
        try {
          if (clean?.checkpointUpdate) Y.applyUpdate(accepted, clean.checkpointUpdate);
          for (const row of clean?.records || []) Y.applyUpdate(accepted, row.update);
          assert.equal(accepted.getMap(META_MAP).get('peer-first'), undefined, 'earlier page is not cached as accepted');
        } finally { accepted.destroy(); }
        assert.deepEqual(p.remote.requests.slice(starts[i]).filter(r => r.name === 'read_annotation_updates_v2').map(r => r.p.p_after_seq), ['0', '1']);
      }
      f.shared.tailFault = null; const retries = peers.map(p => p.remote.requests.length); peers.forEach(signal);
      await until(() => peers.every(p => p.handle.getMeta('peer-second') === 'two'));
      for (const [i, p] of peers.entries()) {
        assert.equal(p.handle.getMeta('peer-first'), 'one'); assert.equal(p.handle.getMeta(p.key), 'not sent yet');
        assert.equal(p.remote.requests.slice(retries[i]).find(r => r.name === 'read_annotation_updates_v2').p.p_after_seq, '0',
          'repaired retry must start at the previous complete prefix');
        assert.equal((await p.store.list(f.documentId, p.actor, { pdfGenerationId: generationA })).length, 1,
          'remote catch-up cannot acknowledge the unsent local append');
      }
    } finally { gates.forEach(g => g.release.resolve()); }
    await Promise.all(peers.map(p => p.handle.drain()));
    for (const p of peers) {
      assert.equal(p.handle.getMeta(p.key), 'not sent yet');
      assert.ok(p.remote.requests.every(r => r.authorization === `Bearer synthetic-${p.actor}`));
    }
    assert.equal(f.shared.rows.length, 4, 'two exact local appends join the repaired two-row tail');
  });
}
