---
phase: 30-migration-dual-write
plan: 03
subsystem: collab
tags: [yjs, dual-write, retry-queue, localStorage, kill-switch, quarantine]

# Dependency graph
requires:
  - phase: 30-migration-dual-write
    provides: Plan 30-01 test scaffold contract (7 tests; constants STORAGE_KEY_PREFIX / QUARANTINE_THRESHOLD=10 / STUCK_THRESHOLD_MS=30_000 / BACKOFF_MS); CI grep gate scripts/check-no-diff-delete.mjs
  - phase: 27-crdt-foundation
    provides: crdtFeatureFlag.isCRDTEnabled() three-tier kill switch consumed in drainQueue first-line guard (Pitfall 30-6)
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: applyFabricCommit signature - the CRDT-side retry path will re-fire this with the queued fabricObject + opts (consumed by Plan 30-04 + 30-06)
provides:
  - "src/lib/collab/crdtDualWriteQueue.js: pure module with enqueue / drainQueue / readQueue / getQuarantinedAnnoIds / getStuckCount / hasPendingForUser exports"
  - "Locked constants: QUARANTINE_THRESHOLD=10, STUCK_THRESHOLD_MS=30_000, BACKOFF_MS=[1k, 2k, 4k, 8k, 16k, 30k]"
  - "Pitfall 30-5 mitigation: drain loop skips quarantined entries; rest of queue keeps moving"
  - "Pitfall 30-6 mitigation: drainQueue first line is `if (!isCRDTEnabled()) return;` - silent skip when kill switch off"
  - "Plan 30-01 7 queue tests flipped skip->green (out-of-order Plan 30-01 scaffold landed inline as Rule 3 deviation)"
  - "Plan 30-01 CI grep gate scripts/check-no-diff-delete.mjs landed inline (also Rule 3); exits 0 today"
affects: [30-04, 30-05, 30-06, 30-07, 31, 33]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies; pure module on top of existing crdtFeatureFlag
  patterns:
    - "Latest-version-wins replacement keyed by annoId in localStorage[crdt_dual_write_queue:userId]"
    - "Defense-in-depth localStorage access (typeof guards + try/catch around JSON.parse + swallow setItem failures)"
    - "Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent) preserved in test scaffold"
    - "NO_DIFF_DELETE_OK escape hatch for legitimate `delete` calls (post-success queue cleanup is the only allowed pattern)"

key-files:
  created:
    - "src/lib/collab/crdtDualWriteQueue.js (259 LOC) - pure retry queue module"
    - "src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs (321 LOC) - 7 tests, locks constants + behavior contract [out-of-order Plan 30-01 scaffold]"
    - "scripts/check-no-diff-delete.mjs (71 LOC) - CI grep gate for the 'no diff = delete' architectural lock [out-of-order Plan 30-01 scaffold]"
  modified: []  # zero modifications to any existing src/ file

key-decisions:
  - "Per-user storage key (crdt_dual_write_queue:${userId}) so multi-account-on-same-device is clean and one user's stuck queue is invisible to other collaborators on the same document"
  - "Latest-version-wins replacement preserves queuedAt/attempts/quarantined from the existing entry on re-enqueue so the stuck threshold and quarantine counter survive re-edits"
  - "Drain handlers (retryLegacyWrite/retryCrdtWrite) injected by caller (Plan 30-06 YDocProvider) - keeps this module pure (no Supabase / Yjs imports at module top level beyond crdtFeatureFlag)"
  - "Backoff index = Math.min(entry.attempts, BACKOFF_MS.length - 1) - 6-step exponential cap at 30s, no decay"
  - "Listener errors (onStuck / onQuarantine throws) swallowed defensively so a UI bug never poisons the drain loop"
  - "Out-of-order Plan 30-01 scaffold landed inline (Rule 3 deviation) so Plan 30-03 has a verifiable contract today; Plan 30-01 Task 1 + Task 3 should detect both files already present when it eventually runs"

