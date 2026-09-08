import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { attachLegacyYDocSession } from '../src/lib/collab/legacyYDocSession.js';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeClient(initialEvent) {
  const listeners = new Set();
  const tokens = [];
  return {
    listeners, tokens,
    auth: { onAuthStateChange(callback) {
      listeners.add(callback);
      initialEvent?.(callback);
      return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
    } },
    realtime: { setAuth(token) { tokens.push(token); } },
  };
}

function attach(t, { ydoc, client = makeClient(), getSession, factory, close } = {}) {
  const doc = ydoc || new Y.Doc({ guid: getLegacyYDocScopeKey('doc', 'actor-a') });
  if (!ydoc) t.after(() => doc.destroy());
  const events = [];
  let localCallbacks, transportCallbacks;
  let disconnected = 0;
  const handle = attachLegacyYDocSession({
    ydoc: doc, documentId: 'doc', actorUserId: 'actor-a', supabase: client,
    getSession: getSession || (async () => ({ user: { id: 'actor-a' } })),
    createTransportProvider(options) {
      transportCallbacks = options;
      events.push(['factory']);
      return factory ? factory(options) : { disconnect() { disconnected++; } };
    },
    attachLocalLifecycle(_doc, _id, options) {
      localCallbacks = options;
      events.push(['local']);
      return { role: () => 'leader', detach() { events.push(['close']); return close?.(); } };
    },
    onRetired: state => events.push(['retired', state]),
    onStorageState: state => events.push(['storage', state]),
    onRoleChange: state => events.push(['role', state]),
    onTransportState: state => events.push(['transport', state]),
    onUpdateRejected: state => events.push(['rejected', state]),
  });
  t.after(() => handle.detach());
  return { handle, ydoc: doc, client, events,
    get localCallbacks() { return localCallbacks; },
    get transportCallbacks() { return transportCallbacks; },
    get disconnected() { return disconnected; },
  };
}

test('synchronous initial retirement unsubscribes without attaching local or transport resources', async t => {
  const client = makeClient(callback => callback('INITIAL_SESSION', null));
  const s = attach(t, { client });
  assert.equal(s.handle.isCurrent(), false);
  assert.equal(s.handle.signal.aborted, true);
  assert.equal(client.listeners.size, 0);
  assert.equal(await s.handle.restartTransport(), null);
  assert.deepEqual(s.events.map(([kind]) => kind), ['retired']);
  assert.equal(s.events[0][1].localStateRetained, true);
});

test('document destruction during identity lookup prevents transport construction', async t => {
  const pending = deferred();
  const s = attach(t, { getSession: () => pending.promise });
  const attempt = s.handle.restartTransport();
  s.ydoc.destroy();
  assert.equal(s.handle.isCurrent(), false);
  assert.equal(s.handle.signal.aborted, true);
  pending.resolve({ user: { id: 'actor-a' } });
  assert.equal(await attempt, null);
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.handle.getProvider(), null);
  assert.equal(s.events.some(([kind]) => kind === 'factory'), false);
  assert.equal(s.events.find(([kind]) => kind === 'retired')[1].localStateRetained, false);
});

test('document destruction during provider construction disconnects the late candidate', async t => {
  const pending = deferred();
  const started = deferred();
  let disconnected = 0;
  const s = attach(t, { factory: () => { started.resolve(); return pending.promise; } });
  const attempt = s.handle.restartTransport();
  await started.promise;
  s.ydoc.destroy();
  const eventCount = s.events.length;
  s.transportCallbacks.onTransportState('online');
  s.transportCallbacks.onUpdateRejected('late-rejection');
  assert.equal(s.events.length, eventCount);
  pending.resolve({ disconnect() { disconnected++; } });
  assert.equal(await attempt, null);
  assert.equal(disconnected, 1);
  assert.equal(s.handle.getProvider(), null);
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.events.find(([kind]) => kind === 'retired')[1].localStateRetained, false);
});

test('same-doc and same-client remount stays active while the old local close is pending', async t => {
  const closing = deferred();
  t.after(() => closing.resolve());
  const sharedDoc = new Y.Doc({ guid: getLegacyYDocScopeKey('doc', 'actor-a') });
  t.after(() => sharedDoc.destroy());
  const sharedClient = makeClient();
  const old = attach(t, { ydoc: sharedDoc, client: sharedClient, close: () => closing.promise });
  await old.handle.restartTransport();
  const oldAuthCallback = [...sharedClient.listeners][0];
  const closeTask = old.handle.detach();
  const fresh = attach(t, { ydoc: sharedDoc, client: sharedClient });
  const freshProvider = await fresh.handle.restartTransport();
  assert.strictEqual(old.ydoc, fresh.ydoc);
  assert.strictEqual(old.client, fresh.client);
  assert.equal(sharedClient.listeners.size, 1);
  const oldEventCount = old.events.length;
  const freshEventCount = fresh.events.length;
  old.localCallbacks.onRoleChange('leader');
  old.localCallbacks.onStorageState('late-storage');
  old.transportCallbacks.onTransportState('online');
  old.transportCallbacks.onUpdateRejected('late-rejection');
  oldAuthCallback('TOKEN_REFRESHED', { user: { id: 'actor-a' }, access_token: 'local-test-token' });
  assert.equal(old.events.length, oldEventCount);
  assert.equal(fresh.events.length, freshEventCount);
  assert.deepEqual(sharedClient.tokens, []);
  closing.resolve();
  await closeTask;
  assert.equal(old.handle.isCurrent(), false);
  assert.equal(fresh.handle.isCurrent(), true);
  assert.strictEqual(fresh.handle.getProvider(), freshProvider);
  assert.equal(fresh.disconnected, 0);
  assert.equal(await old.handle.restartTransport(), null);
  assert.equal(sharedDoc.isDestroyed, false);
});

test('concurrent restart calls share one identity lookup and provider attempt', async t => {
  const pending = deferred();
  let lookups = 0;
  const s = attach(t, { getSession: () => { lookups++; return pending.promise; } });
  const first = s.handle.restartTransport();
  const second = s.handle.restartTransport();
  assert.strictEqual(first, second);
  assert.equal(lookups, 1);
  pending.resolve({ user: { id: 'actor-a' } });
  assert.strictEqual(await first, await second);
  assert.equal(s.events.filter(([kind]) => kind === 'factory').length, 1);
});

test('a rejected provider factory after detach cannot restore transport or emit failure state', async t => {
  const pending = deferred();
  const started = deferred();
  const s = attach(t, { factory: () => { started.resolve(); return pending.promise; } });
  const attempt = s.handle.restartTransport();
  await started.promise;
  await s.handle.detach();
  const eventCount = s.events.length;
  pending.reject(new Error('stale factory failure'));
  assert.equal(await attempt, null);
  assert.equal(s.events.length, eventCount);
  assert.equal(s.handle.getProvider(), null);
  assert.equal(s.handle.isCurrent(), false);
});
