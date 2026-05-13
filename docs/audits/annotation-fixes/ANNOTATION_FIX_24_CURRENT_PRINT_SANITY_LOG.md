# Annotation Fix 24 Current Print Sanity Log

Date: 2026-05-13

## Root Causes

- Counter print mismatch: `savePDFWithFlattenedRegularAnnotationsForPrint` routed `data.type === "counter"` objects through the generic circle/ellipse `drawEllipse` path and only drew the number afterward. That lost the app renderer geometry from `renderCounter`: filled badge circle plus tangent nub/pointer.
- Marquee delete resurrection: explicit marquee/bulk delete saves carried `source: "object:modified"`, `action: "delete"`, and `deletedIds`, but `useAnnotationCloudSync` treated the large shrink like a stale-cache wipe because the shrink suppressor did not distinguish explicit user delete IDs from diff-detected missing IDs.
- Runtime follow-up found large Supabase deletes could fail as a single `.in()` request. `deleteAnnotations` now chunks large ID lists so marquee deletes can complete before Y.Doc fan-out.

## Files Changed

- `src/utils/pdfAnnotationsPdfLib.js`
- `src/hooks/useAnnotationCloudSync.js`
- `src/utils/annotationSyncDelta.js`
- `src/services/annotationCloudSync.js`
- `tests/pdfSaveExportContract.test.mjs`
- `tests/annotationSyncDelta.test.mjs`
- `tests/eraserSaveHistorySyncContracts.test.mjs`

## Runtime Verification

Opened `Package 2 - Rev 4 -- IC.pdf` in the dev app at `http://127.0.0.1:5173/`.

Print flattening runtime log:

```text
[PDFPrintFlatten] counter pin path flattened {"id":"runtime-counter-pin","radius":16,"pointerAngle":225,"displayNumber":24}
[PDFPrintFlatten] pdf bytes generated {"actionType":"pdf-print-flattened-regular-annotations","documentId":"runtime-fix24","pdfBytesGenerated":true,"byteLength":6301986,"flattenedPrintAnnotationsAdded":2,"regularAnnotationsIncluded":2,"scopedAnnotationsExcluded":0,"printableDiagnostics":{"included":{"fabric":2,"callouts":0,"counters":1},"excluded":{"fabric":0,"callouts":0,"counters":0,"surveyHighlights":0,"importedPdfNativePreserved":0},"excludedByScope":{"survey":0,"region":0,"space":0,"survey-region":0}}}
```

Bulk delete runtime log:

```text
[CloudSync][hook] explicit fabric delete ids accepted {"source":"fabric-save-action","action":"delete","count":655,"firstFew":["ink-1777998601208-kdnyhb0az","ink-1777998601208-epclq5ez8","ink-1777998601208-2uv3tei2d","ink-1777998601208-nfaefh61d","ink-1777998601208-vi7jyyypv"]}
[CloudSync][delta] fabric prepared {"actionType":"delete","changedIds":[],"deletedIds":[...],"changedObjectCount":0,"changedCount":0,"dispatchedCount":655,"supabaseUpsertCount":0,"yDocUpdateCount":0,"debounceMs":800,"debounceElapsedMs":803,"fullFanOutReason":null,"totalObjectCount":2144,"priorObjectCount":2799,"preciseSource":null,"preciseDeletedCount":null,"preciseChangedCount":null}
[CloudSync][hook] eraser/delete detected — removing rows from cloud {"count":655,"firstFew":["ink-1777998601208-kdnyhb0az","ink-1777998601208-epclq5ez8","ink-1777998601208-2uv3tei2d","ink-1777998601208-nfaefh61d","ink-1777998601208-vi7jyyypv"]}
[CloudSync] deleteAnnotations ok {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","count":655,"chunks":4}
[Phase31 UAT] delete:fan-out done {"documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86","pdfId":"Package 2 - Rev 4 -- IC.pdf-6291605","userId":"170d915c-5741-4e0b-b03f-deaeedae27bd","actionType":"delete","requested":655,"deleted":655,"yDocUpdateCount":655,"yMapSizeAfter":2144}
[CloudSync][status] transition {"from":"syncing","to":"synced","kind":"fabric","phase":null,"count":0,"queued":false,"error":null}
```

After waiting for sync to settle, the selected annotations stayed removed. The runtime Y.Doc count dropped from 2799 to 2144.

No `stale-cache shrink suppressed` or `re-hydrate after suppress` log appeared for the explicit delete.

## Test Results

```text
node --test tests/pdfSaveExportContract.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs
1..42
# tests 42
# pass 42
# fail 0
```

```text
node --test tests/annotationVisibilityRules.test.mjs tests/annotationContractRegression.test.mjs
1..14
# tests 30
# pass 30
# fail 0
```

```text
npm run build
✓ built in 22.35s
```

## 2026-05-13 Save / Sync Status Follow-Up

Scope: this pass intentionally did not change the custom print/export UI. The fix targets normal app-state Save / Cmd+S never settling the shared CloudSync status after successful annotation writes.

### Root Cause

`src/App.jsx` correctly calls `cloudSyncForceFlush()` during normal Save, but `src/hooks/useAnnotationCloudSync.js` `forceFlush()` was not using the same pending fabric/callout flush runner path as the debounce. It could clear timers and perform durable work directly from `lastByPageRef` / `lastCalloutsRef`, which meant the status transition path that normally ends in `synced` was unreliable.

