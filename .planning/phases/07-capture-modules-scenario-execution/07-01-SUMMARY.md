---
phase: 07-capture-modules-scenario-execution
plan: 01
subsystem: testing
tags: [playwright, cdp, jsonl, screenshot, capture, debug]

# Dependency graph
requires:
  - phase: 06-debug-bridge-readiness-signals
    provides: "window.__debugBridge.snapshot() and window.__debugReady.waitFor() browser APIs"
provides:
  - "takeScreenshot() - readiness-gated screenshot capture with step-NN naming"
  - "startConsoleCapture()/stopConsoleCapture() - browser console interception to console.jsonl"
  - "captureState() - debug bridge snapshot capture to state.jsonl"
  - "startPerfCapture()/stopPerfCapture() - CDP metrics polling + performance marks to performance.jsonl"
  - "CaptureContext class - coordinator wiring all capture modules with session lifecycle"
  - "Playwright config with video recording at 1400x900 viewport resolution"
affects: [07-02-scenario-execution, scenario-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: [JSONL-per-module single-writer, readiness-gated capture, CDP performance polling, sessionMs unified timeline]

key-files:
  created:
    - debug/lib/screenshot.mjs
    - debug/lib/console-capture.mjs
    - debug/lib/state-capture.mjs
    - debug/lib/perf-capture.mjs
    - debug/lib/capture.mjs
  modified:
    - debug/playwright.config.mjs

key-decisions:
  - "appendFileSync for JSONL writes (atomic for lines under 4096 bytes, one writer per file)"
  - "Video lifecycle left to scenario afterEach hooks (Playwright requires page.video().saveAs() after test body)"
  - "captureStartMs recorded in manifest for video-to-sessionMs timestamp correlation"

patterns-established:
  - "Single-writer JSONL: each .jsonl file has exactly one capture module that writes to it"
  - "Readiness-gated screenshots: every takeScreenshot call waits for waitFor('ready') first"
  - "CaptureContext.step() pattern: before-screenshot, state-capture, action, waitFor-ready, after-screenshot"
  - "Module-level state for cleanup references (handler, cdpClient, pollInterval)"

requirements-completed: [CAPT-01, CAPT-02, CAPT-03, CAPT-04, CAPT-06, CAPT-07, CAPT-08]

# Metrics
duration: 3min
completed: 2026-03-13
---

# Phase 7 Plan 1: Capture Modules Summary

**Five importable capture modules (screenshot, console, state, perf, coordinator) with JSONL single-writer pattern and CDP performance polling, plus Playwright video at 1400x900**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-13T03:47:27Z
- **Completed:** 2026-03-13T03:50:15Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Four leaf capture modules each owning exactly one output file (screenshots or JSONL)
- CaptureContext coordinator class wiring all modules with start/step/finalize lifecycle
- Playwright config updated with video recording at viewport resolution for 1:1 pixel mapping
- All modules use sessionMs as unified timeline key for cross-artifact correlation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create four leaf capture modules** - `923644a` (feat)
2. **Task 2: Create CaptureContext coordinator and enable video** - `e6755d1` (feat)

## Files Created/Modified
- `debug/lib/screenshot.mjs` - Readiness-gated screenshot capture with step-NN_MMMMMms_timing-description.png naming
- `debug/lib/console-capture.mjs` - Browser console message interception writing console.jsonl with sessionMs timestamps
- `debug/lib/state-capture.mjs` - Debug bridge snapshot capture writing state.jsonl with drainMutations
- `debug/lib/perf-capture.mjs` - CDP Performance.getMetrics polling at 500ms + performance mark collection to performance.jsonl
- `debug/lib/capture.mjs` - CaptureContext coordinator class importing all four modules + session.mjs
- `debug/playwright.config.mjs` - Video mode changed from 'off' to { mode: 'on', size: { width: 1400, height: 900 } }

## Decisions Made
- Used appendFileSync for JSONL writes (atomic for lines under 4096 bytes) with single-writer-per-file pattern to prevent corruption
- Video lifecycle deliberately left out of CaptureContext -- Playwright requires page.video().saveAs() in afterEach hook, so scenario files handle it
- captureStartMs recorded in manifest so video timestamps can be correlated: video frame offset = sessionMs - captureStartMs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All five capture modules are importable and ready for scenario test files (Plan 07-02)
- CaptureContext provides the step() API that scenario tests will call for each user action
- Video recording is enabled in Playwright config; scenarios just need to call page.video().saveAs() in afterEach
- No new npm dependencies were added

---
*Phase: 07-capture-modules-scenario-execution*
*Completed: 2026-03-13*
