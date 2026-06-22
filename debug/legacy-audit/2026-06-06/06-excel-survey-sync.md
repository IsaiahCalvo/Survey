# Excel ↔ Survey Marker Sync Audit — 2026-06-06

**Investigator:** Claude Code (read-only — no code changed)
**Scope:** Root-cause analysis of "add does not persist, delete does persist" after reload with a linked Excel file.

---

## A. On-Open Execution Order — Everything That Sets `surveyMarkers`

The following sequence runs every time a cloud-backed PDF document is opened or the app reloads.

### Step 1 — PDF identity resolved → `setSurveyMarkers({})` (line 16856) or warm cache (line 16886–16888)

`src/PDFViewer.jsx:16771` — The large `pdfFile` effect fires.  
For **cloud-backed docs** (`pdfFile.id` present):

```js
// PDFViewer.jsx:16885-16888
const loadedSurveyMarkers = isCloudBackedDoc
  ? (isSamePdfReload ? previousSurveyMarkersForSamePdf : {})
  : loadSurveyMarkers(id);       // localStorage — local-only docs only
setSurveyMarkers(loadedSurveyMarkers);
```

**Cold open of a cloud-backed doc** → `surveyMarkers` is set to `{}` immediately.
**Same-doc reload in session** → warm ref snapshot is kept.
**Local-only docs** → localStorage `surveyMarkers_<pdfId>` is read via `loadSurveyMarkers()` (`src/viewerShared.js:1931`).

### Step 2 — `useAnnotationDoc` effect hydrates from the Y.Doc (async, then React commit)

`src/hooks/useAnnotationDoc.js:58-131` — When `enabled && documentId && userId`, this effect:

1. Opens the durable Y.Doc from `annotationDocSync`.
2. Reads `handle.getSurveyMarkers()` from the `surveyMarkers` Y.Map.
3. If `hasSurvey` (Y.Doc has non-empty state), calls `setSurveyMarkers(storeSurvey)` — **line 101**.
4. If the Y.Doc is empty but the viewer already has markers, seeds the Y.Doc from current state.

This is the **authoritative durable hydrate**. It calls `setSurveyMarkers` asynchronously after the async `openAnnotationDoc` call resolves. Any subsequent `setSurveyMarkers` call that runs after this one overwrites the durable state.

### Step 3 — Supabase presence/hydration effect fires (`pdfFile?.id` dep) (async, no-op for markers)

`src/PDFViewer.jsx:14902` — This effect used to SELECT `document_annotations` rows. As of the Y.Doc migration it is now a **no-op for markers**: it resolves `Promise.resolve({ surveyMarkers: {}, error: null })` immediately (line 14974) and never calls `setSurveyMarkers`. Its only remaining purpose is presence initialization.

### Step 4 — `loadLatestSurveyData` effect fires when `selectedTemplate?.linkedExcelPath` is set

`src/PDFViewer.jsx:12729-12734`:
```js
useEffect(() => {
  if (selectedTemplate?.linkedExcelPath) {
    loadLatestSurveyData();
  }
}, [selectedTemplate?.id, selectedTemplate?.linkedExcelPath, loadLatestSurveyData]);
```

`loadLatestSurveyData` (`src/PDFViewer.jsx:12677`) compares timestamps:
- Supabase template `updatedAt` vs the Excel file's `lastModifiedDateTime` (OneDrive) or `mtime` (local).
- If **Excel is newer**, it calls `handleSyncFromExcel()` after a 500 ms `setTimeout` (line 12718–12722).

`handleSyncFromExcel` (`src/PDFViewer.jsx:14154`) downloads the Excel file, parses it, and calls either `executeExcelImport` (line 14319) or — if new columns were found — shows `NewColumnsModal` first. **`executeExcelImport` calls `setSurveyMarkers(newSurveyMarkers)` at line 13452.**

### Step 5 — Live-sync polling / file-watcher (ongoing, not just on open)

For OneDrive files with `liveSyncEnabled`: a poll loop at 5 s intervals (`src/PDFViewer.jsx:14742`) calls `handleAutoSyncFromExcel()` when the ETag or cell data changes. For local files, an Electron file-watcher (`src/PDFViewer.jsx:14498–14548`) fires `handleAutoSyncFromExcel()` on any file change.

