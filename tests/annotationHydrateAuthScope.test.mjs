import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectKeysetRows } from '../src/services/annotationReadPagination.js';
import * as serializers from '../src/services/annotationTypeSerializers.js';
import * as markerTypes from '../src/utils/surveyMarkerType.js';
import { createClient } from '@supabase/supabase-js';

// Run the actual public loader, filters, pagination and serializers. Replace
// module imports only: no Supabase initialization or real transport/account.
const source = (await readFile(new URL('../src/services/annotationCloudSync.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
function loader(client) {
  const dependencies = { supabase: client, collectKeysetRows, ...serializers, ...markerTypes };
  return new Function(...Object.keys(dependencies), `${source}\nreturn loadAllNonSurveyMarkerAnnotations;`)(...Object.values(dependencies));
}
function deferred() { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const tick = () => new Promise(setImmediate);
const session = actor => actor ? { user: { id: actor }, access_token: `test-token-${actor}` } : null;
function row(actor, id = 1) {
  return { id, user_id: actor, annotation_id: `mark-${id}`, annotation_type: 'ink', page_number: 1,
    annotation_data: { fabricObject: { type: 'path', data: { id: `mark-${id}` } } } };
}
function clientFixture(actor = 'a') {
  let currentSession = session(actor);
  const listeners = [];
  const calls = [];
  const client = {
    sessionRead: null, queryRead: null,
    auth: {
      getSession: () => client.sessionRead?.() ?? Promise.resolve({ data: { session: currentSession }, error: null }),
      onAuthStateChange: callback => { listeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) {
      const call = { table, headers: {}, filters: [] }; calls.push(call);
      const query = {
        select(columns) { call.columns = columns; return query; }, eq(...args) { call.filters.push(args); return query; },
        order(...args) { call.order = args; return query; }, limit(size) { call.limit = size; return query; },
        gt(...args) { call.cursor = args; return query; }, or(filter) { call.or = filter; return query; },
        setHeader(name, value) { call.headers[name] = value; return query; },
        abortSignal(signal) { call.signal = signal; return query; },
        then(resolve, reject) {
          const payload = client.queryRead?.(call) ?? { data: [row(currentSession?.user?.id)], error: null };
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client, calls, listeners, emit(event, actorId, token) {
    currentSession = session(actorId);
    if (currentSession && token) currentSession.access_token = token;
    for (const fn of listeners) fn(event, currentSession);
  } };
}
function failed(result) { assert.ok(result.error); assert.deepEqual(result.annotationsByPage, {}); assert.deepEqual(result.callouts, []); assert.equal(result.rawRows, undefined); }

test('same actor/generation coalesces a paged read; later refresh reads again', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const a = load('doc', { actorUserId: 'a' }); const b = load('doc', { actorUserId: 'a' });
  await tick(); assert.equal(f.calls.length, 1); assert.equal(f.listeners.length, 1);
  gate.resolve({ data: [row('a')], error: null });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.error, null); assert.equal(first, second); assert.equal(first.rawRows[0].user_id, 'a');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer test-token-a');
  assert.ok(first.annotationsByPage[1]);
  await load('doc', { actorUserId: 'a' }); assert.equal(f.calls.length, 2); assert.equal(f.listeners.length, 1);
});

test('account switch never shares or delivers the old actor rows', async () => {
  const f = clientFixture(); const load = loader(f.client); const old = deferred();
  f.client.queryRead = call => call.headers.Authorization === 'Bearer test-token-b'
    ? { data: [row('b')], error: null } : old.promise;
  const a = load('doc', { actorUserId: 'a' }); await tick(); f.emit('SIGNED_IN', 'b');
  const b = await load('doc', { actorUserId: 'b' });
  old.resolve({ data: [row('a')], error: null }); failed(await a);
  assert.equal(b.rawRows[0].user_id, 'b'); assert.equal(f.calls.length, 2); assert.equal(f.calls[0].signal.aborted, true);
});

test('signout and same-actor return creates a new generation; old cleanup cannot erase new flight', async () => {
  const f = clientFixture(); const load = loader(f.client); const old = deferred(); const fresh = deferred();
  f.client.queryRead = () => f.calls.length === 1 ? old.promise : fresh.promise;
  const a = load('doc'); await tick(); f.emit('SIGNED_OUT', null); f.emit('SIGNED_IN', 'a');
  const b = load('doc'); await tick(); old.resolve({ data: [row('a', 1)], error: null }); failed(await a);
  const c = load('doc'); await tick(); assert.equal(f.calls.length, 2);
  fresh.resolve({ data: [row('a', 2)], error: null }); assert.equal((await b).rawRows[0].id, 2); assert.equal((await c).rawRows[0].id, 2);
});

test('null session and wrong expected actor fail closed without a row request', async () => {
  const f = clientFixture(null); const load = loader(f.client);
  failed(await load('doc')); f.emit('SIGNED_IN', 'b'); failed(await load('doc', { actorUserId: 'a' }));
  assert.equal(f.calls.length, 0);
});

test('old getSession resolution after auth retirement cannot dispatch', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.sessionRead = () => gate.promise;
  const pending = load('doc', { actorUserId: 'a' }); f.emit('SIGNED_OUT', null); f.emit('SIGNED_IN', 'a');
  gate.resolve({ data: { session: session('a') }, error: null }); failed(await pending); assert.equal(f.calls.length, 0);
});

test('auth retirement after a full page prevents the next page and partial success', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const pending = load('doc'); await tick(); f.emit('SIGNED_OUT', null);
  gate.resolve({ data: Array.from({ length: 1000 }, (_, i) => row('a', i + 1)), error: null });
  failed(await pending); assert.equal(f.calls.length, 1);
});

test('each page is request-bound and keeps the existing keyset/filter contract', async () => {
  const f = clientFixture(); const load = loader(f.client);
  f.client.queryRead = call => ({ data: call.cursor ? [row('a', 1001)] : Array.from({ length: 1000 }, (_, i) => row('a', i + 1)), error: null });
  const result = await load('doc'); assert.equal(result.rawRows.length, 1001); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].cursor, ['id', 1000]);
  for (const call of f.calls) {
    assert.equal(call.headers.Authorization, 'Bearer test-token-a'); assert.equal(call.limit, 1000);
    assert.deepEqual(call.filters, [['document_id', 'doc']]); assert.match(call.or, /annotation_type\.in/);
  }
});

test('one retired consumer cannot cancel a second live consumer', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); const controller = new AbortController();
  f.client.queryRead = () => gate.promise;
  const a = load('doc', { signal: controller.signal }); const b = load('doc'); await tick(); controller.abort();
  assert.equal(f.calls[0].signal.aborted, false); gate.resolve({ data: [row('a')], error: null });
  failed(await a); assert.equal((await b).error, null); assert.equal(f.calls.length, 1);
});

