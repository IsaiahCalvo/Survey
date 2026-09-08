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
function setup(t, overrides = {}) {
  const events = [];
  let authCallback, lifeOptions, transportOptions;
  let unsubscribed = 0, disconnected = 0, localClosed = 0;
  const ydoc = new Y.Doc({ guid: getLegacyYDocScopeKey('doc', 'a') });
  t.after(() => ydoc.destroy());
  const state = {
    ydoc, documentId: 'doc', actorUserId: 'a',
    supabase: {
      auth: { onAuthStateChange(callback) {
        events.push('auth-attached'); authCallback = callback;
        overrides.initialEvent?.(callback);
        return { data: { subscription: { unsubscribe() { unsubscribed++; } } } };
      } },
      realtime: { setAuth(token) { events.push(['token', token]); } },
    },
    getSession: async () => ({ user: { id: 'a' } }),
    createTransportProvider: (options) => {
      transportOptions = options;
      events.push('transport-created');
      return { disconnect() { disconnected++; } };
    },
    attachLocalLifecycle: (_doc, _id, options) => {
      lifeOptions = options;
      events.push('local-attached');
      return { role: () => 'leader', detach() { localClosed++; return Promise.resolve(); } };
    },
    onStorageState: state => events.push(['storage', state]),
    onTransportState: state => events.push(['transport', state]),
    onUpdateRejected: reason => events.push(['rejected', reason]),
    onRoleChange: role => events.push(['role', role]),
    onRetired: state => events.push(['retired', state]),
    ...overrides,
  };
  const handle = attachLegacyYDocSession(state);
  t.after(async () => {
    try { await handle.detach(); }
    catch (error) { if (!overrides.expectedCloseFailure) throw error; }
  });
  return { handle, ydoc, state, events,
    emit: (event, session) => authCallback(event, session),
    get lifeOptions() { return lifeOptions; },
    get transportOptions() { return transportOptions; },
    get counts() { return { unsubscribed, disconnected, localClosed }; },
  };
}

test('actor bridge precedes local attachment; network waits for exact session identity', async t => {
  const pending = deferred();
  const s = setup(t, { getSession: () => pending.promise });
  const attempt = s.handle.restartTransport();
  assert.deepEqual(s.events, ['auth-attached', 'local-attached']);
  assert.equal(s.lifeOptions.actorUserId, 'a');
  pending.resolve({ user: { id: 'a' } });
  const provider = await attempt;
  assert.equal(s.handle.getProvider(), provider);
  assert.equal(s.handle.role(), 'leader');
  assert.equal(s.transportOptions.documentId, 'doc', 'cloud document identity is unchanged');
});

test('actor change during auth lookup never creates a transport or forwards another actor token', async t => {
  const pending = deferred();
  const s = setup(t, { getSession: () => pending.promise });
  s.ydoc.getMap('annotations').set('pending-local', 'preserved');
  const attempt = s.handle.restartTransport();
  s.emit('TOKEN_REFRESHED', { user: { id: 'b' }, access_token: 'b-token' });
  assert.equal(s.handle.isCurrent(), false);
  assert.equal(s.handle.signal.aborted, true);
  assert.deepEqual(s.counts, { unsubscribed: 1, disconnected: 0, localClosed: 1 });
  pending.resolve({ user: { id: 'a' } });
  assert.equal(await attempt, null);
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.ydoc.getMap('annotations').get('pending-local'), 'preserved');
  assert.ok(!s.events.some(e => e === 'transport-created' || e[0] === 'token'));
});

test('a late provider candidate is disconnected and its callbacks cannot revive a retired actor', async t => {
  const pending = deferred();
  let callbacks;
  let candidateClosed = 0;
  const s = setup(t, { createTransportProvider: options => { callbacks = options; return pending.promise; } });
  const attempt = s.handle.restartTransport();
  await Promise.resolve();
  assert.ok(callbacks);
  s.emit('SIGNED_IN', { user: { id: 'b' } });
  callbacks.onTransportState('online'); callbacks.onUpdateRejected('permission_revoked');
  s.lifeOptions.onRoleChange('leader'); s.lifeOptions.onStorageState({ code: 'ok' });
  pending.resolve({ disconnect() { candidateClosed++; } });
  assert.equal(await attempt, null);
  assert.equal(candidateClosed, 1);
  assert.equal(s.handle.getProvider(), null);
  assert.equal(callbacks.isCurrent(), false);
  assert.ok(!s.events.some(e => Array.isArray(e) && ['transport', 'rejected', 'role', 'storage'].includes(e[0])));
});

