---
phase: 31
phase_name: migration-cutover-seal
status: DONE
written: 2026-05-13 19:35
plans_executed: 5/5
verification: passed (7/7 acceptance criteria — see 31-VERIFICATION.md)
---

# Phase 31 Reconciliation

## Plan vs Actual

**Planned:** 5 plans (lean variant pre-approved 2026-04-30) decomposing
the kill-switch + per-doc backfill + ID-at-creation stamping + Y.Doc
hydrate flip. 31-01 Wave 0 test scaffolds + 31-02 featureFlags + counter
UUID stamps + Supabase `cutover_completed_at` column + 31-03 legacy
kill-switch gates + 31-04 cutover-aware backfill writes + hydrate branch +
31-05 phase-close gate + UAT runbook.

**Actual:** 5 plans shipped on 2026-05-01 between 23:26 and 00:19 — total
phase execution time roughly 50 minutes from first plan write to UAT
checkpoint pause. Functional UAT confirmed end-to-end the same evening on
SE-011 (512 rows) and Package 2 (21K rows). Eight follow-up hotfix commits
landed 2026-05-01 → 2026-05-04 addressing real-world UAT edge cases
(degeneracy probe + recovery floor, stale-cache shrink suppressor, dedupe
tolerance, page-ordered paginated backfill, hydrate-time degeneracy guard,
visibility fix for imported strokes, bulletproof Cmd+Shift+L log).

**Deltas:**
- Phase 31 was intended to close out the same day Plan 31-05 landed. It
  did not. The 2026-05-01 UAT surfaced four real bugs (stale cache
  shrink cascade, recovery floor, dedupe tolerance, hydrate degeneracy)
  that required eight follow-up commits between 31-05 close and the
  formal verification + reconciliation paperwork. The contract was
  preserved throughout; the seal needed reinforcement.
- 2026-05-04 a separate user-reported regression chain hit (cursor
  zoom, delete banner, duplicate jagged strokes). Triage discovered
  the keyboard undo had been silently broken because freshly-drawn
  strokes never registered with the per-user Y.UndoManager — origin
  payload mismatch between the cloud-sync save path and the undo
  manager's trackedOrigins Set. Initial fix (memoized origin) was
  partial; the user opened a parallel ChatGPT session to drive the
  full rebuild.
- 2026-05-13 a large annotation-lifecycle + collaboration-sync
  stabilization commit (`681d90a9`) landed via the ChatGPT session.
  Net +3,760 / -245 in App.jsx, +1,420 / -127 in useAnnotationCloudSync,
  +176 in crdtUndoManager, +154 in crdtAnnotationBridge, +397 in
  SVGAnnotationLayer, +234 in FabricEraserCanvas, +352 in
  FabricDrawingCanvas. The rewrite introduced a three-lane undo system
  (local annotation history → legacy checkpoint history → Yjs/CRDT
  undo manager), tightened the cloud sync fan-out wiring, and added
  two new contract-test runners under scripts/ (fix19 auth + fix20
  multi-user collab). 2026-05-13 verification log captured undo
  working end-to-end with the Phase 31 cutover contract intact.

## Acceptance Criteria Results

CONTEXT.md had 7 Given/When/Then bullets. All 7 verified at the data +
behavior layer with both the 2026-05-01 functional UAT and the
2026-05-13 post-stabilize log capture confirming the contract is intact
(full evidence table in 31-VERIFICATION.md).

**PASSED — 7 criteria:**
- [x] AC-1 500+ row doc post-cutover open: renders < 3s, flag set, Y.Doc populated.
- [x] AC-2 Cutover doc + new annotation: round-trip < 1s, zero legacy inserts, Y.Map updated < 200ms.
- [x] AC-3 Cutover doc + delete: gone < 200ms, Y.Map updated, zero legacy DELETEs.
- [x] AC-4 Post-cutover annotation carries stable UUID `data.id` matching Y.Map key.
- [x] AC-5 Kill switch OFF → zero `upsertAnnotationsByPage` calls in the live log capture.
- [x] AC-6 Sync failure + reconnect → CRDT queue flushes; no legacy fallback.
- [x] AC-7 Offline reload preserves edits (IndexedDB + on-reconnect; Phase 27 contract).

**No DEFERRED, no FAILED criteria.**

## Boundaries Honored

DO NOT CHANGE list — outcome by file:

- **PageAnnotationLayer.jsx** — untouched throughout Phase 31 cutover work
  and through the 2026-05-13 rewrite. ✓
- **SVGAnnotationLayer.jsx** — modified in the 2026-05-13 stabilize
  commit as part of the broader annotation-lifecycle rewrite (NOT
  Phase 31 cutover scope). SVG viewBox still owns zoom; no JS zoom
  coordination reintroduced. Flagged for transparency; treated as
  Phase 35 / sync-rebuild lane work.
