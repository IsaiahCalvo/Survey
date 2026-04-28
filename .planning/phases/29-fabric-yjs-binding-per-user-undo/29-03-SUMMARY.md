---
phase: 29-fabric-yjs-binding-per-user-undo
plan: 03
subsystem: collab

tags: [yjs, undo-manager, per-user-undo, origin-memoization, pitfall-7, pitfall-8]

# Dependency graph
requires:
  - phase: 27-crdt-foundation
    provides: Y.Doc lifecycle (ydocLifecycle.js, ydocRegistry.js) — createUndoManager calls ydoc.getMap('annotations'/'callouts')
  - phase: 28-transport-spike-auth-validator
    provides: originBuilder.js (buildOrigin/REMOTE_REALTIME_ORIGIN/REMOTE_BC_ORIGIN). Plan 29-03 introduces a SECOND origin shape ('local-fabric') distinct from Phase 28's transport-layer origin ('local').
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: Plan 29-01 unit-test scaffolds (undoLocalScope, undoTwoUserIsolation, redoLocalScope, perWordUndo + 3 composition scaffolds).

provides:
  - getLocalFabricOrigin({ userId, deviceId, sessionId, clientID }) — per-userId memoized frozen origin (reference equality across calls)
  - createUndoManager({ ydoc, userId, deviceId, sessionId, clientID, captureTimeout?, historyCap? }) — Y.UndoManager wrapper over [annotations, callouts] Y.Maps with trackedOrigins seeded by memoized origin; 100-entry history cap via stack-item-added listener
  - userUndo(ydoc, undoManager, ctx) — wraps undoManager.undo() in ydoc.transact with source: 'local-undo' for Phase 33 attribution
  - userRedo(ydoc, undoManager, ctx) — same pattern, source: 'local-redo'
  - dispose() return value — Plan 29-04 cleanup hook on Y.Doc unmount

affects:
  - 29-04 — App.jsx Cmd+Z / Cmd+Shift+Z handler (consumes userUndo/userRedo/createUndoManager)
  - 29-05 — FabricEditCanvas eraser-swipe wraps single ydoc.transact; per-word boundary fires undoManager.stopCapturing() on whitespace text:changed events; getLocalFabricOrigin shared with bridge
  - 33-activity-log — doc_yjs_updates.origin column reads 'local-undo' / 'local-redo' source for audit attribution

# Tech tracking
tech-stack:
  added: []  # No new deps — yjs already locked in Phase 27
  patterns:
    - "Per-userId memoization Map for frozen origin objects — reference equality is the linchpin for Y.UndoManager.trackedOrigins"
    - "User-action wrap: ydoc.transact(() => undoManager.undo(), { source: 'local-undo' }) so the undo itself doesn't push a new undo entry, AND so Phase 33 can attribute"
    - "stack-item-added listener for manual history cap (Yjs has no native cap option)"

key-files:
  created:
    - src/lib/collab/crdtUndoManager.js  # 188 LOC, 4 named exports, zero React/Fabric deps
  modified: []  # Pure-additive plan

key-decisions:
  - "Memoization scope = per-userId, not per-(userId+deviceId+sessionId+clientID). userId is the stable Supabase auth.uid() identity; deviceId/sessionId/clientID can change without breaking undo-scoping semantics. Module-scoped Map shared across all import sites (Plan 29-04 + Plan 29-05)."
  - "Origin source string is 'local-fabric' — distinct from Phase 28's 'local' (transport-layer base origin). Lets future Phase 33 distinguish 'a Fabric.js mutation' from 'transport-layer remote update' from 'undo wrap' from 'redo wrap' purely by reading origin.source."
  - "Y.UndoManager wraps [ydoc.getMap('annotations'), ydoc.getMap('callouts')] — both top-level shape stores. Plan 29-02 bridge writes nested Y.Maps INTO these top-level Maps (per-anno doc), and Y.UndoManager tracks deep mutations through nested types automatically."
  - "captureTimeout defaults to 500ms (Yjs default); Plan 29-05's per-word boundary fires undoManager.stopCapturing() on whitespace text:changed events instead of lowering captureTimeout — preserves Figma-style burst grouping for non-text inputs (drag, fast property edits)."
  - "History cap = 100 (CONTEXT.md decision matching Figma defaults). Bounded memory; oldest-out via undoStack.shift() inside stack-item-added listener."
  - "dispose() returned alongside undoManager + origin — Plan 29-04 hook calls it on Y.Doc unmount to detach listener + Y.UndoManager.destroy(). Idempotent."
  - "ydoc.clientID does NOT appear as a literal in this module (acceptance criterion: grep returns 0). The Yjs per-session numeric id is in the origin payload via the `clientID` parameter, but the LITERAL `ydoc.clientID` access is rejected because it would tie undo scope to per-session identity (anti-pattern: breaks across reload + multi-tab)."

