# Architecture Research: Automated PDF Annotation Debugging Pipeline

**Domain:** Automated debugging and analysis pipeline for Electron/React PDF annotation app
**Researched:** 2026-03-12
**Confidence:** HIGH (core patterns proven in existing ralph-test prototype; Playwright APIs verified via official docs)

## System Overview

```
+=========================================================================+
|                    ORCHESTRATION LAYER (Node.js)                        |
|  +------------------+  +------------------+  +---------------------+   |
|  | Session Manager  |  | Scenario Runner  |  | Post-Processor      |   |
|  | (folder-per-run) |  | (deterministic   |  | (keyframes, anomaly |   |
|  |                  |  |  Playwright       |  |  detection, LLM     |   |
|  |                  |  |  scripts)         |  |  chunking)          |   |
|  +--------+---------+  +--------+---------+  +---------+-----------+   |
|           |                     |                      |               |
+===========|=====================|======================|===============+
            |                     |                      |
            v                     v                      v
+=========================================================================+
|                     CAPTURE LAYER (Playwright + CDP)                    |
|  +-------------+  +-----------+  +----------+  +------------------+   |
|  | Video/Trace |  | Screenshot|  | Console  |  | App State        |   |
|  | (built-in)  |  | (timed +  |  | + Events |  | (via bridge)     |   |
|  |             |  |  on-event)|  | (CDP)    |  |                  |   |
|  +------+------+  +-----+-----+  +----+-----+  +--------+---------+   |
|         |               |              |                 |             |
+=========|===============|==============|=================|=============+
          |               |              |                 |
          v               v              v                 v
+=========================================================================+
|                     APP LAYER (Browser / Vite Dev Server)               |
|  +-------------------------------------------------------------------+ |
|  | Debug Bridge (window.__debugBridge)                                | |
|  |   - exposes: zoom state, portal refs, PAL status, Fabric canvas   | |
|  |   - emits: structured events with high-resolution timestamps      | |
|  |   - read-only: no mutation of app state from outside              | |
|  +-------------------------------------------------------------------+ |
|  |                                                                   | |
|  | +------------------+  +----------------------------+              | |
|  | | App.jsx          |  | PageAnnotationLayer.jsx    |              | |
|  | | (zoom logic,     |  | (per-page Fabric.js canvas |              | |
|  | |  portal hosts,   |  |  rendering, 16 annotation  |              | |
|  | |  render loop)    |  |  types)                    |              | |
|  | +------------------+  +----------------------------+              | |
|  |                                                                   | |
|  | Existing debug APIs: window.pdfPerf, window.pdfDebug,            | |
|  |                      window.__pdfHistoryDebug                     | |
|  +-------------------------------------------------------------------+ |
+=========================================================================+
          |               |              |                 |
          v               v              v                 v
+=========================================================================+
|                     STORAGE LAYER (File System)                         |
|  sessions/                                                              |
|  +-- 2026-03-12T14-30-00_zoom-flicker/                                 |
|      +-- video.webm                                                     |
|      +-- trace.zip                                                      |
|      +-- screenshots/                                                   |
|      |   +-- 001_baseline.png                                           |
|      |   +-- 002_mid-zoom.png                                           |
|      |   +-- 003_post-zoom.png                                          |
|      +-- events.jsonl          (timestamped structured events)          |
|      +-- console.jsonl         (console messages with timestamps)       |
|      +-- app-state.jsonl       (periodic app state snapshots)           |
|      +-- performance.json      (CDP Performance.getMetrics)             |
|      +-- session-meta.json     (scenario name, config, duration, etc.)  |
|      +-- analysis/                                                      |
|          +-- timeline.json     (merged timeline of all artifact streams)|
|          +-- anomalies.json    (detected anomalies)                     |
|          +-- keyframes.json    (important moments with screenshot refs) |
|          +-- llm-chunks/       (pre-chunked context for LLM analysis)  |
|              +-- chunk-001.md  (timeline window + relevant source)      |
|              +-- chunk-002.md                                           |
+=========================================================================+
```

## Component Responsibilities

