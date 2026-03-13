# Phase 6: Debug Bridge + Readiness Signals - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

App instrumentation exposing internal rendering state through window globals (`window.__debugBridge`, `window.__debugReady`) that external tools (Playwright) can query without altering timing-sensitive behavior. Includes DOM mutation monitoring for Syncfusion page lifecycle events and performance marks in hot paths. No capture modules, no scenario scripts, no post-processing — those are Phases 7-9.

</domain>

<decisions>
## Implementation Decisions

### Bridge API shape
- Layered architecture: `window.__debugBridge.snapshot()` returns lightweight core rendering state by default
- Optional enrichment via `snapshot({ include: ['perf', 'debug'] })` merges in pdfPerf timers and pdfDebug counters/rates
- Bridge is the single source of truth for all debug state capture
- Core snapshot includes per-visible-page 4-layer status:
  1. Page visible (from useVisiblePages)
  2. Syncfusion `e-pv-page-div` exists in DOM
  3. PageAnnotationLayer (React) is mounted
  4. Fabric.js canvas is initialized
- This 4-layer status directly exposes the failure mode: Syncfusion destroys/recreates a page but React layer fails to remount annotations
- Bridge stamps each snapshot with `sessionMs` via `performance.now()` — aligns with Phase 7 synchronized timeline (CAPT-06)
- Snapshot polling only — no event subscription system. Phase 7 capture modules poll at step boundaries
- Existing `window.pdfDebug`, `window.pdfPerf`, and `window.__pdfHistoryDebug` remain accessible but bridge consolidates them

### Readiness signal design
- Promise-based public API: `window.__debugReady.waitFor(condition)` returns a Promise
- Four granular internal signals tracked:
  1. `pdfLoaded` — PDF document fully loaded
  2. `zoomSettled` — zoom operation complete, no pending scale changes
  3. `domSettled` — no `e-pv-page-div` mutations for debounce period (50-100ms)
  4. `annotationsMounted` — PAL + Fabric.js canvas fully mounted on target page(s)
- `waitFor('ready')` resolves only when ALL four signals are true
- Per-page targeting: `waitFor('annotationsMounted', { page: 6 })` waits for specific page; no page param defaults to all visible pages
- Bridge-level timeout with state-in-rejection: timeout rejects with descriptive error including exact current state (e.g., "Timeout waiting for annotationsMounted. Current state: { pdfLoaded: true, zoomSettled: true, domSettled: true, annotationsMounted: false }")
- Fresh promise per `waitFor()` call: resolves on NEXT transition to settled. If already settled, resolves immediately. Unresolved promises from previous calls reject with 'superseded'
- Debounced settle detection: signals only flip to true after debounce period (50-100ms) of zero relevant activity — prevents false positives from intermediate Syncfusion layout passes

### DOM mutation tracking
- Single root-level MutationObserver on Syncfusion viewer container with `{ childList: true, subtree: true }`
- Aggressive filtering: only record `e-pv-page-div` add/remove events; check `mutation.target.classList.contains('e-pv-page-div')` before any processing; drop all noise from Syncfusion internal text-layer or canvas updates
- No per-page-div observers — managing individual observers in a virtualized viewer with constantly destroyed pages causes memory leaks and race conditions
- Rich mutation records: `{ type: 'added'|'removed', pageNumber, sessionMs, hasAnnotationLayer: bool, hasFabricCanvas: bool, seq, pairSeq }`
- Sequence pairing (seq/pairSeq) enables precise destroy-to-recreate gap analysis — shows exact milliseconds a page was missing from DOM
- Ring buffer storage (fixed size, e.g., last 100 mutations) prevents unbounded memory growth
- Atomic drain operation: `snapshot({ drainMutations: true })` pulls mutations and clears buffer simultaneously — prevents loss during rapid mutation bursts (150+ mutations during fast scroll/zoom)
- **Cascading invalidation**: MutationObserver IS the source of truth for `domSettled`. When `e-pv-page-div` is added/removed, `domSettled` flips to false AND `annotationsMounted` is immediately invalidated for that specific page. This guarantees Playwright waits for both DOM settle AND full React/Fabric.js remount cycle before proceeding

