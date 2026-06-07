# Legacy Audit: Spaces, Regions, and Space+Region Annotations
**Date:** 2026-06-06  
**Scope:** Complete persistence trace — what the data is, how it saves, how it loads, how it deletes, and what the new engine needs to host each kind.

---

## Part 1 — Conceptual Data Model (Plain-English)

### Space
A **Space** is a named, document-level view-filter object. It is essentially a
"named collection of page assignments" — the user creates a Space, names it
(e.g. "Kitchen" or "Floor 2"), then assigns one or more page numbers to it. When
a Space is made active (`activeSpaceId`), the viewer filters visible pages to only
the assigned pages and can dim everything on each page that falls outside the
user-drawn region polygons. There is no per-space database row; the entire array of
spaces lives in the `spaces` React state array and is serialised as a unit.

A Space is **document-level**, not per-page. It carries zero Fabric.js/geometry itself.
Its geometry lives in the `assignedPages[*].regions` sub-array.

### Region
A **Region** (called "assignedPage entry") is a page-entry inside a Space. Every
Space has an `assignedPages` array; each element is one page assignment. That entry
holds:
- `pageId` (integer page number)
- `label` (human-readable name, e.g. "Kitchen – Page 3")
- `wholePageIncluded` (boolean — true when the region covers the whole page; false
  when the user has drawn sub-page polygons)
- `regions` (array of polygon objects — see Region Polygon below)
- `showCanvasAnnotations`, `showSurveyAnnotations`, `showBackgroundAnnotations`
  (per-page visibility toggles)

A Region is therefore **not a separate entity** — it is a named page-slot inside a Space.

### Region Polygon (Sub-Area)
Each `regions[]` element is a polygon object:
```json
{
  "regionId": "1748900000000-xyz9a",
  "pageId": 3,
  "shapeType": "rectangular" | "polygon",
  "operation": "add" | "subtract",
  "coordinates": [x1, y1, x2, y2, ...],   // flat array in page-space units
  "showCanvasAnnotations": true,
  "showBackgroundAnnotations": true,
  "showSurveyAnnotations": true,
  "sourceRegions": [...],                   // optional: preserved after merge/unmerge
  "originCenter": { "x": ..., "y": ... }   // optional: for unmerge offset
}
```
Coordinates are in **page-space units** (not screen pixels), stored as a flat
`[x, y, x, y, ...]` array. `regionId` is a timestamp-random string, not a UUID.

### Space+Region Annotation (Region-Scoped Fabric Object)
Any Fabric.js annotation drawn while a Space is active and the region overlay
toggle is ON gets a `regionId` field stamped onto it at draw time in PAL
(`src/PageAnnotationLayer.jsx` lines 5649–5653, 6582–6667 etc.). This means the
Fabric object inside `annotationsByPage[page].objects[]` carries:
```js
{ ..., moduleId: null | string, regionId: "1748900000000-xyz9a", ... }
```
A Survey Marker drawn in the same context carries `regionId` in its own state
slot and in `annotation_data.regionId` on the Postgres row.

Four visibility scopes exist (`src/utils/annotationVisibilityRules.js:25–59`):
- **CANVAS** — `moduleId=null, regionId=null`
- **SURVEY** — `moduleId!=null, regionId=null`
- **REGION** — `moduleId=null, regionId!=null`
- **SURVEY_REGION** — `moduleId!=null, regionId!=null`

Critically: **a Region-scoped annotation knows only its `regionId`**. It finds
its parent Space at runtime via `getSpaceIdForRegionFromSpaces(regionId, spaces)`
(`annotationVisibilityRules.js:152–163`), which walks `spaces[*].assignedPages[*].regions[*]`
looking for a match. There is no `spaceId` field stored on Fabric annotations.

---

## Part 2 — Spaces