Both ultimately call `executeAutoExcelImport` → `setSurveyMarkers` on any detected change.

**Summary of writers to `setSurveyMarkers` on open (in order):**

| # | Source | When | Writes |
|---|--------|------|--------|
| 1 | `pdfFile` effect | Synchronous (first render batch) | `{}` or warm snapshot |
| 2 | `useAnnotationDoc` effect | ~async (Y.Doc open resolves) | Durable Y.Doc state |
| 3 | Supabase presence effect | ~async | **No-op** — does NOT write markers |
| 4 | `loadLatestSurveyData` | ~async after `selectedTemplate` is set | Calls `handleSyncFromExcel` if Excel is newer — full replace of `surveyMarkers` |
| 5 | File-watcher / live-sync poll | Ongoing | Calls `executeAutoExcelImport` → full replace |

---

## B. The Add Path vs The Delete Path — Exact Comparison

### ADD PATH: Drawing a new Survey Marker

When a user draws a new Survey Marker on the canvas:

1. `setSurveyMarkers(prev => ({ ...prev, [newId]: newMarker }))` is called (e.g. `src/PDFViewer.jsx:30783`, `30895`, etc.).
2. The `useAnnotationDoc` capture effect (`src/hooks/useAnnotationDoc.js:168–172`) fires because `surveyMarkers` changed:
   ```js
   useEffect(() => {
     const h = handleRef.current;
     if (!h || !readyRef.current) return;
     h.applySurveyMarkers(surveyMarkers);   // writes to Y.Doc
   }, [surveyMarkers]);
   ```
   So the new marker IS written to the durable Y.Doc.
3. The `saveSurveyMarkers(pdfId, surveyMarkers)` effect (`src/PDFViewer.jsx:16997–17003`) also writes to localStorage.
4. The Supabase sync effect (`src/PDFViewer.jsx:15233–15428`) debounces a 2 s upsert to `document_annotations`.
5. **There is no automatic push to the linked Excel file.** `hasPendingExcelSyncChanges` becomes `true` because the fingerprint changes (effect at line 9470), but no Excel write happens until the user explicitly saves (`handleSaveDocument`) or `pushToExcelWithRetry` is called. There is no automatic on-draw Excel push for additions.

### DELETE PATH: Erasing a Survey Marker

When a user erases a Survey Marker (`handleSurveyMarkerDeleted`, `src/PDFViewer.jsx:22398`):

1. `setSurveyMarkers(prev => { delete updated[id]; return updated; })` — line 22460.
2. **Immediately after**, if there is a linked Excel: `pendingExcelSyncAfterDeleteRef.current = true;` — line 22470.
3. The `useAnnotationDoc` capture effect fires, writing the deletion to the Y.Doc (the Y.Map entry for the deleted marker is removed via `syncSurveyMarkersToDoc` in `src/services/annotationDocStore.js:103–105`).
4. The effect at `src/PDFViewer.jsx:22631–22636` fires:
   ```js
   useEffect(() => {
     if (!pendingExcelSyncAfterDeleteRef.current) return;
     pendingExcelSyncAfterDeleteRef.current = false;
     if (!selectedTemplate?.linkedExcelPath) return;
     pushToExcelWithRetry();   // ← IMMEDIATELY pushes updated Excel to OneDrive/local
   }, [surveyMarkers, selectedTemplate?.linkedExcelPath, pushToExcelWithRetry]);
   ```
5. `pushToExcelWithRetry` calls `handleExportSurveyToExcel`, which **rebuilds the whole Excel workbook** from current `surveyMarkers` state and uploads/writes it. The deleted marker is gone from the workbook.
6. `markExcelSyncCheckpoint` is called, updating the baseline hash.

**Asymmetry in one sentence:**  
- A **delete** triggers an immediate automatic Excel re-export via `pendingExcelSyncAfterDeleteRef` + the effect at line 22631. The Excel file is updated within seconds.  
- An **add** does NOT trigger any automatic Excel push. `hasPendingExcelSyncChanges` becomes true, but no export happens until the user manually saves and responds to the `ExcelSyncConfirmModal` (or has `excelSyncPreference = 'always'`).

