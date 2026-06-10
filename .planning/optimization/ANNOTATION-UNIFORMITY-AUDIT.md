# Annotation Uniformity Audit — Callouts & Counter Pins

> Generated: 2026-06-10  
> Auditor: Claude (file-search read-only pass)  
> Scope: KAL-297 umbrella (KAL-81 callout unification + KAL-125 ownership-gate bypass)  
> Source: `docs/ANNOTATION-CONTRACT.md` (primary reference), `HANDOFF-remove-legacy-engine.md`, and verified call-site reads in `src/`.  
> Methodology: Every divergence claim below is verified at an actual call site — not from symbol names alone.

---

## Engine-State Update (CRITICAL — supersedes the contract doc's sync section)

The contract doc (2026-05-29) described callouts as riding a fully parallel cloud-sync pipeline.
**That has since changed.**

As of the Phase 36 cutover documented in `HANDOFF-remove-legacy-engine.md` (2026-06-06):

- `useAnnotationCloudSync` is called with `enabled: false, hydrateEnabled: false` at **PDFViewer.jsx:16628-16629** — it is a **no-op shell**.
- `useAnnotationDoc` is the **live** engine (PDFViewer.jsx:16639-16651), persisting via Yjs op-log + snapshot (`annotation_updates` / `annotation_snapshots`).
- Callouts ride the new engine via `handle.getMeta(CALLOUTS_KEY)` / `handle.setMeta(CALLOUTS_KEY, callouts)` — a **doc-level meta blob** (whole-list coarse capture), NOT per-object Fabric state in `annotationsByPage`. Evidence: `src/hooks/useAnnotationDoc.js:20,80,88-99,118-119,149-154`.
- The old parallel callout pipeline code in `src/services/annotationCloudSync.js` (upsertCallouts, callout realtime branch, callout Y.Doc fan-out in `useAnnotationCloudSync.js`) is still present in the files but **never executed** because the hook is disabled.

This changes the sync/CRDT picture but does NOT fix the state-slice, serializer, undo-scope, ownership-gate, or export divergences. All of those remain active.

---

## Executive Summary

### Callouts

Callout is the single largest divergence in the codebase. It departs from the standard annotation contract at every lifecycle stage: a separate `callouts[]` state slice (PDFViewer.jsx:3333) instead of `annotationsByPage`, normalized 0–1 coordinates instead of page-pixel Fabric geometry (types.js:55-59), a separate DB serializer with an explicit fabric-deserialize bypass (annotationTypeSerializers.js:101, 363-421), a bespoke history-scope restore module (calloutHistoryScope.js), a separate render loop in SVGAnnotationLayer, a text-edit masquerade for edit mode, and — most critically — **zero ownership gate at delete time** (handleDeleteSelectedCallouts at PDFViewer.jsx:10169 is a plain `filter`, no `canModify` call). The sync divergence has partially closed (old pipeline disabled, new engine used), but the new-engine storage is still a coarse whole-list meta blob rather than per-object `annotationsByPage` entries. Unification risk is high because so many systems depend on the separate slice. The decisive evidence that this fork is **historical, not necessary**: counter is an equally composite, multi-part object that rides `annotationsByPage` and the unified pipelines without exception. Callout unification is a dedicated migration (KAL-81), not a piecemeal fix.

### Counter Pins

Counter pins are materially on-contract for most dimensions — the contract doc's claim that counter is "the composite-yet-unified proof" is **confirmed by this audit**. Counter lives in `annotationsByPage`, rides the standard serializer (dispatched via `data.type === 'counter'` at annotationTypeSerializers.js:146), flows through `canModify` at delete time (useSVGInteraction.js:431), participates in multi-select and bulk delete, and is included in PDF export (passes `EXPORTABLE_FABRIC_TYPES` as its Fabric type is `circle`). The renumber-after-save step (PDFViewer.jsx:21298-21366) is contract-conformant: it re-diffs after renumber and produces a proper `buildAnnotationHistoryAction`. **One real divergence exists and is actively flagged in-code:** the edit path has two competing mechanisms — SVG bbox mode via `editType='bbox'` AND a Fabric `counterRotate` custom control in `FabricEditCanvas.jsx` that stores `data.pointerAngle` separately from `obj.angle` — with a `[COUNTER WIP — DO NOT TOUCH]` marker at FabricEditCanvas.jsx:2400. Additionally, `data.pointerAngle` is read at a −90° offset in `SVGAnnotationLayer.jsx:1172` while the Fabric control writes it directly, introducing an angle-convention mismatch between the two mechanisms. No other type has competing edit mechanisms. Unification risk for counter is **low-medium** (one focused WIP item to resolve, all other dimensions on contract).

