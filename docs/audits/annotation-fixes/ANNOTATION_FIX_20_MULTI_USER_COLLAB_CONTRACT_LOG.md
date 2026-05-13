# Annotation Fix 20 - Multi-User Collaboration Contract

## Summary

Status: accepted by live harness proof on 2026-05-13.

Goal proven: two authenticated collaborator users can open the same disposable PDF, see each other's annotation changes live, and undo/delete only their own work. Supabase remains the durable row store; Y.Doc remains the live collaboration layer; reload restores the final state.

Imported PDF-native Squiggly was not touched.

## Root Cause

1. Collaborator document open was blocked by the `documents` SELECT RLS policy. Annotation and Y.Doc tables already used document-access helpers, but the document row itself was still owner-only.
2. The Y.Doc undo path correctly scoped undo by tracked per-user origin, but the app state refresh after `Y.UndoManager.undo()` rebuilt every annotation from Y.Doc. That caused the cloud sync diff to treat unrelated collaborator objects as changed and produced a multi-object fan-out after one user's undo.
3. Callout undo removed the callout from Y.Doc but needed a local state refresh for the popped callout id so the Supabase delete would be durable.

## Files Changed

- `src/App.jsx`
  - Added DEV-only `window.__fix20OpenDocumentById(documentId)`.
  - Added DEV-only `window.__fix20CollabHarness`.
  - Added targeted Y.Doc undo/redo refresh from the popped stack item metadata.
  - The refresh now updates/removes only the popped annotation id instead of rebuilding every annotation from Y.Doc.
- `src/contexts/AuthContext.jsx`
  - Added DEV-only `localStorage.__fix20AuthOverride` for separate Playwright bot sessions.
- `src/hooks/useDatabase.js`
  - Includes accessible collaborator documents in `useDocuments`.
- `supabase/migrations/20260513000000_allow_collaborators_to_select_documents.sql`
  - Replaces owner-only document SELECT with `public.user_can_access_document(id, 'viewer')`.
- `scripts/fix20-multi-user-collab-contract-e2e.mjs`
  - Live authenticated two-context harness.

## Harness

Command:

```bash
FIX20_BASE_URL=http://localhost:5174/ FIX20_DOCUMENT_ID=3c76c311-8f48-403e-9259-0d597a10a116 node scripts/fix20-multi-user-collab-contract-e2e.mjs
```

Result:

```text
[fix20] PASS. Evidence: /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-13_01-34-35_fix20-multi-user-collab
```

How it works:

- Opens one disposable PDF in two isolated Playwright browser contexts.
- Context A signs in as `phase28-bot-1@betasafes2.test`.
- Context B signs in as `phase28-bot-2@betasafes2.test`.
- Both users are collaborators on the same document.
- The harness uses DEV-only helpers to open the document and create rectangle, callout, and counter annotations through the app's real save/sync paths.
- The harness captures console sync logs, Supabase rows, Y.Doc map sizes, live UI state, blocked ownership operations, undo isolation, and reload state.

Storage note: collaborator storage download is still blocked by storage RLS for the owner path, so the DEV harness passes the already-downloaded PDF bytes through `__fix20DocumentOverride` while preserving the real Supabase document id for sync. This is harness-only and gated behind `import.meta.env.DEV`.

## Document

- Document id: `3c76c311-8f48-403e-9259-0d597a10a116`
- Name: `Fix20 Multi User Contract 20260513012243.pdf`
- File path: `170d915c-5741-4e0b-b03f-deaeedae27bd/fix20-multi-user/20260513012243.pdf`
- Owner id: `170d915c-5741-4e0b-b03f-deaeedae27bd`
- Log folder: `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-13_01-34-35_fix20-multi-user-collab`

## Users And Created IDs

User A:

- id: `53f84051-1022-4915-bdcf-63e63ddcd2fc`
- email: `phase28-bot-1@betasafes2.test`
- rectangle: `fix20-a-rect-1778636084267`
- callout: `fix20-a-callout-1778636084267`

User B:

- id: `9645bbd9-d5d1-40a4-bdee-c9de1057271c`
- email: `phase28-bot-2@betasafes2.test`
- counter: `fix20-b-counter-1778636084267`

## Live Visibility Proof