---

## C. Excel Reconcile Semantics — What the Import Actually Does

### Matching Key

Survey Markers are matched to Excel rows by **name string within scope** (`src/PDFViewer.jsx:13107–13112`):
```js
Object.entries(newSurveyMarkers).forEach(([key, ann]) => {
  const annModuleId = ann.moduleId || ann.spaceId;
  if (annModuleId === matchedModuleId &&
      ann.categoryId === matchedCategory.id &&
      annName === itemName) {           // ← name match, not ID match
    matchedSurveyMarkerKey = key;
  }
});
```

### For rows with a matching in-app marker
- Updates `excelRowIndex`, `checklistResponses`, `entityId/Name/Color`, `note.text`.
- Does NOT reset `pageNumber`, `bounds`, or the visual annotation on the canvas.
- Does NOT drop the marker.

### For Excel rows with NO matching in-app marker
- **Creates a new marker** with `pageNumber: null` and `bounds: null` (line 13224–13239). These are "data-only" markers with no visual position.
- This applies whether the row was added to Excel directly by a user editing the workbook or was always there.

### For in-app markers with NO matching Excel row
- **Lines 13247–13259**: If a marker's `moduleId+categoryId` scope was covered by the import (i.e. the Excel has a sheet for that category), and the marker's name is NOT in the Excel rows → it is added to `surveyMarkersToDelete`.
- Lines 13285–13303: A confirmation dialog fires only if ALL markers in a scope would be deleted.
- Lines 13306–13314: `delete newSurveyMarkers[key]` — the marker is removed.
- Line 13452: `setSurveyMarkers(newSurveyMarkers)` — the whole mutated dict replaces state.

**This is a REPLACE-within-scope**: for every sheet/category the import covers, it fully reconciles the in-app state against what Excel says. Any in-app marker whose name is not in the Excel sheet — for that scope — is deleted.

---

## D. ROOT CAUSE of the Add-Not-Persist Asymmetry

**Root cause statement:**

> When the user draws a new Survey Marker and does NOT export to Excel before reloading, the next open triggers `loadLatestSurveyData`, which compares Excel's `lastModifiedDateTime` against the template's `updatedAt`. Since the last export (before the add) updated the Excel file, the Excel timestamp is still newer than (or equal to) the template's `updatedAt`. The auto-import fires `handleSyncFromExcel` → `executeExcelImport`. The new marker has no row in the Excel file (it was never exported), so its name is absent from the Excel sheet. `executeExcelImport` scans the scope and classifies it as a deletion — line 13254–13257. It is deleted from `newSurveyMarkers` and the resulting dict is written via `setSurveyMarkers` (line 13452). This call lands **after** `useAnnotationDoc` has already hydrated from the Y.Doc (which did have the new marker), so the Y.Doc hydrate is silently overwritten by the Excel reconcile, and the new marker is lost.

The delete persists because the delete path pushes an Excel re-export immediately (effect at line 22631), so the Excel file reflects the deletion. On next open, Excel is again newer, the import runs, and the marker that was deleted is correctly absent from both sources — no resurrection.

**Why is there no resurrection for a delete?**
The Excel was updated to remove the row at delete time. So `loadLatestSurveyData` runs the import and the Excel rows are the same as the app state — nothing to resurrect.

**Why is there no persistence for an add?**
The Excel was never updated to add the row. `loadLatestSurveyData` runs the import and the Excel rows are missing the new marker's name. `executeExcelImport` treats the missing-from-Excel marker as a deletion and drops it from state.

**Secondary corruption path:**
After `executeExcelImport` calls `setSurveyMarkers(newSurveyMarkers)` (with the new marker absent), the `useAnnotationDoc` capture effect at `src/hooks/useAnnotationDoc.js:168–172` fires with the Excel-reconciled (marker-dropped) state. This calls `h.applySurveyMarkers(surveyMarkers)`, which calls `syncSurveyMarkersToDoc` (`src/services/annotationDocStore.js:92–123`). Because the new marker is no longer in `surveyMarkers`, `syncSurveyMarkersToDoc` deletes it from the Y.Doc (line 103–105). **The Y.Doc — the durable store — is now corrupted** by the Excel reconcile's false-positive deletion. Subsequent reloads will not have the marker even if the Excel import is somehow bypassed.

