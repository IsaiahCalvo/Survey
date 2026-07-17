# R2.2 + R2.3 Execution Plan — callout derive-model + realtime/CRDT unification
Written: 2026-07-17 (planner agent, verified against current source; supersedes stale line refs in PLAN.md/KEYSTONE-WIRING.md)

State corrections vs older docs: legacy callout push effect already deleted 2026-06-30 (hook :2313 comment);
shared fabric push is the sole Supabase writer. upsertCallouts survives only in forceFlush (:3209-3225) and dead
callout-bulk queue branches. shouldDeserializeAsFabricObject stays FALSE for callouts through R2.2/R2.3 (decision:
supersedes KEYSTONE-WIRING ":87 reversal" item — nominal-dim hazard). SVGAnnotationLayer keeps the dedicated
filteredCallouts renderer (deliberate, tested decision at :3216-3231) — R2.2 is a DATA-SOURCE flip, not a render rewrite.

## Pivot trick
`callouts` becomes a derived memo over annotationsByPage (reading data.legacyCallout verbatim);
setCallouts/setCalloutsIfPersistedChanged become adapters writing through projectCalloutsIntoByPage.
All ~35 read sites and ~25 write sites keep compiling. annotationsByPage = single in-memory source of truth.
Gates for EVERY slice: node scripts/run-node-tests.mjs green + npx vite build green + agent-cli callout e2e green.
One revertible commit per slice. No DB shape changes anywhere.

## Slices (full detail as delivered by planner)

### Slice 0 — Attribution-on-reload (~40 LOC, independent, land first)
Live path never stamps meta.authorId onto callouts[] entries; row user_id is right but legacyCallout has no author;
reload -> empty chain -> canModify falls open + re-stamp risk.
1. PDFViewer handleCreateCallout (:10172): stamp meta.authorId = user?.id when chain empty; same for paste (:3587) if it mints ids.
2. annotationTypeSerializers serializeFabricObjectToRow (:238-246): backstop — mirror resolved group author into
   legacyCallout.meta.authorId when data.type==='callout' and chain empty. Mutate in place (identity matters to fingerprints).
3. calloutAnnotationBridge calloutToAnnotationObject: copy top-of-chain authorId into deep-copied legacyCallout.meta.
Invariant: create -> push -> reload -> getAnnotationAuthorId === creator; collaborator push never flips (never-overwrite guard).
Tests: extend calloutAnnotationBridge.test.mjs (author survival round-trip); new tests/calloutAuthorAttribution.test.mjs.

### Slice 1 — Pure helpers (~150 LOC, calloutAnnotationBridge.js only, zero call sites)
1. deriveCalloutsFromByPage(byPage): normalized list from obj.data.legacyCallout (fallback annotationObjectToCallout +
   legacyNormalizedCoords), pageNumber from byPage key, stable ordering (page, then id).
2. applyCalloutListToByPage(byPage, nextList, pageSizes): wraps projectCalloutsIntoByPage + empty-list strip (today inline
   PDFViewer :18802-18820) + REFERENTIAL BAIL when getCalloutSyncFingerprint identical (prevents spurious sync pushes).
3. Verify/test projectCalloutsIntoByPage ghost-cleanup on empty-page case.
Invariants: derive(project(list)) round-trips losslessly incl meta/groupId/style; apply(byPage, derive(byPage)) === byPage referential.

### Slice 2 — THE FLIP (~250 LOC, PDFViewer.jsx, highest-risk of R2.2)
1. :3322 useState -> useMemo(deriveCalloutsFromByPage(annotationsByPage)). calloutsRef effect unchanged.
2. setCallouts/setCalloutsIfPersistedChanged (:3325-3333) -> adapters via setAnnotationsByPage + applyCalloutListToByPage +
   pageSizesRef. Keep both names; all write sites compile untouched (:3336,:3450,:3552,:3587,:9797,:10109,:10210,:10243,
   :10261,:10484,:11650,:19018,:19797,:22166,:22226,:22981,:23008,:23079,:23514,:23567,:29149,:29160,:29188,:29199,:29231; hook prop :17326).
3. DELETE reactive projection effect (:18794-18824) — replace with re-projection-on-measure effect over pageSizes
   (referential bail = no-op unless US-Letter-fallback projection moves; preserves BLOCKER-2 fix).
4. LOAD path (:18700-18770): keep loadedCallouts production BYTE-COMPATIBLE (annotationInitialHydrationSource.test.mjs
   regexes at :40/:44 match these lines); setCallouts(loadedCallouts) becomes idempotent adapter reconcile.
5. History: getHistorySnapshot callouts field <- deriveCalloutsFromByPage(annotationsByPageRef.current);
   restoreHistoryState: reconcile via applyCalloutListToByPage BEFORE the single setAnnotationsByPage call.
