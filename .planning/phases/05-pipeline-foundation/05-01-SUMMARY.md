---
phase: 05-pipeline-foundation
plan: 01
subsystem: testing
tags: [vite, react, dev-route, pdf-viewer, playwright-prep, fixture-serving]

# Dependency graph
requires:
  - phase: none
    provides: first plan of v2.0 milestone
provides:
  - Dev-only test route at localhost:5173?testPdf=<name> that bypasses auth
  - Vite plugin serving debug/fixtures/ at /debug-fixtures/ in dev mode
  - Test PDF fixture (Package 2 - Rev 4 -- IC.pdf) committed for CI reproducibility
  - Mock AuthContext and MSGraphContext providers for unauthenticated rendering
  - window.__devTestPdf pattern for auto-opening PDFs without dashboard interaction
affects: [05-02 Playwright harness, phase-6 debug bridge, phase-7 scenario execution]

# Tech tracking
tech-stack:
  added: []
  patterns: [dev-route-bypass, vite-dev-plugin, mock-context-providers, window-flag-ipc]

key-files:
  created:
    - src/DevTestRoute.jsx
    - debug/fixtures/Package 2 - Rev 4 -- IC.pdf
  modified:
    - src/main.jsx
    - src/App.jsx
    - src/contexts/AuthContext.jsx
    - src/contexts/MSGraphContext.jsx
    - src/components/OptionalAuthPrompt.jsx
    - vite.config.js
    - .gitignore

key-decisions:
  - "Export raw AuthContext and MSGraphContext objects so DevTestRoute can provide mock values without duplicating provider logic"
  - "Use window.__devTestPdf flag pattern for IPC between DevTestRoute and App component"
  - "Dynamic import() for DevTestRoute ensures zero production bundle impact"
  - "Suppress OptionalAuthPrompt modal via window.__devTestPdf guard in DEV mode"

patterns-established:
  - "Dev-route bypass: import.meta.env.DEV guard in main.jsx with dynamic import for test components"
  - "Mock provider pattern: Raw context export + Provider wrapper with no-op functions for dev testing"
  - "Fixture serving: Vite configureServer middleware for dev-only static file serving"

requirements-completed: [FOUN-01, FOUN-02]

# Metrics
duration: ~25min
completed: 2026-03-12
---

# Phase 5 Plan 01: Dev Test Route Summary

**Dev-only test route with Vite fixture plugin loads PDF viewer without auth via `?testPdf=` parameter, with mock context providers and zero production build footprint**

## Performance

- **Duration:** ~25 min (across checkpoint pause)
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 9

## Accomplishments
- Dev test route bypasses entire auth stack: navigating to `localhost:5173?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf` loads the PDF viewer with annotation toolbar visible, no login modal
- Vite plugin serves test PDF fixtures from `debug/fixtures/` at `/debug-fixtures/` during development only (configureServer is never included in production)
- Production build verified clean: `npm run build` produces zero references to DevTestRoute, testPdf, debug-fixtures, or __devTestPdf in dist/assets/
- Foundation ready for Plan 02 (Playwright harness) to drive against the dev route

## Task Commits

Each task was committed atomically:

1. **Task 1: Create debug fixture infrastructure and Vite plugin** - `8cf6fc1` (chore)
2. **Task 2: Implement dev test route bypass in main.jsx and DevTestRoute** - `2a63e0e` (feat)
3. **Task 3: Verify dev test route loads PDF without auth** - Human-verified (checkpoint approved)

**Additional fix:** `8565379` (fix) - Suppress auth modal in dev test mode (see Deviations)

## Files Created/Modified
- `src/DevTestRoute.jsx` - Dev-only component that fetches test PDF and renders App with mock auth/MSGraph providers
- `src/main.jsx` - Dev route detection via `import.meta.env.DEV` guard with dynamic import before normal render tree
- `src/App.jsx` - Added `window.__devTestPdf` check in DEV-guarded useEffect to auto-open test PDF on mount
- `src/contexts/AuthContext.jsx` - Exported raw `AuthContext` object for mock provider usage
- `src/contexts/MSGraphContext.jsx` - Exported raw `MSGraphContext` object for mock provider usage
- `src/components/OptionalAuthPrompt.jsx` - Added DEV-guarded check to suppress auth modal when `window.__devTestPdf` is set
- `vite.config.js` - Added `serve-debug-fixtures` plugin with configureServer middleware
- `debug/fixtures/Package 2 - Rev 4 -- IC.pdf` - Test PDF fixture with annotations on page 6
- `.gitignore` - Added `debug/debug-sessions/` exclusion

## Decisions Made
- **Export raw context objects:** AuthContext and MSGraphContext now export the raw `createContext` result alongside their provider components, enabling DevTestRoute to wrap App with mock values without duplicating provider internals
- **window.__devTestPdf IPC:** Rather than modifying App's prop interface (risky in a 1.3MB monolith), used a window flag that App checks in a DEV-guarded useEffect on mount
- **Dynamic import for tree-shaking:** DevTestRoute is loaded via `import('./DevTestRoute')` inside an `if (import.meta.env.DEV)` block, so Vite/esbuild eliminates the entire branch and dynamic import in production builds

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Suppressed OptionalAuthPrompt auth modal in dev test mode**
- **Found during:** Task 3 (human verification checkpoint)
- **Issue:** The `useOptionalAuth` hook in `OptionalAuthPrompt.jsx` was auto-showing the auth modal for non-authenticated users, even in dev test mode. The modal appeared on top of the PDF viewer, blocking interaction.
- **Fix:** Added a DEV-guarded check for `window.__devTestPdf` in OptionalAuthPrompt.jsx that skips showing the auth modal when the dev test route is active.
- **Files modified:** `src/components/OptionalAuthPrompt.jsx`
- **Verification:** User confirmed auth modal no longer appears, PDF loads correctly
- **Committed in:** `8565379`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for the dev route to be usable. The auth modal was not anticipated in the plan because the mock AuthContext was expected to prevent it, but OptionalAuthPrompt had its own independent check. No scope creep.

## Issues Encountered
- OptionalAuthPrompt.jsx had an independent auth-status check separate from AuthContext that was not identified during planning. The component auto-shows a modal for unauthenticated users regardless of the mock provider values. This was caught during human verification and fixed with a targeted DEV guard.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Dev test route is fully operational and human-verified
- Plan 02 (Playwright harness) can now target `localhost:5173?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf` for automated testing
- The `window.__devTestPdf` flag is available for Plan 02 to detect when the PDF has been auto-opened
- Test PDF fixture at `debug/fixtures/` is committed and available on any machine that clones the repo

## Self-Check: PASSED

All 9 referenced files verified present on disk. All 3 commit hashes (8cf6fc1, 2a63e0e, 8565379) verified in git log.

---
*Phase: 05-pipeline-foundation*
*Completed: 2026-03-12*
