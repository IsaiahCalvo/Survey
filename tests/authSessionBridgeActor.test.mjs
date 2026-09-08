import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAuthSessionBridge } from '../src/lib/collab/authSessionBridge.js';

function client() {
  let callback;
  const tokens = [];
  let unsubscribed = 0;
  return {
    supabase: {
      auth: { onAuthStateChange(fn) {
        callback = fn;
        return { data: { subscription: { unsubscribe() { unsubscribed++; } } } };
      } },
      realtime: { setAuth(token) { tokens.push(token); } },
    },
    emit: (event, session) => callback(event, session),
    tokens,
    get unsubscribed() { return unsubscribed; },
  };
}

test('a changed actor retires the old bridge before any token can reach its work', () => {
  const c = client();
  const retired = [];
  const bridge = attachAuthSessionBridge({
    supabase: c.supabase, expectedUserId: 'actor-a',
    onActorChanged: (state) => retired.push({ ...state, current: bridge.isCurrentActor() }),
  });
  c.emit('INITIAL_SESSION', { user: { id: 'actor-a' }, access_token: 'a-initial' });
  c.emit('TOKEN_REFRESHED', { user: { id: 'actor-a' }, access_token: 'a-refresh' });
  assert.deepEqual(c.tokens, ['a-refresh']);
  c.emit('TOKEN_REFRESHED', { user: { id: 'actor-b' }, access_token: 'b-refresh' });
  assert.equal(bridge.isCurrentActor(), false);
  assert.equal(bridge.signal.aborted, true);
  assert.deepEqual(retired, [{ previousUserId: 'actor-a', userId: 'actor-b', event: 'TOKEN_REFRESHED', current: false }]);
  c.emit('SIGNED_IN', { user: { id: 'actor-a' }, access_token: 'a-returned' });
  c.emit('TOKEN_REFRESHED', { user: { id: 'actor-a' }, access_token: 'a-late' });
  assert.equal(bridge.isCurrentActor(), false, 'returning to A cannot revive an old generation');
  assert.deepEqual(c.tokens, ['a-refresh']);
  bridge.detach();
  bridge.detach();
  assert.equal(c.unsubscribed, 1);
});

test('sign out and unresolved initial identity abort pending actor work without a refresh loop', () => {
  for (const event of ['SIGNED_OUT', 'INITIAL_SESSION']) {
    const c = client();
    let changed = 0;
    let signedOut = 0;
    const bridge = attachAuthSessionBridge({
      supabase: c.supabase, expectedUserId: 'actor-a',
      onActorChanged: () => changed++, onSignedOut: () => signedOut++,
    });
    c.emit(event, null);
    assert.equal(changed, 1);
    assert.equal(signedOut, event === 'SIGNED_OUT' ? 1 : 0);
    assert.equal(bridge.signal.aborted, true);
    assert.deepEqual(c.tokens, []);
    bridge.detach();
  }
});

test('same actor session events stay current; detaching rejects even queued auth delivery', () => {
  const c = client();
  const bridge = attachAuthSessionBridge({ supabase: c.supabase, expectedUserId: 'actor-a' });
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED', 'PASSWORD_RECOVERY']) {
    c.emit(event, { user: { id: 'actor-a' } });
    assert.equal(bridge.isCurrentActor(), true);
  }
  bridge.detach();
  c.emit('TOKEN_REFRESHED', { user: { id: 'actor-a' }, access_token: 'late' });
  assert.equal(bridge.isCurrentActor(), false);
  assert.deepEqual(c.tokens, []);
});

test('an explicitly unresolved actor cannot create an actor-bound bridge', () => {
  for (const expectedUserId of ['', '   ', null, 0]) {
    assert.throws(() => attachAuthSessionBridge({ supabase: client().supabase, expectedUserId }), /expectedUserId/);
  }
});

test('a synchronous initial auth callback failure still returns a detachable subscription', () => {
  let unsubscribed = 0;
  const errors = [];
  const bridge = attachAuthSessionBridge({
    supabase: {
      auth: { onAuthStateChange(callback) {
        callback('INITIAL_SESSION', null);
        return { data: { subscription: { unsubscribe() { unsubscribed++; } } } };
      } }, realtime: { setAuth() {} },
    }, expectedUserId: 'a',
    onActorChanged: () => { throw new Error('view callback failed'); },
    onError: error => errors.push(error.message),
  });
  assert.equal(bridge.isCurrentActor(), false);
  assert.deepEqual(errors, ['view callback failed']);
  bridge.detach();
  assert.equal(unsubscribed, 1);
});

test('sync and async token-forward failures are handled without an unhandled rejection', async () => {
  for (const asyncFailure of [false, true]) {
    const c = client();
    const errors = [];
    c.supabase.realtime.setAuth = () => {
      if (asyncFailure) return Promise.reject(new Error('token forwarding failed'));
      throw new Error('token forwarding failed');
    };
    const bridge = attachAuthSessionBridge({ supabase: c.supabase, expectedUserId: 'a',
      onError: error => errors.push(error.message) });
    c.emit('TOKEN_REFRESHED', { user: { id: 'a' }, access_token: 'token' });
    await Promise.resolve();
    assert.deepEqual(errors, ['token forwarding failed']);
    bridge.detach();
  }
});

test('a late rejected token update cannot notify an already detached view', async () => {
  const c = client();
  let rejectToken, errors = 0;
  c.supabase.realtime.setAuth = () => new Promise((_resolve, reject) => { rejectToken = reject; });
  const bridge = attachAuthSessionBridge({ supabase: c.supabase, onError: () => errors++ });
  c.emit('TOKEN_REFRESHED', { access_token: 'token' });
  bridge.detach();
  rejectToken(new Error('late rejection'));
  await Promise.resolve();
  assert.equal(errors, 0);
});
