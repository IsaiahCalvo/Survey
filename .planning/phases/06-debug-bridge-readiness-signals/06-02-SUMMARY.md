---
phase: 06-debug-bridge-readiness-signals
plan: 02
subsystem: instrumentation
tags: [readiness-signals, waitFor, promise-api, debounce, playwright-integration, annotation-detection]

# Dependency graph
requires:
  - phase: 06-debug-bridge-readiness-signals
    plan: 01
    provides: debugBridge.js core module with snapshot(), debugMark(), MutationObserver, RingBuffer
provides:
  - window.__debugReady.waitFor() promise-based readiness signal API
  - Four signals (pdfLoaded, zoomSettled, domSettled, annotationsMounted) with debounced settle detection
  - Per-page annotation tracking via perPageAnnotationStatus
  - Cascading invalidation (domSettled -> annotationsMounted for affected pages)
  - Playwright integration tests validating INST-01 through INST-06
affects: [07-capture-modules, 08-scenario-scripts]

# Tech tracking
tech-stack:
  added: []
  patterns: [debounced-signal-state-machine, dom-based-visible-page-detection, promise-waiter-pattern]

key-files:
  created:
    - debug/scenarios/bridge-snapshot.spec.mjs
    - debug/scenarios/readiness-signals.spec.mjs
  modified:
    - src/utils/debugBridge.js
    - src/App.jsx

key-decisions:
  - "DOM-based visible page detection instead of React state: getDomVisiblePages() queries .e-pv-page-div elements directly to avoid stale visiblePages from useVisiblePages hook lag"
  - "canvas-container as sole annotation detection marker: PAL has no .annotation-layer class; Fabric.js canvas-container proves both PAL mount and canvas initialization"
  - "10ms deferred check after pal_mount and fabric_renderEnd: ensures DOM is fully settled before querying for canvas-container"
  - "Timeout rejection includes full signal state and perPageAnnotationStatus for debugging"

patterns-established:
  - "DOM-based visible page detection: query .e-pv-page-div[data-page-number] directly instead of relying on React IntersectionObserver state"
  - "Debounced signal settle: signals flip false immediately on invalidation, true only after debounce (75ms) of inactivity"
  - "Readiness-based test waiting: waitFor('ready') replaces waitForTimeout(5000) for deterministic, faster test execution"

requirements-completed: [INST-03]

# Metrics
duration: 11min
completed: 2026-03-13
---

# Phase 6 Plan 2: Readiness Signals and Playwright Integration Tests Summary

**Promise-based waitFor() readiness API with four debounced signals, per-page annotation tracking, and 8 Playwright integration tests covering INST-01 through INST-06**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-13T02:16:50Z
- **Completed:** 2026-03-13T02:28:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added complete waitFor() readiness signal system to debugBridge.js with four signals (pdfLoaded, zoomSettled, domSettled, annotationsMounted), debounced settle detection (75ms), cascading invalidation, and per-page annotation tracking
- Created 8 Playwright integration tests: 5 bridge-snapshot tests (INST-01/02/05/06) and 3 readiness-signal tests (INST-03), all passing
- Wired signals into existing debugMark() calls (zoom_start/end, pal_mount/unmount, fabric_renderEnd, pdf_loaded) and MutationObserver
- Proved readiness signals work in practice: tests use waitFor('ready') instead of waitForTimeout(5000), running in ~4s per test instead of 14s

## Task Commits

Each task was committed atomically:

1. **Task 1: Add waitFor() readiness signal system** - `0ce95e7` (feat)
2. **Task 2: Create Playwright integration tests** - `ada57cc` (test) + `2cbf519` (fix: annotation detection)

## Files Created/Modified
- `src/utils/debugBridge.js` - Extended with signals state, invalidateSignal/settleSignal/markPageAnnotationMounted, waitFor() promise API, getDomVisiblePages(), window.__debugReady global
- `src/App.jsx` - Added debugMark('pdf_loaded') call in handleSyncfusionDocumentLoad
- `debug/scenarios/bridge-snapshot.spec.mjs` - 5 tests: snapshot fields, JSON round-trip, mutation drain, performance marks, 4-layer pageStatus
- `debug/scenarios/readiness-signals.spec.mjs` - 3 tests: waitFor('ready'), per-page waitFor('annotationsMounted'), timeout rejection with state

## Decisions Made
- Used DOM-based visible page detection (getDomVisiblePages) instead of React state visiblePages. The React IntersectionObserver state lags behind Syncfusion page navigation, causing annotationsMounted to never resolve. Direct DOM query is always current.
- Replaced .annotation-layer CSS selector check with .canvas-container check. PAL component does not render with an annotation-layer class. Fabric.js wraps the canvas in .canvas-container, which proves both PAL mount and Fabric.js initialization.
- Added 10ms deferred DOM check after pal_mount and fabric_renderEnd marks to ensure DOM is fully settled before querying for canvas-container presence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed annotation detection using .canvas-container instead of .annotation-layer**
- **Found during:** Task 2 (test execution)
- **Issue:** checkPageAnnotationComplete() looked for .annotation-layer CSS class which does not exist in the DOM. PAL renders a plain div with no annotation-specific class.
- **Fix:** Changed to check for .canvas-container (created by Fabric.js when canvas initializes), which proves both PAL mount and canvas ready.
- **Files modified:** src/utils/debugBridge.js
- **Verification:** All 8 Playwright tests pass
- **Committed in:** 2cbf519

**2. [Rule 1 - Bug] Fixed stale visible pages from React state causing annotationsMounted to never resolve**
- **Found during:** Task 2 (test execution)
- **Issue:** getVisiblePages() read from registered.getState().visiblePages which returned stale React IntersectionObserver state (showed page 1 as visible even after navigating to page 6). This caused annotationsMounted to check page 1 (no canvas) and never become true.
- **Fix:** Replaced with getDomVisiblePages() that queries .e-pv-page-div[data-page-number] elements directly from the DOM, always returning current page divs.
- **Files modified:** src/utils/debugBridge.js
- **Verification:** All 8 Playwright tests pass, readiness signals resolve correctly after page navigation
- **Committed in:** 2cbf519

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correct signal behavior. The plan's suggested selectors (.annotation-layer) didn't match the actual DOM structure. No scope creep.

## Issues Encountered
- Playwright --project=chromium flag requires --config debug/playwright.config.mjs to be specified (tests live outside default test directory)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All INST requirements (INST-01 through INST-06) now have integration test coverage
- Phase 6 is complete: debug bridge + readiness signals fully operational
- Ready for Phase 7 capture modules which will use waitFor('ready') for deterministic artifact capture
- waitFor() can replace all waitForTimeout(5000) delays in Playwright tests

## Self-Check: PASSED

- src/utils/debugBridge.js: FOUND
- debug/scenarios/bridge-snapshot.spec.mjs: FOUND
- debug/scenarios/readiness-signals.spec.mjs: FOUND
- Commit 0ce95e7 (Task 1): FOUND
- Commit ada57cc (Task 2 tests): FOUND
- Commit 2cbf519 (Task 2 fix): FOUND

---
*Phase: 06-debug-bridge-readiness-signals*
*Completed: 2026-03-13*