patterns-established:
  - "Pure-module discipline: zero React, zero DOM, zero Yjs/Supabase top-level imports - only crdtFeatureFlag import (itself pure). Module loads cleanly in Node --test"
  - "Drain return shape {drained, quarantined, stuckCount, skippedKillSwitch} - lets Plan 30-06 timer log per-tick metrics and Plan 30-05 banner gate on skippedKillSwitch"
  - "Listener-error containment: every onStuck/onQuarantine call wrapped in try/catch so the queue is robust to UI consumer bugs"

requirements-completed: [MIGRATE-01]

# Metrics
duration: 8min
completed: 2026-04-28
---

# Phase 30 Plan 03: Dual-Write Retry Queue Summary

**Pure module crdtDualWriteQueue.js with localStorage persistence, 10-attempt quarantine, 30s stuck threshold, 6-step exponential backoff, and isCRDTEnabled() first-line kill-switch guard**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-28T16:39:14Z
- **Completed:** 2026-04-28T16:48:XXZ
- **Tasks:** 1 (production module - the only task in Plan 30-03)
- **Files created:** 3 (1 production module + 1 test scaffold + 1 CI gate; the latter 2 are out-of-order Plan 30-01 scaffolds landed as Rule 3 deviations)
- **Files modified:** 0

## Accomplishments
- Production module `src/lib/collab/crdtDualWriteQueue.js` with 6 named exports + 3 locked constants
- Pitfall 30-5 mitigated: drain loop skips quarantined entries; rest of queue keeps moving
- Pitfall 30-6 mitigated: drainQueue first line is `if (!isCRDTEnabled()) return;` - kill switch is silent
- Latest-version-wins replacement proven by test 2: re-enqueue same annoId REPLACES entry (preserves queuedAt/attempts so stuck threshold counter survives the re-edit)
- Persistence proven by test 7: enqueue -> fresh module import (cache-busted query string) -> readQueue returns the same entries
- Plan 30-04 (annotationCloudSync fan-out), Plan 30-05 (UI hook), Plan 30-06 (YDocProvider drain timer) all have a stable consumable surface

## Task Commits

1. **Plan 30-01 scaffold (Rule 3 deviation):** `24c578c5` (test) - landed crdtDualWriteQueue.test.mjs (7 tests) + scripts/check-no-diff-delete.mjs (CI gate). RED phase: 7/7 tests skipped against missing module.
2. **Task 1: Implement crdtDualWriteQueue.js:** `0640d1c0` (feat) - GREEN phase: 7/7 tests pass; CI gate exits 0; Phase 27/28/29 baseline preserved (20 pass + 8 skipped).

_Note: TDD ordering was test-scaffold-first (RED) then production module (GREEN). Plan 30-03 is a single-task plan; the scaffold commit is technically Plan 30-01 work but executed inline so Plan 30-03 had a verifiable contract today._

## Files Created

- `src/lib/collab/crdtDualWriteQueue.js` (259 LOC) - pure retry queue module
  - 6 exports: `enqueue`, `drainQueue`, `readQueue`, `getQuarantinedAnnoIds`, `getStuckCount`, `hasPendingForUser`
  - 3 constants: `QUARANTINE_THRESHOLD = 10`, `STUCK_THRESHOLD_MS = 30_000`, `BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]`
  - 1 import: `isCRDTEnabled` from `./crdtFeatureFlag.js`
- `src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` (321 LOC) - 7 tests with per-test existsSync skip-guards [out-of-order Plan 30-01 scaffold]
- `scripts/check-no-diff-delete.mjs` (71 LOC) - CI grep gate scanning 3 dual-write surface files [out-of-order Plan 30-01 scaffold]

## Decisions Made