test('all retired consumers abort the flight and a new caller starts fresh', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); const controller = new AbortController();
  f.client.queryRead = () => gate.promise;
  const a = load('doc', { signal: controller.signal }); await tick(); controller.abort();
  assert.equal(f.calls[0].signal.aborted, true);
  const b = load('doc'); await tick(); assert.equal(f.calls.length, 2);
  gate.resolve({ data: [row('a')], error: null }); failed(await a); assert.equal((await b).error, null);
});

test('caller guard is checked both before session work and at completion', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); let current = true;
  failed(await load('doc', { isCurrent: () => false })); assert.equal(f.calls.length, 0);
  f.client.queryRead = () => gate.promise;
  const pending = load('doc', { isCurrent: () => current }); await tick(); current = false;
  gate.resolve({ data: [row('a')], error: null }); failed(await pending);
});

test('same actor token refresh and matching initial session do not invalidate a read', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const pending = load('doc'); await tick(); f.emit('INITIAL_SESSION', 'a'); f.emit('TOKEN_REFRESHED', 'a');
  gate.resolve({ data: [row('a')], error: null }); assert.equal((await pending).error, null); assert.equal(f.calls.length, 1);
});

test('separate clients do not share rows, even with the same actor/doc', async () => {
  const f = clientFixture(); const g = clientFixture(); const load = loader(f.client);
  await Promise.all([load('doc'), load('doc', { supabase: g.client })]);
  assert.equal(f.calls.length, 1); assert.equal(g.calls.length, 1);
});

test('failed page clears the flight; later caller can retry with no partial rows', async () => {
  const f = clientFixture(); const load = loader(f.client);
  f.client.queryRead = () => ({ data: null, error: new Error('offline fixture') }); failed(await load('doc'));
  f.client.queryRead = null; assert.equal((await load('doc')).error, null); assert.equal(f.calls.length, 2);
});