- **FabricDrawingCanvas / FabricEraserCanvas / FabricEditCanvas** —
  modified in the 2026-05-13 stabilize commit (NOT Phase 31 scope).
  `zoomGeneration` signal contract preserved across all three.
- **App.jsx** — Phase 31 narrow waiver exercised for counter overlay
  UUID stamping (the standing waiver per CONTEXT.md). The 2026-05-13
  stabilize commit then added the three-lane undo system, which extended
  App.jsx well beyond the original Phase 31 scope; that lane is the
  broader sync-rebuild work, accepted under the standing protected-files
  waiver (`memory/feedback_protected_files_waiver.md`).
- **package.json / vite.config.js** — untouched. ✓

**Verdict:** Phase-31-scoped boundary audit GREEN. The off-phase
modifications to SVG / Fabric* / App.jsx all landed in the 2026-05-13
stabilize commit, which is the broader sync-rebuild lane and is covered
by the standing waiver — not a Phase 31 boundary violation.

## Lessons / Carry-forward

**Lessons:**
- Cutover seals need a recovery floor. The first 2026-05-04 hotfix added
  a hard `yMapSize < 50` recovery floor on cutover-sealed docs because
  the dedupe pass kept legitimately recording a wiped Y.Map's tiny size
  as the new "last good" anchor, locking the user out of recovery
  forever. The fix: always-run idempotent dedupe + monotonically-growing
  high-water-mark anchor + hard floor on sealed docs.
- Stale-cache shrink cascades are the silent killer of cutover seals.
  When the screen state briefly drops below the cloud copy's size
  (because of a hydrate race or transient state), the diff-push cascade
  would issue thousands of deletes against rows that are still valid.
  Fix landed 2026-05-04: shrink suppressor on cutover-sealed docs +
  re-materialize state from Y.Map after suppress, so the user sees the
  real count instead of staring at the stale local view.
- Per-user undo only works if the cloud-sync save path uses the SAME
  memoized origin object the undo manager's trackedOrigins Set is
  watching for. The May 7 partial fix swapped the origin builder but
  didn't go deep enough; the full 2026-05-13 rewrite added a
  three-lane fallback so local edits get tracked even when the Yjs
  manager hasn't initialized yet.
- A 1-pixel quantize is too tight for dedupe. Pre-cutover sync chaos
  produced re-imports whose strokes were offset by 2–8 pixels with
  jagged path encodings; an exact-match signature kept both. The
  2026-05-04 fix moved to an IoU (intersection-over-union) overlap
  metric with a 0.6 threshold, which catches the "smooth + jagged
  duplicate" case without false-positiving freehand work.

**Carry-forward (do NOT block phase close — owner-tagged):**
- Phase 31 Playwright e2e specs un-fixme — `tests/e2e/phase31-*.spec.mjs`
  contracts still `test.fixme`'d at Plan 31-05 close. Plan 31-05 noted
  they could un-fixme once Plan 30-06's seams stabilized; that work was
  never closed out. Track in Phase 32 plan.
- The four 2026-05-04 hotfixes (degeneracy probe, stale-cache shrink
  suppressor, dedupe IoU, page-ordered paginated backfill) should be
  audited for unit-test coverage in Phase 32 — they all shipped as
  reactive fixes without dedicated tests.
- Inline `[Phase31 diag]` console logs across the three cutover files
  (~9 lines per the 2026-05-01 handoff) — should be stripped or gated
  behind a `__DIAG_*` flag now that the cutover is sealed. Track in
  Phase 32 cleanup pass.

**Phase 32 / 33 / 34 deferred per CONTEXT.md:**
- Phase 32 — periodic Y.Doc compaction, BroadcastChannel cross-tab
  sync, two-tab Playwright stress, QuarantineMarkerOverlay per-annotation
  bbox feed, right-click context-menu remote-delete cancel.
- Phase 33 — activity log + properties panel UI surfaces (the
  `cutover_completed_at` data path is ready to surface).
- Phase 34 — decommission of dormant legacy bulk-upsert code once
  several weeks of zero kill-switch flips are observed.

## Status: DONE

Phase 31 contract is met. All 7 acceptance criteria verified at the data
+ behavior layer (2026-05-01 functional UAT on SE-011 + Package 2;
2026-05-13 post-rewrite log capture). Test baseline IMPROVED from
429p / 8f / 6s at Plan 31-05 close to 640p / 0f / 6s after the 2026-05-13
stabilize commit. Boundary audit GREEN for Phase-31-scoped surfaces; the
off-phase SVG / Fabric* / App.jsx modifications all rode the broader
sync-rebuild lane under the standing protected-files waiver.

Phase 32 unblocked.

_Reconciliation written: 2026-05-13 19:35_
_Verifier report: 31-VERIFICATION.md (passed, 7/7)_
