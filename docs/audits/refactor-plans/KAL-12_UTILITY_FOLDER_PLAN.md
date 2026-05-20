# KAL-12 — Utility folder organization plan

_Run: 2026-05-19. Branch: `isaiahcalvo123/kal-12-plan-utility-folder-organization-without-behavior-changes`._

This is a written plan. Zero file moves in this branch. Each batch below should land as its own narrow follow-up issue with import-only diff, full test suite green, and `vite build` clean as the merge gate.

---

## Current state

`src/utils/` holds **77 files** at the top level plus one existing nested folder (`pdfNativeExport/`). The flat layout makes it hard to tell which file owns annotation geometry vs PDF import vs survey-marker plumbing vs Save Log helpers. Every move below is purely a `git mv` plus an import-path update — no function bodies change.

The existing `pdfNativeExport/` subfolder is the precedent: it groups three closely-coupled files (`coordinateSpace.js`, `featureFlag.js`, `index.js`) under one entry point. The same pattern applies cleanly to several other clusters in the flat list.

---

## Proposed grouping by real ownership

Each row is one proposed batch. Files inside a batch all share a coherent ownership boundary; files outside a batch should NOT be lumped in just because the name looks similar.

### Batch 1 — `annotations/` (LOW risk, 11 files)

Annotation lifecycle, batching, history, hit-test, visibility, hydration, sync delta, and groups. All read only from each other and from `services/` / `lib/collab/` — no risk of circular imports.

- `annotationBatching.js`
- `annotationGroups.js`
- `annotationHitTest.js`
- `annotationHydrationGate.js`
- `annotationLocalHistory.js`
- `annotationPreviewDiag.js`
- `annotationSelectionContext.js`
- `annotationSyncDelta.js`
- `annotationSyncType.js`
- `annotationVisibilityRules.js`
- `surveyMarkerType.js` (sibling to the rest; survey markers are a kind of annotation)

### Batch 2 — `callout/` (LOW risk, 8 files)

Callout geometry, history, import/blank-commit/export adapters, removal intent, sync payload. Tightly self-contained.

- `calloutBlankCommit.js`
- `calloutEditAdapter.js`
- `calloutGeometry.js`
- `calloutGeometryDiag.js`
- `calloutHistoryScope.js`
- `calloutImportAdapter.js`
- `calloutRemovalIntent.js`
- `calloutSyncPayload.js`

### Batch 3 — `geometry/` (LOW risk, 11 files)

Pure geometry and SVG math. No state, no React, no async. Lowest-risk batch overall.

- `eraserHitTest.js`
- `geometryEraser.js`
- `geometryHitTest.js`
- `lineDragMath.js`
- `lineGeometry.js`
- `lineRenderHelpers.js`
- `regionMath.js`
- `svgBoundingBox.js`
- `svgPathAttrs.js`
- `svgToFabricShape.js`
- `svgTransformMath.js`

### Batch 4 — `pdf/` (LOW-MEDIUM risk, 11 files)

PDF import, export, native export, cache, debug, app annotation metadata. Be careful with `pdfNativeExport/` — keep that subfolder intact and move it into the new `pdf/` parent in one motion.

- `pdfAnnotationImporter.js`
- `pdfAnnotations.js`
- `pdfAnnotationsPdfLib.js`
- `pdfAppAnnotationMetadata.js`
- `pdfCache.js`
- `pdfCalloutMetadata.js`
- `pdfCounterMetadata.js`
- `pdfDebug.js`
- `pdfNativeExport/` (whole existing subfolder)
- `PDFWorkerManager.js`
- `saveAnnotatedPDFFile.js`

### Batch 5 — `sync/` (LOW risk, 4 files)

Cloud sync timing, view-model, provenance, network log. The actual queue + retry lives in `src/services/` and `src/lib/collab/` and stays there.

- `syncStatusTiming.js`
- `syncStatusViewModel.js`
- `documentProvenance.js`
- `networkLogger.js`

### Batch 6 — `diagnostics/` (LOW risk, 6 files)

Debug bridge, console filter, log preamble, perf logger, layer perf, shape bleed, text-search diag, context-menu diag.

- `consoleLogFilter.js`
- `contextMenuBridge.js`
- `contextMenuDiagnostics.js`
- `debugBridge.js`
- `logPreamble.js`
- `performanceLogger.js`
- `layerPerformance.js`
- `shapeBleedDiagnostics.js`
- `textSearchDiag.js`

