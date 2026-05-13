# Annotation Fix 8 - Source Of Truth Contract Log

Date: 2026-05-10

## Summary

The cutover/sealed hydration path treated Y.Doc as authoritative when `documents.cutover_completed_at` was set. That was fast, but it could hide durable Supabase rows when the local Y.Doc/IndexedDB snapshot was empty or stale. The save path also still had Phase 31 CRDT-only gating around normal Fabric Supabase writes, which meant Y.Doc could become the only current copy for some annotation saves.

The fix makes Supabase the durable source for reload/cross-device use and keeps Y.Doc as the fast live collaboration cache.

Correction, 2026-05-10: callouts were still saving in the old order: Y.Doc fan-out first, then `upsertCallouts(...)`. That allowed a callout to appear in live/local Y.Doc state even if the durable Supabase write later failed. Callout save/delete now uses the same contract as normal Fabric annotations: Supabase first, then Y.Doc fan-out only after durable success.

## Files Inspected

- `src/hooks/useAnnotationCloudSync.js`
- `src/services/annotationCloudSync.js`
- `src/services/documentAnnotationService.js`
- `src/services/annotationTypeSerializers.js`
- `src/lib/collab/crdtAnnotationBridge.js`
- `src/hooks/useAnnotationsCRDT.js`
- `src/App.jsx`
- `src/main.jsx`
- `src/lib/collab/featureFlags.js`
- `tests/phase31/legacyBulkUpsertGate.test.mjs`
- `src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs`
- `tests/annotationInitialHydrationSource.test.mjs`
- `tests/annotationHydrationGate.test.mjs`
- `tests/crdtCalloutBridge.test.mjs`
- `tests/calloutSyncPayload.test.mjs`
- `tests/calloutRemovalIntent.test.mjs`
- Supabase migrations for `document_annotations` and survey realtime tables

## Files Changed

- `src/hooks/useAnnotationCloudSync.js`
- `src/lib/collab/featureFlags.js`
- `tests/phase31/legacyBulkUpsertGate.test.mjs`
- `src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs`
- `ANNOTATION_FIX_8_SOURCE_OF_TRUTH_CONTRACT_LOG.md`

## Source-Of-Truth Rule After Fix

Supabase `document_annotations` is the durable source of truth for app reloads, app close/reopen, and cross-device open.

Y.Doc is the fast local/live collaboration state. On initial hydrate for a cutover-sealed document:

1. Materialize Y.Doc so we can inspect the live/cache state.
2. Fetch the Supabase durable snapshot before releasing the annotation hydration gate.
3. If Supabase is readable and there are no queued local annotation writes, use the Supabase snapshot for visible state.
4. Reshape Y.Doc to match that Supabase snapshot so live collaboration continues from the durable state.
5. If Supabase cannot be read, or local annotation writes are queued, keep Y.Doc temporarily and log why.

Normal Fabric saves/deletes now always persist to Supabase, then fan out to Y.Doc. Callout saves/deletes follow the same order through `upsertCallouts(...)` / `deleteAnnotations(...)`, then the dedicated Y.Doc callout bridge. The old `pdf_app_legacy_bulk_upsert` flag remains as a diagnostic/rollback signal, but it no longer disables durable Supabase persistence.

## Y.Doc And Supabase Interaction

- Hydrate: Supabase durable snapshot wins initial load when readable and no pending local queue exists.
- Save: Supabase write/delete runs first for durable persistence; Y.Doc fan-out follows for live collaboration. This includes callouts.
- Callout failure handling: if callout Supabase upsert/delete fails, the hook queues a durable retry and does not update Y.Doc as if the change is durable. If Supabase succeeds and the Y.Doc fan-out fails, the hook queues a Y.Doc repair only; durable state remains correct.
- Realtime: Supabase realtime still updates local state for non-highlight rows. Same-session echoes are filtered by `clientSessionId`.
- Conflict/stale protection: queued local writes prevent Supabase from overwriting Y.Doc during initial source selection. Empty Supabase reads still go through `loadCloudWithEmptyVerify` before the UI accepts an empty durable snapshot.

## Survey And Region Exceptions

