# The Shared Annotation Contract

> Source of truth: synthesized from 9 lifecycle-dimension audits (verified 2026-05-29).
> **Status (2026-07-19):** CREATE / EDIT / dead-code claims below are partially superseded by the SVG-era stack. Prefer `docs/ANNOTATION-PARITY-MAP-2026-07-16.md` for callout fork status and live edit hosts. Syncfusion is gone; `AnnotationContext.jsx` / `OptimizedPDFPage.jsx` / `FabricDrawingCanvas.jsx` / `FabricEditCanvas.jsx` are deleted.
> Scope: the 13 DB annotation types — `ink`, `square`, `circle`, `line`, `arrow`, `polyline`, `polygon`, `freetext`, `stamp`, `counter`, `eraser`, `callout`, `survey_marker` — plus the reserved-but-unbuilt `sticky_note`.

## Purpose

This document defines the *one way* annotations are supposed to flow through the app, from creation to export. Most types already follow it. Two types — **callout** and **survey_marker** — diverge, some of it necessary, much of it historical. This contract is the yardstick: any handling that isn't on this contract must justify itself as *necessary* (the type's nature requires it) rather than *accidental* (it just grew that way).

There is exactly ONE live annotation state engine: the `useState` hooks inside `src/PDFViewer.jsx`. The old `AnnotationContext` / `OptimizedPDFPage` pub-sub path has been deleted — do not recreate it.

---

## The Lifecycle Stages

### 1. CREATE
**Contract (current):** Freehand/shapes/text create on the SVG interaction path (`SVGAnnotationLayer` + interaction hooks), id-stamped (`obj.id` / `obj.data.id`, usually `crypto.randomUUID()`), tagged by `obj.data.annotationType || obj.type`, and committed via `onSaveAnnotations(pageNumber, json, saveContext)` → `handleSaveAnnotations` in `PDFViewer.jsx`. The per-page Fabric PAL path remains only for the legacy `?renderer=canvas` / Ctrl+Shift+V arm — not the default create path.
**Composite types** (multi-part shapes) ride the same commit by stamping `data.type` on a Fabric-shaped object / group — **counter is the proof** (`data.type:'counter'`).

### 2. STATE
**Contract:** Live geometry lives in ONE container: `annotationsByPage` — `useState({})`, shape `{ [pageNumber]: { objects: [...fabricJSON] } }` (`PDFViewer.jsx:3723`). Selection is index-based via `selectedIds`. No per-type top-level array; no type-specific parallel slice.

### 3. RENDER
**Contract:** Each type has a `renderX(obj, index) → single SVG primitive` renderer in `src/utils/svgAnnotationRenderers.jsx`. `SVGAnnotationLayer`'s `filteredAnnotations` memo iterates `annotations.objects` once and dispatches in a single if/else chain keyed on lowercased `obj.type` plus array-shape guards (`SVGAnnotationLayer.jsx:1742-1799`). Composite types get richer geometry inside one `<g>` (counter, callout) but are still dispatched from the unified loop. The SVG viewBox owns all zoom scaling — no JS zoom coordination (CLAUDE.md invariant).

### 4. SERIALIZE
**Contract:** `serializeFabricObjectToRow` stores the entire Fabric object verbatim in `annotation_data.fabricObject`, projecting `bounds`/`color`/`opacity`/`stroke_width`/`font_size` to indexed columns. Round-trip is byte-identical via `deserializeRowToFabricObject` (rebuilds from the blob, not from a type-default). DB `annotation_type` comes from `FABRIC_TYPE_TO_DB_TYPE`, except composite groups are dispatched FIRST off `fabricObj.data.type` (`annotationTypeSerializers.js:156-166`). Many-to-one collapses (`circle`+`ellipse`→`circle`, `text`+`textbox`+`i-text`→`freetext`, `line`+`arrow`→`line`) are lossless because the blob preserves the true sub-kind.

### 5. SYNC (cloud + CRDT)
**Contract:** All types share `annotationCloudSync.js` + `useAnnotationCloudSync.js`: one serializer, one ~800ms debounce, one bulk upsert (`upsertAnnotationsByPage`), one delta builder (`buildFabricSyncDelta`), one Y.Doc map `getMap('annotations')` via `dualWriteFabricCommit`/`applyFabricCommit`, one realtime subscription. Eraser additionally emits a precise-commit event for explicit deletes but stays on this pipeline.

### 6. UNDO/REDO
**Contract:** All Fabric shapes ride the LOCAL ANNOTATION lane — per-page, per-object `fabric:create|delete|update|batch` deltas (`annotationLocalHistory.js`). The delta shape gives "only-touch-what-changed" and owner-scoping (`filterAnnotationHistoryActionByOwner`) *structurally*, with no per-type scoping pass. Eraser uses the precise id-list builder; counter re-diffs after renumber; both emit the identical action shape. A reason pushed to the legacy snapshot lane MUST be listed in `isLegacyAnnotationHistoryMeta` (`PDFViewer.jsx:10243-10249`) or its snapshot is unreachable on undo.
**Field-level updates (2026-09-23):** an `update` delta's Undo/Redo writes back only the fields that differ between its `before` and `after` (nested-aware; arrays such as `points`/`path`/`objects` are one field) onto the mark as it is NOW, so a collaborator's edit to another field of the same mark survives. Gestures record which fields their own saves wrote (`collectAnnotationFieldTouches`) and the release's step is limited to those (`fields`). Same-field conflicts: your Undo still restores your before value. An update on a mark deleted remotely is a no-op. Callouts are re-projected from `data.legacyCallout` after a merged update. See the header of `annotationLocalHistory.js`.

### 7. EDIT
**Contract (current):** edit chrome lives in SVG. `editType='bbox'` (line/arrow/polyline/polygon/counter) mounts NO Fabric canvas — the SVG layer serves resize/rotate and commits via `onSaveAnnotations`. Content edits (`editType='text'`) mount `TextEditOverlay` (same-surface HTML `contentEditable`) so SVG stays the visual frame while the overlay owns the caret; commit via `textEditCommit` helpers → `handleSaveAnnotations`. `FabricEditCanvas` was deleted (2026-07). The `type → editType` mapping MUST be exhaustive and explicit (no `else → 'callout'` fallthrough). There is ONE shared `onRequestEditMode` handler.

