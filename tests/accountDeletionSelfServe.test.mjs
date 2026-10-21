import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  deleteAccountButtonState,
  isAccountDeletionConfirmed,
} from '../src/components/accountDeletionConfirm.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('delete account button is enabled unless a request is in flight', () => {
  assert.deepEqual(deleteAccountButtonState({ loading: false }), { disabled: false, label: 'Delete account' });
  assert.equal(deleteAccountButtonState({ loading: true }).disabled, true);
  assert.equal(deleteAccountButtonState().disabled, false);
});

test('typed confirmation must be DELETE', () => {
  assert.equal(ACCOUNT_DELETION_CONFIRMATION, 'DELETE');
  assert.equal(isAccountDeletionConfirmed('DELETE'), true);
  assert.equal(isAccountDeletionConfirmed(' DELETE '), true);
  for (const bad of ['delete', 'DEL', '', null, undefined]) assert.equal(isAccountDeletionConfirmed(bad), false);
});

test('AccountSettings wires the self-serve button to deleteAccount behind two confirms', () => {
  const src = read('src/components/AccountSettings.jsx');
  assert.doesNotMatch(src, /isn't self-serve yet/);
  assert.match(src, /onClick=\{handleDeleteAccount\}/);
  assert.match(src, /askPrompt\([\s\S]*isAccountDeletionConfirmed\(typed\)[\s\S]*askConfirm\([\s\S]*await deleteAccount\(\)/);
  assert.match(src, /\{accountDeletePrompt\}\{accountConfirmDialog\}/);
  // deleteAccount signs out locally and resets to the signed-out app.
  const auth = read('src/contexts/AuthContext.jsx');
  assert.match(auth, /const deleteAccount = async[\s\S]*signOut\(\{ scope: 'local' \}\)[\s\S]*setUser\(null\)/);
});
