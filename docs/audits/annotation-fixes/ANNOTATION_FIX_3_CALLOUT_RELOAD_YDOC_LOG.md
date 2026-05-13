# Annotation Fix 3: Callout Reload Y.Doc Persistence

Date: 2026-05-10

## Root Cause

Cutover-sealed documents hydrate visible annotations from Y.Doc and skip legacy Supabase row hydrate. Callout create/edit was still only pushing the separate `callouts[]` state slice to Supabase `document_annotations` rows through `upsertCallouts`; it did not write the active callout record into `ydoc.getMap('callouts')`.

That made the Supabase row durable, but reload used Y.Doc as source of truth and could not materialize the new callout. The provided logs match this: Supabase INSERT/UPDATE succeeded for `callout-7rtzwtxbf-moz3bbym`, while the later cutover hydrate still showed only the old Y.Doc callout count and did not include that id.

## Files Changed

- `src/lib/collab/crdtAnnotationBridge.js`
  - Added `applyCalloutCommit`, `applyCalloutDelete`, and `materializeCalloutFromYMap`.
  - Callout records now use the existing `ydoc.getMap('callouts')` path already tracked by the Yjs undo manager.
  - Author identity is preserved on edit; `lastEditorId` updates on each commit.

- `src/hooks/useAnnotationCloudSync.js`
  - Debounced callout push now writes create/edit/delete to Y.Doc and still pushes to Supabase rows.
  - Cutover-sealed hydrate now materializes `callouts[]` from `ydoc.getMap('callouts')`.
  - Hydrate also tolerates older backfilled callout-shaped entries in `ydoc.getMap('annotations')` and moves them into the React callout slice for rendering.
  - Delete fan-out removes the callout id from both `callouts` and legacy `annotations` maps so old backfilled callouts do not resurrect on reload.
  - Hydrate logs now include `yMapCalloutsSize` and `materializedCallouts`.

- `src/hooks/useAnnotationsCRDT.js`
  - Updated callout materialization to match the `callout` sub-map shape.

- `tests/crdtCalloutBridge.test.mjs`
  - Added focused Y.Doc tests for callout create, edit, delete, and reload-style materialization.

## Tests Run and Results

- `npm run build`
  - Passed.
  - Existing Vite warnings only: pdf.js eval warning, dynamic/static import chunk warnings, and large chunk warning.

- `npm test -- --runInBand`
  - Passed.
  - Summary: 525 tests, 519 passed, 6 skipped, 0 failed.
  - Existing Node module-type warnings appeared.

- Focused callout/Y.Doc-related run:
  - `npm test -- tests/crdtCalloutBridge.test.mjs tests/calloutSyncPayload.test.mjs tests/calloutRemovalIntent.test.mjs tests/calloutEditAdapter.test.mjs`
  - Passed. The script also ran the full `tests/**/*.test.mjs` suite because of the current npm test command shape.

## Manual Verification Steps

- Started the local dev app with `npm run dev`.
- Opened `http://localhost:5174/` with Playwright.
- Confirmed the app shell loads with no browser console errors.

The full cloud-backed PDF flow was not manually completed in this session because the specific logged-in Supabase document/PDF session was not available through the local browser context. Verification therefore relies on the provided logs plus unit/integration coverage for the fixed Y.Doc path.

## Supabase Push Status

Supabase row push remains in place. The callout push path still calls:

- `upsertCallouts(normalizeCalloutsForSync(pushCallouts), { documentId, userId, clientSessionId })`
- `deleteAnnotations(documentId, deletedCalloutIds)` for row deletes

The same-session realtime echo filtering remains unchanged because the Supabase row payload still carries `annotation_data.clientSessionId`.

## Y.Doc Hydrate Status

New callout create/edit/delete now writes to `ydoc.getMap('callouts')` before the durable Supabase row push. Cutover-sealed hydrate reads that map and sets React `callouts[]`, so a newly created callout is materializable after reload.

Expected log signal after manual cloud verification:

- callout push: `[CloudSync][hook] callout Y.Doc fan-out done` with `upserted >= 1`
- reload hydrate: `[Phase31 UAT] hydrate:cutover-sealed` with `yMapCalloutsSize` and `materializedCallouts` including the new callout

## Remaining Risks

- Older cutover docs may have legacy backfilled callouts inside `ydoc.getMap('annotations')`. Hydrate now reads them, but they remain in that old map until edited or deleted.
- If Supabase row push fails after the Y.Doc write, Y.Doc remains the live source of truth and the existing queue/status path handles the row backup failure.
- Full end-to-end confirmation on the exact cloud-backed PDF still needs a logged-in session with that document available.