- **Per-user storage key (`crdt_dual_write_queue:${userId}`)** so multi-account-on-same-device is clean and one user's stuck queue is invisible to other collaborators on the same document.
- **Latest-version-wins preserves history fields:** `queuedAt`, `attempts`, `quarantined` are carried forward from the existing entry on re-enqueue. Stuck threshold counter and quarantine state survive re-edits, so a user repeatedly editing a server-rejected annotation still gets quarantined after 10 attempts.
- **Drain handlers injected by caller** (`retryLegacyWrite` / `retryCrdtWrite`) - keeps this module pure (no Supabase / Yjs imports at module top level beyond `crdtFeatureFlag`, which is itself pure). Plan 30-06 YDocProvider wires the actual handlers.
- **Backoff index = `Math.min(entry.attempts, BACKOFF_MS.length - 1)`** - 6-step exponential capped at 30s. After attempt 6, every retry uses the 30s window until quarantine.
- **Listener error containment:** every `onStuck` / `onQuarantine` call wrapped in try/catch so a UI consumer bug never poisons the drain loop.
- **Defensive localStorage:** typeof guards on `globalThis.localStorage`, try/catch around `JSON.parse` (corrupted JSON -> empty object), swallow `setItem` failures (quota / blocked storage degrades gracefully because Y.Doc / IndexedDB persistence is the actual data layer).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 30-01 scaffold landed out-of-order**
- **Found during:** Pre-execution context load
- **Issue:** Plan 30-03 declares `depends_on: [30-01]` and the verification step requires `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` to pass + `node scripts/check-no-diff-delete.mjs` to exit 0. Plan 30-01 had not yet been executed (test scaffold + CI gate did not exist on disk). Without these artifacts the production module cannot be verified against its locked contract.
- **Fix:** Landed the two specific Plan 30-01 artifacts that gate Plan 30-03 verification (the queue test scaffold + the CI grep gate) inline as a Rule 3 blocking-fix commit. The other 8 Plan 30-01 scaffolds (crdtBackfill, weblocks, dualWrite fan-out, banner variant, hook scaffolds, Playwright specs) remain pending - those gate plans 30-02 / 30-04 / 30-05 / 30-07 verification, not 30-03's.
- **Files created:** `src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs`, `scripts/check-no-diff-delete.mjs`
- **Verification:** Both files match the Plan 30-01 contract verbatim (test count = 7, CI gate scans the documented 3 surface files, escape hatch convention `// NO_DIFF_DELETE_OK: <reason>` honored). When Plan 30-01 runs its Task 1 + Task 3 will detect both files already present.
- **Committed in:** `24c578c5` (Plan 30-01 boundary)

**2. [Rule 1 - Bug] CI gate false positive on header comment line referencing the gate's own filename**
- **Found during:** Task 1 verification (first run of `node scripts/check-no-diff-delete.mjs` after producing the module)
- **Issue:** Header comment originally read `Scanned by scripts/check-no-diff-delete.mjs.` - the regex `\bdiff\b[^\n]{0,80}\bdelete\b` matches `diff` and `delete` inside the literal filename `check-no-diff-delete` (the hyphens are word boundaries). Gate exited 1 with that line as the violation.
- **Fix:** Rephrased the docstring to drop the literal filename and describe the gate by purpose ("scripts/check-no-diff-delete invariant gate") plus an inline `// NO_DIFF_DELETE_OK: docstring reference to the gate.` escape on the same line. Both `NO_DIFF_DELETE_OK` markers in the file are intentional - one in the header explaining why the module is safe, one inline on the docstring line that mentions the gate by name.
- **Files modified:** `src/lib/collab/crdtDualWriteQueue.js` (lines 32-37)
- **Verification:** `node scripts/check-no-diff-delete.mjs` exits 0; `grep -c "NO_DIFF_DELETE_OK" src/lib/collab/crdtDualWriteQueue.js` = 2 (both intentional).
- **Committed in:** `0640d1c0` (Task 1 commit; rolled into the production module)

---

**Total deviations:** 2 auto-fixed (1 blocking [Rule 3], 1 bug [Rule 1])
**Impact on plan:** Both deviations were necessary for plan verification. The Rule 3 scaffold landing is a clean Plan 30-01 boundary expansion (matches the locked Plan 30-01 contract verbatim) and is documented as a deferred-items entry below for the Plan 30-01 reconciliation step. The Rule 1 false-positive fix is a pure docstring tweak with the architectural meaning preserved via the same NO_DIFF_DELETE_OK escape the plan recommends. No scope creep, no Always-Protected file touches.

## Issues Encountered
None - the only friction was the dependency-ordering question (Plan 30-01 not yet executed), resolved transparently per Rule 3.

## Verification Results

