import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { createDocumentCatalogReader } from '../src/services/documentCatalogReader.js';

const id = n => `a0200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), project = id(2), stamp = '2026-09-09T01:02:03.123456+00:00';
const row = n => ({ id: id(n), user_id: actor, project_id: null, name: `Document ${n}`, name_truncated: false,
  file_size: '9007199254740993', page_count: 3, created_at: stamp, updated_at: stamp, locked_at: null });
const page = (rows, more = false) => ({ version: 1, actor_user_id: actor, rows,
  has_more: more, next_cursor: more ? rows.at(-1).id : null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const code = expected => error => error.code === expected && !/secret|private\.example/.test(error.message);
function harness(config = {}) {
  const callbacks = new Set();
  const h = { token: 'first-token', sessionActor: actor, current: true, sessions: 0,
    subscriptions: 0, unsubscribes: 0, calls: [], data: [row(10), row(11), row(12)],
    onSession: null, onRpc: null, onSubscribe: null, callbacks };
  h.emit = (event, user = actor) => { for (const cb of [...callbacks]) cb(event, user ? { user: { id: user }, access_token: h.token } : null); };
  h.client = {
    auth: {
      getSession() {
        h.sessions++;
        return h.onSession ? h.onSession() : Promise.resolve({ data: { session: { user: { id: h.sessionActor }, access_token: h.token } } });
      },
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
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (h.onRpc) return h.onRpc(call);
            assert.equal(name, 'list_document_catalog');
            const matching = h.data.filter(r => (!params.p_after_id || r.id > params.p_after_id)
              && (!params.p_project_id || r.project_id === params.p_project_id));
            return { data: page(matching.slice(0, params.p_limit), matching.length > params.p_limit) };
          }).then(resolve, reject);
        },
      };
    },
  };
  h.reader = createDocumentCatalogReader({ client: h.client, actorUserId: actor, isCurrent: () => h.current,
    enabled: true, pageSize: 2, ...config });
  h.read = input => h.reader.read(input);
  h.clean = () => { assert.equal(callbacks.size, 0); assert.equal(h.subscriptions, h.unsubscribes); };
  return h;
}

test('default/exact disabled gate touches no client or scope and performs zero work', async () => {
  await assert.rejects(createDocumentCatalogReader().read(), code('DOCUMENT_CATALOG_DISABLED'));
  for (const enabled of [false, undefined, 'true', 1]) {
    const h = harness({ enabled, isCurrent: () => { throw new Error('must not run'); } });
    await assert.rejects(h.read(), code('DOCUMENT_CATALOG_DISABLED'));
    assert.equal(h.sessions + h.subscriptions + h.calls.length, 0);
  }
});

test('complete keyset read owns frozen exact rows and preserves decimal sizes and excerpts', async () => {
  const h = harness(); h.data[1].name = '😀'.repeat(1024); h.data[1].name_truncated = true;
  h.data[2].user_id = id(90);
  const result = await h.read(); h.clean();
  assert.deepEqual(result, { version: 1, actorUserId: actor, projectId: null, rows: h.data });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.rows) && result.rows.every(Object.isFrozen));
  assert.equal(result.rows[0].file_size, '9007199254740993');
  h.data[0].name = 'changed'; assert.equal(result.rows[0].name, 'Document 10');
  assert.deepEqual(h.calls.map(c => c.params), [
    { p_after_id: null, p_limit: 2, p_project_id: null },
    { p_after_id: id(11), p_limit: 2, p_project_id: null },
  ]);
  assert.ok(h.calls.every(c => c.authorization === 'Bearer first-token' && c.signal.aborted));
  assert.equal(h.sessions, 4, 'initial, each page and final actor read');
});

test('project filter is exact and SQL nullable fields and zero counts survive unchanged', async () => {
  const h = harness(); Object.assign(h.data[0], { project_id: project, name: null, name_truncated: null,
    file_size: null, page_count: null, created_at: null, updated_at: null });
  Object.assign(h.data[1], { project_id: project, file_size: '0', page_count: 0, locked_at: stamp });
  assert.deepEqual((await h.read({ projectId: project })).rows, h.data.slice(0, 2)); h.clean();
  assert.equal(h.calls[0].params.p_project_id, project);
  const empty = harness(); empty.data = []; assert.deepEqual((await empty.read()).rows, []); empty.clean();
});

test('invalid config/read input and already aborted signals fail before any subscription', async () => {
  for (const config of [{ pageSize: 201 }, { pageSize: 0 }, { maxPages: 1001 }, { maxRows: -1 }, { maxBytes: 0 },
    { maxBytes: 64 * 1024 * 1024 + 1 }, { timeoutMs: Infinity }, { actorUserId: 'bad' }]) {
    const h = harness(config); await assert.rejects(h.read(), code('DOCUMENT_CATALOG_INPUT')); assert.equal(h.subscriptions, 0);
  }
  const h = harness();
  for (const input of [null, [], { projectId: 'bad' }, { signal: {} }]) await assert.rejects(h.read(input), code('DOCUMENT_CATALOG_INPUT'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.read({ signal: controller.signal }), code('DOCUMENT_CATALOG_ABORTED')); assert.equal(h.sessions + h.subscriptions, 0);
});

test('strict envelope rejects wrong scope, extra content, cursor loops and inconsistent pages', async () => {
  const changes = [p => p.version = 2, p => p.actor_user_id = id(99), p => p.extra = 'secret', p => delete p.version,
    p => p.rows = {}, p => p.has_more = 1, p => p.next_cursor = id(99),
    p => { p.has_more = true; p.next_cursor = null; }, p => { p.rows = []; p.has_more = true; },
    p => { p.rows = [row(11), row(10)]; }, p => { p.rows = [row(10), row(10)]; },
    p => { p.rows.push(row(12)); }];
  for (const change of changes) {
    const h = harness(); h.onRpc = () => { const p = page([row(10), row(11)]); change(p); return { data: p }; };
    await assert.rejects(h.read(), e => ['DOCUMENT_CATALOG_PROTOCOL', 'DOCUMENT_CATALOG_LIMIT'].includes(e.code)); h.clean();
  }
  const h = harness(); h.onRpc = () => ({ data: page([row(10), row(11)], true) });
  await assert.rejects(h.read(), code('DOCUMENT_CATALOG_PROTOCOL')); assert.equal(h.calls.length, 2); h.clean();
});

test('strict rows reject content keys, invalid decimals, dates, Unicode and truncation state', async () => {
  const changes = [r => r.file_path = 'secret', r => delete r.locked_at, r => r.id = 'bad', r => r.user_id = 'bad',
    r => r.project_id = 'bad', r => r.file_size = 12, r => r.file_size = '01', r => r.file_size = '-1',
    r => r.file_size = '9223372036854775808', r => r.page_count = -1, r => r.page_count = 1.2,
    r => r.name = 'a'.repeat(1025), r => r.name = '\ud800', r => r.name = '\0', r => r.name_truncated = true,
    r => r.name_truncated = null, r => r.name = null, r => r.updated_at = '2026-02-30T00:00:00Z',
    r => r.created_at = '2026-01-01T25:00:00Z', r => r.locked_at = 'infinity',
    r => Object.defineProperty(r, 'name', { enumerable: true, get() { throw new Error('secret'); } }),
    r => r.toJSON = () => { throw new Error('secret'); }];
  for (const change of changes) {
    const h = harness(); const r = row(10); change(r); h.onRpc = () => ({ data: page([r]) });
    await assert.rejects(h.read(), code('DOCUMENT_CATALOG_PROTOCOL')); h.clean();
  }
  const h = harness(); h.onRpc = () => ({ data: page([row(10)]) });
  await assert.rejects(h.read({ projectId: project }), code('DOCUMENT_CATALOG_PROTOCOL')); h.clean();
});

test('page, row and cumulative UTF8 byte limits reject complete results without extra RPCs', async () => {
  for (const config of [{ maxPages: 1 }, { maxRows: 2 }, { maxBytes: 1 }]) {
    const h = harness(config); await assert.rejects(h.read(), code('DOCUMENT_CATALOG_LIMIT')); h.clean(); assert.equal(h.calls.length, 1);
  }
  const first = page([row(10), row(11)], true), last = page([row(12)]);
  const length = new TextEncoder().encode(JSON.stringify(first)).length + new TextEncoder().encode(JSON.stringify(last)).length;
  const exact = harness({ maxBytes: length }); assert.equal((await exact.read()).rows.length, 3); exact.clean();
  const short = harness({ maxBytes: length - 1 }); await assert.rejects(short.read(), code('DOCUMENT_CATALOG_LIMIT')); short.clean();
  const constrained = harness({ maxRows: 1 }); await assert.rejects(constrained.read(), code('DOCUMENT_CATALOG_LIMIT'));
  assert.equal(constrained.calls[0].params.p_limit, 1); assert.equal(constrained.calls.length, 1); constrained.clean();
});

test('byte accounting uses UTF8 rather than UTF16 string length', async () => {
  const data = row(10); data.name = '😀'.repeat(1024); data.name_truncated = true;
  const envelope = page([data]), bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
  assert.ok(bytes > JSON.stringify(envelope).length);
  for (const delta of [0, -1]) {
    const h = harness({ maxBytes: bytes + delta }); h.data = [data];
    if (delta) await assert.rejects(h.read(), code('DOCUMENT_CATALOG_LIMIT'));
    else assert.equal((await h.read()).rows[0].name, data.name);
    h.clean();
  }
});

test('accepted rows cannot be changed by a later adapter or final auth await', async () => {
  const h = harness(); h.onSession = () => {
    if (h.sessions === 4) h.data[0].name = 'Changed after acceptance';
    return { data: { session: { user: { id: actor }, access_token: h.token } } };
  };
  assert.equal((await h.read()).rows[0].name, 'Document 10'); h.clean();
});

test('second-page errors preserve only safe codes and never return first-page data', async () => {
  for (const error of [{ code: '42501', message: 'secret token private.example' }, { code: 'secret', message: 'private.example' }]) {
    const h = harness(); h.onRpc = call => call.params.p_after_id ? { error } : { data: page(h.data.slice(0, 2), true) };
    await assert.rejects(h.read(), code(error.code === '42501' ? '42501' : 'DOCUMENT_CATALOG_PROTOCOL')); h.clean();
  }
});

test('missed auth events are caught both between pages and after the final page', async () => {
  for (const more of [true, false]) {
    const h = harness(); h.onRpc = () => { h.sessionActor = id(99); return { data: page(h.data.slice(0, 2), more) }; };
    await assert.rejects(h.read(), code('DOCUMENT_CATALOG_ACTOR_CHANGED')); h.clean(); assert.equal(h.calls.length, 1);
  }
});

test('auth A-B-A/signout retire reads, while same-actor refresh never replaces the captured JWT', async () => {
  for (const signout of [false, true]) {
    const h = harness(), entered = deferred(); h.onRpc = () => { entered.resolve(); return new Promise(() => {}); };
    const reading = h.read(); await entered.promise;
    if (signout) h.emit('SIGNED_OUT', null); else { h.emit('SIGNED_IN', id(99)); h.emit('SIGNED_IN'); }
    await assert.rejects(reading, code('DOCUMENT_CATALOG_ACTOR_CHANGED')); h.clean();
    await assert.rejects(h.read(), code('DOCUMENT_CATALOG_ACTOR_CHANGED'));
  }
  const h = harness(); h.onRpc = call => { h.token = 'refreshed'; h.emit('TOKEN_REFRESHED');
    return { data: call.params.p_after_id ? page([row(12)]) : page([row(10), row(11)], true) }; };
  await h.read(); h.clean(); assert.ok(h.calls.every(c => c.authorization === 'Bearer first-token'));
});

test('opaque scope guard vetoes a resolved page before any later work', async () => {
  const h = harness(); h.onRpc = () => { h.current = false; return { data: page([row(10)]) }; };
  await assert.rejects(h.read(), code('DOCUMENT_CATALOG_ACTOR_CHANGED')); h.clean();
  assert.equal(h.calls.length, 1);
});

test('hung auth/RPC obey deadline and caller cancellation without poisoning retries', async () => {
  for (const stage of ['auth', 'rpc']) for (const cancel of [false, true]) {
    const h = harness({ timeoutMs: 30 }), entered = deferred(), controller = new AbortController();
    const hang = () => { entered.resolve(); return new Promise(() => {}); };
    if (stage === 'auth') h.onSession = hang; else h.onRpc = hang;
    const reading = h.read({ signal: controller.signal }); await entered.promise;
    if (cancel) controller.abort();
    await assert.rejects(reading, code('DOCUMENT_CATALOG_ABORTED')); h.clean();
    h.onSession = null; h.onRpc = null; await h.read(); h.clean();
  }
});

test('final synchronous auth work cannot outrun the deadline; thrown details stay private', async () => {
  const h = harness({ timeoutMs: 20 }); h.data = [row(10)];
  h.onSession = () => {
    if (h.sessions === 3) { const until = performance.now() + 30; while (performance.now() < until) { /* delay timer dispatch */ } }
    return { data: { session: { user: { id: actor }, access_token: h.token } } };
  };
  await assert.rejects(h.read(), code('DOCUMENT_CATALOG_ABORTED')); h.clean();
  const broken = harness(); broken.onSession = () => { throw new Error('secret token https://private.example'); };
  await assert.rejects(broken.read(), code('DOCUMENT_CATALOG_PROTOCOL')); broken.clean();
});

test('cancellation queued at final session resolution vetoes the completion handoff', async () => {
  const h = harness(), controller = new AbortController(); h.data = [row(10)];
  h.onSession = () => {
    const response = { data: { session: { user: { id: actor }, access_token: h.token } } };
    if (h.sessions !== 3) return response;
    return new Promise(resolve => {
      resolve(response);
      queueMicrotask(() => controller.abort());
    });
  };
  await assert.rejects(h.read({ signal: controller.signal }), code('DOCUMENT_CATALOG_ABORTED'));
  h.clean(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, true);
});

test('success/error detach both caller listeners; stale auth callbacks cannot retire later reads', async () => {
  const owner = new AbortController(), caller = new AbortController(), counts = new Map();
  for (const signal of [owner.signal, caller.signal]) {
    counts.set(signal, 0); const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args) => { counts.set(signal, counts.get(signal) + 1); return add(...args); };
    signal.removeEventListener = (...args) => { counts.set(signal, counts.get(signal) - 1); return remove(...args); };
  }
  const h = harness({ signal: owner.signal }); let stale;
  h.onSubscribe = cb => { stale ||= cb; };
  await h.read({ signal: caller.signal }); h.clean(); assert.deepEqual([...counts.values()], [0, 0]); stale('SIGNED_OUT', null);
  h.onRpc = () => ({ error: { code: '42501' } });
  await assert.rejects(h.read({ signal: caller.signal }), code('42501')); h.clean(); assert.deepEqual([...counts.values()], [0, 0]);
});

test('concurrent reads capture separate JWTs and cancel independently; dispose cancels all', async () => {
  const h = harness(), entered = deferred(), controller = new AbortController();
  h.onRpc = call => {
    if (call.authorization === 'Bearer first-token') { entered.resolve(); return new Promise(() => {}); }
    return { data: page([row(10)]) };
  };
  const first = h.read({ signal: controller.signal }); await entered.promise;
  h.token = 'second-token'; assert.equal((await h.read()).rows.length, 1);
  assert.equal(h.callbacks.size, 1); controller.abort(); await assert.rejects(first, code('DOCUMENT_CATALOG_ABORTED')); h.clean();
  const next = deferred(); h.onSession = () => { if (h.callbacks.size === 2) next.resolve(); return new Promise(() => {}); };
  const a = h.read(), b = h.read(); await next.promise; h.reader.dispose();
  await assert.rejects(a, code('DOCUMENT_CATALOG_ABORTED')); await assert.rejects(b, code('DOCUMENT_CATALOG_ABORTED')); h.clean();
  await assert.rejects(h.read(), code('DOCUMENT_CATALOG_ACTOR_CHANGED'));
});

test('installed SDK detects final shared-storage actor change without broadcast', async () => {
  const key = 'catalog-owned-test', values = new Map(), events = [];
  const session = user => ({ access_token: `owned-token-${user}`, refresh_token: 'owned-refresh', token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user } });
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  storage.setItem(key, JSON.stringify(session(actor)));
  const client = createClient('https://owned.invalid', 'owned-public', {
    auth: { storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => { storage.setItem(key, JSON.stringify(session(id(99))));
      return new Response(JSON.stringify(page([row(10)])), { headers: { 'Content-Type': 'application/json' } }); } },
  });
  await client.auth.initialize(); const initial = deferred();
  const observer = client.auth.onAuthStateChange((_event, value) => { events.push(value?.user?.id); initial.resolve(); }); await initial.promise;
  const reader = createDocumentCatalogReader({ client, actorUserId: actor, isCurrent: () => true, enabled: true });
  try {
    await assert.rejects(reader.read(), code('DOCUMENT_CATALOG_ACTOR_CHANGED'));
    assert.ok(events.every(value => value === actor)); assert.equal((await client.auth.getSession()).data.session.user.id, id(99));
  } finally { reader.dispose(); observer.data.subscription.unsubscribe(); values.clear(); }
});

test('installed SDK owned HTTP verifies captured JWT, paging and socket abort', { timeout: 5000 }, async () => {
  const requests = [], callbacks = new Set(), entered = deferred(), closed = deferred(); let hang = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const params = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ url: req.url, token: req.headers.authorization, params });
    if (hang) { res.on('close', () => closed.resolve()); entered.resolve(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(params.p_after_id ? page([row(12)]) : page([row(10), row(11)], true)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'owned-public', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let reads = 0;
  client.auth.getSession = async () => ({ data: { session: { user: { id: actor }, access_token: reads++ ? 'ambient-token' : 'captured-token' } } });
  client.auth.onAuthStateChange = cb => { callbacks.add(cb); return { data: { subscription: { unsubscribe() { callbacks.delete(cb); } } } }; };
  const reader = createDocumentCatalogReader({ client, actorUserId: actor, isCurrent: () => true, enabled: true, pageSize: 2, timeoutMs: 3000 });
  try {
    assert.equal((await reader.read()).rows.length, 3);
    assert.equal(requests.length, 2); assert.ok(requests.every(r => r.token === 'Bearer captured-token' && r.url === '/rest/v1/rpc/list_document_catalog'));
    assert.equal(requests[1].params.p_after_id, id(11)); assert.equal(callbacks.size, 0);
    hang = true; const controller = new AbortController(); const reading = reader.read({ signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(reading, code('DOCUMENT_CATALOG_ABORTED')); await closed.promise;
    assert.equal(callbacks.size, 0);
  } finally { reader.dispose(); const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing; }
});