| Component | Responsibility | Communicates With | Build Order |
|-----------|---------------|-------------------|-------------|
| **Debug Bridge** | Exposes read-only app internals to Playwright via `window.__debugBridge`. Emits structured events. | App.jsx refs/state (read), Playwright page.evaluate (called by) | **Phase 1** -- must exist before capture layer can read app state |
| **Session Manager** | Creates session folders, writes metadata, manages artifact file handles, generates session IDs | File system, Scenario Runner (provides paths) | **Phase 1** -- must exist before any artifact capture |
| **Console/Event Capture** | Captures `page.on('console')` messages and CDP `Runtime.consoleAPICalled` with timestamps, writes to JSONL | Playwright page events, Session Manager (writes to) | **Phase 2** -- uses Session Manager paths |
| **Screenshot Capture** | Takes timed screenshots and event-triggered screenshots, names them sequentially | Playwright `page.screenshot()`, Scenario Runner (triggered by), Session Manager (writes to) | **Phase 2** -- simple Playwright built-in |
| **Video/Trace Capture** | Records continuous video and Playwright traces with chunk support | Playwright `context.tracing`, browser context video config | **Phase 2** -- simple Playwright built-in |
| **App State Capture** | Periodically snapshots internal app state via Debug Bridge | Debug Bridge (calls `window.__debugBridge.snapshot()`), Session Manager (writes to) | **Phase 2** -- depends on Debug Bridge |
| **Scenario Runner** | Deterministic scripts that drive zoom, pan, annotation operations. Coordinates capture start/stop. | All capture components (orchestrates), Page (drives UI) | **Phase 3** -- uses all capture components |
| **Timeline Merger** | Reads all JSONL/JSON artifacts, merges into single sorted timeline by timestamp | Session folder artifacts (reads), analysis/ folder (writes) | **Phase 4** -- post-processing, needs completed sessions |
| **Anomaly Detector** | Scans merged timeline for known patterns (cc=0 drops, portal disconnects, error bursts) | Merged timeline (reads), analysis/ folder (writes) | **Phase 4** -- post-processing |
| **LLM Chunker** | Splits timeline windows into context-sized chunks, attaches relevant source code snippets | Merged timeline + anomalies (reads), source files (reads), llm-chunks/ (writes) | **Phase 5** -- final step |

## Recommended Project Structure

```
debug/                              # All debug infrastructure (separate from src/)
+-- harness/                        # Playwright orchestration
|   +-- session-manager.mjs         # Session folder creation, metadata, cleanup
|   +-- scenario-runner.mjs         # Base class for scenario execution
|   +-- capture/                    # Individual capture modules
|   |   +-- console-capture.mjs     # Console + CDP event capture
|   |   +-- screenshot-capture.mjs  # Timed + event-triggered screenshots
|   |   +-- video-capture.mjs       # Video + trace recording
|   |   +-- app-state-capture.mjs   # Debug Bridge periodic snapshots
|   |   +-- performance-capture.mjs # CDP Performance.getMetrics polling
|   +-- scenarios/                  # Deterministic test scripts
|   |   +-- zoom-flicker.mjs        # Post-zoom annotation flicker
|   |   +-- zoom-all-methods.mjs    # All 6 zoom methods (from ralph-test)
|   |   +-- annotation-crud.mjs     # Create/edit/delete annotations
|   |   +-- _base-scenario.mjs      # Shared setup (nav to page, wait for load)
|   +-- cli.mjs                     # Entry point: node debug/harness/cli.mjs run zoom-flicker
+-- bridge/                         # In-app instrumentation (imported by App.jsx)
|   +-- debug-bridge.js             # window.__debugBridge API
|   +-- event-emitter.js            # Structured event emission with timestamps
+-- post-process/                   # Post-run analysis
|   +-- timeline-merger.mjs         # Merge artifact streams into unified timeline
|   +-- anomaly-detector.mjs        # Pattern matching on merged timeline
|   +-- keyframe-extractor.mjs      # Identify important moments, link to screenshots
|   +-- llm-chunker.mjs             # Split into LLM-friendly context windows
+-- sessions/                       # Output: folder-per-run (gitignored)
+-- playwright.config.mjs           # Playwright configuration
```

### Structure Rationale

