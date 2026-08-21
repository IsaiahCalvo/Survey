# PDFViewer serialized queue — fix log

Worker: pdfviewer-serialized · 2026-08-20
Do not edit ISSUE-INVENTORY / FEATURE-MATRIX / FIX-LOG from this worker.

---

### KB-2 — Bring-to-front/back does not persist
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/annotationZOrder.js` (new), `src/services/annotationDocStore.js` (`docToByPage` final sort), `src/PDFViewer.jsx` (`handleReorderAnnotation` stamp + paste remint), `src/hooks/useAnnotationContextMenu.jsx` (`reorderAll` stamp), `src/utils/pasteCloneIdentity.js` (clear inherited `zOrder`)
- Intended behavior confirmed: a reorder stamps `data.zOrder` on the moved object only; `syncByPageToDoc` now emits a payload update; `docToByPage` stable-sorts by `(zOrder ?? insertion-order implicit key, id)` so the stacking survives rematerialize / reload / self-echo.
- Break / adversarial attempts: pure permutation without a zOrder stamp still diffs to `{added:0,updated:0,removed:0}` (unchanged contract for non-reorder saves). 80 sequential between-inserts stay strictly ordered. Identical keys tie-break by id. Unstamped imported pages keep Y.Map insertion order.
- Edges covered: bring-to-front, send-to-back, forward-one, group selected stamp, paste remint on top, import unset, undo/redo rides the payload (`normalizeCanvasJsonForHistory` does not strip `data` fields).
- Test command + result: `node --test tests/annotationZOrder.test.mjs tests/pasteCloneIdentity.test.mjs tests/annotationDocStore.test.mjs tests/annotationContextMenuCalloutParity.test.mjs` → **65/65 pass**
- Remaining risk: first reorder after load uses pre-splice visual index as the implicit neighbor key (matches Y.Map order on a freshly materialized page). After later local clones without rematerialize, implicit neighbor keys can drift until the next `docToByPage`. New draws without a zOrder still use insertion-index implicit keys (usually on top). Keyboard Cmd+[ / ] still pass index only (live at keypress). Self-echo `notifyChange` hygiene not changed — persisted key is the real fix.

### P1-33 — Open context menu can apply z-order to the wrong shape after collab splice
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/useAnnotationContextMenu.jsx` (freeze `annotationId` / `groupIds` at menu open), `src/PDFViewer.jsx` (`handleReorderAnnotation` re-resolves by id), `src/utils/annotationZOrder.js` (`resolveAnnotationIndexById`)
- Intended behavior confirmed: menu open captures the clicked annotation id (DOM `data-annotation-id` / layer query). Apply re-resolves the current index by id. If the id is gone, the handler no-ops instead of permuting a neighbor.
- Break / adversarial attempts: missing id falls back to the live index (legacy keyboard / tests). Group reorder resolves the selected set by frozen ids; empty resolve set is a no-op.
- Edges covered: stale fallback index ignored when id is present; id-not-found returns -1; group path uses `groupIds` when captured.
- Test command + result: same 65/65 suite (`resolveAnnotationIndexById prefers id over a stale fallback index`).
- Remaining risk: if the SVG group lacks `data-annotation-id` at open, capture misses and we fall back to index (same as before for that click). Keyboard hotkeys still use the live selected index.


### P1-09 — Redo resurrects old page snapshot and deletes newest work
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`pushLocalAnnotationHistoryAction`)
- Intended behavior confirmed: a new local-lane action (draw/edit after undoing a callout/marker/space/highlight) now also clears `redoHistoryRef` / `redoHistoryMetaRef` / `setRedoHistory([])`, so handleRedo cannot fall through to a stale whole-page snapshot.
- Break / adversarial attempts: clear is gated on a non-empty legacy redo stack so we do not extra-render when both redo lanes are already empty. Local redo lane still clears first (existing contract).
- Edges covered: CRDT path that skips the legacy checkpoint; source-assertion that the two clears stay adjacent.
- Test command + result: `node --test tests/pdfViewerUndoOneLiners.test.mjs tests/historyStacks.test.mjs tests/pdfChangeEffectKeying.test.mjs tests/annotationHistoryViewerContracts.test.mjs` → **17/17 pass**
- Remaining risk: other writers that push undo without going through `pushLocalAnnotationHistoryAction` must still clear legacy redo themselves (legacy `addHistoryCheckpoint` already does).

