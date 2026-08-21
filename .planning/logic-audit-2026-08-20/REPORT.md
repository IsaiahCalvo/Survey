# Survey — Full-App Logic Audit (Complete)

Written: 2026-08-20 (evening)

Two audit passes, 113 sub-agents total, 40 feature areas, every serious finding adversarially verified before inclusion. Pass 1 = annotation tools, undo, pages, spaces, bookmarks, search, zoom + deep root-cause of the two reported bugs (eraser penetration, z-order reset). Pass 2 = export/print, realtime collab, offline queue, Excel sync, OneDrive, sharing, roles, auth, billing, account deletion, shortcuts, mobile, Electron.

Totals: 103 verified findings (58 pass 1 + 45 pass 2), 6 claims refuted and excluded.

---

# Survey Full-App Logic Audit — Synthesis Report
**Date:** 2026-08-20 · Sources: 2 deep root-cause investigations + 20 feature-area audits (all findings below were independently verified against live code; refuted claims excluded)

---

## 1. Executive Summary (plain English)

The app looks and feels right on screen, but this audit found serious problems in three areas: **what comes out of the app**, **what happens when two people work together**, and **undo**.

- **Saving and printing PDFs is the worst area.** Every line and arrow anyone draws lands in the **wrong spot** — often completely off the page — when the file is saved or printed. Arrows also lose their arrowheads, cloud-style rectangle borders silently turn into plain rectangles, and printed circles/ovals come out the wrong size if they were ever resized. On screen everything looks perfect, so nobody gets a warning — the damage only shows up in the file that gets sent to a client.
- **The two known bugs are confirmed and explained.** The eraser deletes everything it touches (not just the ink on top) because it was never taught about layering or "ink only" rules. Bring-to-front/send-to-back doesn't stick because the ordering is never actually saved — it only lives in the current screen session, and any later change snaps it back.
- **Working with a teammate can silently destroy work.** Several timing windows exist where one person's edit overwrites or deletes another person's — resizing a shape while a teammate deletes something, editing a text box or callout while a teammate moves things, pressing undo after a teammate changed the same item. In each case the loss is silent: no warning, no error, work just vanishes for everyone.
- **Undo has traps.** After the automatic Excel sync runs, undo can permanently stop working for older changes. Undoing your first edit on a freshly imported PDF can wipe out all the markups that came with that PDF, permanently. In some sequences, "redo" brings back an old version of the page and deletes your newest work.
- **Reopening a document hides survey markers.** All saved markers are loaded but invisible until you manually open the survey panel and click into a module — it looks like the work is gone.
- **Page management (reorder, delete, cut/paste pages) has stale-reference bugs** that can move or duplicate the wrong page, and two people managing pages at once silently overwrite each other.
- Dozens of smaller issues: a "duplicate" keyboard shortcut that instead downloads two debug files, copy/paste shortcuts that ignore multi-selections and callouts, a sync indicator that shows "Offline" in red during perfectly normal saves, bookmarks that only live on one computer, and more.

Nothing here is unfixable, and several fixes are one-liners. The recommended order is at the end: fix the export/print correctness first (it damages deliverables), then the two known bugs, then the shared-editing data-loss windows.

---

## 2. The Two Known Bugs — Root Cause and Fix Plan

### 2.1 Eraser deletes everything it touches ("eraser penetration") — confidence: high

**Root cause.** The eraser's target selection is "every object the swept eraser disk touches, anywhere on the page" — with no topmost-first ranking and no ink-only restriction:

- `src/utils/pageSpaceEraser.js:1089-1107` and `:1140-1147` — the commit engine iterates ALL page objects; every touched path gets carved, every touched non-path object (shape, text, stamp, image) is **whole-deleted**.
- `src/utils/eraserPolicy.js:66-69` — even in partial/pixel mode, any non-ink object is promoted to whole-delete.
- `src/utils/eraserHitTest.js:88-95` + `src/utils/geometryHitTest.js:903-909` — per-object hit booleans with no ordering; filled shapes hit-test their entire interior, so a whole stack of shapes under one pass all report hits.
- Preview lanes (`FabricEraserCanvas.jsx:1596-1620, 1669-1689`) and the callout/survey-marker lanes (`:1852-1853`, `surveyMarkerEraser.js:44-70`) mirror the same all-hits policy. The only filters are permission/lock/scope — never stacking.
- Z-order IS available and well-defined: `SVGAnnotationLayer.jsx:2045` paints `objects[]` in array order (higher index = topmost) — the eraser just never consults it.

**Industry norm** (Bluebeam, Acrobat, GoodNotes, PDF Expert): the eraser touches ink (pen/highlighter) only; non-ink objects are never erasable by the eraser, and no app whole-deletes an entire stack.

**Fix plan (two parts, page-unit logic only — does not touch canvas sizing, `zoomGeneration`, or SVG viewBox scaling):**
1. **Ink-only partial mode:** add a `'skip'` operation to `getEraserOperation` — in partial mode, non-eligible objects are skipped, not whole-deleted. Suppress the non-path whole-delete loop, the atomic preview ghosts, and the callout/marker delete lanes in partial mode so preview always matches commit. This alone fixes the default-tool complaint (`eraserMode` defaults to `'partial'`, `FabricEraserCanvas.jsx:270`).
2. **Topmost-only in entire (object-eraser) mode:** per eraser sample point, resolve the single topmost erase-permitted hit by `objects[]` index (treating an imported-PDF appearance composite as one unit ranked by its highest member; markers/callouts render above `objects[]` so they outrank at the same point); final delete set = union of per-sample winners. Resolve topmost *after* the permission filter so a locked top object doesn't shield an erasable one below.

Downstream (erase intent → commit → per-target undo restore, `annotationEraseCommitPlan.js:307`) flows through unchanged. Edge cases handled: overlapping ink still all carves in partial mode (industry standard); zoom mid-erase is safe (page-unit points are zoom-invariant; the `zoomGeneration` auto-commit contract is untouched); the `partialEraserComplexity` perf test and PDFViewer source-assertion tests will need updating.

### 2.2 Front/back ordering doesn't stick ("z-order reset") — confidence: high

**Root cause — two layers.** Z-order is modeled *only* as transient array position in React state; the durable store cannot represent it at all:

- Bring to Front/Back etc. (`PDFViewer.jsx:25875-25934`, `useAnnotationContextMenu.jsx:501-537`) splice-and-reinsert the local array — looks correct locally.
- Persistence diffs a keyed Y.Map per-object (`annotationDocStore.js:1069-1102, 1140-1175`); a pure permutation changes **no** object payload, so **zero ops are written** (`shallowEntryEqual`, `:1191-1195`). The reorder never reaches the durable store — reload always loses it. (Independently reconfirmed by the z-order feature audit with a live repro: `{added:0, updated:0, removed:0}`.)
- The read side `docToByPage` (`:677-703`) rebuilds each page in Y.Map key-insertion order (original creation order — and not even guaranteed identical across clients).
- The visible "snaps back on next edit" symptom: the realtime INSERT handler applies **self-echo** rows too and unconditionally calls `notifyChange` (`annotationDocSync.js:2910-2927, 2973-2979`), which re-materializes all pages in insertion order and replaces the locally reordered array (`useAnnotationDoc.js:299-339`). So the user's next move/edit is the trigger that reverts the ordering.

