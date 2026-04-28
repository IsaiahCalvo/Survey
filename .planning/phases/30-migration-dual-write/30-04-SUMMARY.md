---
phase: 30-migration-dual-write
plan: 04
subsystem: persistence
tags: [crdt, yjs, supabase, migration, dual-write, retry-queue, fan-out]

# Dependency graph
requires:
  - phase: 21-cloud-sync-non-highlight
    provides: annotationCloudSync.js — legacy upsert/delete/load/subscribe surface for non-highlight rows
  - phase: 27-crdt-foundation
    provides: crdtFeatureFlag.isCRDTEnabled() — single kill switch for the entire CRDT layer + dual-write
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: crdtAnnotationBridge.applyFabricCommit / applyFabricDelete — pure-module Fabric ↔ Y.Map bridge
  - phase: 30-migration-dual-write
    provides: Plan 30-03 crdtDualWriteQueue.enqueue — half-failed save retry queue (latest-version-wins per annoId)
provides:
  - dualWriteFabricCommit(fabricObj, opts) named export — fan-out for create/edit
  - dualWriteFabricDelete(documentId, annoId, opts) named export — fan-out for delete
  - NON_HIGHLIGHT_TYPES exported (was module-private) — shared source of truth
  - Plan 30-01 dualWrite contract tests flipped skip→green (5/5)
affects:
  - 30-05 — banner / quarantine UI consumes the queue this fan-out fills
  - 30-06 — YDocProvider drain handlers retry the same legacy + CRDT writes
  - 30-07 — call-site swap in useAnnotationCloudSync (or successor) wires this surface
  - 33 — activity log surfaces 'crdt-backfill' + 'local-fabric' origin distinction
  - 34 — useAnnotationCloudSync decommission can read from dualWriteFabricCommit as the new entry point

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — uses only existing Supabase + Yjs trio + crdt modules
  patterns:
    - "Always-fire-legacy + conditionally-fire-CRDT pattern for the dual-write era"
    - "Per-side try/catch + enqueue on failure (never delete-from-other-side to reconcile)"
    - "Highlight carve-out via inferAnnotationTypeForDualWrite helper (Excel-sync v2.5 boundary)"
    - "Surgical narrow-waiver edit on annotationCloudSync.js — no byte change to existing exports"

key-files:
  created: []
  modified:
    - "src/services/annotationCloudSync.js — narrow waiver per 30-CONTEXT.md DO NOT CHANGE list; +202 LOC / -1 LOC"

key-decisions:
  - "Inline highlight inference helper (inferAnnotationTypeForDualWrite) instead of importing serializer — keeps the new code self-contained and dodges changing the existing serializer module"
  - "CRDT-side missing ydoc/yMapAnnotations is treated as a clean skip (no enqueue) — caller (Plan 30-06 YDocProvider) owns threading these through inside the provider boundary"
  - "Three-line escape hatches (NO_DIFF_DELETE_OK on each docstring line that mentions the banned pattern) — Rule 3 fix to keep the CI gate green while still documenting the architectural lock the file honors"

patterns-established:
  - "Two-stage skip pattern works as planned: file existed since Phase 21; symbol absence triggered the inner skip; landing the symbol auto-flipped 5 tests skip→green without test edits"

requirements-completed: [MIGRATE-01]

# Metrics
duration: 3min
completed: 2026-04-28
---

# Phase 30 Plan 04: Dual-Write Fan-Out (annotationCloudSync narrow waiver) Summary

**dualWriteFabricCommit + dualWriteFabricDelete added to annotationCloudSync.js — legacy-write byte-identical when kill switch off, CRDT-side fan-out via Phase 29 bridge when enabled, half-failed saves enqueue to Plan 30-03 retry queue per side.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-28T17:13:07Z
- **Completed:** 2026-04-28T17:16:55Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `dualWriteFabricCommit(fabricObj, opts)` exports — always fires `upsertFabricAnnotation`; if `isCRDTEnabled()` and not highlight, also fires `applyFabricCommit` through the Phase 29 bridge; per-side try/catch + enqueue on failure
- `dualWriteFabricDelete(documentId, annoId, opts)` exports — same shape for deletes via `applyFabricDelete`
- `NON_HIGHLIGHT_TYPES` promoted from module-private to named export — Plan 30-06 / future consumers read from a single source of truth
- All 5 Plan 30-01 dual-write contract tests flipped skip→green (`#1` legacy + bridge fan-out, `#2` kill-switch off, `#3` highlight carve-out, `#4` legacy-side enqueue, `#5` CRDT-side enqueue)
- CI gate `scripts/check-no-diff-delete.mjs` exits 0 with all 3 dual-write surface files now in scope (annotationCloudSync.js + crdtBackfill.js + crdtDualWriteQueue.js)
- All existing exports byte-identical (`git diff` shows zero `^-export` lines)

