# Account-settings bucket — fix log

Date: 2026-08-20
IDs closed: P2-03, P2-08, P2-15, P2-30, P2-31, P2-32
Status: fixed
Order honored: P2-03 first, then P2-08 / P2-30 / P2-31 / P2-32, then P2-15 after the collaborator guard.

---

### P2-03 — Account deletion destroys collaborators’ work
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/migrations/20260820010000_account_deletion_collaborator_guard.sql`, `supabase/functions/delete-account/index.ts`, `src/utils/accountPlatform.js`, `src/components/AccountSettings.jsx`
- Intended behavior confirmed: deletion is refused (409 `ACCOUNT_HAS_COLLABORATORS`) when the caller owns any document with another `document_collaborators.status='active'` row. The SQL wipe raises the same code before `DELETE FROM documents`. UI copy and `accountDeletionUserMessage` name transfer/remove-collaborators as the way out.
- Break / adversarial attempts: owner-only collaborator rows (`user_id` = owner) do not count; empty document lists do not produce the shared-document message; direct RPC wipe is still blocked.
- Edges covered: named document list (up to 5 + remainder); singular vs plural; service-role-only RPCs.
- Test command + result: `node --test tests/accountSettingsLogic.test.mjs tests/accountNativeE2EContracts.test.mjs tests/accountPlatformParity.test.mjs tests/authAccountFlows.test.mjs` → 55/55 pass.
- Remaining risk: no in-app ownership-transfer flow (block only). Project/template members without a document_collaborators row are not counted. Guard is live only after this migration is applied.

### P2-08 — “Connect Google” is sign-in, not link
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/accountPlatform.js`, `src/contexts/AuthContext.jsx`, `src/components/AccountSettings.jsx`
- Intended behavior confirmed: Settings Connect calls `linkGoogleIdentity` → `auth.linkIdentity({ provider: 'google' })` (id-token form on native). Login still uses `signInWithGoogle`.
- Break / adversarial attempts: `assertLinkedSameUser` throws if a link response returns a different user id. Missing `linkIdentity` throws a clear unavailable error instead of falling through to sign-in.
- Edges covered: OAuth redirect + native id-token; `select_account` prompt preserved; identities/app_metadata now update the auth `user` reference.
- Test command + result: same 55/55 suite.
- Remaining risk: after a web OAuth redirect, Supabase (not the client) must reject a Google identity already bound to another user. Native `linkIdentity({ token })` depends on the installed supabase-js accepting id-token credentials.

### P2-30 — Half-failed deletion strands a live empty account
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/functions/_shared/accountDeletion.ts`, `supabase/functions/delete-account/index.ts`, `src/utils/accountPlatform.js`
- Intended behavior confirmed: after a successful database wipe, auth deletion still runs even if storage fails. Auth failure after wipe returns 409 `DATA_REMOVED_RETRY` with stage-aware copy. Billing/database failures do not claim data was removed.
- Break / adversarial attempts: storage throw still reaches `deleteAuthUser`; retry after a marked auth failure completes; Stripe missing-customer remains success.
- Edges covered: billing fail, database fail, storage fail + auth success, auth fail + retry.
- Test command + result: same 55/55 suite.
- Remaining risk: orphaned storage blobs after a storage-then-auth success are not retried (no remaining auth user). Acceptable per the existing wipe-order comment.

### P2-31 — Profile save reports total failure after a successful name change
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/accountPlatform.js`, `src/components/AccountSettings.jsx`
- Intended behavior confirmed: name and password updates are separate; `describeProfileSaveOutcome` reports “name was saved, but the password could not be updated” and keeps the editor open for retry.
- Break / adversarial attempts: noop when nothing changed; both-failed composes both errors; password-only and name-only success still use the existing confirmation-email copy.
- Edges covered: partial name-ok/password-fail; noop; dual failure.
- Test command + result: same 55/55 suite.
- Remaining risk: the profile-change notification email can still fail silently (pre-existing; success copy already does not claim delivery unless the function accepted the request).

### P2-32 — Google-only accounts see a Change Password form that cannot succeed
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/accountPlatform.js`, `src/components/AccountSettings.jsx`
- Intended behavior confirmed: no `email` identity → “Set a password”, no current-password field, no `signIn` re-auth. Email+Google accounts keep the existing current-password gate.
- Break / adversarial attempts: set-kind with blank fields is a no-op (name-only saves still work); change-kind still requires current password.
- Edges covered: `hasPasswordIdentity` via identities and `app_metadata.providers`; reset-link copy for set vs change.
- Test command + result: same 55/55 suite.
- Remaining risk: `updateUser({ password })` on a Google-only session is allowed by Supabase today; if a project setting later forbids it, the email reset-link path remains.

### P2-15 — Delete-account button permanently disabled
- Date: 2026-08-20
- Status: fixed (after P2-03)
- Files changed: `src/components/AccountSettings.jsx`, `src/contexts/AuthContext.jsx`
- Intended behavior confirmed: Delete account is enabled, opens a typed-`DELETE` confirm, then calls `deleteAccount`. Server collaborator guard from P2-03 is the real safety net. Dev auto-login suppression runs only after the server reports `deleted: true`.
- Break / adversarial attempts: confirm button stays disabled until the typed token matches; collaborator / data-removed errors surface through `accountDeletionUserMessage`.
- Edges covered: typed confirmation; cancel confirm; blocked-deletion copy.
- Test command + result: same 55/55 suite.
- Remaining risk: the migration must be deployed with the Edge function. Until then the live backend can still wipe shared docs if called directly. No ownership-transfer UI.

---

## Files changed
- `src/components/AccountSettings.jsx`
- `src/contexts/AuthContext.jsx`
- `src/utils/accountPlatform.js`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/_shared/accountDeletion.ts`
- `supabase/migrations/20260820010000_account_deletion_collaborator_guard.sql`
- `tests/accountSettingsLogic.test.mjs` (new)
- `tests/accountNativeE2EContracts.test.mjs`
- `tests/accountPlatformParity.test.mjs`

## Tests
```
node --test tests/accountSettingsLogic.test.mjs tests/accountNativeE2EContracts.test.mjs tests/accountPlatformParity.test.mjs tests/authAccountFlows.test.mjs
```
55/55 pass.

## Remaining risk (bucket)
- Collaborator block is documents + `document_collaborators` only; no transfer RPC/UI.
- SQL guard is inert until the new migration is applied.
- Storage orphans after a successful auth wipe are not cleaned up.
- Google link after redirect still depends on Supabase rejecting a foreign identity.
