---
phase: 35-per-user-delete-authority-confirm-before-wipe
plan: 01
subsystem: testing
tags: [node-test, playwright, fixme, scaffolds, permission-model, undo-toast, residue-audit]

# Dependency graph
requires:
  - phase: 27-29
    provides: per-test existsSync skip-guard pattern for Wave 0 unit scaffolds + test.describe.fixme convention for e2e specs that document UAT contracts inline
  - phase: 28
    provides: author identity wiring (originBuilder.js userId / authorId on every annotation) consumed by permissionScope helper in Plan 35-02
provides:
  - 4 unit test scaffolds locking the Plan 35-02 / 35-04 / 35-05 production-module contracts
  - 7 Playwright e2e specs (test.describe.fixme) documenting full UAT flow inline for Plan 35-06 to flip green
  - Locked enqueue signature for the undo toast queue — `{ kind, message, count?, onUndo }` — visible in 15 distinct test sites
  - Locked test seam contract — `window.__phase35TestRoleOverride`, `window.__phase35SeedResidue`, `window.__selectedAnnotationIds`, `window.__phase35GetAnnotationById`, `window.__phase35Seed*`, `window.__phase35SelectTool` — referenced verbatim by every downstream plan
affects: [35-02, 35-03, 35-04, 35-05, 35-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-test existsSync skip-guard reused verbatim from Phase 27/28/29 — `{ skip: !existsSync(TARGET) ? '... not yet present (Plan NN-NN)' : false }`. Each unit test inlines its own guard so the file auto-flips from skipped → green the moment its production module lands."
    - "test.describe.fixme wrapper for e2e specs whose bodies document the full UAT flow inline. Plan 35-06 unwraps in one diff."
    - "pathToFileURL(TARGET).href dynamic import inside each test body so module resolution does not crash before the production module exists (Node ESM requirement)."

key-files:
  created:
    - tests/phase35/permissionScope.test.mjs
    - tests/phase35/buildBulkDeletePlan.test.mjs
    - tests/phase35/undoToastQueue.test.mjs
    - tests/phase35/cleanupResidueAudit.test.mjs
    - tests/phase35-e2e/collaborator-marquee-scope.spec.mjs
    - tests/phase35-e2e/collaborator-eraser-scope.spec.mjs
    - tests/phase35-e2e/collaborator-bulk-delete-confirm.spec.mjs
    - tests/phase35-e2e/owner-cross-author-confirm.spec.mjs
    - tests/phase35-e2e/owner-edit-no-prompt.spec.mjs
    - tests/phase35-e2e/single-delete-undo-toast.spec.mjs
    - tests/phase35-e2e/cleanup-banner-one-shot.spec.mjs
  modified: []

key-decisions:
  - "Unit test scaffolds use Node's built-in node:test runner with per-test existsSync skip-guard — same mechanic that landed cleanly across 5 Phase 27 plans, 6 Phase 28 plans, 6 Phase 29 plans."
  - "Locked enqueue signature `{ kind, message, count?, onUndo }` for undo toast queue — exposed in undoToastQueue.test.mjs across all 6 tests so Plans 35-04 / 35-06 cannot drift."
  - "Production hook contract for useUndoToast splits into two surfaces: default-export React hook (consumed by Plan 35-04 UI) + named export `createUndoToastQueue({ now, setTimeout, clearTimeout })` pure factory (consumed by tests via injected fake clock). Lets the queue be Node-runnable without a React renderer."
  - "Wedged owner-edit-no-prompt.spec.mjs into the e2e set per checker W7 — covers AC #6 directly instead of relying on 'covered by absence' reasoning. Protects the FabricEditCanvas no-branching invariant from CONTEXT.md DO NOT CHANGE."
  - "Test-seam names locked in plan frontmatter — `window.__phase35TestRoleOverride` / `window.__phase35SeedResidue` / `window.__selectedAnnotationIds` plus per-spec helpers (`__phase35SeedOwn`, `__phase35SeedForeign`, `__phase35SeedForeignAt`, `__phase35SelectTool`, `__phase35SelectAllOnPage`, `__phase35GetAnnotationById`, `__phase35SnapshotAnnotation`, `__phase35GetViewerId`, `__phase35GetAllAnnotations`, `__phase35CountAnnotations`, `__phase35SeedMixedAuthor`, `__phase35SelectAllOwnOnPage`). Plans 35-03 / 35-04 / 35-05 / 35-06 attach them at the same spelling."

patterns-established:
  - "Wave 0 unit scaffold landing pattern: TARGET = path.resolve(__dirname, '../../src/...'); TARGET_URL = pathToFileURL(TARGET).href; each test inlines `{ skip: !existsSync(TARGET) ? '... not yet present (Plan NN-NN)' : false }`. Body uses dynamic `await import(TARGET_URL)` AFTER the existsSync guard."
  - "Wave 0 e2e scaffold landing pattern: top-of-file describe block wrapped with `.fixme`. Body documents the full UAT flow inline so Plan 35-06's executor can flip the wrapper and run tests as-is. Each spec ends up with exactly 1 `test.describe.fixme(` occurrence after stripping the analog from header comments (grep contract)."
  - "Fake-clock harness for undoToastQueue tests: makeFakeClock() exposes `setTimeout / clearTimeout / advance(ms) / pendingCount()`; production hook accepts injected `setTimeout / clearTimeout / now` via `createUndoToastQueue({...})` factory so tests can advance time deterministically without real wall-clock."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-04-30
---

# Phase 35 Plan 01: Wave 0 Test Scaffolds Summary

**4 node:test unit scaffolds + 7 Playwright e2e specs (test.describe.fixme) locking the Plan 35-02 / 35-04 / 35-05 / 35-06 contracts before any src/ change ships.**

## Performance

- **Duration:** 8 min (493s)
- **Started:** 2026-04-30T16:44:48Z
- **Completed:** 2026-04-30T16:53:01Z
- **Tasks:** 2
- **Files modified:** 11 (all created, zero existing files touched)

## Accomplishments

- Locked the permission-model helper contract in `tests/phase35/permissionScope.test.mjs` — Plan 35-02 writes against `isOwner / canModify / filterByAuthor` exactly as specified.
- Locked the bulk-delete planner contract in `tests/phase35/buildBulkDeletePlan.test.mjs` — three modes (`collaborator-all-mine` / `owner-cross-author` / `owner-own-only`) + `byAuthor` breakdown structure for the owner cross-author modal.
- Locked the undo toast queue contract in `tests/phase35/undoToastQueue.test.mjs` — single (5s) vs bulk (6s) auto-dismiss windows, single-toast queue (not stack), Undo callback fired exactly once, dispose clears pending timers, default-kind = 'single'. Enqueue signature `{ kind, message, count?, onUndo }` visible in 15 sites.
- Locked the cleanup-residue audit contract in `tests/phase35/cleanupResidueAudit.test.mjs` — owner-only banner, sticky-per-document dismissal, viewer-authored + lastEditedAt-older-than-most-recent-local-delete criterion, pure (no input mutation).
- 7 e2e specs document the full UAT contract inline — every body uses `expect(...)` with locked copy regexes (modal headings, toast text, role=alert, role=dialog) so Plan 35-06's flip is mechanical.
- Test baseline preserved exactly: 393 pass / 8 fail / 29 skip (was 6 skip — 23 new Phase 35 unit scaffolds skip cleanly, no new failures).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 4 unit test scaffolds with per-test existsSync skip-guards** — `b6b7e5e4` (test)
2. **Task 2: Create 7 Playwright e2e specs as test.fixme blocks** — `fe135058` (test)

## Files Created/Modified

### Created — Unit test scaffolds (Wave 0)
- `tests/phase35/permissionScope.test.mjs` — 6 tests guarding `src/lib/collab/permissionScope.js` (Plan 35-02)
- `tests/phase35/buildBulkDeletePlan.test.mjs` — 6 tests guarding `src/lib/collab/bulkDeletePlan.js` (Plan 35-04)
- `tests/phase35/undoToastQueue.test.mjs` — 6 tests guarding `src/hooks/useUndoToast.js` (Plan 35-04)
- `tests/phase35/cleanupResidueAudit.test.mjs` — 5 tests guarding `src/lib/collab/cleanupResidueAudit.js` (Plan 35-05)

### Created — e2e specs (test.describe.fixme)
- `tests/phase35-e2e/collaborator-marquee-scope.spec.mjs` — AC: marquee respects ownership
- `tests/phase35-e2e/collaborator-eraser-scope.spec.mjs` — AC: eraser + click both no-op on foreign annotations
- `tests/phase35-e2e/collaborator-bulk-delete-confirm.spec.mjs` — AC: "Delete all N of yours" modal + 6s undo toast
- `tests/phase35-e2e/owner-cross-author-confirm.spec.mjs` — AC: per-author breakdown modal + 6s undo toast
- `tests/phase35-e2e/owner-edit-no-prompt.spec.mjs` — AC: drag/resize/rotate on foreign annotation fires no modal, no toast (NEW per checker W7 — covers AC #6 directly)
- `tests/phase35-e2e/single-delete-undo-toast.spec.mjs` — AC: 5s single-delete undo toast + Undo restores via Y.Map snapshot
- `tests/phase35-e2e/cleanup-banner-one-shot.spec.mjs` — AC: owner sees `sync_residue_cleanup` banner once per document; collaborators never see it

## Decisions Made

- **Test seam names locked in plan frontmatter.** Plans 35-03 / 35-04 / 35-05 / 35-06 read these from the e2e specs verbatim — no drift, no rename.
- **`createUndoToastQueue` named export added to the locked contract.** Production hook for Plan 35-04 must expose a non-React factory so node:test can advance time without a React renderer. Default export remains the `useUndoToast` hook for the UI.
- **Header-comment skip-guard analogs reworded after first-pass grep failure.** First attempt produced grep counts of 7/7/7/6 (header comment + 6/6/6/5 inline guards = +1) and 2 describe.fixme matches per spec (header comment + 1 actual wrapper). Rewording the comments — "inlines the skip guard" / "fixme'd describe block" — preserves intent without violating the plan's exact-count acceptance criteria. Counts now 6/6/6/5 unit + 1/1/1/1/1/1/1 e2e.
- **owner-edit-no-prompt.spec.mjs added per checker W7.** Plan 35-01 already specified the file in its frontmatter and acceptance criteria; this summary confirms it ships and explicitly maps to AC #6 (owner editing foreign annotations without confirmation). Defends the FabricEditCanvas DO NOT CHANGE invariant.

## Deviations from Plan

None - plan executed exactly as written.

The two grep-count adjustments above are not deviations — they are routine final-pass cleanup of header comments to satisfy plan acceptance criteria. Both were made BEFORE the corresponding task commit landed, so each commit reflects the final shape.

## Issues Encountered

- Initial `grep -c "skip:.*existsSync"` counts came in at N+1 (one extra per file) because each header comment referenced the pattern by name. Rewrote header comments to refer to the pattern indirectly ("inlines the skip guard"), grep counts dropped to the plan-specified 6/6/6/5. Same correction applied to e2e header comments for the `test.describe.fixme` count.
- No reference Plan 29 file exactly matched the named hint `crdtAnnotationBridge.test.mjs`; identityContract.test.mjs and echoLoopGuard.test.mjs target the bridge and were used as the per-test skip-guard reference instead. Pattern shape is identical.

## User Setup Required

None - no external service configuration required for Wave 0 scaffolds.

## Next Phase Readiness

- Plan 35-02 unblocked: `tests/phase35/permissionScope.test.mjs` defines `isOwner / canModify / filterByAuthor` contracts; landing `src/lib/collab/permissionScope.js` flips 6 tests skip → green automatically.
- Plan 35-03 unblocked: scope-filter integration into selection / eraser / marquee can rely on Plan 35-02's helper landing first; no new test contract needed for 35-03 (e2e specs `collaborator-marquee-scope.spec.mjs` and `collaborator-eraser-scope.spec.mjs` already locked).
- Plan 35-04 unblocked: `tests/phase35/buildBulkDeletePlan.test.mjs` + `tests/phase35/undoToastQueue.test.mjs` define both contracts (planner + toast queue). Locked enqueue signature carries through.
- Plan 35-05 unblocked: `tests/phase35/cleanupResidueAudit.test.mjs` defines the audit helper contract; banner copy variant lands as a new code on `src/components/collab/StorageFailureBanner.jsx` per CONTEXT.md decisions.
- Plan 35-06 unblocked: 7 e2e specs are ready to flip from `test.describe.fixme(` to `test.describe(` in one diff, plus inject the test seams (`window.__phase35TestRoleOverride` etc.) at the call sites Plans 35-03 / 35-04 / 35-05 already touched.

## Self-Check

Files created — verified present:
- `tests/phase35/permissionScope.test.mjs` — FOUND
- `tests/phase35/buildBulkDeletePlan.test.mjs` — FOUND
- `tests/phase35/undoToastQueue.test.mjs` — FOUND
- `tests/phase35/cleanupResidueAudit.test.mjs` — FOUND
- `tests/phase35-e2e/collaborator-marquee-scope.spec.mjs` — FOUND
- `tests/phase35-e2e/collaborator-eraser-scope.spec.mjs` — FOUND
- `tests/phase35-e2e/collaborator-bulk-delete-confirm.spec.mjs` — FOUND
- `tests/phase35-e2e/owner-cross-author-confirm.spec.mjs` — FOUND
- `tests/phase35-e2e/owner-edit-no-prompt.spec.mjs` — FOUND
- `tests/phase35-e2e/single-delete-undo-toast.spec.mjs` — FOUND
- `tests/phase35-e2e/cleanup-banner-one-shot.spec.mjs` — FOUND

Commits — verified present in `git log`:
- `b6b7e5e4` — FOUND
- `fe135058` — FOUND

Test runs — verified clean:
- `node --test tests/phase35/*.test.mjs` → 23 tests, 23 skipped, 0 fail
- `npm test` → 393 pass / 8 fail / 29 skip (preserves pre-Phase-35 baseline of 393 pass / 8 fail; +23 new skips = 6 + 23 = 29)

## Self-Check: PASSED

---
*Phase: 35-per-user-delete-authority-confirm-before-wipe*
*Completed: 2026-04-30*
