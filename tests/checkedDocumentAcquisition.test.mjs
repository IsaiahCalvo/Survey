import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { createCheckedDocumentAcquisition } from '../src/services/checkedDocumentAcquisition.js';
import { readCheckedGenerationBootstrap, readCheckedGenerationPdf } from '../src/services/documentGenerationReader.js';

const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generation = id(3);
const scope = { actorUserId: actor, documentId, pdfGenerationId: generation };
const sha = v => createHash('sha256').update(v).digest('hex');
const hex = v => `\\x${Buffer.from(v).toString('hex')}`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pdfDocument = await PDFDocument.create(); pdfDocument.addPage([612, 792]);
const pdf = await pdfDocument.save();
const editedPdf = new Uint8Array([...pdf, 10, 20, 30]);
const doc = new Y.Doc(); doc.getMap('annotations').set('base', { page: 1 });
const baseline = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc);
doc.getMap('annotations').set('tail', { page: 2 }); const tail = Y.encodeStateAsUpdate(doc, vector); doc.destroy();
const path = `${actor}/_generations/${documentId}/${generation}.pdf`;
const legacyPath = `${actor}/legacy.pdf`;
const legacyRow = { id: documentId, user_id: actor, project_id: null, name: 'Legacy.pdf',
  file_path: legacyPath, file_size: pdf.length, content_sha256: sha(pdf),
  updated_at: '2026-09-09T00:00:00Z', archived: false, user_archived_at: null };
const modeResult = (mode = 'legacy', generationId = null) => ({ data: { version: 1,
  actor_user_id: actor, document_id: documentId, mode, generation_id: generationId } });
const manifest = { version: 1, actor_user_id: actor, document_id: documentId, generation_id: generation,
  document: { id: documentId, user_id: actor, project_id: null, name: 'Checked', file_path: path, file_size: String(pdf.length) },
  pdf: { bucket_id: 'documents', path, id: id(4), version: id(5), byte_length: String(pdf.length), content_sha256: sha(pdf) },
  publication: { operation_id: id(6), generation_id: generation, published_at: '2026-09-09T00:00:00Z', wal_head: '0' },
  annotations: { version: 2, document_id: documentId, generation_id: generation, wal_head: '1',
    snapshot_sha256: sha(baseline), snapshot: { at_seq: '0', snapshot: hex(baseline), encoding_version: 1, writer_id: null, writer_epoch: '0' } } };
