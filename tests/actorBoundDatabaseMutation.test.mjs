import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { runActorBoundDatabaseMutation as run } from '../src/services/actorBoundDatabaseMutation.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const session = (id = 'actor-a', token = 'token-a') => ({ data: { session: { user: { id }, access_token: token } } });
function fixture() {
  let current = session(), alive = true, callback, reads = 0, unsubscribed = 0;
  const queries = [], listeners = new Set();
  const client = { auth: {
    getSession() { reads++; return current; },
    onAuthStateChange(fn) { callback = fn; listeners.add(fn); return { data: { subscription: {
      unsubscribe() { unsubscribed++; listeners.delete(fn); },
    } } }; },
  } };
  const config = { client, actorUserId: 'actor-a', isCurrent: () => alive, timeoutMs: 2000 };
  const query = (result = { data: ['ok'], error: null }) => {
    const record = { dispatched: 0 }; queries.push(record);
    const builder = {
      setHeader(name, value) { record[name] = value; return builder; },
      abortSignal(signal) { record.signal = signal; return builder; },
      retry(value) { record.retry = value; return builder; },
      then(resolve, reject) { record.dispatched++; return Promise.resolve(result).then(resolve, reject); },
    }; return builder;
  };
  return { config, query, queries, listeners, get reads() { return reads; }, get unsubscribed() { return unsubscribed; },
    actor(id, token) { current = session(id, token); }, stale() { alive = false; },
    emit(event, id = 'actor-a') { callback(event, session(id).data.session); } };
}
const rejectCode = (code, committed = false) => error => {
  assert.equal(error.code, code); assert.equal(error.mayHaveCommitted, committed);
  assert.equal(error.message, 'The database change could not be confirmed.'); return true;
};

test('binds one initial JWT across read/write stages and returns unchanged SQL responses', async () => {
  const f = fixture(), duplicate = { data: null, error: { code: '23505', message: 'internal details' } };
  const answer = await run(f.config, async ({ request, checkCurrent }) => {
    checkCurrent();
    f.actor('actor-a', 'new-token');
    assert.equal(await request(() => f.query(duplicate)), duplicate);
    return request(() => f.query(), { write: false });
  });
  assert.deepEqual(answer.data, ['ok']);
  assert.equal(f.reads, 6);
  for (const query of f.queries) {
    assert.equal(query.Authorization, 'Bearer token-a'); assert.equal(query.retry, false);
    assert.equal(query.dispatched, 1); assert.equal(query.signal.aborted, true);
  }
  assert.equal(f.listeners.size, 0); assert.equal(f.unsubscribed, 1);
});