## Task Commits

1. **Task 1: Add dualWriteFabricCommit + dualWriteFabricDelete + export NON_HIGHLIGHT_TYPES** — `e2b66f18` (feat)

**Plan metadata commit:** appended at plan close (this SUMMARY + STATE + ROADMAP).

_Note: TDD task — Plan 30-01 had already shipped the contract scaffold (5 tests using the documented two-stage skip pattern: outer existsSync gates file presence, inner readFileSync grep gates the symbol). The "RED" stage was the 5 tests skipping with reason "dualWriteFabricCommit not yet exported (Plan 30-04)"; the "GREEN" stage was Plan 30-04 landing both new exports + the inner skip auto-flipping. No separate test commit was required because the plan explicitly forbids test modification (Plan 30-01 owns the scaffold)._

## Files Created/Modified

- `src/services/annotationCloudSync.js` — narrow waiver exercised. Added 3 imports (applyFabricCommit / applyFabricDelete / isCRDTEnabled / enqueue-as-enqueueDualWrite); added `inferAnnotationTypeForDualWrite` helper; added `dualWriteFabricCommit` + `dualWriteFabricDelete` exports; added `export` keyword on existing `NON_HIGHLIGHT_TYPES` const. +202 LOC / -1 LOC. Existing 7 exports (`upsertFabricAnnotation`, `upsertAnnotationsByPage`, `upsertCallouts`, `deleteAnnotation`, `deleteAnnotations`, `loadAllNonHighlightAnnotations`, `subscribeToAllNonHighlightAnnotations`) byte-identical.

## Decisions Made