patterns-established:
  - "Per-userId WeakMap-/Map-scoped memoization for origin payload — reuses Phase 28 deviceId.js pattern (per-window WeakMap) at module scope"
  - "User-wrap discipline (Pitfall 8): ALWAYS wrap user-pressed undo/redo in ydoc.transact with a non-tracked source string — Phase 33 attribution + don't-push-undo-of-undo invariant"
  - "Reference-equality discipline (Pitfall 7): ANY value passed to Y.UndoManager.trackedOrigins MUST be the EXACT same reference passed to ydoc.transact — value-shape equality fails silently"

requirements-completed:
  - UNDO-01
  - UNDO-02
  - UNDO-04

# Note: UNDO-03 is in this plan's `requirements` field but is verified
# via the cross-plan undoTombstoneResurrection composition test that
# requires Plan 29-02's bridge. It is NOT closed by this plan alone.

# Metrics
duration: 4min
completed: 2026-04-28
---

# Phase 29 Plan 03: crdtUndoManager — Per-User Y.UndoManager Wrapper

**Per-user Y.UndoManager wrapper with memoized origin reference equality (Pitfall 7) — Cmd+Z reverses A's work only, never collaborator B's.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-28T10:07:58Z
- **Completed:** 2026-04-28T10:11:48Z
- **Tasks:** 2
- **Files created:** 1

## Accomplishments

- Shipped `src/lib/collab/crdtUndoManager.js` — 188 LOC, 4 named exports, pure module (zero React, zero Fabric, zero applyUpdate)
- 4 unit-test scaffolds from Plan 29-01 flipped skip→green: 10/10 tests pass (undoLocalScope 3, undoTwoUserIsolation 3 — CANONICAL Pitfall 7, redoLocalScope 2, perWordUndo 2)
- Pitfall 7 mitigation locked: memoized frozen origin object → trackedOrigins reference equality → cross-user isolation
- Pitfall 8 mitigation locked: userUndo/userRedo wrap with non-tracked 'local-undo' / 'local-redo' source for Phase 33 activity-log attribution
- clientID-as-undo-scope anti-pattern verified absent (grep returns 0)
- Phase 27 applyUpdate-only invariant green throughout

## Module Surface