- **`debug/` at project root, not inside `src/`:** Debug infrastructure is tooling, not application code. Keeps `src/` unchanged for production builds. Vite tree-shaking handles the bridge import via dead-code elimination when `import.meta.env.DEV` is false.
- **`harness/` vs `bridge/` separation:** The harness runs in Node.js (Playwright). The bridge runs in the browser (React app). They communicate across a process boundary via `page.evaluate()` and `page.exposeFunction()`. Keeping them in separate directories makes the process boundary explicit.
- **`capture/` as separate modules:** Each capture type is independent -- console capture does not depend on screenshot capture. Modules can be enabled/disabled per scenario. A scenario that only needs console + app-state does not pay the video recording overhead.
- **`scenarios/` with a base class:** Every scenario needs: navigate to page, wait for PDF load, set up capture, tear down. The base class handles this. Specific scenarios only define the interaction sequence and which captures to enable.
- **`sessions/` gitignored:** Session folders contain binary artifacts (video, screenshots). They belong on disk for inspection, not in version control.

## Architectural Patterns

### Pattern 1: Debug Bridge (In-App Instrumentation via Window Global)

**What:** A single `window.__debugBridge` object that exposes read-only snapshots of internal app state. It aggregates the existing debug APIs (`pdfPerf`, `pdfDebug`, `__pdfHistoryDebug`) and adds zoom-specific state that only exists as refs inside App.jsx.

**When to use:** Whenever Playwright needs information that is not visible in the DOM (ref values, internal timers, React state that does not render to DOM).

**Trade-offs:**
- Pro: Zero overhead when not called. No continuous polling from app side.
- Pro: Single integration point -- Playwright calls one API, not three separate window globals.
- Pro: Can be tree-shaken in production builds via `import.meta.env.DEV` guard.
- Con: Requires touching App.jsx to expose refs. But this is minimal -- a single `useEffect` that constructs the bridge object from existing refs.

**Integration with App.jsx (the 1.3MB monolith):**

The bridge does NOT restructure App.jsx. It reads from existing refs that are already declared. The total addition is approximately 40-60 lines -- one `useEffect` that builds the bridge object and assigns it to `window.__debugBridge`. This is the same pattern already used for `window.__pdfHistoryDebug` (line ~13735 of App.jsx).

```javascript
// In App.jsx, near existing window.__pdfHistoryDebug useEffect
useEffect(() => {
  if (!import.meta.env.DEV) return;

  window.__debugBridge = {
    // Aggregate existing APIs
    pdfPerf: window.pdfPerf,
    pdfDebug: window.pdfDebug,
    historyDebug: window.__pdfHistoryDebug,

    // Zoom state (refs already exist in App.jsx)
    zoom: () => ({
      zoomOverlayTransformActive: zoomOverlayTransformActiveRef.current,
      syncfusionScaleConfirmPending: syncfusionScaleConfirmPendingRef.current,
      shouldFreezePortalHost: /* computed from existing refs */,
      currentScale: /* from state */,
      renderedScale: /* from useZoomState */,
      isZooming: /* from useZoomState */,
    }),

    // Portal/canvas health (for cc=0 drop detection)
    canvasHealth: () => ({
      canvasContainers: document.querySelectorAll('.canvas-container').length,
      stablePortals: document.querySelectorAll('[data-stable-portal]').length,
      orphanedPortals: /* count disconnected */,
    }),

    // Full snapshot for periodic capture
    snapshot: () => ({
      timestamp: performance.now(),
      isoTime: new Date().toISOString(),
      zoom: window.__debugBridge.zoom(),
      canvasHealth: window.__debugBridge.canvasHealth(),
      pdfDebug: window.pdfDebug?.dump(),
      pdfPerf: window.pdfPerf?.getSummary(),
    }),
  };

  return () => { delete window.__debugBridge; };
}, [/* relevant refs - these are stable refs, won't cause re-renders */]);
```

### Pattern 2: Synchronized Artifact Timeline via Shared Epoch

**What:** All capture modules record timestamps relative to a shared `sessionEpoch` (set via `performance.timeOrigin` in the browser, mapped to `Date.now()` on the Node.js side). Every artifact entry includes both an absolute ISO timestamp and a relative `sessionMs` offset.

**When to use:** Always. Every event, screenshot, console message, and app state snapshot must be correlatable on a single timeline.

