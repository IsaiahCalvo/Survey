# Annotation Fix 9 Undo/Redo Contract Log

Date: 2026-05-11

## What Was Inspected

- Local history stacks in `src/App.jsx`, `src/utils/annotationLocalHistory.js`, and `src/utils/historyStacks.js`.
- Y.Doc undo manager in `src/lib/collab/crdtUndoManager.js`.
- CRDT materialization in `src/hooks/useAnnotationsCRDT.js`.
- Supabase/Y.Doc persistence and hydration in `src/hooks/useAnnotationCloudSync.js`.
- Fabric drawing, edit, and eraser paths in:
  - `src/components/FabricDrawingCanvas.jsx`
  - `src/components/FabricEditCanvas.jsx`
  - `src/components/FabricEraserCanvas.jsx`
- SVG annotation/callout/visibility behavior in `src/components/SVGAnnotationLayer.jsx`, `src/components/PageAnnotationLayer.jsx`, and `src/PageAnnotationLayer.jsx`.
- Existing tests for local history, Yjs undo isolation, redo isolation, eraser precise history, callout payloads, callout removal intent, and dual-write ordering.

Annotation types covered by the inspected shared Fabric history path:

- Pen strokes and highlighter strokes
- Rectangles, circles/ellipses, lines/arrows
- Polygons/polylines and imported path annotations
- Counters/counter pins
- Text boxes
- Region and survey-region scoped Fabric annotations
- Eraser deletes and partial eraser changes

Separate paths inspected:

- Survey highlights use `highlightAnnotations` and `documentAnnotationService`, not the Fabric local history helper.
- Callouts use the legacy/callout snapshot lane plus dedicated Supabase-first callout sync.

## What Was Wrong

Local annotation undo/redo already felt instant because it applied directly to React state with `flushSync` when available. The persisted state then flowed through `useAnnotationCloudSync`, which writes Supabase first and fans out to Y.Doc.

The first missing guard was ownership at the local annotation history boundary. A malformed or mixed local history batch could contain another user's annotation. Applying that action would delete, restore, or update the foreign annotation before the cloud path saw it.

Correction pass: callout history still used broad snapshots. A callout undo/redo could restore the whole saved `callouts` array, which meant an older snapshot could remove, restore, or edit another user's callout if that foreign callout changed between the checkpoint and the undo/redo.

Y.Doc undo manager already scopes by memoized per-user origin object, so the CRDT/Yjs lane had per-user isolation. The gaps were the newer local annotation history lane, which is preferred ahead of Yjs for immediate Fabric undo/redo, and callout snapshot restore.

## Files Changed

