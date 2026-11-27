// Survey Nightly: its own name in the tab, and only admins and listed testers
// may use it (src/nightlyBrand.js, src/nightlyGate.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { nightlyTitle } from '../src/nightlyBrand.js';
import { checkNightlyAccess, signOutFromNightlyGate } from '../src/nightlyGate.js';

test('nightly: the tab says Survey Nightly', () => {
  assert.equal(nightlyTitle('Survey'), 'Survey Nightly');
  assert.equal(nightlyTitle(''), 'Survey Nightly');
  assert.equal(nightlyTitle('Plan A-201 | Survey'), 'Plan A-201 | Survey Nightly');
  assert.equal(nightlyTitle('Survey Nightly'), 'Survey Nightly');
  assert.equal(nightlyTitle('Flags'), 'Flags · Survey Nightly');
});

test('nightly: only people the database lets in, and a failed check fails closed (#1599)', async () => {
  const rpc = (answer) => ({ rpc: async (name) => { assert.equal(name, 'can_use_nightly'); return answer; } });
  const session = { user: { id: 'u1' } };
  assert.equal(await checkNightlyAccess(rpc({ data: true, error: null }), session), true);
  assert.equal(await checkNightlyAccess(rpc({ data: false, error: null }), session), false);
  assert.equal(await checkNightlyAccess(rpc({ data: null, error: null }), session), false);
  assert.equal(await checkNightlyAccess(rpc({ data: null, error: { message: 'no such function' } }), session), false);
  assert.equal(await checkNightlyAccess({ rpc: async () => { throw new Error('offline'); } }, session), false);
  assert.equal(await checkNightlyAccess(rpc({ data: false, error: null }), null), true, 'signed out: the sign-in screen shows');
});

test('nightly gate Sign out uses local scope and clears persisted auth tokens even on error', async () => {
  const calls = [];
  const store = new Map([
    ['sb-project-auth-token', '{"access_token":"x"}'],
    ['survey-theme', 'dark'],
  ]);
  const storage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    removeItem(k) { store.delete(k); },
  };
  await signOutFromNightlyGate({
    auth: {
      async signOut(opts) {
        calls.push(opts);
        throw new Error('504 timeout');
      },
    },
  }, storage);
  assert.deepEqual(calls[0], { scope: 'local' });
  assert.equal(store.has('sb-project-auth-token'), false);
  assert.equal(store.has('survey-theme'), true);
});