### 2.1 What Spaces Are in Memory
```js
// PDFViewer.jsx:7433
const [spaces, setSpaces] = useState([]);
// Shape:
// Array<{
//   id: string,          // e.g. "1748900000000-abc1"
//   name: string,
//   assignedPages: Array<{
//     pageId: number,
//     label: string,
//     wholePageIncluded: boolean,
//     regions: Array<RegionPolygon>,
//     showCanvasAnnotations: boolean,
//     showBackgroundAnnotations: boolean,
//     showSurveyAnnotations: boolean,
//   }>
// }>
```
This is a **document-level, non-per-page** data structure. There is no
`annotationsByPage` equivalent for spaces.

### 2.2 Save Path

**Primary store: localStorage key `pdfSidebar_${pdfId}`**

`PDFViewer.jsx:9322–9336` — a `useEffect([pdfId, pageNames, bookmarks, spaces, activeSpaceId, pageTransformations])` runs on every change and writes:
```js
localStorage.setItem(`pdfSidebar_${pdfId}`, JSON.stringify({
  pageNames,
  bookmarks,
  spaces,           // ← entire spaces array
  activeSpaceId,
  pageTransformations
}));
```
This is synchronous, no debounce, fires on every `spaces` state change.

**Secondary store: Supabase Storage sidecar `{projectId}/{documentId}_data.json`**

`PDFViewer.jsx:17104–17144` — `saveSurveyDataToSupabase(surveyMarkers, spaces, template)` uploads a JSON blob:
```json
{
  "version": 1,
  "updatedAt": "...",
  "pdfId": "...",
  "annotations": { ...surveyMarkers },
  "annotationsByPage": { ... },
  "callouts": [...],
  "spaces": [ ...spaces array... ],
  "entities": [...],
  "templateId": "...",
  "zoomLevel": 1.0,
  "currentPage": 1
}
```
This is called from `handleSave` (`PDFViewer.jsx:17371`) when `features.cloudSync` is true. `handleSave` is called on Cmd+S and via the auto-save interval (`PDFViewer.jsx:17436–17446`). No debounce on the Supabase upload itself; it runs synchronously on each save trigger.

**Tertiary store: PDF embedded app-layer blob**

When the user does an annotated-PDF export or the embedded import harness runs,
`appLayerState.layers.spaces` carries the spaces array baked into a PDF attachment.
On re-import, `PDFViewer.jsx:17943–17959` reads `appLayerState.layers.spaces` back and calls `setSpaces(hiddenSpaces)`.

**No dedicated Supabase `spaces` table.** The schema (`supabase/migrations/`) has no
`CREATE TABLE spaces`. There are RLS policies in `20241223000004_add_tier_enforcement_policies.sql:112–145` that reference a `spaces` table, suggesting it existed in an older schema version or is expected to exist as a Supabase-managed resource — but no migration file creates it in this repo.

**No Yjs/annotationDocStore path.** `useAnnotationDoc.js` only captures
`annotationsByPage` (via `applyByPage`) and `calloutsList` (via `setMeta`).
Spaces are NOT in the new engine at all.

### 2.3 Hydrate / Load Path

1. **localStorage (primary on open):** `PDFViewer.jsx:9265–9320` — on `pdfId` change, reads `pdfSidebar_${pdfId}`, runs `normalizePageRegions` migration on every region, calls `setSpaces(migratedSpaces)`. Also always resets `activeSpaceId` to `null` on open (`PDFViewer.jsx:9315`).

2. **Supabase Storage sidecar (secondary):** `loadSurveyDataFromSupabase` (`PDFViewer.jsx:17147–17232`) — called when a cloud document opens. Reads the `_data.json` blob, then at `PDFViewer.jsx:17200–17218` calls `setSpaces(prev => ...)` guarded by `resolveSafeSnapshot({context: 'supabase-storage-spaces', kind: 'array'})`. The guard preserves current spaces if the incoming sidecar is empty (prevents blanking on stale blob).

3. **PDF app-layer import:** `PDFViewer.jsx:17943–17959` — reads from the embedded JSON blob inside the PDF when `importAnnotationsFromPdf` returns a non-null `appLayerState`. Runs `normalizePageRegions` migration.

