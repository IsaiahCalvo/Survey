---
phase: 31-migration-cutover-seal
plan: 03
subsystem: api
tags: [feature-flag, kill-switch, cloud-sync, crdt, fabric, supabase, react-hook]

# Dependency graph
requires:
  - phase: 31-migration-cutover-seal
    provides: "Plan 31-02 isLegacyBulkUpsertEnabled() reader function in src/lib/collab/featureFlags.js (default-false kill switch with localStorage opt-in)"
  - phase: 31-migration-cutover-seal
    provides: "Plan 31-01 Wave 0 contract tests in tests/phase31/legacyBulkUpsertGate.test.mjs (gate-proximity grep + service-side log-line invariant)"
  - phase: 30-migration-dual-write
    provides: "Plan 30-07 fanOutCrdtForAnnotationsByPage / fanOutCrdtForDeletedIds helpers and Sites A/B/C/D taxonomy in useAnnotationCloudSync.js"
  - phase: 30-migration-dual-write
    provides: "dualWriteFabricCommit / dualWriteFabricDelete fan-out (the post-cutover sole writers)"

provides:
  - "Default-off kill-switch gate at every legacy bulk-upsert / bulk-delete fabric call site in useAnnotationCloudSync.js"
  - "CRDT fan-out (dualWriteFabricCommit per-row) is now the SOLE writer to the cloud for fabric annotations on every save when the flag is OFF"
  - "Single-flag emergency rollback: localStorage.setItem('pdf_app_legacy_bulk_upsert','true') + reload re-engages pre-Phase-31 dual-write byte-identical"

affects: [31-04, 31-05, 32, 33]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Caller-side gating (not source deletion) — preserves legacy implementation in src/services/annotationCloudSync.js verbatim so kill-switch flip is zero-code-change rollback"
    - "Success-shaped no-op result `{ data: [], error: null }` / `{ success: true }` lets the existing downstream success-branch (CRDT fan-out + banner clear) execute verbatim when the gate is closed — no logic-flow restructuring required"
    - "Mirror gate pattern across all four Site A/B/C/D fabric call sites; callout deletion path (`deleteAnnotations(documentId, deletedCalloutIds)`) intentionally NOT gated because callouts ride legacy through v2.4 by design"

key-files:
  created: []
  modified:
    - "src/hooks/useAnnotationCloudSync.js (+64 lines, -11 lines; 1 new import + 5 gated call sites)"

key-decisions:
  - "Used `if (isLegacyBulkUpsertEnabled())` block form everywhere (not ternary) for clarity and to satisfy the most permissive form of Plan 31-01's regex contract `/isLegacyBulkUpsertEnabled\\b[\\s\\S]{0,400}?upsertAnnotationsByPage\\(/`"
  - "Did NOT gate the callout-side `deleteAnnotations(documentId, deletedCalloutIds)` at line 762 — callouts ride legacy through v2.4 per CONTEXT.md `Out of Scope` (callout migration is v2.5 scope)"
  - "Forced forceFlush's direct push (Site D2) to skip both the legacy upsert AND the error throw when the gate is off — a missing legacy write isn't an error condition post-cutover, it's the contract"

patterns-established:
  - "Caller-side feature-flag gating: wrap legacy calls in `if (isLegacyBulkUpsertEnabled()) { ... } else { result = SUCCESS_SHAPE }` at each call site, preserving downstream success-branch logic verbatim. Source service stays untouched for rollback safety."
  - "Five fabric call sites in useAnnotationCloudSync.js mapped to Plan 30-07 Sites A/B/C/D: A=runFabricPush bulk upsert, B=runFabricPush delete diff, C=drainQueue flush, D1=forceFlush queue replay, D2=forceFlush direct push. All five gated; callout flush at line 762 NOT gated (v2.4 boundary)."

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 31 Plan 03: Migration Cutover Seal Wave 2 Summary