### P1-13 — First edit-and-undo after import permanently deletes imported markups
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (embedded-import-once save)
- Intended behavior confirmed: after the skip-policy import save, the dangling preview baseline for that page (and pageKey alias) is deleted, matching the counter-series-delete path. The user's first real edit now diffs against the imported page, not the empty pre-import snapshot.
- Break / adversarial attempts: skip save still plants a baseline during `handleSaveAnnotations`; we delete it immediately after return so a same-tick consumer cannot see it. Both `pageNumber` and `pageKey` strings are cleared.
- Edges covered: source-assertion that `previewBaselineByPageRef.current.delete(String(pageNumber))` follows `checkpointPolicy: 'skip'` at the import site. Durable `embedded_import_completed_at` marker unchanged (import still one-shot).
- Test command + result: same 17/17 suite.
- Remaining risk: any other skip-policy save that plants a baseline and intends it to be consumed still works; only the import path is cleared. If import uses a non-string page key that matches neither, the baseline could linger — we delete both `pageNumber` and `pageKey`.


### P1-16 — Reopened documents hide all survey markers until a module is selected
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (survey-marker paint effect)
- Intended behavior confirmed: when `selectedModuleId` is null (document open / panel closed), the paint slice is rebuilt from ALL saved + pending markers. Selecting a module still filters to that module.
- Break / adversarial attempts: pending markers without a matching moduleId are included only when no module is selected (`!selectedModuleId || moduleId === selectedModuleId`). Saved markers from other modules stay hidden once a module is chosen.
- Edges covered: source-assertion that the old `if (!selectedModuleId) return` is gone and the shared `matchesSelectedModule` predicate is used for both pending and saved lanes.
- Test command + result: `node --test tests/pdfViewerSurveyMarkers.test.mjs` → **2/2 pass**
- Remaining risk: still a writable second slice (`newSurveyMarkersByPage`) rather than a pure useMemo from `surveyMarkers`. SVG still paints only that slice. A later cleanup can collapse the dual-slice as the contract doc recommends.

### P1-24 — Survey-marker move/resize fails open when owner metadata unresolved
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`handleSurveyMarkerBoundsChange`)
- Intended behavior confirmed: the outer `viewerId && documentOwnerId &&` skip is gone. `canModifySurveyMarker` always runs for saved markers and fail-closes when author or viewer is unresolvable.
- Break / adversarial attempts: pending (not-yet-saved) markers still skip the gate (no `existingSurveyMarker`). Own markers with a matching authorId still pass when owner id is missing. Delete path unchanged (`canCommitSurveyMarkerErase` still requires both ids).
- Edges covered: source-assertion that the conjunctive owner-id skip is absent from the bounds-change handler.
- Test command + result: same 2/2 suite.
- Remaining risk: pre-auth boot (no viewerId) now denies move/resize of saved markers (fail closed). That is stricter than the old comment's "falls through permissively" and matches delete's fail-closed intent.


