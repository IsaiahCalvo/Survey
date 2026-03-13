---
phase: 05-pipeline-foundation
plan: 02
subsystem: testing
tags: [playwright, chromium, canvas-capture, session-management, smoke-test, fabric-js]

# Dependency graph
requires:
  - phase: 05-pipeline-foundation plan 01
    provides: Dev test route at localhost:5173?testPdf=<name> bypassing auth
provides:
  - Playwright test harness with Chromium channel and webServer auto-start
  - Session folder infrastructure (timestamped folders with manifest.json)
  - Smoke test proving Fabric.js canvas content is captured in automated screenshots
  - test:debug npm script for convenience
affects: [phase-6 debug bridge, phase-7 scenario execution, phase-7 capture modules]

# Tech tracking
tech-stack:
  added: ["@playwright/test"]
  patterns: [session-folder-per-run, canvas-pixel-validation, manifest-driven-artifacts]

key-files:
  created:
    - debug/playwright.config.mjs
    - debug/lib/session.mjs
    - debug/scenarios/smoke.spec.mjs
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Conservative waitForTimeout delays (5s each) for Syncfusion/Fabric.js render settling -- user noted these should be optimized in future phases"
  - "Canvas pixel sampling at every 100th pixel for speed vs accuracy tradeoff in content validation"
  - "Session manifest uses 40-char git SHA for exact commit traceability"
  - "Playwright channel:chromium (new headless mode) for real Chrome canvas rendering"

patterns-established:
  - "Session folder pattern: debug/debug-sessions/<YYYYMMDDTHHMMSS>_<scenario>/ with manifest.json"
  - "Canvas content validation: pixel sampling via page.evaluate with getImageData"
  - "Playwright config: webServer auto-starts Vite, reuseExistingServer for fast iteration"

requirements-completed: [FOUN-03, FOUN-04, FOUN-05, FOUN-06]

# Metrics
duration: ~20min
completed: 2026-03-12
---

# Phase 5 Plan 02: Playwright Harness Summary

**Playwright smoke test with canvas pixel validation proves Fabric.js annotations are captured in automated Chromium screenshots, with session folder infrastructure creating timestamped manifest-driven artifact bundles**

## Performance

- **Duration:** ~20 min (across checkpoint pause)
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 5

## Accomplishments
- Phase 5 gate PASSED: Playwright screenshot of page 6 shows real Fabric.js annotation content (colored shapes, highlights), not blank canvases
- Session folder infrastructure creates timestamped directories with manifest.json tracking scenario name, git SHA, start/end time, pass/fail result, and artifact paths
- Playwright auto-starts Vite dev server via webServer config when not already running, with reuseExistingServer for fast iteration
- Canvas content validation uses pixel sampling (every 100th pixel via getImageData) to programmatically confirm non-blank canvas content

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Playwright and create configuration + session library** - `ca7ca4e` (chore)
2. **Task 2: Write smoke test scenario with canvas capture validation** - `bdb4e44` (feat)
3. **Task 3: Verify Playwright captures Fabric.js canvas content (Phase 5 gate)** - Human-verified (checkpoint approved)

## Files Created/Modified
- `debug/playwright.config.mjs` - Playwright config with webServer auto-start, chromium channel, 1400x900 viewport, 120s timeout
- `debug/lib/session.mjs` - Session folder creation (createSession) and manifest finalization (finalizeSession) utilities with git SHA capture
- `debug/scenarios/smoke.spec.mjs` - Smoke test: opens dev route, navigates to page 6, validates canvas pixels, takes screenshot, writes manifest
- `package.json` - Added @playwright/test devDependency and test:debug npm script
- `package-lock.json` - Lock file updated for Playwright dependency

## Decisions Made
- **Chromium channel for new headless mode:** Using `channel: 'chromium'` instead of default headless for real Chrome rendering engine, better canvas support
- **Conservative timeouts:** 5s waitForTimeout delays after PDF load and page navigation. User feedback notes these should be optimized in future phases when readiness signals (Phase 6) are available
- **Pixel sampling density:** Every 100th pixel (i += 400 bytes) balances speed with reliable content detection -- 10+ non-blank pixels threshold confirms real content
- **Session folder naming:** ISO 8601 compact timestamp (`YYYYMMDDTHHMMSS`) for sortable, filesystem-safe naming

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - both auto tasks succeeded on first attempt, and human verification confirmed the Phase 5 gate passed.

## User Feedback
- The conservative `waitForTimeout` delays (5s each) make the smoke test feel slow. This is noted for optimization when Phase 6 introduces `window.__debugReady` readiness signals that replace arbitrary waits with event-driven waiting.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 5 pipeline foundation is complete: dev route + Playwright harness + session infrastructure
- Phase 6 (Debug Bridge + Readiness Signals) can build on this foundation to add `window.__debugBridge` and `window.__debugReady` signals
- The smoke test pattern established here (navigate, wait, validate, capture, manifest) will be extended in Phase 7 for full scenario execution
- Session folder infrastructure is ready for Phase 7's multi-artifact capture (video, console logs, state snapshots)
- Readiness signals from Phase 6 will replace the conservative `waitForTimeout` delays noted by the user

## Self-Check: PASSED

All 5 referenced files verified present on disk. All 2 commit hashes (ca7ca4e, bdb4e44) verified in git log.

---
*Phase: 05-pipeline-foundation*
*Completed: 2026-03-12*