Known acceptable: hook's setCallouts writes byPage without lastByPageRef update -> echo re-push EXISTS TODAY via projection
effect; not a regression; fixed in Slice 5. Drag perf: projection O(pages), pushes pointer-down-deferred.
Watch source-assertion tests: syncStatusUi, productionAnnotationBenchmark, pdfjsPresentationEngine,
annotationInitialHydrationSource, eraserSaveHistorySyncContracts, excelDeleteGrace, regionJournalWiring, surveyMarkerSyncSafety.
Tests: new tests/calloutDeriveModel.test.mjs; manual draw/drag/edit/delete/undo/zoom + non-Letter first-paint.

### Slice 3 — CREATE/EDIT onto shared save pipeline (~280 LOC, PDFViewer.jsx)
1. commitCalloutMutation(pageNumber, mutateList, saveContext): derive page list -> mutate -> applyCalloutListToByPage on
   THAT PAGE ONLY -> handleSaveAnnotations(page, nextPageJson, ctx). handleSaveAnnotations declared :21625 (after callout
   handlers) -> thread via ref (established TDZ pattern). CRITICAL: next JSON must include ALL non-callout objects on the
   page or shapes get wiped — unit test "ink+counter+2 callouts, edit 1 -> other 3 byte-identical".
2. handleCreateCallout: drop callouts:create checkpoint -> commitCalloutMutation source 'callout:create'. Keep auto-edit refs.
3. handleUpdateCallout/Live: live frames via commitCalloutMutation checkpointPolicy 'skip' (previewBaselineByPageRef
   captures pre-drag page :21666-21675); pointerup commit diffs vs baseline -> ONE fabric:update per drag.
   Delete calloutLiveHistoryBaselineRef usage.
4. TextEditOverlay cluster (:29126-29240): callouts:edit-commit/delete-blank/cancel-new -> commitCalloutMutation.
   KEEP markCalloutRemovalIntent until Slice 5.
5. Text-style writes (:3334,:3447) + group/ungroup (:23514,:23567) -> commitCalloutMutation (style writes GAIN undo — note).
SEAM: keep normalized style object inside legacyCallout byte-identical (text-style fix landed bc28e2a0).
Tests: new tests/calloutFabricDeltaUndo.test.mjs (delta build/apply/invert; filterAnnotationHistoryActionByOwner on callout
groups); extend calloutBlankCommit.test.mjs; unit-test restoreHistoryState with synthetic legacy callouts snapshot.
Legacy callouts:* lane (:10670-10709) UNTOUCHED — pre-existing checkpoints must still replay.

### Slice 4 — DELETE unification (~200 LOC, PDFViewer.jsx, fiddliest: mixed-selection)
1. handleDeleteSelectedCallouts (:10075-10133): keep canModify filter; group permitted ids by page; per page call
   handleRequestBulkDelete (:17156) with snapshotObjects = projected callout groups from byPage; runDelete =
   commitCalloutMutation filter. Delete callouts:delete checkpoint + bespoke buildCalloutDeleteHistoryRow loop —
   emitBulkTrashRows journals fabric-shaped trash rows (Restore re-adds group; derive memo revives). Keep markCalloutRemovalIntent.
2. Cut (:3540-3557) + paste (:3587) -> commitCalloutMutation.
3. Eraser onEraseCallout inherits free. FabricEraserCanvas untouched (Phase 8 candidate). Eraser live-preview mask skips
   callouts — known cosmetic, polish follow-up.
4. Mixed shape+callout marquee: suppressBatchCheckpointsRef arithmetic changes; target = one combined handleSaveAnnotations
   per page (both halves in one next-page JSON) so single Cmd+Z restores both. BUDGET REAL TIME HERE.
Invariant: cross-author modal parity with shapes (owner-cross-author / collaborator-own / solo silent); keyboard + context
menu (window.__onDeleteSelectedCallouts bridge, commit 90c1d98c) + eraser all one gate.
Tests: new calloutBulkDeletePlan.test.mjs; annotationContextMenuCalloutDelete.test.mjs must stay green (keep handler
identity + prop threading; do NOT touch useAnnotationContextMenu.jsx). Manual two-user per PLAN.md Phase 2 T1-T3.
Undo-toast onUndo re-adds snapshotObjects (:17257-17268) — carries data.legacyCallout, revives correctly.

### Slice 5 — R2.3a realtime echo + hydrate consolidation (~300 LOC, hook + thin PDFViewer prop; HIGHEST-RISK of R2.3)
1. New hook prop getPageSizes; hook-local applyRemoteCalloutToByPage: setAnnotationsByPage with applyCalloutListToByPage +
   lastByPageRef.current = next SYNCHRONOUSLY (echo suppression, mirrors fabric callbacks :2583-2602).