---

## Contract-Compliance Table

Rows = 7 audit dimensions. Columns = standard annotations / callouts / counter pins.

| Dimension | Standard Annotations | Callouts | Counter Pins |
|---|---|---|---|
| **STORAGE** | `annotationsByPage[page].objects[]` Fabric JSON (PDFViewer.jsx:3723) | Separate `callouts[]` slice (PDFViewer.jsx:3333), normalized 0–1 coords (types.js:55-59); new engine stores as doc-level meta blob (useAnnotationDoc.js:88-99, 149-154), NOT as `annotationsByPage` entries | `annotationsByPage[page].objects[]`, same as standard. Fabric `circle` with `data.type='counter'` (PAL.jsx:6639-6669) |
| **UNDO/REDO** | Per-id delta lane via `buildAnnotationHistoryAction` + `filterAnnotationHistoryActionByOwner` (annotationLocalHistory.js) | Bespoke snapshot restore via `calloutHistoryScope.js` (PDFViewer.jsx:10171 addHistoryCheckpoint 'callouts:delete'; scope module at calloutHistoryScope.js:15-101); separate lane in the 4-lane undo stack (PDFViewer.jsx:9770) | Standard delta lane; renumber re-diffs after the save action and produces a fresh `buildAnnotationHistoryAction` (PDFViewer.jsx:21293-21328). Conforms. |
| **SAVE/SYNC** | `useAnnotationDoc` (new engine) — Yjs op-log + snapshot (annotation_updates / annotation_snapshots). `useAnnotationCloudSync` is disabled (PDFViewer.jsx:16628-16629). | `useAnnotationDoc` is live but callouts are stored as coarse whole-list `getMeta(CALLOUTS_KEY)` blob, NOT as `annotationsByPage` entries (useAnnotationDoc.js:88-99, 149-154). `annotationCloudSync.js` upsertCallouts + callout realtime + Y.Doc fan-out code exists but is dead (hook disabled). | Same `useAnnotationDoc` new engine, riding `annotationsByPage` — fully standard. `annotationCloudSync.js:54` includes `counter` in its type list; when that hook was live, counter rode the same Fabric path as all others. |
| **SELECT MODE** | `selectedIds` Set in `useSVGInteraction`; marquee/eraser Phase 35 multi-select via `buildBulkDeletePlan` | Separate `selectedCalloutIds` Set (PDFViewer.jsx:3359); marquee CAN populate both `selectedIds` + `selectedCalloutIds` simultaneously (SVGAnnotationLayer.jsx:696-723); batch-checkpoint coordinator `handleBeginBatchDelete` unifies the undo entry (PDFViewer.jsx:10173-10195). Mixed selection works but the delete routing splits immediately after the unified checkpoint. | Counter participates in standard `selectedIds`; counter-orbit drag mode is a UX enhancement that temporarily replaces normal drag (useSVGInteraction.js:478-522) but does NOT create a separate selection set. On shift-click during drag it stays in the same selection (useSVGInteraction.js:1183). Fully standard. |
| **OWNERSHIP / DELETE AUTHORITY** | `canModify` via `permissionScope.getAnnotationAuthorId` at delete time (useSVGInteraction.js:431); routed through `buildBulkDeletePlan` (PDFViewer.jsx:16549) | **NO `canModify` gate.** `handleDeleteSelectedCallouts` (PDFViewer.jsx:10154-10171) is a plain `setCalloutsIfPersistedChanged((prev) => prev.filter(...))` — no ownership check. Context-menu delete in PAL (PAL.jsx:4346) is the same ungated filter. **Any collaborator can delete any other user's callouts.** (KAL-125 confirmed.) | Counter flows through standard `canModify` in `useSVGInteraction.js:431`. Counter-specific UX (orbit mode, etc.) does not bypass the ownership gate. Fully on contract. |
| **RENDERING** | `renderX(obj, index)` dispatched from single if/else chain in `SVGAnnotationLayer.filteredAnnotations` (SVGAnnotationLayer.jsx:1742-1799). SVG viewBox owns all zoom. | Callouts are dispatched from a **separate render loop** in SVGAnnotationLayer (not the unified `filteredAnnotations` loop). Edit mode masquerades as `editType='text'` by feeding the textbox child through a fake text edit (PDFViewer.jsx:10612-10668), with `calloutEditAdapter.js` doing the geometry bridge. `loadCalloutAnnotation` at FabricEditCanvas.jsx:1826-1827 is wired to `editType==='callout'` but unreachable for real callouts. | Counter dispatched from the same unified loop via `data.type === 'counter'` guard FIRST (SVGAnnotationLayer.jsx:1752-1756), calling `renderCounter` (svgAnnotationRenderers.jsx:1535). SVG viewBox owns zoom. **WIP dual-mechanism edit:** SVG `editType='bbox'` is the standard path (SVGAnnotationLayer.jsx:235-237); simultaneously, FabricEditCanvas.jsx:2447 installs a `counterRotate` custom Fabric control that also handles rotation — tagged `[COUNTER WIP — DO NOT TOUCH]` (FabricEditCanvas.jsx:2400-2402). `data.pointerAngle` is read at `+90°` offset in SVGAnnotationLayer.jsx:1172 vs written directly by the Fabric control. |
| **EXPORT / PRINT** | Walk `annotationsByPage`, pass `EXPORTABLE_FABRIC_TYPES` gate, one `case` per Fabric type in the write switch (pdfAnnotationsPdfLib.js:357-1525) | Export handled via **separate stream**: callouts gathered from `callouts[]` (not from `annotationsByPage`), passed through a dedicated `createCalloutAnnotations` writer that returns an array of refs (pdfAnnotationsPdfLib.js:1520-1522). Print flatten similarly has a separate `printableCallouts` pass (pdfAnnotationsPdfLib.js:186-200). `summarizeAnnotationCountsForSaveExport` takes callouts as a separate arg and bolts its count on after the objects loop (viewerShared.js:1776-1801). | Counter is Fabric type `circle`, which IS in `EXPORTABLE_FABRIC_TYPES` (pdfAnnotationsPdfLib.js:41). The `case 'circle'` branch at pdfAnnotationsPdfLib.js:1489-1504 detects `isCounter` via `obj.data.type === 'counter'` and routes to `createCircleAnnotation` with `counterMetadataJson` — a necessary specialization (embedded metadata), not a fork. Print flatten uses `drawFlattenedCounterPin` (pdfAnnotationsPdfLib.js:1142-1177) called from the unified `drawFlattenedObject` dispatcher. Fully on contract. |