| Check | Result |
| --- | --- |
| `node --test src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` | 7/7 pass, 0 fail, 0 skip |
| `node scripts/check-no-diff-delete.mjs` | Exits 0; 0 violations across 3 files |
| `node --test src/lib/collab/__tests__/*.test.mjs` (Phase 27/28/29 baseline) | 20 pass, 0 fail, 8 skipped (skipped = crdtBackfill tests waiting on Plan 30-02) |
| `git diff --stat` Always-Protected files | empty (App.jsx, PAL, Fabric*, SVG, package.json, vite.config.js all byte-identical) |
| `grep -c "QUARANTINE_THRESHOLD = 10"` | 1 |
| `grep -c "STUCK_THRESHOLD_MS = 30_000"` | 1 |
| `grep -c "crdt_dual_write_queue:"` | 1 |
| `grep -c "isCRDTEnabled"` | 3 (1 import + 1 guard call + 1 docstring reference) |
| `grep -c "Y.applyUpdate\|applyUpdateV2"` | 0 (pure module; no Y writes) |
| `grep -c "from 'react'"` | 0 (no React imports) |
| `grep -c "NO_DIFF_DELETE_OK"` | 2 (header block + inline docstring reference; both intentional) |

## Deferred Items (carry into Plan 30-01 reconciliation)

- **Plan 30-01 Task 1 partial-completion note:** `crdtDualWriteQueue.test.mjs` already landed inline by Plan 30-03 (commit 24c578c5). When Plan 30-01 runs its Task 1, it should detect this file via `existsSync` skip-guard logic and skip recreation. The other 4 unit test scaffolds (crdtBackfill, weblocks, annotationCloudSync.dualWrite, StorageFailureBanner.syncQueueStuck) remain Plan 30-01 work. Note: a parallel session has also landed `crdtBackfill.test.mjs` and `crdtBackfill.weblocks.test.mjs` as untracked files in `src/lib/collab/__tests__/` - those will need staging during the Plan 30-01 commit.
- **Plan 30-01 Task 3 done:** `scripts/check-no-diff-delete.mjs` already landed inline by Plan 30-03 (commit 24c578c5). Plan 30-01 Task 3 should detect this file present and either skip or verify the contract.
- **Drain timer wiring:** Plan 30-06 YDocProvider must mount a `setInterval` (or equivalent scheduler) that calls `drainQueue` periodically. Cadence + jitter parameters are Plan 30-06 decisions.
- **UI consumers:** Plan 30-05's `useDualWriteQueue` hook reads `getStuckCount` / `getQuarantinedAnnoIds` / `hasPendingForUser`. Plan 30-07's TabBar dot reads `hasPendingForUser` per-user. Plan 30-04's fan-out calls `enqueue` on either-side failure.

## Next Phase Readiness

- **Plan 30-04 (annotationCloudSync fan-out)** unblocked: can now `import { enqueue } from '../lib/collab/crdtDualWriteQueue.js'` and call on either-side failure.
- **Plan 30-05 (UI hook)** unblocked: can now `import { drainQueue, getQuarantinedAnnoIds, getStuckCount, hasPendingForUser }` and wire to React state.
- **Plan 30-06 (YDocProvider drain timer)** unblocked: can now `import { drainQueue }` and run on a cadence.
- **Plan 30-07 (legacy hook fan-out + TabBar dot)** unblocked: can now `import { hasPendingForUser }` for the per-doc tab dot.

## Self-Check: PASSED

- [x] `src/lib/collab/crdtDualWriteQueue.js` - FOUND
- [x] `src/lib/collab/__tests__/crdtDualWriteQueue.test.mjs` - FOUND
- [x] `scripts/check-no-diff-delete.mjs` - FOUND
- [x] Commit `24c578c5` (Plan 30-01 scaffold) - FOUND in git log
- [x] Commit `0640d1c0` (Plan 30-03 production module) - FOUND in git log
- [x] All 7 tests pass against production module
- [x] CI gate exits 0
- [x] Phase 27/28/29 baseline (20 pass, 8 skipped) preserved
- [x] Always-Protected files byte-identical

---
*Phase: 30-migration-dual-write*
*Completed: 2026-04-28*
