# Legacy Persistence Cleanup — Safety Audit
**Date:** 2026-06-06
**Scope:** Which items are safe to delete vs still-live vs test-coupled.
**Constraint:** Breaking working code is not acceptable. Breaking OLD data is acceptable.

---

## Summary Table

| Item | Classification | Exact Live Callers (file:line) | Test Files Affected | Recommendation |
|------|---------------|-------------------------------|---------------------|----------------|
| `src/utils/safeSnapshot.js` — `resolveSafeSnapshot` | **UNSAFE-STILL-LIVE** | PDFViewer.jsx:14988 (survey-marker hydrate effect), PDFViewer.jsx:17171 (storage sidecar survey load), PDFViewer.jsx:17202 (storage sidecar spaces load) | `tests/safeSnapshot.test.mjs`, `tests/annotationInitialHydrationSource.test.mjs` | Do NOT remove |
| `src/utils/safeSnapshot.js` — `mergePreservingImportedMarks` | **RISKY-TEST-COUPLED** | Only `src/hooks/useAnnotationCloudSync.js` (disabled hook) — zero live callers outside the disabled hook | `tests/mergePreservingImportedMarks.test.mjs`, `tests/pdfAnnotationImporter.test.mjs` (comment ref only) | Could remove export if hook is deleted; but only safe alongside the hook deletion |
| `src/utils/safeSnapshot.js` — `countSnapshotItems` | **UNSAFE-STILL-LIVE** | Internal to `safeSnapshot.js` (called by `resolveSafeSnapshot`); used in `tests/safeSnapshot.test.mjs` | `tests/safeSnapshot.test.mjs` | Do NOT remove (needed by `resolveSafeSnapshot`) |
| `useAnnotationCloudSync` (hook) | **RISKY-TEST-COUPLED** | Disabled (`enabled:false, hydrateEnabled:false`) — no live persistence/hydration. `cloudSyncStatus` + `cloudSyncQueueSize` from return value flow to `SyncStatusChip` via leftRailApi (PDFViewer:24812/24813, PDFViewer:24906/24907 → PDFSidebar:561/562), but with `enabled:false` `status` is permanently `{stage:'idle'}` → chip shows "Up to date" (cosmetically harmless, not wrong). | `tests/annotationInitialHydrationSource.test.mjs` (no skip guard — ENOENT kills run), `tests/syncStatusUi.test.mjs` (no skip guard — ENOENT kills run), `tests/eraserSaveHistorySyncContracts.test.mjs` (no skip guard), `tests/phase31/cutoverHydrate.test.mjs` (has existsSync skip guard — safe), `tests/phase31/legacyBulkUpsertGate.test.mjs` (has existsSync skip guard — safe), `tests/phase30/phase30-unit-suite.test.mjs` (bridges `src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs`) | **Cannot delete without first rewriting or removing the 3 no-skip-guard tests.** The hook itself is functionally inert, but 3 test files read it as raw text with no ENOENT guard — deleting the file crashes the entire test run. |
| `src/services/documentAnnotationService.js` | **UNSAFE-STILL-LIVE** | PDFViewer.jsx:70 (import), PDFViewer.jsx:14968 (`loadAnnotationsFromSupabase` — LIVE survey-marker hydration), PDFViewer.jsx:15316, 15442 (`syncAnnotationsToSupabase` — LIVE survey-marker save), PDFViewer.jsx:21053 (inline survey-marker save), PDFViewer.jsx:22608 (`deleteAnnotations` — LIVE), PDFViewer.jsx:15049/15074 (`updateDocumentPresence` — LIVE), PDFViewer.jsx:15124 (`removeDocumentPresence`), PDFViewer.jsx:15158 (`subscribeToDocumentAnnotations`), PDFViewer.jsx:11530 (`deleteAnnotations`); also `src/home/AccessManagementModal.jsx:23` (`getDocumentCollaborators`, `updateCollaboratorRole`, `removeDocumentCollaborator`), `src/Dashboard.jsx:20` (`countSurveyMarkersReferencingChecklistItem`), `src/hooks/useDocumentPresenceList.js:19` (`getDocumentPresence`, `subscribeToDocumentPresence`) | N/A | **MUST NOT remove** — survey markers have their entire SAVE + HYDRATE + DELETE + PRESENCE path through this service |
| `src/services/annotationCloudSync.js` | **UNSAFE-STILL-LIVE** | `src/components/collab/YDocProvider.jsx:92–94` (`upsertFabricAnnotation`, `loadAllNonSurveyMarkerAnnotations`, `deleteAnnotations`); YDocProvider.jsx:836 (live backfill hydrate), YDocProvider.jsx:937/1423 (live dual-write retry), YDocProvider.jsx:1197 (live cleanup deletion); also `src/hooks/useAnnotationCloudSync.js:44` (disabled hook — doesn't matter) | `src/services/__tests__/annotationCloudSync.dualWrite.test.mjs`, `tests/phase31/legacyBulkUpsertGate.test.mjs` | **MUST NOT remove** — YDocProvider (always-on CRDT layer) calls it on the live path for annotation backfill and the dual-write retry queue |
| `src/services/cloudSyncQueue.js` | **SAFE-TO-REMOVE** (conditional) | Only `src/hooks/useAnnotationCloudSync.js:51` — the disabled hook. No other live caller. | None directly. | Safe only if/when `useAnnotationCloudSync.js` is deleted. Cannot be removed independently while the hook file exists (build would fail). |
| `src/lib/collab/snapshotStore.js` | **RISKY-TEST-COUPLED** | Only `src/hooks/useAnnotationCloudSync.js:97` — the disabled hook. No other live caller outside it. | `src/lib/collab/__tests__/snapshotStore.watermark.test.mjs` (direct import, included in `npm test` via `src/**/__tests__/` glob) | Safe to remove only alongside the hook deletion AND after removing/rewriting the watermark test. |
| CRDT collab layer (`YDocProvider`, `crdtBackfill.js`, `ydocLifecycle.js`, `crdtDualWriteQueue.js`) | **UNSAFE-STILL-LIVE** | `src/AppShell.jsx:24/2389/2431` (YDocProvider wraps every open tab), `isCRDTEnabled()` defaults ON (no build-time disable set), `crdtBackfill` + `ydocLifecycle` called from within YDocProvider on every document open | Multiple — do not remove | **Active at runtime by default.** Leave alone. Removing OTHER legacy items (cloudSyncQueue, snapshotStore, useAnnotationCloudSync) does NOT affect this layer. |

---

## Detailed Findings Per Item

### 1. `src/utils/safeSnapshot.js`

**Exports:** `countSnapshotItems`, `resolveSafeSnapshot`, `mergePreservingImportedMarks`

#### `resolveSafeSnapshot` — UNSAFE-STILL-LIVE

Three independent live call sites in PDFViewer.jsx, all OUTSIDE the disabled hook:

- **PDFViewer.jsx:14988** — inside the survey-marker hydration `useEffect` (deps: `pdfFile?.id`, `user?.id`). Called with `context: 'survey-marker-hydrate'` immediately after `loadAnnotationsFromSupabase`. This is the primary live cloud hydration path.
- **PDFViewer.jsx:17171** — inside `loadSurveyDataFromSupabase` callback (Supabase Storage sidecar read, `context: 'supabase-storage-survey-markers'`). Called on document open.
- **PDFViewer.jsx:17202** — inside the same sidecar callback (`context: 'supabase-storage-spaces'`). Guards `setSpaces` from being blanked.

The `safeSnapshot.test.mjs` and `annotationInitialHydrationSource.test.mjs` both assert that `resolveSafeSnapshot` is present and used with the exact patterns above — removing these calls or the module would fail both tests and break the empty-hydrate protection on survey markers and spaces.

**Verdict: MUST NOT remove.**

#### `mergePreservingImportedMarks` — RISKY-TEST-COUPLED

The only src/ caller is `useAnnotationCloudSync.js` (the disabled hook, at lines 1063, 1371, 1450, 1513, 1564). The new `useAnnotationDoc` path does NOT call it. `annotationDocSync.js` does NOT call it.

`tests/mergePreservingImportedMarks.test.mjs` imports it directly and would break if removed. `tests/pdfAnnotationImporter.test.mjs` references it only in a comment (line 1148) — no import, no test breakage.

**Verdict: Can be removed IF AND ONLY IF the hook is deleted simultaneously, AND `tests/mergePreservingImportedMarks.test.mjs` is deleted or repointed. Not independently safe.**

---

### 2. `useAnnotationCloudSync` (src/hooks/useAnnotationCloudSync.js)

**Call site in PDFViewer.jsx:15654:**
```js
const {
  status: cloudSyncStatus,
  queueSize: cloudSyncQueueSize,
} = useAnnotationCloudSync({
  ...
  enabled: false,
  hydrateEnabled: false
});
```

**Return value consumption:**
- `cloudSyncStatus` → leftRailApi (PDFViewer:24812) → PDFSidebar → `SyncStatusChip` (PDFSidebar:561). With `enabled:false`, `status` stays `{stage:'idle'}` forever. `getSyncStatusViewModel({stage:'idle'}, 0)` → `{state: 'synced', label: 'Up to date'}`. Chip always shows green — cosmetically inert but not broken.
- `cloudSyncQueueSize` → same leftRailApi path → `SyncStatusChip` `queueSize` prop. With `enabled:false`, `queueSize` state stays 0. No offline-queue UI shown. Correct.

**The hook's own effects:** With `hydrateEnabled:false` the hydrate effect immediately returns (line 1016 guard: `if (!hydrateEnabled || ...) { ... return; }`). Push effects check `if (!enabled) return` on each effect. The hook is completely inert at runtime.

**Test-coupling (CRITICAL):**
These test files read `useAnnotationCloudSync.js` as raw text with `readFileSync` and NO `existsSync` skip guard:
1. `tests/annotationInitialHydrationSource.test.mjs:12` — module-level `readFileSync`, crashes the whole file on ENOENT
2. `tests/syncStatusUi.test.mjs:8` — lazy `hookSource()` function, but called from multiple tests, ENOENT crashes those tests
3. `tests/eraserSaveHistorySyncContracts.test.mjs:31,40` — two per-test reads, no skip guard

`tests/phase31/cutoverHydrate.test.mjs` and `tests/phase31/legacyBulkUpsertGate.test.mjs` both use `existsSync(HOOK_PATH)` as a skip guard — they would safely skip if the file were removed.

`src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs` is bridged via `tests/phase30/phase30-unit-suite.test.mjs` — this test uses grep-based assertions on hook source, it would throw on ENOENT.

**Verdict: Cannot delete without simultaneous test surgery on the 3 no-guard tests. The hook itself is inert. The blocker is the test infrastructure.**

---

### 3. Survey Markers — Are They on the Legacy Path?

**YES. Survey markers are ENTIRELY on the legacy (`documentAnnotationService.js`) path. This is the gating finding.**

Evidence:
- `loadAnnotationsFromSupabase` (documentAnnotationService.js) called at **PDFViewer.jsx:14968** — live survey-marker HYDRATION on document open.
- `syncAnnotationsToSupabase` (documentAnnotationService.js) called at **PDFViewer.jsx:15316** (debounced auto-sync) and **PDFViewer.jsx:15442** (flush-on-unload) — live survey-marker SAVE on every change.
- `syncAnnotationsToSupabase` called at **PDFViewer.jsx:21053** — inline save on new marker placement.
- `deleteAnnotations` (documentAnnotationService.js) called at **PDFViewer.jsx:22608** — live survey-marker DELETE.
- `subscribeToDocumentAnnotations` (documentAnnotationService.js) called at **PDFViewer.jsx:15158** — live real-time survey-marker SUBSCRIPTION.

The `annotationCloudSync.js` service explicitly carves out survey markers (comments at lines 5–10, 531, 742–743, 811): `"SurveyMarkers are intentionally NOT touched"`. The `dualWriteFabricCommit` export skips CRDT for survey-marker type.

The new `annotationDocSync.js` / `useAnnotationDoc` path has ZERO survey-marker code. Confirmed by grep returning nothing.

**Conclusion:** `documentAnnotationService.js`, `annotationCloudSync.js`, and all downstream services they depend on CANNOT be removed while survey markers are a live feature. `documentAnnotationService.js` is the primary owner of survey-marker persistence from top to bottom.

---

### 4. `src/lib/collab/snapshotStore.js`

**Only caller outside tests:** `src/hooks/useAnnotationCloudSync.js:97` — the disabled hook.

No live path reaches `snapshotStore.js` except through the disabled hook (which is fully inert). The `isSnapshotEnabled()` flag defaults OFF (`snapshotFeatureFlag.js` line 4: "DEFAULT OFF"), so even if the hook were re-enabled, the snapshot paths would be gated.

**Test coupling:** `src/lib/collab/__tests__/snapshotStore.watermark.test.mjs` imports `snapshotStore.js` directly. It is included in `npm test` via the `src/**/__tests__/*.test.mjs` glob. Deleting `snapshotStore.js` would cause ENOENT in that test.

**Verdict: RISKY-TEST-COUPLED.** Functionally dead (only disabled-hook import), but requires simultaneous deletion of `snapshotStore.watermark.test.mjs` to not break the test run. Cannot be removed independently.

---

### 5. CRDT Collab Layer (YDocProvider, crdtBackfill.js, ydocLifecycle.js, crdtDualWriteQueue.js)

**Status: ACTIVE AT RUNTIME.**

`isCRDTEnabled()` returns `true` by default (no `VITE_CRDT_LAYER_DISABLED` env var, no localStorage kill). `AppShell.jsx` wraps every open tab in `<YDocProvider docId={tab.file?.id}>` (lines 2389/2431). `YDocProvider` calls `runBackfill` (via `crdtBackfill.js`) and `attachLifecycle` (via `ydocLifecycle.js`) on document open.

**Does it feed `annotationsByPage`?** YES — via `useYDoc` / `YDocContext`, PDFViewer's undo/redo stack reads from it (PDFViewer:9338–9344). The Phase 29/30 dual-write queue (crdtDualWriteQueue) handles retries for annotation upserts via `upsertFabricAnnotation` (annotationCloudSync.js).

**Interaction with items being considered for removal:** Removing `cloudSyncQueue.js` (old offline queue), `snapshotStore.js`, and neutering/deleting `useAnnotationCloudSync` does NOT affect `YDocProvider`, `crdtBackfill`, `ydocLifecycle`, or `crdtDualWriteQueue`. Those are separate modules with no dependency on the legacy-only items. The CRDT layer can be left alone safely.

---

## Safe Removal Order (if proceeding)

Given the above findings, the only items that could be removed are:

1. **Nothing is independently safe to delete today** without either breaking survey markers, crashing `npm test`, or leaving a broken build.

2. **The smallest possible batch** that could be safe together (gated behind test surgery first):
   - Precondition: Rewrite/delete `tests/annotationInitialHydrationSource.test.mjs` tests that read `useAnnotationCloudSync.js` source (or replace those assertions with equivalent checks that don't require the file to exist).
   - Precondition: Rewrite/delete `tests/syncStatusUi.test.mjs` callout-debounce tests that grep hook source.
   - Precondition: Rewrite/delete `tests/eraserSaveHistorySyncContracts.test.mjs` tests that read hook source.
   - After preconditions: `useAnnotationCloudSync.js` + `cloudSyncQueue.js` + `snapshotStore.js` + `snapshotStore.watermark.test.mjs` + `mergePreservingImportedMarks.test.mjs` can be removed together.
   - The `SyncStatusChip` in PDFSidebar would then show a null status; the `cloudSyncStatus` leftRailApi slot would need to be replaced with a real status from `useAnnotationDoc` (which currently returns no status) or the chip props removed.

3. **`documentAnnotationService.js`** is NOT removable until survey markers migrate to the new `useAnnotationDoc`/`annotationDocSync` path. That is explicitly deferred to a future migration per `src/utils/annotationSyncType.js` and `annotationCloudSync.js` comments.

---

## Key Invariant

**Survey markers have their own complete persistence stack (documentAnnotationService.js) that is entirely separate from the new useAnnotationDoc/annotationDocSync path.** Any cleanup plan that touches `documentAnnotationService.js` or the functions it exports will break survey-marker save, load, delete, and real-time subscription.