### P1-07 — Text-edit commit by stale index can replace a teammate’s annotation
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/TextEditOverlay.jsx`
- Intended behavior confirmed: existing-text commit looks up the target by `data.id` / `id` from the mount snapshot. If that id is gone, the commit cancels instead of writing `objects[frozenIndex]`.
- Break / adversarial attempts: new-text still appends. If the snapshot has no id, we fall back to the frozen index (legacy imported text without data.id). Out-of-range / missing id cancels via `onEditCancel`.
- Edges covered: source-assertion that the index assignment is gone and `findIndex` + cancel are present.
- Test command + result: `node --test tests/pdfViewerStaleIdCommits.test.mjs tests/calloutBlankCommit.test.mjs` → **6/6 pass**
- Remaining risk: callout edits still use a transient single-element array (index 0) and route through `reactCalloutId` (P1-15). Id-less imported text still uses index.

### P1-15 — Callout text edit clobbers teammate move/restyle
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`onEditCommit` callout branch)
- Intended behavior confirmed: commit maps the live callout and writes only `text` + `textBoxPosition` / `textBoxWidth` / `textBoxHeight` from the editor result. Leader geometry, color, and other fields stay whatever is current in the list.
- Break / adversarial attempts: blank-delete path unchanged (still filters the id out). Missing `updatedReactCallout` leaves the live entry untouched. Style-only toolbar changes during edit still go through `handleCalloutTextStyleChange` / other merge paths.
- Edges covered: source-assertion that the whole-object ternary replace is gone; `calloutBlankCommit` suite still passes.
- Test command + result: same 6/6 suite.
- Remaining risk: if the user resized the text box such that the leader should retract, we no longer rewrite `arrowTip`/`knee` from the frozen children — a teammate-safe choice. A same-user leader drag during own text edit is unusual (editor is open).

### P1-10 — Own undo wipes teammate edits document-wide
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/crdtHistoryScope.js` (new), `src/PDFViewer.jsx` (unscoped legacy undo/redo)
- Intended behavior confirmed: when `yjsDoc` or `yjsUndoManager` is active, an unscoped legacy restore (space/marker/highlight) keeps live `annotationsByPage` and derived callouts. Survey markers, spaces, and pending survey-marker UI still restore from the snapshot.
- Break / adversarial attempts: erase-sentinel and erase-target / callout-scoped restores are unchanged and still win over the CRDT gate. Solo (no CRDT) still full-snapshots.
- Edges covered: helper unit test + source-assertion that both undo and redo call `scopeHistoryStateForCrdtRestore`.
- Test command + result: `node --test tests/crdtHistoryScope.test.mjs tests/pdfViewerUndoOneLiners.test.mjs tests/annotationLocalHistory.test.mjs tests/historyStacks.test.mjs` → pass
- Remaining risk: a callout-scoped restore under CRDT still writes the snapshot's `annotationsByPage` (callouts now live in that map). Callout undo should be on the local lane.

### P1-11 — Own undo reverts a teammate's concurrent edit to the same annotation
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/annotationLocalHistory.js` (`mergeAnnotationHistoryUpdate`)
- Intended behavior confirmed: `fabric:update` / batch updates start from the live object. Fields we did not change stay live. Fields we did change apply only when live still matches the captured "from" snapshot.
- Break / adversarial attempts: clean undo (live === after) still deep-clones `before`. Teammate recolor + own move undoes the move and keeps the recolor. Teammate also moved: we keep their left.
- Edges covered: existing 2,904 canonical replay cases + two new merge tests.
- Test command + result: same suite as P1-10 → pass
- Remaining risk: JSON.stringify equality is key-order sensitive. Nested arrays are not field-merged (all-or-nothing). Create/delete still replace/remove the whole object.

### P1-23 — Imported PDF markups have no authorId
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pdfAnnotationImporter.js` (`stampImportedAnnotationAuthor`), `src/PDFViewer.jsx` (pass `authorId: documentOwnerId || user?.id`)
- Intended behavior confirmed: import stamps `meta.authorId` / `data.authorId` / top-level `authorId` as the document owner (or importer). Existing app-metadata authors are not overwritten. Policy: owner-owned, so `canModify` stays fail-closed for contributors.
- Break / adversarial attempts: empty authorId is a no-op. Diagnostics-only import also receives the id but does not persist objects.
- Edges covered: stamp helper unit test; existing importer suite still passes.
- Test command + result: `node --test tests/pdfAnnotationImporter.test.mjs` → pass
- Remaining risk: pre-existing unstamped imports already in a Y.Doc are not retro-stamped. App callouts grouped via metadata are not stamped here.

### P1-36 — Ownable-import undo after author stamp
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/annotationLocalHistory.js` (`isOwnAnnotation`)
- Intended behavior confirmed: stamped imports undo for the stamped author (owner). Unstamped leftovers are treated as owner-owned when `userId === documentOwnerId`. Contributors still cannot undo missing-author or owner-stamped imports.
- Break / adversarial attempts: existing contributor-rejects-missing-author tests still pass. Owner short-circuit unchanged.
- Edges covered: two new filter tests.
- Test command + result: `tests/annotationLocalHistory.test.mjs` → pass
- Remaining risk: a contributor who edited an unstamped import through a path that skipped `canModify` still cannot undo that edit (fail closed).

### P1-32 — Rotation keyboard nudges lack interactionId
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/RotationInputField.jsx`, `src/components/SVGAnnotationLayer.jsx`, `src/PDFViewer.jsx`
- Intended behavior confirmed: arrow nudges and typed commit share one `rotation-input:<index>:<ts>` until blur or selection change. PDFViewer coalesces `rotation-input` the same way as `object:modified` (first save checkpoints; later saves with the same id skip).
- Break / adversarial attempts: RegionSelectionTool ignores the extra commit arg. Survey-marker rotate path unchanged (different checkpoint).
- Edges covered: source-assertion on the three files.
- Test command + result: `tests/pdfViewerUndoOneLiners.test.mjs tests/rotationInputHelpers.test.mjs` → pass
- Remaining risk: drag-rotate pointerup is a separate source and still one checkpoint (unchanged). First nudge still creates a checkpoint even if the user immediately nudges again.

