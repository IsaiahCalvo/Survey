---
phase: 06-debug-bridge-readiness-signals
plan: 01
subsystem: instrumentation
tags: [debug-bridge, performance-marks, mutation-observer, ring-buffer, vite-dce]

# Dependency graph
requires:
  - phase: 05-pipeline-foundation
    provides: Playwright harness and dev test route for automated testing
provides:
  - window.__debugBridge.snapshot() API for external tool state capture
  - RingBuffer-backed DOM mutation tracking for e-pv-page-div lifecycle
  - debugMark() centralized performance.mark() wrapper with zero prod overhead
  - Debug bridge registration pattern for React ref access from external modules
affects: [06-02-readiness-signals, 07-capture-modules, 08-scenario-scripts]

# Tech tracking
tech-stack:
  added: []
  patterns: [registration-pattern, ring-buffer, compile-time-dce, mutation-observer-filtering]

key-files:
  created:
    - src/utils/debugBridge.js
  modified:
    - src/App.jsx
    - src/PageAnnotationLayer.jsx

key-decisions:
  - "Registration pattern with debugBridgeStateRef: register once at mount, ref always holds current state values"
  - "Dynamic import in registration useEffect ensures debugBridge module is never in production bundle path"
  - "debugMark() calls placed at zoom state transition points only, not in render loop (avoids noise)"
  - "MutationObserver attached lazily: tries at register(), retries on first snapshot() if container not yet in DOM"
  - "pairSeq linking for mutation records enables destroy-to-recreate gap timing analysis"

patterns-established:
  - "Registration pattern: external module reads React refs via register({refs, getState}) without prop drilling"
  - "Compile-time guard: import.meta.env.DEV wraps function bodies, Vite DCE strips them in production"
  - "RingBuffer for bounded mutation storage with atomic drain operation"

requirements-completed: [INST-01, INST-02, INST-04, INST-05, INST-06]

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 6 Plan 1: Debug Bridge Core Module Summary

**window.__debugBridge with snapshot(), RingBuffer mutation tracking, and debugMark() hot-path instrumentation -- all compile-time guarded for zero production overhead**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T02:05:41Z
- **Completed:** 2026-03-13T02:13:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created self-contained debugBridge.js module (268 lines) with snapshot(), RingBuffer, MutationObserver, and debugMark()
- Wired App.jsx registration with debugBridgeStateRef pattern for always-fresh state access
- Placed debugMark() calls at all zoom start/end (8 locations) and portal freeze/unfreeze (2 locations) transition points in App.jsx
- Placed debugMark() calls at PAL mount/unmount and Fabric.js renderAll start/end in PageAnnotationLayer.jsx
- Verified production build has zero __debugBridge or debugMark references (Vite DCE confirmed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create debugBridge.js module** - `6cc4a1c` (feat)
2. **Task 2: Wire App.jsx registration and debugMark() hot paths** - `8265e15` (feat)

## Files Created/Modified
- `src/utils/debugBridge.js` - Core debug bridge module: RingBuffer, MutationObserver, snapshot(), debugMark(), register/unregister
- `src/App.jsx` - debugMark import, bridge registration useEffect, zoom_start/zoom_end/portal_freeze/portal_unfreeze marks
- `src/PageAnnotationLayer.jsx` - debugMark import, pal_mount/pal_unmount marks, fabric_renderStart/fabric_renderEnd marks

## Decisions Made
- Used debugBridgeStateRef pattern (Option A from plan): register once, ref mirrors current render state outside effects, getState reads ref on demand
- Dynamic import('./utils/debugBridge') in registration useEffect ensures zero production bundle impact for the registration path
- SyncfusionPDFContainer.jsx unchanged -- getPageLayerContainer was already exposed in useImperativeHandle at line 1112
- Placed debugMark at state-transition points (not in render loop) to keep marks meaningful and avoid noise
- MutationObserver uses lazy attachment: tries during register(), retries on first snapshot() call if container not in DOM yet

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Debug bridge is fully operational for dev server use
- window.__debugBridge.snapshot() returns all fields needed by INST-01 and INST-02
- Ready for Plan 06-02 (readiness signals) which will add waitFor() promise-based API
- Ready for Phase 7 capture modules which will poll snapshot() at step boundaries

## Self-Check: PASSED

- src/utils/debugBridge.js: FOUND
- 06-01-SUMMARY.md: FOUND
- Commit 6cc4a1c (Task 1): FOUND
- Commit 8265e15 (Task 2): FOUND

---
*Phase: 06-debug-bridge-readiness-signals*
*Completed: 2026-03-13*