### Hot-path instrumentation
- Instrument ALL rendering events: zoom start/end, portal host freeze/unfreeze, PAL mount/unmount, Fabric.js renderAll start/end, Syncfusion page render callbacks, scroll-triggered re-renders, lightweight overlay swap in/out
- Performance marks stay in browser's native Performance API — Phase 7 captures via CDP (`Performance.getMetrics`), bridge does NOT duplicate this data
- Centralized `debugMark('category_event', { page: 6 })` function in bridge module — maps to `performance.mark(name, { detail })` API
- Naming convention: flat `category_event` namespace (e.g., `zoom_start`, `zoom_end`, `portal_freeze`, `portal_unfreeze`, `pal_mount`, `pal_unmount`, `fabric_renderStart`, `fabric_renderEnd`, `dom_pageAdded`, `dom_pageRemoved`)
- Second parameter provides structured context via native `{ detail }` API — essential for page-level correlation in Phase 8/9
- Compile-time guarded via centralized function (not inline `if` checks) — Vite dead-code elimination strips empty function body from production builds. Zero overhead guaranteed (INST-04, INST-06)

### Claude's Discretion
- Ring buffer size (100 is a starting point — tune based on testing)
- Default timeout value for waitFor() (reasonable default, configurable)
- Debounce period within 50-100ms range
- Exact MutationObserver target element selection (which container element to observe)
- How to wire readiness signals into existing App.jsx refs without restructuring the monolith
- Bridge module file location and internal architecture

</decisions>

<specifics>
## Specific Ideas

- The 4-layer per-page status (visible → Syncfusion DOM → PAL mounted → Fabric.js initialized) directly maps to the failure mode being debugged: Syncfusion virtualizes pages, and the race condition occurs when the React annotation layer fails to remount after Syncfusion recreates the underlying page div
- waitFor() timeout rejection must include the exact granular state at failure time — "Timeout waiting for annotationsMounted. Current state: { pdfLoaded: true, zoomSettled: true, domSettled: true, annotationsMounted: false }" — this makes diagnosing flaky tests significantly faster than Playwright's generic "evaluate timeout exceeded"
- The cascading invalidation pattern (domSettled=false → annotationsMounted=false for that page) is the architectural centerpiece — it guarantees that any Syncfusion DOM destruction forces a complete wait-for-remount before Playwright can proceed
- Syncfusion can fire 150+ DOM mutations during a fast scroll/zoom — the drain operation prevents the ring buffer from overwriting the exact error evidence before Playwright captures it
- Per-page `waitFor('annotationsMounted', { page: 6 })` avoids test flakiness from partially-visible adjacent pages that haven't finished rendering

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/pdfDebug.js`: Existing `window.pdfDebug` with counters, event rates, snapshots via `getDebugSnapshot()` — bridge can delegate to this for the `include: ['debug']` option
- `src/utils/performanceLogger.js`: Existing `window.pdfPerf` with timer/mark/summary API — bridge delegates to this for `include: ['perf']` option
- `window.__pdfHistoryDebug`: Existing undo/redo debug API
- `window.__devTestPdf`: Established pattern for dev-only window globals (Phase 5)

### Established Patterns
- `import.meta.env.DEV` compile-time guard for zero production code — used by dev test route, same pattern for bridge module
- Key refs already in App.jsx that bridge needs to expose: `zoomOverlayTransformActiveRef`, `syncfusionScaleConfirmPendingRef`, `syncfusionLastNonEmptyOverlayPagesRef`, `syncfusionInteractionPortalHostsRef`, `renderedScale`, `cssScale`, `isZooming`, `scale` (zoom level)
- `useVisiblePages` hook provides IntersectionObserver-based visible page tracking
- `useZoomState` hook provides `renderedScale`, `cssScale`, `isZooming`, `zoomStyle`, `setAnchor`
- Confirm-pending timer is 3000ms — `syncfusionScaleConfirmPendingRef` tracks this window
- `shouldFreezePortalHost` computed in render loop from multiple conditions

### Integration Points
- `src/App.jsx` (line ~9003+): Ref declarations where bridge would read state
- `src/App.jsx` (line ~23521): `shouldFreezePortalHost` computation — key state for bridge
- `src/App.jsx` render loop: Where per-page portal host resolution and freeze logic runs
- `src/PageAnnotationLayer.jsx`: Where PAL mount/unmount and Fabric.js renderAll happens — needs debugMark() calls
- Syncfusion viewer container: MutationObserver target for DOM tracking
- `src/components/SyncfusionPDFContainer.jsx`: Where viewer is mounted — observer attachment point

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-debug-bridge-readiness-signals*
*Context gathered: 2026-03-12*