### P1-17 — Page mutation overwrites live names/bookmarks/spaces
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/usePageOperations.js`, `src/utils/pageAnnotationReindex.js` (`mergeLivePagePresentation`)
- Intended behavior confirmed: queued annotation remaps still come from `pageStateRef`. Presentation fields (pageNames, transforms, bookmarks, spaces) are taken from live `getPageState()` at mutation start and again at the persist-then-commit boundary, then remapped with the same operation.
- Break / adversarial attempts: a rename of page 1 during delete-page-2 survives as page 1 after commit. Annotation ids still follow the queued graph.
- Edges covered: helper unit test.
- Test command + result: `node --test src/utils/__tests__/pageAnnotationReindex.test.mjs` → pass
- Remaining risk: in-flight annotation edits during persist are still taken from the queued graph, not live.

### P1-18 — clipboardPage is a raw number never remapped
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/pageAnnotationReindex.js` (`remapClipboardPage`), `src/PDFViewer.jsx` (`commitPageStructureState`)
- Intended behavior confirmed: delete of the clipped page clears the clipboard. Other mutations remap the number. Rotate leaves it.
- Break / adversarial attempts: cut page 3 then delete page 3 → null. Delete an earlier page decrements.
- Edges covered: helper + source-assertion.
- Test command + result: same reindex suite + `tests/pdfViewerUndoOneLiners.test.mjs` → pass
- Remaining risk: clipboardType is not cleared on delete-of-clipped (page is null so paste is a no-op).

### P1-49 — Search cache ignores reorder/rotate
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`pageMutationRevision` in `pdfSearchDocumentKey`)
- Intended behavior confirmed: every page-structure commit increments a revision that is part of the search document key, so rotate/reorder (same page count) busts the text cache.
- Break / adversarial attempts: insert/delete already changed `numPages`; revision still increments.
- Edges covered: source-assertion on the key template and the increment.
- Test command + result: `tests/pdfViewerUndoOneLiners.test.mjs` → pass
- Remaining risk: presentation-only mirror/reset do not bump the revision (PDF bytes unchanged, text is the same).

### P1-46 — Sidebar names/bookmarks/spaces are localStorage-only
- Date: 2026-08-20
- Status: fixed (partial)
- Files changed: `src/PDFViewer.jsx` (storage listener + pageNames merge-on-write)
- Intended behavior confirmed: another tab writing `pdfSidebar_${pdfId}` reloads names/bookmarks/spaces/transforms. Same-tab writes merge existing pageNames before setItem so a racing rename is not dropped.
- Break / adversarial attempts: storage events do not fire in the writing tab (browser contract). Bookmark/space arrays are still last-write-wins.
- Edges covered: listener is keyed to the current pdfId.
- Test command + result: pages cluster source-assertions (no dedicated storage mock).
- Remaining risk: not moved to Y.Doc meta — cross-user collab still does not share names/bookmarks. Leftover: promote to Y.Doc when a spaces/meta worker is free.

### P1-19 — Whole-PDF upsert has no version check
- Date: 2026-08-20
- Status: leftover (useDatabase half only)
- Files changed: `src/utils/documentVersionCheck.js` (new), `src/hooks/useDatabase.js` (`replaceDocument`)
- Intended behavior confirmed: `replaceDocument(file, path, onProgress, { expectedUpdatedAt })` lists the existing object and throws `DocumentVersionConflictError` on mismatch. Missing expected/remote timestamps still upload (backward compatible).
- Break / adversarial attempts: AppShell is contested and was not wired to pass `selectedPDF.updated_at`.
- Edges covered: helper unit tests + source-assertion.
- Test command + result: `tests/documentVersionCheck.test.mjs` → pass
- Remaining risk / leftover: AppShell `replaceDocument(newFile, durablePath)` must pass `expectedUpdatedAt` from the loaded document metadata. Without that, the check is a no-op.

