# P2-03 / P2-30 — account-deletion backend restore

- Date: 2026-08-20
- Status: **restored**
- IDs: **P2-03**, **P2-30**
- UI already intact from `account-settings-overlap.md` (typed DELETE, `linkIdentity`, collaborator copy). This pass restored the Edge function + SQL only.

Did **not** edit: `PDFViewer.jsx`, CORS `Access-Control-Allow-Origin: '*'`, `AccountSettings.jsx`, `AuthContext.jsx`. No commit. Migration in-tree only — not applied.

## Verdict

**P2-03:** Delete is refused with **409 `ACCOUNT_HAS_COLLABORATORS`** when the caller owns a document that has another `document_collaborators.status='active'` row. The Edge function checks `account_deletion_owned_document_blockers` **before** any wipe stage. `delete_account_owned_rows` raises the same code before `DELETE FROM documents`. Owner-only collaborator rows do not count.

**P2-30:** After a successful database wipe, storage failure is swallowed and **auth delete still runs**. Auth failure after wipe returns **409 `DATA_REMOVED_RETRY`** (`dataRemoved: true`). Billing/database failures stay 500 `DELETION_FAILED` and do not claim data was removed.

## Files changed

- `supabase/functions/_shared/accountDeletion.ts` — `AccountDeletionStageError`; storage throw no longer aborts; auth always attempted after DB wipe
- `supabase/functions/delete-account/index.ts` — pre-wipe collaborator RPC + 409 mapping; catch maps wipe-then-auth-fail to `DATA_REMOVED_RETRY`
- `supabase/migrations/20260820010000_account_deletion_collaborator_guard.sql` — blockers RPC + SQL raise (not applied)
- `tests/accountSettingsLogic.test.mjs` — P2-03 SQL/edge contract + P2-30 stage cases
- `tests/accountNativeE2EContracts.test.mjs` — resume-after-stage: storage fail still reaches auth
- `tests/accountPlatformParity.test.mjs` — Edge source asserts blockers RPC

## Grep-proof

```
delete-account/index.ts
  account_deletion_owned_document_blockers   (before runAccountDeletionStages)
  409 + code: 'ACCOUNT_HAS_COLLABORATORS'
  409 + code: 'DATA_REMOVED_RETRY' when isDataRemovedDeletionError
  Access-Control-Allow-Origin: '*'           (unchanged)

accountDeletion.ts
  storage catch { /* keep going */ }
  deleteAuthUser always after successful database
  dataRemoved: completed.includes('database')

20260820010000_account_deletion_collaborator_guard.sql
  RAISE EXCEPTION 'ACCOUNT_HAS_COLLABORATORS' before DELETE FROM public.documents
  dc.status = 'active' AND dc.user_id IS DISTINCT FROM target_user_id
```

## Tests

```
node --test tests/accountSettingsLogic.test.mjs tests/accountNativeE2EContracts.test.mjs tests/accountPlatformParity.test.mjs tests/authAccountFlows.test.mjs
```

**56/56 pass.**

Intended: collaborator block before wipe; named 409 payload; storage fail still deletes auth; auth fail after wipe is retryable + `dataRemoved`.

Break: owner-only / empty docs do not produce the shared-document message; billing/database fail do not set `dataRemoved`.

Edge: SQL raise still maps to 409 if the pre-check is bypassed; Stripe missing-customer remains success; CORS wildcard left intact.

## Remaining risk

- **Migration is not applied.** Until deploy, live `delete_account_owned_rows` still wipes owned docs (and their collaborators via CASCADE) with no guard.
- No in-app ownership-transfer flow — block only.
- Project/template members without a `document_collaborators` row are not counted.
- Pending (`status != 'active'`) collaborator rows do not block.
- Storage orphans after a storage-then-auth success are not retried (no remaining auth user). Acceptable.
- Retry after `DATA_REMOVED_RETRY` re-runs billing (idempotent missing-customer) and the DB wipe (already empty), then auth again.