function rpcResult(name, params) {
  if (name === 'read_annotation_updates_v2') return { data: { version: 2, document_id: documentId,
    generation_id: generation, through_seq: '1', has_more: false,
    rows: [{ seq: '1', client_id: 'writer', client_seq: '1', actor_user_id: actor, data: hex(tail) }] } };
  assert.equal(name, 'read_document_generation_open');
  const data = structuredClone(manifest);
  if (!params.p_include_snapshot) { data.annotations.snapshot = null; data.annotations.snapshot_sha256 = null; }
  return { data };
}
function harness(config = {}) {
  const callbacks = new Set();
  const h = { current: true, token: 'captured-token', sessionActor: actor,
    sessions: 0, subscriptions: 0, unsubscribes: 0, calls: [], fetches: [], callbacks,
    onSession: null, onRpc: null, onFetch: null, onSubscribe: null, onMetadata: null, metadataCalls: [] };
  h.emit = (event, user = actor) => { for (const cb of [...callbacks]) cb(event, user ? { user: { id: user }, access_token: h.token } : null); };
  h.client = {
    auth: {
      async getSession() { h.sessions++; return h.onSession ? h.onSession() : { data: { session: { user: { id: h.sessionActor }, access_token: h.token } } }; },
      onAuthStateChange(callback) {
        h.subscriptions++; callbacks.add(callback); h.onSubscribe?.(callback);
        return { data: { subscription: { unsubscribe() { h.unsubscribes++; callbacks.delete(callback); } } } };
      },
    },
    rpc(name, params) {
      const call = { name, params }; h.calls.push(call);
      return {
        setHeader(key, value) { assert.equal(key, 'Authorization'); call.authorization = value; return this; },
        abortSignal(signal) { call.signal = signal; return this; },
        then(resolve, reject) { return Promise.resolve().then(() => h.onRpc ? h.onRpc(call) : rpcResult(name, params)).then(resolve, reject); },
      };
    },
    from(table) {
      assert.equal(table, 'documents'); const call = { filters: [] }; h.metadataCalls.push(call);
      return {
        select(fields) { call.fields = fields; return this; },
        eq(key, value) { call.filters.push([key, value]); return this; },
        is(key, value) { call.filters.push([key, value]); return this; },
        setHeader(key, value) { assert.equal(key, 'Authorization'); call.authorization = value; return this; },
        abortSignal(signal) { call.signal = signal; return this; },
        retry(value) { assert.equal(value, false); return this; },
        maybeSingle() { return this; },
        then(resolve, reject) { return Promise.resolve().then(() => h.onMetadata ? h.onMetadata(call)
          : { data: structuredClone(legacyRow) }).then(resolve, reject); },
      };
    },
  };
  h.fetch = async (url, options) => {
    h.fetches.push({ url, options });
    return h.onFetch ? h.onFetch(url, options) : new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
  };
  h.acquisition = createCheckedDocumentAcquisition({ client: h.client, actorUserId: actor,
    isCurrent: () => h.current, supabaseUrl: 'https://checked.example', publicKey: 'public-test-key',
    enabled: true, fetch: h.fetch, ...config });
  h.open = extra => h.acquisition.open({ documentId, ...extra });
  h.openCurrent = extra => h.acquisition.openCurrent({ documentId, ...extra });
  h.clean = () => { assert.equal(callbacks.size, 0); assert.equal(h.subscriptions, h.unsubscribes); };
  return h;
}

test('disabled is exact, default-off and causes no auth/RPC/fetch/subscription', async () => {
  await assert.rejects(createCheckedDocumentAcquisition().open({ documentId }), { code: 'DOCUMENT_OPEN_DISABLED' });
  for (const enabled of [false, undefined, 'true', 1]) {
    const h = harness({ enabled }); await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_DISABLED' });
    assert.equal(h.sessions + h.subscriptions + h.calls.length + h.fetches.length, 0);
  }
});

test('real reader/download return issued complete PDF and Yjs tail with one bound JWT', async () => {
  const h = harness(), bundle = await h.open(); h.clean();
  assert.deepEqual(new Uint8Array(await readCheckedGenerationPdf(bundle, scope).arrayBuffer()), pdf);
  const bootstrap = readCheckedGenerationBootstrap(bundle, scope), state = new Y.Doc();
  Y.applyUpdate(state, bootstrap.update);
  assert.deepEqual(state.getMap('annotations').toJSON(), { base: { page: 1 }, tail: { page: 2 } }); state.destroy();
  assert.equal(bootstrap.coveredSeq, '1'); assert.equal(h.fetches.length, 1);
  assert.ok(h.calls.every(c => c.authorization === 'Bearer captured-token' && c.signal.aborted));
  assert.equal(h.fetches[0].options.headers.Authorization, 'Bearer captured-token');
  assert.deepEqual(JSON.parse(h.fetches[0].options.body), { document_id: documentId, generation_id: generation, pdf: manifest.pdf });
  assert.deepEqual(h.calls.filter(c => c.name === 'read_document_generation_open').map(c => c.params.p_include_snapshot), [true, false]);
});

test('wrong actor and synchronous subscription retirement fail before transport', async () => {
  for (const synchronous of [false, true]) {
    const h = harness();
    if (synchronous) h.onSubscribe = cb => cb('SIGNED_OUT', null); else h.sessionActor = id(99);
    await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' }); h.clean();
    assert.equal(h.calls.length + h.fetches.length, 0);
  }
});