- **Inline `inferAnnotationTypeForDualWrite` helper instead of importing `serializeFabricObjectToRow`'s type-inference logic.** The plan called for the helper to mirror the serializer's logic; building it inline keeps the new code self-contained and avoids any risk of inadvertently touching `annotationTypeSerializers.js` (which sits outside the Phase 30 narrow waiver). The helper preserves the same 3-tier resolution: explicit `opts.annotation_type` → `fabricObj.data.annotationType` → `fabricObj.type`.
- **Missing `ydoc` / `yMapAnnotations` is a silent CRDT-side skip (no enqueue).** The plan flagged this as defensive: callers inside `<YDocProvider>` are responsible for threading these in. If the caller forgets, we treat it as "CRDT not available for this call" rather than enqueueing for retry — enqueueing would create a permanent stuck entry the queue can never drain (the queue's own retry handlers re-fire a fresh write through the bridge, which would also need ydoc/yMapAnnotations). Returns `crdt: null` so callers can distinguish.
- **Legacy `{ data, error }` truthy-error treated as failed save.** `upsertFabricAnnotation` returns `{ data, error }` per its existing Phase 21 contract, never throws on Supabase errors. The fan-out treats `legacyResult.error` as truthy → enqueue. Symmetric to the catch block for thrown errors. Both paths preserve the legacy result for the caller's return shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `NO_DIFF_DELETE_OK:` escape hatches to docstring lines that triggered the CI gate**
- **Found during:** Task 1 (verification step — running `node scripts/check-no-diff-delete.mjs`)
- **Issue:** The `scripts/check-no-diff-delete.mjs` regex `\b(diff|reconcile|sync)\b[^\n]{0,80}\bdelete\b` matches docstring text describing what the architectural lock forbids (e.g. `"diff = delete" architectural lock`, `"compare-then-delete-the-diff"`, `"check-no-diff-delete.mjs"`). 3 violations total in the new docstring block. Without the escape hatch, the CI gate fails on Plan 30-04's own commentary about the lock it honors.
- **Fix:** Appended `// NO_DIFF_DELETE_OK: <reason>` to each of the 3 offending docstring lines. The escape hatch is documented in `scripts/check-no-diff-delete.mjs` itself for exactly this case (legitimate prose mention vs. actual code pattern).
- **Files modified:** `src/services/annotationCloudSync.js` (3 escape comments inside the new docstring block)
- **Verification:** `node scripts/check-no-diff-delete.mjs` now exits 0 with `OK - 0 violations across 3 files.`
- **Committed in:** `e2b66f18` (Task 1 commit — applied before commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep. The escape hatches are exactly the mechanism the CI gate ships for documentation that mentions the banned pattern.

## Issues Encountered

- `node --test src/lib/collab/__tests__/` (whole directory invocation) returns `MODULE_NOT_FOUND` under Node 22 — directory paths are not valid args for `--test` in this Node version. Worked around by iterating individual files (`for f in ...; do node --test "$f"; done`). All 5 collocated test suites green: `crdtBackfill.test.mjs` (6/6), `crdtBackfill.weblocks.test.mjs` (2/2), `crdtDualWriteQueue.test.mjs` (7/7), `storageFailureDetector.test.mjs` (8/8), `ydocRegistry.test.mjs` (5/5). Full `npm test` discovery (which uses the `tests/**/*.test.mjs` glob bridge file) confirms all pass plus the 5 newly-flipped dualWrite tests at #236-240.

## Verification Results

- `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` → **5/5 pass / 0 fail / 0 skip** (was 0/0/5 skip pre-Plan-30-04)
- `node scripts/check-no-diff-delete.mjs` → **OK - 0 violations across 3 files**
- `npm test` → **371 pass / 9 baseline-fail / 14 skip** (was 358/9/27 post-Plan-30-02; +13 passes, -13 skips, fails unchanged at the same 9 pre-existing baseline failures: migration flag suite, pdfAnnotationImporter, Phase 29 deferred undo tombstone tests)
- `git diff src/services/annotationCloudSync.js | grep -E "^-export" | wc -l` → **0** (no existing exports removed)
- Always-Protected files: `git diff --stat src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricDrawingCanvas.jsx src/components/FabricEditCanvas.jsx src/components/FabricEraserCanvas.jsx src/components/SVGAnnotationLayer.jsx package.json vite.config.js` → **empty** (zero changes)
- All grep-based acceptance criteria pass (1 dualWriteFabricCommit / 1 dualWriteFabricDelete / 1 exported NON_HIGHLIGHT_TYPES / 4 applyFabricCommit-or-Delete refs / 4 isCRDTEnabled refs / 7 enqueueDualWrite refs / 5 NO_DIFF_DELETE_OK refs)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 30-05 unblocked:** `getStuckCount(userId)` / `getQuarantinedAnnoIds(userId)` from Plan 30-03 already feed off whatever this fan-out enqueues. The banner trigger and quarantine marker UI can read directly without any further wiring change.
- **Plan 30-06 unblocked:** YDocProvider's drain handlers will inject `retryLegacyWrite` (re-call `upsertFabricAnnotation`) and `retryCrdtWrite` (re-call `applyFabricCommit` through the bridge) using the queued `payload` shape: for commits, `{ fabricObj, opts }`; for deletes, `{ op: 'delete', documentId, annoId, opts }`. The shape is locked by this plan's enqueue calls.
- **Plan 30-07:** The two new exports are the planted seam for migrating the existing `useAnnotationCloudSync` callers to fan-out behavior. Phase 30 deliberately does NOT swap call sites (App.jsx is Always-Protected for Phase 30); Plan 30-07 owns the future swap inside the hook (or the hook's successor) when its scope opens up.
- **Phase 33:** Both legacy and CRDT writes carry distinct origins (legacy = Supabase row write attributed to `last_modified_by`; CRDT = Phase 29 bridge with `source: 'local-fabric'` from `originPayload`). Activity log can distinguish without further plumbing.

---
*Phase: 30-migration-dual-write*
*Completed: 2026-04-28*

## Self-Check: PASSED

- File `src/services/annotationCloudSync.js` exists ✓
- Commit `e2b66f18` exists in `git log` ✓
- All grep-based acceptance criteria pass ✓
- `node --test src/services/__tests__/annotationCloudSync.dualWrite.test.mjs` exits 0 with 5/5 pass / 0 skip ✓
- `node scripts/check-no-diff-delete.mjs` exits 0 ✓
- Always-Protected files unchanged (git diff --stat empty) ✓