test('session identity mismatch retires before transport construction without an auth event', async t => {
  const s = setup(t, { getSession: async () => ({ user: { id: 'b' } }) });
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.handle.isCurrent(), false);
  assert.ok(!s.events.includes('transport-created'));
  assert.equal(s.events.find(e => e[0] === 'retired')[1].event, 'SESSION_CHECK');
});

test('a synchronous initial mismatch attaches neither local nor network resources', async t => {
  const s = setup(t, { initialEvent: callback => callback('INITIAL_SESSION', null) });
  assert.equal(s.handle.isCurrent(), false);
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.lifeOptions, undefined);
  assert.equal(s.counts.unsubscribed, 1);
});

test('offline session lookup failure preserves local work and allows a bounded later retry', async t => {
  let tries = 0;
  const s = setup(t, { getSession: async () => {
    if (++tries === 1) throw new Error('offline');
    return { user: { id: 'a' } };
  } });
  await assert.rejects(s.handle.restartTransport(), /offline/);
  assert.equal(s.handle.isCurrent(), true);
  assert.equal(s.counts.localClosed, 0);
  assert.ok(await s.handle.restartTransport());
  assert.equal(tries, 2);
  await s.handle.detach(); await s.handle.detach();
  assert.deepEqual(s.counts, { unsubscribed: 1, disconnected: 1, localClosed: 1 });
});

test('an old generation stays stopped even when the same actor mounts again', async t => {
  const old = setup(t);
  await old.handle.restartTransport();
  await old.handle.detach();
  const fresh = setup(t);
  await fresh.handle.restartTransport();
  assert.equal(old.handle.isCurrent(), false);
  assert.equal(fresh.handle.isCurrent(), true);
  old.emit('TOKEN_REFRESHED', { user: { id: 'a' }, access_token: 'late-a' });
  assert.equal(await old.handle.restartTransport(), null);
  assert.ok(!old.events.some(e => e[0] === 'token'));
});

test('a raw legacy document cannot be relabeled as an actor-scoped session', t => {
  const ydoc = new Y.Doc({ guid: 'doc' });
  t.after(() => ydoc.destroy());
  assert.throws(() => attachLegacyYDocSession({
    ydoc, documentId: 'doc', actorUserId: 'a', getSession() {}, createTransportProvider() {},
  }), /does not match/);
});

test('local close failures do not leave auth subscribed or suppress the retirement state', async t => {
  for (const asyncFailure of [false, true]) {
    const failure = new Error('close failed');
    const s = setup(t, { expectedCloseFailure: true, attachLocalLifecycle: () => ({
      role: () => 'leader', detach() {
        if (asyncFailure) return Promise.reject(failure);
        throw failure;
      },
    }) });
    s.emit('SIGNED_IN', { user: { id: 'b' } });
    assert.equal(s.handle.isCurrent(), false);
    assert.equal(s.counts.unsubscribed, 1);
    assert.equal(s.events.filter(e => e[0] === 'retired').length, 1);
    await assert.rejects(s.handle.detach(), /close failed/);
  }
});

test('destroying the document stops active transport and prevents restart', async t => {
  const s = setup(t);
  await s.handle.restartTransport();
  s.ydoc.destroy();
  assert.equal(s.handle.isCurrent(), false);
  assert.equal(s.handle.signal.aborted, true);
  assert.equal(s.counts.disconnected, 1);
  assert.equal(s.counts.unsubscribed, 1);
  assert.equal(await s.handle.restartTransport(), null);
  assert.equal(s.events.find(e => e[0] === 'retired')[1].event, 'DOCUMENT_DESTROYED');
});

test('a previously destroyed doc is rejected before auth or local resources attach', t => {
  const ydoc = new Y.Doc({ guid: getLegacyYDocScopeKey('doc', 'a') });
  ydoc.destroy();
  assert.throws(() => attachLegacyYDocSession({
    ydoc, documentId: 'doc', actorUserId: 'a', getSession() {}, createTransportProvider() {},
  }), /destroyed/);
});
