// Share dialog: owner showed "Unknown", rows printed raw user ids, emails cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberIdentity } from '../src/home/accessRows.js';

test('owner row without email uses the owner profile', () => {
  const r = memberIdentity({ user_id: 'u1', role: 'owner' }, { owner: { user_id: 'u1', name: 'Dana Smith', email: 'dana@x.com' } });
  assert.deepEqual(r, { primary: 'Dana Smith', secondary: 'dana@x.com', title: 'Dana Smith · dana@x.com' });
});

test('signed-in user fills their own row', () => {
  const r = memberIdentity({ user_id: 'me', role: 'owner' }, { currentUser: { id: 'me', email: 'me@x.com', user_metadata: {} } });
  assert.equal(r.primary, 'me@x.com');
});

test('never shows a raw user id or "Unknown"', () => {
  const id = '3f2a9c1e-0000-4000-8000-000000000000';
  for (const role of ['owner', 'editor']) {
    const r = memberIdentity({ user_id: id, role }, { owner: null });
    assert.ok(!JSON.stringify(r).includes(id));
    assert.notEqual(r.primary, 'Unknown');
  }
  assert.equal(memberIdentity({ user_id: id, role: 'owner' }).primary, 'Owner');
  assert.equal(memberIdentity({ user_id: id, role: 'editor' }).primary, 'Collaborator');
});

test('profile of another user does not leak onto a collaborator row', () => {
  const r = memberIdentity({ user_id: 'u2', role: 'editor', email: 'b@x.com' }, { owner: { user_id: 'u1', name: 'Dana', email: 'dana@x.com' } });
  assert.equal(r.primary, 'b@x.com');
  assert.equal(r.secondary, '');
});