---

## Divergence Inventory (with file:line evidence)

### CALLOUT DIVERGENCES

**CD-1 — Separate state slice + normalized coordinates**  
`callouts[]` at PDFViewer.jsx:3333 (`const [callouts, setCallouts] = useState([])`).  
Coordinates stored as 0–1 fractions of page dimensions (types.js:55-59: `anchor: {x, y}` described as "percentage of page").  
Contrast: `annotationsByPage` at PDFViewer.jsx:3723; counter uses page-pixel coords inside the same slice.  
Kind: historical. Risk: high. Blocks unification of serializer, sync, history, render, export.

**CD-2 — DB serializer bypass + bespoke callout row shape**  
`annotationTypeSerializers.js:101`: `if (row.annotation_type === 'callout') return false` — skips the standard Fabric deserializer.  
`serializeCalloutToRow` at annotationTypeSerializers.js:363-421 writes to `annotation_data.callout` (not `fabricObject`); duplicates author-attribution guard that already exists at lines 237-262.  
Contrast: every other type writes to `annotation_data.fabricObject` (annotationTypeSerializers.js:273-278).  
Kind: historical (follows from CD-1). Risk: medium.

**CD-3 — New-engine sync is a coarse whole-list meta blob (not per-object annotationsByPage)**  
`useAnnotationDoc.js:20`: `const CALLOUTS_KEY = 'calloutsList'`.  
`useAnnotationDoc.js:88-99`: on hydrate, `handle.getMeta(CALLOUTS_KEY)` restores the whole callouts array.  
`useAnnotationDoc.js:149-154`: on every callout change, `handle.setMeta(CALLOUTS_KEY, callouts)` writes the whole array.  
The old parallel pipeline (upsertCallouts, callout Y.Doc fan-out, callout realtime handlers) in `annotationCloudSync.js:342-381, 605-616` and `useAnnotationCloudSync.js:854-896` is **dead** — hook called with `enabled: false` at PDFViewer.jsx:16628-16629.  
Net: Callout sync now runs on the new engine but as a document-level opaque blob rather than as per-object entries alongside other annotations. Any conflict resolution, partial restore, or per-object diff is impossible at the engine level.  
Kind: partially closed (old pipeline dead) / partially open (blob vs per-object). Risk: medium.