**Trade-offs:**
- Pro: All artifacts can be sorted into a single timeline regardless of source.
- Pro: Video frame timestamps (from Playwright's recording, which uses wall-clock time) can be mapped to the same timeline.
- Con: Clock skew between browser `performance.now()` and Node.js `Date.now()` is real but tiny (sub-millisecond for same-machine Playwright -- they share the same OS clock).

**Synchronization protocol:**
1. At session start, Playwright calls `page.evaluate(() => ({ perfOrigin: performance.timeOrigin, now: Date.now() }))`.
2. The Node.js side records its own `Date.now()` at the same moment.
3. The offset `browserToNodeMs = nodeNow - browserNow` is stored in `session-meta.json`.
4. All browser-side timestamps (`performance.now()` relative to `performance.timeOrigin`) can be converted to Node.js wall-clock time using this offset.
5. All JSONL entries include both `{ isoTime, sessionMs }` for redundancy.

### Pattern 3: JSONL for Streaming Artifact Capture

**What:** Console messages, events, and app state snapshots are written as newline-delimited JSON (one JSON object per line). Not buffered in memory.

**When to use:** Any artifact stream that produces many entries over the session lifetime (console messages can be 1000+ in a single zoom sequence).

**Trade-offs:**
- Pro: Append-only, crash-safe -- if the process dies, you have everything up to that point.
- Pro: Streamable -- can be read line-by-line without parsing the entire file.
- Pro: Easy to `grep` and `jq` for manual inspection.
- Con: Not as human-readable as formatted JSON. But `jq .` makes it readable.

```javascript
// Example JSONL line (console capture)
{"sessionMs": 4523, "isoTime": "2026-03-12T14:30:04.523Z", "level": "warn", "text": "[AnnotPerf] 800ms safety timeout", "source": "http://localhost:5173/src/main.jsx:35", "stackTrace": "..."}
```

### Pattern 4: External Observation First, Instrumentation for Gaps

**What:** Prefer Playwright's built-in capture capabilities (video, screenshots, tracing, console events) over custom in-app instrumentation. Only add in-app instrumentation for data that cannot be observed externally (internal ref values, computed state not rendered to DOM).

**When to use:** Design every capture module by first asking "can Playwright see this from outside?" Only instrument internally when the answer is no.

**Why this matters for the 1.3MB App.jsx monolith:** Every line added to App.jsx increases the cognitive load and risk of breaking existing functionality. The zoom fix required 5 interconnected edits across ~10 locations in App.jsx. Minimizing in-app instrumentation minimizes the blast radius.

**What Playwright can observe externally (no app changes needed):**
- Console messages: `page.on('console')`
- Errors/exceptions: `page.on('pageerror')`
- DOM state: `page.evaluate(() => document.querySelectorAll(...))`
- Network requests: `page.on('request')`, `page.on('response')`
- Video: browser context video recording
- Traces: `context.tracing.start()`
- Performance metrics: CDP `Performance.getMetrics()`
- Screenshots: `page.screenshot()`

**What requires in-app instrumentation (Debug Bridge):**
- `zoomOverlayTransformActiveRef.current` -- a React ref, not rendered to DOM
- `syncfusionScaleConfirmPendingRef.current` -- a React ref
- `shouldFreezePortalHost` -- computed value in render loop, not in DOM
- `renderedScale` vs `targetScale` -- React state, but not rendered as a readable DOM attribute
- `pdfDebug` counters/rates -- already exposed via `window.pdfDebug` but not structured for capture

### Pattern 5: Scenario Scripts as Declarative Action Sequences

**What:** Each scenario defines a linear sequence of actions (zoom in, wait, screenshot, zoom out, wait) rather than a general-purpose test framework. No conditionals, no retries, no assertions-that-matter.

**When to use:** All debug scenarios. These are evidence-collection scripts, not test suites. The goal is to reproduce a bug deterministically and collect maximum evidence.

**Trade-offs:**
- Pro: Deterministic -- same sequence every time. LLM can compare run-to-run artifacts.
- Pro: Simple to write and understand. No test framework abstractions.
- Con: Cannot adapt to unexpected app states. But that is intentional -- unexpected states ARE the evidence.

## Data Flow

### Session Lifecycle Flow

```
[User runs CLI: node debug/harness/cli.mjs run zoom-flicker]
    |
    v
[Session Manager: creates sessions/2026-03-12T14-30-00_zoom-flicker/]
    |
    v
[Playwright launches Chromium, navigates to localhost:5173]
    |
    v
[Dev-only test route: bypasses auth, loads test PDF, navigates to page 6]
    |
    v
[Capture modules initialized: video on, tracing on, console capture on]
    |
    v
[Scenario Runner executes action sequence:]
    |
    +-- [Action 1: baseline screenshot + app state snapshot]
    |       |
    |       +-> screenshots/001_baseline.png
    |       +-> app-state.jsonl (append)
    |
    +-- [Action 2: zoom in via Ctrl+Wheel (20 steps)]
    |       |
    |       +-> console.jsonl (append, continuous)
    |       +-> app-state.jsonl (append, every 50ms during zoom)
    |       +-> events.jsonl (append, from Debug Bridge events)
    |
    +-- [Action 3: wait 6000ms for settle]
    |       |
    |       +-> screenshots/002_post-zoom-settle.png
    |       +-> app-state.jsonl (final snapshot)
    |
    +-- [... more actions ...]
    |
    v
[Capture modules finalized: video saved, trace exported]
    |
    v
[Post-Processor runs automatically:]
    |
    +-- [Timeline Merger: reads all JSONL, produces timeline.json]
    +-- [Anomaly Detector: scans timeline for cc=0 drops, error bursts]
    +-- [Keyframe Extractor: links anomalies to nearest screenshots]
    +-- [LLM Chunker: splits timeline into context windows with source]
    |
    v
[Session complete. Folder contains all artifacts + analysis.]
```

### Capture Module Data Flow

```
                    Browser (localhost:5173)
                    ========================
                    |                      |
     +--------------+     +----------------+
     | DOM/Console  |     | Debug Bridge   |
     | (observable) |     | (window global)|
     +--------------+     +----------------+
            |                     |
            | page.on('console')  | page.evaluate()
            | page.screenshot()   | (called every 50ms
            | CDP events          |  during actions)
            |                     |
            v                     v
     +------+---------------------+------+
     |     Playwright (Node.js process)  |
     |                                   |
     |  +-- Console Capture              |
     |  |   -> console.jsonl (append)    |
     |  |                                |
     |  +-- Screenshot Capture           |
     |  |   -> screenshots/NNN_label.png |
     |  |                                |
     |  +-- App State Capture            |
     |  |   -> app-state.jsonl (append)  |
     |  |                                |
     |  +-- Video/Trace (Playwright)     |
     |  |   -> video.webm, trace.zip     |
     |  |                                |
     |  +-- Performance Capture          |
     |      -> performance.json          |
     +-----------------------------------+
                    |
                    v
     +-----------------------------------+
     |     Session Folder (disk)         |
     +-----------------------------------+
```

### Key Data Flows

1. **Console to JSONL:** Browser `console.log/warn/error` --> Playwright `page.on('console')` callback --> parse into structured object with timestamp --> append line to `console.jsonl`. Also: CDP `Runtime.consoleAPICalled` for stack traces and exact timestamps.

2. **App state polling:** Scenario runner calls `page.evaluate(() => window.__debugBridge.snapshot())` at configurable intervals (50ms during active zoom, 500ms during idle waits) --> append to `app-state.jsonl`. This is pull-based, not push-based -- the app does not push state changes. Pull is simpler and avoids adding event listeners inside the monolith.

3. **Event-triggered screenshots:** Scenario runner takes screenshots at predefined points (before action, during action, after settle). Also: anomaly-triggered screenshots when app-state polling detects cc=0 drop or error spike.

4. **Timeline merge (post-processing):** Read `console.jsonl` + `events.jsonl` + `app-state.jsonl` --> sort all entries by `sessionMs` --> produce `timeline.json` where every entry has a unified schema: `{ sessionMs, isoTime, type, source, data }`.

## Integration Points with Existing Code

### App.jsx Integration (Minimal -- ~60 lines)

| Integration Point | What Changes | Risk |
|-------------------|-------------|------|
| Debug Bridge `useEffect` | New `useEffect` near line ~13735 (next to existing `window.__pdfHistoryDebug`). Reads from existing refs. | LOW -- read-only access to existing refs. Guarded by `import.meta.env.DEV`. |
| Dev-only test route | New URL parameter check `?test-mode=true` in `main.jsx` or `App.jsx` that skips AuthProvider rendering. | LOW -- only active with explicit URL param, never in production. |

### PageAnnotationLayer.jsx Integration (None Required)

PageAnnotationLayer.jsx does not need changes. All PAL-relevant data (canvas count, portal status, orphaned portals) is observable via DOM queries from Playwright (`document.querySelectorAll('.canvas-container')`). The existing ralph-test already proves this works.

### Existing Debug API Integration (Aggregation Only)

| Existing API | How Debug Bridge Uses It |
|-------------|--------------------------|
| `window.pdfPerf` | `bridge.snapshot()` calls `pdfPerf.getSummary()` to include upload/load/render/zoom timing |
| `window.pdfDebug` | `bridge.snapshot()` calls `pdfDebug.dump()` to include counters, event rates, error state |
| `window.__pdfHistoryDebug` | `bridge.snapshot()` calls `__pdfHistoryDebug.state()` to include undo/redo depth |

No changes to these existing APIs. The Debug Bridge is a consumer, not a modifier.

### Vite Configuration Integration

```javascript
// vite.config.js -- add define for test mode (no other changes needed)
define: {
  'process.env': {},
  'global': 'globalThis',
  // Existing. No changes needed -- import.meta.env.DEV already works.
}
```

No vite.config.js changes needed. `import.meta.env.DEV` is already available and sufficient for guarding the Debug Bridge.

## Anti-Patterns

### Anti-Pattern 1: Continuous Push Events from App to Playwright

**What people do:** Add event listeners inside App.jsx that push every state change to Playwright via `page.exposeFunction()` callbacks.

**Why it is wrong:** It couples the app render loop to debug infrastructure. If the callback is slow (IPC to Node.js process), it blocks the render loop. It also means debug code runs on every state change in production-adjacent code paths, making bugs harder to reproduce.

**Do this instead:** Pull-based polling via `page.evaluate()` at intervals chosen by the scenario runner. The app does zero work between polls. If a 50ms polling interval misses a transient state, the JSONL entries before and after the gap still provide context.

### Anti-Pattern 2: Storing Artifacts in Memory Until Session End

**What people do:** Buffer all console messages, screenshots, and state snapshots in arrays, then write everything to disk when the session completes.

**Why it is wrong:** A zoom sequence can generate 1000+ console messages and 100+ state snapshots. If the scenario crashes (browser disconnects, assertion failure), all buffered data is lost. With annotation debugging specifically, the crash IS the interesting data.

**Do this instead:** Append to JSONL files immediately. Write screenshots to disk immediately. If the process dies, you have everything captured up to that point.

### Anti-Pattern 3: Modifying App Behavior in Debug Mode

**What people do:** Add `if (debugMode) { /* change timing */ }` branches that alter zoom debounce timing, disable CSS transforms, or change settle timer durations to "make bugs easier to catch."

**Why it is wrong:** The bugs you are trying to capture are timing-sensitive race conditions. Changing timing in debug mode means you are debugging a different app than the one users run. The zoom fix (3 interconnected fixes) was specifically about timing -- changing debounce from 60ms to 200ms would have hidden the bug entirely.

**Do this instead:** Observe the app exactly as it runs. The Debug Bridge reads state but never writes it. Playwright captures what happens but never changes app behavior.

### Anti-Pattern 4: One Giant Test File

**What people do:** Put all scenarios, capture logic, and post-processing into a single script (like the current `ralph-test/zoom-test.mjs` at 299 lines).

**Why it is wrong:** The zoom-test.mjs works as a one-off but cannot scale. Adding a new scenario means duplicating the capture setup. Changing the capture format means editing every scenario. The existing file already has mixed concerns: login handling, PDF upload, monitor injection, zoom actions, result formatting.

**Do this instead:** Separate concerns into layers. Session management, capture, scenarios, and post-processing are independent modules. A new scenario only needs to define the action sequence and which captures to enable.

## Build Order and Dependencies

The build order matters because components have real dependencies -- you cannot build the Scenario Runner before the Capture modules exist, and you cannot build the Post-Processor before sessions produce artifacts.

```
Phase 1: Foundation (no dependencies)
+-- Debug Bridge (in-app, window.__debugBridge)
+-- Session Manager (folder creation, metadata)
+-- Dev-only test route (?test-mode=true auth bypass)
     |
     v
Phase 2: Capture Modules (depends on Phase 1)
+-- Console Capture (page.on('console') + CDP)
+-- Screenshot Capture (page.screenshot)
+-- Video/Trace Capture (context.tracing, context video)
+-- App State Capture (page.evaluate + Debug Bridge)
+-- Performance Capture (CDP Performance.getMetrics)
     |
     v
Phase 3: Scenario Execution (depends on Phase 2)
+-- Base Scenario class (setup, capture orchestration, teardown)
+-- Zoom Flicker scenario (first target bug)
+-- Zoom All Methods scenario (port ralph-test/zoom-test.mjs)
+-- CLI entry point
     |
     v
Phase 4: Post-Processing (depends on Phase 3 producing sessions)
+-- Timeline Merger
+-- Anomaly Detector
+-- Keyframe Extractor
     |
     v
Phase 5: LLM Integration (depends on Phase 4)
+-- LLM Chunker (context windows + source code snippets)
+-- Analysis output format
```

### Why This Order

1. **Debug Bridge first** because it is the smallest in-app change and the most critical to get right. If the bridge API is wrong, every capture module that depends on it needs rework.

2. **Session Manager first** because every capture module needs to know where to write files. Getting the folder structure right early prevents refactoring all file paths later.

3. **Capture modules before scenarios** because scenarios are just sequences of actions + capture calls. You cannot test a scenario without capture working.

4. **Post-processing after scenarios** because post-processing needs real session artifacts to develop against. Synthetic test data will not catch edge cases in JSONL parsing, timestamp alignment, or anomaly detection thresholds.

5. **LLM integration last** because the quality of LLM analysis depends entirely on the quality of upstream artifacts. If timeline merging is wrong, LLM chunks will contain incoherent timelines. Ship correct capture and post-processing first.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 scenarios | Current architecture is fine. Single CLI entry point. Manual post-processing review. |
| 5-20 scenarios | Add scenario discovery (glob `scenarios/*.mjs`). Add session index file for quick listing. Consider parallel scenario execution (independent browser contexts). |
| 20+ scenarios | Would need CI integration, which is explicitly out of scope for v2.0. Flag for v3. |

### First bottleneck: Disk space

Video recording + screenshots for a 30-second zoom scenario produces ~50-100MB. 20 sessions = 1-2GB. Add `session-manager.mjs` cleanup: auto-delete sessions older than N days, or sessions marked as "analyzed."

### Second bottleneck: Post-processing time

Timeline merging is O(n log n) on total event count. For a typical zoom session (~2000 console messages + ~500 state snapshots + ~50 screenshots), this is <100ms. Not a concern until sessions become much longer.

## Sources

- [Playwright Tracing API](https://playwright.dev/docs/api/class-tracing) -- startChunk/stopChunk for fine-grained trace capture
- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession) -- Chrome DevTools Protocol access for performance metrics and console capture
- [Playwright Screenshots](https://playwright.dev/docs/screenshots) -- built-in screenshot capture with format/quality options
- [Playwright Videos](https://playwright.dev/docs/videos) -- built-in video recording configuration
- [Chrome DevTools Protocol - Performance domain](https://chromedevtools.github.io/devtools-protocol/tot/Performance/) -- getMetrics for low-level browser performance data
- [Chrome DevTools Protocol - Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) -- consoleAPICalled for timestamped console messages with stack traces
- [Playwright Best Practices](https://playwright.dev/docs/best-practices) -- test isolation and structure
- Existing codebase: `ralph-test/zoom-test.mjs` (working prototype of CDP + Playwright zoom automation), `src/utils/pdfDebug.js`, `src/utils/performanceLogger.js`, `src/App.jsx` (window.__pdfHistoryDebug pattern at line ~13735)
- [Automated Performance Testing with Playwright and Chrome DevTools](https://medium.com/@aishahsofea/automated-performance-testing-with-playwright-and-chrome-devtools-a-deep-dive-52e8b240b00d) -- CDP session coordination patterns
- [Supercharging Playwright Tests with CDP](https://www.thegreenreport.blog/articles/supercharging-playwright-tests-with-chrome-devtools-protocol/supercharging-playwright-tests-with-chrome-devtools-protocol.html) -- console capture and event monitoring

---
*Architecture research for: Automated PDF Annotation Debugging Pipeline*
*Researched: 2026-03-12*
