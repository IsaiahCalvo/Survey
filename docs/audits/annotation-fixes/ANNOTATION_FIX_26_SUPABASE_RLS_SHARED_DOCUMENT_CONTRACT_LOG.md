# ANNOTATION_FIX_26_SUPABASE_RLS_SHARED_DOCUMENT_CONTRACT_LOG

Date: 2026-05-13

## Finding

This was product-impacting, not only a test-harness problem.

Exact source of truth for document/file access is `public.user_can_access_document(doc_id, required_role)`.
It is used by document row reads, `document_annotations`, `document_presence`, `doc_yjs_updates`, `doc_yjs_state`, `activity_log`, and the collaborator storage read policy for `storage.objects`.

The existing uncommitted migrations already added:

- `20260513000000_allow_collaborators_to_select_documents.sql`
  - Lets active collaborators select shared document rows through `user_can_access_document(id, 'viewer')`.
- `20260513003000_allow_collaborators_to_read_document_storage.sql`
  - Lets active collaborators read private PDF bytes from the `documents` bucket only when a `documents.file_path` row is accessible through `user_can_access_document(d.id, 'viewer')`.

Two gaps remained:

1. `documents` INSERT could reject valid owner-created disposable/live documents when an account was missing a `user_subscriptions` row, because the storage check evaluated `NULL + file_size <= limit`, which fails RLS `WITH CHECK`.
2. `document_annotations` UPDATE/DELETE allowed any document editor to mutate any annotation row on the shared document. That did not match the intended collaborator contract.

## Changes

Added migration:

- `supabase/migrations/20260513010000_fix_shared_document_annotation_rls_contract.sql`

Policy decisions:

- Document creation remains owner-only: `auth.uid() = user_id`.
- Document creation still enforces document count and storage limits.
- Missing subscription storage usage now resolves to `0` using `COALESCE`, matching the existing helper behavior where missing subscriptions default to free-tier limits.
- Annotation INSERT is limited to `auth.uid() = user_id` and editor access on the document.
- Annotation UPDATE is allowed for the row author with editor access, or an explicit document owner.
- Annotation DELETE is allowed for the row author with editor access, or an explicit document owner.
- No broad `allow all authenticated users` policy was added.

Added regression coverage in:

- `tests/annotationContractRegression.test.mjs`

The new test statically verifies the migration keeps:

- owner-only document inserts
- `COALESCE` storage handling
- author-scoped collaborator annotation insert/update/delete
- explicit owner override
- no `TO authenticated ... true` blanket policy

## App Code Review

Reviewed relevant paths:

- Document creation and listing: `src/hooks/useDatabase.js`
- Storage upload/download: `src/hooks/useDatabase.js`
- Highlight annotation CRUD: `src/services/documentAnnotationService.js`
- All-types annotation CRUD and subscriptions: `src/services/annotationCloudSync.js`
- Fabric/callout row authorship serialization: `src/services/annotationTypeSerializers.js`
- Y.Doc realtime transport: `src/lib/collab/SupabaseYjsProvider.js`

No UI work was done. No print/export UI was touched.

## Test Output

Passed:

- `node --test tests/documentAnnotationService.test.mjs tests/phase28/SupabaseYjsProvider.test.mjs tests/phase31/legacyBulkUpsertGate.test.mjs tests/annotationContractRegression.test.mjs`
  - 23 passing tests