- Survey highlights remain on the existing highlight path in `documentAnnotationService.js` and hydrate from Supabase with source `supabase-highlight`.
- Legacy Fabric-carrying highlight rows are intentionally excluded from the general non-highlight Fabric path to avoid double-rendering survey highlights.
- Region and survey-region annotations are regular Fabric/callout objects with `spaceId`/`regionId` metadata. They follow the same durable Supabase rule. Their mode-specific visibility remains controlled by `annotationVisibilityRules`, not by a separate persistence rule.
- Space/region definitions themselves are still part of the survey/template state path, not `document_annotations`.

## Manual Test Steps And Results

Dev server: `http://localhost:5175/` for the correction run because ports 5173 and 5174 were already in use. Dev auto-login was already configured.

1. Opened `test.pdf`.
   - Result: the app auto-logged in and loaded the PDF.
   - Important result: Y.Doc materialized as empty, Supabase returned 115 rows, and hydration selected `supabase-durable-snapshot` before releasing the visual cover.

2. Created a rectangle through the Shapes toolbar.
   - Result: UI created annotation `0c89892e-5d56-4b39-bb8a-95f4a81dda35`.
   - Supabase persistence completed with `rowsByType` including `square: 1`.
   - A signed Supabase query confirmed the row existed as `annotation_type: square`.

3. Deleted the test rectangle from Supabase and reopened `test.pdf`.
   - Result: Supabase returned the baseline durable snapshot again: 113 Fabric objects and 2 callouts.
   - The deleted rectangle id was not present after reopen.

4. Created a callout through Text -> Callout after the correction.
   - Result: UI created callout `callout-3ogeg5t5z-mozst7el`.
   - Supabase upsert started first, `upsertCallouts` succeeded, and Y.Doc fan-out happened after the Supabase success log.
   - Reloaded `test.pdf`.
   - Result: the new callout row still existed in Supabase and hydrate selected `supabase-durable-snapshot` with `calloutCount: 2`.

5. Deleted that callout through the UI and reloaded `test.pdf`.
   - Result: Supabase delete started first and succeeded.
   - The remaining callout snapshot was upserted, then Y.Doc fan-out deleted `callout-3ogeg5t5z-mozst7el`.
   - Reloaded `test.pdf`.
   - Result: the deleted callout row did not return. Hydration again came from `supabase-durable-snapshot`, now with the baseline `calloutCount: 1`.

6. Survey highlight path.
   - Result: `test.pdf` had `supabase-highlight` hydrate with `count: 0`. This confirms the survey path completed independently from normal annotations on this document, but no survey highlight was created in this run.

## Console / Network Log Excerpts

Initial reopen with stale/empty Y.Doc:

```text
[CloudSync][hydrate] loadAllNonHighlightAnnotations ok {"totalRows":115,"rowsByType":{"callout":2,"counter":112,"ink":1},"pagesWithObjects":1,"calloutCount":2}
[CloudSync][source-of-truth] cutover initial hydrate selected Supabase durable snapshot {"ydocFabricCount":0,"ydocCalloutCount":0,"supabaseFabricCount":113,"supabaseCalloutCount":2,"rule":"Supabase durable snapshot wins initial load; Y.Doc is reshaped for live collaboration"}
[AnnotationHydrationGate][normal] {"ready":true,"source":"supabase-durable-snapshot","count":113,"calloutCount":2}
```

Rectangle save:

```text
[Phase31 UAT] save:start {"route":"supabase-durable-then-crdt","currentTotal":114,"priorTotal":113,"deltaTotal":1}
[CloudSync][push] upsertAnnotationsByPage start {"totalRows":114,"rowsByType":{"counter":112,"ink":1,"square":1}}
[CloudSync][push] upsertAnnotationsByPage ok {"rowsReturned":114}
[Phase31 UAT] save:fan-out done {"resolvedTypeBreakdown":{"counter":83,"square":1},"yMapSizeAfter":114}
```

Callout save:

```text
[CloudSync][hook] callout state changed — debounce push scheduled {"count":2,"priorCount":1,"isCalloutWipePush":false,"deferredUntilPointerUp":false,"debounceMs":800}
[CloudSync][hook] callout Supabase upsert start {"count":2,"deletedCount":0}
[CloudSync][push] upsertCallouts start {"documentId":"484e4280-bca3-4ebe-bde7-d9371da0f528","userId":"170d915c-5741-4e0b-b03f-deaeedae27bd","count":2}
[CloudSync][push] upsertCallouts ok {"elapsedMs":121,"rowsReturned":2}
[CloudSync][hook] callout Supabase upsert ok {"count":2}
[CloudSync][hook] callout Y.Doc fan-out start after Supabase success {"count":2,"deletedCount":0}
[CloudSync][hook] callout Y.Doc fan-out done {"upserted":2,"deleted":0,"yMapCalloutsSizeAfter":2}
[CloudSync][hook] callout push synced {"count":2}
```

Callout delete:

```text
[CloudSync][hook] callout Supabase delete start {"count":1,"firstFew":["callout-3ogeg5t5z-mozst7el"]}
[CloudSync][hook] callout Supabase delete ok {"count":1,"firstFew":["callout-3ogeg5t5z-mozst7el"]}
[CloudSync][hook] callout Supabase upsert start {"count":1,"deletedCount":1}
[CloudSync][push] upsertCallouts ok {"elapsedMs":62,"rowsReturned":1}
[CloudSync][hook] callout Supabase upsert ok {"count":1}
[CloudSync][hook] callout Y.Doc fan-out start after Supabase success {"count":1,"deletedCount":1}
[CloudSync][hook] callout Y.Doc fan-out done {"upserted":1,"deleted":1,"yMapCalloutsSizeAfter":1}
[CloudSync][hook] callout push synced {"count":1}
```

Delete/reopen:

```text
[CloudSync][hydrate] loadAllNonHighlightAnnotations ok {"totalRows":114,"rowsByType":{"counter":112,"callout":1,"ink":1},"calloutCount":1}
[AnnotationHydrationGate][normal] {"ready":true,"source":"supabase-durable-snapshot","count":113,"calloutCount":1}
```

## Automated Test Commands And Results

```bash
node --check src/hooks/useAnnotationCloudSync.js
```

Result: passed.

```bash
npm test -- tests/phase31/legacyBulkUpsertGate.test.mjs tests/annotationInitialHydrationSource.test.mjs tests/annotationHydrationGate.test.mjs tests/crdtCalloutBridge.test.mjs
```

Result: the project test script expands to all `tests/**/*.test.mjs`; full Node suite passed: 553 tests, 547 passed, 6 skipped, 0 failed.

```bash
node --test tests/phase31/legacyBulkUpsertGate.test.mjs tests/crdtCalloutBridge.test.mjs tests/calloutSyncPayload.test.mjs tests/calloutRemovalIntent.test.mjs tests/annotationInitialHydrationSource.test.mjs tests/annotationHydrationGate.test.mjs
```

Result after the callout correction: passed, 32 tests, 0 failed. This includes the focused source-order assertion that `upsertCallouts(...)` runs before `fanOutCrdtForCallouts(...)`.

```bash
node --test tests/phase31/legacyBulkUpsertGate.test.mjs tests/crdtCalloutBridge.test.mjs tests/calloutSyncPayload.test.mjs tests/calloutRemovalIntent.test.mjs tests/annotationInitialHydrationSource.test.mjs tests/annotationHydrationGate.test.mjs src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs
```

Result after updating the callout hook contract test comments: passed, 37 tests, 0 failed.

```bash
npm run build
```

Result: passed. Vite emitted existing warnings about PDF.js `eval`, dynamic/static import overlap, and large chunks.

## Remaining Risks / Follow-Up

- This fix intentionally adds a Supabase read to cutover-sealed initial hydrate so stale Y.Doc cannot hide durable data. Large-document loading should be watched, but `loadAllNonHighlightAnnotations` already uses paged concurrent reads.
- UI callout create/save/reload and UI callout delete/reload were verified after the correction.
- The existing `isLegacyBulkUpsertEnabled` naming/comments in `featureFlags.js` are now historically misleading. I left the module intact to avoid wider churn.