- User A created rectangle `fix20-a-rect-1778636084267`.
- User B saw it live without reload with author id `53f84051-1022-4915-bdcf-63e63ddcd2fc`.
- User A created callout `fix20-a-callout-1778636084267`.
- User B saw it live without reload with author id `53f84051-1022-4915-bdcf-63e63ddcd2fc`.
- User B created counter `fix20-b-counter-1778636084267`.
- User A saw it live without reload with author id `9645bbd9-d5d1-40a4-bdee-c9de1057271c`.

## Ownership Block Proof

User B attempts against User A rectangle:

```json
{"allowed":false,"reason":"foreign-owner","id":"fix20-a-rect-1778636084267","kind":"annotation"}
```

User B attempts against User A callout:

```json
{"allowed":false,"reason":"foreign-owner","id":"fix20-a-callout-1778636084267","kind":"callout"}
```

The rectangle and callout remained present after blocked operations.

## Undo/Redo Isolation Proof

User A undo callout:

```json
{"changedIds":[],"deletedIds":["fix20-a-callout-1778636084267"],"changedCount":0,"dispatchedCount":1,"supabaseUpsertCount":0,"yDocUpdateCount":0,"fullFanOutReason":null}
```

User B counter remained present after User A callout undo.

User A undo rectangle:

```json
{"changedIds":[],"deletedIds":["fix20-a-rect-1778636084267"],"changedCount":0,"dispatchedCount":1,"supabaseUpsertCount":0,"yDocUpdateCount":0,"fullFanOutReason":null}
```

User B counter remained present after User A rectangle undo.

User B undo counter:

```json
{"changedIds":[],"deletedIds":["fix20-b-counter-1778636084267"],"changedCount":0,"dispatchedCount":1,"supabaseUpsertCount":0,"yDocUpdateCount":0,"fullFanOutReason":null}
```

No user's undo removed another user's annotation.

## Sync Delta Proof

Single-object creates:

- Rectangle create: `changedIds=["fix20-a-rect-1778636084267"]`, `changedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.
- Callout create: `changedIds=["fix20-a-callout-1778636084267"]`, `changedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.
- Counter create: `changedIds=["fix20-b-counter-1778636084267"]`, `changedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.

Deletes from undo:

- Rectangle undo delete: `deletedIds=["fix20-a-rect-1778636084267"]`, `dispatchedCount=1`, `supabaseUpsertCount=0`, `fullFanOutReason=null`.
- Counter undo delete: `deletedIds=["fix20-b-counter-1778636084267"]`, `dispatchedCount=1`, `supabaseUpsertCount=0`, `fullFanOutReason=null`.

The harness reported `noFullPageFanOut: true`.

## Supabase Row Proof

Final rows for the created ids after both users undo their own work:

```json
[]
```

The harness reported `supabaseRows.pass: true`.

## Y.Doc / Realtime Proof

Realtime subscriptions were active for both users with INSERT/UPDATE/DELETE handlers for fabric and callouts.

Representative proof lines:

- User B applied User A rectangle insert live: `[CloudSync][realtime] applying INSERT fabric {"highlightId":"fix20-a-rect-1778636084267",...}`
- User B applied User A callout insert live: `[CloudSync][realtime] applying INSERT callout {"highlightId":"fix20-a-callout-1778636084267",...}`
- User A applied User B counter insert live: `[CloudSync][realtime] applying INSERT fabric {"highlightId":"fix20-b-counter-1778636084267",...}`
- Callout Y.Doc fan-out after Supabase success: `upserted=1`, then undo delete `deleted=1`.

Final Y.Doc state after both users undo their own work:

```json
{"userAFinalYDoc":{"annotations":0,"callouts":0},"userBFinalYDoc":{"annotations":0,"callouts":0}}
```

## Reload Proof

After reloading both clients and reopening the same document:

- User A annotations: `[]`
- User A callouts: `[]`
- User A Y.Doc maps: `annotations=0`, `callouts=0`
- User B annotations: `[]`
- User B callouts: `[]`
- User B Y.Doc maps: `annotations=0`, `callouts=0`
- The harness reported `reloadProof.pass: true`.

## Tests

Required tests:

```bash
node --test \
  tests/phase29/identityContract.test.mjs \
  tests/phase29/echoLoopGuard.test.mjs \
  tests/crdtCalloutBridge.test.mjs \
  tests/annotationLocalHistory.test.mjs \
  tests/annotationSyncDelta.test.mjs