### Batch 7 — `interaction/` (LOW-MEDIUM risk, 8 files)

Cursor scoping, selection handle visibility, marquee, menu positioning, rotation input, useDragToReorder, hooks, handle style.

- `cursorScoping.js`
- `handleStyle.js`
- `hooks.js` (verify there's no name collision with `src/hooks/`)
- `marqueeSelection.js`
- `menuPositioning.js`
- `rotationInputHelpers.js`
- `selectionHandleVisibility.js`
- `useDragToReorder.js`

### Batch 8 — `viewer/` (LOW-MEDIUM risk, 6 files)

Zoom, render queue, page range, Fabric customization, native shape factory, SVG annotation renderers. These touch viewer plumbing but are still pure helpers.

- `fabricCustomization.js`
- `nativeShapeFactory.js`
- `pageRangeParser.js`
- `renderQueue.js`
- `svgAnnotationRenderers.jsx`
- `zoomController.js`

### Batch 9 — `counter/` (LOW risk, 2 files)

- `counterNumbering.js`
- `counterRenumberSavePolicy.js`

### Batch 10 — keep at top level (no move)

These don't belong to a single cluster or are widely shared infrastructure. Leave them flat.

- `excelSyncDirtyState.js`
- `historyStacks.js`
- `oneDriveUtils.js`
- `shapeCommitGeometry.js`
- `validation.js`

Total after the moves: nine subfolders + ~5 top-level files. Down from 77 flat files.

---

## Verification per batch (gate before each merge)

Same checklist for every batch:

1. `git diff --stat` shows file moves + import path updates ONLY. No function-body diff.
2. `npm test` runs with no new failures (the existing pre-existing failure stays).
3. `npm run build` is clean.
4. Manual smoke depending on batch — for `pdf/`, open a PDF; for `annotations/`, draw and erase a stroke; for `geometry/`, no manual smoke needed (pure math).

If any batch comes back with a `git diff --stat` row that doesn't match "renamed file + import path lines only," STOP and investigate before committing.

---

## Risk hazards

- **Tests under `tests/`** also import from `src/utils/...`. Every batch must grep `tests/` for the moved file's import path and update test-side imports too. Missing this fails CI loudly, but it's easy to miss in review if the diff is just renames.
- **`src/App.jsx`** imports from `src/utils/...` in many places. It is Always-Protected per `CLAUDE.md`. Touching it for an import-path rename is allowed (renames don't change behavior) but each PR should keep the App-side diff to import lines only — no other edits ride along.
- **`hooks.js` name collision risk:** there's a `src/hooks/` directory and a `src/utils/hooks.js`. Verify before moving that nothing imports both as `from '…/hooks'` and gets confused.
- **`svgAnnotationRenderers.jsx`** has a `.jsx` extension because it returns JSX. The move must preserve the extension, and the import sites (which currently spell `from './utils/svgAnnotationRenderers'`) should keep extensionless imports.

---

## Implementation order

Start with the lowest-risk, fewest-callers batches so the workflow is proven before the higher-callers batches:

1. KAL-12a — `geometry/` (pure math, no callers outside helpers).
2. KAL-12b — `callout/` (self-contained cluster).
3. KAL-12c — `annotations/` (many callers in `App.jsx`, but mechanically a clean move).
4. KAL-12d — `pdf/`.
5. KAL-12e — `sync/`.
6. KAL-12f — `diagnostics/`.
7. KAL-12g — `interaction/`.
8. KAL-12h — `viewer/`.
9. KAL-12i — `counter/`.

Each is its own one-PR move. Do not bundle.

---

## Done definition

- Inventory of all 77 utility files captured ✓
- Proposed folders match real ownership, not arbitrary buckets ✓
- Existing `pdfNativeExport/` subfolder is preserved as part of `pdf/` ✓
- Five files explicitly stay at the top level ✓
- Each batch has a verification checklist that proves it is import-only ✓
- Risk hazards (test-side imports, App.jsx churn, `hooks.js` collision, `.jsx` extension) called out ✓
- Implementation order ranked by safety ✓

No runtime code changed. Open KAL-12a as the first batch and don't open KAL-12b until KAL-12a is merged and green.