test('bad input, preabort, and stale scope start no auth or query work', async () => {
  const f = fixture();
  for (const bad of [null, { ...f.config, actorUserId: '' }, { ...f.config, timeoutMs: 0 }]) {
    await assert.rejects(run(bad, () => {}), rejectCode('DATABASE_MUTATION_INPUT'));
  }
  const controller = new AbortController(); controller.abort('secret');
  await assert.rejects(run({ ...f.config, signal: controller.signal }, () => {}), rejectCode('DATABASE_MUTATION_ABORTED'));
  f.stale(); await assert.rejects(run(f.config, () => {}), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED'));
  assert.equal(f.reads, 0); assert.equal(f.queries.length, 0); assert.equal(f.listeners.size, 0);
});

test('wrong initial actor and silent pre-stage session change cannot invoke query factory', async () => {
  const f = fixture(); f.actor('actor-b');
  await assert.rejects(run(f.config, () => assert.fail()), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED'));
  f.actor('actor-a');
  await assert.rejects(run(f.config, ({ request }) => {
    f.actor('actor-b'); return request(() => { assert.fail('must not build'); });
  }), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED'));
  assert.equal(f.listeners.size, 0);
});

test('subscription before held initial session catches observed A-B-A', async () => {
  const f = fixture(), held = deferred(), entered = deferred();
  f.config.client.auth.getSession = () => { entered.resolve(); return held.promise; };
  const running = run(f.config, () => assert.fail());
  await entered.promise; f.emit('SIGNED_IN', 'actor-b'); f.emit('SIGNED_IN', 'actor-a');
  await assert.rejects(running, rejectCode('DATABASE_MUTATION_SCOPE_CHANGED'));
  held.resolve(session()); assert.equal(f.listeners.size, 0); assert.equal(f.unsubscribed, 1);
});

test('signout or silent actor loss after write ack rejects with uncertain commit', async () => {
  for (const observed of [true, false]) {
    const f = fixture(), held = deferred(), started = deferred();
    const running = run(f.config, ({ request }) => request(() => {
      const builder = f.query(held.promise); started.resolve(); return builder;
    }));
    await started.promise;
    if (observed) f.emit('SIGNED_OUT'); else f.actor('actor-b');
    held.resolve({ data: ['ack'], error: null });
    await assert.rejects(running, rejectCode('DATABASE_MUTATION_SCOPE_CHANGED', true));
    assert.equal(f.listeners.size, 0);
  }
});

test('final actual session guard rejects changes after operation result', async () => {
  const f = fixture();
  await assert.rejects(run(f.config, async ({ request }) => {
    await request(() => f.query()); f.actor('actor-b'); return 'not published';
  }), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED', true));
});

test('scope loss prevents later stages and retained helpers cannot dispatch after completion', async () => {
  const f = fixture(); let helper;
  await run(f.config, value => { helper = value; return 'done'; });
  await assert.rejects(helper.request(() => assert.fail()), rejectCode('DATABASE_MUTATION_ABORTED'));
  assert.throws(helper.checkCurrent, rejectCode('DATABASE_MUTATION_ABORTED'));
  await assert.rejects(run(f.config, async ({ request }) => {
    await request(() => f.query(), { write: false }); f.stale();
    return request(() => assert.fail());
  }), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED'));
});

test('whole-operation deadlines settle hung auth, operation, and query with listener cleanup', async () => {
  for (const stage of ['auth', 'operation', 'query']) {
    const f = fixture(); f.config.timeoutMs = 25;
    const hung = new Promise(() => {});
    if (stage === 'auth') f.config.client.auth.getSession = () => hung;
    await assert.rejects(run(f.config, ({ request }) => stage === 'query'
      ? request(() => f.query(hung)) : hung), rejectCode('DATABASE_MUTATION_ABORTED', stage === 'query'));
    assert.equal(f.listeners.size, 0); assert.equal(f.unsubscribed, 1);
    if (f.queries.length) assert.equal(f.queries[0].signal.aborted, true);
  }
});

test('caller abort settles ignored query cancellation; late rejection is observed and safe', async () => {
  const f = fixture(), controller = new AbortController(), held = deferred(), started = deferred();
  const running = run({ ...f.config, signal: controller.signal }, ({ request }) => request(() => {
    started.resolve(); return f.query(held.promise);
  }));
  await started.promise; controller.abort('secret-token-url');
  await assert.rejects(running, rejectCode('DATABASE_MUTATION_ABORTED', true));
  held.reject(new Error('secret')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.listeners.size, 0);
});

test('sanitizes known SQL codes and unexpected failures; read-only errors never claim a write', async () => {
  for (const [code, write] of [['23505', true], ['42501', false], ['secret-token', false]]) {
    const f = fixture();
    await assert.rejects(run(f.config, async ({ request }) => {
      const response = await request(() => f.query({ data: null, error: { code, message: 'secret url' } }), { write });
      throw response.error;
    }), rejectCode(code === 'secret-token' ? 'DATABASE_MUTATION_FAILED' : code, write));
  }
});

test('concurrent operations capture their own JWTs and cancellation does not cross scopes', async () => {
  const f = fixture(), held = deferred(), started = deferred(), controller = new AbortController();
  const first = run({ ...f.config, signal: controller.signal }, ({ request }) => request(() => {
    started.resolve(); return f.query(held.promise);
  }));
  await started.promise;
  f.actor('actor-a', 'second-token');
  await run(f.config, ({ request }) => request(() => f.query())); controller.abort();
  await assert.rejects(first, rejectCode('DATABASE_MUTATION_ABORTED', true));
  assert.equal(f.queries[0].Authorization, 'Bearer token-a');
  assert.equal(f.queries[1].Authorization, 'Bearer second-token');
  assert.equal(f.listeners.size, 0); assert.equal(f.unsubscribed, 2);
  held.resolve({ data: null, error: null });
});

test('external abort listeners are removed on success and failure, including hung auth', async () => {
  for (const fail of [false, true]) {
    const f = fixture(), controller = new AbortController(), listeners = new Set();
    const nativeAdd = controller.signal.addEventListener.bind(controller.signal);
    const nativeRemove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (type, callback, ...args) => { listeners.add(callback); nativeAdd(type, callback, ...args); };
    controller.signal.removeEventListener = (type, callback, ...args) => { listeners.delete(callback); nativeRemove(type, callback, ...args); };
    if (fail) { f.config.client.auth.getSession = () => new Promise(() => {}); f.config.timeoutMs = 25; }
    const running = run({ ...f.config, signal: controller.signal }, () => 'done');
    if (fail) await assert.rejects(running, rejectCode('DATABASE_MUTATION_ABORTED'));
    else assert.equal(await running, 'done');
    assert.equal(listeners.size, 0); assert.equal(f.listeners.size, 0);
  }
});

test('final session completion handoff cannot accept a queued abort', async () => {
  const f = fixture(), controller = new AbortController(); let reads = 0;
  f.config.client.auth.getSession = () => {
    if (++reads === 2) queueMicrotask(() => controller.abort());
    return Promise.resolve(session());
  };
  await assert.rejects(run({ ...f.config, signal: controller.signal }, () => 'not published'), rejectCode('DATABASE_MUTATION_ABORTED'));
});

test('installed SDK silent persisted actor change after write is caught without auth broadcast', async () => {
  const storageKey = 'owned-database-mutation-test', values = new Map(), events = [];
  const persisted = id => ({ access_token: `owned-token-${id}`, refresh_token: 'owned-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id } });
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  storage.setItem(storageKey, JSON.stringify(persisted('actor-a')));
  let requests = 0;
  const client = createClient('https://owned.invalid', 'owned-public-key', {
    auth: { storage, storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (_url, options) => {
      requests++; assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer owned-token-actor-a');
      storage.setItem(storageKey, JSON.stringify(persisted('actor-b')));
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await client.auth.initialize();
  const ready = deferred();
  const observer = client.auth.onAuthStateChange((_event, value) => { events.push(value?.user?.id); ready.resolve(); });
  await ready.promise;
  try {
    await assert.rejects(run({ client, actorUserId: 'actor-a', isCurrent: () => true }, async ({ request }) => {
      await request(() => client.rpc('owned_write', {})); assert.fail('must not accept acknowledged result');
    }), rejectCode('DATABASE_MUTATION_SCOPE_CHANGED', true));
    assert.equal(requests, 1); assert.ok(events.every(id => id === 'actor-a'));
    assert.equal((await client.auth.getSession()).data.session.user.id, 'actor-b');
    assert.ok(events.every(id => id === 'actor-a'));
  } finally { observer.data.subscription.unsubscribe(); values.clear(); }
});

test('installed SDK binds RPC/table POST token despite ambient token and never retries HTTP errors', { timeout: 5000 }, async () => {
  const received = [], server = createServer((req, res) => {
    received.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    req.resume(); res.writeHead(req.url.includes('/rpc/') ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('/rpc/') ? { ok: true } : { code: '42501', message: 'secret url' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'owned-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let reads = 0;
  client.auth.getSession = async () => session('actor-a', ++reads === 1 ? 'initial-token' : 'ambient-token');
  client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
  try {
    await run({ client, actorUserId: 'actor-a', isCurrent: () => true }, async ({ request }) => {
      assert.deepEqual((await request(() => client.rpc('owned_write', {}))).data, { ok: true });
      assert.equal((await request(() => client.from('documents').insert({ id: 'owned' }))).error.code, '42501');
    });
    assert.equal(received.length, 2);
    for (const req of received) { assert.equal(req.method, 'POST'); assert.equal(req.authorization, 'Bearer initial-token'); }
  } finally { const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing; }
});

test('installed SDK pending write abort closes owned HTTP request without retry', { timeout: 5000 }, async () => {
  const entered = deferred(), closed = deferred(); let count = 0;
  const server = createServer((req, res) => { count++; req.resume(); res.on('close', () => closed.resolve()); entered.resolve(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'owned-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  client.auth.getSession = async () => session();
  client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
  const controller = new AbortController();
  try {
    const running = run({ client, actorUserId: 'actor-a', isCurrent: () => true, signal: controller.signal },
      ({ request }) => request(() => client.from('documents').insert({ id: 'owned' })));
    await entered.promise; controller.abort();
    await assert.rejects(running, rejectCode('DATABASE_MUTATION_ABORTED', true));
    await closed.promise; assert.equal(count, 1);
  } finally { controller.abort(); const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing; }
});