Runtime verification also exposed a related regression: if the debounce had already synced the user's one-object change before Save, `forceFlush()` had no pending runner and re-upserted the entire annotation set. On the current cloud-backed test PDF, that attempted a 2,380-row write and timed out, leaving manual save status queued instead of settling.

### Files Changed

- `src/hooks/useAnnotationCloudSync.js`
- `tests/syncStatusUi.test.mjs`

### Runtime Verification

Opened `Package 2 - Rev 4 -- IC.pdf` in the dev app at `http://localhost:5173/`.

Created a pen stroke and counter pin. The normal debounce path persisted each as a one-row Supabase write:

```text
[CloudSync][push] upsertAnnotationsByPage start {"actionType":"path:created","changedIds":["406103da-344f-4290-9689-e02e8b356d5e"],"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"totalRows":1,"rowsByType":{"ink":1}}
[CloudSync][push] upsertAnnotationsByPage ok {"actionType":"path:created","supabaseUpsertCount":1,"rowsReturned":1}
[CloudSync][status] transition {"from":"syncing","to":"synced","kind":"fabric","count":1,"queued":false,"error":null}
[CloudSync][push] upsertAnnotationsByPage start {"actionType":"counter:create","changedIds":["3417dbb0-8fda-4c69-96c7-3c0b25991668"],"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"totalRows":1,"rowsByType":{"counter":1}}
[CloudSync][push] upsertAnnotationsByPage ok {"actionType":"counter:create","supabaseUpsertCount":1,"rowsReturned":1}
[CloudSync][status] transition {"from":"syncing","to":"synced","kind":"fabric","count":1,"queued":false,"error":null}
```

Pressed Cmd+S after debounce had already settled. `forceFlush()` no longer re-upserted the full 2,189-object set; it preserved synced state and still emitted the manual-save synced transition:

```text
[PDFSaveExport] action start {"actionType":"app-state-save","documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86"}
[CloudSync][forceFlush] start {"hasPendingFabric":false,"hasPendingCallout":false,"fabricObjectCount":2189,"calloutObjectCount":0,"queueBefore":0}
[CloudSync][forceFlush] no pending work; preserving synced state
[CloudSync][forceFlush] synced {"consumedPendingFabric":false,"consumedPendingCallout":false,"directFabricRows":0,"directCalloutRows":0,"fabricObjectCount":2189,"calloutObjectCount":0,"queueBefore":0,"queueRemaining":0}
[CloudSync][status] transition {"from":"synced","to":"synced","kind":"manual-save","count":0,"queued":false,"error":null}
[PDFSaveExport] action complete {"actionType":"app-state-save","supabaseAnnotationSaveRan":true,"supabaseAnnotationSaveError":null}
```

Created another counter and triggered Save 77 ms after creation, before the 800 ms debounce elapsed. `forceFlush()` consumed the pending fabric runner, wrote only the changed counter to Supabase/Y.Doc, and settled the chip back to "Up to date":

```text
[PDFSaveExport] action start {"actionType":"app-state-save","documentId":"d30ac66b-5d2e-4a93-aab3-8fdd84a0af86"}
[CloudSync][forceFlush] start {"hasPendingFabric":true,"hasPendingCallout":false,"fabricObjectCount":2190,"calloutObjectCount":0,"queueBefore":0}
[CloudSync][forceFlush] consuming pending fabric flush
[CloudSync][push] upsertAnnotationsByPage start {"actionType":"counter:create","changedIds":["5f83022e-0f04-4c24-a671-96b01954afe9"],"changedCount":1,"dispatchedCount":1,"supabaseUpsertCount":1,"debounceMs":800,"debounceElapsedMs":77,"totalRows":1,"rowsByType":{"counter":1}}
[CloudSync][push] upsertAnnotationsByPage ok {"actionType":"counter:create","supabaseUpsertCount":1,"rowsReturned":1}
[CloudSync][status] transition {"from":"syncing","to":"synced","kind":"fabric","count":1,"queued":false,"error":null}
[CloudSync][forceFlush] synced {"consumedPendingFabric":true,"consumedPendingCallout":false,"directFabricRows":0,"directCalloutRows":0,"fabricObjectCount":2190,"calloutObjectCount":0,"queueBefore":0,"queueRemaining":0}
[CloudSync][status] transition {"from":"synced","to":"synced","kind":"manual-save","count":0,"queued":false,"error":null}
[PDFSaveExport] action complete {"actionType":"app-state-save","supabaseAnnotationSaveRan":true,"supabaseAnnotationSaveError":null}
[CloudSync][status] transition-visible {"from":"synced","to":"synced","kind":"manual-save","visibleDelayMs":371}
```

After reload, page 1 annotations remained present and the sync status chip read `Up to date · Click to sync now`.

Deferred note: the default OS iframe print-preview path was not re-tested in this pass because this pass was scoped to the Save / sync-status regression only.

### Test Results

```text
node --test tests/syncStatusUi.test.mjs tests/pdfSaveExportContract.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs
1..51
# tests 51
# pass 51
# fail 0
```

```text
npm run build
✓ built in 28.48s
```