---

## E. The Intended Diff/Prompt Feature — What Exists vs What Is Missing

### What exists

**`excelSyncDirtyState.js`** (`src/utils/excelSyncDirtyState.js`)  
Computes an FNV-1a fingerprint of `{ template identity + surveyMarkers }`. Used by `computeHasPendingExcelSyncChanges` to set `hasPendingExcelSyncChanges: true` whenever `surveyMarkers` diverges from the baseline hash stamped at `markExcelSyncCheckpoint`.

**`ExcelSyncConfirmModal`** (`src/components/ExcelSyncConfirmModal.jsx`)  
Presented when the user explicitly saves (`handleSaveDocument`) and `hasPendingExcelSyncChanges` is true AND `excelSyncPreference !== 'always'` — lines 17402–17416. Offers three choices: save within Survey only, update Excel once, or always auto-sync. This is the **outbound gate** for app → Excel push.

**`NewColumnsModal`** (`src/components/NewColumnsModal.jsx` + logic at lines 14308–14316, 14476–14482)  
Presented when an Excel import detects new columns not present in the template. Pauses the import and asks the user to decide how to handle the schema change. This is schema-change protection only, NOT a data-loss prevention prompt.

**`markExcelSyncCheckpoint` / `clearExcelSyncCheckpoint`** (lines 9451–9467)  
Records the hash of the current state when an export completes. Cleared on template change or Excel unlink.

### What is missing — the gap that causes silent data loss

There is **no inbound diff/prompt**. The `ExcelSyncConfirmModal` only protects the outbound push (app → Excel). There is nothing equivalent for the inbound pull (Excel → app).

Specifically:

1. **`loadLatestSurveyData` does not check whether the app has un-exported additions before triggering `handleSyncFromExcel`.** It only compares timestamps. If the app has `hasPendingExcelSyncChanges = true` (uncommitted additions), the import runs anyway and wipes them.

2. **`executeExcelImport` and `executeAutoExcelImport` do not compare the incoming Excel state against `hasPendingExcelSyncChanges` or a saved baseline.** They unconditionally overwrite in-scope markers.

3. **The "Survey Marker added to app but not in Excel" case is silently treated as a deletion.** The user is never told that an in-app marker has no Excel counterpart (unless ALL markers in a scope would be deleted — line 13285–13303, which shows a `window.confirm`). A single new marker in a populated category is silently dropped with no prompt.

4. **The `ExcelSyncConfirmModal` is only for saves**. If `excelSyncPreference = 'always'`, saves auto-push with zero user interaction. Adds made between saves go into a `hasPendingExcelSyncChanges = true` state but the user must manually initiate the save to trigger the push. If they reload first, the opportunity is gone.

---

## F. Whether a Rewrite Is Needed + Sketch of How Excel Sync SHOULD Behave

### Assessment

The Excel sync is **architecturally inverted** in the inbound direction. The import treats the Excel workbook as an authoritative override of app state, but the Excel workbook only knows what was last exported from the app. It is not an independent source of truth for Survey Marker existence — it is a derivative snapshot. Running a destructive reconcile against a derivative snapshot is wrong.

The feature also predates the Y.Doc durable store. Now that the Y.Doc is authoritative, the import's `setSurveyMarkers` call lands after Y.Doc hydration and corrupts the durable store. This was an acceptable tradeoff when localStorage was the only persistence — it no longer is.

A **targeted fix** (not a full rewrite) is sufficient:

### Fix Sketch

**1. Guard `loadLatestSurveyData` with a `hasPendingExcelSyncChanges` check**

```js
// PDFViewer.jsx ~12713
if (excelTimestamp > supabaseTimestamp) {
  if (hasPendingExcelSyncChanges) {
    // App has un-synced changes — do NOT auto-import. Offer a merge prompt instead.
    setShowExcelInboundConflictModal(true);
    return;
  }
  setTimeout(() => handleSyncFromExcel(), 500);
}
```

