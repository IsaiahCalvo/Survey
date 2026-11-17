// KAL-649: who is asked to finish their account on the invite page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishAccountError, needsAccountFinish } from '../src/home/finishAccount.js';

const invited = { invited_at: '2026-11-16T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} };

test('finish account: a person signed in by an invite email with no Terms tick is asked', () => {
  assert.equal(needsAccountFinish(invited), true);
});

test('finish account: nobody else is asked', () => {
  assert.equal(needsAccountFinish(null), false);
  assert.equal(needsAccountFinish({ ...invited, invited_at: null }), false);
  assert.equal(needsAccountFinish({ ...invited, is_anonymous: true }), false);
  assert.equal(needsAccountFinish({ ...invited, app_metadata: { provider: 'email', providers: ['email', 'google'] } }), false);
  assert.equal(needsAccountFinish({ ...invited, user_metadata: { terms_accepted: { terms: '2026-11-02' } } }), false);
});

test('finish account: names and the Terms tick are required', () => {
  assert.match(finishAccountError({ firstName: ' ', lastName: 'B', agreed: true }), /first and last name/);
  assert.match(finishAccountError({ firstName: 'A', lastName: 'B', agreed: false }), /Terms of Service/);
  assert.equal(finishAccountError({ firstName: 'A', lastName: 'B', agreed: true }), null);
});