```

Result: 37 passed, 0 failed.

Build:

```bash
npm run build
```

Result: passed. Existing warnings only: Vite CJS API deprecation, pdf.js eval warning, existing dynamic/static import chunk warnings, and large bundle warning.

Harness:

```bash
FIX20_BASE_URL=http://localhost:5174/ FIX20_DOCUMENT_ID=3c76c311-8f48-403e-9259-0d597a10a116 node scripts/fix20-multi-user-collab-contract-e2e.mjs
```

Result: passed.

## Remaining Limitations

- The live proof covers rectangle, callout, and counter. It does not cover imported PDF-native Squiggly because that work is explicitly deferred.
- The harness uses DEV-only auth override only. It no longer uses PDF-byte overrides.
- Console may still show unrelated aborted HEAD requests from app startup preflight; storage PDF GETs completed with 200 for both collaborators.

## Collaborator Storage Access Correction

Status: accepted by live harness proof on 2026-05-13.

### Root Cause

`documents.file_path` stores PDFs under the owner path, for example:

```text
170d915c-5741-4e0b-b03f-deaeedae27bd/fix20-multi-user/20260513012243.pdf
```

The app opens a document by reading the document row, then calling:

```js
supabase.storage.from('documents').download(filePath)
```

Fix 20 already made the `documents` row visible to active collaborators, but the `storage.objects` SELECT policy for the `documents` bucket still only allowed:

```sql
bucket_id = 'documents'
AND (storage.foldername(name))[1] = auth.uid()::text
```

That preserves owner access but blocks collaborators because the first path segment is the owner id, not the collaborator id.

### Files Changed

- `supabase/migrations/20260513003000_allow_collaborators_to_read_document_storage.sql`
- `src/App.jsx`
- `scripts/fix20-multi-user-collab-contract-e2e.mjs`
- `src/lib/collab/SupabaseYjsProvider.js`
- `tests/phase28/SupabaseYjsProvider.test.mjs`
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-12.md`

### Migration / Policy Added

Migration applied to the linked Supabase project:

```sql
CREATE POLICY "Document collaborators can read accessible document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.user_can_access_document(d.id, 'viewer')
    )
  );
```

This is read-only. It does not make the bucket public, and it does not grant write/update/delete. It only allows authenticated users to read a storage object when that object name matches a document row they can view.

Remote policy proof:

```text
policyname: Document collaborators can read accessible document files
cmd: SELECT
qual: bucket_id = 'documents' AND EXISTS (... d.file_path = objects.name AND user_can_access_document(d.id, 'viewer'))
```

### PDF-Byte Override Removed

The accepted harness path does not use `__fix20DocumentOverride`.

Changes:

- Removed the `__fix20DocumentOverride` branch from DEV `window.__fix20OpenDocumentById`.
- Removed the owner download/base64 injection from `scripts/fix20-multi-user-collab-contract-e2e.mjs`.
- Added a harness assertion that fails if `localStorage.__fix20DocumentOverride` is present.
- Added browser response capture for real Supabase storage downloads.

Search proof:

```text
scripts/fix20-multi-user-collab-contract-e2e.mjs only references __fix20DocumentOverride to assert it is absent.
src/App.jsx has no __fix20DocumentOverride path.
```

### Accepted Document

- Document id: `3c76c311-8f48-403e-9259-0d597a10a116`
- Name: `Fix20 Multi User Contract 20260513012243.pdf`
- File path: `170d915c-5741-4e0b-b03f-deaeedae27bd/fix20-multi-user/20260513012243.pdf`
- Log folder: `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-13_02-11-59_fix20-multi-user-collab`

### Storage Download Proof

The accepted harness observed real browser responses from Supabase Storage:

User A:

```json
{
  "label": "A",
  "status": 200,
  "url": "https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/documents/170d915c-5741-4e0b-b03f-deaeedae27bd/fix20-multi-user/20260513012243.pdf",
  "ts": "2026-05-13T02:12:03.061Z"
}
```

User B:

```json
{
  "label": "B",
  "status": 200,
  "url": "https://cvamwtpsuvxvjdnotbeg.supabase.co/storage/v1/object/documents/170d915c-5741-4e0b-b03f-deaeedae27bd/fix20-multi-user/20260513012243.pdf",
  "ts": "2026-05-13T02:12:06.138Z"
}
```