### 8. DELETE
**Contract:** Selection is `selectedIds`; Delete/Backspace fires `deleteSelected()` (`useSVGInteraction.js:4207`), which re-runs the `canModify` per-user authority gate at delete time (`:4219-4232`) and routes through `buildBulkDeletePlan` for the cross-author confirmation flow (`PDFViewer.jsx:16435-16503`). Author identity resolves via `permissionScope.getAnnotationAuthorId` (canonical chain `meta.authorId ?? authorId ?? data.authorId ?? data.userId`). Eraser hit-tests with generic `isPointOnObject`. There is ONE window-level Delete keydown dispatcher.

### 9. EXPORT / PRINT
**Contract:** All exportable types live in `annotationsByPage`, are gathered by the single fabric loop in `buildPdfExportAnnotationPlan` (`pdfAnnotationsPdfLib.js:366-386`), pass the `EXPORTABLE_FABRIC_TYPES` gate (`:38-48`), and are written by a single-ref `case` in the write switch (`:1477-1525`). Print flatten uses `drawFlattenedObject`. Count/summary walks `annotationsByPage` only.

---

## Per-Type Conformance Table

Legend: ✅ on contract · ⚠️ necessary divergence · ❌ accidental/historical divergence · — n/a

| Type | Create | State | Render | Serialize | Sync | Undo | Edit | Delete | Export | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| ink | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (no content-edit, by design) | ✅ | ✅ | The reference type |
| square | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (handler-fork: edit vs no-op by mount site) | ✅ | ✅ | |
| circle/ellipse | ✅ | ✅ | ✅ | ✅ (→`circle`) | ✅ | ✅ | ❌ (same fork) | ✅ | ✅ | |
| line | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (SVG bbox) | ✅ | ✅ | |
| arrow | ✅ | ✅ | ⚠️ (renderLine, +legacy renderArrow ❌) | ⚠️ (→`line`, lossless) | ✅ | ✅ | ✅ (SVG bbox) | ✅ | ✅ | Two renderers exist |
| polyline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (SVG bbox) | ✅ | ✅ | |
| polygon | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (SVG bbox) | ✅ | ✅ | |
| freetext | ✅ | ✅ | ⚠️ (4-arg sig, live-edit only) | ✅ | ✅ | ✅ | ✅ (Fabric text) | ✅ | ✅ | Text tool no longer makes these |
| stamp (image) | ✅ | ✅ | ❌ (no renderer at all) | ✅ | ✅ | ✅ | ❌ (no branch; falls to `else→callout`) | ✅ | ❌ (not in EXPORTABLE_FABRIC_TYPES) | Silent no-op in render AND export |
| counter | ✅ | ✅ | ⚠️ (data.type guard, first) | ✅ (data.type dispatch) | ✅ | ✅ (re-diff after renumber) | ❌ (two mechanisms; WIP) | ✅ | ✅ | The "composite-yet-unified" proof |
| eraser | ✅ (mutation) | ✅ | — (baked into paths) | ✅ | ✅ (+precise event) | ✅ (precise id-list) | — (tool, not editable) | — (tool) | — (no PDF form) | Mutation, not a stored shape |
| **callout** | ❌ separate `callouts[]` | ❌ separate slice + normalized 0-1 coords | ⚠️ render geometry necessary / ❌ separate loop | ❌ `annotation_data.callout`, deserialize bypass | ❌ separate upsert/realtime/fingerprint/Y.Map | ❌ separate snapshot lane + scope module | ⚠️ adapter necessary / ❌ text-edit masquerade | ❌ no `canModify`, bypasses bulk-delete plan | ⚠️ multi-ref necessary / ❌ 3-stream plumbing | The biggest odd-one-out |
| **survey_marker** | ❌ multi-dialog flow | ❌ dual slice (`surveyMarkers` + `newSurveyMarkersByPage`) | ⚠️ inline JSX (interaction) | ⚠️ dedicated columns (Excel sync) | ⚠️ separate module / ❌ split-brain duplication | ❌ reason not in legacy gate; depends on Yjs | ⚠️ panel-based (checklist content) | ⚠️ cascade necessary / ❌ bespoke ownership chain | ⚠️ hard-excluded (sidecar) | Domain-driven but over-forked |
| sticky_note | — (no producer) | — | — | (wired, unused) | (wired, unused) | — | — | — | — | Reserved/vestigial |

---

## The Single Necessary Divergences (keep these)

- **Callout leader-line geometry**: `renderCallout`'s richer signature and the `calloutEditAdapter` geometry math — a callout genuinely has a leader line + knee + body, which a single primitive can't express.
- **Callout multi-ref export write** (`createCalloutAnnotations` returns an array of refs).
- **Survey-marker dedicated columns + Excel two-way sync + panel-based content editing + delete cascade** — its "content" is checklist responses tied to a template, with a deliberate Supabase/Excel carve-out. No analogue for free-form annotations.
- **Many-to-one DB collapses** (circle/ellipse, text family, line/arrow) — coarse index category, lossless via the blob.

Everything else flagged ❌ is accidental or historical and is a candidate to bring onto the contract.

---

## Why callout is the odd one out (plain summary)

Callout is the single biggest odd-one-out. It is the only annotation type that follows a different contract at nearly every lifecycle stage — separate state slice (`callouts[]` instead of `annotationsByPage`), normalized 0-1 coordinates instead of page-pixel Fabric geometry, a separate serializer (`annotation_data.callout` with an explicit deserialize bypass), a parallel cloud-sync pipeline with its own debounce, fingerprint, retry queue and a dedicated CRDT Y.Map (`getMap('callouts')`), a bespoke history-scope module, a separate render loop, an edit adapter, and a delete path with no ownership gate. The root cause is that callouts were 'ported from a reference Callout app' (src/components/Callout/types.js:3) and grafted in as a foreign subsystem rather than designed on the shared contract. Crucially, this divergence is mostly NOT justified by callouts being composite or having a leader line: counter is an equally composite, multi-part group object with its own hit-test kind, yet it lives inside annotationsByPage and rides the unified serializer, sync, history, and render dispatch (it is dispatched by a `data.type==='counter'` guard exactly where a callout could be). Counter is the decisive counterexample proving the callout fork is historical, not necessary. The ONLY genuinely necessary callout-specific code is the geometry itself — renderCallout's richer signature (a real leader line + knee + body) and the data-callout-id hit-test hook; everything else is accidental leftover that the Phase 14 'unified-svg-callout-render-shared-tool-foundation' effort began unifying but never finished. (Survey_marker is the runner-up and the more separated at the persistence/sync layer — its own legacy module and CRDT carve-out — but that separation is largely a necessary Excel two-way-sync + dedicated-columns domain requirement, so its accidental surface is smaller and more contained than callout's.)