**2. Change `executeExcelImport`'s deletion logic to skip markers that are app-only (no Excel row, but were added after the last export)**

The cleanest heuristic: if `lastExcelSyncFingerprintRef.current` is null (no export checkpoint) or if a marker's `changedDate` is later than the template's `lastSyncTime`, treat it as a locally-added marker and preserve it rather than treating absence-from-Excel as a deletion.

**3. Add a `changedSinceLastExport` flag to Survey Markers**

When `markExcelSyncCheckpoint` runs, stamp all current markers as `exportedToExcel: true` (or record the export epoch). New markers added after that checkpoint should carry `exportedToExcel: false`. The import logic should never delete a marker with `exportedToExcel: false` — instead, it should offer to add it to Excel.

**4. Fix the Y.Doc corruption path**

The `useAnnotationDoc` capture effect unconditionally calls `h.applySurveyMarkers(surveyMarkers)` whenever `surveyMarkers` changes. This is correct for legitimate user edits but wrong for Excel-reconcile writes, which can delete markers that should be in the Y.Doc. Fix: add a flag or use `{ origin: 'excel-import' }` when calling `setSurveyMarkers` from the import path, and suppress the Y.Doc capture for that origin (or, better, always write to the Y.Doc first and let the import diff against the Y.Doc state instead of the stale-at-close localStorage/export snapshot).

**5. Correct `loadLatestSurveyData` timestamp logic**

`supabaseTimestamp` uses `selectedTemplate.updatedAt` or `lastSyncTime`. But `updatedAt` is updated on ANY template config change (e.g., adding a checklist item), not just on Excel exports. Use a dedicated `lastExcelExportAt` timestamp that is only written when `markExcelSyncCheckpoint` runs and the export actually completed.

---

## Appendix: Key File References

| Role | File | Key Lines |
|------|------|-----------|
| Survey Marker state init on open | `src/PDFViewer.jsx` | 16771–16888 |
| Y.Doc hydrate (authoritative) | `src/hooks/useAnnotationDoc.js` | 58–131 |
| Y.Doc capture on every SM change | `src/hooks/useAnnotationDoc.js` | 168–172 |
| `loadLatestSurveyData` — timestamp compare | `src/PDFViewer.jsx` | 12677–12727 |
| Timestamp-triggered import effect | `src/PDFViewer.jsx` | 12729–12734 |
| `handleSyncFromExcel` (manual + auto on-open) | `src/PDFViewer.jsx` | 14154–14326 |
| `executeExcelImport` — full reconcile logic | `src/PDFViewer.jsx` | 13046–13459 |
| Deletion-from-Excel logic within import | `src/PDFViewer.jsx` | 13247–13314 |
| `setSurveyMarkers` after import | `src/PDFViewer.jsx` | 13452 |
| `handleSurveyMarkerDeleted` — sets Excel push flag | `src/PDFViewer.jsx` | 22398–22623 |
| `pendingExcelSyncAfterDeleteRef` flag set | `src/PDFViewer.jsx` | 22466–22471 |
| Auto-Excel-push effect (delete → Excel) | `src/PDFViewer.jsx` | 22631–22636 |
| `ExcelSyncConfirmModal` (outbound save prompt) | `src/components/ExcelSyncConfirmModal.jsx` | whole file |
| Dirty-state fingerprint util | `src/utils/excelSyncDirtyState.js` | whole file |
| Fingerprint check + dirty-state effect | `src/PDFViewer.jsx` | 9456–9484 |
| Y.Map sync — delete path in Y.Doc | `src/services/annotationDocStore.js` | 92–123 |
| localStorage survey marker save | `src/viewerShared.js` | 1719–1728 |
| localStorage survey marker load | `src/viewerShared.js` | 1931–1953 |
| `saveSurveyMarkers` effect | `src/PDFViewer.jsx` | 16997–17003 |
| `executeAutoExcelImport` (file-watcher path) | `src/PDFViewer.jsx` | 13462–13933 |
| File watcher setup | `src/PDFViewer.jsx` | 14497–14548 |
| Live-sync poll loop | `src/PDFViewer.jsx` | 14673–14754 |

---

*Produced 2026-06-06. Read-only investigation — no source files changed.*