4. **Undo/redo:** Spaces are included in every undo snapshot (`PDFViewer.jsx:9702`) and restored in `restoreHistoryState` (`PDFViewer.jsx:9730, 9743`).

### 2.4 Delete Path

- **Single space:** `handleSpaceDelete` (`PDFViewer.jsx:15955–15970`) calls `cascadeDeleteScopedAppState({spaceId})` then `setSpaces(prev => prev.filter(s => s.id !== id))`.
- **Remove a page from a space:** `handleSpaceRemovePage` (`PDFViewer.jsx:11544–11574`) calls `cascadeDeleteScopedAppState({spaceId, pageIds:[pageId]})` then filters `assignedPages`.
- **Clear regions from a page:** `handleSpaceClearRegions` (`PDFViewer.jsx:11622`) calls `cascadeDeleteScopedAppState({spaceId, pageIds:[pageId]})` then sets `regions: []` and `wholePageIncluded: true` on the page entry.
- **Replace regions (region edit):** `handleRegionComplete` (`PDFViewer.jsx:16679–16783`) computes removed region IDs (diff of old vs new), calls `cascadeDeleteScopedAppState({regionIds:[...removed]})`, then calls `handleSpaceUpdate` with the new `assignedPages`.

`cascadeDeleteScopedAppState` (`PDFViewer.jsx:11399–11543`) deletes all `annotationsByPage`, `callouts`, and `surveyMarkers` entries that carry a matching `spaceId`/`moduleId`/`regionId`.

### 2.5 Realtime / Subscription

None. Spaces have no Supabase Realtime channel. The `document_annotations` Realtime subscription (`documentAnnotationService.js`) is survey-marker-only. The new Yjs/annotationDocStore Realtime is annotations-only. Spaces are therefore **not collaborative** — two users on the same document have independent space state.

### 2.6 regionOverlayDisabled (UI State)
A separate localStorage key `regionOverlayStates_${pdfId}` (`PDFViewer.jsx:9195–9240`) persists a `Map<"${spaceId}-${pageId}", boolean>` tracking whether each space+page's dimming overlay is toggled on or off. This is UI-only state, not business data, but it affects the `activeRegionId` derivation.

---

## Part 3 — Regions

Regions are **not a separate store**. They are a sub-array nested inside each
space's `assignedPages` entry. All reads/writes flow through the `spaces` state
array. There is no `regions` table, no `regions` state, no region-specific service.

**Evidence:** The only dedicated files are `RegionSelectionTool.jsx` (drawing UI)
and `SpaceRegionOverlay.jsx` (visual dimming) — neither writes to any store
directly. Both are pure view/interaction components that hand their results to
callbacks (`onRegionComplete`, `handleRegionComplete`) which update `spaces` state.

### 3.1 Region Data Shape
See Part 1 above. Stored as `space.assignedPages[i].regions[]`.

### 3.2 Save Path
Exactly the same as Spaces — regions are embedded in the `spaces` array and
persist via the same localStorage and Supabase Storage paths. Region polygon
editing calls `handleRegionComplete` → `handleSpaceUpdate` → `setSpaces` →
localStorage write effect fires.

### 3.3 Hydrate Path
Same as Spaces. `normalizePageRegions` / `normalizeRegionVisibility`
(`annotationVisibilityRules.js:84–90, 71–82`) is applied on every load/migrate
to ensure `showCanvasAnnotations` / `showSurveyAnnotations` / `showBackgroundAnnotations`
are always explicitly present.

### 3.4 Delete Path
See Space delete path — `cascadeDeleteScopedAppState` collects `regionId`s from
removed page entries and deletes scoped annotations. Individual region polygon
removal is handled inside `handleRegionComplete` which replaces the whole `regions[]`
array for a page.

---

## Part 4 — Space+Region Annotations (Region-Scoped Fabric Objects)

### 4.1 What They Are
Regular Fabric annotations (pen strokes, rectangles, circles, stamps, text,
counters, sticky notes, etc.) that were drawn while a Space was active and a
region overlay was visible. They carry `regionId` (and optionally `moduleId`) on
the Fabric object and in the `annotationsByPage[page].objects[]` store.