---

## Known Divergences (catalogue)

Each row is a place a type leaves the contract above. `kind` = whether the divergence is forced by the type's nature (`necessary`) or just historical/accidental and a candidate to remove. Evidence is `file:line` verified against `src/` on 2026-05-29.

| # | Divergence | Type | Kind | Risk | Effort |
|---|---|---|---|---|---|
| 1 | Callout lives in a separate `callouts[]` state slice (and normalized 0-1 coords) instead of `annotationsByPage` | callout | historical | high | large |
| 2 | Callout cloud row stores `annotation_data.callout` with an explicit fabric-deserialize bypass | callout | historical | medium | medium |
| 3 | Callout has a fully parallel cloud-sync + CRDT pipeline (separate upsert, realtime callbacks, fingerprint, 2500ms wipe-grace, durable retry queue, dedicated Y.Map 'callouts') | callout | accidental | medium | large |
| 4 | Callout undo/redo uses a bespoke id+owner-scoped snapshot restore (calloutHistoryScope.js) instead of the per-id delta lane | callout | accidental | medium | medium |
| 5 | Callout keyboard + context-menu delete has NO `canModify` gate and bypasses buildBulkDeletePlan | callout | accidental | high | medium |
| 6 | Callout edit-mode masquerades as a text edit, leaving loadCalloutAnnotation orphaned + a sentinel reactCalloutId threaded through shared plumbing | callout | historical | medium | medium |
| 7 | Survey markers stored REDUNDANTLY in two hand-synchronized slices (`surveyMarkers` by id + `newSurveyMarkersByPage` by page) | survey_marker | accidental | high | large |
| 8 | Survey-marker delete uses a bespoke ownership chain, not permissionScope.getAnnotationAuthorId | survey_marker | accidental | high | small |
| 9 | Survey-marker (and space:* / excel:*) history checkpoints push legacy snapshots whose reason isn't honored by the legacy-restore gate | survey_marker | unclear | high | medium |
| 10 | Survey markers have three competing window-level Delete keydown listeners (shapes+callouts, survey markers, legacy PAL) | survey_marker | necessary | medium | medium |
| 11 | Survey markers persist via a fully separate legacy module (documentAnnotationService.js) with its own debounce/diff/subscription, excluded from CRDT | survey_marker | necessary | medium | large |
| 12 | Stamp (image) has DB-type mapping but NO render path and is dropped from PDF export | stamp | accidental | high | medium |
| 13 | Three diverged copy-paste `onRequestEditMode` handlers give the same shape different double-click behavior by mount site | square | accidental | medium | medium |
| 14 | Counter is edited by two mechanisms (SVG bbox + a Fabric custom rotate control storing data.pointerAngle), flagged WIP | counter | unclear | medium | medium |
| 15 | Legacy renderArrow (group form) duplicates renderLine with hard-coded arrowhead math | arrow | historical | medium | small |
| 16 | DB_TYPE_TO_FABRIC_DEFAULT map is defined but referenced nowhere | all | accidental | low | small |
| 17 | AnnotationContext AnnotationStore is a fully-built but orphaned parallel state engine | all | accidental | low | small |
| 18 | sticky_note is wired through the full serializer support with no live producer | sticky_note | unclear | low | small |
| 19 | Callout/index.jsx is a null-render stub kept alive only for legacy CalloutOverlay imports | callout | historical | low | small |
| 20 | Export/print/save threads three streams (annotationsByPage, callouts, surveyMarkers) by hand at every site | callout | accidental | medium | medium |

### Evidence & recommendation per divergence

**1. Callout lives in a separate `callouts[]` state slice (and normalized 0-1 coords) instead of `annotationsByPage`** (callout · historical · risk:high · effort:large)
- Evidence: src/PDFViewer.jsx:3249 (`const [callouts, setCallouts] = useState([])`) vs :3723 (annotationsByPage); src/components/Callout/types.js:3 ('Ported from reference Callout app'), :55-59 (coords as 'percentage of page'). DECISIVE COUNTEREXAMPLE: counter is an equally composite group object yet rides annotationsByPage (annotationTypeSerializers.js:160; PageAnnotationLayer.jsx:6666). Composite shape does NOT require a separate slice.
- Recommendation: Keystone migration: move callouts into annotationsByPage as page-coord Fabric `group` objects with data.type==='callout' (mirroring counter). fabricObjectToDbType already returns 'callout' (annotationTypeSerializers.js:161). This single change collapses ~6 downstream divergences (separate serializer, sync, CRDT map, history scope, count arg, render loop). Gate behind a schema/CRDT backfill that converts existing 0-1 callout rows to page-coord groups. This is what Phase 14 'unified-svg-callout-render-shared-tool-foundation' began but did not finish. Do NOT remove the dependent forks before this migration — they are load-bearing until then.

**2. Callout cloud row stores `annotation_data.callout` with an explicit fabric-deserialize bypass** (callout · historical · risk:medium · effort:medium)
- Evidence: src/services/annotationTypeSerializers.js:101 (`if (row.annotation_type === 'callout') return false`), :363-421 (serializeCalloutToRow stores annotation_data.callout, not fabricObject); contrast :273-278 (every other type → fabricObject). Duplicated author-attribution guard at :374-387 mirrors :237-262.
- Recommendation: Follows directly from the separate slice + normalized data model. Resolved by the keystone migration (delete serializeCalloutToRow/deserializeRowToCallout/deserializeRowsToCallouts and the :101 bypass). Interim, factor the duplicated author-attribution guard into one shared helper so the two copies can't drift.