### P1-20 — Cmd+Shift+D downloads debug files
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (DEV-only debug toggle), `src/utils/shapeBleedDiagnostics.js` (requires `spyOn`)
- Intended behavior confirmed: production no longer toggles debug logging on Cmd+Shift+D. Shape-spy page dump only runs after `window.__shapeSpyOn()`.
- Break / adversarial attempts: spy-off keydown is a no-op (does not preventDefault).
- Edges covered: source-assertion that the viewer listener is behind `import.meta.env.DEV`.
- Test command + result: `tests/pdfViewerUndoOneLiners.test.mjs` → pass
- Remaining risk: main.jsx still imports the spy module in production; it is inert until spyOn.

### P1-21 — Tool switch drops in-flight SVG shape
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/SVGAnnotationLayer.jsx`
- Intended behavior confirmed: leaving a creation tool flushes via `commitShapeCreationRef` then clears preview. No JS zoom.
- Break / adversarial attempts: staying on a creation tool does not flush. Empty in-flight is a no-op.
- Edges covered: source-assertion; zoomGeneration contract untouched.
- Test command + result: `tests/svgKeyboardHandlers.test.mjs` → pass
- Remaining risk: callout mid-drag still only clears the dashed preview (callout commit path is separate).

### P1-34 — Cmd+C/X only for exactly one shape
- Date: 2026-08-20
- Status: fixed (partial)
- Files changed: `src/components/SVGAnnotationLayer.jsx`, `src/PDFViewer.jsx` (`handleCopyAnnotation` / `handleCutAnnotation`)
- Intended behavior confirmed: multi-select copy/cut stashes `{ objects, bbox }` matching the context-menu group payload. Z-order hotkeys stay single-shape.
- Break / adversarial attempts: single-index path unchanged. Cut splices descending so indexes stay valid.
- Edges covered: source-assertion on `selectedIds.size < 1` and array pass-through.
- Test command + result: `tests/svgKeyboardHandlers.test.mjs` → pass
- Remaining risk / leftover: callout keyboard clipboard is still menu-only.

### P1-35 — Paste offset hardcodes 612/792
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx`
- Intended behavior confirmed: callout fraction offset and shape page-unit offset scale from `pageSizesRef` for the target page.
- Break / adversarial attempts: missing page size still uses 612×792.
- Edges covered: source-assertion.
- Test command + result: `tests/pdfViewerUndoOneLiners.test.mjs` → pass
- Remaining risk: first paste (repeat 0) is still cursor-centered, not offset.

### P1-40 / P1-41 — Cmd+0/1/2 force Manual via setMode
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx`
- Intended behavior confirmed: digit zoom keys call `handleZoomModeSelectRef` (pdf.js fit modes) instead of `zoomController.setMode`.
- Break / adversarial attempts: +/− zoom unchanged.
- Edges covered: source-assertion on all three modes.
- Test command + result: same one-liner suite → pass
- Remaining risk: Cmd+M still uses `zoomController.setMode(MANUAL)` (intentional).

### P2-34 — Navigation shortcuts and overlay lies
- Date: 2026-08-20
- Status: fixed (partial)
- Files changed: `src/PDFViewer.jsx` (Home/End/arrows), `src/components/KeyboardShortcutsOverlay.jsx`
- Intended behavior confirmed: Home/End/←/→ change pages in every scroll mode. Overlay no longer lists unimplemented Ctrl+W / Ctrl+Tab, or B. Ctrl+0 copy says Fit page.
- Break / adversarial attempts: form fields still swallow the keys.
- Edges covered: source-assertion that the single-mode gate is gone.
- Test command + result: same one-liner suite → pass
- Remaining risk / leftover: `B` does not toggle the sidebar (no viewer-owned collapse API; AppShell contested).

### P2-39 — Save Log writes a maintainer path
- Date: 2026-08-20
- Status: leftover
- Files changed: none
- Intended behavior confirmed: not touched. AppShell is contested; PDFViewer still writes `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/TestLogs/...`.
- Remaining risk / leftover: replace hardcoded paths with a download or user-chosen folder. AppShell `1.log` path is the other half.

### P1-25 — Legacy group-arrow ignores rotate/scale
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/legacyGroupArrow.js` (new), `src/utils/svgAnnotationRenderers.jsx` (`renderArrow`)
- Intended behavior confirmed: `angle` / `scaleX` / `scaleY` wrap the shaft around its midpoint. Identity transform is omitted so unrotated arrows stay unchanged.
- Break / adversarial attempts: missing/NaN scale is treated as identity.
- Edges covered: helper unit tests + renderer source-assertion.
- Test command + result: `tests/legacyGroupArrow.test.mjs` → pass
- Remaining risk: origin/pathOffset of some Fabric groups may still be slightly off; modern `type:'line'` arrows were already correct.

