# Survey Marker Persistence Audit
**Date:** 2026-06-06  
**Scope:** Complete trace of survey-marker persistence on the OLD engine + gap analysis for the NEW engine.

---

## 1. Save Path (Debounce → Upsert)

### 1a. Debounced reactive sync (primary path)
`PDFViewer.jsx:15243–15450` — a `useEffect` fires whenever `surveyMarkers` state, `documentSyncEnabled`, or `surveyAnnotationHydration` changes. Guard: `shouldRunSurveyMarkerSync()` (`src/utils/surveyMarkerSyncSafety.js:9`) verifies documentId, userId, sync-enabled, and blocks an "hydrate-empty delete guard" scenario where the incoming count drops from non-zero to zero before hydration is confirmed ready. If `JSON.stringify(surveyMarkers) === lastSyncedAnnotationsRef.current` the effect is a no-op.

When it does run, it arms a `scheduleSync(2000)` — a 2000 ms debounce timer. Before the upsert it diffs `priorSurveyMarkers` (JSON-parsed from `lastSyncedAnnotationsRef.current`) against the current state to find deleted IDs, which are removed from Supabase BEFORE the upsert (`PDFViewer.jsx:15316`):

```js
// PDFViewer.jsx:15316
await syncAnnotationsToSupabase(documentId, user.id, surveyMarkers, { priorSurveyMarkers })
```

`syncAnnotationsToSupabase` lives in `src/services/documentAnnotationService.js:328`. It:
1. Calls `diffDeletedSurveyMarkerIds(priorSurveyMarkers, surveyMarkers)` (`src/services/surveyMarkerSyncDiff.js:26`) → returns IDs in prior but not in current.
2. Calls `deleteAnnotations(documentId, deletedIds)` for any removals (line 341).
3. Maps remaining entries through `buildSurveyMarkerRow()` (mapper line 18) → array of DB rows.
4. Calls `upsertAnnotations(rows)` (line 150), which chunks in batches of 250 (`annotationBatching.js`) and fires `.upsert(batch, { onConflict: 'document_id,annotation_id' })` on `document_annotations`.

