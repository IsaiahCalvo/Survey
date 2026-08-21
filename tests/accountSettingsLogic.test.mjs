import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { passwordMeetsRequirements } from '../src/components/authFlow.js';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  accountDeletionUserMessage,
  assertLinkedSameUser,
  describeProfileSaveOutcome,
  hasPasswordIdentity,
  isAccountDeletionConfirmation,
  isGoogleIdentityConnected,
  linkOAuthProvider,
  passwordChangeKind,
  requestAccountDeletion,
  resolveAccountDeletionResponse,
  validatePasswordForm,
} from '../src/utils/accountPlatform.js';
import {
  isDataRemovedDeletionError,
  runAccountDeletionStages,
} from '../supabase/functions/_shared/accountDeletion.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const STRONG = 'Str0ng!Passw0rd';

test('P2-03: collaborator-owned documents block deletion with an actionable message', () => {
  const message = accountDeletionUserMessage({
    code: 'ACCOUNT_HAS_COLLABORATORS',
    documents: [
      { name: 'Site A.pdf' },
      { name: 'Site B.pdf' },
    ],
  });
  assert.match(message, /2 shared documents/);
  assert.match(message, /Site A\.pdf/);
  assert.match(message, /Transfer ownership or remove collaborators/);
  assert.equal(
    accountDeletionUserMessage({ code: 'ACCOUNT_HAS_COLLABORATORS', documents: [{ name: 'Only.pdf' }] }).includes('1 shared document'),
    true,
  );
  assert.equal(isAccountDeletionConfirmation('delete'), false);
  assert.equal(isAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION), true);
});

test('P2-03: delete-account and SQL refuse a wipe while collaborators remain', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  const migration = read('supabase/migrations/20260820010000_account_deletion_collaborator_guard.sql');
  const settings = read('src/components/AccountSettings.jsx');

  assert.match(edge, /account_deletion_owned_document_blockers/);
  assert.match(edge, /ACCOUNT_HAS_COLLABORATORS/);
  assert.ok(
    edge.indexOf("rpc(\n      'account_deletion_owned_document_blockers'")
      < edge.indexOf('await runAccountDeletionStages'),
    'collaborator check must run before any deletion stage',
  );
  assert.match(migration, /ACCOUNT_HAS_COLLABORATORS/);
  assert.match(migration, /dc\.user_id IS DISTINCT FROM target_user_id/);
  assert.match(migration, /dc\.status = 'active'/);
  assert.ok(
    migration.indexOf('ACCOUNT_HAS_COLLABORATORS') < migration.indexOf('DELETE FROM public.documents'),
    'owned-row wipe must raise before deleting documents',
  );
  assert.match(settings, /transfer ownership or remove collaborators/);
});

test('P2-03: owner-only collaborator rows and empty docs do not look like a shared-document block', () => {
  assert.doesNotMatch(
    accountDeletionUserMessage({ code: 'DELETION_FAILED', message: 'network' }),
    /shared document/,
  );
  assert.match(
    accountDeletionUserMessage({ documents: [] , message: 'network' }),
    /network/,
  );
});

test('P2-08: Connect Google calls linkIdentity, never sign-in', async () => {
  const calls = [];
  await linkOAuthProvider({
    auth: {
      linkIdentity: async (payload) => {
        calls.push(payload);
        return { data: { user: { id: 'same' } }, error: null };
      },
    },
    provider: 'google',
    location: { origin: 'https://surveytool.app', pathname: '/', href: 'https://surveytool.app/' },
  });
  assert.equal(calls[0].provider, 'google');
  assert.equal(calls[0].options.queryParams.prompt, 'select_account');

  const tokenCalls = [];
  await linkOAuthProvider({
    auth: {
      linkIdentity: async (payload) => {
        tokenCalls.push(payload);
        return { data: { user: { id: 'same' } }, error: null };
      },
    },
    provider: 'google',
    idToken: 'id-token',
  });
  assert.deepEqual(tokenCalls, [{ provider: 'google', token: 'id-token' }]);

  assert.doesNotThrow(() => assertLinkedSameUser('user-1', 'user-1'));
  assert.doesNotThrow(() => assertLinkedSameUser('user-1', undefined));
  assert.throws(
    () => assertLinkedSameUser('user-1', 'user-2'),
    /different Survey account/,
  );
});