**Legacy bulk-upsert path killed at the caller — every `upsertAnnotationsByPage` and fabric `deleteAnnotations` call in `useAnnotationCloudSync.js` is now gated behind `isLegacyBulkUpsertEnabled()`. Default-off makes the CRDT fan-out the sole writer to the cloud; localStorage opt-in restores pre-Phase-31 dual-write byte-identical for emergency rollback.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-01T03:59:42Z
- **Completed:** 2026-05-01T04:01:14Z
- **Tasks:** 1 (single-task plan, single-file diff)
- **Files modified:** 1 (`src/hooks/useAnnotationCloudSync.js`)
- **Commits:** 1 (`89680011`)

## Accomplishments

- `src/hooks/useAnnotationCloudSync.js` imports `isLegacyBulkUpsertEnabled` from `../lib/collab/featureFlags.js`. Plan 31-02's flag is now consumed.
- All four `upsertAnnotationsByPage(...)` call sites gated behind the kill switch (Sites A, C, D1, D2 per Plan 30-07 SUMMARY taxonomy). Default off → zero calls fire on save.
- Fabric `deleteAnnotations(documentId, deletedIds)` at Site B gated for symmetry. Default off → zero legacy delete calls fire.
- CRDT fan-out (`fanOutCrdtForAnnotationsByPage` / `fanOutCrdtForDeletedIds`) calls preserved verbatim — they fire in the success branch which now executes unconditionally when the gate is closed, making the CRDT path the sole writer.
- Service file `src/services/annotationCloudSync.js` UNTOUCHED — `git diff --stat` is empty for it. The legacy `[CloudSync][push] upsertAnnotationsByPage start` log line stays in place so the kill-switch flip is a single-flag rollback with zero code change.
- Plan 31-01's two RED `useAnnotationCloudSync legacy bypass (Plan 31-03)` contract tests flipped GREEN. Whole `legacyBulkUpsertGate.test.mjs` suite now 6/6 pass (was 4/6).
- `npm test` baseline preserved: 437p/16f/6s → 439p/14f/6s. The 2 net green tests are the two Plan 31-03 contracts. Zero pre-existing tests regressed.

## Task Commits

1. **Task 1: Add isLegacyBulkUpsertEnabled import + gate all four fabric call sites** — `89680011` (feat)

## Files Created/Modified

- `src/hooks/useAnnotationCloudSync.js` — modified (+64 lines, -11 lines).
  - 1 new import `isLegacyBulkUpsertEnabled` from `'../lib/collab/featureFlags.js'`.
  - 5 gated fabric call sites (4 `upsertAnnotationsByPage(` + 1 fabric `deleteAnnotations(`).
  - All gates use `if (isLegacyBulkUpsertEnabled()) { result = await legacyCall(...) } else { result = SUCCESS_SHAPE }` pattern.
  - Each gate has a comment block citing CONTEXT.md AC bullet 5 and the rollback semantics.

### Verification grep counts

- `grep -c "isLegacyBulkUpsertEnabled" src/hooks/useAnnotationCloudSync.js` → **6** (1 import + 5 call-site gates)
- `grep -c "upsertAnnotationsByPage(" src/hooks/useAnnotationCloudSync.js` → **4** (unchanged from pre-edit; calls gated, not deleted)
- `grep -c "from '../lib/collab/featureFlags.js'" src/hooks/useAnnotationCloudSync.js` → **1**
- Perl gate-proximity grep `/isLegacyBulkUpsertEnabled\b[\s\S]{0,400}?upsertAnnotationsByPage\(/g` → **4 matches** (every call site within 400 chars of the gate)
- `git diff --stat src/services/annotationCloudSync.js` → **empty** (service untouched)

## Decisions Made

