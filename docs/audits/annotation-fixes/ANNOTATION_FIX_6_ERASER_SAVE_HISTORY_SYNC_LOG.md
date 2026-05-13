# Annotation Fix 6: Eraser Save, History, Sync

Date: 2026-05-10

## Root Cause

`FabricEraserCanvas` already had the best eraser truth: touched IDs and final deleted IDs. After the gesture, `App.jsx` and `useAnnotationCloudSync.js` still rebuilt history and sync work from whole-page serialized Fabric JSON. Fabric can reorder, renormalize, or reserialize untouched objects during eraser commits, so page-wide JSON diffing treated untouched annotations as changed. That produced large `fabric:batch` local history entries and CRDT/Supabase fan-out for annotations the eraser never touched.

A second issue was that an already scheduled fabric sync flush only relied on the scheduling-time pointer check. If the pointer went down before the debounce elapsed, the push runner could still start while the pointer was down.

## Files Changed

- `src/components/FabricEraserCanvas.jsx`
- `src/App.jsx`
- `src/utils/annotationLocalHistory.js`
- `src/hooks/useAnnotationCloudSync.js`
- `tests/annotationLocalHistory.test.mjs`
- `tests/eraserSaveHistorySyncContracts.test.mjs`

Note: the worktree already contained many unrelated edits. This change stayed within the eraser save/history/sync path.

## Behavior Before

- A no-op eraser click could still serialize the canvas and enter the save/history/sync pipeline.
- One deleted annotation could become a `fabric:batch` history entry containing many untouched annotation IDs.
- Sync fan-out used page-wide object fingerprint diffs, so unchanged annotations could be dispatched after eraser serialization churn.
- A pending fabric push could run after pointerdown if it had already been scheduled.

## Behavior After

- `FabricEraserCanvas` computes `finalChangedAnnotationIds` only from touched annotations that remain and actually changed.
- `FabricEraserCanvas` calls `onEraseCommit` only when there is at least one true deleted or changed annotation.
- `App.jsx` treats eraser commits as precise commits. If deleted and changed ID sets are empty, it returns before local history, legacy checkpointing, state update, and sync.
- Local history for eraser commits uses `buildPreciseAnnotationHistoryAction`, which builds actions only from `finalDeletedAnnotationIds` and `finalChangedAnnotationIds`.
- `App.jsx` publishes the same precise ID set to cloud sync with `annotations:precise-fabric-commit`.
- `useAnnotationCloudSync.js` consumes that precise eraser commit:
  - delete fan-out uses the precise deleted IDs
  - changed fan-out uses only the precise changed IDs
  - untouched objects reserialized by Fabric are ignored
- The fabric sync runner rechecks `pointerDownRef.current` at flush time and defers if the pointer is down.

## Tests Run

- `node --test tests/annotationLocalHistory.test.mjs tests/eraserHitTest.test.mjs tests/eraserSaveHistorySyncContracts.test.mjs`
  - Result: 17 passing, 0 failing.
- `npm test`
  - Result: 536 passing, 6 skipped, 0 failing.
- `npm run build`
  - Result: passed.
  - Existing Vite warnings remained: pdf.js eval warning, mixed static/dynamic imports, and large chunk warning.

## Manual Verification

Manual smoke used the local app at `http://localhost:5174/` with existing `test.pdf`.

Steps:

1. Opened `test.pdf`.
2. Switched to eraser.
3. Clicked empty page space.
4. Erased one isolated counter annotation.
5. Drag-erased across a dense group.
6. Pressed undo to confirm local undo restored erased annotations visibly.

The dense group gesture intentionally crossed many annotations in the existing PDF, so it verified multi-delete exactness with 26 IDs rather than exactly two. The exact two-delete case is covered by tests.

## Relevant Log Snippets

No-op erase creates no history/sync:

```text
[EraserHitTest] ... "touchedAnnotationIds":[],"finalDeletedAnnotationIds":[],"finalChangedAnnotationIds":[],"objectDelta":0,"changedObjectsCount":0
```

Because `FabricEraserCanvas` now only calls `onEraseCommit` when deleted or changed IDs are non-empty, no `EraserSaveContract`, `UndoDiag`, or `CloudSync` save log followed that no-op eraser click.

One erase records one ID:

```text
[EraserHitTest] ... "touchedAnnotationIds":["counter-1777599581922-lwnfq5c20"],"finalDeletedAnnotationIds":["counter-1777599581922-lwnfq5c20"],"finalChangedAnnotationIds":[],"objectDelta":-1,"changedObjectsCount":3
[UndoDiag] ... "rawActionType":"fabric:delete","annotationId":"counter-1777599581922-lwnfq5c20","pageNumber":1
[EraserSaveContract] precise commit {"source":"eraser:commit","pageNumber":1,"deletedIds":["counter-1777599581922-lwnfq5c20"],"changedIds":[],"nextObjectCount":112,"previousObjectCount":113}
[CloudSync][hook] fabric delta prepared {"changedObjectCount":0,"totalObjectCount":112,"priorObjectCount":113,"preciseSource":"eraser:commit","preciseDeletedCount":1,"preciseChangedCount":0}
[CloudSync][hook] eraser/delete detected -- removing rows from cloud {"count":1,"firstFew":["counter-1777599581922-lwnfq5c20"]}
[Phase31 UAT] delete:fan-out done ... "requested":1,"deleted":1
```

This is the key proof: Fabric serialization reported `changedObjectsCount:3`, but history and sync used only the one precise deleted ID and sent zero changed annotations.

Multi erase records exact IDs:

```text
[EraserSaveContract] precise commit {"source":"eraser:commit","pageNumber":1,"deletedIds":[...26 ids...],"changedIds":[],"nextObjectCount":86,"previousObjectCount":112}
[CloudSync][hook] fabric delta prepared {"changedObjectCount":0,"totalObjectCount":86,"priorObjectCount":112,"preciseSource":"eraser:commit","preciseDeletedCount":26,"preciseChangedCount":0}
[CloudSync][hook] eraser/delete detected -- removing rows from cloud {"count":26,"firstFew":["counter-1777599583286-0ial7rf4z","counter-1777599583325-ybe1hm5ve","counter-1777599583380-yj5tiwja5","counter-1777599583435-rw09uwups","counter-1777599583437-v8acp31u7"]}
[Phase31 UAT] delete:fan-out done ... "requested":26,"deleted":26
```

No sync while pointer down:

```text
tests/eraserSaveHistorySyncContracts.test.mjs:
fabric sync flush rechecks pointer state and defers while pointer is down
```

The guarded runtime path now logs this if a pending fabric flush wakes while the pointer is still down:

```text
[CloudSync][hook] fabric push deferred at flush -- pointer is down ...
```

The normal manual gestures released before the debounce elapsed, so the runtime did not need to emit that deferral line during the smoke check.

Undo restores exactly deleted annotations:

```text
tests/annotationLocalHistory.test.mjs:
precise eraser one-delete history excludes untouched serialized changes
precise eraser multi-delete history records exactly deleted ids

tests/eraserHitTest.test.mjs:
undo after erase restores exactly the deleted annotations
```

Manual undo after the dense erase visibly restored the erased counter group.

## Remaining Risks

- Manual verification used an existing dense PDF fixture, not a freshly created two-annotation-only temp PDF. The exact two-delete contract is covered by unit tests.
- The app still has broader pre-existing hydration/cutover behavior and extensive unrelated dirty worktree changes. This fix did not alter initial page-load hydration behavior.
- CRDT undo logging still emits one Yjs history line per deleted annotation during fan-out, but local history now records the eraser gesture as a precise local action and sync fan-out uses the exact deleted ID set.