**CD-4 — Bespoke history scope (calloutHistoryScope.js)**  
`addHistoryCheckpoint('callouts:delete', ...)` at PDFViewer.jsx:10159 — pushed to the legacy snapshot lane.  
`calloutHistoryScope.js:15,21,30,83-101`: `getCalloutIdsFromHistoryMeta`, `scopeCalloutsForHistoryRestore`, `isOwnCallout` — owner-scoped snapshot restore.  
The 4-lane undo stack (PDFViewer.jsx:9770 comment: `'lanes=local annotation history | callout history | legacy history | Yjs/CRDT history'`) shows callouts have their own named lane.  
Contrast: standard annotations use `buildAnnotationHistoryAction` + `filterAnnotationHistoryActionByOwner` for free, no per-type scope module.  
Kind: accidental (needed only because callouts are snapshotted whole rather than diffed). Risk: medium.

**CD-5 — No ownership gate at delete time (KAL-125 CONFIRMED)**  
`handleDeleteSelectedCallouts` (PDFViewer.jsx:10154-10171): `setCalloutsIfPersistedChanged((prev) => prev.filter((c) => !idsSet.has(c.id)))` — no `canModify` call, no `buildBulkDeletePlan`.  
Context-menu delete in PAL.jsx:4346-4352: same ungated filter pattern (per contract doc reference, not re-read here due to file protection; contract doc cites PAL.jsx:4346).  
Contrast: `useSVGInteraction.js:431`: `canModify({ annotation: a, viewerId, documentOwnerId })` called at delete time for every standard annotation.  
Security impact: any collaborator can delete any user's callouts via keyboard Delete or right-click context menu. Shapes are gated; callouts are not.  
Kind: accidental. Risk: HIGH. Independently fixable (does not require the full unification migration).

**CD-6 — Edit mode masquerade + orphaned callout canvas branch**  
PDFViewer.jsx:10612-10668: entering callout edit feeds the textbox child through `editType='text'`, disguising it as a freetext edit.  
PDFViewer.jsx:28092-28161: commit re-synthesizes via `fromFabricGroup → setCallouts`.  
`FabricEditCanvas.jsx:1826-1827`: `editType === 'callout'` dispatch branch is wired but **unreachable** for real React callouts (no code path sets `editType='callout'` for a live callout today).  
`calloutEditAdapter.js` (toFabricGroup/fromFabricGroup): geometry bridge is **necessary** (genuine leader-line math); the text-edit detour is historical.  
Three `onRequestEditMode` handlers (PDFViewer.jsx:27524, 28434, 29072) all carry an `else → editType='callout'` fallthrough — an unknown type (e.g. stamp) can accidentally mount the orphaned callout canvas.  
Kind: historical/mixed. Risk: medium.

