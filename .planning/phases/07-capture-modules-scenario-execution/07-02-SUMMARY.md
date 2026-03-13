---
phase: 07-capture-modules-scenario-execution
plan: 02
subsystem: testing
tags: [playwright, zoom-flicker, scenario-test, capture-context, parameterization]

# Dependency graph
requires:
  - phase: 07-capture-modules-scenario-execution (Plan 01)
    provides: CaptureContext coordinator and leaf capture modules (screenshot, console, state, perf)
  - phase: 06-debug-instrumentation
    provides: debugBridge.snapshot(), debugReady.waitFor(), readiness signals
  - phase: 05-test-infrastructure
    provides: Playwright config, dev test route, smoke test patterns
provides:
  - zoom-flicker scenario test with full capture pipeline end-to-end
  - debug:scenario CLI entry point for running scenarios by name
  - Parameterizable zoom sequence via environment variables
  - Automatic pass/fail determination with criteriaResults in manifest
affects: [08-diff-analysis, 09-reporting]

# Tech tracking
tech-stack:
  added: []
  patterns: [scenario-first capture pattern, env-var parameterization, afterEach video lifecycle with page.close()]

key-files:
  created:
    - debug/scenarios/zoom-flicker.spec.mjs
  modified:
    - package.json
    - debug/lib/console-capture.mjs

key-decisions:
  - "Navigate and wait for readiness BEFORE CaptureContext.start() (takeScreenshot calls waitFor internally)"
  - "page.close() in afterEach before video.saveAs() to trigger Playwright video finalization"
  - "Ensure console.jsonl file creation on capture start even if no console messages fire"

patterns-established:
  - "Scenario pattern: navigate -> waitFor(ready) -> CaptureContext.start() -> ctx.step() loop -> finalize"
  - "Video lifecycle: page.close() in afterEach, then video.saveAs() to session dir"
  - "Parameterization: ZOOM_MIN/ZOOM_MAX/ZOOM_STEP/START_PAGE env vars with sensible defaults"

requirements-completed: [CAPT-05, FOUN-07, FOUN-08]

# Metrics
duration: 15min
completed: 2026-03-13
---

# Phase 7 Plan 2: Zoom-Flicker Scenario Summary

**Parameterizable zoom-flicker scenario with CaptureContext integration, auto pass/fail, and debug:scenario CLI entry point**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-13T03:53:02Z
- **Completed:** 2026-03-13T04:08:27Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Complete zoom-flicker scenario that drives the app through a configurable zoom-up/zoom-down sequence on an annotated page
- Full artifact pipeline proven end-to-end: one `npm run debug:scenario -- zoom-flicker` command produces session folder with recording.webm, step-numbered screenshots, console.jsonl, state.jsonl, performance.jsonl, and manifest.json
- Auto pass/fail determination based on canvas container presence and console error absence, recorded in manifest.json criteriaResults
- Parameterization via ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, START_PAGE environment variables -- verified with ZOOM_MAX=150 producing fewer steps

## Task Commits

Each task was committed atomically:

1. **Task 1: Create zoom-flicker scenario with parameterization and pass/fail** - `e30a7cb` (feat)
2. **Task 2: Add CLI entry point and verify full end-to-end pipeline** - `6d41685` (feat)

## Files Created/Modified
- `debug/scenarios/zoom-flicker.spec.mjs` - Zoom-flicker scenario test with env-var parameterization, CaptureContext integration, and auto pass/fail criteria
- `package.json` - Added debug:scenario npm script entry point
- `debug/lib/console-capture.mjs` - Ensure console.jsonl file creation on capture start

## Decisions Made
- Navigate and wait for readiness BEFORE CaptureContext.start() -- the takeScreenshot module calls waitFor('ready') internally, so the debug bridge must exist before start() is called
- Use page.close() in afterEach before video.saveAs() -- Playwright only finalizes the video file after the page/browser context closes; saveAs() blocks indefinitely if called while the page is still open
- Create console.jsonl file on capture start even if no console messages fire -- ensures complete artifact set in every session folder

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CaptureContext.start() called before page navigation**
- **Found during:** Task 1 (zoom-flicker scenario creation)
- **Issue:** Plan specified ctx.start() before page.goto(), but CaptureContext.start() calls takeScreenshot which calls window.__debugReady.waitFor('ready') -- the bridge doesn't exist on a blank page
- **Fix:** Reordered to navigate first, wait for bridge/readiness, then call ctx.start()
- **Files modified:** debug/scenarios/zoom-flicker.spec.mjs
- **Verification:** Test passes on first run after reorder
- **Committed in:** e30a7cb (Task 1 commit)

**2. [Rule 1 - Bug] page.video().saveAs() hanging in afterEach**
- **Found during:** Task 1 (zoom-flicker scenario creation)
- **Issue:** Playwright's saveAs() waits for video finalization which happens after the page closes, but afterEach runs while the page is still alive -- causing indefinite hang
- **Fix:** Call page.close() in afterEach before saveAs() to trigger video finalization
- **Files modified:** debug/scenarios/zoom-flicker.spec.mjs
- **Verification:** Test completes in ~7s instead of timing out at 120s+
- **Committed in:** e30a7cb (Task 1 commit)

**3. [Rule 2 - Missing Critical] console.jsonl not created when no console messages fire**
- **Found during:** Task 1 (zoom-flicker scenario creation)
- **Issue:** console-capture.mjs only creates the file on first appendFileSync call; if no console messages fire during a run, the file doesn't exist and the artifact set is incomplete
- **Fix:** Added writeFileSync with flag 'a' at capture start to ensure file existence
- **Files modified:** debug/lib/console-capture.mjs
- **Verification:** console.jsonl present in session folder even with zero console messages
- **Committed in:** e30a7cb (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing critical)
**Impact on plan:** All fixes necessary for correctness. No scope creep. The plan's task ordering and video lifecycle assumptions needed adjustment for Playwright's actual behavior.

## Issues Encountered
- Test timeout at 120s was insufficient for 9 zoom steps with readiness waits -- added test.setTimeout(300_000) for the zoom-flicker test (generous 5-minute timeout, actual run is ~7s when server is warm)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete capture pipeline validated: scenario -> CaptureContext -> leaf modules -> session folder with all artifacts
- Ready for Phase 8 (diff analysis) which can consume the step-numbered screenshots and state.jsonl data
- The zoom-flicker scenario can be used as a regression test and as a debug artifact generator for investigating post-zoom annotation rendering issues

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 07-capture-modules-scenario-execution*
*Completed: 2026-03-13*
