# Phase 7: Capture Modules + Scenario Execution - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A deterministic scenario script drives the app through a zoom sequence, captures synchronized artifacts (video, screenshots, console, state, performance), determines pass/fail, and is runnable from a single CLI command (`npm run debug:scenario <name>`). Scenarios are parameterizable (zoom range, speed, starting page). No post-processing, no anomaly detection, no LLM integration — those are Phases 8-9.

</domain>

<decisions>
## Implementation Decisions

### Screenshot naming convention
- Combined step + timestamp format: `step-01_02150ms_before-zoom-200pct.png`
- Step number for ordering, sessionMs for timeline correlation, action description for human readability
- Baseline screenshot at step-00: `step-00_00000ms_baseline.png`
- Before/after pairs at each scripted action boundary

### JSONL stream separation
- **state.jsonl** — Bridge snapshots captured at step boundaries (one entry per step). Contains: sessionMs, step number, action name, zoomLevel, renderedScale, targetScale, freezeState, canvasContainerCount, pageStatus array, drained mutations
- **performance.jsonl** — High-frequency timing events. Contains: performance.mark() entries (zoom_start, portal_freeze, pal_mount, fabric_renderEnd, etc.) AND CDP metrics (LayoutCount, Long Tasks, paint timing). Each entry has sessionMs and type ('mark' or 'cdp')
- Different cadences, different consumers — state is per-step, performance is continuous

### Synchronized timeline baseline
- sessionMs = browser's `performance.now()` (already used by Phase 6 bridge snapshots)
- All JSONL entries stamped with sessionMs relative to `performance.timeOrigin`
- Screenshots encode sessionMs in filename
- Video alignment: manifest records `captureStartMs` so video frame offset = sessionMs - captureStartMs
- No explicit sync event needed — performance.timeOrigin is the universal anchor

### Console capture
- Capture ALL levels: log, warn, error, info — no filtering at capture time
- Each entry tagged with level field for downstream filtering
- Include stack traces for error-level messages
- Format: `console.jsonl` with entries like `{"sessionMs":5100,"level":"error","text":"...","stackTrace":"..."}`
- Philosophy: capture everything, Phase 8 anomaly detection does the filtering

### Claude's Discretion
- Scenario authoring model (Playwright test format vs standalone script vs custom abstraction)
- CLI entry point implementation (`npm run debug:scenario <name>` wiring)
- Pass/fail criteria specifics (thresholds, strictness, how result is surfaced)
- Parameter passing mechanism (CLI flags vs config object)
- Video recording configuration (Playwright built-in vs CDP)
- Capture module internal architecture (how capture modules coordinate)
- How CDP `Performance.getMetrics` is polled and at what frequency

</decisions>

<specifics>
## Specific Ideas

- The session folder layout should look clean and scannable — step-numbered screenshots with timestamps make it easy to visually scan a session folder and immediately understand what happened
- State snapshots at step boundaries should drain mutations from the bridge ring buffer (Phase 6's `snapshot({ drainMutations: true })`) to capture all DOM events since the last step
- Performance marks are the high-frequency signal for race condition diagnosis — they show exactly when zoom_start, portal_freeze, pal_mount, fabric_renderEnd happen relative to each other (sub-millisecond)
- CDP metrics (LayoutCount, Long Tasks) are the "system health" signal — they show if the browser is under load or layout-thrashing during zoom operations

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `debug/lib/session.mjs`: Session creation (`createSession()`) and manifest finalization (`finalizeSession()`) — already handles timestamped folder creation, git SHA capture, and manifest writing
- `debug/scenarios/smoke.spec.mjs`: Working Playwright test pattern with page navigation, canvas validation, screenshot capture, and session lifecycle
- `debug/scenarios/bridge-snapshot.spec.mjs`: Working pattern for `waitFor('ready')` readiness signals and bridge snapshot validation
- `debug/playwright.config.mjs`: Playwright config with chromium channel, viewport 1400x900, webServer auto-start, video currently 'off'
- `src/utils/debugBridge.js`: Bridge module with `snapshot()`, `waitFor()`, `debugMark()` — the instrumentation API this phase captures from

### Established Patterns
- Playwright `page.on('console')` for console message interception — standard Playwright API
- `window.__debugBridge.snapshot({ drainMutations: true })` for atomic state + mutation capture
- `window.__debugReady.waitFor('ready')` before screenshots to avoid race conditions (CAPT-08)
- `performance.now()` as sessionMs basis — already used throughout bridge snapshots
- Session folder naming: `<timestamp>_<scenario>/` with `manifest.json`

### Integration Points
- `debug/playwright.config.mjs`: Needs video enabled ('on' or 'retain-on-failure') for CAPT-02
- `debug/lib/session.mjs`: Needs extension for artifact registration during capture (currently only at finalization)
- `package.json`: Needs `debug:scenario` script entry (FOUN-08)
- Bridge `snapshot()` API: Polled at each step boundary for state.jsonl
- `performance.getEntriesByType('mark')`: Collected for performance.jsonl (bridge marks)
- CDP `Performance.getMetrics`: Polled for system-level metrics in performance.jsonl

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-capture-modules-scenario-execution*
*Context gathered: 2026-03-12*