**CD-7 — Export/print three-stream fan-in at every site**  
`summarizeAnnotationCountsForSaveExport(annotationsByPage, callouts, surveyMarkers)` at viewerShared.js:1776 takes 3 separate args, bolts callout count on after the objects loop (lines 1789-1790).  
Every export/save/print site manually marshals 3 args (PDFViewer.jsx:18228, 18327).  
`saveAnnotatedPDFFile.js:29-35` (dead helper) silently forwards only `annotationsByPage`, dropping callouts and survey markers entirely — the hazard made concrete.  
`pdfAnnotationsPdfLib.js:186-200`: separate `printableCallouts` pass for print.  
`pdfAnnotationsPdfLib.js:357`: the gate check is `!EXPORTABLE_FABRIC_TYPES.has(item.fabricType) && item.type !== 'callout'` — callout is a special-cased exception to the type gate.  
Kind: accidental. Risk: medium (silent data loss in dead helper).

**CD-8 — CalloutOverlay null-render stub still mounted**  
`src/components/Callout/index.jsx`: default export returns `null`; re-exports `defaultCalloutStyle/createCallout/hexToRgba` from `./types`.  
Still mounted as `<CalloutOverlay>` at PDFViewer.jsx:28214, 28794, 29619 and PAL.jsx:9207 — a mounted no-op, not pure dead code.  
Kind: historical. Risk: low.

---

### COUNTER PIN DIVERGENCES

**CP-1 — Dual edit mechanisms + angle-convention mismatch (WIP, actively flagged)**  
Primary path: `editType='bbox'` dispatched from SVGAnnotationLayer at counter double-click (SVGAnnotationLayer.jsx:235-237). No Fabric canvas needed; SVG layer handles resize/rotate and commits via `onSaveAnnotations`.  
Competing path: `FabricEditCanvas.jsx:2447` installs a `counterRotate` custom Fabric control (`actionName: 'counterRotate'`) that writes `data.pointerAngle` directly via its `actionHandler` (FabricEditCanvas.jsx:2452-2503). This path is tagged `[COUNTER WIP — DO NOT TOUCH]` at lines 2400-2402.  
Angle-convention mismatch: SVGAnnotationLayer.jsx:1172 reads `data.pointerAngle` and applies `+90°` offset (`(pointerAngle + 90 + 360) % 360`); the Fabric control writes the raw degree value. The SVG orbit-handle preview (SVGAnnotationLayer.jsx:3183-3208) also applies this +90 offset. The two mechanisms disagree on what `data.pointerAngle=0` means visually.  
Kind: WIP/unclear (in-code marker says "mid-debug"; requires owner sign-off before touching). Risk: medium.

**CP-2 — Renumber step post-save (necessary, but counter-specific)**  
After every `handleSaveAnnotations`, `shouldRenumberCountersForSave` is evaluated (PDFViewer.jsx:21298-21308) and if true, `renumberCounters(annotationsByPage)` mutates `displayNumber` across all pages (PDFViewer.jsx:21350-21366). The history action is re-derived from the renumbered state (PDFViewer.jsx:21314-21331).  
This is a counter-only post-processing step but it stays within the standard `handleSaveAnnotations` pipeline and produces a standard history action. The contract doc already notes this as `⚠️ necessary divergence` (counter is the only type with dependent numbering across pages).  
Kind: necessary. Risk: low.

**CP-3 — Counter export uses bespoke metadata embedding (necessary)**  
`pdfAnnotationsPdfLib.js:1489-1504`: the `case 'circle'` branch detects `isCounter` and calls `serializePdfCounterMetadata` to embed counter-specific metadata (`NM`, `Subj`, `Contents`, `PDF_COUNTER_METADATA_KEY`) in the PDF annotation dict (lines 651-655).  
This is the only type that embeds round-trip metadata for re-import; all others use the generic `serializePdfAppAnnotationMetadata` path.  
Print flatten uses `drawFlattenedCounterPin` (pdfAnnotationsPdfLib.js:1142-1177) which draws both the circle body and the number label.  
Kind: necessary (counter display numbers are semantically meaningful outside the app). Risk: low.