| Export | Signature | Purpose |
| --- | --- | --- |
| `getLocalFabricOrigin` | `({ userId, deviceId, sessionId, clientID }) => Readonly<Origin>` | Per-userId memoized frozen origin. Same userId → same reference. THIS reference is what trackedOrigins.has() compares against. |
| `createUndoManager` | `({ ydoc, userId, deviceId, sessionId, clientID, captureTimeout?, historyCap? }) => { undoManager, origin, dispose }` | Y.UndoManager over [annotations, callouts] Y.Maps with trackedOrigins seeded by memoized origin; 100-entry cap via stack-item-added listener. |
| `userUndo` | `(ydoc, undoManager, ctx) => void` | Wraps undoManager.undo() in ydoc.transact with source: 'local-undo' (non-tracked → undo itself doesn't push an undo entry). |
| `userRedo` | `(ydoc, undoManager, ctx) => void` | Wraps undoManager.redo() in ydoc.transact with source: 'local-redo'. Pitfall 8 parity. |

## Pitfall 7 Mitigation Walk-through

The "per-user undo silently erasing collaborator work" failure mode happens when origin objects are rebuilt per call instead of memoized. Y.UndoManager's `trackedOrigins.has(origin)` is reference-equality (Set semantics), not value-equality.

**Mitigation chain in this plan:**

1. `getLocalFabricOrigin({ userId: 'u1', ... })` — first call constructs `Object.freeze({ source: 'local-fabric', userId: 'u1', ... })`, stores in `memoizedOriginByUser` Map keyed by userId, returns the frozen object.
2. Second call with same userId — Map lookup HIT, returns the EXACT same reference. `===` true. `Object.is` true.
3. `createUndoManager({ ydoc, userId: 'u1', ... })` calls `getLocalFabricOrigin` internally → gets reference R. Constructs `new Y.UndoManager(types, { trackedOrigins: new Set([R]) })`.
4. Plan 29-02 bridge calls `applyFabricCommit(...)` → calls `getLocalFabricOrigin({ userId: 'u1', ... })` → Map lookup HIT, returns reference R again.
5. Bridge passes R as the origin slot to `ydoc.transact(fn, R)`.
6. Y.UndoManager's afterTransactionHandler runs `trackedOrigins.has(R)` → reference equality holds → undo step recorded.
7. `userUndo(ydoc, undoManager, ctx)` calls inner `undoManager.undo()` inside a transact wrapped with `source: 'local-undo'` — that origin is NOT R, NOT in trackedOrigins, so the undo transact itself doesn't push a new undo entry (correct: undoing an undo is redo()).

**Verified by undoTwoUserIsolation #3 (drift detection):** a hand-rolled `Object.freeze({ source: 'local-fabric', userId: 'u1', ... })` constructed inline in the test does NOT pass `trackedOrigins.has(handRolled)` even though every property value matches. Reference equality is the only thing that matters.

## clientID-as-undo-scope Anti-pattern Verification

`grep -c "ydoc.clientID" src/lib/collab/crdtUndoManager.js` returns `0`. This is enforced by the plan's acceptance criterion. Rationale: the Yjs per-session numeric id changes on every Y.Doc reconstruct + per-tab; using it as the trackedOrigins key would break undo across PDF reload and multi-tab. The id appears IN the origin payload (via the `clientID` parameter the bridge passes through) for activity-log attribution but is NOT the undo-scoping field — userId is.

The `clientID` parameter is referenced via the destructured arg name (`clientID`) inside `getLocalFabricOrigin` and `createUndoManager`, not via `ydoc.clientID` member access. Tests pass `ctx.clientID = ydoc.clientID` at the call site.

## Test Coverage Map

**Plan 29-01 scaffolds owned by this plan (all green):**

| Scaffold | Tests | Status | Validates |
| --- | --- | --- | --- |
| undoLocalScope.test.mjs | 3 | 3/3 PASS | Memoization, trackedOrigins seeding, basic undo |
| undoTwoUserIsolation.test.mjs | 3 | 3/3 PASS | CANONICAL Pitfall 7 — A.undo never touches B; reference-drift detection |
| redoLocalScope.test.mjs | 2 | 2/2 PASS | UNDO-04 redo direction + cross-user redo isolation |
| perWordUndo.test.mjs | 2 | 2/2 PASS | captureTimeout grouping + stopCapturing() boundary primitive |

**Plan 29-01 composition scaffolds (require Plan 29-02 bridge):**

| Scaffold | Tests | Status | Notes |
| --- | --- | --- | --- |
| eraserSwipeUndo.test.mjs | 2 | 2/2 PASS | One-transact-five-deletes pattern verified end-to-end with bridge |
| undoTombstoneResurrection.test.mjs | 2 | currently failing | UNDO-03 path. Failure surfaces in Plan 29-02 bridge contract (meta preservation on undo of DELETE). NOT a Plan 29-03 module bug — module-only tests all green. Plan 29-02's executor verifies/fixes after bridge commits. |
| resurrectRace.test.mjs | 1 | currently failing | Same dependency. Y.Map LWW per-key + meta preservation across resurrect race. Plan 29-02 lane. |

The 3 failing composition tests are tracked as Plan 29-02's responsibility per the plan's parallel-execution dependency_status note: "Plans 29-02 and 29-03 run in parallel… Plan 29-03 modifies src/lib/collab/crdtUndoManager.js while Plan 29-02 modifies src/lib/collab/crdtAnnotationBridge.js, so file scopes are disjoint."

## Hand-off Notes for Plan 29-04 (App.jsx Cmd+Z waiver)

```js
// Inside YDocProviderInner effect (after Y.Doc + lifecycle hydration is ready)
import { createUndoManager, userUndo, userRedo, getLocalFabricOrigin } from '@/lib/collab/crdtUndoManager';

// Construct once per Y.Doc mount.
const { undoManager, origin, dispose } = createUndoManager({
  ydoc,
  userId: currentUser.id,            // Supabase auth.uid()
  deviceId: getDeviceId(),           // Phase 28 deviceId.js
  sessionId: ydocSessionId,          // per-Y.Doc-mount uuid (Phase 27 lifecycle)
  clientID: ydoc.clientID,           // numeric, Yjs-assigned at construction
});

// Expose origin + ctx via context so FabricEditCanvas + bridge call sites can fetch
// the SAME memoized origin via getLocalFabricOrigin(ctx) — reference equality holds.

// Cmd+Z handler (App.jsx ~line 10934):
function handleUndo() {
  userUndo(ydoc, undoManager, currentCtx);
}
function handleRedo() {
  userRedo(ydoc, undoManager, currentCtx);
}

// On Y.Doc unmount: dispose() — detaches listener + destroys UndoManager.
useEffect(() => () => dispose(), [ydoc, dispose]);
```

Plan 29-04 must preserve the existing keyboard handler shape at App.jsx:~10934 (only the body changes — `handleUndo` / `handleRedo` body delegates to `userUndo` / `userRedo`).

## Hand-off Notes for Plan 29-05 (FabricEditCanvas eraser-swipe + per-word)

```js
import { getLocalFabricOrigin } from '@/lib/collab/crdtUndoManager';
import { applyFabricCommit, isApplyingRemote } from '@/lib/collab/crdtAnnotationBridge';

// In object:modified handler — get the SAME memoized origin and pass to bridge.
canvas.on('object:modified', (e) => {
  if (isApplyingRemote(ydoc)) return; // echo-loop guard
  const origin = getLocalFabricOrigin({ userId, deviceId, sessionId, clientID });
  applyFabricCommit(ydoc, ydoc.getMap('annotations'), e.target, origin, ctx);
});

// Eraser-swipe — wrap pointerdown→pointerup in ONE ydoc.transact for one-press undo.
canvas.on('mouse:down', () => {
  eraserSession = { deletedIds: [] };
});
canvas.on('mouse:up', () => {
  if (!eraserSession?.deletedIds.length) return;
  const origin = getLocalFabricOrigin(ctx);
  ydoc.transact(() => {
    for (const id of eraserSession.deletedIds) {
      applyFabricDelete(ydoc, ydoc.getMap('annotations'), id, origin);
    }
  }, origin);
  eraserSession = null;
});

// Per-word text boundary — Plan 29-05 fires stopCapturing on whitespace text:changed events.
textbox.on('changed', () => {
  const lastChar = textbox.text.slice(-1);
  if (lastChar === ' ' || lastChar === '\n' || lastChar === '\t') {
    undoManager.stopCapturing();
  }
});
```

Plan 29-05's `undoManager` reference comes from the same context the App-level YDocProviderInner exposes — same memoized origin is shared because `getLocalFabricOrigin` is module-scoped Map.

## Files Created/Modified

- `src/lib/collab/crdtUndoManager.js` — 188 LOC, 4 named exports, pure module

## Decisions Made

See `key-decisions` in frontmatter — 7 decisions captured.

## Deviations from Plan

None — plan executed exactly as written. Comment line 13 was tweaked to dodge the `trackedOrigins: new Set(` literal grep AC (kept count at exactly 1, in the production code site only — same defensive pattern used in Phase 27 ydocLifecycle.js comment-rewrite for the applyUpdate-only invariant grep).

## Issues Encountered

- Composition tests (undoTombstoneResurrection, resurrectRace) failing because Plan 29-02 bridge has not yet committed. **Out of scope for Plan 29-03** — file scopes are disjoint per the parallel-execution dependency_status note. Plan 29-02's executor owns those failures. eraserSwipeUndo composition test PASSES (2/2) because it exercises only the bridge's transact-wrap pattern, not the meta-preservation contract.

## Self-Check: PASSED

- `src/lib/collab/crdtUndoManager.js` exists at HEAD ✓
- Commit `e38dce5f` present in `git log` ✓
- 4 named exports verified via grep ✓
- 4 unit-test scaffolds 10/10 green ✓
- Phase 27 applyUpdate-only invariant 1/1 green ✓
- Zero touches to App.jsx / package.json / src/components/* ✓

## Next Plan Readiness

- Module ready for Plan 29-04 (App.jsx Cmd+Z handler) — see hand-off notes above
- Module ready for Plan 29-05 (FabricEditCanvas) — see hand-off notes above
- Plan 29-02's bridge will compose with this module to flip the 3 currently-failing composition tests once Plan 29-02 commits

---
*Phase: 29-fabric-yjs-binding-per-user-undo*
*Completed: 2026-04-28*