**3. Callout has a fully parallel cloud-sync + CRDT pipeline (separate upsert, realtime callbacks, fingerprint, 2500ms wipe-grace, durable retry queue, dedicated Y.Map 'callouts')** (callout · accidental · risk:medium · effort:large)
- Evidence: src/services/annotationCloudSync.js:268-308 (upsertCallouts), :605-616 (`if (type === 'callout')` realtime branch); src/utils/calloutSyncPayload.js:46-55; src/lib/collab/crdtAnnotationBridge.js:342-406 (getMap('callouts')); src/lib/collab/crdtUndoManager.js:117,127-128,260 (dual-map branching); useAnnotationCloudSync.js:2134-2435.
- Recommendation: The duplicated debounce/delta/fingerprint plumbing is avoidable. Two routes: (a) after the keystone migration, callouts ride upsertAnnotationsByPage + getMap('annotations') and the parallel pipeline is deleted; (b) interim/independent, extract a single generic delta+debounce engine parameterized by id-extractor + fingerprint that both fabric and callout paths call, leaving only the genuinely callout-specific serializer. Keep the 2500ms wipe-grace as a per-type tuning knob, not a forked code path. The dedicated Y.Map merge is the riskiest piece (live collab docs have entries in the separate map — needs backfill).

**4. Callout undo/redo uses a bespoke id+owner-scoped snapshot restore (calloutHistoryScope.js) instead of the per-id delta lane** (callout · accidental · risk:medium · effort:medium)
- Evidence: src/utils/calloutHistoryScope.js:15,21,30,83-101 (getCalloutIdsFromHistoryMeta, scopeCalloutsForHistoryRestore, isOwnCallout); src/PDFViewer.jsx:10171 (separate callouts snapshot field), :10245 (callouts: reason match), :11071-11099 (scope call in handleUndo). Shapes get 'only-touch-what-changed + owner-only' for free from buildAnnotationHistoryAction + filterAnnotationHistoryActionByOwner (annotationLocalHistory.js:289).
- Recommendation: Needed only because callouts are snapshotted whole rather than diffed. After the keystone migration, the single annotation snapshot covers them — delete calloutHistoryScope.js and fold callouts:* reasons into the generic history reasons. Do NOT remove before the migration; the scope module is currently load-bearing (without it, undo clobbers every callout including other users').

**5. Callout keyboard + context-menu delete has NO `canModify` gate and bypasses buildBulkDeletePlan** (callout · accidental · risk:high · effort:medium)
- Evidence: src/PDFViewer.jsx:10461-10478 (handleDeleteSelectedCallouts: plain `setCalloutsIfPersistedChanged((prev) => prev.filter(...))`, no ownership check — VERIFIED); src/PageAnnotationLayer.jsx:4346-4352 (context-menu delete, plain filter). Contrast useSVGInteraction.js:4219-4232 (canModify at delete time) + PDFViewer.jsx:16435-16503 (buildBulkDeletePlan).
- Recommendation: Security/consistency gap independent of the big migration: a collaborator can delete other users' callouts via keyboard or right-click, while the identical operation on a shape is gated. Run callout ids through canModify before deletion and route bulk callout deletes through buildBulkDeletePlan (or extend the planner to accept callout candidates). Phase 35 per-user authority was implemented only for annotations.objects and never extended to callouts[].

**6. Callout edit-mode masquerades as a text edit, leaving loadCalloutAnnotation orphaned + a sentinel reactCalloutId threaded through shared plumbing** (callout · historical · risk:medium · effort:medium)
- Evidence: src/PDFViewer.jsx:10612-10668 (edit entry feeds textbox child through editType='text'), :28092-28161 (commit re-synthesizes via fromFabricGroup → setCallouts); src/components/FabricEditCanvas.jsx:2800-2894 (loadCalloutAnnotation, still wired to editType==='callout' at :1826-1827 but unreachable for real callouts). calloutEditAdapter.js itself (toFabricGroup/fromFabricGroup) is NECESSARY (genuine geometry bridge).
- Recommendation: The adapter is necessary; the text-edit detour is a historical workaround for a click-outside bug. Confirm loadCalloutAnnotation is dead for the React-callout flow and delete it (+ the editType==='callout' dispatch branch), OR repurpose it as a first-class editType='callout' the adapter feeds directly. Couple with fixing the else→'callout' fallthrough (below).

**7. Survey markers stored REDUNDANTLY in two hand-synchronized slices (`surveyMarkers` by id + `newSurveyMarkersByPage` by page)** (survey_marker · accidental · risk:high · effort:large)
- Evidence: src/PDFViewer.jsx:6699 (surveyMarkers keyed by annotationId, already carries pageNumber+bounds) vs :3959 (newSurveyMarkersByPage); :23143-23187 (single bounds handler writes BOTH); ~20 setNewSurveyMarkersByPage call sites. No other type duplicates geometry across two slices.
- Recommendation: Collapse to a single source of truth: keep surveyMarkers (id-keyed) and derive the per-page paint list with a useMemo instead of maintaining newSurveyMarkersByPage as a second writable slice; keep only a transient 'newly-added id' signal for PAL paint. Removes the dual-write seen in the bounds handler. High-risk because ~20 write sites and PAL paint depend on the second slice — needs careful sequencing.

**8. Survey-marker delete uses a bespoke ownership chain, not permissionScope.getAnnotationAuthorId** (survey_marker · accidental · risk:high · effort:small)
- Evidence: src/PDFViewer.jsx:23243 (`surveyMarker.userId || surveyMarker.annotationData?.userId || surveyMarker.lastModifiedBy` — VERIFIED) vs canonical permissionScope chain `meta.authorId ?? authorId ?? data.authorId ?? data.userId` (src/lib/collab/permissionScope.js:20-23,46-49). Same person could be allowed to delete a shape but blocked from deleting their own marker (or vice versa) if author was stamped in a different slot.
- Recommendation: Route survey-marker delete authority through permissionScope (getAnnotationAuthorId/canModify, or a thin survey-marker adapter that reads the same canonical chain) so there is one ownership source of truth. Keep the rest of the survey-marker delete cascade (Excel re-export, item cleanup) intact — only the author-resolution is divergent.

**9. Survey-marker (and space:* / excel:*) history checkpoints push legacy snapshots whose reason isn't honored by the legacy-restore gate** (survey_marker · unclear · risk:high · effort:medium)
- Evidence: src/PDFViewer.jsx:23138 (addHistoryCheckpoint('survey-marker:...') pushes a full snapshot including surveyMarkers), but isLegacyAnnotationHistoryMeta (:10243-10249) lists only callouts:/highlight:/delete:batch/annotations:save. At undo the legacy branch is skipped (:11067) and falls through to Yjs (:11140). Same gap for space:* (:12098,12133,16796) and excel:auto-sync (:15190).
- Recommendation: Resolve the ambiguity with the user: either (a) add 'survey-marker:'/'space:'/'excel:' prefixes to isLegacyAnnotationHistoryMeta so the recorded snapshots are reachable when CRDT is off, or (b) if Yjs is the guaranteed primary lane, stop deep-cloning a full-document snapshot on every survey-marker bounds change and space edit (recorded-but-never-restored waste). Current state wastes work either way.

**10. Survey markers have three competing window-level Delete keydown listeners (shapes+callouts, survey markers, legacy PAL)** (survey_marker · necessary · risk:medium · effort:medium)
- Evidence: src/components/SVGAnnotationLayer.jsx:2078-2100 (dedicated survey-marker keydown on selectedSurveyMarkerId), :657-728 (shapes+callouts); src/PageAnnotationLayer.jsx:9074-9164 (legacy PAL). The separate STATE/cascade is necessary; the THREE listeners racing on one key are accidental.
- Recommendation: Keep the cascade in handleSurveyMarkerDeleted. Unify only the key-capture layer into one delete dispatcher that inspects which selection set is populated (shapes vs callouts vs survey marker) and routes accordingly. Verify whether the legacy PAL listener is reachable in v2.0 before touching (PAL is a protected file).

**11. Survey markers persist via a fully separate legacy module (documentAnnotationService.js) with its own debounce/diff/subscription, excluded from CRDT** (survey_marker · necessary · risk:medium · effort:large)
- Evidence: src/services/documentAnnotationService.js:328-487 (syncAnnotationsToSupabase/loadSurveyMarkers, dedicated columns); src/PDFViewer.jsx:16102,16174 (own debounce effect, not the hook); src/services/annotationCloudSync.js:719,807 (dualWriteFabricCommit returns crdt:null for survey markers); src/utils/surveyMarkerSyncDiff.js:26-36.
- Recommendation: Largely NECESSARY (Excel two-way sync + dedicated columns + RLS creator-ownership + deliberate dual-write-era lock). The split-brain (every cross-cutting concern implemented twice — e.g. the 2026-04-30 bug where the survey path forgot DELETE propagation until surveyMarkerSyncDiff was bolted on) is the accidental cost. Long-term (v2.5, noted at annotationCloudSync.js:649): migrate onto the generic delta/dual-write contract behind the type carve-out, keeping only the Excel-sync + dedicated-column projection as a thin adapter. Not urgent; do after the dual-slice cleanup.

**12. Stamp (image) has DB-type mapping but NO render path and is dropped from PDF export** (stamp · accidental · risk:high · effort:medium)
- Evidence: RENDER: no image fn in src/utils/svgAnnotationRenderers.jsx (VERIFIED — no 'image' match), no objectType==='image' branch, no <image> tag; falls to dropReasons.noElementDispatched (SVGAnnotationLayer.jsx:1797-1798). EXPORT: 'image' absent from EXPORTABLE_FABRIC_TYPES (pdfAnnotationsPdfLib.js:38-48, VERIFIED), no write case; dropped as 'unsupported-type' (:357-360). Mapping exists at annotationTypeSerializers.js:57,68.
- Recommendation: Confirm whether stamps are in scope for v2.0 SVG. If YES: add renderImage(obj, index) → SVG <image href> (after the rect branch) AND add 'image' to EXPORTABLE_FABRIC_TYPES + a `case 'image'` writer (pdf-lib drawImage). If NO: document the exclusion explicitly with its own skip reason so the silent no-op isn't mistaken for a regression. Either way, the current silent double-drop is the most dangerous accidental gap because nothing flags it.

**13. Three diverged copy-paste `onRequestEditMode` handlers give the same shape different double-click behavior by mount site** (square · accidental · risk:medium · effort:medium)
- Evidence: src/PDFViewer.jsx:27524, :28434, :29072 (THREE handlers — VERIFIED, not two). They already diverged: primary site no-ops rect/circle (editType resolution at :27572-27576) while legacy site enters editType='shape' (:29098-29102). All three carry an else→editType='callout' fallthrough (:27576/:29102) that can mount the orphaned callout canvas for image/unknown types.
- Recommendation: Extract the onRequestEditMode logic into one shared callback so the sites cannot drift, and make the type→editType map exhaustive/explicit (image and unknown get a no-op, not 'callout'). This fixes the latent 'different edit behavior by scroll/render mode' bug and closes the stamp→callout-canvas mis-mount in one change.

**14. Counter is edited by two mechanisms (SVG bbox + a Fabric custom rotate control storing data.pointerAngle), flagged WIP** (counter · unclear · risk:medium · effort:medium)
- Evidence: src/PDFViewer.jsx:27573 (bbox grouping); src/components/FabricEditCanvas.jsx:2409-2481 (counterRotate control + locked scaling, '[COUNTER WIP — DO NOT TOUCH]'); src/components/SVGAnnotationLayer.jsx:1254-1260 (data.pointerAngle -90 offset instead of obj.angle).
- Recommendation: Do NOT touch blind — the in-code WIP marker requires owner sign-off. Treat as known-inconsistent. When the owner clears it, decide whether counter rotation lives in SVG bbox mode or the Fabric custom control, not both, and reconcile the data.pointerAngle vs obj.angle storage.

**15. Legacy renderArrow (group form) duplicates renderLine with hard-coded arrowhead math** (arrow · historical · risk:medium · effort:small)
- Evidence: src/utils/svgAnnotationRenderers.jsx:602-659 (renderArrow, own headSize=max(6,sw*3) polygon) vs :455-592 (renderLine, buildArrowheadRenderSpec 6 styles); dispatch SVGAnnotationLayer.jsx:1757-1767 (group) vs :1755-1756 (line).
- Recommendation: If no live/cloud data still serializes arrows as Fabric groups, delete renderArrow + its group dispatch branch so all arrows funnel through renderLine's unified 6-style arrowhead spec. Verify against stored/cloud data first; otherwise keep and document as legacy-only.

**16. DB_TYPE_TO_FABRIC_DEFAULT map is defined but referenced nowhere** (all · accidental · risk:low · effort:small)
- Evidence: src/services/annotationTypeSerializers.js:60-73 (defined). VERIFIED: grep across src/ returns only the definition line — zero usages. Deserialize rebuilds from the stored fabricObject blob, not from a type-default. Its callout→'group' entry also misleads (callouts never deserialize to a group).
- Recommendation: Delete DB_TYPE_TO_FABRIC_DEFAULT — dead code that falsely implies a type-default reconstruction path. Aligns with the north-star bias toward fewer misleading layers.

**17. AnnotationContext AnnotationStore is a fully-built but orphaned parallel state engine** (all · accidental · risk:low · effort:small)
- Evidence: src/contexts/AnnotationContext.jsx:21-339 (AnnotationStore + AnnotationProvider). VERIFIED: AnnotationProvider has no external importer (self-references only at :259,:279); its only consumer OptimizedPDFPage.jsx has no external render site (self-references only). All real state is PDFViewer useState.
- Recommendation: Delete AnnotationContext.jsx + OptimizedPDFPage.jsx (or wire them up if intended-future). A parallel dead state engine alongside the real one is a navigation hazard given the north-star goal of slimming layers. Lowest-risk cleanup; verify no test imports first.

**18. sticky_note is wired through the full serializer support with no live producer** (sticky_note · unclear · risk:low · effort:small)
- Evidence: src/services/annotationTypeSerializers.js:84 (SUPPORTED_DB_TYPES), :162 (data.type dispatch), :69 (default map); src/PDFViewer.jsx:16333,30403 are comment-only (VERIFIED — no producer).
- Recommendation: Confirm with the team whether sticky_note is planned-but-unbuilt or fully dead. If dead, drop it from SUPPORTED_DB_TYPES / the data.type dispatch. If reserved, leave a one-line TODO marking it pre-wired but not yet produced.

**19. Callout/index.jsx is a null-render stub kept alive only for legacy CalloutOverlay imports** (callout · historical · risk:low · effort:small)
- Evidence: src/components/Callout/index.jsx:1-25 (default export returns null; re-exports defaultCalloutStyle/createCallout/hexToRgba from ./types). VERIFIED importers: PageAnnotationLayer.jsx:5 and PDFViewer.jsx:17, and it IS still mounted (rendered as <CalloutOverlay> at PDFViewer.jsx:28214,28794,29619 and PageAnnotationLayer.jsx:9207) — so it is a mounted no-op, not pure dead code.
- Recommendation: Lower-risk than the big migration but NOT a one-line delete: repoint the three real re-exports (defaultCalloutStyle/createCallout/hexToRgba) to import from './types' directly, then remove the three mounted <CalloutOverlay> render sites (they render null) and the two default imports, then delete the stub. PAL is a protected file (covered by the standing waiver, minimal diff). Run npm test after.

**20. Export/print/save threads three streams (annotationsByPage, callouts, surveyMarkers) by hand at every site** (callout · accidental · risk:medium · effort:medium)
- Evidence: src/viewerShared.js:1729-1747 (summarizeAnnotationCountsForSaveExport takes 3 separate args, bolts callout/marker counts on after the objects loop); src/PDFViewer.jsx:18170-18183,18246-18268,24943-24961 (every export/save/print site marshals 3 args); src/utils/saveAnnotatedPDFFile.js:29-35 (dead helper that forwards only annotationsByPage and silently drops the other two — the hazard made concrete).
- Recommendation: Provide a single canonical collector getAllExportableAnnotations({annotationsByPage, callouts, surveyMarkers, spaces}) → flat tagged item list that the count summarizer, export plan, print plan, and metadata builder all consume. Each downstream keeps its own scope/exclusion policy (callout multi-ref, survey-marker exclusion) but no site re-implements the three-way fan-in. Delete the unused saveAnnotatedPDFFile.js helper. Largely subsumed by the keystone migration but valuable independently.

---

## Remediation Plan (safest-first)

Bring the accidental divergences onto the contract in this order. Each item is one focused, independently-verifiable change. The final KEYSTONE (callout unification) is a deliberate, well-planned migration — do NOT chip at it piecemeal; it needs a schema + CRDT backfill and the dependent forks are load-bearing until it lands.

1. **Delete the dead DB_TYPE_TO_FABRIC_DEFAULT map (annotationTypeSerializers.js:60-73).** (risk:low)
   - Delete the dead DB_TYPE_TO_FABRIC_DEFAULT map (annotationTypeSerializers.js:60-73). Grep-verified zero usages across src/. Pure removal, no behavior change.
   - Files: src/services/annotationTypeSerializers.js
   - Why: Removes a misleading layer that falsely implies a type-default reconstruction path; its callout→'group' entry actively misleads readers tracing callout deserialization. Independently verifiable (grep + npm test).

2. **Delete the orphaned AnnotationContext.jsx AnnotationStore + OptimizedPDFPage.jsx after verifying no test imports.** (risk:low)
   - Delete the orphaned AnnotationContext.jsx AnnotationStore + OptimizedPDFPage.jsx after verifying no test imports. Grep-verified: AnnotationProvider and OptimizedPDFPage have no external render/import sites.
   - Files: src/contexts/AnnotationContext.jsx, src/components/OptimizedPDFPage.jsx
   - Why: Removes a fully-built parallel dead state engine that misleads anyone tracing 'where do annotations live' — directly serves the north-star of slimming layers. Verify by build + test pass.

3. **Route survey-marker delete authority through permissionScope.getAnnotationAuthorId/canModify (or a thin adapter) instead of the bespoke `userId \|\| annotationData?.userId \|\| lastModifiedBy` chain at PDFViewer.jsx:23243.** (risk:high)
   - Route survey-marker delete authority through permissionScope.getAnnotationAuthorId/canModify (or a thin adapter) instead of the bespoke `userId || annotationData?.userId || lastModifiedBy` chain at PDFViewer.jsx:23243. Keep the rest of the delete cascade intact.
   - Files: src/PDFViewer.jsx (~23243), src/lib/collab/permissionScope.js
   - Why: Closes a per-user authority correctness bug: today the same person can be allowed to delete a shape but blocked from deleting their own survey marker (or vice versa) because the author field is read from a different slot than the canonical chain. Small, focused diff; verifiable with a two-user ownership test.

4. **Add a canModify gate + buildBulkDeletePlan routing to callout keyboard delete (handleDeleteSelectedCallouts, PDFViewer.jsx:10461) and context-menu delete (PageAnnotationLayer.jsx:4346).** (risk:high)
   - Add a canModify gate + buildBulkDeletePlan routing to callout keyboard delete (handleDeleteSelectedCallouts, PDFViewer.jsx:10461) and context-menu delete (PageAnnotationLayer.jsx:4346). Run callout ids through the same ownership check shapes use.
   - Files: src/PDFViewer.jsx (~10461), src/PageAnnotationLayer.jsx (~4346), src/lib/collab/permissionScope.js, src/lib/collab/bulkDeletePlan.js
   - Why: Closes a collaboration security gap: a non-owner can currently delete other users' callouts via keyboard or right-click, while the identical operation on a shape is gated. Independently verifiable with a two-user delete test; does not require the big migration.

5. **Resolve the stamp (image) silent double-drop.** (risk:high)
   - Resolve the stamp (image) silent double-drop. Decide scope with the user: if in-scope, add renderImage(obj,index)→SVG <image> + objectType==='image' dispatch branch AND 'image' in EXPORTABLE_FABRIC_TYPES + a `case 'image'` pdf-lib writer; if out-of-scope, add an explicit skip reason in both render and export so the no-op is honest.
   - Files: src/utils/svgAnnotationRenderers.jsx, src/components/SVGAnnotationLayer.jsx (~1742-1799), src/utils/pdfAnnotationsPdfLib.js (~38-48, ~1477-1525)
   - Why: Stamp is the only type that silently renders nothing AND exports nothing despite being a documented DB type — a likely lost render path from the SVG migration. Verifiable by creating a stamp and confirming it appears on screen and in the exported PDF (or confirming the explicit skip diagnostic).

6. **Extract the three diverged onRequestEditMode handlers (PDFViewer.jsx:27524, 28434, 29072) into one shared callback and make the type→editType map exhaustive (image/unknown → explicit no-op, never the else→'callout' fallthrough).** (risk:medium)
   - Extract the three diverged onRequestEditMode handlers (PDFViewer.jsx:27524, 28434, 29072) into one shared callback and make the type→editType map exhaustive (image/unknown → explicit no-op, never the else→'callout' fallthrough).
   - Files: src/PDFViewer.jsx (~27524, ~28434, ~29072)
   - Why: Fixes a latent bug where the same shape gets different double-click edit behavior depending on render mode, and closes the path where an image double-click mounts the orphaned callout canvas. Verifiable by double-clicking a rect/image in each mount mode.

7. **Retire the Callout/index.jsx CalloutOverlay stub: repoint the three re-exports (defaultCalloutStyle/createCallout/hexToRgba) to import from './types' directly, remove the three mounted <CalloutOverlay> null-render sites (PDFViewer.jsx:28214/28794/29619, PageAnnotationLayer.jsx:9207) and the two default imports, then delete the stub.** (risk:low)
   - Retire the Callout/index.jsx CalloutOverlay stub: repoint the three re-exports (defaultCalloutStyle/createCallout/hexToRgba) to import from './types' directly, remove the three mounted <CalloutOverlay> null-render sites (PDFViewer.jsx:28214/28794/29619, PageAnnotationLayer.jsx:9207) and the two default imports, then delete the stub. PAL is protected — minimal diff under the standing waiver.
   - Files: src/components/Callout/index.jsx, src/PDFViewer.jsx, src/PageAnnotationLayer.jsx, src/viewerShared.js
   - Why: Removes a confusing 'is there still an HTML overlay?' artifact (it's a mounted no-op, not pure dead code, so it must be unmounted before deletion). Verifiable: build + render a callout and confirm unchanged behavior + npm test.

8. **Introduce a single canonical export collector getAllExportableAnnotations({annotationsByPage, callouts, surveyMarkers, spaces}) that the count summarizer, export plan, print plan, and metadata builder consume; delete the dead saveAnnotatedPDFFile.js helper.** (risk:medium)
   - Introduce a single canonical export collector getAllExportableAnnotations({annotationsByPage, callouts, surveyMarkers, spaces}) that the count summarizer, export plan, print plan, and metadata builder consume; delete the dead saveAnnotatedPDFFile.js helper. Keep per-type policy (callout multi-ref, survey-marker exclusion) downstream.
   - Files: src/viewerShared.js (~1729), src/utils/pdfAnnotationsPdfLib.js, src/utils/pdfAppAnnotationMetadata.js, src/utils/saveAnnotatedPDFFile.js (delete), src/PDFViewer.jsx
   - Why: Removes the three-way fan-in plumbing every export/save/print site must reimplement by hand — the exact hazard that left saveAnnotatedPDFFile.js silently dropping callouts and survey markers. Verifiable by exporting a doc with all three streams and diffing counts.

9. **Resolve the legacy-history-gate gap for survey-marker/space/excel checkpoints: with the user, either add those reason prefixes to isLegacyAnnotationHistoryMeta (PDFViewer.jsx:10243-10249) so recorded snapshots are reachable when CRDT is off, OR stop deep-cloning full-document snapshots for them if Yjs is the guaranteed lane.** (risk:medium)
   - Resolve the legacy-history-gate gap for survey-marker/space/excel checkpoints: with the user, either add those reason prefixes to isLegacyAnnotationHistoryMeta (PDFViewer.jsx:10243-10249) so recorded snapshots are reachable when CRDT is off, OR stop deep-cloning full-document snapshots for them if Yjs is the guaranteed lane.
   - Files: src/PDFViewer.jsx (~10243, ~23138, ~12098, ~15190)
   - Why: Today these types push expensive full-document snapshots that the legacy restore branch never reads — undo silently depends on Yjs being live. Resolving it either fixes CRDT-off undo or stops wasted deep-clones. Verifiable by toggling CRDT and testing survey-marker undo.

10. **Collapse the survey-marker dual-slice: keep surveyMarkers (id-keyed, already holds pageNumber+bounds) as the single source of truth and derive the per-page paint list with a useMemo; replace newSurveyMarkersByPage's durable role with a transient 'newly-added id' signal for PAL.** (risk:high)
   - Collapse the survey-marker dual-slice: keep surveyMarkers (id-keyed, already holds pageNumber+bounds) as the single source of truth and derive the per-page paint list with a useMemo; replace newSurveyMarkersByPage's durable role with a transient 'newly-added id' signal for PAL. Migrate the ~20 write sites and the dual-write bounds handler (PDFViewer.jsx:23143-23187).
   - Files: src/PDFViewer.jsx (~3959, ~6699, ~23143), src/PageAnnotationLayer.jsx
   - Why: Eliminates the only type stored redundantly in two hand-synchronized slices — the dual-write is a standing source of drift bugs. High-risk due to ~20 write sites + PAL paint dependency; do after the lower-risk items and gate behind thorough manual + unit testing.

11. **After verifying no live/cloud data serializes arrows as Fabric groups, delete the legacy renderArrow + its group dispatch branch so all arrows funnel through renderLine's unified 6-style arrowhead spec.** (risk:medium)
   - After verifying no live/cloud data serializes arrows as Fabric groups, delete the legacy renderArrow + its group dispatch branch so all arrows funnel through renderLine's unified 6-style arrowhead spec.
   - Files: src/utils/svgAnnotationRenderers.jsx (~602-659), src/components/SVGAnnotationLayer.jsx (~1757-1767)
   - Why: Removes a duplicate arrow code path with its own hard-coded arrowhead math, leaving one renderer per logical type. Verifiable by data audit + rendering imported and freshly-drawn arrows.

12. **KEYSTONE (do last, gated behind schema + CRDT backfill): migrate callouts into annotationsByPage as page-coord Fabric `group` objects with data.type==='callout', mirroring counter.** (risk:high)
   - KEYSTONE (do last, gated behind schema + CRDT backfill): migrate callouts into annotationsByPage as page-coord Fabric `group` objects with data.type==='callout', mirroring counter. Add an `else if (obj.data?.type==='callout')` branch to the unified render loop (keeping renderCallout's richer signature). Then delete serializeCalloutToRow/deserializeRowToCallout, upsertCallouts + callout realtime branch, the callouts Y.Map, calloutHistoryScope.js, the separate render loop, and the count arg.
   - Files: src/PDFViewer.jsx, src/services/annotationTypeSerializers.js, src/services/annotationCloudSync.js, src/lib/collab/crdtAnnotationBridge.js, src/lib/collab/crdtUndoManager.js, src/utils/calloutHistoryScope.js, src/utils/calloutSyncPayload.js, src/components/SVGAnnotationLayer.jsx, src/utils/calloutEditAdapter.js, src/viewerShared.js
   - Why: The single change that collapses ~6 callout divergences (separate state, serializer, sync, CRDT map, history scope, count arg) onto the shared contract — completing the Phase 14 unification. Counter proves a composite shape can ride the unified path. Highest value, highest risk; requires migrating existing 0-1 callout rows + live-collab Y.Map entries to page-coord groups. Must be staged behind a backfill and is NOT safe to attempt before the dependent forks are confirmed load-bearing-only.

---

## Addendum — callout text-style flags & context menu (for KAL-80 / KAL-86)

Two callout-specific divergences that the ownership audit (KAL-80) and pipeline map (KAL-86) explicitly require, verified 2026-05-29:

**Text-style flags.** Callouts store text styling as four plain booleans —
`bold`, `italic`, `underline`, `strikethrough` — defined on the callout shape in
`src/components/Callout/types.js` (~lines 44-47, defaults ~138-141). Regular text
annotations instead use the Fabric-native fields the rest of the pipeline speaks:
`fontWeight` (`'normal'` / `700`), `fontStyle` (`'normal'` / `'italic'`),
`underline` (bool), and `linethrough` (bool), which the SVG text renderer maps to
CSS `textDecoration` (`svgAnnotationRenderers.jsx` ~1067-1082, KAL-34). So a
unification must MAP callout `{bold, italic, underline, strikethrough}` →
`{fontWeight, fontStyle, underline, linethrough}` (note `strikethrough` →
`linethrough`, `bold` → `fontWeight:700`, `italic` → `fontStyle:'italic'`) and
keep a compatibility reader for already-saved callouts. Dropping any of the four
during migration is an explicit guardrail violation.

**Context menu & clipboard.** The right-click menu is dispatched through ONE
shared state object (`annotationContextMenu` in `PDFViewer.jsx`, opened via
`window.__onAnnotationContextMenu` with a `kind: 'callout' | 'fabric'`
discriminator + `calloutId`). But the ACTIONS fork: callout entries route to
`onCutCallout` / `onCopyCallout` / `onPasteCallout` (a separate `clipboardCallout`
buffer) and a delete that does `setCallouts(prev => prev.filter(...))`
(`PageAnnotationLayer.jsx` ~4313-4345) — the same ungated delete flagged in the
catalogue (divergence #5). Regular annotations use a different action set on the
same menu. Unification target: callouts share the regular annotation menu actions
(plus any genuinely callout-only items), one clipboard, and the gated delete.

---

_Generated 2026-05-29 from a 9-dimension parallel audit (10 agents) of how every annotation type behaves across its lifecycle, plus a callout text-style/context-menu addendum. See `HANDOFF.md` for session context._