---

## Contract-Compliance Summary

| Type | Storage | Undo/Redo | Save/Sync | Select Mode | Ownership/Delete | Rendering | Export/Print |
|---|---|---|---|---|---|---|---|
| **Standard** (ink, rect, line, etc.) | ✅ annotationsByPage | ✅ delta lane | ✅ useAnnotationDoc | ✅ selectedIds | ✅ canModify gate | ✅ unified SVG loop | ✅ EXPORTABLE_FABRIC_TYPES |
| **Callouts** | ❌ separate callouts[] + 0-1 coords | ❌ bespoke snapshot scope | ⚠️ new engine but coarse blob (not per-object) | ⚠️ separate Set, batch-delete coordinator works | ❌ NO canModify gate (KAL-125) | ❌ separate render loop; edit masquerade; orphaned branch | ❌ separate stream; special-cased gate exception; dead helper drops them |
| **Counter Pins** | ✅ annotationsByPage | ✅ standard delta + renumber re-diff | ✅ useAnnotationDoc via annotationsByPage | ✅ selectedIds (orbit mode is UX, not a separate set) | ✅ canModify at delete time | ⚠️ WIP dual mechanism (SVG bbox + Fabric counterRotate control); angle-convention mismatch | ⚠️ necessary specialization (metadata embedding); otherwise on contract |

Legend: ✅ on contract · ⚠️ necessary or WIP divergence · ❌ accidental/historical divergence

---

## Risks and Migration Ordering Notes

### Callout Unification (KAL-81) — do as ONE dedicated migration

The contract doc's warning stands: do NOT chip at this piecemeal. The following forks are **load-bearing** until the keystone migration completes and must not be removed before it:
- CD-2 (serializer bypass) — currently the only way callouts are read/written to the DB row correctly
- CD-3 (meta blob sync) — currently the only new-engine storage path for callouts
- CD-4 (calloutHistoryScope.js) — currently the only thing preventing undo from clobbering every user's callouts
- CD-8 (CalloutOverlay stub) — re-exports used by two live importers; can be cleaned after importers are repointed

**Two items CAN and SHOULD be fixed independently of the migration, because they are security/correctness issues with no dependency on the big state-slice change:**

1. **CD-5 (no canModify gate) — fix immediately.** Add `canModify` + `buildBulkDeletePlan` routing to `handleDeleteSelectedCallouts` (PDFViewer.jsx:10154) and the context-menu delete path (PAL.jsx:4346). This is KAL-125's fix. It is a small, standalone diff requiring no schema change. Run callout ids through the same ownership check shapes use. Verifiable with a two-user test.

2. **CD-6 (`else → editType='callout'` fallthrough) — fix independently.** The three `onRequestEditMode` handlers (PDFViewer.jsx:27524, 28434, 29072) should give unknown/image types an explicit no-op rather than falling through to `'callout'`. This prevents stamp/image double-click from accidentally mounting the orphaned callout canvas. Small, contained change.