- `node --test tests/syncStatusUi.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - 26 passing tests
- `npm run build`
  - Passed
  - Existing warnings: Vite CJS deprecation, pdf.js eval warning, dynamic/static import chunking warnings, large chunk warning.

## Runtime Validation

Not run against the live Supabase project in this pass.

Reason: live validation would require applying the new migration to the target Supabase database first. I did not mutate the remote database from this task. The remaining live check after migration deployment is:

- owner creates/opens a PDF
- collaborator opens the shared PDF
- collaborator creates an annotation
- owner sees the collaborator annotation
- collaborator cannot edit/delete owner annotation
- owner can edit/delete cross-author annotations by explicit owner rule
- reload preserves correct annotations

## Remaining Risks

- The storage bucket policies are only partially represented in migrations. The new collaborator read policy is intentional and private-bucket scoped, but owner upload/delete storage policies may still be configured outside this migration history.
- `doc_yjs_updates` and `doc_yjs_state` remain document-editor scoped at the Y.Doc update level. Per-annotation ownership is enforced on durable `document_annotations` rows and UI interaction paths, but raw Y.Doc binary updates are not semantically inspectable by RLS.
- Live Supabase validation should be rerun after deploying `20260513010000_fix_shared_document_annotation_rls_contract.sql`.

## Live Deploy And Validation

Date: 2026-05-13

Supabase project:

- Ref: `cvamwtpsuvxvjdnotbeg`
- Name: `Survey`
- The linked project ref, `.env` Supabase URL ref, and bot credential ref all matched.

Migration deployment:

- Ran `supabase migration list --linked`.
  - Before deploy, `20260513010000` was local-only.
- Ran `supabase db push --linked`.
  - Applied `20260513010000_fix_shared_document_annotation_rls_contract.sql`.
  - Changed `documents` INSERT policy and `document_annotations` INSERT/UPDATE/DELETE policies.

Initial live validation result:

- Failed on app-style document creation with:
  - `new row violates row-level security policy for table "documents"`
- Plain `documents.insert(row)` succeeded, but `documents.insert(row).select().single()` failed.
- Root cause: the `documents` SELECT policy only called `user_can_access_document(id, 'viewer')`. During `INSERT ... RETURNING`, that helper's self-query does not reliably see the row being returned yet, so PostgREST rejected the returned row even though the INSERT policy passed.

Follow-up migration:

- Added `supabase/migrations/20260513013000_fix_document_insert_returning_select_policy.sql`.
- Policy decision:
  - Restore direct owner SELECT fast path with `auth.uid() = user_id`.
  - Keep collaborator document access through `user_can_access_document(id, 'viewer')`.
  - No broad authenticated access.
- Ran `supabase db push --linked --yes`.
  - Applied `20260513013000_fix_document_insert_returning_select_policy.sql`.
- Confirmed with `supabase migration list --linked`:
  - `20260513010000` applied remotely.
  - `20260513013000` applied remotely.

Final live validation result: PASS.

Validation used two real authenticated bot users against project `cvamwtpsuvxvjdnotbeg`.

Created validation document:

- ID: `27bac56b-be3e-41dd-8bbf-b826fe15f8fe`
- Name: `Fix26 RLS Live Validation 20260513155344.pdf`
- Storage path: `53f84051-1022-4915-bdcf-63e63ddcd2fc/fix26-rls-live/20260513155344.pdf`

Live checks passed:

- Owner uploaded PDF bytes to the private `documents` bucket.
- Owner created/opened document row with app-style `.insert(...).select().single()`.
- Previous document RLS error was gone.
- Owner downloaded the PDF file from storage.
- Owner shared the document with an editor collaborator.
- Collaborator selected/opened the shared document row.
- Collaborator downloaded the shared PDF file from storage.
- Collaborator created their own annotation row.
- Owner selected and saw collaborator annotation rows.
- Collaborator attempted to update owner annotation; returned 0 rows and owner row stayed unchanged.
- Collaborator attempted to delete owner annotation; returned 0 rows and owner row remained.
- Owner updated collaborator annotation through the explicit owner rule.
- Owner deleted a collaborator annotation through the explicit owner rule.
- Reload with a fresh owner client preserved the expected remaining annotations.
- Anonymous user saw 0 document rows.
- Anonymous user saw 0 annotation rows.
- Anonymous storage download was denied.

Live validation row counts:

- Owner visible annotations before owner override: `3`
- Reloaded remaining annotations: `2`
- Collaborator update-owner returned rows: `0`
- Collaborator delete-owner returned rows: `0`
- Owner delete-collaborator returned rows: `1`

Local tests after live deploy:

- `node --test tests/documentAnnotationService.test.mjs tests/phase28/SupabaseYjsProvider.test.mjs tests/phase31/legacyBulkUpsertGate.test.mjs tests/annotationContractRegression.test.mjs`
  - Passed: 23 tests
- `node --test tests/syncStatusUi.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - Passed: 26 tests
- `npm run build`
  - Passed
  - Existing warnings: Vite CJS deprecation, pdf.js eval warning, dynamic/static import chunking warnings, large chunk warning.

Code/migration changes from live validation:

- Added `20260513013000_fix_document_insert_returning_select_policy.sql` because live validation proved the previous migration was still wrong for the app's actual document creation path.
- Updated `tests/annotationContractRegression.test.mjs` to statically guard the document owner SELECT fast path plus collaborator helper access.

Remaining risks after live pass:

- A disposable validation document and an earlier no-select probe row remain in the live database. They were created during this validation and were not removed to avoid deleting data during the deploy pass.
- Storage bucket owner upload/delete policies are still not fully represented in local migrations, though live owner upload and collaborator read passed.
- Y.Doc binary update tables remain document-editor scoped because RLS cannot inspect binary Yjs updates for per-annotation authorship. Durable `document_annotations` now enforces the row-level ownership contract.
