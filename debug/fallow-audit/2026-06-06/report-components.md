# Fallow Audit — Component & Util Export Verdicts
**Date:** 2026-06-06  
**Scope:** React components + annotation/util single-export files (25 files)  
**Method:** grep for each flagged export across src/, tests/, agent-cli/, scripts/

---

## Findings Table

| File | Export (line) | Verdict | Evidence |
|------|--------------|---------|----------|
| `src/PageAnnotationLayer.jsx` | `ARROWHEAD_STYLE_LABELS` (249) | SECONDARY-EXPORT-DEAD | Defined locally but unused externally. Consumers (`AppShell.jsx`, `AnnotationPropertiesPanel.jsx`) import it from `src/components/Callout/types.js` (the canonical source). PDFViewer only imports `{ ARROWHEAD_STYLES }` from PAL, not ARROWHEAD_STYLE_LABELS. Component (default export) is live. |
| `src/components/FabricDrawingCanvas.jsx` | `configureCanvasForDrawingTool` (47) | TEST-ONLY | Only referenced in `src/components/__tests__/FabricDrawingCanvas.toolSwitch.test.mjs` (source-grep pattern, not a real import). No runtime consumer imports this named export. Used internally within the component itself. |
| `src/components/FormFieldPropertiesPanel.jsx` | `buildFormFieldUpdate` (23) | KEEP-IN-USE | Intentional re-export shim. Comment says "existing callers keep working." Tests import from `formDesignerTools.js` directly but this shim stays for backward-compat. |
| `src/components/OptionalAuthPrompt.jsx` | `OptionalAuthPrompt` (21) | SECONDARY-EXPORT-DEAD | Only `useOptionalAuth` hook is imported (`AppShell.jsx: import { useOptionalAuth }`). The `OptionalAuthPrompt` component export is never imported or rendered anywhere. |
| `src/components/collab/CleanupResidueReviewPanel.jsx` | `CleanupResidueReviewPanel` (109=default) | KEEP-IN-USE | `YDocProvider.jsx: import { CleanupResidueReviewPanel } from './CleanupResidueReviewPanel.jsx'` — named import. Live. |
| `src/components/collab/CollaboratorOutlineOverlay.jsx` | `CollaboratorOutlineOverlay` (112=default) | KEEP-IN-USE | `YDocProvider.jsx: import { CollaboratorOutlineOverlay } from './CollaboratorOutlineOverlay.jsx'` — named import. Live. |
| `src/components/collab/ConfirmDeleteModal.jsx` | `ConfirmDeleteModal` (156=default) | KEEP-IN-USE | `PDFViewer.jsx: import { ConfirmDeleteModal } from './components/collab/ConfirmDeleteModal.jsx'` — named import. Live. |
| `src/components/collab/QuarantineMarkerOverlay.jsx` | `QuarantineMarkerOverlay` (94=default) | KEEP-IN-USE | `YDocProvider.jsx: import { QuarantineMarkerOverlay } from './QuarantineMarkerOverlay.jsx'` — named import. Live. |
| `src/components/collab/ReSignInModal.jsx` | `ReSignInModal` (36) | KEEP-IN-USE | `YDocProvider.jsx: import ReSignInModal from './ReSignInModal.jsx'` (default). Both exports present; component is live. |
| `src/components/collab/ReadOnlyGate.jsx` | `ReadOnlyGate` (51) | KEEP-IN-USE | `YDocProvider.jsx: import ReadOnlyGate from './ReadOnlyGate.jsx'` (default). Live. |
| `src/components/collab/StorageFailureBanner.jsx` | `StorageFailureBanner` (271) | KEEP-IN-USE | `YDocProvider.jsx: import StorageFailureBanner from './StorageFailureBanner.jsx'` (default). Tests in phase27/30/29. Live. |
| `src/components/collab/UndoToast.jsx` | `UndoToast` (50=default) | KEEP-IN-USE | `PDFViewer.jsx: import { UndoToast } from './components/collab/UndoToast.jsx'` — **named import** of the named export. Live. |
| `src/components/collab/YDocProvider.jsx` | `YDocProvider` (175) | KEEP-IN-USE | `AppShell.jsx: import YDocProvider from './components/collab/YDocProvider.jsx'` (default). Live. |
| `src/home/HubShell.jsx` | `ProgressBar` (88) | SECONDARY-EXPORT-DEAD | No external import of `ProgressBar` from `HubShell` exists. Other consumers import `HubShell, Icon, Avatar, AvatarStack, PdfThumb, Search` — never `ProgressBar`. `UsageIndicator.jsx` has its own independent local `ProgressBar`. |
| `src/home/templateReorderUtils.js` | `restrictSortableToVerticalAxis` (11) | SECONDARY-EXPORT-DEAD | `Dashboard.jsx` imports only `reorderItemsByActiveOver, reorderCategoriesByActiveOver`. `restrictSortableToVerticalAxis` has no importer in src/ or tests/. |
| `src/sidebar/bookmarkReorderUtils.js` | `arrayMoveBookmarkItems` (11) | KEEP-IN-USE (internal) | Used by `getBookmarkProjection`, `getAutoExpandTargetFolder`, `applyBookmarkTreeProjection` within the same file. Those are live external exports; removing the export keyword would be safe but the function is not dead. |
| `src/sidebar/bookmarkReorderUtils.js` | `getDragDepth` (25) | KEEP-IN-USE (internal) | Used by `getBookmarkProjection` within the same file. Same reasoning. |
| `src/prototype/spikeMetrics.js` | `MAX_CANVAS_DIM` (62) | PROTOTYPE/DIAG | Used internally by `clampToBudget` (which is imported by `PdfjsArm.jsx`). Prototype file; intentional keep per CLAUDE.md. |
| `src/prototype/spikeMetrics.js` | `MAX_CANVAS_AREA` (63) | PROTOTYPE/DIAG | Same as MAX_CANVAS_DIM. Prototype file; intentional keep. |
| `src/utils/annotationBatching.js` | `DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE` (8) | SECONDARY-EXPORT-DEAD | `chunkRowsForAnnotationUpsert` is used by `documentAnnotationService.js` + tests. The constant is only used as the default param inside that function. Zero external imports of the constant itself. |
| `src/utils/annotationHydrationGate.js` | `isInitialAnnotationHydrationReady` (42) | SECONDARY-EXPORT-DEAD | Other exports from this file imported by PDFViewer. `isInitialAnnotationHydrationReady` is used internally only by `shouldGateFirstVisibleAnnotationPage`. No external caller. |
| `src/utils/annotationLocalHistory.js` | `getAnnotationHistoryAuthorId` (19) | SECONDARY-EXPORT-DEAD | All other exports from this file are used. `getAnnotationHistoryAuthorId` is called only by `isOwnAnnotation` (private, same file). No external import. |
| `src/utils/annotationPreviewDiag.js` | `emitAnnotationGestureSummary` (216) | SECONDARY-EXPORT-DEAD | Other exports (`recordAnnotationCommit` etc.) imported by PDFViewer, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, hooks. `emitAnnotationGestureSummary` called only by the settle timer inside the same file. No external consumer. |
| `src/utils/annotationSyncDelta.js` | `isExplicitFabricDeleteAction` (41) | SECONDARY-EXPORT-DEAD | `useAnnotationCloudSync.js` + tests import from this file but never this function. Used internally by `shouldSuppressStaleCacheShrink`. No external import. |
| `src/utils/annotationSyncType.js` | `CRDT_FAN_OUT_EXCLUDED_TYPES` (13) | SECONDARY-EXPORT-DEAD | `resolveCrdtFanOutAnnotationType` imported by `useAnnotationCloudSync.js` + tests. Constant used internally only. No external import. |
| `src/utils/annotationSyncType.js` | `getRawAnnotationTypeForFanOut` (15) | SECONDARY-EXPORT-DEAD | Internal helper for `resolveCrdtFanOutAnnotationType`. Tests only import `resolveCrdtFanOutAnnotationType`. No external consumer. |
| `src/utils/calloutBlankCommit.js` | `normalizeCalloutText` (10) | SECONDARY-EXPORT-DEAD | PDFViewer + tests import `isBlankCalloutText, resolveCommittedCalloutText, shouldDeleteBlankCalloutOnCommit`. `normalizeCalloutText` is a private helper for `isBlankCalloutText`. No external import. |
| `src/utils/calloutRemovalIntent.js` | `CALLOUT_REMOVAL_INTENT_TTL_MS` (12) | SECONDARY-EXPORT-DEAD | `markCalloutRemovalIntent`, `getRecentCalloutRemovalIntent`, `diffCalloutIds`, `classifyCalloutShrink` all used externally. The TTL constant used only as default param in `getRecentCalloutRemovalIntent`. No external import. |
| `src/utils/calloutSyncPayload.js` | `normalizeCalloutForSync` (51) | SECONDARY-EXPORT-DEAD | `normalizeCalloutsForSync` heavily used by `viewerShared.js`, `useAnnotationCloudSync.js`, tests. `normalizeCalloutForSync` is the per-item `.map()` callback inside `normalizeCalloutsForSync`. No external import. |
| `src/utils/calloutImportAdapter.js` | `isImportedCalloutTextbox` (8) | SECONDARY-EXPORT-DEAD | PDFViewer imports only `splitImportedCalloutsFromPage`. `isImportedCalloutTextbox` used internally within the module. No test or source file imports it directly. |
| `src/utils/calloutImportAdapter.js` | `convertImportedCalloutToCalloutState` (16) | SECONDARY-EXPORT-DEAD | Same as above. Internal helper called by `splitImportedCalloutsFromPage`. Zero external consumers. |