test('installed Supabase SDK preserves the captured JWT while its token lookup switches actor', async () => {
  const f = clientFixture(); const tokenGate = deferred(); const dispatched = [];
  const sdk = createClient('https://offline-fixture.invalid', 'offline-fixture-not-a-key', {
    accessToken: () => tokenGate.promise,
    global: { fetch: async (url, init) => {
      dispatched.push({ url: String(url), headers: new Headers(init.headers), signal: init.signal });
      return new Response(JSON.stringify([row('a')]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  // Actual SDK query construction and fetchWithAuth, fake external auth/HTTP.
  const load = loader({ auth: f.client.auth, from: sdk.from.bind(sdk) });
  const pending = load('doc', { actorUserId: 'a' }); await tick();
  f.emit('SIGNED_IN', 'b'); tokenGate.resolve('test-token-b');
  failed(await pending);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].headers.get('Authorization'), 'Bearer test-token-a');
  assert.equal(dispatched[0].signal.aborted, true);
  assert.match(dispatched[0].url, /document_id=eq.doc/);
});

test('retirement while a later page waits never delivers the first page as success', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = call => call.cursor ? gate.promise
    : { data: Array.from({ length: 1000 }, (_, i) => row('a', i + 1)), error: null };
  const pending = load('doc'); await tick(); assert.equal(f.calls.length, 2);
  f.emit('SIGNED_OUT', null); gate.resolve({ data: [row('a', 1001)], error: null });
  failed(await pending); assert.equal(f.calls.length, 2);
});

test('a page failure after earlier rows does not expose partial backfill input', async () => {
  const f = clientFixture(); const load = loader(f.client);
  f.client.queryRead = call => call.cursor ? { data: null, error: new Error('second page failed') }
    : { data: Array.from({ length: 1000 }, (_, i) => row('a', i + 1)), error: null };
  failed(await load('doc')); assert.equal(f.calls.length, 2);
});

test('repeated SIGNED_IN for the same session does not restart a good read', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const a = load('doc'); await tick(); f.emit('SIGNED_IN', 'a'); f.emit('SIGNED_IN', 'a');
  const b = load('doc'); await tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].signal.aborted, false);
  gate.resolve({ data: [row('a')], error: null }); assert.equal((await a).error, null); assert.equal((await b).error, null);
});

test('TOKEN_REFRESHED updates observed session without replacing the read JWT or retiring it', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const a = load('doc'); await tick();
  f.emit('TOKEN_REFRESHED', 'a', 'test-refreshed-token'); f.emit('SIGNED_IN', 'a', 'test-refreshed-token');
  const b = load('doc'); await tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer test-token-a');
  gate.resolve({ data: [row('a')], error: null }); assert.equal((await a).error, null); assert.equal((await b).error, null);
});

test('same actor SIGNED_IN with a new session token retires the prior read', async () => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred();
  f.client.queryRead = () => gate.promise;
  const a = load('doc'); await tick(); f.emit('SIGNED_IN', 'a', 'test-new-login-token');
  const b = load('doc'); await tick(); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls[1].headers.Authorization, 'Bearer test-new-login-token');
  gate.resolve({ data: [row('a')], error: null }); failed(await a); assert.equal((await b).error, null);
});

test('consumer abort settles before held auth resolves and observes its later rejection', async t => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); const controller = new AbortController();
  t.after(() => gate.resolve({ data: { session: session('a') }, error: null }));
  f.client.sessionRead = () => gate.promise;
  let result;
  const pending = load('doc', { signal: controller.signal }).then(value => { result = value; });
  await tick(); controller.abort(); await tick();
  assert.ok(result, 'aborted consumer must settle without waiting for auth'); failed(result);
  assert.equal(f.calls.length, 0);
  gate.reject(new Error('late auth failure')); await pending; await tick();
  assert.equal(f.calls.length, 0);
});

test('consumer abort settles before held shared query while other consumer stays live', async t => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); const controller = new AbortController();
  t.after(() => gate.resolve({ data: [row('a')], error: null }));
  f.client.queryRead = () => gate.promise;
  let abortedResult; let liveResult;
  const a = load('doc', { signal: controller.signal }).then(value => { abortedResult = value; });
  const b = load('doc').then(value => { liveResult = value; });
  await tick(); controller.abort(); await tick();
  assert.ok(abortedResult, 'retired consumer must not wait for another consumer'); failed(abortedResult);
  assert.equal(liveResult, undefined); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, false);
  gate.resolve({ data: [row('a')], error: null }); await Promise.all([a, b]);
  assert.equal(liveResult.error, null); assert.equal(liveResult.rawRows[0].user_id, 'a');
});

test('last consumer abort settles before held query and observes its later rejection', async t => {
  const f = clientFixture(); const load = loader(f.client); const gate = deferred(); const controller = new AbortController();
  t.after(() => gate.resolve({ data: [row('a')], error: null }));
  f.client.queryRead = () => gate.promise;
  let result;
  const pending = load('doc', { signal: controller.signal }).then(value => { result = value; });
  await tick(); controller.abort(); await tick();
  assert.ok(result, 'last consumer must settle without waiting for transport'); failed(result);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.reject(new Error('late transport failure')); await pending; await tick();
});