test('P2-08: settings and auth context wire linkIdentity, not OAuth sign-in', () => {
  const settings = read('src/components/AccountSettings.jsx');
  const auth = read('src/contexts/AuthContext.jsx');
  const platform = read('src/utils/accountPlatform.js');

  assert.match(settings, /await linkGoogleIdentity\(\)/);
  assert.doesNotMatch(settings, /signInWithGoogle/);
  assert.match(auth, /linkOAuthProvider\(\{/);
  assert.match(auth, /assertLinkedSameUser\(previousId/);
  assert.match(auth, /linkGoogleIdentity,/);
  assert.match(platform, /auth\.linkIdentity\(/);
  assert.doesNotMatch(platform, /signInWithOAuth/);
});

test('P2-15: delete account is reachable behind typed DELETE confirmation', () => {
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /onClick=\{handleDeleteAccount\}/);
  assert.match(settings, /isAccountDeletionConfirmation\(deleteConfirmText\)/);
  assert.match(settings, /Type \{ACCOUNT_DELETION_CONFIRMATION\} to confirm/);
  assert.doesNotMatch(settings, /Account deletion isn't self-serve yet/);
  const danger = settings.slice(settings.indexOf('account-danger-zone'));
  assert.doesNotMatch(danger.slice(0, 800), /disabled\s*\n\s*title="Account deletion isn't self-serve/);
});

test('P2-30: storage failure after a data wipe still deletes the auth user', async () => {
  const completed = [];
  await runAccountDeletionStages({
    cancelBilling: async () => { completed.push('billing'); },
    deleteDatabaseRows: async () => { completed.push('database'); },
    removeStorage: async () => { completed.push('storage'); throw new Error('storage offline'); },
    deleteAuthUser: async () => { completed.push('auth'); },
  });
  assert.deepEqual(completed, ['billing', 'database', 'storage', 'auth']);
});

test('P2-30: auth failure after a data wipe is retryable and marked data-removed', async () => {
  const completed = [];
  let failAuth = true;
  const stages = {
    cancelBilling: async () => { completed.push('billing'); },
    deleteDatabaseRows: async () => { completed.push('database'); },
    removeStorage: async () => { completed.push('storage'); },
    deleteAuthUser: async () => {
      completed.push('auth');
      if (failAuth) throw new Error('auth delete lost');
    },
  };
  await assert.rejects(runAccountDeletionStages(stages), (error) => {
    assert.equal(error.stage, 'auth');
    assert.equal(error.dataRemoved, true);
    assert.ok(isDataRemovedDeletionError(error));
    return /auth delete lost/.test(error.message);
  });
  failAuth = false;
  await runAccountDeletionStages(stages);
  assert.ok(completed.includes('auth'));
});

test('P2-30: billing/database failures do not claim data was already removed', async () => {
  await assert.rejects(runAccountDeletionStages({
    cancelBilling: async () => { throw new Error('stripe down'); },
    deleteDatabaseRows: async () => {},
    removeStorage: async () => {},
    deleteAuthUser: async () => {},
  }), (error) => error.dataRemoved === false && error.stage === 'billing');

  await assert.rejects(runAccountDeletionStages({
    cancelBilling: async () => {},
    deleteDatabaseRows: async () => { throw new Error('rpc failed'); },
    removeStorage: async () => {},
    deleteAuthUser: async () => {},
  }), (error) => error.dataRemoved === false && error.stage === 'database');
});

test('P2-30: client surfaces stage-aware retry copy and collaborator payloads', async () => {
  assert.match(
    accountDeletionUserMessage({ code: 'DATA_REMOVED_RETRY', dataRemoved: true }),
    /Retry to finish closing the account/,
  );
  const payload = resolveAccountDeletionResponse({
    error: 'shared',
    code: 'ACCOUNT_HAS_COLLABORATORS',
    documents: [{ name: 'Team.pdf' }],
  }, null);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'ACCOUNT_HAS_COLLABORATORS');

  await assert.rejects(
    requestAccountDeletion({
      invoke: async () => ({
        data: {
          error: 'Your data was removed, but the account could not finish closing. Retry to finish closing the account.',
          code: 'DATA_REMOVED_RETRY',
          dataRemoved: true,
          stage: 'auth',
        },
        error: null,
      }),
    }),
    /Retry to finish closing the account/,
  );

  const edge = read('supabase/functions/delete-account/index.ts');
  assert.match(edge, /DATA_REMOVED_RETRY/);
  assert.match(edge, /isDataRemovedDeletionError/);
});

test('P2-31: profile save reports a partial result when only the name lands', () => {
  const outcome = describeProfileSaveOutcome({
    attemptedName: true,
    attemptedPassword: true,
    nameSaved: true,
    passwordError: 'Current password is incorrect',
  });
  assert.equal(outcome.kind, 'partial');
  assert.deepEqual(outcome.changedFields, ['name']);
  assert.match(outcome.message, /name was saved/);
  assert.match(outcome.message, /password could not be updated/);
  assert.equal(describeProfileSaveOutcome({}).kind, 'noop');
});

test('P2-31: settings save name and password in separate try blocks', () => {
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /describeProfileSaveOutcome\(\{/);
  assert.match(settings, /nameSaved = true/);
  assert.match(settings, /passwordSaved = true/);
  assert.match(settings, /outcome\.kind === 'partial'/);
});

test('P2-32: Google-only accounts set a password without current-password re-auth', () => {
  const googleOnly = { identities: [{ provider: 'google' }], app_metadata: { providers: ['google'] } };
  const emailUser = { identities: [{ provider: 'google' }, { provider: 'email' }] };
  assert.equal(hasPasswordIdentity(googleOnly), false);
  assert.equal(passwordChangeKind(googleOnly), 'set');
  assert.equal(hasPasswordIdentity(emailUser), true);
  assert.equal(isGoogleIdentityConnected(googleOnly), true);

  assert.equal(validatePasswordForm({
    kind: 'set',
    newPassword: STRONG,
    confirmPassword: STRONG,
    passwordMeetsRequirements,
  }).changing, true);
  assert.match(
    validatePasswordForm({ kind: 'change', newPassword: STRONG, confirmPassword: STRONG }).error,
    /current password/,
  );
  assert.equal(
    validatePasswordForm({ kind: 'set', currentPassword: '', newPassword: '', confirmPassword: '' }).changing,
    false,
  );
});

test('P2-32: settings hide Current password for Google-only accounts', () => {
  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /passwordChangeKind\(user\) === 'set'/);
  assert.match(settings, /Set a password/);
  assert.match(settings, /This account signs in with Google/);
  assert.match(settings, /passwordChangeKind\(user\) === 'change' && \(/);
});