- `src/utils/annotationLocalHistory.js`
- `src/utils/calloutHistoryScope.js`
- `src/App.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `tests/annotationLocalHistory.test.mjs`
- `tests/calloutHistoryScope.test.mjs`
- `tests/svgKeyboardHandlers.test.mjs`
- `ANNOTATION_FIX_9_UNDO_REDO_CONTRACT_LOG.md`

## Final Undo/Redo Contract

- Undo/redo applies locally first for responsiveness.
- The resulting React state change is not blocked from sync.
- `useAnnotationCloudSync` persists that result to Supabase.
- After Supabase success, the change fans out to Y.Doc.
- Reload uses Supabase durable state first when readable, then reshapes Y.Doc.
- Local annotation history records and applies only annotations whose resolved author is the current user, with unattributed legacy/imported annotations still allowed for backward compatibility.
- Callout undo/redo keeps using the existing snapshot lane for immediate UI response, but the callout array inside the restored snapshot is scoped to checkpoint callout IDs and current-user ownership before restore.
- Y.Doc undo/redo remains scoped by per-user tracked origins.

## Local Undo/Redo, Supabase, and Y.Doc Interaction

Fabric annotations:

1. A local create/update/delete produces a local history action.
2. The action is filtered by owner before entering `localAnnotationUndoRef`.
3. Undo applies the inverse action immediately to `annotationsByPage`.
4. Redo applies the original action immediately to `annotationsByPage`.
5. The changed `annotationsByPage` triggers the cloud sync hook.
6. The hook writes Supabase first.
7. On Supabase success, the hook fans out the changed/deleted IDs to Y.Doc.

Callouts:

1. Callout creates/edits/deletes use `addHistoryCheckpoint`.
2. Undo/redo scopes the callout part of the target snapshot to the checkpoint's callout IDs and the current user.
3. Undo/redo restores the scoped callout-inclusive snapshot immediately.
3. `callouts` state changes trigger the callout sync hook.
4. The hook deletes/upserts in Supabase first, then fans out to the Y.Doc callouts map.

Y.Doc:

- `createUndoManager` tracks only the memoized local origin for the current user.
- `userUndo` and `userRedo` wrap Yjs operations with `local-undo` / `local-redo` origins for attribution without adding new undo entries.

## Ownership Enforcement

Added `filterAnnotationHistoryActionByOwner(action, userId)` in `annotationLocalHistory.js`.

Author resolution checks:

- `meta.authorId`
- `__meta.authorId`
- top-level `authorId`
- `data.authorId`
- `data.userId`

The filter is applied twice:

- Before pushing an action into local undo history.
- Before applying a local undo/redo action.

Foreign single actions are dropped. Mixed batches are reduced to the current user's entries only. This specifically protects eraser undo, batch delete undo, and grouped shape edits from restoring or modifying another user's annotation.

Added `scopeHistoryStateForCalloutRestore(...)` in `calloutHistoryScope.js`.

Callout author resolution checks:

- `meta.authorId`
- `__meta.authorId`
- top-level `authorId`
- top-level `userId`
- `data.authorId`
- `data.userId`

For callout checkpoints, the restore path reads `context.calloutId` and `context.calloutIds`. It then applies only those IDs:

- If the target snapshot has the current user's callout, restore/upsert it.
- If the target snapshot does not have the current user's callout, remove it.
- If the callout belongs to another user, keep the current version.
- If unrelated callouts changed after the checkpoint, keep the current version.
- Legacy/unattributed callouts are still allowed for backward compatibility.

## Survey/Region Exceptions

- Region and survey-region Fabric annotations follow the same local history contract because their `regionId`, `spaceId`, and module metadata live on the Fabric object and are preserved in the filtered action.
- Survey highlights are an intentional exception. They use `highlightAnnotations` and the survey highlight sync path rather than the Fabric local history helper. Existing highlight checkpoint handling remains in the legacy history lane and was not refactored in this fix.

## Manual Test Steps and Results

Environment:

- Dev server: `http://127.0.0.1:5173/`
- Browser automation: Playwright MCP
- Documents checked:
  - `Package 2 - Rev 4 -- IC.pdf` (large cloud-backed document)
  - `test.pdf` (small cloud-backed document, but had pending dual-write queue)
  - `fix9-small.pdf` (generated 868-byte temp PDF, local-only with `documentId:null`)

Manual steps completed on the large cloud document:

1. Opened the app and confirmed no page-load errors.
2. Opened a real PDF document.
3. Created a rectangle on page 1.
4. Confirmed local history recorded one local annotation create.
5. Waited for sync.
6. Pressed `Meta+Z`.
7. Confirmed undo chose `localAnnotationUndo`, applied an immediate local delete, and moved the action to redo.
8. Confirmed cloud sync detected one deleted ID and fanned out the delete to Y.Doc.
9. Reloaded and reopened the document.
10. Confirmed the test rectangle ID did not appear in hydrate logs after reload.

Manual follow-up attempts:

- Generated an 868-byte temp PDF and uploaded it through both the hidden file input and the visible Upload PDF flow. In both cases the app opened it as local-only (`documentId:null`), so it could not prove Supabase/Y.Doc ordering.
- Opened existing small cloud `test.pdf`. It is cloud-backed, but it already had `dualWriteQueueSize:1`, so hydration intentionally used `ydoc-snapshot` instead of `supabase-durable-snapshot`. That means it could not prove the requested durable reload condition without clearing user/session queue state, which I did not do.
- Tried `Retry now` on the pending sync banner. The queue remained pending during this session.

Manual limitations after correction:

- A clean small cloud-backed PDF was not available in this workspace. The local upload path did not create a cloud document, and the existing small cloud document had a pending local write queue.
- Because of that, full browser proof of "reload hydrated from `supabase-durable-snapshot`" for the new rectangle/callout actions could not be completed without changing existing queue state.
- Redo-before-reload for Fabric is now covered by a focused local history test.
- Callout undo/redo owner safety is now covered by focused mixed-user snapshot tests.
- Supabase-first then Y.Doc fan-out for callouts remains covered by the inspected `useAnnotationCloudSync.js` callout push path and existing callout sync tests.