1. **Used the `if`/`else` block form everywhere, not the ternary form.** Plan 31-01's regex contract `/isLegacyBulkUpsertEnabled\b[\s\S]{0,400}?upsertAnnotationsByPage\(/` accepts both forms (the regex doesn't require `if (` — only that `isLegacyBulkUpsertEnabled` appears within 400 chars of `upsertAnnotationsByPage(`). Block form chosen for readability of the comment block above each gate and to make the rollback path visually obvious.

2. **Callout-side `deleteAnnotations(documentId, deletedCalloutIds)` at line 762 NOT gated.** This call deletes callout rows, not fabric rows. CONTEXT.md "Out of Scope" explicitly states callouts ride the legacy path through v2.4 ("Callout migration is v2.5 scope; out of Phase 30 boundary"). Gating this call would silently strand callout deletions. The fabric delete diff at line 561 IS gated for symmetry with the bulk upsert.

3. **forceFlush Site D2 gate skips both the legacy upsert AND the error throw.** The original code threw `forceFlush: legacy upsertAnnotationsByPage failed` if the legacy push errored. Post-cutover, "no legacy push happened" is not an error — it's the contract. The CRDT fan-out below the gate fires unconditionally as the sole writer.

4. **forceFlush Site D2 placed inside the `if (isLegacyBulkUpsertEnabled())` block.** This means the throw site simply doesn't execute when the gate is closed. Alternative would be wrapping just the call in a ternary, but that would leave a dead error-handler branch — the block form makes both the call and its error handler atomic.

## Deviations from Plan

None — plan executed exactly as written. The plan offered both `if`/`else` block form and ternary form as acceptable; chose the block form. The plan's 4-site call-out matched the actual file (Sites A/B/C/D1/D2 — Site D had two sub-sites in forceFlush, both gated).

## Issues Encountered

None. Pre-existing untracked WIP in App.jsx, SVGAnnotationLayer.jsx, useSVGInteraction.js was deliberately left out of the Task 1 commit — only `src/hooks/useAnnotationCloudSync.js` was staged via explicit `git add` of just that path.

## Deferred Issues

None — all of this plan's contract tests pass.

Plan 31-04 contracts (`crdtBackfill` cutover trigger, `YDocProvider` doc-open backfill, hydrate path branch) and the remaining Plan 31-01 idAtCreationStamping Test 2 (slice-window bug noted in 31-02 SUMMARY) remain as already-known follow-ups for those plans.

## User Setup Required

None — no external service configuration required. The kill switch is read at runtime via `localStorage` and `import.meta.env`, both of which are already wired up.

## Next Phase Readiness

- **Plan 31-04 ready to execute.** It can:
  - Trigger per-doc backfill on first post-cutover open via `runBackfill` then write `documents.cutover_completed_at` (column shipped Plan 31-02, gate shipped here).
  - Rely on the fact that the legacy bulk-upsert path is now off by default — no risk of double-writing to `document_annotations` while backfill runs.
- **Plan 31-05 ready to execute.** When `cutover_completed_at` is set, the hydrate path can read from the Y.Doc snapshot exclusively, knowing that no background legacy writes are happening that could create a stale-snapshot race.
- **Phase 32+ (table cleanup) ready.** Once all live docs are cutover-flagged, `document_annotations` can be deleted with confidence — no production code path writes to it by default.

## Self-Check: PASSED

- Modified file FOUND: `src/hooks/useAnnotationCloudSync.js`
- Commit FOUND: `89680011` (Task 1 — gate)
- Service file UNTOUCHED: `git diff --stat src/services/annotationCloudSync.js` is empty
- All 4 `upsertAnnotationsByPage(` calls gated within 400 chars of `isLegacyBulkUpsertEnabled` (perl regex match count = 4 = total call count)
- All 6/6 tests in `tests/phase31/legacyBulkUpsertGate.test.mjs` pass (was 4/6)
- npm test baseline: 437p/16f/6s → 439p/14f/6s (2 net green from this plan, zero regressions)

---
*Phase: 31-migration-cutover-seal*
*Completed: 2026-05-01*