---

## Summary by Verdict

| Verdict | Count |
|---------|-------|
| KEEP-IN-USE | 12 |
| SECONDARY-EXPORT-DEAD | 16 |
| PROTOTYPE/DIAG | 2 |
| TEST-ONLY | 1 |
| **Total** | **31** |

---

## REMOVABLE List (SECONDARY-EXPORT-DEAD items)

Safe to remove the `export` keyword from these. They are internal helpers whose parent modules remain fully live.  
**Per CLAUDE.md: run `npm test` + `npx vite build` before any deletion; never auto-delete.**

| Export | File | One-line Evidence |
|--------|------|-------------------|
| `ARROWHEAD_STYLE_LABELS` | `src/PageAnnotationLayer.jsx:249` | Canonical source is `Callout/types.js`; PAL export is a local duplicate never imported externally. |
| `OptionalAuthPrompt` (component) | `src/components/OptionalAuthPrompt.jsx:21` | Only `useOptionalAuth` is imported from this file; component export unreachable. |
| `ProgressBar` | `src/home/HubShell.jsx:88` | No external import; other HubShell exports used; `UsageIndicator.jsx` has its own independent ProgressBar. |
| `restrictSortableToVerticalAxis` | `src/home/templateReorderUtils.js:11` | Dashboard only imports `reorderItemsByActiveOver` + `reorderCategoriesByActiveOver`; no consumer of this modifier. |
| `DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE` | `src/utils/annotationBatching.js:8` | Used only as default param inside `chunkRowsForAnnotationUpsert`; not imported by any caller. |
| `isInitialAnnotationHydrationReady` | `src/utils/annotationHydrationGate.js:42` | Internal helper for `shouldGateFirstVisibleAnnotationPage`; not imported by PDFViewer or any test. |
| `getAnnotationHistoryAuthorId` | `src/utils/annotationLocalHistory.js:19` | Private helper for `isOwnAnnotation` in same file; no external import. |
| `emitAnnotationGestureSummary` | `src/utils/annotationPreviewDiag.js:216` | Internal — called by the settle timer inside the same file; no external consumer. |
| `isExplicitFabricDeleteAction` | `src/utils/annotationSyncDelta.js:41` | Internal helper for `shouldSuppressStaleCacheShrink`; not imported externally. |
| `CRDT_FAN_OUT_EXCLUDED_TYPES` | `src/utils/annotationSyncType.js:13` | Used internally by `resolveCrdtFanOutAnnotationType`; no external import. |
| `getRawAnnotationTypeForFanOut` | `src/utils/annotationSyncType.js:15` | Internal helper for `resolveCrdtFanOutAnnotationType`; no external consumer. |
| `normalizeCalloutText` | `src/utils/calloutBlankCommit.js:10` | Internal helper for `isBlankCalloutText`; PDFViewer/tests import higher-level functions only. |
| `CALLOUT_REMOVAL_INTENT_TTL_MS` | `src/utils/calloutRemovalIntent.js:12` | Used only as default param in `getRecentCalloutRemovalIntent`; no external import. |
| `normalizeCalloutForSync` | `src/utils/calloutSyncPayload.js:51` | Internal `.map()` callback inside `normalizeCalloutsForSync`; no external import. |
| `isImportedCalloutTextbox` | `src/utils/calloutImportAdapter.js:8` | Internal helper for `splitImportedCalloutsFromPage`; PDFViewer imports only the latter. |
| `convertImportedCalloutToCalloutState` | `src/utils/calloutImportAdapter.js:16` | Internal helper for `splitImportedCalloutsFromPage`; zero external consumers. |

---

## Notes

- **`configureCanvasForDrawingTool`** (`FabricDrawingCanvas.jsx:47`) is TEST-ONLY via a source-grep assertion in `FabricDrawingCanvas.toolSwitch.test.mjs` — not a real runtime import. The export serves as a stability contract for that test. Do not remove.
- **`arrayMoveBookmarkItems` / `getDragDepth`** (`bookmarkReorderUtils.js:11,25`) are private helpers for live public exports in the same file; removing `export` would be safe but is a pure cosmetic change.
- **Prototype files** (`spikeMetrics.js:62,63`) flagged constants are used internally by `clampToBudget`, which IS imported by `PdfjsArm.jsx`. The constants themselves are not imported externally but the prototype file is an intentional keep.