### P1-26 — Double-click on legacy group arrows is a no-op
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (dblclick + mobile bbox strip), `src/utils/legacyGroupArrow.js`
- Intended behavior confirmed: `isLegacyGroupArrow` (group + triangle/arrowHead) enters bbox edit the same way as line/polygon.
- Break / adversarial attempts: non-arrow groups stay no-op.
- Edges covered: source-assertion on both entry points.
- Test command + result: same helper suite → pass
- Remaining risk: none for the keyboard/mouse path.

### P1-27 — Circle missing from ellipse toolbar gates
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (toolbar sync + isFillable + isEditable)
- Intended behavior confirmed: non-counter `circle` gets fill/stroke chrome. Counters still use the existing `isCounter` path.
- Break / adversarial attempts: path/line gates unchanged.
- Edges covered: source-assertion on all three gates.
- Test command + result: same helper suite → pass
- Remaining risk: none.

### P1-22 — Erase approval only planned callouts
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/eraseApprovalCandidates.js` (new), `src/PDFViewer.jsx` (`requestAtomicEraseApproval` + post-commit toast)
- Intended behavior confirmed: `page-object` and `text-markup` deletes go through `buildBulkDeletePlan`. Any plan with `count > 0` fires the undo toast (including owner-own-only).
- Break / adversarial attempts: replace/partial-only intents still auto-approve with no plan.
- Edges covered: helper unit tests + source-assertion.
- Test command + result: `tests/eraseApprovalCandidates.test.mjs` + `tests/legacyGroupArrow.test.mjs` → pass
- Remaining risk: survey-marker erase stays outside this planner.

### KB-1 leftover — PAL `'skip'` whole-deleted
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PageAnnotationLayer.jsx` only
- Intended behavior confirmed: `getEraserOperation === 'skip'` continues (no-op). `'partial'` still clips ink; anything else still whole-deletes.
- Break / adversarial attempts: full-mode (`entire`) still deletes atomics.
- Edges covered: source-assertion.
- Test command + result: same helper suite → pass
- Remaining risk: `FabricEraserCanvas.jsx` KB-1 Part 2 is still a foreign leftover.

### P2-04 — OneDrive/SharePoint save silently overwrote
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`handleOneDriveSave`), `src/components/TemplateOverwriteWarningModal.jsx`
- Intended behavior confirmed: any existing file prompts before replace (`file-exists` vs template-mismatch copy). A failed existence check cancels instead of uploading.
- Break / adversarial attempts: confirm still uses `conflictBehavior=replace` (intentional).
- Edges covered: source-assertion + modal reason branch.
- Test command + result: `tests/excelOneDriveFixes.test.mjs` → pass
- Remaining risk: none.

### P2-09 — Manual Sync reported success when every write failed
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/excelLiveSyncWriteStatus.js` (new), `src/PDFViewer.jsx` (session sheet loop + toast)
- Intended behavior confirmed: 0 ok / N fail throws and shows an error. Mixed results warn instead of success.
- Break / adversarial attempts: full-file upload path still reports success on write.
- Edges covered: helper unit tests + source-assertion.
- Test command + result: same Excel suite → pass
- Remaining risk: silent/automatic path still rethrows for the caller.

### P2-19 — Live Sync “real-time” copy
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/SurveySpacesRail.jsx` (tooltips)
- Intended behavior confirmed: copy says automatic writeback is off and Push is the write path.
- Break / adversarial attempts: none — strings only.
- Edges covered: source-assertion that the old real-time lines are gone.
- Test command + result: same Excel suite → pass
- Remaining risk: `EXCEL_AUTOMATIC_WRITEBACK_ENABLED` is still false by design.

### P2-20 — Live Sync connect double-fired / orphaned session
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (live-sync lifecycle effect)
- Intended behavior confirmed: session ref stores `fileId` so cleanup can close without waiting on `oneDriveFileId` state. Effect no longer re-inits when `oneDriveFileId` / `liveSyncSupported` change.
- Break / adversarial attempts: disable/unlink still closes via the stored fileId.
- Edges covered: source-assertion on deps + fileId stamp.
- Test command + result: same Excel suite → pass
- Remaining risk: `checkSessionSupport` still opens/closes a probe session before the real one.