For Survey Markers, the `regionId` is additionally stored in
`annotation_data.regionId` on the Postgres `document_annotations` row
(`documentSurveyMarkerMapper.js:56–57`).

### 4.2 Where `regionId` Is Stamped
At draw time in PAL (`src/PageAnnotationLayer.jsx`):
- `line 5649–5653` — pen path
- `line 6582–6586` — free text
- `line 6623–6627` — stamp
- `line 6664–6667` — counter
- `line 6696–6700` — sticky note
- `line 6725–6729` — general shape
- `line 7217–7221` — Fabric group

`activeRegionIdRef.current` is set from `activeRegionId` state (`PDFViewer.jsx:23991–24012`), which is derived as the `regionId` of the first region in the first assigned page of the active space, **only if** `isRegionOverlayEnabled` returns true for that page. If the overlay is toggled off, `activeRegionId` is null and no `regionId` is stamped.

For Survey Markers, `regionId` is stamped at `src/PageAnnotationLayer.jsx:8617, 8701` when placing the survey marker.

### 4.3 Save Path
Region-scoped Fabric annotations live in `annotationsByPage[page].objects[]` and
follow the **same save path as all other canvas annotations**: localStorage via
`saveAnnotationsByPage(pdfId, annotationsByPage)`, and Yjs/annotationDocStore
capture via `useAnnotationDoc` (`PDFViewer.jsx` → `h.applyByPage(annotationsByPage)`
→ `annotationDocSync`/`annotationDocStore`).

For Survey Markers with `regionId`: saved to `document_annotations` Postgres table
via `syncAnnotationsToSupabase` → `buildSurveyMarkerRow` which writes `annotation_data: { regionId, scope }` and `space_id: null` (survey markers explicitly carry no `space_id`).

**The new Yjs engine already captures these automatically** because they live in
`annotationsByPage`. Their `regionId` field is carried inside the Fabric object
and serialised as part of the object blob.

### 4.4 Hydrate Path
Region-scoped Fabric annotations are hydrated from the Yjs Y.Doc via the same
`handle.getByPage()` path as all canvas annotations. The `regionId` field is
preserved inside the serialised Fabric object.

For Survey Markers: hydrated from `document_annotations` rows via
`loadAnnotationsFromSupabase` → `mapSurveyMarkerRowToLocalAnnotation` which
reads `annotationData.regionId` and surfaces it as `regionId` on the local
annotation object.

### 4.5 Delete Path
`cascadeDeleteScopedAppState` (`PDFViewer.jsx:11399–11543`) is the unified
delete path. When a region is removed from a space, it collects all annotation
IDs from `annotationsByPage`, `callouts`, and `surveyMarkers` that match
the target `regionId` and:
- Removes them from local React state (`setAnnotationsByPage`, `setCallouts`, `setSurveyMarkers`)
- Queues cloud deletes via `cloudDeleteIds` → delete path in annotationCloudSync

### 4.6 Realtime
Region-scoped Survey Markers are covered by the `subscribeToDocumentAnnotations`
Supabase Realtime channel (the survey-marker path). Region-scoped Fabric
annotations are covered by the new Yjs Realtime path (annotationDocSync).

---

## Part 5 — Ambiguity Resolved: Are Regions/Space Annotations a Separate Store?

**No. Definitively.**

- `spaces` is one flat React state array holding the entire spaces hierarchy
  including all region polygon geometry.
- Region-scoped Fabric annotations live in `annotationsByPage` like all other
  canvas annotations — they are distinguished only by the `regionId` field on
  the object.
- Region-scoped Survey Markers live in `surveyMarkers` like all other survey
  markers — distinguished by `regionId` in `annotation_data`.
- There is no `regions` table, no `spaces` table created in migrations, no
  `region_annotations` table, no separate service file for spaces or regions.

The only special treatment regions receive is:
1. Visibility filtering via `isAnnotationVisibleInContext` which checks
   `regionId` against the active space's regions.
