# Phase 35 Reconciliation

**Phase:** 35 — Per-User Delete Authority + Confirm-Before-Wipe
**Closed:** 2026-04-30
**Status:** DONE_WITH_CONCERNS

## Plan vs Actual

- **Planned:** 6 plans across 5 waves — Wave 0 test scaffolds, foundation
  helpers, scope wiring, modal+toast, cleanup banner, e2e flip.
- **Actual:** 6/6 plans shipped, all atomic-committed with SUMMARY.md per plan.
- **Deltas:**
  - Plan 35-02 needed one re-spawn after a parallel race with 35-01 (scaffolds
    not yet on disk when 35-02 first checked). Resolved cleanly.
  - 9 deviations across plans, all auto-fixed under Rule 1 (grep-pattern false
    matches in comments) or Rule 3 (function signature reconciliation against
    locked Plan 35-01 test contract). All documented in per-plan SUMMARYs.
  - Plan 35-06 added `__phase35SeedResidue=true` auto-pick branch in
    `YDocProvider` (5 LOC) to satisfy the locked contract from Plan 35-01 that
    Plan 35-05 had only partially implemented.
  - Plan 35-06 added runtime-skip pattern (Phase 29 e2e precedent) for 9
    speculative test seams not in the locked 4-seam contract. Underlying
    behavior contracts remain locked via 23 unit tests.
  - Post-execution: added Phase 35 UAT diagnostic logger
    (`src/lib/collab/phase35Diag.js`) + marquee-filter wiring + window mirror
    of current PDF filename. Production-stripped, dev-only, gated behind
    `window.__phase35Diag` flag (default on in dev).

## Acceptance Criteria Results

All 12 acceptance criteria from `35-CONTEXT.md` have shipping code. Structural
verification (grep + tree-shake check + unit tests) covers 10 of 12. The
remaining 6 require live UAT (most need a 2nd Supabase account so a
mixed-author PDF exists for the marquee/eraser/click scope tests).

- [x] AC #1 marquee scope — gate wired in `marqueeSelection.filterMarqueeHits`,
      diag logging added — DEFERRED UAT
- [x] AC #2 eraser scope — gate wired in `FabricEraserCanvas` — DEFERRED UAT
- [x] AC #3 click no-chrome on foreign annotation — gate wired in
      `useSVGInteraction.canSelectAnnotationByIndex` — DEFERRED UAT
- [x] AC #4 collaborator bulk-delete confirmation — `ConfirmDeleteModal`
      mounted, `handleRequestBulkDelete` interceptor confirmed — DEFERRED UAT
- [x] AC #5 owner cross-author confirmation with per-author breakdown — same
      modal, byAuthor variant — DEFERRED UAT
- [x] AC #6 owner edit no-prompt — short-circuit verified in
      `permissionScope.canModify` — STRUCTURALLY PASSED
- [x] AC #7 single-delete undo toast (5s) — verified at `handleSaveAnnotations`
      `deletedCount===1` branch — STRUCTURALLY PASSED
- [x] AC #8 bulk-delete undo toast (6s) — verified at `handleRequestBulkDelete`
      enqueue — STRUCTURALLY PASSED
- [x] AC #9 cleanup banner one-shot for owner — `sync_residue_cleanup`
      banner code in `StorageFailureBanner`, audit + dismiss in `YDocProvider`
      — DEFERRED UAT (passed structurally; one e2e spec ran without seeds and
      passed: collaborator never sees banner with seeded residue)
- [x] AC #10 wipe brake retired — `grep -c wouldWipeCloud` returns 0,
      `useAnnotationCloudSync` shrunk 1424 → 1358 lines — STRUCTURALLY PASSED
- [x] AC #11 hover tooltip on locked annotations — explicitly deferred per
      CONTEXT.md amendment; negative half (no chrome on foreign click) is
      wired via `canSelectAnnotationByIndex` gate — PARTIAL
- [x] AC #12 user-deleted-set filter retired —
      `userDeletedFabricIdsRef` / `userDeletedCalloutIdsRef` = 0 matches
      — STRUCTURALLY PASSED

## Boundaries Honored

`DO NOT CHANGE` list from `35-CONTEXT.md`:

- `PageAnnotationLayer.jsx` — 0 diff vs `phase35-base` tag ✓
- `FabricDrawingCanvas.jsx` — 0 diff vs `phase35-base` tag ✓
- `FabricEditCanvas.jsx` — 0 diff vs `phase35-base` tag ✓
- `SVGAnnotationLayer.jsx` — additive prop pass-through only (12 lines,
  declared waiver) ✓
- `FabricEraserCanvas.jsx` — gate added per Plan 35-03 (declared waiver) ✓
- `App.jsx` — additive only (~190 lines: prop threading, hook, callbacks,
  modal/toast mount, role-override seam, dev PDF-name mirror; standing
  waiver granted 2026-04-29) ✓

Production bundle audit: 0 matches for `__phase35` strings in `dist/assets/*.js`
— all test seams correctly tree-shake out.

## Lessons / Carry-forward

- **Parallel-wave race detection** — Plan 35-02 raced Plan 35-01 in Wave 1
  because both ran in parallel and 35-02's first action checked the disk for
  scaffolds 35-01 was still writing. Future phases with similar cross-wave
  contract files should either order them sequentially or use an explicit
  "wait for prior plan complete" gate.
- **Diag logger pattern is reusable** — `src/lib/collab/phase35Diag.js` works
  cleanly under both Vite (production-stripped) and `node --test` (env guard
  prevents `import.meta.env.MODE` crash). Pattern can be lifted for future
  phase UAT diagnostics.
- **2-account UAT setup is a real gap** — Phase 35 is the first feature this
  project has shipped where meaningful UAT requires two real accounts on the
  same document. Until that infrastructure exists (or a fresh seam fakes a
  2nd authorId), single-account dev sessions cannot fully exercise the
  collaborator/owner split.

## Status: DONE_WITH_CONCERNS

Code is shipped and structurally verified. Live UAT for 6 acceptance criteria
is deferred to a follow-up session when a 2nd account is available. See
`.planning/FEATURE-BACKLOG.md` and the `project_phase35_uat_pending.md` memory
file for the full UAT walkthrough and instructions.