### P2-22 — OneDrive picker never refreshed MS token
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/OneDriveFolderBrowser.jsx`, `src/components/OneDriveFileSaveModal.jsx`, `src/PDFViewer.jsx`
- Intended behavior confirmed: each folder/site/library list calls `ensureFreshToken` first; expired token surfaces an error instead of a stale Graph client.
- Break / adversarial attempts: missing `ensureFreshToken` is a no-op (browser-only embeds still work).
- Edges covered: source-assertion.
- Test command + result: same Excel suite → pass
- Remaining risk: none.

### Queue pause — clean boundary after excel-onedrive
- Date: 2026-08-20
- Status: leftover
- Files changed: none
- Intended behavior confirmed: stopped before **P1-50** (keyed Y.Map for spaces — schema/migration, not a min PDFViewer diff). Next IDs still open: P1-50, P1-51, P1-52, P2-17, P2-18, P1-31, then leftovers P1-08 consume / P1-28 / P1-34 callout clipboard / P2-34 B / P2-39 / P1-19 AppShell.

### P1-17 leftover — queued page-name remap
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/usePageOperations.js`, `src/utils/pageAnnotationReindex.js`
- Intended behavior confirmed: persist-then-commit still holds. Chained ops use `pageStateRef` as the source of truth. `mergeLivePagePresentation` remaps live names only when they are not the stale pre-queue snapshot or the source already transformed.
- Break / adversarial attempts: overlaying live `pageNames` onto queued state was the fail (`{1:B,2:C}` after delete).
- Edges covered: rapid move-then-delete mounted test.
- Test command + result: `tests/pageOperationsQueueMounted.test.mjs` → pass
- Remaining risk: a same-key rename that exactly restores the original name set could look stale.

### P1-50 — keyed Y.Map per space
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/services/annotationDocStore.js`, `src/services/annotationDocSync.js`, `src/hooks/useAnnotationDoc.js`, `tests/spacesKeyedMap.test.mjs`
- Intended behavior confirmed: spaces live in `spacesById`. Concurrent edits to different spaces merge. Legacy whole-array `annoMeta.spaces` still hydrates and is dual-written as a compat snapshot.
- Break / adversarial attempts: empty map still reads META; remigration is a no-op once the map is populated.
- Edges covered: merge / migrate / compat unit tests.
- Test command + result: `tests/spacesKeyedMap.test.mjs` → pass
- Remaining risk: a pre-upgrade client writing only META can still LWW-clobber the snapshot; new readers prefer the map. `tests/annotationDocConcurrency.test.mjs` has two erase-outbox fails that reproduce with or without `spacesById` in `DURABLE_MAP_NAMES` — treated as foreign.

### P1-51 — empty-space empty state
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx`, `src/utils/spaceRegionOrphans.js`
- Intended behavior confirmed: `handleSetActiveSpace` refuses a space with no pages/regions and toasts instead of blanking the canvas.
- Break / adversarial attempts: a space with at least one region still activates.
- Edges covered: helper unit test + source path.
- Test command + result: `tests/spaceRegionOrphans.test.mjs` → pass
- Remaining risk: other activation entry points (if any) still need the same gate.

### P1-52 — cascade/GC on remote region delete
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/annotationVisibilityRules.js`, `src/utils/spaceRegionOrphans.js`, `src/hooks/useAnnotationDoc.js`
- Intended behavior confirmed: a `regionId` whose region is gone is treated as unscoped (stays visible). Capture/remote space updates strip the orphaned stamp.
- Break / adversarial attempts: live regions keep their stamps; empty `spaces` does not mass-unscoped (hydrate race).
- Edges covered: visibility + GC unit tests.
- Test command + result: `tests/spaceRegionOrphans.test.mjs` + `tests/annotationVisibilityRules.test.mjs` → pass
- Remaining risk: survey-marker `regionId` is not stripped by this GC.

### P2-17 — presence idle timeout
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/hooks/presenceRoster.js`, `src/services/documentAnnotationService.js`, `src/PDFViewer.jsx`
- Intended behavior confirmed: freshness window is 10 minutes. A 60s heartbeat keeps `last_seen` fresh while the tab is visible.
- Break / adversarial attempts: hidden tabs skip the heartbeat so unclean closes still age out.
- Edges covered: roster freshness test.
- Test command + result: `tests/spaceRegionOrphans.test.mjs` (stale-ms) + existing `tests/presence/presenceRoster.test.mjs` (uses the constant)
- Remaining risk: server RPCs that still hardcode 2 minutes would hide idle viewers on first seed.