**Fix plan:** persist an explicit per-annotation fractional order key.
1. **Write:** stamp `obj.data.zOrder` (fractional-index / LexoRank string, id tiebreak) in `handleReorderAnnotation` and `reorderAll` — only the moved objects' payloads change, so the existing diff/sync pipeline emits normal per-object ops with no schema change.
2. **Read:** in `docToByPage`, as the final step, stable-sort each page by `(zOrder ?? insertion-order sentinel, id)`. Renderers and hit-testing keep using array order — no component changes.
3. Edge cases: undo/redo captures `zOrder` automatically (it rides in the payload — verify `normalizeCanvasJsonForHistory` doesn't strip it); concurrent reorders converge via per-object LWW + id tiebreak; re-mint `zOrder` on paste/duplicate so clones land on top; leave imported PDF annotations unset (sentinel preserves import order). Optionally also skip `notifyChange` on pure self-echo no-ops (`annotationDocSync.js:2916-2926`) as hygiene — but the persisted key is the real fix.

---

## 3. All Remaining Findings (ranked, deduplicated)

Duplicates merged: the Line-tool and Arrow-tool export-position findings are one bug (#1); the Rectangle-tool and Move/Resize/Rotate stale-index findings are one bug (#6); the Z-order-persistence finding is folded into known bug 2.2 above.

### CRITICAL

**1. Every drawn or edited line/arrow exports and prints at the wrong page position** — Anything drawn with the line or arrow tool lands in the wrong spot — often entirely off the page — in every saved/downloaded and every printed PDF. On screen it looks perfect; the client's copy is wrong. Verified with a live repro using the real export functions.
> `buildLineCommitJSON` (`src/utils/annotationCreationCommit.js:224-242`) stores x1/y1/x2/y2 **center-relative** to the bbox (fabric contract). On-screen renderers compensate (`svgBoundingBox.js:258-267`, `lineRenderHelpers.js:52-59`); both PDF writers do not: `createLineAnnotation` (`pdfAnnotationsPdfLib.js:2304-2317`, Save/Export path via `PDFViewer.jsx:20889`) and `drawFlattenedLine` (`:3075-3081`, Print path via `PDFViewer.jsx:28864`) read x1..y2 raw as absolute coords. A (100,100)→(150,140) arrow exported as (-25,-20)→(25,20). Also re-triggered on any endpoint edit of imported lines (`useSVGInteraction.js:1958-1972`). Masked by tests whose fixtures omit left/top. **Fix:** absolutize endpoints (add `left+width/2`, `top+height/2` — reuse `getLineEndpoints`) in both writers; add a fixture with real left/top.

### HIGH

**2. Arrowheads are silently dropped on export** — every exported arrow becomes a plain headless line in Acrobat/Preview/Bluebeam, and even re-importing the app's own export loses the head.
> Arrow tool stores the style only in `data.arrowheadStyle` (`annotationCreationCommit.js:244-254`); `createLineAnnotation` only writes `/LE` from `lineEnding1/2` (`pdfAnnotationsPdfLib.js:2339-2343`), fields the tool never sets (only legacy group arrows and callout leaders set them). **Fix:** map `data.arrowheadStyle` → `/LE` via the existing `ARROWHEAD_STYLE_TO_PDF_LINE_ENDING` table (used at `:2525` for callouts) inside `createLineAnnotation`; same for the print-flatten arrow path.

**3. Cloud-style rectangle borders are permanently lost on export** — a revision-cloud rectangle exports as a straight-edged box, silently; even re-importing the app's own export can't restore it (the data is gone, not just incompatible).
> Rect export goes to `createSquareAnnotation` (`pdfAnnotationsPdfLib.js:3719-3724, 1748-1786`) which never writes `/BE` or reads `data.pdfCloudIntensity`; the only `/BE` writer is the polygon path gated on fields the app never sets (`:2241-2244`). Round-trip metadata allowlist also omits the field (`pdfAppAnnotationMetadata.js:23-53`). Import side already parses `/BE` on `/Square` correctly (`pdfAnnotationImporter.js:4260-4311`) — export is the one-sided gap. **Fix:** emit `/BE /S /C` + intensity in `createSquareAnnotation` when `data.pdfCloudIntensity` is set; add the key to the metadata allowlist; draw scallops in the print-flatten rect branch.

**4. Printed circles/ovals (and rectangles) come out at their pre-resize size** — resize a shape, print: the printout shows the old size, diverging from both the screen and normal export.
> Resize writes only scaleX/scaleY (`useSVGInteraction.js:3338-3351`); the print-flatten path reads raw rx/ry/width/height with no scale multiplication (`pdfAnnotationsPdfLib.js:3333-3348` ellipse, `:3288-3289` rect), while the export path does it correctly (`:1943-1944`). **Fix:** multiply by |scaleX|/|scaleY| in `drawFlattenedObject`'s rect/ellipse branches, matching every sibling branch.

**5. Lines/arrows in a multi-select rotate/resize get displaced — and the wrong position is saved** — batch-rotating a group that includes a line moves that line to the wrong place, worse at bigger angles.
> Group-rotate (`useSVGInteraction.js:1383-1394`) and group-resize (`:1641-1659`) compute line world endpoints as `x1 + left`, omitting the `+ width/2`/`+ height/2` the renderer actually uses (`svgBoundingBox.js:258-267`); the wrong comment at `:1370-1382` is the root cause. Result persists via `onSaveAnnotations` (`:3030-3037`). **Fix:** use the canonical endpoint helper (or the already-captured correct `memberOriginals` AABB data at `:3781-3816`) in both branches.

**6. Resizing/rotating/moving commits by stale array index — a teammate's concurrent delete corrupts a different shape or crashes the tool** *(merged: Rectangle-tool + Move/Resize/Rotate findings)* — if someone deletes an annotation while you're mid-drag, your release either silently rewrites the wrong shape's geometry (corruption synced to everyone) or throws and leaves the tool stuck in resize mode.
> Drag state pins `annotationIndex` at pointer-down (`useSVGInteraction.js:3947-3995`); commit does `updatedAnnotations.objects[ds.annotationIndex]` with no id lookup or existence check (`:3207-3233` resize — `obj.type` unguarded at `:3233`; `:3388-3413` rotate — `rotObj.angle` assignment throws on undefined). Remote deletes shift indices (`docToByPage` rebuild, `annotationDocStore.js:686-703`) and the selection-clamp effect is disabled during drags (`:380-381`). The 'move'/'vertex' branches already guard (`:2852, 2951, 2981`) — resize/rotate are the outliers. No try/finally, so the drag-state reset is skipped on throw. **Fix:** capture the annotation **id** at drag start, re-resolve index by id at commit (no-op if gone); wrap the commit in try/finally that resets drag state.

**7. Editing a text annotation commits by stale index — can silently replace a teammate's unrelated annotation with your text box** — while your text editor is open, a teammate's insert/delete on the same page shifts positions; your commit overwrites whatever now sits in the old slot.
> `editingAnnotation.index` frozen at open (`PDFViewer.jsx:31504-31521`); commit does `updated.objects[annotationIndex] = json` (`TextEditOverlay.jsx:383-392`) against the live array; remote updates replace the array with no editor coordination (`useAnnotationDoc.js:299`). The corruption then propagates through id-based history/sync as a legitimate delete of the teammate's object. **Fix:** commit by stable id (the callout edit path already matches by `c.id` — mirror it); bail gracefully if the id is gone.

**8. Undo can retarget your selection to a completely different shape** — after Ctrl+Z of an earlier create/delete, the visible handles silently jump to an unrelated object; the next drag/resize/Delete acts on the wrong shape.
> `selectedIds` is a Set of raw indices (`useSVGInteraction.js:168`); the only reconciliation is a bounds check (`:380-391`); undo/redo splice/filter shifts indices (`annotationLocalHistory.js:574-582`) and no undo/redo handler ever re-points or clears selection (contrast `handleCutAnnotation`/`handleReorderAnnotation`, which do — `PDFViewer.jsx:25853-25933`). **Fix:** on undo/redo apply, remap selection by id (or clear it) via `setPendingSvgSelection`.

**9. Redo can resurrect an old page snapshot and delete your newest work** — sequence: undo a callout/marker/space/highlight action, draw a new shape, press Redo → the app restores the pre-shape snapshot and the new shape vanishes silently.
> New shape edits under CRDT skip the legacy checkpoint (`PDFViewer.jsx:24081-24098`) and only clear the *local* redo lane (`:23655`), never `redoHistoryRef`; `handleRedo` falls through to the stale legacy entry (`:11882`) and `restoreHistoryState` wholesale-replaces `annotationsByPage` (`:10505-10519`). **Fix:** invalidate/clear the legacy redo stack (or stamp it stale) whenever a new local-lane action is pushed.

**10. Undoing your own action can wipe a teammate's concurrent edits document-wide** — callout/marker/space/highlight/eraser undo restores a full-document snapshot; anything a teammate changed since that snapshot is overwritten locally and then synced back to everyone (their new annotations are actually deleted from the shared doc).
> `getHistorySnapshot`/`restoreHistoryState` (`PDFViewer.jsx:10449-10539`) are whole-document; legacy checkpoints fire unconditionally during live collab (call sites `:12605-27401`, no CRDT gate unlike `:24081`); the capture effect (`useAnnotationDoc.js:494-519`) writes the restored state into the shared Y.Doc, and absent ids get scheduled for deletion. **Fix:** convert legacy-lane actions to scoped/per-object restores (the callout scoping pattern already exists), or gate legacy snapshots off when CRDT is active, matching the generic save path.

**11. Undoing your own edit reverts a teammate's concurrent edit to the same annotation** — you move a shape; a teammate recolors it; you press undo → their recolor is lost for everyone.
> Local-lane undo replays **full object snapshots** (`annotationLocalHistory.js:542-547, 563-591`) with no field merge and no staleness check; whole-value `map.set` to the shared Y.Map (`annotationDocStore.js:1171-1172`). **Fix:** either field-level diffs in history entries, or a "changed since capture" guard that skips/merges instead of clobbering.

**12. Excel auto-sync permanently jams undo** — once the undo stack unwinds down to an Excel-sync checkpoint, undo silently no-ops forever, stranding all older callout/space/marker actions beneath it.
> `addHistoryCheckpoint('excel:auto-sync')` (`PDFViewer.jsx:16969`) pushes a legacy snapshot, but `isLegacyAnnotationHistoryMeta` (`historyHelpers.js:117-126`) doesn't whitelist that reason — it's the only reason string not covered — so `handleUndo` peeks it, never pops it (`:11615, 11712`), and falls through. Already flagged in `docs/ANNOTATION-CONTRACT.md` item #9; `survey-marker:`/`space:` were fixed, `excel:` wasn't. **Fix (one-liner):** either add the prefix to the whitelist, or stop checkpointing on auto-sync.

**13. First edit-and-undo after opening a PDF with existing markups permanently deletes those imported markups** — draw one shape on an imported page, Ctrl+Z → your shape AND all imported native annotations vanish; the one-time import never re-runs, so the loss is permanent in the app.
> The one-shot import saves with `checkpointPolicy:'skip'` (`PDFViewer.jsx:24738-24742`), planting a dangling pre-import "preview baseline" (`:23815-23824`) that the user's next normal save consumes as its undo "previous" state (`:23825`); durable marker `embedded_import_completed_at` prevents re-import (`:24754-24763`). The counter-series-delete path already manually clears its dangling baseline (`:25558-25567`) — the import path doesn't. **Fix (small):** delete the preview baseline for each imported page right after the import save, mirroring the counter path.

**14. Counter renumbering across pages never saves or syncs** — deleting pin #2 of a multi-page series renumbers other pages only in local memory; reload or any teammate edit snaps them back to stale/duplicate numbers, and collaborators never see the renumber.
> `renumberCounters` mutates objects in place without replacing page buckets (`counterNumbering.js:53-61`); unchanged bucket references are skipped by the sync diff (`annotationDocStore.js:1079, 1096`) and by React's memo, so other pages neither persist nor re-render. **Fix:** have the renumber pass return fresh bucket references (and object clones) for every page whose counters changed, so the existing diff picks them up.

**15. Callout text editing clobbers a teammate's concurrent move/restyle of the same callout** — while you type, a teammate drags the leader line or changes color; when you finish, the callout snaps back to your pre-edit geometry/style, silently.
> Edit-mode entry snapshots the non-text children once (`PDFViewer.jsx:11207-11262`), never refreshed; commit rebuilds and **fully replaces** the callout from that snapshot (`:31853-31934`), unlike the drag paths which merge fields (`:11143-11168`). **Fix:** at commit, merge only the text (+ text-box bounds) onto the *current* callout entry instead of replacing the whole object.

**16. Reopened documents hide all survey markers until a module is manually selected** — the data loads fine, but zero marker rectangles render; it looks like the work is lost.
> Document open resets `selectedModuleId` to null (`PDFViewer.jsx:20333-20336`); the only effect populating the paint slice early-returns when it's null (`:28090-28094`) and filters to one module anyway; painting reads exclusively from that second slice (`SVGAnnotationLayer.jsx:2303-2310`). `docs/ANNOTATION-CONTRACT.md` item #7 already flags the dual-slice design as accidental. **Fix:** derive the per-page paint list via useMemo directly from `surveyMarkers` (all modules, or all when none selected), eliminating the second writable slice — the contract doc's own recommendation.

**17. Page operations can silently revert other edits made while a previous page op was still uploading** — rename/mirror a page (or make other edits) while a prior duplicate/delete/rotate is persisting over the network, and the state commit rolls your edit back with no warning.
> `executeMutation` freezes the page-state snapshot synchronously (`usePageOperations.js:44-46`), awaits a real Supabase Storage upload, then `commitPageStructureState` unconditionally overwrites `pageNames`/`pageTransformations`/`bookmarks`/`spaces` from the stale snapshot (`PDFViewer.jsx:12168-12206`); rename/mirror/reset bypass the queue entirely (`usePageOperations.js:100-178`). **Fix:** merge the transform result against live state at commit time (or route rename/mirror/reset through the same mutation queue).

**18. Cut/copy page clipboard goes stale — paste can move/duplicate the wrong page** — cut page 5, delete/insert/move any other page, paste → the wrong physical page is pasted (or a generic error if out of range), silently.
> `clipboardPage` is a raw page number (`PDFViewer.jsx:9871`, `usePageOperations.js:108-140`) that no page-structure operation remaps or clears — unlike every other page-keyed store, which goes through `transformPageState` remapping. **Fix:** remap or clear the clipboard in `commitPageStructureState` like the other page-keyed state.

**19. Two people doing page operations on the same document silently overwrite each other** — last writer wins on the whole PDF file; the other person's page changes vanish, and open tabs keep working from stale bytes and clobber further.
> Every page op re-serializes the whole PDF and `upload(..., {upsert:true})` with no version/ETag check (`useDatabase.js:784-798`, `AppShell.jsx:1041-1074`); no realtime channel refreshes page structure in open sessions (unlike annotations); the existing document-lock service isn't wired to page ops. **Fix (minimum):** version-check before upload + surface a conflict; better: gate page ops behind the existing lock service and broadcast a "document changed, reload" signal.

**20. Cmd/Ctrl+Shift+D doesn't duplicate — it toggles a hidden debug flag and downloads two files** — a user trying the standard duplicate shortcut gets two unsolicited file downloads (a JSON dump and an SVG snapshot of the page) in production.
> Debug-logging toggle at `PDFViewer.jsx:1206-1217`; a second unconditional listener in `shapeBleedDiagnostics.js:288-293` calls `captureAllShapes()` → two `downloadText()` calls (`:129-172`), imported ungated in production (`main.jsx:351`; only the mousedown sibling checks `spyOn`). No annotation-duplicate feature exists anywhere. **Fix:** gate both debug listeners behind DEV/`spyOn`; separately consider building actual selection-duplicate.

### MEDIUM

**21. Switching tools mid-stroke silently throws away the in-progress ink/shape** — pressing V/E/etc. while drawing wipes the visible stroke with no commit and no undo entry. (`SVGAnnotationLayer.jsx:1177-1185` clears without the `commitShapeCreationRef` flush that the zoom-start and unmount paths both do at `:1376-1382`, `:1404-1409`. Fix: flush before clearing.)

**22. Eraser skips the cross-author delete confirmation the Select+Delete path shows** — a document owner erasing a collaborator's marks gets no modal and no undo toast (only Cmd+Z). (`requestAtomicEraseApproval` filters to callout targets only, `PDFViewer.jsx:18633-18638`; `buildBulkDeletePlan` is type-agnostic and could be reused. Fix: run the same plan over page-object/text-markup targets; at minimum fire the existing post-commit undo toast.)

**23. Non-owner collaborators can never erase/edit annotations that came baked into the PDF** — imported markups have no author stamp, so the permission check silently blocks everyone but the owner; no documented decision behind it. (`pdfAnnotationImporter.js` never stamps `meta.authorId`; `permissionScope.js:100-106` fails closed. Fix: decide the policy — treat as owner-owned or contributor-editable — and stamp accordingly at import.)

**24. Survey Marker move/resize fails OPEN where delete fails closed** — with unresolved document-owner metadata, anyone can move/resize/rotate anyone's marker, while delete correctly denies. (Outer `viewerId && documentOwnerId &&` guard at `PDFViewer.jsx:26550-26554` skips the check entirely; `canModifySurveyMarker` alone would deny correctly. Fix: drop the outer guard.)

**25. Legacy (canvas-mode/old-data) arrows ignore rotation/scale but the selection frame pretends they work** — edits appear applied then snap back; the committed angle/scale is inert dead data. (`renderArrow` never reads angle/scaleX/scaleY, `svgAnnotationRenderers.jsx:693-756`; still creatable via ungated Ctrl+Shift+V, `PDFViewer.jsx:2800-2814`. Fix: apply group transform in `renderArrow`, or migrate legacy group arrows to the modern line format on load.)

**26. Double-click edit mode is a silent no-op on legacy group arrows** — falls into the explicit unknown-type else branch (`PDFViewer.jsx:31282-31293` only maps line/polygon/polyline/counter). (Fix: map `group`+line-child to bbox edit, or migrate as in #25.)

**27. Legacy 'circle'-typed ellipses can't be restyled from the toolbar** — swatches don't sync and every color/width/border control silently no-ops on them. (Three `PDFViewer.jsx` gates check `'ellipse'` but not `'circle'` — `:3831-3841, 7423-7434` — while every other dispatch site treats them as one class. Fix: add `'circle'` to the three gates.)

**28. Clearing all text in an existing text annotation leaves an invisible ghost annotation** — persists, syncs, and survives reload as a click-target-only empty box. (`buildExistingTextCommitJSON` never checks blank text, `textEditCommit.js:183-221`, unlike the new-text path at `:136`. Fix: blank text on an existing annotation → delete it.)

**29. Shift+marquee replaces the callout selection instead of adding to it** (and Alt-subtract is a no-op for callouts). (`useSVGInteraction.js:2814-2821` passes a fresh Set to the raw setter while the annotation branch unions; the code comment even points at the missing merge. Fix: merge in the callback.)

**30. Remote-delete "Removed by X — Restore?" safety toast is fully dead code** — the shape just vanishes from under your selection/drag with no recovery offer. (`window.__phase29InteractionState` is never populated by the current SVG selection system; `YDocProvider.jsx:689-781` reads an always-empty object. Fix: publish selection/drag/edit ids from `useSVGInteraction`, or delete the feature.)

**31. AutoCAD SHX Text imports are marked transform-locked but still show working resize/rotate handles** — and the resulting geometry change persists. (Importer sets lock flags, `pdfAnnotationImporter.js:852-860`; the handle-suppression set only lists Underline/StrikeOut/Squiggly, `SVGAnnotationLayer.jsx:106`; `isTransformLockedAnnotation` never checked in the handle-drag initiator. Fix: honor the lock flags in handle rendering + `handleHandlePointerDown`.)

**32. Holding an arrow key in the rotation field creates one undo entry per keypress** — 20–30 Ctrl+Z presses to undo one rotation. (`RotationInputField.jsx:354-364, 453-479` commits per keydown with no `interactionId`; the coalescing mechanism requires `source:'object:modified'`+interactionId, `PDFViewer.jsx:23826-23831`. Fix: give keyboard nudges a shared interactionId / debounce the checkpoint.)

**33. Open context menu can apply z-order actions to the wrong shape after a teammate's concurrent insert/delete** — same stale-index family as #6/#7, in the menu path. (`useAnnotationContextMenu.jsx:76-87` freezes the index; `handleReorderAnnotation` only bounds-checks, `PDFViewer.jsx:25875-25879`. Fix: capture the id, re-resolve or close the menu on mismatch.)

**34. Cmd+C/Cmd+X only work with exactly one shape selected; callouts have no keyboard clipboard at all** — right-click supports both; the shortcut overlay lists no clipboard shortcuts. (`SVGAnnotationLayer.jsx:922-923` guard; group + callout clipboard logic already exists in the context menu. Fix: extend the keyboard handler to group/callout selections; update the overlay.)

**35. Callout repeat-paste offset hardcodes US-Letter page size; shape repeat-paste ignores page size entirely** — on large architectural sheets, repeated pastes stack nearly invisibly or drift inconsistently. (`PDFViewer.jsx:4004-4008` divides by 612/792; shapes add raw 16 units at `:25667-25779`. Fix: normalize both offsets by the actual page dimensions, already computed nearby.)

**36. Owner-scoping silently drops undo history for a contributor's edits to unstamped imported annotations** (low confidence) — the edit applies but can't be Ctrl+Z'd, with no feedback. (`isOwnAnnotation` strict match, `annotationLocalHistory.js:30-33`; silent no-op at `PDFViewer.jsx:23627-23641`. Fix depends on the #23 policy decision.)

**37. Font color opacity slider is dead on desktop** — dragging it changes nothing; mobile already hides it. (`AppShell.jsx:1814-1823` drops the alpha argument; `setFontColor` has no alpha concept. Fix: `showOpacity={false}` like mobile, or implement alpha.)

**38. "Match Fill" swatch never shows selected when the fill is translucent** — the match works, the indicator lies. (Hardcoded `localOpacity >= 99` in the selected check, `CompactColorPicker.jsx:378-382`. Fix: compare against the actual matched opacity.)

**39. Hex field accepts garbage like "zzzzzz" and persists it as the shape's real color** — invalid CSS color survives reload. (`CompactColorPicker.jsx:578-587` no validation; `composeColorForPatch` passes invalid strings through; the font-color path already validates. Fix: apply the same `/^#[0-9a-fA-F]{6}$/` gate.)

**40. Cmd/Ctrl+0/1/2 silently degrade the fit mode to "Manual"** — label reads Manual and the page stops re-fitting on window resize, unlike the identical dropdown actions; self-heals on reload. (Keyboard path routes through the legacy `zoomController.setMode` with empty context; injected `setScale` defaults mode to MANUAL, `PDFViewer.jsx:22569-22572, 21956-21969`. Fix: route the shortcuts to `handleZoomModeSelect` like the dropdown.)

**41. Keyboard fit shortcuts compute a different zoom percentage than the dropdown's fit** — no padding/gap reservation, so results disagree and can crowd the viewport edge. (Plain ratio in `zoomController.js:78-104` vs. pdf.js-native fit with padX/gap, `PdfjsViewerContainer.jsx:137-139, 1883-1899`. Fixed automatically by the #40 rerouting.)

**42. Sidebar thumbnails are never cached** — every rail collapse/expand or tab switch re-renders every thumbnail from scratch, against the app's own "basically instant" requirement; the IndexedDB cache built for this is only wired to the Home screen. (`PagesPanel.jsx:54, 266-277`; `thumbnailStore.js` unused here. Fix: wire PagesPanel to the existing store, keyed by doc+page+mutation revision.)

**43. Drag-reordering pages inside a filtered Space silently moves hidden pages too** — a move between visible cards physically shifts unshown pages with no warning. (`handleDrop` uses absolute page numbers with no space gating, `PagesPanel.jsx:743-759, 825`. Fix: disable reorder in space mode, or translate to filtered-relative moves.)

**44. New bookmarks jump to the top of an already-ordered list** — any bookmark added after an outline import or a drag lands at/near position 0. (Three creation paths omit `order` — `BookmarksPanel.jsx:1120-1126, 1219-1225, 1378-1384`; sort treats missing as 0 at `:517`; the max+1 pattern already exists in the import path. Fix: stamp max+1 in the three call sites.)

**45. Deleting a bookmark group permanently deletes all nested bookmarks — no count in the confirm, no undo** — bookmarks are absent from both the undo snapshot and the 30-day trash system. (`BookmarksPanel.jsx:378-402`; `PDFViewer.jsx:12580-12600`; snapshot shape at `:10449-10464`. Fix: add descendant count to the confirm and/or plumb bookmarks into undo or trash.)

**46. Bookmarks (and page names/spaces metadata) live only in per-browser localStorage; two browser windows on the same doc silently clobber each other** — no sync, no storage-event rehydration, last writer wins on the whole blob. (`PDFViewer.jsx:9894-9925`. Fix: move sidebar metadata into the Y.Doc meta like spaces, or at minimum merge-on-write + storage listener.)

**47. Bookmark drag-reorder is O(n²)** — every drag rewrites every bookmark via per-item find+map; large imported outlines will lag. (`persistBookmarkTree` per-item `onBookmarkUpdate`, `BookmarksPanel.jsx:742-750`; `handleBookmarkUpdate` full-array map each call. Fix: single batched update.)

**48. A rejected duplicate-name bookmark rename keeps showing the unsaved name** — looks saved when it isn't; the page-number field already reverts correctly. (`BookmarksPanel.jsx:97-99, 121-128`. Fix: reset `editName` on rejection like `editPage`.)

**49. Search results go stale after page reorder/rotate** — matches/highlights point at pre-mutation content on post-mutation page numbers, silently. (Cache keyed on `${fileId}:${pdfId}:${numPages}` which is unchanged by reorder/rotate — `PDFViewer.jsx:7301-7304`, `SearchTextPanel.jsx:740-769, 1291-1344`. Fix: include a page-mutation revision counter in the key.)

**50. Concurrent Spaces edits are whole-array last-writer-wins** — User A renames Space 1, User B adds a page to Space 2; one edit fully vanishes. (Single opaque `spaces` value under one Y.Map key, `annotationDocStore.js:585-591`; the 2026-06-06 audit's per-space Y.Map recommendation was never implemented; markers already use the keyed pattern. Fix: keyed Y.Map<spaceId, space>.)

**51. Activating an empty Space blanks the entire canvas with zero explanation** — looks like the document failed to load. (`shouldShowPage` false for all pages, `PDFViewer.jsx:28287-28297`; nav effect no-ops, `:28617-28627`; export already has the warning pattern. Fix: on-canvas "no pages assigned" empty state, or block activation.)

**52. Deleting a region while a teammate is drawing inside it permanently orphans their annotation** — persists in storage, forever invisible and unreachable by anyone. (No cascade on remote space updates — `cascadeDeleteScopedAppState` only fires from local actions; visibility rule can never re-resolve a deleted regionId, `annotationVisibilityRules.js:279-308`. Fix: run cascade/GC on remote region removal, or unscope orphaned annotations.)

**53. The sync pill shows red "Offline · N saved locally" during every normal healthy save** — the orange "Saving…" state is unreachable, so users see a false offline warning on every edit. (Branch-order bug: pendingCount checked before `stage==='pending'`, `syncStatusViewModel.js:41-59`; the producer never emits pending with queue 0, `annotationDocSync.js:1563-1581`; the regression test passes on an impossible input. Fix: check healthy+pending before the offline branch; fix the test to use realistic inputs.)

### LOW

**54. Black-thumbnail-detection guard is dead code** — fully implemented, never called; a corrupted solid-black render is accepted permanently. (`PagesPanel.jsx:130-193`, zero call sites since inception. Fix: call it in `applyThumbnailResult` and retry, or delete it.)

**55. The legacy dual-write to `document_annotations` is dead code with live comments claiming otherwise** — any external/legacy reader of that table sees a frozen document. (`dualWriteFabricCommit`/`dualWriteFabricDelete` have no callers, `annotationCloudSync.js:618, 717`; comments at `:596-599` assert live behavior. Fix: delete the dead path + correct the comments/docs, or rewire if legacy readers still matter.)

---

## 4. Feature Areas — Clean Status

**No audited area came back fully clean** — every one of the 20 feature areas produced at least one verified finding. The closest to clean (only minor/cosmetic or dead-code issues, core behavior sound):

- **Save / autosave / persistence** — the actual save pipeline is correct and well-tested; findings are a mislabeled status pill (#53) and a dead legacy write path (#55).
- **Page navigation / thumbnails (rendering correctness)** — pages render and navigate correctly; findings are performance/caching and a dead resilience guard.
- **Text search (matching logic)** — search itself works; the one finding is cache staleness after page-structure edits.

Also note: five audited claims were **refuted** during verification and are excluded (counter undo renumbering, survey-marker realtime sync being dead, and three others) — those behaviors are working as intended.

---

## 5. Recommended Fix Order

1. **Export/print correctness cluster** (findings #1–#4, mostly one file — `pdfAnnotationsPdfLib.js`): line/arrow position (critical), arrowheads, cloud borders, print scale. These silently damage every deliverable PDF and share test infrastructure; fix together with new fixtures that use real drawn-object shapes.
2. **The two known bugs**: eraser policy Part 1 (ink-only partial — small, fixes the default-tool complaint), then z-order persistence (fractional key), then eraser Part 2 (topmost-only entire mode).
3. **Cheap undo one-liners with outsized impact**: excel:auto-sync whitelist (#12), import preview-baseline cleanup (#13), legacy-redo invalidation (#9).
4. **The stale-index family** (#6, #7, #8, #33): one design change — address annotations by stable id at every commit/selection site — closes four bugs including a crash and two corruption paths.
5. **Survey markers on reopen** (#16) — highly visible, and the contract doc already prescribes the fix.
6. **Collaboration clobbers** (#10, #11, #15, #14, #50, #52): per-object/field-scoped restores and merges. These need the project's mandated ≥2 adversarial-verify passes for realtime code.
7. **Page operations** (#17, #18, #19): clipboard remap and merge-at-commit first (local correctness), then storage conflict detection.
8. **Quick-win batch** (#20 debug shortcut gate, #53 sync pill, #39 hex validation, #24 fail-open guard, #40/#41 zoom shortcut rerouting, #27 circle gates, #28 ghost text, #38 match-fill ring, #48 rename revert, #44 bookmark order) — each is a small, low-risk diff.
9. **Everything else** (UX/perf/polish: #21–#23, #25–#26, #29–#32, #34–#37, #42–#43, #45–#47, #49, #51, #54–#55) as capacity allows, with #45 (bookmark cascade delete) and #49 (stale search) prioritized within this tier.

Per project rules: run `npm test` + build after touching `PDFViewer.jsx`/`PageAnnotationLayer.jsx`/`FabricEraserCanvas.jsx`; never alter the `zoomGeneration` contract, container-aware canvas sizing, or SVG viewBox zoom ownership; update the PDFViewer source-assertion tests and load-sensitive perf tests where fixes change asserted behavior.

---

# Full-App Logic Audit — Pass 2 Addendum

**Scope of this pass:** export/print, realtime collaboration, offline retry queue, collaboration UX, Excel two-way sync, Excel row identity, OneDrive browsing/saving, sharing & invites, roles & permissions, sign-in (email/Google/Microsoft), billing, account deletion, keyboard shortcuts, mobile viewer, desktop app.

Findings already reported in Pass 1 are excluded. Nothing below duplicates a Pass 1 item.

---

## 1. Executive Summary (plain English)

Pass 2 looked at everything *around* the drawing tools: sharing, teams, sign-in, Excel, saving to the cloud, billing, and the mobile and desktop versions. The core drawing and syncing engine held up well — the serious problems this time are in the "business" layer: who can do what, what happens when something half-fails, and features that look finished but are secretly disconnected.

The headlines:

- **The free-plan paywall on sharing can be walked around.** The app hides the invite buttons from free users, but the server never checks the plan — anyone slightly technical can send real invite emails on a free account. Similarly, the 7-day free trial can be repeated forever by canceling and re-subscribing.
- **A safety net that's supposed to catch failed saves is never actually used.** The app has a fully built system for quietly retrying saves that half-fail (and warning you if they stay stuck) — but the part of the app that does the actual saving never feeds it. So a half-failed save today just… disappears, with no retry and no warning.
- **Several "success" messages lie.** "Sync to Excel successful!" can appear when nothing was written to Excel at all. Removing a teammate can show "Removed" and even email them "you were removed" when nothing actually changed. "Invite revoked" can leave the person with full access.
- **Team permissions have real holes.** Anyone on a project — even a view-only member — can open the team-management screen. Someone you promote to Owner can never actually reach the owner tools. And two owners removing each other at the same moment can leave a document with no owner at all.
- **Saving to OneDrive can silently overwrite someone else's existing file** with the same name — no "a file with this name already exists" warning like every other app has.
- **Deleting your account would silently destroy your teammates' work** on every document you own — annotations, history, files — with no warning and no way to hand ownership to someone else first. (The delete button is currently disabled in the app, but the deletion machinery is live and reachable, so this matters now, not later.)
- **Microsoft sign-in is completely broken on the phone apps** — tapping it dumps you onto the public website with no way back. And using Microsoft on desktop and web at the same time makes each device keep signing the other out.
- **Clicking "Connect Google" in settings can silently switch you into a different account** instead of linking Google to your current one.
- **Quitting the desktop app always takes about 5 seconds** — and worse, if a save genuinely needs *more* than 5 seconds, the app quits anyway and abandons it. The wiring that was supposed to make quit wait for the save is dead.
- Smaller items: billing emails send customers to **google.com** after they fix their card; several keyboard shortcuts listed in the in-app cheat sheet **do nothing**; presence ("2 viewing") **drops people who sit on one page for 2 minutes**; various mobile sheet animations can glitch or self-close.

Nothing here corrupts the drawing data itself — but several of these directly undermine trust ("it said it worked and it didn't"), revenue (paywall and trial bypass), and safety of *other people's* work (OneDrive overwrite, account-deletion cascade).

---

## 2. Findings, ranked most-severe first

### CRITICAL

---

**P2-01. Free-tier sharing paywall is client-side only — free users can mint and email real invites** *(Sharing/invites — abuse)*
**Impact:** The "Pro-only sharing" business rule is just disabled buttons. Any free user with browser devtools can create invite rows and trigger real invitation emails from the product's domain. The trial is the paywall; this defeats it.

> **Technical:** UI gate only: `src/home/ShareModal.jsx:47,69,133-137`. RLS INSERT policies check ownership, never tier: `supabase/migrations/20260521000100_kal31_invite_tokens.sql:46-52`, `supabase/migrations/20260701120000_project_template_sharing.sql:52-58,180-186`. The new-recipient branch of `send-invite-email` calls `auth.admin.inviteUserByEmail` with the service-role client and never routes through the KAL-439 `claim_email_send` tier gate (`supabase/functions/send-invite-email/index.ts:105-128`; gate only fires on the existing-account branch, `handler.js:227-246`). Code admits it: `handler.js:20-21` "Tier gating remains UI-level."
> **Fix sketch:** Add a tier check inside the invite RLS policies (or a BEFORE INSERT trigger consulting `user_subscriptions`), and make send-invite-email's Branch A call `claim_email_send` (or an equivalent tier check) before `inviteUserByEmail`.

---

**P2-02. The offline/conflict retry queue is never fed — its only producers have zero call sites** *(Offline queue — intended flow)*
**Impact:** The documented behavior — "if one of the two backend writes fails, it queues and retries silently, with a 30-second stuck banner and quarantine after 10 attempts" — never happens. A half-failed save today is invisible: no retry, no banner, no quarantine. The entire subsystem (drain loop, banners, quarantine UI) is built and mounted but starves.

> **Technical:** `enqueue()` (`src/lib/collab/crdtDualWriteQueue.js:114`) is reachable only via `dualWriteFabricCommit`/`dualWriteFabricDelete` (`src/services/annotationCloudSync.js:618-781`), which have zero real call sites — only a placeholder test (`src/services/__tests__/annotationCloudSync.dualWrite.test.mjs:46-59`, `assert.ok(true, 'contract scaffold — Plan 30-04 flips this to active')`). `src/PDFViewer.jsx` never imports annotationCloudSync at all; real saves go through `useAnnotationDoc` → `annotationDocSync.js` / `annotationDocOutbox.js`, a separate system that never touches this queue. `YDocProvider.jsx` uses `upsertFabricAnnotation` only inside the drain retry handlers (lines 1072, 1669).
> **Fix sketch:** Either wire the live save/delete path (annotationDocSync outbox failures and YDocProvider's Supabase writes) into `enqueueDualWrite`, or consciously retire crdtDualWriteQueue and port its stuck-banner/quarantine UX onto the outbox that actually runs. Decide once — don't leave two half-systems.

---

### HIGH

---

**P2-03. Deleting an account destroys collaborators' work on every owned document — no warning, no ownership transfer — and the backend is callable today** *(Account deletion — multiuser)*
**Impact:** If a document owner deletes their account, every teammate's annotations, edit history, and the PDF files themselves are permanently wiped on every shared document that person owned. Nothing warns about this, and there is no way to hand a document to someone else first. The in-app delete button is disabled (see P2-15), but the deletion endpoint is live and reachable by direct API call, so this is exposed now.

> **Technical:** `delete_account_owned_rows` (`supabase/migrations/20260811120000_account_deletion_user_references.sql:49-63`) deletes documents/projects/templates by `user_id` regardless of active collaborators; `document_annotations`, `document_collaborators`, `document_presence`, and the Yjs tables all `ON DELETE CASCADE` (`20241230000002:10,70,97`; `20260428000000:17,35,50`). `removeOwnedStorage` (`supabase/functions/delete-account/index.ts:39-47`) then deletes the PDFs. No ownership-transfer mechanism exists anywhere (grep confirmed). Copy at `AccountSettings.jsx:665-668` never mentions collaborators.
> **Fix sketch:** Before deletion, detect owned documents with other active collaborators; block with a clear message, offer ownership transfer (new mechanism: reassign `documents.user_id` or promote a collaborator), or at minimum require explicit acknowledgment listing affected documents/people.

---

**P2-04. Saving to OneDrive/SharePoint silently overwrites unrelated existing files — the only guard fails open** *(OneDrive — abuse/data loss)*
**Impact:** Type a filename that matches a coworker's real spreadsheet on a shared drive and it gets replaced with zero warning. The only pre-save check is "is this one of *our* exports with a different template id," and any read error (not our file, protected file, network blip) silently skips even that. For an enterprise/SharePoint-first product, this is a data-loss trap on shared drives (version history is the only recovery).

> **Technical:** `handleOneDriveSave` (`src/PDFViewer.jsx:14555-14607`): only warning path is `if (existingMeta?.templateId && existingMeta.templateId !== currentTemplateId)` (:14585). `getTemplateIdFromExcel` (`src/services/excelGraphService.js:495-529`) swallows all errors → null (:524-528). Outer catch (:14603-14606) "proceed with export anyway." Upload uses `@microsoft.graph.conflictBehavior=replace` (:51, :569). The save modal has no existing-file listing or collision UI at all.
> **Fix sketch:** Use the already-existing `checkFileExists` result to drive a generic "A file named X already exists here — overwrite?" confirm for *any* collision, independent of template metadata; treat metadata-read failure as "unknown file → warn," never as "safe to replace."

---

**P2-05. "Revoke" on a pending invite doesn't remove access already granted — owner sees "Invite revoked," invitee keeps full access** *(Sharing/invites — multiuser)*
**Impact:** For existing-account invitees, access is granted immediately; if the notification email then hiccups, the invite stays "Pending" while the person already has real access. Clicking Revoke on that row only cancels the pending invite record — the access remains — and the owner is told it worked. Reachable via an ordinary transient email failure.

> **Technical:** `createDocumentInvite` upserts `document_collaborators` (active) before the email (`src/services/documentInviteService.js:157-195`); on email failure it returns before `markExistingUserInviteAccepted` (:219-259), leaving `accepted_at IS NULL`. `kal31_revoke_document_invite` (`supabase/migrations/20260521000100_kal31_invite_tokens.sql:215-234`) only sets `revoked_at` on `document_invites`; it never touches `document_collaborators`. UI shows both a Pending row and an active-member row for the same person (`AccessManagementModal.jsx:225-227,259-307`).
> **Fix sketch:** In the revoke RPC, also delete/deactivate the matching `document_collaborators` row when one exists for the invite's email/user; or reconcile in the modal (cross-reference members vs invites and collapse to one row with one truthful action).

---

**P2-06. Project "Manage Team" has no owner gate — any member (even view-only) can trigger false "you were removed"/"role changed" emails and see fake success** *(Roles/permissions — abuse)*
**Impact:** A viewer can open Manage Team, "remove" a teammate or "change" their role, see a success message, and cause a real email to the target claiming they were removed or demoted — while the database silently discarded the write. Violates the locked "viewers are look-only" model and generates alarming spurious security emails between real users.

> **Technical:** Every `setTeamModalProject(...)` call in `src/home/ProjectsFolderTree.jsx` (803, 1049, 1285, 1547, 1771, 1922) is unconditional; `ManageTeamModal.jsx` has no viewer-role check. RLS UPDATE/DELETE policies use `USING(owner)` with no WITH CHECK (`supabase/migrations/20241230000003_add_collaborator_helpers.sql:172-177`) → non-owner writes affect 0 rows *without error*. `projectInviteService.js:312-343` returns `{success:true}` whenever `error` is null (never checks affected rows). `ManageTeamModal.jsx:467-510` then shows success and unconditionally fires `sendPermissionChangedEmail`/`sendAccessRemovedEmail`.
> **Fix sketch:** Gate the modal (and its edit affordances) on the current user's project role; make the service calls `.select()` and treat 0 affected rows as failure; only send notification emails after a confirmed write.

---

**P2-07. Promoting someone to Owner never gives them the owner tools — only the original creator can ever open Manage Access** *(Roles/permissions — intended)*
**Impact:** The database genuinely treats a promoted collaborator as a full owner, but the app decides who sees the Manage Access screen by comparing against the immutable original creator. Every non-creator owner is permanently stuck with the plain share dialog — no role management, no remove, no revoke. Structural and permanent (there's no ownership transfer either).

> **Technical:** `src/home/SurveyHub.jsx:97-105` computes `manage: single.user_id === user.id`; `:241-247` mounts AccessManagementModal only on that flag — the sole entry point app-wide. `user_can_access_document` (`supabase/migrations/20260522010000:27-61`) treats collaborator role='owner' as full owner. `AccessManagementModal.jsx:137-166` happily promotes people to a role the client will never honor.
> **Fix sketch:** Derive `manage` from the user's actual role on the document (creator OR document_collaborators role='owner') — one query or a field already present in the document list payload.

---

**P2-08. "Connect Google" in settings is a plain sign-in, not linking — it can silently switch you into a different account** *(Auth — intended)*
**Impact:** Clicking Connect launches a normal Google sign-in. If the chosen Google email belongs to a different Survey account, the session is silently replaced with *that* account — you're switched out of the account you were working in with no warning. If it's a new email, a brand-new second account is created, splitting your data. The button never does what its label says.

> **Technical:** `AccountSettings.jsx:1121-1140` calls `signInWithGoogle()` — the same `supabase.auth.signInWithOAuth` login flow as AuthModal (`AuthContext.jsx:569-623`). `auth.linkIdentity()` is never called anywhere in src (grep: zero hits; only `unlinkIdentity` exists for Disconnect, `accountPlatform.js:91`). `onAuthStateChange` (`AuthContext.jsx:457-479`) adopts any new session unconditionally — no same-user check.
> **Fix sketch:** Use `supabase.auth.linkIdentity({provider:'google'})` for the Connect path; as a belt-and-braces, have the auth listener detect a user-id change following a "connect" intent and refuse/rollback with an explanation.

---

**P2-09. Manual "Sync to Excel" reports success and marks everything synced even when every cell write failed** *(Excel sync — abuse)*
**Impact:** With Live Sync connected but the underlying session dead (expired token, network blip), clicking Sync to Excel fails every cell update, yet the user sees "Sync to Excel successful!", the pending-changes indicator clears, and a durable "synced" baseline is recorded — the app now permanently believes Excel is up to date when the workbook was never touched.

> **Technical:** Per-sheet `updateCellRange` failures are swallowed with `console.warn` and no flag (`src/PDFViewer.jsx:13791-13829`); control falls through to persist the template, call `markExcelExportSynced` (stamps `exportedAt`, writes baseline to localStorage) at :13901, and toast success at :13912. The outer catch (:13914) never sees the errors.
> **Fix sketch:** Track per-sheet failures; if any occurred, skip `markExcelExportSynced`/baseline, show a failure toast naming the sheets, and leave pending-changes set. Consider a session-health check (or re-create session) before the loop.

---

**P2-10. Two collaborators on a SharePoint-tier document can mint duplicate Survey Markers for the same Excel row — server 'create' has no fingerprint dedup** *(Excel row identity — multiuser)*
**Impact:** When two editors both sync/import around the same moment, both clients can decide "this row is new" and the server mints two markers for one physical Excel row — silently, no review flag. The safety gate that catches this for personal docs is explicitly bypassed for SharePoint/business docs — exactly the target customer tier. Result: duplicated checklist items nobody explains.

> **Technical:** `kal308_apply_changeset` 'create' branch is just `gen_random_uuid()` (`supabase/migrations/20260625120000_kal309_excel_sync.sql:616-621`) — no lookup by `identity_vector_fingerprint` (stored at :688-689 but never compared), no unique index on it; the ON CONFLICT key (:696) is the fresh marker id. The conservative gate (:468-502) requires `NOT v_business_ok`. The head-row lock (:444-447) serializes commits but not the client-side matcher decisions.
> **Fix sketch:** In the create branch, look up existing `excel_sync_state` rows for (document, template, scope) with the same non-empty identity fingerprint; on match, convert to 'apply'-against-existing or route to review. Optionally add a partial unique index on (document_id, template_id, scope_id, identity_vector_fingerprint) where fingerprint <> ''.

---

**P2-11. Desktop quit is a fixed ~5-second hang — and abandons saves that genuinely need longer** *(Electron — intended)*
**Impact:** Every quit waits ~5.1 seconds per window even with nothing to save (feels like a hang), and if the cloud flush is still running past 5 seconds (slow network, big payload), the app quits anyway and the save is discarded. The signal built to make quit wait for actual save completion is received and ignored.

> **Technical:** `before-quit` (`src/electron-main.js:1729-1773`) advances only via `setTimeout(checkAndQuit, 5000)` (:1770). Renderer correctly awaits `handleSaveDocument(true)` (real Supabase flushes) then calls `notifySaveComplete()` (`src/PDFViewer.jsx:21033-21134`), but `ipcMain.on('app:saveComplete')` is an empty handler — comment: "actual quit happens via timeout" (:1776-1778).
> **Fix sketch:** Have `app:saveComplete` call `checkAndQuit()` per window; keep the timer as a generous fallback (and/or extend it while progress events arrive). Skip the wait entirely when the renderer reports nothing dirty.

---

**P2-12. "Access removed" lockout banner can be permanently lost, leaving a user in an unexplained frozen state** *(Collab UX — multiuser)*
**Impact:** If an owner revokes someone's access and, later in the same open tab, that person's sign-in also expires, the sticky "The owner removed your access" banner is replaced by "Your sign-in expired." After re-signing in, the banner clears entirely — but the read-only lock stays. The user sits in a dimmed, keystroke-suppressed document with zero explanation; it looks like the app broke.

> **Technical:** Single-slot `storageState` (`YDocProvider.jsx:233`): `permission_revoked` set at :499-500 is unconditionally overwritten by `login_expiry_failure` at :537-538; re-sign-in resets to 'ok' checking only the current code (:1727-1729). `accessRevoked` stays true and drives ReadOnlyGate, but nothing re-derives the banner from it.
> **Fix sketch:** Make `permission_revoked` win: either priority-order banner codes (never overwrite revoked), or re-derive the banner reactively from `accessRevoked` the way the viewer_access banner already is (:1633-1638).

---

**P2-13. Microsoft sign-in on iPhone/Android is a dead end — the app navigates away to the public website and never comes back** *(Microsoft auth — intended)*
**Impact:** Tapping "Connect Microsoft" in the mobile apps replaces the app's own screen with Microsoft's login, which then redirects to the live surveytool.app website *inside the app shell* — a page with no connection to the app. The flow can never complete on mobile; OneDrive/Excel features are unreachable there.

> **Technical:** No Capacitor branch: `login()` falls to `window.location.href = authUrl` (`MSGraphContext.jsx:852-853`). `microsoftRedirectUriFor` (`src/utils/microsoftOAuthRouting.js:10-19`) doesn't know Capacitor origins → falls back to production origin. No deep-link plumbing exists: no BROWSABLE intent-filter (AndroidManifest), no CFBundleURLTypes/entitlements (iOS), no `@capacitor/browser`/`appUrlOpen` anywhere. PKCE verifier lives in the app origin's sessionStorage, unreachable from the redirect target.
> **Fix sketch:** On native, use `@capacitor/browser` + a registered custom scheme or App/Universal Links redirect URI, resume `completeOAuthLogin` from an `appUrlOpen` listener; or hide the Connect button on mobile until that ships (one-line stopgap that ends the dead end).

---

**P2-14. Using the desktop app clobbers the web/mobile Microsoft connection — each side keeps forcing the other to reconnect** *(Microsoft auth — multiuser)*
**Impact:** Every desktop launch overwrites the shared "connected to Microsoft" record with a token-less marker, destroying the tokens the web/mobile session stored there. Next web reload: "reconnect Microsoft." Reconnect on web, relaunch desktop, broken again. Anyone using both surfaces is stuck in a reconnect loop. (Related medium: the reverse direction, P2-24.)

> **Technical:** `adoptMainAuthResult` (`MSGraphContext.jsx:154-185`) runs on every Electron startup restore (:417-418) and upserts `buildConnectionMarkerRow` (`microsoftConnectionMarker.js:29-46`) with `onConflict:'user_id,service_name'`, replacing the whole `metadata` JSONB (wiping web PKCE refresh_token stored by `storeTokens`, :188-226). The classifier helpers built to distinguish the two row shapes (`isMainCustodyRow`/`hasLegacyRendererTokens`) are referenced only in their own tests.
> **Fix sketch:** Either per-device rows (add a device/custody key to the conflict target), or merge instead of replace (preserve legacy token fields when writing the marker), and use the existing classifiers in the web restore path so a main-custody marker doesn't read as "disconnected."

---

**P2-15. Account deletion is fully built end-to-end but the button is permanently disabled — the feature is unreachable from the app** *(Account — intended)*
**Impact:** Users see a "Delete account" button that is always grayed out with "not self-serve yet — contact support," while a complete, working deletion backend sits behind it (billing cleanup, data wipe, file removal, account removal). Self-serve deletion matters for app-store and privacy-law compliance. Note: re-enabling must be paired with P2-03's collaborator safeguards — today the disabled button is accidentally the only thing preventing that cascade from the UI.

> **Technical:** `AccountSettings.jsx:656-664` hardcodes `disabled`, no onClick; the comment (:645-655) claiming "no server-side delete endpoint" is stale — `supabase/functions/delete-account/index.ts` is complete and wired via `AuthContext.deleteAccount` → `requestAccountDeletion` (`accountPlatform.js:99-107`); `handleDeleteAccount` (:365-377) is dead code. Git: button disabled in 973bd38a (Aug 11, 14:33), backend built 72 min later in 3380a64c; never reconciled. The parity test (:75) only regex-matches text, so it can't catch this.
> **Fix sketch:** Wire `onClick={handleDeleteAccount}` with a typed-confirmation dialog, remove `disabled`, fix the stale comment — after P2-03's warning/transfer flow lands.

---

### MEDIUM

---

**P2-16. Remote-delete "Restore?" recovery toast is permanently dead** *(Realtime collab)*
When a teammate deletes a shape you're actively selecting/dragging/editing, a built recovery toast ("Removed by [Name] — Restore?") is supposed to appear. It never fires for anyone: the signal it watches was published by a component deleted in the July dead-code passes and never replaced. Deletions under your cursor now read as silent data loss.
> `YDocProvider.jsx:733,745-751` reads `window.__phase29InteractionState`, which is never assigned anywhere (the old publisher lived in the deleted FabricEditCanvas; the e2e test injects it manually, `tests/phase29-e2e/remote-delete-toast.spec.mjs:70-87`). **Fix:** publish selection/drag/edit ids from the live interaction path (`useSVGInteraction`/SVGAnnotationLayer + TextEditOverlay) into that state object, or refactor the gate to consume the app's real selection state.

**P2-17. "N viewing" silently drops anyone idle on one page for 2 minutes** *(Realtime collab)*
Presence is only re-stamped on document open and page change; the freshness cutoff is 2 minutes. A collaborator reading one page for 3 minutes vanishes from everyone's avatars/count while still in the document.
> `updateDocumentPresence` call sites: `PDFViewer.jsx:17867,17892,19149` only; no heartbeat interval anywhere. Cutoffs: `presenceRoster.js:28`, `documentAnnotationService.js:579-597`. **Fix:** add a ~30–60s heartbeat interval while the document is open (pause when tab hidden), keeping the 2-min cutoff.

**P2-18. Re-sign-in modal lets a different account take over mid-session with stale attribution** *(Collab UX)*
The "sign back in" prompt accepts any account's credentials; the collab session and its undo/restore attribution keep using the previous user's identity, so post-switch actions get journaled to the signed-out person.
> `YDocProvider.jsx:1719` (prefillEmail null, Phase 33 TODO), `AuthContext.jsx:545-566` plain signIn, sessionId keyed only on docId (:223-228), undo ctx reads userId once (:638-687), `restoredBy` written from stale ctx (:834). **Fix:** compare the re-authed user id to the previous one; on mismatch force a full session remount (or block with "sign in with the same account").

**P2-19. "Live sync — changes sync in real-time" is only half-true: app→Excel push is hard-disabled** *(Excel sync)*
A Stage-0 safety switch (deliberate) disables all automatic writes to Excel; only Excel→app is live. The toggle's copy promises real-time both ways, so users who edit the survey and check Excel see nothing and don't know why.
> `excelWritebackGate.js:15` `EXCEL_AUTOMATIC_WRITEBACK_ENABLED=false` permanently kills the push effect (`PDFViewer.jsx:17595-17630`); pull poll ungated (:17578); tooltip copy `SurveySpacesRail.jsx:2561,2566`. **Fix (copy-level, cheap):** tooltip/label to "Excel changes appear here automatically; use Sync to Excel to push your edits" until the patch-writer ships.

**P2-20. Every Live Sync connect double-fires and orphans a Microsoft workbook session** *(Excel sync)*
The connect effect re-triggers itself by setting state it depends on, running the full Graph setup twice and abandoning the first workbook session (idles until Microsoft times it out). Wastes quota/API calls on every connect.
> Effect at `PDFViewer.jsx:17326-17445`: `setOneDriveFileId` (:17356) is in its own dep array (:17445); cleanup guard (:17330/17439) is false on the first pass so Session A is never closed. **Fix:** split file-id resolution from session creation (separate effects), or guard `initLiveSync` against re-entry when only oneDriveFileId changed; close the prior session ref before creating a new one.

**P2-21. Excel 'create' ops skip the field/template whitelist that 'apply' ops enforce** *(Excel identity — abuse)*
A tampered editor-role request can inject answer keys/entity values that don't exist in the template via a 'create' op; the server accepts, stores, and broadcasts them to every client. The 'apply' path was explicitly hardened against this; 'create' wasn't.
> Apply-branch validation: `20260625120000_kal309_excel_sync.sql:539-589`; create branch (:616-621) only strips secret-shaped keys (`kal309_sanitize_payload`, :287-308). Client `overlayChangedFields` (`excelSyncClient.js:676-710`) also doesn't validate `answer:<id>`. **Fix:** run the same key-whitelist + template-config validation on the create branch's fields, downgrade to 'review' on violation.

**P2-22. OneDrive picker never refreshes the Microsoft token — long sessions dead-end on "Failed to load folders. Please try again."** *(OneDrive)*
Folder browsing and the pre-save duplicate check never call the token-refresh helper (the upload step does). Stale token → generic error, retry re-fails, no reconnect hint. In Electron custody there's no background refresh at all, and the failed duplicate check silently disables the collision guard on top of P2-04.
> No `ensureFreshToken` in `OneDriveFolderBrowser.jsx:105-185`, `OneDriveFileSaveModal`, or `handleOneDriveSave` (`PDFViewer.jsx:14555-14607`); contrast `performOneDriveExport` (:14420-14434). Electron: `MSGraphContext.jsx:538-542`. **Fix:** thread `ensureFreshToken` into the modal (call before each Graph batch); add a "Reconnect Microsoft" affordance on auth-shaped failures.

**P2-23. Two owners removing/demoting each other simultaneously can leave a document with zero owners** *(Sharing — multiuser race)*
The last-owner guard counts other owners at statement time; under read-committed isolation two concurrent removals can each see the other as still active, both pass, and the document ends up ownerless — permanently locking out all management actions.
> `kal31_guard_last_owner` (`20260802010000:6-62`) COUNT-based; services issue plain UPDATE/DELETE (`documentAnnotationService.js:685-719`). **Fix:** in the trigger, `SELECT ... FOR UPDATE` the sibling owner rows (or take a per-document advisory lock) before counting.

**P2-24. One tab's stale Microsoft token failure wipes the shared connection record other tabs just refreshed** *(Microsoft auth — multiuser)*
Web tabs cache the refresh token in memory; when tab B's superseded token hard-fails, it unconditionally nulls the shared DB row that tab A just wrote fresh tokens into — A is forced to reconnect on next reload despite being fine.
> `refreshAccessToken` hard-failure wipe (`MSGraphContext.jsx:314-327`) with no compare-before-wipe; per-tab `tokenMetadataRef` (:625-641). **Fix:** before wiping, re-read the row and only clear it if the stored refresh token equals the one that just failed.

**P2-25. Switching Microsoft accounts on desktop can leave silent refresh using the *old* account** *(Microsoft auth)*
Sign-in with `select_account` never evicts the previously cached account, and silent refresh always uses `accounts[0]` — OneDrive/Excel ops can run under the wrong identity while the UI shows the new one.
> `msalAuthMain.js:87-94,96-121,123-140`; only `signOut` clears the cache (:161-174). **Fix:** after interactive sign-in, remove cached accounts other than the selected one (or key `getAccessToken` to the homeAccountId from the last interactive result).

**P2-26. A network blip at desktop launch is treated as a broken Microsoft connection → full re-auth demanded** *(Microsoft auth)*
Silent token acquisition is retried once; any residual failure (including plain network errors) sets the same "reconnect" state as a genuinely revoked connection.
> `MSGraphContext.jsx:407-437`; only `InteractionRequiredAuthError` is distinguished (`msalAuthMain.js:123-140`). **Fix:** classify network/transient errors separately; show "Microsoft temporarily unreachable" and retry on connectivity restore instead of `needsReconnect`.

**P2-27. Billing lifecycle emails route customers to google.com** *(Billing)*
Trial-ending, payment-succeeded, and payment-failed emails open the Stripe portal correctly, but the portal's "return to merchant" link is a hardcoded placeholder: google.com. Worst on payment-failed — the customer fixes their card, then lands on Google.
> `stripe-webhook/index.ts:467-470,510-514,548-552` (`return_url: 'https://www.google.com' // Placeholder`). The in-app portal flow does it right (`create-portal-session/index.ts:88`). **Fix:** one-line each — point at the app URL (reuse `withBillingResult` for a confirmation state).

**P2-28. Unlimited repeat 7-day Pro trials via cancel → resubscribe** *(Billing)*
Every Pro checkout unconditionally grants a 7-day trial; nothing records that a customer already used one, so perpetual free Pro is a cancel-and-resubscribe loop away.
> `create-checkout-session/index.ts:178-183`; cancellation preserves `stripe_customer_id` but wipes `trial_ends_at` (`stripe-webhook/index.ts:395-405`); no `has_used_trial` anywhere. **Fix:** add a `trial_used_at` column set on first trial; only include `trial_period_days` when unset (or check Stripe subscription history for the customer).

**P2-29. Stripe webhook side effects aren't idempotent — retries duplicate customer emails** *(Billing)*
Stripe delivers at-least-once; a redelivered event re-sends "Payment Received"/"Payment Failed"/"Subscription Canceled" emails (DB writes are safely idempotent; emails aren't).
> No event-id dedupe in `stripe-webhook/index.ts`; unconditional `sendEmail` at :433-441, :516-526, :554-561. **Fix:** a `processed_stripe_events(event_id primary key)` insert-first guard.

**P2-30. A half-failed account deletion strands a live account whose data is already gone** *(Account deletion)*
The four deletion stages run sequentially without overall atomicity; if storage/auth deletion fails after the DB wipe succeeded, the user stays logged into an account whose documents are irreversibly gone, with only a generic error.
> `_shared/accountDeletion.ts:11-16`; UI surfaces only `err.message` (`AccountSettings.jsx:365-377`). **Fix:** reorder (auth-user deletion or a tombstone flag first / storage before rows where possible), make retries safe, and return stage-aware errors ("your data was removed; retry to finish closing the account").

**P2-31. Profile save reports total failure even when the name change already saved** *(Account settings)*
Name and password updates run in one try block with one generic catch — a password failure after a successful name save is reported as if nothing saved.
> `AccountSettings.jsx:282-296,345-346`. **Fix:** track per-step success; report partial results.

**P2-32. Google-only accounts are shown a Change Password form that can never succeed** *(Auth)*
The form always demands the current password; Google-only accounts have none, so every attempt returns "Current password is incorrect" with no path to ever set one.
> Unconditional render `AccountSettings.jsx:550-585`; re-auth via `signIn` (:270,276). **Fix:** detect password-identity absence from `user.identities`; offer a "Set a password" flow (email-based reset link or `updateUser` without current-password re-auth).

**P2-33. Invite link → "Sign in to continue" → dashboard, invite abandoned** *(Auth/invites)*
The sign-in bounce sets a query param nothing reads and a localStorage token nothing else consumes; after auth the user lands on the plain dashboard with the invite unaccepted and must find the email link again.
> `InviteAcceptPage.jsx:190-197` (params dead — zero readers repo-wide), `kal31_pending_invite_token` written/removed only in the same file (:30,81-84). **Fix:** on app boot post-auth, check that localStorage key and route back to `/invite/<token>`.

**P2-34. Eight documented keyboard shortcuts do nothing** *(Keyboard shortcuts — merged: 3 findings)*
The in-app cheat sheet promises Ctrl+W (close tab), Ctrl+Tab / Ctrl+Shift+Tab (switch tabs), B (toggle sidebar), ← → (prev/next page), Home/End (first/last page). None are implemented: no handlers exist for W/Tab/B/Home/End anywhere, and the arrow-key handler is gated on a single-page mode the app actively forces off. (Ctrl+W/Ctrl+Tab are also browser-reserved on web — those two need removal or desktop-only accelerators, not handlers.)
> Overlay claims: `KeyboardShortcutsOverlay.jsx:46-47,54-56,78`. No handlers (grep-verified); arrow branch dead: `PDFViewer.jsx:23540-23546` vs forced `'continuous'` (:955, :23567-23571); Electron accelerators lack W/Tab (`electron-main.js:537-591`). **Fix:** implement Home/End and page-nav arrows (works in continuous mode via scroll-to-page); implement B; move Ctrl+W/Ctrl+Tab to Electron menu accelerators and drop them from the overlay on web.

**P2-35. Mobile bottom sheets: dismiss-then-reopen race, missing exit animations, and stuck-mid-drag sheets** *(Mobile — merged: 3 findings, shared root cause)*
(a) Swipe a sheet away then quickly tap to open another: the new sheet renders invisible and then self-closes up to 170ms later — an uncancellable close timer fires against the sheet you just opened. (b) Three of the survey sheet's four close affordances (including tap-outside) hard-hide with no slide-down and desync the motion state, feeding (a). (c) No touchcancel handling: an interrupted drag (edge-swipe, incoming call) leaves the sheet visually stranded mid-screen until another full drag.
> Root: `useMobileSheetMotion.js:67-83` uncancellable setTimeout, no external reset; bypass call sites `PDFSidebar.jsx:187,210-215`, `AppShell.jsx:1166-1169`, `MobilePdfViewerChrome.jsx:839-843,1021-1026,1577`; survey bypasses `SurveySpacesRail.jsx:1200-1211,1523-1533,4076-4086`; dragHandlers lack onTouchCancel (:161-166), dragY never reset on start/early-return (:85-97,120,123). **Fix:** store the timer id and expose `cancelPendingClose()`/`resetMotion()`; route all open/close paths through the hook; add onTouchCancel = settle-to-rest; reset dragY on touchstart.

**P2-36. Launching the desktop app twice lets two processes race on the Microsoft token cache** *(Electron)*
No single-instance lock: a second launch gets its own in-memory token cache over the same file; last writer wins, and one window can be left unable to re-authenticate until sign-out/in.
> No `requestSingleInstanceLock` (`electron-main.js:1724-1727`); shared `ms-auth-cache.bin` (`msalAuthMain.js:27,63`); per-write-only atomicity (`msalCacheStore.cjs:52-79`). **Fix:** standard `app.requestSingleInstanceLock()` + focus-existing-window on `second-instance`.

**P2-37. Exported/printed PDFs can contain literally invalid numbers if an annotation's geometry is ever corrupted** *(Export)*
Shape/line/callout writers don't validate that coordinates are finite; an Infinity/NaN from a bad merge or hostile collaborator payload gets serialized as the literal text "Infinity"/"NaN" inside the saved PDF — invalid syntax, no error shown, export reports success. Narrow trigger (requires already-bad data), but silent and unguardable downstream.
> `pdfAnnotationsPdfLib.js:1753-1756, 2308-2311, 387-393` lack the `Number.isFinite` guard the flatten path already uses (`getObjNumber`, :2954-2957); pdf-lib 1.17.1's number serializer does `String(num)` unguarded. **Fix:** run all geometry through the existing `getObjNumber`-style guard; skip-with-reason on non-finite, matching the existing missing-page-size skip pattern.

---

### LOW

**P2-38. Post-checkout `?billing=success` flag is set but never read** *(Billing)* — return from Stripe checkout shows no in-app confirmation and leaves the stray param in the address bar; state only catches up via the window-focus refetch.
> `_shared/billingReturn.ts` / `create-checkout-session/index.ts:162-163`; zero consumers in src. **Fix:** read + toast + strip the param on boot; pairs naturally with P2-27's return_url fix.

**P2-39. Save Log's local-disk write is hardcoded to the maintainer's own machine path and blocked by the app's own allowlist** *(Electron)* — throws and is swallowed on every machine including the maintainer's; the working Logs/ snapshot and GitHub push are unaffected.
> `AppShell.jsx:247`, `PDFViewer.jsx:9068` (`/Users/isaiahcalvo/Desktop/...`) vs allowlist `electron-main.js:764-816`. **Fix:** delete the redundant write (dated snapshot supersedes it) or target `userData`.

---

## 3. Areas that came back clean or near-clean

- **Export/flatten/print (beyond Pass 1 items):** near-clean. Only one new medium edge case (P2-37, non-finite numbers). The claim that print drops stamp/image annotations was investigated and **refuted**.
- **Realtime CRDT sync core:** the actual Yjs merge/sync engine surfaced no new correctness defects — both new findings (P2-16, P2-17) are recovery-UX and presence-freshness issues around a sound core.
- **Offline queue drain/quarantine machinery:** the retry loop, banners, and quarantine UI are correctly built and would work if fed (the defect is that nothing feeds them — P2-02). The claim that the retry handlers apply the wrong operation to queued deletes was **refuted**.
- **Keyboard shortcuts overlay behavior:** both claims about the '?' overlay (hotkeys firing underneath it; '?' popping the overlay while typing in text fields) were **refuted** — the overlay's guards are correct. The problems are the eight documented-but-dead shortcuts (P2-34).
- **Edge-function CORS wildcard:** flagged-and-cleared previously; re-confirmed intentional and non-exploitable per the standing project record. Not a finding.
- **No area in this pass produced data-corruption findings in the annotation store itself** — the worst data outcomes are duplication (P2-10), destruction via deletion cascade (P2-03), and overwrite of external files (P2-04).

---

## 4. How Pass 2 slots into the Pass-1 fix order

Mapping to the Pass-1 tier structure (Tier 1 = data-loss/security, fix first; Tier 2 = high-visibility correctness; Tier 3 = medium UX/robustness; Tier 4 = polish/deferred):

**Tier 1 — join the front of the queue (data safety, money, access control):**
- P2-01 free-tier invite paywall bypass
- P2-02 retry queue never fed (decide: wire or retire — it changes the reliability story for everything else)
- P2-03 account-deletion collaborator cascade (must land **before** P2-15 re-enables the button)
- P2-04 OneDrive silent overwrite
- P2-05 revoke-doesn't-revoke
- P2-06 Manage Team gate + false emails
- P2-09 false "Sync to Excel successful" (it corrupts the sync baseline, not just the toast)

**Tier 2 — alongside Pass 1's high-severity correctness fixes:**
- P2-07 promoted owners locked out of Manage Access
- P2-08 Connect Google account-switch
- P2-10 duplicate Survey Markers (server-side dedup; sits naturally next to Pass 1's Excel/undo integrity work)
- P2-11 Electron quit timer (small fix, disproportionate daily-feel win + real save-loss edge)
- P2-12 lost revoked-access banner
- P2-13 mobile Microsoft dead end (at minimum the hide-the-button stopgap goes in Tier 2; the full Capacitor flow can be scheduled)
- P2-14 desktop/web Microsoft token clobber
- P2-15 re-enable account deletion (strictly after P2-03)
- P2-28 repeat-trial abuse (money; cheap fix — arguably Tier 1 if trial conversion matters near-term)

**Tier 3 — batch with Pass 1's medium UX/robustness work:**
- P2-16, P2-17 (collab recovery toast, presence heartbeat)
- P2-18 (re-sign-in identity), P2-19 (Live Sync copy — one-line, do opportunistically), P2-20 (double session), P2-21 (create-op validation)
- P2-22, P2-23, P2-24, P2-25, P2-26 (token refresh, last-owner race, MS multi-tab/account edge cases)
- P2-27 (google.com return URLs — trivial, ship with any billing touch), P2-29 (webhook idempotency)
- P2-30, P2-31, P2-32, P2-33 (deletion staging, profile save, Google-only password, invite bounce)
- P2-34 (shortcuts), P2-35 (mobile sheets — one shared-root-cause fix), P2-36 (single-instance lock), P2-37 (finite-number guard)

**Tier 4 — polish:**
- P2-38 (billing return param), P2-39 (Save Log path)

Two sequencing notes: (1) P2-03 → P2-15 is a hard ordering dependency. (2) P2-27 + P2-38 and P2-19's copy fix are near-zero-cost riders — attach them to whichever tier-1/2 change first touches billing or the Excel rail rather than scheduling them separately.