## Console/Log Excerpts

Local create entered local history:

```text
[UndoDiag] {"event":"local_annotation_history_added","actionType":"create","rawActionType":"fabric:create","annotationType":"rect","annotationId":"d91edd1e-5410-432d-aa88-4125cf1e0091","pageNumber":1,"lane":"local annotation history","receivedStack":"localAnnotationUndo","undoDepth":1,"redoDepth":0}
```

Create attempted Supabase-first route:

```text
[Phase31 UAT] save:start {"route":"supabase-durable-then-crdt","currentTotal":3051,"priorTotal":3050,"deltaTotal":1}
[CloudSync][hook] fabric delta prepared {"changedObjectCount":1,"totalObjectCount":3051,"priorObjectCount":3050}
```

Manual limitation from large document:

```text
[CloudSync][push] upsertAnnotationsByPage failed {"totalRows":3051,"error":"canceling statement due to statement timeout"}
[CloudSync][hook] legacy bulk push failed -> delta-enqueued into CRDT dual-write queue {"enqueuedCount":1,"skippedExisting":3050}
```

Undo chose local history and applied immediately:

```text
[UndoDiag] {"event":"undo_choice","chosenStack":"localAnnotationUndo","chosenLane":"local annotation history","decisionReason":"local annotation history has the newest order number"}
[UndoDiag] {"event":"local_annotation_undo_applied","actionType":"create","rawActionType":"fabric:create","annotationType":"rect","annotationId":"d91edd1e-5410-432d-aa88-4125cf1e0091","pageNumber":1,"receivedStack":"localAnnotationRedo","undoDepth":0,"redoDepth":1}
```

Undo delete persisted/fanned out:

```text
[CloudSync][hook] eraser/delete detected - removing rows from cloud {"count":1,"firstFew":["d91edd1e-5410-432d-aa88-4125cf1e0091"]}
[Phase31 UAT] delete:fan-out done {"requested":1,"deleted":1,"yMapSizeAfter":3050}
```

Reload check:

```text
hasDeletedRectInHydrateLogs: false
```

Small cloud-backed document limitation:

```text
[CloudSync][source-of-truth] cutover initial hydrate kept Y.Doc snapshot {"pdfId":"test.pdf-2462","ydocFabricCount":129,"ydocCalloutCount":3,"supabaseFabricCount":113,"supabaseCalloutCount":1,"dualWriteQueueSize":1,"rule":"Y.Doc used temporarily because local writes are still queued"}
```

Local temp PDF limitation:

```text
[CloudSync][hook] hydrate skipped - missing prerequisite {"hydrateEnabled":false,"hasDocumentId":false,"hasUserId":true,"hasPdfId":true}
[AnnotationHydrationGate][normal] {"documentId":null,"pdfId":"fix9-small.pdf-868","ready":true,"source":"disabled"}
```

## Automated Test Commands and Results

Focused local/Yjs history tests:

```bash
node --test tests/annotationLocalHistory.test.mjs tests/calloutHistoryScope.test.mjs tests/historyStacks.test.mjs tests/phase29/undoTwoUserIsolation.test.mjs tests/phase29/redoLocalScope.test.mjs tests/phase29/undoLocalScope.test.mjs tests/phase29/undoTombstoneResurrection.test.mjs
```

Result: 31 passed, 0 failed.

Focused sync/callout/eraser contract tests:

```bash
node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs tests/annotationSyncType.test.mjs tests/calloutSyncPayload.test.mjs tests/calloutRemovalIntent.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs
```

Result: 22 passed, 0 failed.

Syntax checks:

```bash
node --check src/utils/annotationLocalHistory.js
node --check src/utils/calloutHistoryScope.js
node --check src/utils/historyStacks.js
node --check src/lib/collab/crdtUndoManager.js
node --check src/hooks/useAnnotationCloudSync.js
node --check src/hooks/useAnnotationsCRDT.js
```

Result: passed.

Note: `node --check` cannot directly parse this repo's `.jsx` files on Node 22 because Node reports `ERR_UNKNOWN_FILE_EXTENSION`. `npm run build` was used as the JSX syntax/build verification.

