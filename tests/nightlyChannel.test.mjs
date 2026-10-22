// Survey Nightly: its own name in the tab, and only admins and listed testers
// may use it (src/nightlyBrand.js, src/nightlyGate.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { nightlyTitle } from '../src/nightlyBrand.js';
import { checkNightlyAccess } from '../src/nightlyGate.js';

test('nightly: the tab says Survey Nightly', () => {
  assert.equal(nightlyTitle('Survey'), 'Survey Nightly');
  assert.equal(nightlyTitle(''), 'Survey Nightly');
  assert.equal(nightlyTitle('Plan A-201 | Survey'), 'Plan A-201 | Survey Nightly');
  assert.equal(nightlyTitle('Survey Nightly'), 'Survey Nightly');
  assert.equal(nightlyTitle('Flags'), 'Flags · Survey Nightly');
});

test('nightly: only people the database lets in, and a failed check never locks anyone out', async () => {
  const rpc = (answer) => ({ rpc: async (name) => { assert.equal(name, 'can_use_nightly'); return answer; } });
  const session = { user: { id: 'u1' } };
  assert.equal(await checkNightlyAccess(rpc({ data: true, error: null }), session), true);
  assert.equal(await checkNightlyAccess(rpc({ data: false, error: null }), session), false);
  assert.equal(await checkNightlyAccess(rpc({ data: null, error: { message: 'no such function' } }), session), true);
  assert.equal(await checkNightlyAccess({ rpc: async () => { throw new Error('offline'); } }, session), true);
  assert.equal(await checkNightlyAccess(rpc({ data: false, error: null }), null), true, 'signed out: the sign-in screen shows');
});