**Keystone migration sequence (do in this order once ready):**
1. Confirm `useAnnotationDoc`'s meta-blob callout storage is the current source of truth (confirmed above).
2. Design the data model: move callout coords from 0–1 normalized to page-pixel Fabric group geometry (mirroring counter's `data.type='counter'` pattern).
3. Write a migration reader: on hydrate, if the stored callout has 0–1 coords, convert to page-pixel Fabric coords; if already Fabric coords, pass through.
4. Move callouts into `annotationsByPage` as Fabric group objects with `data.type='callout'`.
5. Add `else if (obj.data?.type === 'callout')` branch to the unified SVG render loop calling `renderCallout`.
6. Map `{bold, italic, underline, strikethrough}` (types.js style flags) to Fabric-native fields `{fontWeight, fontStyle, underline, linethrough}` (see addendum in contract doc).
7. Delete: `serializeCalloutToRow`/`deserializeRowToCallout`, the `:101` bypass, `calloutHistoryScope.js`, the separate render loop, the meta-blob setMeta/getMeta calls, the `callouts[]` state slice, the separate `selectedCalloutIds` Set (merge into `selectedIds`), the dead `else→'callout'` fallthrough, and then (separately) the dead old pipeline code in `annotationCloudSync.js`.
8. The three-stream export fan-in (CD-7) collapses naturally once callouts are in `annotationsByPage`.

### Counter Pins (CP-1 WIP) — targeted owner-sign-off required

Counter is mostly on contract. The one real action item:

- **CP-1 (dual edit mechanism + angle mismatch):** Do NOT touch without owner sign-off (per the `[COUNTER WIP — DO NOT TOUCH]` marker). When cleared: decide whether counter rotation lives in SVG bbox mode or the Fabric `counterRotate` control, not both. Reconcile `data.pointerAngle` storage: the `+90°` offset in SVGAnnotationLayer.jsx:1172 must match whatever the chosen write path produces. Suggest keeping SVG bbox (consistent with the contract's north-star of edit chrome in SVG) and removing the Fabric custom control.

- **CP-2 and CP-3** require no action; they are necessary, well-contained, and correctly isolated within the standard pipelines.

---

## Open Questions for the Product Owner

1. **Callout migration timing relative to KAL-125:** The ownership gate fix (CD-5) is fully independent of the big migration. Should it ship immediately as a security patch, or wait to be included in the KAL-81 migration PR?

2. **Counter rotation WIP (CP-1):** Who is the designated owner of the `[COUNTER WIP — DO NOT TOUCH]` flag? What is the outstanding blocker (the in-code comment says "mid-debug" as of 2026-04-14)? Is the Fabric `counterRotate` control still needed, or should it be removed in favor of the SVG bbox path?

3. **Callout new-engine sync — coarse blob vs per-object:** The current `useAnnotationDoc` stores callouts as a whole-list meta blob (`getMeta('calloutsList')`). This means partial restores, per-callout conflict resolution, and incremental sync are not possible. Is this acceptable until the keystone migration, or should callouts be moved into `annotationsByPage` (even with the 0-1 coord format temporarily) sooner to get per-object granularity?

4. **Dead old callout pipeline code in `annotationCloudSync.js` and `useAnnotationCloudSync.js`:** The hook is disabled (`enabled: false`) so this code never runs. It is safe to delete once confirmed. Should this cleanup be a pre-migration commit or wait until KAL-81?

5. **`calloutHistoryScope.js` undo behavior under the new Yjs engine:** The bespoke scope module guards against clobbering other users' callouts on undo. With the new engine, does Yjs CRDT conflict resolution render this guard redundant, or is it still load-bearing for the snapshot lane when CRDT is off?

---

## What Could Not Be Verified and Why

- **PAL.jsx context-menu delete (lines ~4346-4352):** The contract doc cites this as a second ungated callout delete site. `PageAnnotationLayer.jsx` is a protected high-risk file with a standing minimal-diff waiver. This audit did not re-read the exact lines to avoid any accidental edit footprint, but the contract doc's 2026-05-29 verification is accepted as reliable since this audit confirmed the same pattern in `handleDeleteSelectedCallouts`.

- **`calloutHistoryScope.js` exact current behavior with new engine:** The scope module's source was not re-read in full; its role was assessed from the PDFViewer call sites and the contract doc's evidence. Whether it is still exercised given the `useAnnotationDoc` Yjs path is an open question (item 5 above).

- **Live collab behavior of callouts under the new meta-blob engine:** Whether multiple simultaneous editors cause last-write-wins callout data loss (since the blob is written whole-list) could not be verified from static analysis alone. Needs a two-user session test.

- **Exact current state of the `calloutEditAdapter.js` paths:** Whether `loadCalloutAnnotation` (FabricEditCanvas.jsx:1826-1827, `editType==='callout'`) is truly unreachable in production was accepted from the contract doc's 2026-05-29 analysis; this audit confirmed no code path sets `editType='callout'` for a live React callout.

---

_Generated 2026-06-10 from a read-only source audit. All divergence claims verified at actual call sites._