Harness evidence:

```json
{
  "storageDownloadProof": {
    "usedPdfByteOverride": false,
    "A": { "pass": true, "usedPdfByteOverride": false },
    "B": { "pass": true, "usedPdfByteOverride": false }
  }
}
```

### Collaboration Proof Still Passing

Accepted run:

```bash
FIX20_BASE_URL=http://localhost:5174/ FIX20_DOCUMENT_ID=3c76c311-8f48-403e-9259-0d597a10a116 node scripts/fix20-multi-user-collab-contract-e2e.mjs
```

Result:

```text
[fix20] PASS. Evidence: /Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-13_02-11-59_fix20-multi-user-collab
```

Created ids:

- User A rectangle: `fix20-a-rect-1778638327341`
- User A callout: `fix20-a-callout-1778638327341`
- User B counter: `fix20-b-counter-1778638327341`

Proof retained:

- User B saw User A rectangle live.
- User B could not move/delete User A rectangle.
- User B saw User A callout live.
- User B could not move/delete User A callout.
- User A saw User B counter live.
- User A undo removed only User A callout, then only User A rectangle.
- User B undo removed only User B counter.
- Reload restored the final empty state for both clients.
- Supabase rows for created ids were empty after owner-scoped undos.
- `noFullPageFanOut: true`.

Delta proof from accepted run:

- Rectangle create: `changedCount=1`, `dispatchedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.
- Callout create: `changedCount=1`, `dispatchedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.
- Counter create: `changedCount=1`, `dispatchedCount=1`, `supabaseUpsertCount=1`, `yDocUpdateCount=1`, `fullFanOutReason=null`.
- User A rectangle undo: `deletedIds=["fix20-a-rect-1778638327341"]`, `dispatchedCount=1`, `supabaseUpsertCount=0`, `fullFanOutReason=null`.
- User B counter undo: `deletedIds=["fix20-b-counter-1778638327341"]`, `dispatchedCount=1`, `supabaseUpsertCount=0`, `fullFanOutReason=null`.

### Y.Doc Warning Explanation / Fix

The warning was real:

```text
SupabaseYjsProvider sync_request reply failed Unexpected end of array
```

Root cause: `syncProtocol.writeSyncStep2` was called with arguments in the wrong order. The code passed `(encoder, remoteStateVector, ydoc)` instead of `(encoder, ydoc, remoteStateVector)`.

Fix:

```js
syncProtocol.writeSyncStep2(reply, ydoc, remoteSV);
```

Why collaboration still worked before the fix: the tested annotation flow also uses Supabase row realtime and normal Y.Doc update fan-out after durable Supabase writes. Those paths were working, so live collaboration and reload proof passed. The broken path was the initial Yjs state-vector reply used when a peer asks for missing Y.Doc state.

Regression test added:

```bash
node --test tests/phase28/SupabaseYjsProvider.test.mjs
```

Result: 6 passed, 0 failed.

Accepted harness after the fix contains no `sync_request reply failed` lines:

```bash
rg -n "sync_request reply failed" Logs/2026-05-13_02-11-59_fix20-multi-user-collab/evidence.json Logs/2026-05-13_02-11-59_fix20-multi-user-collab/console.log
```

Result: no matches.

### Test Command And Result

Required tests:

```bash
node --test \
  tests/phase29/identityContract.test.mjs \
  tests/phase29/echoLoopGuard.test.mjs \
  tests/crdtCalloutBridge.test.mjs \
  tests/annotationLocalHistory.test.mjs \
  tests/annotationSyncDelta.test.mjs
```

Result: 37 passed, 0 failed.

Additional focused Y.Doc provider test:

```bash
node --test tests/phase28/SupabaseYjsProvider.test.mjs
```

Result: 6 passed, 0 failed.

Updated live harness:

```bash
FIX20_BASE_URL=http://localhost:5174/ FIX20_DOCUMENT_ID=3c76c311-8f48-403e-9259-0d597a10a116 node scripts/fix20-multi-user-collab-contract-e2e.mjs
```

Result: passed.

### Build Result

```bash
npm run build
```

Result: passed. Existing warnings only: Vite CJS API deprecation, pdf.js eval warning, existing dynamic/static import chunk warnings, and large bundle warning.