### 1b. Unmount / beforeunload flush
- **Unmount flush** (`PDFViewer.jsx:15425–15448`): cleanup of the same effect calls `syncAnnotationsToSupabase` fire-and-forget if `pendingSurveyMarkerSyncRef.current` was still set (meaning the 2000 ms timer hadn't fired yet).
- **beforeunload flush** (`PDFViewer.jsx:15458–15472`): a second `useEffect` attaches a `window.beforeunload` listener that calls the same `pending()` runner.
- Confirmed lines: 15442 (unmount call), 15466 (beforeunload call).

### 1c. Inline single-marker create (FIX19 harness)
`PDFViewer.jsx:21053`:
```js
await syncAnnotationsToSupabase(pdfFile.id, user.id, { [id]: surveyMarker })
```
This is a fire-and-forget single-marker immediate upsert via the `window.__fix19SurveyRegionHarness` test hook. It passes only the new marker's `{id: marker}` dict (no priorSurveyMarkers), so no delete-diff runs here.

### 1d. Explicit Cmd+S / "Save" path
`PDFViewer.jsx:17371`:
```js
await saveSurveyDataToSupabase(surveyMarkers, spaces, selectedTemplate)
```
`saveSurveyDataToSupabase` (line 17105) is a **Supabase Storage sidecar JSON blob**, NOT a `document_annotations` upsert. It serialises `{version, updatedAt, pdfId, annotations: surveyMarkers, annotationsByPage, callouts, spaces, entities, templateId, zoomLevel, currentPage}` → uploads to `{projectId}/{documentId}_data.json` in Supabase Storage. **This is a separate, older sidecar path** that does not write individual `document_annotations` rows. On load it is restored via `loadSurveyDataFromSupabase` guarded by `resolveSafeSnapshot`.

### 1e. localStorage mirror (always-on)
`PDFViewer.jsx:17016–17021` — a reactive `useEffect` calls `saveSurveyMarkers(pdfId, surveyMarkers)` (`viewerShared.js:1719`) on every state change. Writes to `localStorage.surveyMarkers_${pdfId}` as a JSON string. This is a warm-cache backup for offline/local-only PDFs and for the "same PDF reload" fast-path — not a durability path for cloud-backed docs.

### DB row shape written by `buildSurveyMarkerRow` (`documentSurveyMarkerMapper.js:18`)
| column | source |
|---|---|
| `document_id` | documentId arg |
| `user_id` | userId arg |
| `annotation_id` | annotationId key |
| `annotation_type` | always `'survey-marker'` (SURVEY_MARKER_TYPE) |
| `page_number` | `annotation.pageNumber` |
| `bounds` | `annotation.bounds` (JSONB: `{x, y, width, height}`) |
| `category_id` | `annotation.categoryId` |
| `module_id` | `annotation.moduleId` |
| `space_id` | always `null` (survey markers never carry a standalone space) |
| `name` | `annotation.name` |
| `notes` | `annotation.notes \|\| annotation.note` |
| `entity_id` | `annotation.entityId` |
| `entity_name` | `annotation.entityName` |
| `checklist_responses` | `annotation.checklistResponses \|\| {}` |
| `changed_by` | `annotation.changedBy` |
| `changed_date` | `annotation.changedDate` |
| `color` | `annotation.entityColor \|\| annotation.color \|\| '#FFFF00'` |
| `opacity` | `annotation.opacity \|\| 0.3` |
| `last_modified_by` | userId |
| `version` | `(annotation.version \|\| 0) + 1` |
| `annotation_data` | JSONB: `{ ...annotation.annotationData, regionId, scope }` |

**Upsert conflict key:** `(document_id, annotation_id)`.

---

## 2. Load / Hydrate Path

### 2a. Cloud-backed document open
`PDFViewer.jsx:16892–16906` — when `pdfFile?.id` is set, `isCloudBackedDoc = true`. Survey markers are **not** loaded from localStorage; instead `setSurveyMarkers({})` (or the prior-PDF snapshot for same-PDF reload) is applied and `surveyAnnotationHydration` is set to `ANNOTATION_HYDRATION_PENDING`.

`PDFViewer.jsx:14968` — a `useEffect` watching `surveyAnnotationHydration` fires `loadAnnotationsFromSupabase(documentId)`:

```js
// documentAnnotationService.js:400
export async function loadAnnotationsFromSupabase(documentId) {
  const { data } = await getDocumentAnnotations(documentId);
  // builds surveyMarkers {} from mapSurveyMarkerRowToLocalAnnotation per row
}
```

`getDocumentAnnotations` (line 89) queries:
```sql
SELECT * FROM document_annotations
WHERE document_id = $1
  AND annotation_type IN ('survey-marker', 'highlight')
ORDER BY page_number ASC
```
Paginated in 1000-row chunks (keyset is NOT used here — still OFFSET via `.range()`). Legacy rows with a `fabricObject` inside `annotation_data` are filtered out client-side (line 111) to avoid re-hydrating the old dual-write stranded shape.

The result is passed through `resolveSafeSnapshot` (`PDFViewer.jsx:14988`) — a guard that refuses to overwrite a non-empty in-memory state with an empty incoming set (`cloudBacked:true, kind:'object-map', context:'survey-marker-hydrate'`). If the snapshot is safe, `setSurveyMarkers(safeSurveySnapshot.value)` and `lastSyncedAnnotationsRef.current = JSON.stringify(...)` are updated (`PDFViewer.jsx:15003–15004`).

### 2b. Local-only document open
`PDFViewer.jsx:16905`: `loadSurveyMarkers(id)` → `viewerShared.js:1931` → `localStorage.getItem('surveyMarkers_${pdfId}')` → JSON.parse → `{}`.

### 2c. Supabase Storage sidecar restore
`loadSurveyDataFromSupabase` (`PDFViewer.jsx:17147`): downloads `{projectId}/{documentId}_data.json` from Supabase Storage. If `data.annotations` is present, runs it through `resolveSafeSnapshot` (line 17171) before calling `setSurveyMarkers`. For cloud-backed documents, `annotationsByPage` is **not** restored from this blob (`shouldRestoreLegacyAnnotationBlob = !doc.id`).

### Local annotation object shape (after `mapSurveyMarkerRowToLocalAnnotation`)
```js
{
  annotationId,      // string UUID
  pageNumber,        // integer
  bounds,            // { x, y, width, height } — page-space coordinates
  categoryId,        // string | null
  moduleId,          // string | null
  regionId,          // string | null (from annotation_data.regionId)
  name,              // string | null
  notes,             // string | null
  note,              // alias for notes
  entityId,          // string | null
  entityName,        // string | null
  entityColor,       // string | null (only when entityId is set)
  checklistResponses,// { [checklistItemId]: { selection, note, ... } }
  changedBy,         // string | null
  changedDate,       // string | null
  color,             // hex string
  opacity,           // float
  version,           // integer
  supabaseId,        // row PK (id)
  lastSyncedAt,      // row updated_at
  userId,            // row user_id
  lastModifiedBy,    // row last_modified_by
  annotationData,    // raw annotation_data JSONB object
  visibilityScope,   // 'survey' | 'survey-region' (derived)
}
```

**Key structural distinction:** A survey marker is NOT a Fabric.js object. It has no `type`, `left`, `top`, `scaleX`, `fill`, `path`, or any Fabric rendering property. It is a bounding-box record (`{x, y, width, height}`) drawn as an SVG `<rect>` by `SVGAnnotationLayer.jsx`. It lives in the `surveyMarkers` React state map (`{ [annotationId]: marker }`) — a completely separate slice from `annotationsByPage` (`{ [pageNumber]: { objects: FabricObject[] } }`).

---

## 3. Delete Path

### 3a. Single-marker delete (from panel)
`PDFViewer.jsx:22649–22658` → `handleDeleteSurveyMarkerItem(annotationId)` → `handleSurveyMarkerDeleted(pageNum, bounds, annotationId)`.

`handleSurveyMarkerDeleted` is the bulk-delete handler at `PDFViewer.jsx:22432–22633`. It:
1. Removes the marker from `surveyMarkers` state (line 22470).
2. Calls `deleteAnnotations(documentId, [annotationId])` (line 22608) → `documentAnnotationService.js:286`:
   ```sql
   DELETE FROM document_annotations WHERE document_id=$1 AND annotation_id IN (...)
   ```
3. Updates `surveyMarkersToRemoveByPage` to trigger canvas visual cleanup.

### 3b. Bulk delete (via panel selection)
Same `handleSurveyMarkerDeleted` path, called with multiple IDs collected from `permittedSurveyMarkerIds` (line 22608). One `deleteAnnotations()` call per invocation.

### 3c. Cascade delete (space/region removal)
`PDFViewer.jsx:11447–11530` — `cascadeDeleteScopedAppState()` iterates `surveyMarkersRef.current` entries, collects IDs matching `shouldDeleteScopedEntry` (checks `regionId`, `spaceId`, `moduleId`, page scope), removes them from `surveyMarkers` state (line 11490), and calls `deleteAnnotations(pdfFile.id, ids)` (line 11530). This path runs when a Space, Space page, or Space region is deleted.

### 3d. Debounced sync path (delete-diff)
The debounced `syncAnnotationsToSupabase` at line 15316 also deletes rows via `diffDeletedSurveyMarkerIds` before the upsert (see §1a). This catches any removal not already handled by the explicit delete paths above (e.g., a marker removed from React state without an explicit delete call).

---

## 4. Realtime Subscription Path

`PDFViewer.jsx:15158` — `subscribeToDocumentAnnotations(documentId, { onInsert, onUpdate, onDelete, onError })` — active when `documentSyncEnabled` and a `documentId` and `user.id` exist.

Channel name: `document-annotations:${documentId}` (Supabase Postgres Changes).
Table: `document_annotations`. Filter: `document_id=eq.${documentId}`.
Events: INSERT, UPDATE, DELETE.

**Type guard** (`documentAnnotationService.js:444, 460, 480`): every incoming event checks `isSurveyMarkerType(payload.new?.annotation_type)`. If the row is NOT a survey marker, it is silently dropped (the `annotationCloudSync.js` module owns those rows via its separate `all-annotations:${documentId}` channel). Legacy fabric-carrying survey marker rows are also dropped.

**On INSERT/UPDATE** (lines 15163–15220): merges all scalar fields into `setSurveyMarkers(prev => ({ ...prev, [annotationId]: {...fields} }))`. Does NOT re-fetch from Supabase — it splices the row directly.

**On DELETE** (lines 15222–15228): `setSurveyMarkers(prev => { delete next[annotationId]; return next; })`.

**DELETE payload caveat** (annotationCloudSync.js:615): Supabase only includes `payload.old` when REPLICA IDENTITY FULL is set. The survey-marker subscriber in `documentAnnotationService.js` does not have a fallback re-fetch for empty DELETE payloads — if `payload.old.annotation_id` is missing, the delete is silently lost. The non-survey-marker subscriber in `annotationCloudSync.js` has an `onDeleteFallback` for this case; the survey-marker path does not.

**Echo suppression**: The INSERT/UPDATE handlers check `annotation.lastModifiedBy === user.id` (lines 15161, 15191) and skip own writes. This is the `last_modified_by` column-based legacy echo filter, NOT the `clientSessionId`-based filter used by the newer path.

---

## 5. In-Memory Data Shape: Survey Marker vs. Fabric Annotation

| Property | Survey Marker | Fabric Annotation (`annotationsByPage`) |
|---|---|---|
| State slice | `surveyMarkers[annotationId]` | `annotationsByPage[pageNumber].objects[i]` |
| Identity key | `annotationId` UUID string | `data.id` UUID (may be on `obj.data.id`) |
| Shape | flat object — bounding-box + metadata | Fabric.js serialized JSON (type, left, top, scaleX, path, ...) |
| Page reference | `marker.pageNumber` (top-level scalar) | `pageNumber` = the key in `annotationsByPage` |
| Category / Module | `categoryId`, `moduleId`, `regionId` | none |
| Checklist data | `checklistResponses: { [itemId]: {...} }` | none |
| Entity link | `entityId`, `entityName`, `entityColor` | none |
| Color | `color`, `opacity` (hex + float) | `fill`, `stroke`, `opacity` (Fabric props) |
| DB column | `annotation_type = 'survey-marker'` | `annotation_type` = ink / freetext / square / etc. |
| DB row scope | `category_id`, `module_id`, `entity_id`, `checklist_responses` columns populated | all those columns are null |
| Storage in annotation_data | `{ regionId, scope }` only | full Fabric JSON (via serializer) |
| Rendered by | `SVGAnnotationLayer.jsx` as SVG `<rect>` | `SVGAnnotationLayer.jsx` as SVG paths + `PageAnnotationLayer.jsx` / Fabric.js canvas |

**Conclusion:** Survey markers cannot ride `applyByPage(byPage)` because they are not Fabric objects and are not indexed by page key in `annotationsByPage`. They are a fully separate domain object with separate React state, separate DB columns (`category_id`, `module_id`, `entity_id`, `checklist_responses`, `bounds` as a top-level column), and a separate render path.

---

## 6. Survey-Marker-Specific Concerns the Old Engine Provides

### 6a. Cross-document checklist-item reference counting
`documentAnnotationService.js:220` — `countSurveyMarkersReferencingChecklistItem(itemId)` runs a Postgres JSONB `cs` (contains) query across ALL documents:
```sql
SELECT annotation_id (count exact) FROM document_annotations
WHERE annotation_type IN ('survey-marker','highlight')
  AND annotation_data->'checklistResponses' IS NOT NULL
  AND annotation_data->'checklistResponses' @> '{"<itemId>": {}}'
```
Called from `Dashboard.jsx:3689` → `hubGetChecklistItemUsageCount()` → used by the Templates Editor to choose between hard-delete and archive when a checklist item is removed. This query depends on the flat DB rows existing with `annotation_data->checklistResponses` populated. The new engine's `annotation_updates` log and `annotation_snapshots` table store opaque Yjs binary update bytes — there is no queryable JSONB column.

### 6b. Row-Level Security (RLS) error detection
`documentAnnotationService.js:30–63` — classifies Supabase errors by HTTP 42501 / "row-level security" string → sets `syncRLSErrorShownRef.current = true` → disables cloud sync for the session. The old engine surfaces this to the user as a `cloudSyncEnabled = false` state. The new engine (`annotationDocSync.js`) has no equivalent RLS error classification or kill-switch.

### 6c. Excel / OneDrive two-way sync coupling
Survey markers feed `handleExportSurveyToExcel` (`PDFViewer.jsx:11845+`) which builds workbook rows from `surveyMarkers` keyed by `categoryId`, `moduleId`, `entityId`, `checklistResponses`, `changedBy`, `changedDate`, `name`, `notes`. The Excel export iterates the React `surveyMarkers` state map (not Supabase), so this coupling is at the React state level. If survey markers moved to Y.Doc meta maps, the export would need to read from `handle.getMeta('surveyMarkers')` or equivalent — it would still work provided the in-memory shape is preserved.

### 6d. Collaborator / role queries
`documentAnnotationService.js:683–740` — `getDocumentCollaborators`, `updateCollaboratorRole`, `removeDocumentCollaborator` operate on `document_collaborators`. These are not directly tied to survey markers but live in the same service. The `document_annotations` RLS policies reference the same `document_collaborators` table for access control. The new engine writes to a separate set of tables (`annotation_updates`, `annotation_snapshots`) whose RLS policies are not yet verified to mirror the `document_annotations` collaborator join.

### 6e. Visibility scope derived from module/region context
Survey markers carry `moduleId` + `regionId` used by `SVGAnnotationLayer.jsx:1912` to compute `visibilityScope` (SURVEY | SURVEY_REGION | REGION) and control per-module, per-region, and per-page visibility. This derived scope is stored in `annotation_data.scope` in the DB row. The new engine's Y.Doc entry shape is `{ p: pageNumber, o: fabricObject }` — it has no concept of moduleId, regionId, or visibility scope.

### 6f. Missing DELETE payload fallback
As noted in §4, the survey-marker subscription has no `onDeleteFallback` re-fetch. When `REPLICA IDENTITY FULL` is not set (or Supabase delivers an empty `payload.old`), a peer's delete is silently lost. The non-survey-marker subscription in `annotationCloudSync.js:617` has explicit fallback handling.

---

## 7. Concrete Recommendation: Survey Markers in the New Engine

**Do NOT ride `applyByPage(byPage)`.** Survey markers are not Fabric objects; forcing them into `annotationsByPage` would corrupt the Fabric render layer and break the SVG rendering path.

**Recommended approach: dedicated Y.Doc meta map.**
Use `handle.setMeta('surveyMarkers', surveyMarkersDict)` / `handle.getMeta('surveyMarkers')` as a whole-value CRDT meta slot. This is already the established pattern for `callouts` in `useAnnotationDoc.js:89,119`. Survey markers are coarse-update-friendly (the whole dict is re-set on any change), and the existing `setMetaValue` idempotency check prevents no-op Yjs ops.

---

## 8. Gaps the New Engine Must Close

- [ ] **GAP-1: No survey-marker state captured in Y.Doc.**  
  `useAnnotationDoc.js` (entire file) and `annotationDocStore.js` (entire file) have zero survey-marker handling. The hook only captures `annotationsByPage` and `callouts`. A `surveyMarkers` meta key must be added.  
  _Confidence: HIGH — confirmed by grep returning no results._

- [ ] **GAP-2: `handle.setMeta` / `handle.getMeta` API exists but is not wired to `surveyMarkers` state.**  
  `useAnnotationDoc.js:119` already shows the callouts pattern; the same `setMeta(SURVEY_MARKERS_KEY, surveyMarkers)` / `onChange` read pattern needs to be mirrored for survey markers.  
  _Confidence: HIGH._

- [ ] **GAP-3: Cross-document checklist-item reference count will break.**  
  `documentAnnotationService.js:220` relies on queryable JSONB in `document_annotations`. When survey markers move to the new engine's `annotation_updates`/`annotation_snapshots` tables, the Postgres `cs` filter has no equivalent. Either: (a) keep survey markers in `document_annotations` as the write-ahead truth while the Y.Doc is the realtime in-memory layer, or (b) add a separate denormalised `survey_marker_checklist_refs` table the new engine populates on every sync.  
  _Confidence: HIGH — the query is explicit at `documentAnnotationService.js:228`._

- [ ] **GAP-4: No RLS error detection in `annotationDocSync.js`.**  
  The new engine's `openAnnotationDoc` / internal fetch calls have no `42501` classification and no kill-switch equivalent. If `annotation_updates` or `annotation_snapshots` RLS denies access, the engine silently returns empty state.  
  _Confidence: HIGH — grep of `annotationDocSync.js` for 'RLS' / '42501' returns nothing._

- [ ] **GAP-5: New engine's `annotation_updates` / `annotation_snapshots` RLS not verified to match `document_annotations` collaborator join.**  
  `document_annotations` RLS is based on `document_collaborators`. Whether `annotation_updates` and `annotation_snapshots` carry the same policy is unknown from code alone — requires Supabase schema inspection.  
  _Confidence: MEDIUM — inferred from absence of evidence in service files._

- [ ] **GAP-6: DELETE payload fallback absent in survey-marker subscription.**  
  `subscribeToDocumentAnnotations` (`documentAnnotationService.js:426`) has no `onDeleteFallback` re-fetch when `payload.old` is empty. If REPLICA IDENTITY FULL is not set on `document_annotations`, peer deletes are lost.  
  _Confidence: HIGH — confirmed by comparison with `annotationCloudSync.js:617` which has the fallback._

- [ ] **GAP-7: `annotationDocSync.js` Realtime channel is `annotation_updates`, not `document_annotations`.**  
  Even after survey markers are written to Y.Doc meta, the existing survey-marker subscription (`document-annotations:${documentId}` on `document_annotations`) must remain active for collaborators running the OLD engine during any migration window. The new engine's channel (`anno-${documentId}` on `annotation_updates`) is a different channel — dual-subscription during a migration era is needed.  
  _Confidence: HIGH._

- [ ] **GAP-8: Excel/OneDrive sync reads `surveyMarkers` React state directly.**  
  `PDFViewer.jsx:11845+` iterates `surveyMarkers` for the Excel export. If the state source changes (Y.Doc meta → React state via `onChange`), the export will still work provided `setSurveyMarkers` is called from the `onChange` callback — but this wiring must be explicitly added and tested.  
  _Confidence: MEDIUM — depends on implementation detail of the migration seam._

- [ ] **GAP-9: Survey marker type discrimination in `loadAllNonSurveyMarkerAnnotations` and `subscribeToAllNonSurveyMarkerAnnotations`.**  
  Both already filter out survey-marker rows via `isSurveyMarkerType` (`annotationCloudSync.js:454, 596, 666`). This carve-out must be kept in place regardless of which engine owns survey markers.  
  _Confidence: HIGH._

- [ ] **GAP-10: `annotationDocSync.js` uses an OFFSET-free keyset pagination for its hydrate reads; survey-marker loader still uses OFFSET (`.range()`).**  
  `documentAnnotationService.js:93–100` uses `SUPABASE_PAGE_SIZE` with `.range(from, from+999)`. On large documents with many survey markers this will hit the same timeout risk that motivated the keyset rewrite in `annotationCloudSync.js`. Should be ported when survey markers are migrated.  
  _Confidence: HIGH — the OFFSET pattern is visible at line 100._

---

## Call-Site Line Reference (PDFViewer.jsx)

| Call | Line | Function |
|---|---|---|
| `loadAnnotationsFromSupabase` | 14968 | Hydrate on document open |
| `resolveSafeSnapshot` (hydrate) | 14988 | Guard against empty-clobber |
| `subscribeToDocumentAnnotations` | 15158 | Realtime subscribe |
| `syncAnnotationsToSupabase` (debounced) | 15316 | Debounced reactive push |
| `syncAnnotationsToSupabase` (unmount flush) | 15442 | Fire-and-forget on tab close / document switch |
| `syncAnnotationsToSupabase` (inline create) | 21053 | Single-marker immediate upsert (FIX19 harness) |
| `deleteAnnotations` (space cascade) | 11530 | Space/region removal cascade |
| `deleteAnnotations` (marker delete) | 22608 | Panel-initiated delete |

All lines confirmed by direct inspection. Note: prior audit cited line ~22608 for delete — confirmed at 22608. Line ~14968 for load — confirmed at 14968. Line ~14988 for resolveSafeSnapshot — confirmed at 14988. Lines ~15316 and ~15442 for saves — confirmed at 15316 and 15442. Line ~15158 for subscribe — confirmed at 15158. Line ~21053 for inline save — confirmed at 21053. No significant drift from prior audit's estimates.

---

_Confidence note on major claims:_
- Save path (§1): HIGH — all call sites read directly.
- Load path (§2): HIGH — cloud and local paths both traced.
- Delete path (§3): HIGH — three distinct delete paths confirmed.
- Realtime path (§4): HIGH — channel and type guard confirmed.
- Data shape (§5): HIGH — mapper and state declaration both read.
- Checklist reference query (§6a): HIGH — SQL visible in code.
- New engine zero coverage (§8 gaps 1–2): HIGH — grep returned no results in new-engine files.
