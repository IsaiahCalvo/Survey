# ANNOTATION_FIX_28_COMMIT_SPLIT_AND_DIFF_REVIEW

Date: 2026-05-13

## Working Tree Snapshot

Commands run:

- `git status --short`
- `git diff --stat`

Summary:

- 44 tracked files modified.
- Untracked project files include Fix 1-27 logs, new tests, new utilities, three live E2E scripts, four Supabase migrations, and `.claude/projects/` session memory.
- `git diff --stat` reports 8,533 insertions and 1,311 deletions across tracked files.
- Largest tracked diffs:
  - `src/App.jsx`: 3,273 insertions, 487 deletions.
  - `src/hooks/useAnnotationCloudSync.js`: 1,238 insertions, 182 deletions.
  - `src/utils/pdfAnnotationsPdfLib.js`: 1,049 insertions, 67 deletions.
  - `src/utils/pdfAnnotationImporter.js`: 398 insertions, 26 deletions.

## Recommended Commit Groups

### 1. Annotation Lifecycle, Rendering, Selection, And Initial Hydration

Purpose: regular annotation lifecycle fixes, shape geometry contracts, selection clearing, first-visible-page hydration gating, render-layer behavior, and related diagnostics.

Stage these files:

- `src/App.jsx` - hunk-stage only lifecycle/rendering/selection/hydration/geometry portions; do not include print/export hunks in this commit.
- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/hooks/useSVGInteraction.js`
- `src/utils/annotationHydrationGate.js`
- `src/utils/annotationPreviewDiag.js`
- `src/utils/annotationSelectionContext.js`
- `src/utils/calloutBlankCommit.js`
- `src/utils/calloutGeometryDiag.js`
- `src/utils/marqueeSelection.js`
- `src/utils/shapeCommitGeometry.js`
- `src/utils/svgAnnotationRenderers.jsx`
- `src/utils/svgBoundingBox.js`
- `tests/annotationHydrationGate.test.mjs`
- `tests/annotationInitialHydrationSource.test.mjs`
- `tests/annotationSelectionContext.test.mjs`
- `tests/annotationVisibilityRules.test.mjs`
- `tests/calloutBlankCommit.test.mjs`
- `tests/marqueeSelection.test.mjs`
- `tests/performance/overlayPresentationGate.test.mjs`
- `tests/shapeCommitGeometry.test.mjs`
- `tests/svgKeyboardHandlers.test.mjs`

Notes:

- `src/App.jsx` is too broad to stage as a whole in this group.
- This group is a reasonable first commit if hunk-staged carefully.

### 2. Eraser, Delete, Undo/Redo, And Local History

Purpose: precise eraser hit testing, delete intent tracking, owner-scoped undo/redo, callout history scoping, and local annotation history stack behavior.

Stage these files:

- `src/App.jsx` - hunk-stage only eraser/delete/history/undo-redo portions.
- `src/components/FabricEraserCanvas.jsx`
- `src/hooks/useSVGInteraction.js` - hunk-stage eraser/delete selection portions if not already included with group 1.
- `src/lib/collab/crdtUndoManager.js`
- `src/utils/annotationLocalHistory.js`
- `src/utils/calloutHistoryScope.js`
- `src/utils/calloutRemovalIntent.js`
- `src/utils/counterRenumberSavePolicy.js`
- `src/utils/eraserHitTest.js`
- `src/utils/historyStacks.js`
- `tests/annotationLocalHistory.test.mjs`
- `tests/calloutHistoryScope.test.mjs`
- `tests/calloutRemovalIntent.test.mjs`
- `tests/counterRenumberSavePolicy.test.mjs`
- `tests/eraserHitTest.test.mjs`
- `tests/eraserSaveHistorySyncContracts.test.mjs`
- `tests/historyStacks.test.mjs`

Notes:

- `src/lib/collab/crdtUndoManager.js` is mostly history diagnostics and ordering; keep it with this group rather than general sync.
- This group should be staged after group 1 because it relies on stable annotation ids and geometry behavior.

### 3. Save, Sync, Supabase Durable Source, Y.Doc, And Status UI

Purpose: Supabase-first durable annotation writes, Y.Doc fan-out, callout sync payload normalization, delta sync, manual flush behavior, sync status visibility, document sharing load paths, and source-of-truth hydration behavior.

Stage these files:

- `src/App.jsx` - hunk-stage only app-state save, cloud-sync force flush, hydration source-of-truth, and sync status wiring; exclude print/export UI hunks.
- `src/components/SyncStatusChip.jsx`
- `src/components/collab/YDocProvider.jsx`
- `src/contexts/AuthContext.jsx`
- `src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs`
- `src/hooks/useAnnotationCloudSync.js`
- `src/hooks/useAnnotationsCRDT.js`
- `src/hooks/useDatabase.js`
- `src/lib/collab/SupabaseYjsProvider.js`
- `src/lib/collab/crdtAnnotationBridge.js`
- `src/lib/collab/featureFlags.js`
- `src/services/annotationCloudSync.js`
- `src/services/annotationTypeSerializers.js`
- `src/services/documentAnnotationService.js`
- `src/services/documentHighlightMapper.js`
- `src/supabaseClient.js`
- `src/utils/annotationBatching.js`
- `src/utils/annotationSyncDelta.js`
- `src/utils/annotationSyncType.js`
- `src/utils/calloutSyncPayload.js`
- `src/utils/syncStatusTiming.js`
- `src/utils/syncStatusViewModel.js`
- `tests/annotationContractRegression.test.mjs`
- `tests/annotationSyncDelta.test.mjs`
- `tests/annotationSyncType.test.mjs`
- `tests/cloudSyncAllTypes/serializers.test.mjs`
- `tests/crdtCalloutBridge.test.mjs`
- `tests/documentAnnotationService.test.mjs`
- `tests/documentHighlightMapper.test.mjs`
- `tests/phase28/SupabaseYjsProvider.test.mjs`
- `tests/phase31/legacyBulkUpsertGate.test.mjs`
- `tests/syncStatusUi.test.mjs`

Notes:

- `src/contexts/AuthContext.jsx` adds a dev-only auth override used by the Fix 20 multi-user harness. It is related to live verification, but it is still app code. Review before committing to decide whether a test-only hook should live in production code.
- `src/hooks/useDatabase.js` now explicitly fetches collaborator documents. This belongs with the shared-document sync/RLS series.
- `src/supabaseClient.js` is a small environment-safety cleanup; it can stay in this group.

### 4. Import/Export Backend Contracts For PDF-Native And App Annotations

Purpose: PDF annotation import fidelity, app/counter/callout PDF metadata contracts, duplicate prevention, native annotation preservation, and export/import regression coverage.

Stage these files:

- `src/utils/pdfAnnotationImporter.js`
- `src/utils/pdfAnnotationsPdfLib.js` - hunk-stage PDF-native import/export metadata and normal export contract portions; exclude flattened print-only helper hunks if deferring print/export UI.
- `src/utils/pdfAppAnnotationMetadata.js`
- `src/utils/pdfCalloutMetadata.js`
- `src/utils/pdfCounterMetadata.js`
- `tests/pdfAnnotationImporter.test.mjs`
- `tests/pdfAnnotationNormalization.test.mjs`
- `tests/pdfSaveExportContract.test.mjs`

Notes:

- This group is coupled to annotation backend correctness because it defines how app-created annotations become PDF-native annotations and how imported PDF-native annotations avoid duplication.
- `src/utils/pdfAnnotationsPdfLib.js` also contains print-only flattening code. If print/export is deferred, this file must be hunk-staged.

### 5. Supabase RLS And Shared Document Migrations

Purpose: allow active collaborators to open shared documents and document storage while preserving least-privilege annotation write contracts.

Stage these files:

- `supabase/migrations/20260513000000_allow_collaborators_to_select_documents.sql`
- `supabase/migrations/20260513003000_allow_collaborators_to_read_document_storage.sql`
- `supabase/migrations/20260513010000_fix_shared_document_annotation_rls_contract.sql`
- `supabase/migrations/20260513013000_fix_document_insert_returning_select_policy.sql`

Notes:

- Keep these together or split into two commits:
  - collaborator document/storage read access
  - annotation author-scoped write policy plus INSERT RETURNING fix
- These migrations are relevant to backend annotation fixes and should stay in the commit series after review.

### 6. Live Contract Scripts

Purpose: authenticated/manual E2E proof scripts used during Fix 19 and Fix 20 validation.

Stage these files only if the team wants live verification scripts in the repo:

- `scripts/fix19-live-auth-contract-e2e.mjs`
- `scripts/fix19-survey-region-live-contract-e2e.mjs`
- `scripts/fix20-multi-user-collab-contract-e2e.mjs`

Notes:

- These are useful, but they are not required for runtime annotation backend fixes.
- If committed, use a separate "verification scripts" commit.
- If the repo does not normally keep one-off fix scripts, leave them untracked or move them to a local scratch area.

### 7. Audit Logs And Review Reports

Purpose: fix-by-fix audit trail.

Stage these files if audit logs are intentionally part of this branch:

- `ANNOTATION_FIX_1_LIGHTWEIGHT_OVERLAY_LOG.md`
- `ANNOTATION_FIX_2_CALLOUT_CONTRACT_LOG.md`
- `ANNOTATION_FIX_3_CALLOUT_RELOAD_YDOC_LOG.md`
- `ANNOTATION_FIX_4_SYNC_STATUS_UI_LOG.md`
- `ANNOTATION_FIX_5_ERASER_HIT_TEST_LOG.md`
- `ANNOTATION_FIX_6_ERASER_SAVE_HISTORY_SYNC_LOG.md`
- `ANNOTATION_FIX_7_INITIAL_HYDRATION_GATE_LOG.md`
- `ANNOTATION_FIX_8_SOURCE_OF_TRUTH_CONTRACT_LOG.md`
- `ANNOTATION_FIX_9_UNDO_REDO_CONTRACT_LOG.md`
- `ANNOTATION_FIX_10_SURVEY_REGION_VISIBILITY_LOG.md`
- `ANNOTATION_FIX_11_CLEAR_SELECTION_ON_CONTEXT_CHANGE_LOG.md`
- `ANNOTATION_FIX_12_PHANTOM_MARQUEE_AND_CALLOUT_DELETE_LOG.md`
- `ANNOTATION_FIX_13_PDF_IMPORT_FIDELITY_AND_DUPLICATES_LOG.md`
- `ANNOTATION_FIX_14_PDF_SAVE_EXPORT_CONTRACT_LOG.md`
- `ANNOTATION_FIX_15_SAVE_FEEDBACK_AND_EXPORT_LABEL_LOG.md`
- `ANNOTATION_FIX_16_COUNTER_EXPORT_REIMPORT_CONTRACT_LOG.md`
- `ANNOTATION_FIX_17_EXPORT_SCOPE_CONTRACT_LOG.md`
- `ANNOTATION_FIX_18_SYNC_DELTA_EFFICIENCY_LOG.md`
- `ANNOTATION_FIX_19_ANNOTATION_CONTRACT_REGRESSION_LOG.md`
- `ANNOTATION_FIX_20_MULTI_USER_COLLAB_CONTRACT_LOG.md`
- `ANNOTATION_FIX_21_EXPORT_PRINT_UI_CONTRACT_LOG.md`
- `ANNOTATION_FIX_22_EXISTING_EXPORT_ALL_SCOPES_LOG.md`
- `ANNOTATION_FIX_23_SPACE_REGION_EXPORT_SANITY_LOG.md`
- `ANNOTATION_FIX_24_CURRENT_PRINT_SANITY_LOG.md`
- `ANNOTATION_FIX_25_FINAL_BACKEND_ANNOTATION_LIFECYCLE_QA_LOG.md`
- `ANNOTATION_FIX_26_SUPABASE_RLS_SHARED_DOCUMENT_CONTRACT_LOG.md`
- `ANNOTATION_FIX_27_CLEANUP_AND_RELEASE_CHECKPOINT_LOG.md`
- `ANNOTATION_FIX_28_COMMIT_SPLIT_AND_DIFF_REVIEW_LOG.md`

Notes:

- These should be one docs/audit commit, not mixed into runtime code commits.
- If the project does not keep fix logs in Git, leave them untracked.

### 8. Print/Export UI And Behavior Changes

Purpose: explicit export behavior, menu labels, print-with-regular-annotations path, export diagnostics, and scope wording.

Stage these files only in a dedicated print/export commit, or defer them:

- `src/App.jsx` - hunk-stage only print/export/save-as behavior and labels.
- `src/electron-main.js`
- `src/preload.js`
- `src/sidebar/SpacesPanel.jsx`
- `src/utils/saveAnnotatedPDFFile.js`
- `src/utils/pdfAnnotationsPdfLib.js` - hunk-stage only `buildPrintableRegularAnnotationPayload`, `savePDFWithFlattenedRegularAnnotationsForPrint`, and flattened drawing helpers if this commit is kept.
- `tests/pdfSaveExportContract.test.mjs` - only if covering export behavior in this commit.

Recommendation:

- These changes are not required by the core annotation backend fixes.
- Some PDF import/export metadata work is backend-contract relevant, but print UI and flattened print behavior are separate product changes.
- Split into its own commit if kept.
- Prefer defer/review before staging because normal save behavior changed materially: regular save no longer writes or prompts for a PDF copy, and Cmd/Ctrl+Shift+P now builds a temporary flattened PDF containing regular app annotations only.

### 9. Save Log / Console Capture Cleanup

Purpose: keep saved logs smaller and less noisy.

Stage these files as a small separate cleanup commit:

- `src/components/SaveLogBanner.jsx`
- `src/main.jsx`
- `src/utils/consoleLogFilter.js`
- `tests/consoleLogFilter.test.mjs`

Notes:

- This is useful cleanup, but it is not core annotation backend behavior.
- It should not be mixed into save/sync or print/export commits.

## Files That Should Not Be Committed

- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-09.md`
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-10.md`
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-11.md`
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-12.md`
- `.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-05-13.md`

Recommendation for `.claude/projects/`:

- Never commit `.claude/projects/` session memory.
- Add `.claude/projects/` to `.gitignore`.
- Leave the current files untracked until the user decides whether to remove local session memory from this repo working tree.
- Do not remove them automatically; they may be useful local project memory.

## Files That Need More Review

- `src/App.jsx`: highest-risk file because it mixes lifecycle, sync, history, import/export, print, live harness, and diagnostics. It needs hunk staging, not file-level staging.
- `src/utils/pdfAnnotationsPdfLib.js`: mixes backend export metadata with flattened print implementation. Hunk-stage or split before commit.
- `src/utils/pdfAnnotationImporter.js`: large PDF-native import fidelity changes; keep, but review imported app metadata and duplicate-skip paths carefully.
- `src/hooks/useAnnotationCloudSync.js`: large source-of-truth and queue/flush rewrite; tests pass, but it is high-impact runtime sync code.
- `src/contexts/AuthContext.jsx`: dev-only `__fix20AuthOverride` is useful for E2E, but it is production-bundled app code. Review whether this should stay.
- `src/main.jsx`: indentation includes tabbed lines in the save-log section. Build passes, but clean formatting before commit would reduce review noise.
- `src/electron-main.js`, `src/preload.js`, `src/sidebar/SpacesPanel.jsx`, `src/utils/saveAnnotatedPDFFile.js`: print/export UI behavior. Defer or split.
- `scripts/fix19-live-auth-contract-e2e.mjs`, `scripts/fix19-survey-region-live-contract-e2e.mjs`, `scripts/fix20-multi-user-collab-contract-e2e.mjs`: decide whether one-off live scripts belong in the repo.

## Print/Export Recommendation

Answers:

- Required by annotation backend fixes: no, not as a full UI/behavior set.
- Should stay in this commit series: only the backend PDF import/export metadata and duplicate-prevention contracts should stay with annotation fixes.
- Should be split: yes. Menu labels, normal save behavior, explicit export flow, SpacesPanel wording, and temporary flattened print should be their own print/export commit.
- Should be reverted/deferred: defer until reviewed if the current task is strictly annotation backend. The change from "save may write/prompt for PDF output" to "normal save is app/cloud state only; explicit Export writes PDF" is product behavior, not just a backend fix.

## `.claude/projects/` Recommendation

- `.claude/projects/` is local project/session memory, not application source.
- It should be ignored with `.claude/projects/` in `.gitignore`.
- It should remain untracked for now.
- It should not be committed.
- It should not be removed automatically unless the user explicitly wants local session memory cleaned from this working tree.

## Accidental, Risky, Or Unrelated Items

- Accidental/local-only:
  - `.claude/projects/.../session-moments/*.md` should not be committed.
- Risky:
  - `src/App.jsx` and `src/hooks/useAnnotationCloudSync.js` are very large and should be reviewed through smaller commits.
  - Print/export behavior changes are unrelated enough to block commit readiness unless split or deferred.
  - `src/contexts/AuthContext.jsx` dev auth override should be reviewed for production exposure even though it only reads localStorage in dev mode.
- Unrelated cleanup:
  - Save-log console filtering should be its own cleanup commit.
  - `src/supabaseClient.js` env access cleanup is tiny and safe but could be folded into sync/RLS if desired.

## Verification Results

Passed:

- `node --test tests/documentAnnotationService.test.mjs tests/phase28/SupabaseYjsProvider.test.mjs tests/phase31/legacyBulkUpsertGate.test.mjs tests/annotationContractRegression.test.mjs`
  - 23 tests passed.
  - Node emitted existing module type warnings for ES module syntax in files without `"type": "module"`.

Passed:

- `node --test tests/syncStatusUi.test.mjs tests/annotationSyncDelta.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - 26 tests passed.
  - Node emitted existing module type warnings for ES module syntax in files without `"type": "module"`.

Passed:

- `npm run build`
  - Build completed in 23.85s.
  - Vite emitted warnings about `pdfjs-dist` eval usage, dynamic/static import chunking, and large chunks.

## Final Recommendation

Needs cleanup first.

The runtime/test changes look coherent and verification passes, but the tree is not ready for file-level staging. `src/App.jsx` and `src/utils/pdfAnnotationsPdfLib.js` must be hunk-staged or split because they mix backend annotation fixes with print/export product behavior. `.claude/projects/` should be ignored and never committed. After that cleanup, the work is ready to stage by the groups above.