test('actor A-B-A permanently retires pending and future opens; same-actor refresh keeps captured JWT', async () => {
  const h = harness(), entered = deferred(), blocked = deferred();
  h.onFetch = () => { entered.resolve(); return blocked.promise; };
  const opening = h.open(); await entered.promise;
  h.emit('SIGNED_IN', id(99)); h.emit('SIGNED_IN', actor);
  await assert.rejects(opening, { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' }); h.clean();
  await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' }); h.clean();
  blocked.resolve(new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  const good = harness(); good.onRpc = call => {
    good.token = 'new-refresh-token'; good.emit('TOKEN_REFRESHED');
    return rpcResult(call.name, call.params);
  };
  await good.open(); good.clean();
  assert.ok(good.calls.every(c => c.authorization === 'Bearer captured-token'));
  assert.equal(good.fetches[0].options.headers.Authorization, 'Bearer captured-token');
});

test('hung auth obeys caller abort and deadline and does not poison retries', async () => {
  for (const cancel of [false, true]) {
    const h = harness({ timeoutMs: 35 }), entered = deferred(), controller = new AbortController();
    h.onSession = () => { entered.resolve(); return new Promise(() => {}); };
    const opening = h.open({ signal: controller.signal }); await entered.promise;
    if (cancel) controller.abort();
    await assert.rejects(opening, { code: 'DOCUMENT_OPEN_ABORTED' }); h.clean();
    assert.equal(h.calls.length + h.fetches.length, 0);
    h.onSession = null; await h.open(); h.clean();
  }
});

test('hung download cancels promptly; late response body is canceled', async () => {
  const h = harness(), controller = new AbortController(), entered = deferred(), blocked = deferred(), canceled = deferred();
  h.onFetch = () => { entered.resolve(); return blocked.promise; };
  const opening = h.open({ signal: controller.signal }); await entered.promise; controller.abort();
  await assert.rejects(opening, { code: 'DOCUMENT_OPEN_ABORTED' }); h.clean();
  assert.equal(h.fetches[0].options.signal.aborted, true);
  blocked.resolve(new Response(new ReadableStream({ cancel() { canceled.resolve(); } }), { headers: { 'Content-Type': 'application/pdf' } }));
  await canceled.promise;
});

test('hung download deadline settles and detaches both caller abort listeners', async () => {
  const owner = new AbortController(), caller = new AbortController(), counts = new Map();
  for (const signal of [owner.signal, caller.signal]) {
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    counts.set(signal, 0);
    signal.addEventListener = (...args) => { counts.set(signal, counts.get(signal) + 1); return add(...args); };
    signal.removeEventListener = (...args) => { counts.set(signal, counts.get(signal) - 1); return remove(...args); };
  }
  const h = harness({ timeoutMs: 30, signal: owner.signal });
  h.onFetch = () => new Promise(() => {});
  await assert.rejects(h.open({ signal: caller.signal }), { code: 'DOCUMENT_OPEN_ABORTED' }); h.clean();
  assert.equal(h.fetches[0].options.signal.aborted, true);
  assert.deepEqual([...counts.values()], [0, 0]);
  h.onFetch = null; await h.open({ signal: caller.signal }); h.clean();
  assert.deepEqual([...counts.values()], [0, 0]);
});

test('late unsubscribed auth callback cannot retire a later open', async () => {
  const h = harness(); let oldCallback;
  h.onSubscribe = callback => { oldCallback ||= callback; };
  await h.open(); h.clean(); oldCallback('SIGNED_OUT', null);
  await h.open(); h.clean();
});

test('opaque scope changes and a final revocation never return a bundle or use fallback', async () => {
  for (const revoked of [false, true]) {
    const h = harness(); h.onRpc = call => {
      if (call.params.p_include_snapshot === false) {
        if (revoked) return { error: { code: '42501', message: 'secret sql and token' } };
        h.current = false;
      }
      return rpcResult(call.name, call.params);
    };
    await assert.rejects(h.open(), e => e.code === (revoked ? '42501' : 'DOCUMENT_OPEN_ACTOR_CHANGED') && !e.message.includes('secret'));
    h.clean(); assert.equal(h.fetches.length, 1);
  }
});

test('concurrent opens own separate JWTs and caller abort does not cross-cancel', async () => {
  const h = harness(), firstEntered = deferred(), secondEntered = deferred(), secondBody = deferred();
  const controller = new AbortController();
  h.onFetch = (_url, options) => {
    if (options.headers.Authorization === 'Bearer captured-token') { firstEntered.resolve(); return new Promise(() => {}); }
    secondEntered.resolve(); return secondBody.promise;
  };
  const first = h.open({ signal: controller.signal }); await firstEntered.promise;
  h.token = 'second-token'; const second = h.open(); await secondEntered.promise;
  controller.abort(); await assert.rejects(first, { code: 'DOCUMENT_OPEN_ABORTED' });
  assert.equal(h.callbacks.size, 1); assert.equal(h.fetches[1].options.signal.aborted, false);
  secondBody.resolve(new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  assert.equal((await second).documentId, documentId); h.clean();
});

test('dispose aborts all opens and permanently prevents future work', async () => {
  const h = harness(), entered = deferred();
  h.onSession = () => { if (h.sessions === 2) entered.resolve(); return new Promise(() => {}); };
  const first = h.open(), second = h.open(); await entered.promise; h.acquisition.dispose();
  await assert.rejects(first, { code: 'DOCUMENT_OPEN_ABORTED' }); await assert.rejects(second, { code: 'DOCUMENT_OPEN_ABORTED' });
  h.clean(); await assert.rejects(h.open(), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' }); h.clean();
});

test('invalid inputs and arbitrary SDK errors are safe and leave no subscription', async () => {
  const h = harness(); await assert.rejects(h.open({ documentId: 'bad' }), { code: 'DOCUMENT_OPEN_INPUT' }); h.clean();
  await assert.rejects(h.acquisition.open(null), { code: 'DOCUMENT_OPEN_INPUT' });
  h.onSession = () => { throw Object.assign(new Error('secret token https://private.example/object'), { code: 'secret token' }); };
  await assert.rejects(h.open(), e => e.code === 'DOCUMENT_OPEN_PROTOCOL'
    && !e.message.includes('secret') && !e.message.includes('private.example')); h.clean();
  const bad = harness({ timeoutMs: 120001 }); await assert.rejects(bad.open(), { code: 'DOCUMENT_OPEN_INPUT' }); bad.clean();
});

test('installed SDK shared-storage actor change without broadcast needs the final session check', async () => {
  const storageKey = 'checked-acquisition-owned-test', values = new Map(), requests = [], events = [];
  const session = user => ({ access_token: `owned-token-${user}`, refresh_token: 'owned-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: user } });
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  storage.setItem(storageKey, JSON.stringify(session(actor)));
  // In a runtime without BroadcastChannel delivery, another client can change
  // shared persisted state without notifying this client's auth subscribers.
  const client = createClient('https://owned.invalid', 'owned-public-key', {
    auth: { storage, storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      requests.push(url); const params = JSON.parse(options.body);
      return new Response(JSON.stringify(rpcResult(url.split('/').at(-1), params).data),
        { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await client.auth.initialize();
  const initial = deferred();
  const observer = client.auth.onAuthStateChange((event, value) => { events.push([event, value?.user?.id]); initial.resolve(); });
  await initial.promise;
  let downloads = 0;
  const acquisition = createCheckedDocumentAcquisition({ client, actorUserId: actor, isCurrent: () => true,
    enabled: true, supabaseUrl: 'https://owned.invalid', publicKey: 'owned-public-key',
    fetch: async () => {
      downloads++;
      storage.setItem(storageKey, JSON.stringify(session(id(99))));
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
    } });
  try {
    await assert.rejects(acquisition.open({ documentId }), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' });
    assert.equal(downloads, 1);
    assert.equal(requests.filter(url => url.endsWith('/read_document_generation_open')).length, 1);
    assert.ok(events.every(([, user]) => user === actor));
    assert.equal((await client.auth.getSession()).data.session.user.id, id(99));
    assert.ok(events.every(([, user]) => user === actor), 'reading valid changed storage does not emit actor B');
  } finally { acquisition.dispose(); observer.data.subscription.unsubscribe(); values.clear(); }
});

test('installed Supabase SDK binds RPC JWT and aborts owned loopback HTTP', { timeout: 5000 }, async () => {
  const requests = [], callbacks = new Set(), closed = deferred(), entered = deferred(); let hang = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: req.url, authorization: req.headers.authorization });
    if (hang) { res.on('close', () => closed.resolve()); entered.resolve(); return; }
    if (req.url.startsWith('/rest/v1/rpc/')) {
      const result = rpcResult(req.url.split('/').at(-1), body);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.data));
    } else { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = createClient(url, 'public-test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let sessionReads = 0;
  // The SDK sees a refreshed ambient token after acquisition captures its JWT.
  // HTTP must still receive the explicit captured header on every RPC/download.
  client.auth.getSession = async () => ({ data: { session: { user: { id: actor },
    access_token: sessionReads++ === 0 ? 'bound-local-token' : 'ambient-refresh-token' } } });
  client.auth.onAuthStateChange = callback => { callbacks.add(callback); return { data: { subscription: { unsubscribe() { callbacks.delete(callback); } } } }; };
  const acquisition = createCheckedDocumentAcquisition({ client, actorUserId: actor, isCurrent: () => true,
    supabaseUrl: url, publicKey: 'public-test-key', enabled: true, allowLoopback: true, timeoutMs: 3000 });
  try {
    const bundle = await acquisition.open({ documentId }); assert.equal(bundle.throughSeq, '1');
    assert.equal(requests.length, 4); assert.ok(requests.every(r => r.authorization === 'Bearer bound-local-token'));
    assert.equal(callbacks.size, 0);
    hang = true; const controller = new AbortController();
    const opening = acquisition.open({ documentId, signal: controller.signal }); await entered.promise; controller.abort();
    await assert.rejects(opening, { code: 'DOCUMENT_OPEN_ABORTED' }); await closed.promise;
    assert.equal(callbacks.size, 0);
  } finally {
    acquisition.dispose(); const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing;
  }
});

test('current legacy open uses fresh metadata and one JWT, then rechecks metadata, mode and actor', async () => {
  const h = harness(); h.onRpc = () => modeResult();
  h.onFetch = () => { h.token = 'refreshed'; h.emit('TOKEN_REFRESHED'); return new Response(editedPdf, { headers: { 'Content-Type': 'application/pdf' } }); };
  const opened = await h.openCurrent(); h.clean();
  assert.equal(opened.mode, 'legacy'); assert.equal(opened.checkedBundle, null);
  assert.ok(Object.isFrozen(opened) && Object.isFrozen(opened.document));
  assert.equal(opened.document.file_size, String(pdf.length));
  assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), editedPdf);
  assert.equal(h.calls.length, 2); assert.equal(h.metadataCalls.length, 2); assert.equal(h.fetches.length, 1);
  assert.ok([...h.calls, ...h.metadataCalls].every(c => c.authorization === 'Bearer captured-token' && c.signal.aborted));
  assert.equal(h.fetches[0].options.headers.Authorization, 'Bearer captured-token');
  assert.equal(new URL(h.fetches[0].url).pathname, `/storage/v1/object/authenticated/documents/${legacyPath}`);
  assert.deepEqual(h.metadataCalls[0].filters, [['id', documentId], ['archived', false], ['user_archived_at', null]]);
});

test('current checked open passes exact discovered generation to real reader, never legacy metadata/storage', async () => {
  const h = harness(); h.onRpc = call => call.name === 'read_document_open_mode'
    ? modeResult('checked', generation) : rpcResult(call.name, call.params);
  const opened = await h.openCurrent(); h.clean();
  assert.equal(opened.mode, 'checked'); assert.equal(h.metadataCalls.length, 0);
  assert.deepEqual(new Uint8Array(await readCheckedGenerationPdf(opened.checkedBundle, scope).arrayBuffer()), pdf);
  assert.ok(h.calls.filter(c => c.name === 'read_document_generation_open').every(c => c.params.p_generation_id === generation));
  assert.ok(h.fetches.every(c => c.url.endsWith('/functions/v1/document-generation-download')));
});

test('mode errors, malformed envelopes and unchecked generation changes never fall back', async () => {
  for (const result of [{ error: { code: '42501' } }, {}, { data: { ...modeResult().data, extra: true } },
    modeResult('checked', null), modeResult('legacy', generation), modeResult('unknown'),
    { data: { ...modeResult().data, actor_user_id: id(90) } }]) {
    const h = harness(); h.onRpc = () => result;
    await assert.rejects(h.openCurrent()); h.clean();
    assert.equal(h.metadataCalls.length + h.fetches.length, 0);
  }
  const checked = harness(); checked.onRpc = call => call.name === 'read_document_open_mode'
    ? modeResult('checked', id(99)) : rpcResult(call.name, call.params);
  await assert.rejects(checked.openCurrent(), { code: 'DOCUMENT_OPEN_PROTOCOL' }); checked.clean();
  assert.equal(checked.metadataCalls.length + checked.fetches.length, 0);
});

test('legacy adoption, revocation and metadata replacement during download reject without retry', async () => {
  for (const change of ['adoption', 'revocation', 'path', 'size', 'hash', 'owner', 'project', 'name', 'stamp']) {
    const h = harness(); let downloaded = false;
    h.onRpc = () => downloaded && change === 'adoption' ? modeResult('checked', generation) : modeResult();
    h.onMetadata = () => {
      const row = structuredClone(legacyRow);
      if (downloaded) {
        if (change === 'revocation') return { data: null };
        if (change === 'path') row.file_path += '.replaced';
        if (change === 'size') row.file_size++;
        if (change === 'hash') row.content_sha256 = '0'.repeat(64);
        if (change === 'owner') row.user_id = id(91);
        if (change === 'project') row.project_id = id(92);
        if (change === 'name') row.name = 'Renamed.pdf';
        if (change === 'stamp') row.updated_at = '2026-09-10T00:00:00Z';
      }
      return { data: row };
    };
    h.onFetch = () => { downloaded = true; return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }); };
    await assert.rejects(h.openCurrent(), { code: change === 'adoption' ? 'SG001'
      : change === 'revocation' ? 'DOCUMENT_OPEN_PROTOCOL' : 'DOCUMENT_OPEN_BYTES' });
    h.clean(); assert.equal(h.fetches.length, 1); assert.equal(h.metadataCalls.length, 2);
    assert.equal(h.calls.length, change === 'adoption' ? 2 : 1);
  }
});

test('legacy captures metadata before awaits; hashless reads are not checked bundles', async () => {
  const h = harness(), shared = { ...legacyRow, content_sha256: null };
  h.onRpc = () => modeResult(); h.onMetadata = () => ({ data: shared });
  h.onFetch = () => { shared.name = 'Changed while fetching'; return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }); };
  await assert.rejects(h.openCurrent(), { code: 'DOCUMENT_OPEN_BYTES' }); h.clean();
  const valid = harness(); valid.onRpc = () => modeResult();
  valid.onMetadata = () => ({ data: { ...legacyRow, user_id: id(70), content_sha256: null } });
  const opened = await valid.openCurrent(); valid.clean();
  assert.equal(opened.document.user_id, id(70), 'collaborators are not filtered to owned documents');
  assert.throws(() => readCheckedGenerationPdf(opened, scope), { code: 'DOCUMENT_OPEN_INPUT' });
});

test('current open has zero I/O when disabled; invalid metadata stops before Storage', async () => {
  await assert.rejects(createCheckedDocumentAcquisition().openCurrent({ documentId }), { code: 'DOCUMENT_OPEN_DISABLED' });
  for (const patch of [{ file_size: Number.MAX_SAFE_INTEGER + 1 }, { file_size: 0 }, { archived: true },
    { name: 'a'.repeat(65537) }, { file_size: '9223372036854775808' }, { content_sha256: 'bad' }, { file_path: '' }]) {
    const h = harness(); h.onRpc = () => modeResult(); h.onMetadata = () => ({ data: { ...legacyRow, ...patch } });
    await assert.rejects(h.openCurrent()); h.clean(); assert.equal(h.fetches.length, 0);
  }
});

test('nullable or stale legacy row size is metadata only; actual response bytes own the limit', async () => {
  for (const file_size of [null, '999999999']) {
    const h = harness(); h.onRpc = () => modeResult();
    h.onMetadata = () => ({ data: { ...legacyRow, file_size } });
    h.onFetch = () => new Response(editedPdf, { headers: { 'Content-Type': 'application/pdf' } });
    const opened = await h.openCurrent(); h.clean();
    assert.equal(opened.document.file_size, file_size);
    assert.deepEqual(new Uint8Array(await opened.blob.arrayBuffer()), editedPdf);
  }
});

test('current legacy hung metadata is abortable and final-session actor change rejects completed bytes', async () => {
  const h = harness(), entered = deferred(), controller = new AbortController(); h.onRpc = () => modeResult();
  h.onMetadata = () => { entered.resolve(); return new Promise(() => {}); };
  const opening = h.openCurrent({ signal: controller.signal }); await entered.promise; controller.abort();
  await assert.rejects(opening, { code: 'DOCUMENT_OPEN_ABORTED' }); h.clean();
  const final = harness(); let modes = 0;
  final.onRpc = () => { if (++modes === 2) final.sessionActor = id(95); return modeResult(); };
  await assert.rejects(final.openCurrent(), { code: 'DOCUMENT_OPEN_ACTOR_CHANGED' }); final.clean();
  assert.equal(final.fetches.length, 1);
});

test('installed SDK current legacy open pins metadata and mode JWT through owned HTTP', { timeout: 5000 }, async () => {
  const requests = [], callbacks = new Set();
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume request */ }
    requests.push({ url: new URL(req.url, 'http://local'), authorization: req.headers.authorization });
    if (req.url.startsWith('/storage/')) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); }
    else { res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url.startsWith('/rest/v1/documents?') ? legacyRow : modeResult().data)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = createClient(url, 'public-test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let reads = 0;
  client.auth.getSession = async () => ({ data: { session: { user: { id: actor }, access_token: reads++ === 0 ? 'pinned' : 'refreshed' } } });
  client.auth.onAuthStateChange = cb => { callbacks.add(cb); return { data: { subscription: { unsubscribe() { callbacks.delete(cb); } } } }; };
  const acquisition = createCheckedDocumentAcquisition({ client, actorUserId: actor, isCurrent: () => true,
    supabaseUrl: url, publicKey: 'public-test-key', enabled: true, allowLoopback: true });
  try {
    const result = await acquisition.openCurrent({ documentId });
    assert.equal(result.blob.size, pdf.length); assert.equal(callbacks.size, 0); assert.equal(requests.length, 5);
    assert.ok(requests.every(r => r.authorization === 'Bearer pinned'));
    const metadata = requests.filter(r => r.url.pathname === '/rest/v1/documents'); assert.equal(metadata.length, 2);
    for (const r of metadata) {
      assert.equal(r.url.searchParams.get('id'), `eq.${documentId}`);
      assert.equal(r.url.searchParams.get('archived'), 'eq.false');
      assert.equal(r.url.searchParams.get('user_archived_at'), 'is.null');
      assert.equal(r.url.searchParams.get('user_id'), null);
      assert.equal(r.url.searchParams.get('select'), Object.keys(legacyRow).join(','));
    }
  } finally { acquisition.dispose(); const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing; }
});
