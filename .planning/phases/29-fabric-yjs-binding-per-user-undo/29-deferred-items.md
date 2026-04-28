# Phase 29 — Deferred Items

Items surfaced during plan execution that fall outside the plan's scope.

## Plan 29-02 deferred items

### 1. `undoTombstoneResurrection.test.mjs` (2 tests) + `resurrectRace.test.mjs` (1 test) fail with default `captureTimeout`

**Status:** DEFERRED — Plan 29-03 issue, not a Plan 29-02 (bridge) issue. Logged here per the SCOPE BOUNDARY rule.

**Symptom:**
After Plan 29-02 (bridge) and Plan 29-03 (undo manager) both shipped, three tests un-skipped automatically and now run end-to-end:

- `tests/phase29/undoTombstoneResurrection.test.mjs` test #1: `CREATE → DELETE → undo` — expects `yMap.has('annoX')` to be `true` after `undoManager.undo()`. Asserts `false !== true`.
- `tests/phase29/undoTombstoneResurrection.test.mjs` test #2: `CREATE → EDIT → DELETE → undo` — same root cause; the post-undo `yMap.get('annoX')` is undefined so the chain crashes with `TypeError: Cannot read properties of undefined (reading 'get')`.
- `tests/phase29/resurrectRace.test.mjs` test #1: `A creates X; B edits X; A deletes X; sync; A.undo` — same root cause; annotation is fully wiped instead of resurrected.

**Root cause (verified by direct Yjs reproduction):**

`Y.UndoManager` with the default `captureTimeout: 500` merges all transactions within a 500 ms window into a single undo stack item. The failing tests perform `applyFabricCommit` (CREATE) + `applyFabricDelete` rapidly in the same synchronous block. UndoManager merges them into one stack item; `.undo()` reverts the merged step, which is `CREATE+DELETE`. Result: the annotation never existed from the undo manager's point of view, so undo is a no-op and the assertion fails.

Reproduction (run from repo root):

```js
import * as Y from 'yjs';
const ydoc = new Y.Doc();
const yMap = ydoc.getMap('annotations');
const origin = Object.freeze({ source: 'local-fabric', userId: 'u1' });
const um = new Y.UndoManager(yMap, { trackedOrigins: new Set([origin]), captureTimeout: 500 });
ydoc.transact(() => { const sub = new Y.Map(); yMap.set('a1', sub); sub.set('left', 10); }, origin);
console.log('After CREATE undoStack length:', um.undoStack.length);  // 1
ydoc.transact(() => { yMap.delete('a1'); }, origin);
console.log('After DELETE undoStack length:', um.undoStack.length);  // 1 (merged)
um.undo();
console.log('After UNDO yMap.has(a1):', yMap.has('a1'));  // false (BOTH steps reverted)
```

**Why this is NOT a Plan 29-02 issue:**

- Plan 29-02 ships the bridge module (`crdtAnnotationBridge.js`). The bridge's `applyFabricCommit` and `applyFabricDelete` correctly produce one `ydoc.transact()` call each with the passed-in origin reference. That's the bridge's entire contract per the plan.
- The plan explicitly states: "Plan 29-02 does NOT import from `crdtUndoManager.js` (would create circular dep risk)." The bridge has no awareness of the undo manager.
- The plan also states: "If any test fails, the failure is a contract bug in the bridge code from Task 1 — fix it in `src/lib/collab/crdtAnnotationBridge.js` (do NOT modify the test)." The bridge contract is satisfied — the failure is in the joint Plan 29-02 + Plan 29-03 surface, not the bridge's per-test contracts.
- The other 12 tests directly targeting the bridge (echoLoopGuard, concurrentSameAnno, concurrentDifferentAnnos, identityContract, midDragCancel, tombstoneAuthorPreservation) all pass — confirming the bridge's contract is intact.

**Why this is a Plan 29-03 / test design issue:**

Plan 29-03's `createUndoManager` sets `captureTimeout: 500` as the default (matching Yjs's documented default). The two failing test files were written assuming CREATE and DELETE would land as **separate** undo stack items so that `undo()` of the delete leaves the create on the stack. They do not call `undoManager.stopCapturing()` between operations and they do not pass `captureTimeout: 0`.

Other Plan 29-03 tests (`eraserSwipeUndo`, `perWordUndo`, `undoLocalScope`, `redoLocalScope`, `undoTwoUserIsolation`) handle this correctly:

- `eraserSwipeUndo.test.mjs:78` passes `captureTimeout: 0`
- `eraserSwipeUndo.test.mjs:51, :85, :91` calls `undoManager.stopCapturing()` between groups
- `perWordUndo.test.mjs:70` calls `undoManager.stopCapturing()` between word boundaries

The two failing test files appear to have missed this pattern.

**Resolution paths (any one of these closes this item):**

1. **Test fix:** Add `undoManager.stopCapturing()` between `applyFabricCommit` and `applyFabricDelete` in both `undoTombstoneResurrection.test.mjs` and `resurrectRace.test.mjs`. This is the most surgical fix — matches the existing pattern in `eraserSwipeUndo.test.mjs` and `perWordUndo.test.mjs`. **But Plan 29-02 is forbidden from modifying test files.**
2. **Plan 29-03 amendment:** Have `createUndoManager` accept a `captureTimeout` argument with a different default for delete operations, or expose a `commitDelete` boundary that auto-calls `stopCapturing`. This is a Plan 29-03 architectural change.
3. **Plan 29-05 wiring (most likely correct landing):** When `FabricEditCanvas` (Plan 29-05) wires the bridge into the actual delete handler, it can call `undoManager.stopCapturing()` immediately before `applyFabricDelete` to enforce the create-vs-delete boundary at the production call site. This is consistent with the rest of Plan 29-05's `stopCapturing` discipline (text whitespace, eraser swipe end, etc.).

**Recommendation:** Land Plan 29-02 as-is; flag this for Plan 29-05 to address when it wires the production delete handler. The 12 bridge-contract tests pass, which is the actual Plan 29-02 success criterion. The 3 failing tests will naturally flip green once Plan 29-05 (or a small Plan 29-03 amendment / test fix) lands the explicit `stopCapturing` boundary.

**Date logged:** 2026-04-28
**Surfaced by:** Plan 29-02 (executor session)
**Owner:** Plan 29-05 (or Plan 29-03 amendment / test fix in a separate plan)
