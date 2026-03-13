---
phase: 08-post-processing-analysis
plan: 01
subsystem: testing, debug
tags: [jsonl, timeline, anomaly-detection, node-test, tdd]

# Dependency graph
requires:
  - phase: 07-capture-modules
    provides: "JSONL capture pipeline (state.jsonl, performance.jsonl, console.jsonl, manifest.json)"
provides:
  - "mergeTimeline() function for JSONL stream merging into unified sorted timeline"
  - "detectAnomalies() function with four locked anomaly detection rules"
  - "Mock session fixture for deterministic unit testing"
affects: [08-02-PLAN, phase-09]

# Tech tracking
tech-stack:
  added: []
  patterns: ["JSONL read-parse-sort pipeline", "per-page event chain reconstruction", "TDD with node:test"]

key-files:
  created:
    - debug/lib/timeline-merger.mjs
    - debug/lib/anomaly-detector.mjs
    - debug/fixtures/mock-session/manifest.json
    - debug/fixtures/mock-session/state.jsonl
    - debug/fixtures/mock-session/performance.jsonl
    - debug/fixtures/mock-session/console.jsonl
    - debug/fixtures/mock-session/step-00_1000ms_baseline-initial-state.png
    - debug/fixtures/mock-session/step-01_2000ms_before-zoom-100pct.png
    - debug/fixtures/mock-session/step-01_3000ms_after-zoom-100pct.png
    - tests/timeline-merger.test.mjs
    - tests/anomaly-detector.test.mjs
  modified: []

key-decisions:
  - "Support both filename and path fields in manifest artifacts for real vs test data compatibility"
  - "Source priority tie-breaking order: performance > state > console (most-precise-timing first)"

patterns-established:
  - "JSONL parsing: readFileSync + trim + split + JSON.parse with existsSync guard"
  - "Per-page event chains: correlate performance marks with DOM mutations from state.jsonl"
  - "Anomaly schema: { type, severity, sessionMs, page, detail, refs } with screenshot cross-reference"

requirements-completed: [PROC-01, PROC-02, PROC-04]

# Metrics
duration: 4min
completed: 2026-03-13
---

# Phase 08 Plan 01: Core Data Processing Pipeline Summary

**JSONL timeline merger with stable sort and four-rule anomaly detector (canvas drop, freeze overhang, scale divergence, race condition) using TDD with 15 passing tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-13T05:06:55Z
- **Completed:** 2026-03-13T05:11:31Z
- **Tasks:** 2 (TDD: 5 commits total)
- **Files created:** 11

## Accomplishments
- Built mergeTimeline() that merges three JSONL streams into a single sorted array with stable tie-breaking (performance > state > console)
- Implemented detectAnomalies() with all four locked detection rules and correct severity tiers (critical/warning/info)
- Cross-references performance marks with DOM mutations from state.jsonl for per-page event chains (race condition detection)
- Created comprehensive mock session fixture for deterministic testing
- Validated against real session data (90 timeline entries, clean session correctly returns 0 anomalies)

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Test fixtures and timeline merger**
   - `7fea573` (test) - Failing tests + mock session fixtures
   - `a88848f` (feat) - Timeline merger implementation, 5/5 tests pass
2. **Task 2: Anomaly detector with four detection rules**
   - `27052c0` (test) - Failing tests for all 10 behaviors
   - `9bcaa10` (feat) - Anomaly detector implementation, 10/10 tests pass
   - `0f5cbc6` (fix) - Handle both filename/path fields in manifest artifacts

## Files Created/Modified
- `debug/lib/timeline-merger.mjs` - Merges state/performance/console JSONL into sorted timeline
- `debug/lib/anomaly-detector.mjs` - Four anomaly detection rules with severity tiers
- `debug/fixtures/mock-session/` - Synthetic session data (manifest, 3 JSONL files, 3 PNG screenshots)
- `tests/timeline-merger.test.mjs` - 5 unit tests for timeline merging
- `tests/anomaly-detector.test.mjs` - 10 unit tests for anomaly detection

## Decisions Made
- Support both `filename` and `path` fields in manifest artifacts for compatibility with real session data (which uses `path`) and test fixtures (which use `filename`)
- Source priority for stable tie-breaking: performance first (most precise timing), then state, then console

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Real manifest uses path field instead of filename**
- **Found during:** Task 2 verification against real session data
- **Issue:** Plan specified `a.filename` but real manifest.json artifacts use `a.path` for screenshot entries
- **Fix:** Added fallback: `a.filename || a.path` in screenshot parsing
- **Files modified:** debug/lib/anomaly-detector.mjs
- **Verification:** All 15 tests pass + real session data processes successfully (90 entries, 0 anomalies)
- **Committed in:** 0f5cbc6

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for real-world compatibility. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Timeline merger and anomaly detector ready for Plan 08-02 (visual diff, timeline narrative, post-process orchestrator)
- Mock session fixture available for downstream tests
- detectAnomalies() output schema matches CONTEXT.md specification for Phase 9 consumption

## Self-Check: PASSED

- 12/12 files verified present
- 5/5 commits verified in git log

---
*Phase: 08-post-processing-analysis*
*Completed: 2026-03-13*