2. Cascade delete via `cascadeDeleteScopedAppState` when a region is removed.
3. A `regionId` stamp applied at draw time when the overlay is active.

---

## Part 6 — Gaps the New Engine Must Close

### 6.1 Spaces (CRITICAL GAP)

**Current situation:** The new engine (`annotationDocStore` / `annotationDocSync`)
has no awareness of `spaces`. Spaces live only in:
- `localStorage: pdfSidebar_${pdfId}`
- Supabase Storage sidecar `_data.json`
- Neither is real-time, neither is CRDT, neither is collaborative.

**What the new engine lacks:**
- [ ] A place to store the `spaces` array inside the Y.Doc so it survives without
      the Storage sidecar
- [ ] Realtime propagation of space changes to collaborators
- [ ] CRDT conflict resolution for concurrent space edits (two users rename the
      same space, assign different pages simultaneously)
- [ ] Migration path: on first new-engine open, seed the Y.Doc meta from the
      localStorage sidecar if spaces are present there

**Proposed Y.Doc shape:**

```js
// In annotationDocStore.js
export const SPACES_KEY = 'spaces';

// Store spaces as a single JSON blob under META_MAP.
// setMetaValue(doc, SPACES_KEY, spacesArray) — change-detected, no-op if identical.
// getMetaValue(doc, SPACES_KEY) → spacesArray | undefined

// In useAnnotationDoc.js:
//   Capture: h.setMeta(SPACES_KEY, spaces)  [on every spaces change]
//   Hydrate: const storedSpaces = handle.getMeta(SPACES_KEY);
//            if (Array.isArray(storedSpaces) && storedSpaces.length > 0) setSpaces(storedSpaces);

// Alternative for fine-grained CRDT: Y.Map keyed by spaceId, where each value is a Y.Map.
// This is more complex but allows merge of concurrent renames. Given spaces are low-frequency
// (users rarely have >10 spaces), the single-blob approach under META_MAP is sufficient
// for V1 of the migration and matches the existing callouts pattern.
```

For collaborative use cases, the more robust design is a **nested Y.Map**:
```js
// doc.getMap('spaces') → Y.Map<spaceId, spaceObject>
// Each spaceObject is a plain JS object (not a sub-Y.Map) for simplicity.
// Conflicts resolved by last-write-wins per spaceId (acceptable for space definitions).
```

### 6.2 Regions (included in Spaces gap above)

Regions are embedded in the `spaces` array, so closing the Spaces gap automatically
closes the Regions gap. No separate treatment needed.

The `regionOverlayDisabled` Map (localStorage `regionOverlayStates_${pdfId}`) is
UI preference state, not business data. It does NOT need to go into the Y.Doc.
It should remain localStorage-only.

### 6.3 Space+Region Annotations (Fabric objects with `regionId`)

**Current situation:** These already ride inside `annotationsByPage` and are
therefore already captured by `useAnnotationDoc`'s `h.applyByPage(annotationsByPage)`
path. The `regionId` field is serialised as part of the Fabric object JSON.

**Gaps:**
- [ ] The new engine has no way to validate that a `regionId` stamped on an
      annotation still corresponds to a live region. If the parent region is deleted
      and the annotation is not cleaned up (e.g. crash mid-cascade), orphan
      region-scoped annotations would remain invisible forever (since they require
      `activeSpaceId + activeRegionId` to be visible).
- [ ] `cascadeDeleteScopedAppState` currently writes deletions directly to
      `setAnnotationsByPage` and queues cloud deletes via the OLD engine's path.
      The new engine's `handle.applyByPage` capture effect will pick up the result,
      but the cascade logic is not Yjs-aware — if a delete originates from a remote
      collaborator removing a space, there is no automated cascade on the local client.

**What the new engine needs:**
- [ ] When the `spaces` meta is updated by a remote op (onChange callback), run
      `cascadeDeleteScopedAppState` locally for any removed region IDs not present
      in the new spaces. This ensures the Y.Doc's annotation map stays consistent
      with the spaces meta.