2. Realtime onCalloutInsert/Update/Delete (:2604-2623) -> use it. routeRow callout branch STAYS (receiver-side
   re-projection with local measured page sizes; never trust sender's nominal-dim children).
3. Hydrate: all 9 setCallouts sites (:1357,:1436,:1499,:1550,:1711,:2532,:2670,:2788,:2950) -> merge via
   applyCalloutListToByPage into the SINGLE existing setAnnotationsByPage call with lastByPageRef lockstep.
   Keep resolveSafeSnapshot on callout list BEFORE merge (empty-wipe protection; keep context strings).
   Retire lastCalloutsRef, fingerprint refs (:491-494), pendingCalloutFlushRef (:511), state-obs effect (:946-990),
   mergeCallouts/upsertCalloutInList (:3385/:3423), hook callouts/setCallouts params (:396-398) + PDFViewer prop (:17326).
4. forceFlush: delete direct upsertCallouts + fanOutCrdtForCallouts branch (:3209-3225). KEEP callout-bulk drain branches.
5. PDFViewer: delete orphaned markCalloutRemovalIntent calls (consumer was the state-obs classifier).
KNOWN TEST TRIP: annotationIdleRecoveryContracts.test.mjs regex asserts resolveSafeSnapshot('initial-hydrate-callouts') —
update same commit, keep context string. Extend useAnnotationCloudSync.dualWrite.test.mjs if it stubs retired params.
New tests/calloutRealtimeEchoSuppression.test.mjs (remote apply leaves lastByPageRef === state).
Take hydrate branches ONE AT A TIME with suite between; watch hydratedRef ordering (first merged set must not schedule push).
MANDATORY manual two-device collab + >=2 adversarial passes before shipping (project rule).

### Slice 6 — R2.3b CRDT single Y.Map (~150 LOC, THREE WRITER EDITS IN ONE ATOMIC COMMIT)
1. annotationSyncType.js:13 — drop 'callout' from CRDT_FAN_OUT_EXCLUDED_TYPES.
2. annotationDocStore.js:202 — remove unconditional callout skip in syncByPageToDoc.
3. Hook: durable-cutover fan-out (:1336-1342) writes callouts through annotations-map path; delete fanOutCrdtForCallouts
   (:839-899) once callers gone (callout-bulk drain may keep inline fallback / Phase 8 debt — do NOT delete drain).
4. KEEP dual-map READ fallback (hydrate walk :1153-1181) one full release. crdtUndoManager tracks both maps — leave.
5. refreshYjsHistoryTargetFromDoc keeps dual-map read.
Partial application = duplicate CRDT rep (BLOCKER 1 hazard) — atomic commit.
Tests: REWRITE annotationContractRegression.test.mjs:215-237 (retired contract -> new contract); extend
annotationDocStore.test.mjs, crdtCalloutBridge.test.mjs (read fallback), annotationSyncType.test.mjs.
Integration per PLAN.md Phase 7: A creates -> B receives via fabric path; sealed-doc dual-map fallback.
Rollback: revert single commit; durable-wins hydrate self-heals divergence.

## Dependency graph
Slice 0 independent (land first). 1 -> 2 -> 3 -> 4; 2 -> 5 -> 6. 5 nominally parallel with 3/4 but keep state-obs
effect until both merge — we run sequentially anyway.

## Phase 8 dead-code unlocks (schedule SEPARATELY, after drain windows)
Slice 2: projection effect (in-slice), calloutsInSharedStore() inlining. Slice 3+4 (+1 release): callouts:* in
isLegacyAnnotationHistoryMeta, calloutHistoryScope.js, shouldScopeCalloutHistoryRestore, snapshot callouts field.
Slice 5: calloutRemovalIntent.js, retired refs/helpers, onCallout* plumbing. Slice 6 (+1 release): calloutSyncPayload
write half, materializeCalloutFromYMap walk, upsertCallouts + serializeCalloutToRow, callout-bulk branches,
getMap('callouts') reads. Independent adversarial passes first: FabricEditCanvas.jsx, FabricDrawingCanvas.jsx, Callout/index.jsx stub.

## Top 3 risks
1. Slice 2 hidden write-site semantics -> mechanical substitution only, e2e + source-assertion suite per sub-edit, one-commit revert.
2. Slice 4 mixed-selection undo coherence -> one combined save per page, dedicated unit test, legacy lane stays readable.
3. Slice 6 dual-rep divergence on live collab docs -> atomic commit, dual-map read one release, durable-wins self-heal.