### P2-18 — reject different-account re-sign-in
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/collab/ReSignInModal.jsx`, `src/components/collab/YDocProvider.jsx`, `src/components/collab/reSignInAccount.js`
- Intended behavior confirmed: successful password login for a different user signs that session out and stays on the modal. Email is locked when we know the expired account.
- Break / adversarial attempts: missing expected id fail-opens (cannot verify).
- Edges covered: helper unit test.
- Test command + result: `tests/spaceRegionOrphans.test.mjs` → pass
- Remaining risk: OAuth "different account" path is the explicit close-document link, not this form.

### P1-31 — honor SHX transform-lock in SVG handles
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/components/SVGAnnotationLayer.jsx`, `src/hooks/useSVGInteraction.js`
- Intended behavior confirmed: transform-locked / SHX objects render glow-only (no handles). `handleHandlePointerDown` returns before capture.
- Break / adversarial attempts: underline/strike/squiggly stay select-delete-only.
- Edges covered: source-assertion on the lock helper + type set.
- Test command + result: `tests/selectionHandleVisibility.test.mjs` → pass
- Remaining risk: a future object that sets all lock* flags for a different reason also loses handles.

### P1-08 leftover — consume remapped undo/redo selection
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (`restoreHistoryState`, `applyLocalAnnotationHistoryAction`)
- Intended behavior confirmed: after local history apply / snapshot restore, `setPendingSvgSelection` points at the remapped index for the surviving id.
- Break / adversarial attempts: missing id clears the index (`null`).
- Edges covered: source path only.
- Test command + result: focused helper suites above → pass
- Remaining risk: Yjs undo that never goes through these two functions still will not retarget selection.

### P1-28 leftover — blank text deletes
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/textEditCommit.js`, `src/components/TextEditOverlay.jsx`
- Intended behavior confirmed: blank existing text returns null from the builder and the overlay splices the object out via `onEditCommit`.
- Break / adversarial attempts: blank *new* text still cancels/discards.
- Edges covered: source path.
- Test command + result: focused helper suites → pass
- Remaining risk: callout text empty-commit may need the callout-specific delete path if this overlay is not used.

### P1-34 leftover — callout Cmd+C/X
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/PDFViewer.jsx` (keyboard handler)
- Intended behavior confirmed: Cmd/Ctrl+C/X on a selected callout uses the existing copy/cut clipboard. Cut stays inert on read-only docs.
- Break / adversarial attempts: plain `C` still arms the Counter tool.
- Edges covered: source path.
- Test command + result: focused helper suites → pass
- Remaining risk: multi-selected callouts only copy the primary `selectedCalloutId`.

### P2-39 leftover — Save Log path
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/utils/surveyDiagPaths.js`, `src/PDFViewer.jsx`, `src/AppShell.jsx`, `src/electron-main.js`
- Intended behavior confirmed: logs write under `$HOME/Desktop/Survey-BetaSafeS2/…`. Desktop is an allowed Electron write root.
- Break / adversarial attempts: missing home dir falls back to the existing browser download.
- Edges covered: helper unit test.
- Test command + result: `tests/spaceRegionOrphans.test.mjs` → pass
- Remaining risk: `src/main.jsx` still mentions the old developer path in a comment.

### P1-19 leftover — AppShell `expectedUpdatedAt`
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/AppShell.jsx`
- Intended behavior confirmed: `replaceDocument` now passes `selectedPDF.updated_at` so a stale cloud replace fails closed.
- Break / adversarial attempts: missing `updated_at` still uploads (helper treats empty expected as ok).
- Edges covered: existing `documentVersionCheck` contract.
- Test command + result: focused helper suites → pass
- Remaining risk: tab file objects that never stamp `updated_at` skip the guard.

### P2-34 leftover — `B` sidebar
- Date: 2026-08-20
- Status: leftover
- Files changed: none
- Intended behavior confirmed: PDFSidebar collapse is internal; there is no viewer-owned toggle API. Left unopened to avoid an AppShell fight.