- [ ] The SPACES_KEY `onChange` handler must diff old vs new regionIds and trigger
      the cascade automatically. This is the only place where a cross-map dependency
      exists in the Y.Doc design.

### 6.4 Survey Markers with `regionId` (Postgres row)

**Current situation:** Survey markers with `regionId` save `annotation_data.regionId`
to `document_annotations`. The new engine does not touch `document_annotations`
for Survey Markers — that is still the OLD engine's domain.

**Gaps:**
- [ ] When the Syncfusion/legacy Survey Marker pipeline is eventually retired,
      the new engine will need to carry `regionId` in the Y.Doc annotation entry.
      Currently the Yjs `ANNOTATIONS_MAP` stores Fabric objects for canvas annotations
      only; survey markers use `document_annotations`. If both converge into the Y.Doc,
      `regionId` must survive as a top-level or `data`-nested field on the annotation.
- [ ] The `cascadeDeleteScopedAppState` for survey markers calls `supabase.delete`
      via the OLD engine's cloud delete path. This path is unaware of Y.Doc and will
      not be covered automatically once the engine migrates.

---

## Part 7 — Complete Gaps Checklist

| Data Kind | Gap | New Engine Component | Priority |
|-----------|-----|---------------------|----------|
| Spaces array | Not stored in Y.Doc at all | `setMetaValue(doc, 'spaces', spacesArray)` in `annotationDocStore` + capture in `useAnnotationDoc` | CRITICAL |
| Spaces array | Not Realtime — changes not propagated to collaborators | `onChange` callback must surface `getMeta('spaces')` changes | HIGH |
| Spaces array | Seed from localStorage sidecar on first open | One-time migration effect in `useAnnotationDoc` open path | MEDIUM |
| Region overlay toggle state | (UI pref, stays in localStorage) | No action needed | LOW |
| Region-scoped Fabric annotations | Already in `annotationsByPage` → already in Y.Doc | No action needed for capture | DONE |
| Region-scoped Fabric annotations | Cascade delete not triggered on remote space removal | `onChange` for spaces meta → local cascade | HIGH |
| Survey Markers with `regionId` | Still in OLD engine; no Y.Doc path | Deferred to SM migration phase | DEFERRED |
| Orphan region-scoped annotations | No GC for dangling `regionId` | Sweep on space load / space meta change | LOW |

---

## Part 8 — Confidence Notes

- **Spaces data model and save/load paths:** HIGH confidence. All paths traced to exact file:line. localStorage primary path confirmed at `PDFViewer.jsx:9322–9336`. Supabase Storage secondary confirmed at `PDFViewer.jsx:17104–17144, 17371`. resolveSafeSnapshot guard confirmed at `PDFViewer.jsx:17200–17218`.
- **Region polygon data shape:** HIGH confidence. Complete shape extracted from `handleRegionComplete` (`PDFViewer.jsx:16679–16783`), test harness at `PDFViewer.jsx:20900–20910`, and `RegionSelectionTool.jsx:1292–1307`.
- **Space+region annotation regionId stamping:** HIGH confidence. All 7 draw handlers in PAL confirmed at lines 5649–7221.
- **No dedicated spaces/regions DB table:** HIGH confidence. All 59 migration files grepped; no `CREATE TABLE spaces` or `CREATE TABLE regions` found in this repo. The `20241223000004` RLS policies reference a `spaces` table that predates the audit window (created by Supabase scaffolding outside migrations/).
- **New engine (annotationDocStore) has zero spaces awareness:** HIGH confidence. `useAnnotationDoc.js` only uses `CALLOUTS_KEY` meta + `applyByPage`. `annotationDocStore.js` defines only `ANNOTATIONS_MAP` and `META_MAP` with no spaces key.
- **Supabase `spaces` table:** UNKNOWN. RLS policies reference it but no creation migration is present in this repo. It may be managed by Supabase's own schema or may be a dead code path from an abandoned design. The app does NOT read/write to it in any observed code path.