Build:

```bash
npm run build
```

Result: passed. Existing warnings only: Vite CJS API deprecation, pdf.js eval warning, dynamic/static import chunk warnings, and large chunk warning.

## Remaining Risks and Follow-Up Items

- Survey highlights remain on a separate history/sync path. This fix documents that exception but does not refactor it.
- Manual durable reload proof still needs a clean small cloud-backed document with no pending local queue. Current local Upload PDF opens `documentId:null`; existing cloud `test.pdf` has pending queue state.
- The real large document used for initial manual testing still times out on full `upsertAnnotationsByPage` after a create. That is pre-existing sync scale risk and not introduced by this fix.
- Existing dirty workspace changes outside this fix were left untouched.

## Correction: Mixed `delete:batch` Callout Scope

What was still wrong:

- Mixed shape + callout delete used `handleBeginBatchDelete`, which creates a single `delete:batch` checkpoint before downstream shape and callout deletes.
- Before this correction, that checkpoint only stored `suppressCount`.
- `handleUndo` and `handleRedo` only called `scopeHistoryStateForCalloutRestore(...)` for reasons beginning with `callouts:`.
- Result: a mixed `delete:batch` undo/redo could restore the whole broad callout snapshot, so another user's callout or an unrelated callout changed after the checkpoint could be removed, restored, or edited by snapshot drift.

What changed:

- `src/components/SVGAnnotationLayer.jsx` now computes the selected callout IDs once for mixed shape + callout delete and passes them into `onBeginBatchDelete(2, idsArray)`.
- `src/App.jsx` now records those IDs in the `delete:batch` checkpoint context as `calloutIds`.
- `src/App.jsx` now treats `delete:batch` as callout-scoped only when the checkpoint context contains callout IDs.
- `handleUndo` and `handleRedo` now use the same callout-scoped restore helper for those mixed checkpoints.
- Undo/redo lane logging now labels `delete:batch` with callout IDs as `callout history`; legacy `delete:batch` checkpoints without callout IDs remain legacy snapshot history.

How mixed batch delete is scoped now:

1. Mixed Delete/Backspace selection opens one `delete:batch` checkpoint with only the selected callout IDs.
2. Shape delete and callout delete still run immediately, and their downstream checkpoints are suppressed so the action remains one undo step.
3. Undo/redo sees `reason === "delete:batch"` plus `context.calloutIds`.
4. The restored callout array is rebuilt by applying only those callout IDs for the current user.
5. Other users' callouts are kept from current state.
6. Unrelated callouts changed after the checkpoint are kept from current state.

Additional tests added:

- `delete:batch` undo restores only the current user's deleted callouts.
- `delete:batch` undo does not restore another user's deleted callout.
- `delete:batch` undo does not edit or remove unrelated other-user callouts.
- `delete:batch` redo removes only the current user's callouts involved in the batch.
- Mixed SVG delete dispatch starts batch delete with the selected callout IDs.

Correction test commands and results:

```bash
node --test tests/calloutHistoryScope.test.mjs tests/annotationLocalHistory.test.mjs tests/historyStacks.test.mjs
```

Result: 24 passed, 0 failed.

```bash
node --test tests/marqueeSelection.test.mjs tests/svgKeyboardHandlers.test.mjs
```

Result: 29 passed, 0 failed.

```bash
node --test tests/annotationLocalHistory.test.mjs tests/calloutHistoryScope.test.mjs tests/historyStacks.test.mjs tests/phase29/undoTwoUserIsolation.test.mjs tests/phase29/redoLocalScope.test.mjs tests/phase29/undoLocalScope.test.mjs tests/phase29/undoTombstoneResurrection.test.mjs
```

Result: 34 passed, 0 failed.

```bash
node --check src/utils/calloutHistoryScope.js
```

Result: passed.

```bash
npm run build
```

Result: passed. Existing warnings only: Vite CJS API deprecation, pdf.js eval warning, dynamic/static import chunk warnings, and large chunk warning.

Correction remaining risk:

- If a future mixed batch-delete call site calls `handleBeginBatchDelete` without passing the selected callout IDs, callout scoping cannot infer the intended callout subset from the broad snapshot. The current SVG Delete/Backspace path now passes those IDs.
