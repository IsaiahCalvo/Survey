# Domain Pitfalls: Automated Visual Debugging Pipeline for Canvas Rendering

**Domain:** Playwright-driven debugging infrastructure for Syncfusion PDF Viewer + Fabric.js annotation layer
**Researched:** 2026-03-12
**Prior milestone:** Smooth zoom annotation rendering (v1.0, completed)
**Current milestone:** v2.0 Automated debugging and analysis pipeline

---

## Critical Pitfalls

Mistakes that cause the entire debugging pipeline to produce unreliable or useless artifacts.

### Pitfall 1: Canvas Elements Invisible in Playwright Traces

**What goes wrong:** Playwright trace recordings show blank white rectangles where Fabric.js canvases should be. The debugging pipeline captures traces that contain zero useful visual information about annotation rendering -- the exact thing being debugged.

**Why it happens:** Playwright's trace viewer captures DOM snapshots, not pixel buffers. Canvas content lives in GPU memory and requires an expensive GPU readback to capture. Prior to Playwright v1.48, canvas content was not captured at all. As of v1.48+, it is opt-in via the "Display canvas content" setting in Trace Viewer, but traces still use DOM snapshots by default.

**Consequences:** The primary debugging artifact (traces) is useless for diagnosing visual rendering bugs. Team wastes time building a trace-based workflow, then discovers canvas content is missing and must redesign around screenshots instead.

**Prevention:**
- Use `page.screenshot()` as the primary visual capture method, NOT trace DOM snapshots
- If using traces, enable canvas content capture explicitly (requires Playwright >= 1.48)
- Build the artifact pipeline around timed screenshots + video recording from the start
- Test the trace/screenshot capture pipeline on a Fabric.js canvas BEFORE building the rest of the infrastructure
- Use CDP `Page.captureScreenshot` for frame-precise captures when Playwright's built-in screenshot timing is insufficient

**Detection:** Run a single test that renders one annotation on a canvas, capture a trace, open in Trace Viewer. If the canvas area is blank, the pipeline will not work for visual debugging.

**Phase:** Must be validated in Phase 1 (harness setup), before building any artifact capture infrastructure.

**Sources:**
- [Playwright Issue #23964: Canvas not visible in trace](https://github.com/microsoft/playwright/issues/23964) -- confirmed and resolved in v1.48
- [Playwright Issue #19225: Canvas elements don't show up in screenshots](https://github.com/microsoft/playwright/issues/19225) -- resolved via proper wait strategies
- [Playwright PR #34010: Canvas content display setting](https://github.com/microsoft/playwright/pull/34010)

---

### Pitfall 2: Headless vs Headed Rendering Differences for Canvas

**What goes wrong:** Screenshots captured in headless mode (the default) look different from what the developer sees in headed mode. Anti-aliasing, font rendering, and canvas compositing differ because Playwright uses two entirely separate Chromium binaries: a lightweight headless shell vs the full Chromium browser.

**Why it happens:** The headless shell is a stripped-down implementation built on Chromium's `//content` module with different rendering paths. GPU handling, font fallback, and frame compositing all differ. WebGL/Canvas applications can run 10x slower in headless shell without hardware acceleration, and CSS transform compositing (which this app uses heavily during zoom) may produce visually different results.

**Consequences:** The debugging pipeline captures screenshots that do not match the actual bug being investigated. A flicker visible in headed mode might not reproduce in headless captures. Developers chase phantom differences or miss real bugs because the capture environment does not match the runtime environment.

**Prevention:**
- Use `channel: 'chromium'` in Playwright config (new headless mode) instead of the default headless shell -- this runs the same rendering code as headed mode
- If using default headless, add `--use-gl=egl` or `--use-gl=desktop` launch args to enable GPU acceleration
- Generate baseline screenshots in the SAME mode you will use for debugging captures
- Do NOT mix headed and headless screenshots in the same comparison workflow
- For the initial pipeline, default to headless with `channel: 'chromium'`, add `--headed` flag for interactive debugging

**Detection:** Capture the same page at the same zoom level in both headless and headed mode. Diff the screenshots. If pixel differences exceed 1-2% (especially in canvas areas), the rendering paths differ significantly.

**Phase:** Must be decided in Phase 1 (harness setup). The Chromium channel choice affects all downstream screenshots.

**Sources:**
- [Currents: When Tests Should Run Headless vs Headed](https://currents.dev/posts/when-tests-should-run-headless-vs-headed-in-playwright) -- HIGH confidence
- [Enable GPU for slow Playwright tests in headless mode](https://michelkraemer.com/enable-gpu-for-slow-playwright-tests-in-headless-mode/) -- MEDIUM confidence
- [Playwright Issue #33566: Changes in Chromium headless in v1.49](https://github.com/microsoft/playwright/issues/33566)

---

### Pitfall 3: Race Conditions Between Syncfusion Page Load and Screenshot Capture

**What goes wrong:** Screenshots capture partially-rendered PDF pages or annotations. Syncfusion's PDF viewer loads pages asynchronously, and the `e-pv-page-div` elements get destroyed and recreated during zoom operations. Playwright's auto-waiting checks DOM element visibility, but a visible canvas does not mean a fully-rendered canvas.

**Why it happens:** Playwright considers a canvas "actionable" the moment the DOM element appears, but Fabric.js has not yet called `renderAll()` on that canvas. Similarly, after a zoom operation, Syncfusion destroys and recreates page containers (the `e-pv-page-div` DOM mutation documented in v1.0). Between destruction and recreation, any screenshot captures a blank or partially-rendered state. There are at least 16 references to `e-pv-page-div` in App.jsx -- this is a deeply integrated coupling.

**Consequences:** Flaky artifact capture. Sometimes screenshots show the bug, sometimes they capture a transient rendering state that is not the actual bug. The pipeline produces unreliable evidence, undermining the entire purpose.

**Prevention:**
- Expose a custom readiness signal from the app: `window.__debugReady = { pageRendered: true, annotationsRendered: true, zoomSettled: true }`
- Use `page.waitForFunction(() => window.__debugReady?.annotationsRendered === true)` before capturing screenshots
- After zoom operations, wait for the app's internal `confirmPendingTimer` (3000ms per MEMORY.md) to complete before capturing
- Use the existing `window.pdfPerf` performance metrics to detect when rendering is complete
- Never rely on `page.waitForLoadState('networkidle')` alone -- PDF binary blob loads complete long before canvas rendering finishes
- Add a `page.waitForFunction` that checks `document.querySelectorAll('.e-pv-page-div').length > 0` AND the Fabric.js canvas `__rendered` flag

**Detection:** Run the same capture scenario 10 times. If screenshots differ between runs (especially in canvas regions), you have a race condition.

**Phase:** Phase 1 (harness setup) must include readiness signals. Phase 2 (debug API) must expose the rendering state.

---

### Pitfall 4: Serialization Depth/Size Limits When Extracting App State

**What goes wrong:** `page.evaluate()` calls that extract internal app state (Fabric.js objects, annotation data, zoom state) fail silently or return `undefined`. The debugging pipeline gets empty state dumps where it expected rich debugging data.

**Why it happens:** Playwright's `page.evaluate()` serializes return values via JSON-like serialization with a depth limit of 64. Fabric.js canvas objects contain deeply nested circular references (object -> canvas -> objects -> object). A single Fabric.js object can have 100+ properties including nested groups, paths with hundreds of coordinates, and cached bitmap references. The 1.3MB App.jsx likely has similarly complex internal state objects.

**Consequences:** The state extraction portion of the debugging pipeline silently produces empty or truncated data. LLM analysis receives incomplete state information and draws wrong conclusions.

**Prevention:**
- Never return raw Fabric.js objects from `page.evaluate()` -- always project to a flat, serializable shape inside the evaluate callback
- Build a state extraction layer in the app (the "extended debug API" from PROJECT.md) that returns pre-serialized, LLM-friendly JSON -- not raw internal state
- Limit extracted state to: annotation count, positions, dimensions, scale values, zoom state, timing values -- not full object trees
- Use `page.evaluate(() => JSON.stringify(window.__debugState()))` and parse on the Node.js side, so serialization errors are caught in-browser rather than in the Playwright protocol layer
- Test state extraction with the largest annotation set (most objects, most complex paths) early

**Detection:** Call `page.evaluate(() => fabricCanvas.getObjects())` on a page with annotations. If the result is `undefined` or missing expected properties, serialization is truncating.

**Phase:** Phase 2 (debug API design). The API must be designed for serialization safety from day one.

**Sources:**
- [Playwright Issue #27181: evaluate serializing fails](https://github.com/microsoft/playwright/issues/27181)
- [Playwright docs: Evaluating JavaScript](https://playwright.dev/docs/evaluating) -- non-serializable values resolve to undefined

---

### Pitfall 5: Artifact Timeline Desynchronization

**What goes wrong:** Video frames, screenshots, console logs, performance marks, and app state dumps all have slightly different timestamps. When correlating "what was on screen at time T" with "what was the app state at time T," the artifacts disagree by 50-200ms -- enough to miss the exact frame where a flicker occurs.

**Why it happens:** Each artifact source has its own clock and capture latency:
- Playwright video is recorded by the browser at paint-frame granularity
- `page.screenshot()` is async and has 10-50ms round-trip overhead
- `console.log` timestamps come from the browser's `performance.now()`
- `page.evaluate()` for state extraction adds 5-20ms protocol overhead
- Performance marks (`performance.mark()`) use the browser's high-resolution timer
- The Node.js test runner has its own `Date.now()` clock

**Consequences:** Post-processing analysis correlates the wrong events. The LLM sees a state dump that appears to match a flicker screenshot but is actually from 100ms before/after the flicker. Diagnosis is wrong.

**Prevention:**
- Use a single time source: inject `performance.now()` timestamps from the BROWSER into all artifacts
- At capture time, call `page.evaluate(() => performance.now())` and attach that timestamp to the screenshot/state dump metadata
- For video correlation, use performance marks (`performance.mark('screenshot-N')`) that appear in the browser's Performance timeline -- these can be correlated with video frame numbers
- Store all timestamps as offsets from a single `t0` (session start) rather than absolute wall-clock times
- In the session manifest, record `t0_browser = performance.timeOrigin` and `t0_node = Date.now()` at session start, so the offset between clocks is known

**Detection:** Capture a screenshot immediately after a `performance.mark()`. Compare the mark timestamp to the screenshot file's metadata timestamp. If they differ by more than 20ms, the pipeline has a sync problem.

**Phase:** Phase 3 (artifact capture). The timestamp strategy must be designed before any artifact storage format is finalized.

---

## Moderate Pitfalls

### Pitfall 6: Vite Dev Server HMR Interference During Test Runs

**What goes wrong:** During a Playwright test run, Vite's Hot Module Replacement triggers a page reload or partial module replacement, causing the test to interact with a stale or partially-loaded page. The 1.3MB App.jsx is especially prone to triggering HMR on any file save.

**Why it happens:** The Vite dev server watches for file changes and pushes updates via WebSocket. If a developer saves a file during a test run (or if the test framework itself writes to a watched directory), HMR fires. For a 1.3MB monolith like App.jsx, HMR can cause a full page reload rather than a partial update.

**Prevention:**
- Use Playwright's `webServer` config to start a DEDICATED Vite instance for testing, separate from the dev instance
- Alternatively, build and serve a static preview (`vite build && vite preview`) for test runs -- eliminates HMR entirely
- If using dev server, configure Vite with `server.hmr: false` for the test instance, or use `--mode test` with HMR disabled
- Place test artifacts in a directory OUTSIDE the Vite project root (e.g., `~/.betasafe-debug/sessions/`) to avoid triggering file watchers
- Add the test artifact directory to Vite's `server.watch.ignored` config

**Detection:** Run a test while saving App.jsx in the editor. If the test fails with "target closed" or "page navigated," HMR is interfering.

**Phase:** Phase 1 (harness setup). The server configuration must prevent HMR interference.

**Sources:**
- [Playwright Issue #21227: webServer config with Vite dev server](https://github.com/microsoft/playwright/issues/21227)
- [Vite Issue #12883: Flaky tests when using Vite with Playwright](https://github.com/vitejs/vite/issues/12883)

---

### Pitfall 7: Auth Bypass Route Leaking to Production

**What goes wrong:** The dev-only test route that bypasses Supabase authentication is accidentally included in production builds, creating a security vulnerability that allows unauthenticated access to the app.

**Why it happens:** React does not have built-in dead-code elimination for routes. A route component conditionally rendered via `process.env.NODE_ENV === 'development'` may still be included in the bundle if Vite's tree-shaking does not eliminate it. Environment variable checks are runtime, not compile-time, unless using Vite's `import.meta.env` with static analysis.

**Prevention:**
- Use `import.meta.env.DEV` (Vite's compile-time boolean) for the conditional, NOT `process.env.NODE_ENV` -- Vite statically replaces `import.meta.env.DEV` with `false` in production builds, enabling dead-code elimination
- Place the test route component in a separate file that is only dynamically imported in dev mode: `if (import.meta.env.DEV) { const TestRoute = await import('./TestRoute') }`
- Add a build-time check: grep the production bundle for the test route's path string (e.g., `/dev-test`) and fail the build if found
- Keep the test route path obscure (not `/test` or `/debug`) and require a query parameter token even in dev mode
- The test route should ONLY set a pre-authenticated Supabase session token, not bypass auth checks in the rest of the app

**Detection:** Run `vite build` and search the output for the test route's path string. If present, the route leaked.

**Phase:** Phase 1 (harness setup). The auth bypass mechanism must be designed with production safety from the start.

**Sources:**
- [Supabase Playwright testing: REST API login approach](https://mokkapps.de/blog/login-at-supabase-via-rest-api-in-playwright-e2e-test) -- MEDIUM confidence
- [Supawright: Playwright harness for Supabase E2E](https://github.com/isaacharrisholt/supawright) -- MEDIUM confidence

---

### Pitfall 8: Disk Space Exhaustion from Accumulated Artifacts

**What goes wrong:** The folder-per-run storage design accumulates gigabytes of artifacts (video files, screenshots, traces, state dumps) within days of active debugging. Developer's disk fills up, or artifact retrieval becomes slow due to filesystem overhead.

**Why it happens:** A single debugging session generates:
- Video: 5-20MB per test (WebM at 1280x720)
- Screenshots: 500KB-2MB each, 10-50 per session
- Traces: 5-50MB each (especially with screenshots enabled)
- State dumps: 100KB-1MB each
- Console logs: 1-10MB per session

At 10 sessions per day, this is 500MB-2GB daily. The PROJECT.md explicitly chose "folder-per-run, no database" which means no built-in cleanup.

**Consequences:** Disk fills up. Old sessions become a haystack. Finding the relevant session requires manual browsing. The "simple and inspectable" design goal becomes "cluttered and unusable."

**Prevention:**
- Implement a retention policy from day one: keep last N sessions (e.g., 20), auto-delete older ones
- Use symlinks for "pinned" sessions that should survive cleanup
- Compress completed sessions (zip the folder after analysis)
- Record video at 720p, not full resolution -- sufficient for visual debugging, 50-75% size reduction
- Only capture traces on failure or when explicitly requested, not for every run
- Use Playwright's `video: 'retain-on-failure'` option for routine runs, `video: 'on'` only for targeted debugging
- Add a `--cleanup` flag to the harness that removes sessions older than N days

**Detection:** After one week of daily use, check total artifact storage size. If exceeding 5GB, the retention policy is insufficient.

**Phase:** Phase 3 (artifact capture) must include retention. Phase 4 (session management) must enforce it.

**Sources:**
- [Playwright Issue #38433: Traces not cleaned up, causing disk space issues](https://github.com/microsoft/playwright/issues/38433)
- [Playwright Issue #36682: Playwright leaking temp files](https://github.com/microsoft/playwright/issues/36682)
- [TestRig: Reduced Playwright artifact storage by 60%](https://www.testrigtechnologies.com/how-testrig-reduced-playwright-test-artifact-storage-by-more-than-60-real-ci-cd-insights/)

---

### Pitfall 9: LLM Context Window Overflow from Raw Artifacts

**What goes wrong:** The post-processing pipeline feeds raw console logs (10MB), full state dumps (1MB), and verbose performance data to the LLM for analysis. The LLM either truncates critical information, exceeds token limits, or produces hallucinated analysis because the signal-to-noise ratio is too low.

**Why it happens:** Raw debugging artifacts are verbose by nature. A single zoom operation generates hundreds of console log lines, dozens of performance marks, and state changes across multiple components. Feeding this raw data to an LLM (even one with a 200K context window) wastes tokens on noise and buries the relevant signal.

**Consequences:** LLM analysis is unreliable. It either misses the critical event (buried in noise) or confidently attributes the bug to irrelevant log entries. The "LLM-friendly analysis output" goal from PROJECT.md fails.

**Prevention:**
- Pre-process artifacts BEFORE LLM ingestion: filter console logs to errors/warnings only, extract only the time window around the anomaly, summarize performance data into key metrics
- Use structured JSON for LLM input, not raw text -- JSON with semantic keys (`{ "event": "zoom_end", "timestamp_ms": 1234, "annotation_count": 5, "flicker_detected": true }`)
- Chunk by semantic unit (one zoom operation, one page navigation) not by arbitrary byte size
- Include a "session summary" as the first chunk: what scenario ran, what anomalies were detected, which timestamps to focus on
- Budget tokens: reserve 30% for source code context, 40% for artifact data, 30% for analysis output
- Use header-based chunking: each artifact section has a header that provides hierarchical context so the LLM knows what it is reading even in isolation

**Detection:** Feed a sample session's raw artifacts to the target LLM. If the analysis mentions irrelevant log entries or misses the known bug, the preprocessing is insufficient.

**Phase:** Phase 5 (post-processing pipeline). But the artifact FORMAT must be designed in Phase 3 with LLM consumption in mind.

**Sources:**
- [Deepchecks: 5 Approaches to Solve LLM Token Limits](https://www.deepchecks.com/5-approaches-to-solve-llm-token-limits/) -- MEDIUM confidence
- [Pinecone: Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/) -- MEDIUM confidence

---

### Pitfall 10: CSS Transform Timing Creates Uncapturable Transient States

**What goes wrong:** The post-zoom flicker (the target bug) occurs in a 50-200ms window between CSS transform removal and Fabric.js canvas repaint. Playwright's `page.screenshot()` has 10-50ms async overhead, making it likely to capture BEFORE or AFTER the flicker but not DURING it.

**Why it happens:** The flicker is a single-frame visual artifact. Playwright's screenshot API issues a CDP command, waits for the next composited frame, captures it, and returns. By the time the screenshot is taken, the browser may have already painted the corrected frame. The flicker exists in paint frames that are never captured by the async screenshot path.

**Consequences:** The primary debugging target (post-zoom flicker) is invisible to the primary debugging tool (screenshots). The pipeline cannot capture evidence of the exact bug it was built to investigate.

**Prevention:**
- Use Playwright video recording (`video: 'on'`) as the primary visual evidence -- video captures every paint frame including the flicker
- Extract individual frames from the video file post-capture using ffmpeg (`ffmpeg -i video.webm -vf "select=gte(n\,FRAME)" frame_%d.png`)
- Use CDP `Page.startScreencast` for frame-by-frame streaming at the browser's paint rate -- captures frames the screenshot API misses
- Inject `performance.mark('transform-removed')` and `performance.mark('canvas-repainted')` from inside the app -- these bracket the flicker window and can be correlated with video frame numbers
- Use `requestAnimationFrame` instrumentation inside the app to log every paint frame's state during the flicker window
- Consider using Chrome's `--enable-gpu-benchmarking` flag with `chrome.gpuBenchmarking.printToSkPicture()` for frame-level capture (experimental)

**Detection:** Record a video of 10 zoom operations on an annotated page. Frame-step through the video at the zoom-settle point. If you can see the flicker in the video but not in any screenshot, the screenshot path cannot capture it.

**Phase:** Phase 2 (debug API) must instrument the flicker window. Phase 3 (artifact capture) must use video as the primary visual evidence.

---

### Pitfall 11: Debug API Instrumentation Altering the Bug Being Debugged

**What goes wrong:** Adding `console.log`, `performance.mark`, or state capture hooks to the zoom/render path changes the timing enough that the post-zoom flicker no longer reproduces. The debugging infrastructure makes the bug disappear (Heisenbug).

**Why it happens:** The flicker is a timing-sensitive race condition in a 50-200ms window. Each `console.log` adds 0.1-1ms of main thread work. `performance.mark()` adds ~0.01ms. `page.evaluate()` for state extraction adds 5-20ms of protocol overhead and forces a microtask checkpoint. In aggregate, these perturbations can shift the race condition outcome.

**Consequences:** The pipeline successfully captures artifacts, but the artifacts show no flicker. The team concludes the flicker is fixed when it actually still occurs in uninstrumented production builds. False confidence.

**Prevention:**
- Use `performance.mark()` (0.01ms) over `console.log` (0.1-1ms) for timing instrumentation
- Batch state extraction: do NOT call `page.evaluate()` during the critical flicker window -- capture state BEFORE the zoom starts and AFTER the flicker window closes, not during
- Add instrumentation behind a compile-time flag (`import.meta.env.VITE_DEBUG_INSTRUMENTATION`) so it can be toggled without changing code
- Validate that the bug reproduces WITH instrumentation enabled before trusting the pipeline
- Use passive observation (video, performance observer) rather than active extraction (evaluate calls) during timing-critical paths
- The existing `window.pdfPerf` is already in the hot path -- extend it rather than adding new instrumentation

**Detection:** Run the same zoom scenario with and without debug instrumentation. If the flicker occurs without instrumentation but not with it, the instrumentation is perturbing the timing.

**Phase:** Phase 2 (debug API). Instrumentation design must be timing-aware from the start.

---

## Minor Pitfalls

### Pitfall 12: Playwright's page.exposeFunction Surviving Navigation

**What goes wrong:** Functions exposed via `page.exposeFunction()` survive page navigations but NOT page reloads triggered by HMR or Vite full-reload. The test continues calling the exposed function, which silently fails or throws.

**Prevention:**
- Re-expose functions after detecting a navigation event via `page.on('load')`
- Prefer placing debug functions on `window` from within the app code (controlled by `import.meta.env.DEV`) rather than injecting from Playwright
- Use `page.addInitScript()` for functions that must survive navigations -- init scripts are re-executed on every navigation

---

### Pitfall 13: Flaky Waits Due to Syncfusion's Multi-Phase Page Rendering

**What goes wrong:** Tests pass `page.waitForSelector('.e-pv-page-div')` but the page container is empty -- Syncfusion creates the DOM shell before rendering content into it. The test proceeds too early.

**Prevention:**
- Wait for Syncfusion's internal rendering completion, not just DOM element presence
- Chain waits: `waitForSelector('.e-pv-page-div')` THEN `waitForFunction(() => document.querySelector('.e-pv-page-div canvas')?.getContext('2d'))` THEN the custom `__debugReady` signal
- Use the existing `pdfPerf` metrics to detect when page rendering completes
- Add a `data-rendered="true"` attribute to PageAnnotationLayer's container after Fabric.js `renderAll()` completes -- Playwright can wait for this attribute

---

### Pitfall 14: Video Recording Performance Impact on Canvas Rendering

**What goes wrong:** Enabling Playwright video recording (`video: 'on'`) causes frame drops during zoom operations. The video captures a janky zoom that does not occur in normal usage, making flicker diagnosis unreliable.

**Prevention:**
- Use 720p resolution for video (`recordVideo: { size: { width: 1280, height: 720 } }`) instead of full viewport resolution
- Test that zoom operations still hit 60fps with video recording enabled
- If video recording causes jank, use CDP `Page.startScreencast` at a lower frame rate (e.g., 10fps) instead -- sufficient for detecting flicker without impacting rendering performance
- Profile with Chrome DevTools Performance panel while video recording is active to confirm the recording overhead

---

### Pitfall 15: Session Bundle Manifest Drift

**What goes wrong:** The session bundle folder contains artifacts, but the manifest file (index.json) does not reflect all captured files, or lists files that were not captured due to errors. The post-processing pipeline reads the manifest, misses artifacts, and produces incomplete analysis.

**Prevention:**
- Write the manifest LAST, after all artifacts are finalized
- Build the manifest by scanning the actual folder contents, not by recording what SHOULD have been captured
- Include checksums (SHA256) for each artifact file so corruption is detectable
- Include a `status` field per artifact: `"captured"`, `"failed"`, `"skipped"`
- Validate the manifest against the folder contents before passing to post-processing

---

### Pitfall 16: PDF Loading as Binary Blob Complicates Test Fixtures

**What goes wrong:** Tests need a specific PDF loaded to exercise annotation scenarios, but PDFs are loaded from Supabase Storage as binary blobs. The test must either authenticate with Supabase to fetch the PDF, or provide the PDF through an alternative path.

**Prevention:**
- Store test PDFs as local fixtures in the test directory (e.g., `tests/fixtures/package-2-rev4.pdf`)
- The dev-only test route should accept a local file path or base64-encoded PDF, bypassing Supabase Storage entirely
- Alternatively, pre-load the PDF into the dev Supabase instance and hardcode the test to use that known document
- Do NOT download PDFs from production Supabase during test runs -- adds network dependency, authentication complexity, and non-determinism

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Severity | Mitigation |
|-------|---------------|----------|------------|
| Phase 1: Harness Setup | Canvas invisible in traces (#1) | Critical | Validate screenshot/video capture of canvas content before proceeding |
| Phase 1: Harness Setup | Headless rendering differences (#2) | Critical | Use `channel: 'chromium'` new headless mode |
| Phase 1: Harness Setup | HMR interference (#6) | Moderate | Dedicated test Vite instance with HMR disabled |
| Phase 1: Harness Setup | Auth bypass leak (#7) | Moderate | Use `import.meta.env.DEV` for compile-time elimination |
| Phase 2: Debug API | Serialization depth limits (#4) | Critical | Pre-serialize state in-browser, never return raw Fabric.js objects |
| Phase 2: Debug API | Heisenbug from instrumentation (#11) | Moderate | Use performance.mark(), avoid console.log in hot paths |
| Phase 2: Debug API | Syncfusion readiness signals (#3, #13) | Critical | Expose `__debugReady` with granular completion flags |
| Phase 3: Artifact Capture | Timeline desynchronization (#5) | Critical | Single time source (browser performance.now()) for all artifacts |
| Phase 3: Artifact Capture | Uncapturable transient states (#10) | Critical | Video as primary evidence, frame extraction post-capture |
| Phase 3: Artifact Capture | Disk space exhaustion (#8) | Moderate | Retention policy and compression from day one |
| Phase 4: Session Management | Manifest drift (#15) | Minor | Write manifest last, scan actual folder contents |
| Phase 4: Session Management | PDF fixture loading (#16) | Minor | Local fixture files, bypass Supabase in tests |
| Phase 5: Post-Processing | LLM context overflow (#9) | Moderate | Pre-filter artifacts, structured JSON, semantic chunking |
| Phase 5: Post-Processing | Video as primary evidence (#10) | Moderate | ffmpeg frame extraction, keyframe identification |

## Decision Matrix: What To Use For What

| Artifact Need | Wrong Approach | Right Approach | Why |
|---------------|---------------|----------------|-----|
| Visual state of canvas | Playwright trace DOM snapshot | `page.screenshot()` or video frame extraction | Traces don't capture canvas pixels reliably |
| App internal state | `page.evaluate(() => bigObject)` | `page.evaluate(() => JSON.stringify(window.__debugState()))` | Avoids Playwright serialization depth limits |
| Timing of flicker | Timed screenshots | Video recording + `performance.mark()` correlation | Screenshots miss single-frame transients |
| Console errors | Post-hoc log file parsing | `page.on('console')` with browser timestamp | Real-time capture with synchronized timestamps |
| Rendering completion | `waitForSelector('.canvas')` | Custom `__debugReady` signal from app | DOM presence does not equal render completion |
| Performance metrics | `page.evaluate(() => performance.getEntries())` after test | CDP Performance domain real-time streaming | Post-hoc collection misses entries cleared during navigation |

## Sources

- [Playwright: Visual comparisons](https://playwright.dev/docs/test-snapshots) -- HIGH confidence
- [Playwright: Trace viewer](https://playwright.dev/docs/trace-viewer) -- HIGH confidence
- [Playwright: Videos](https://playwright.dev/docs/videos) -- HIGH confidence
- [Playwright: CDPSession](https://playwright.dev/docs/api/class-cdpsession) -- HIGH confidence
- [Playwright: Evaluating JavaScript](https://playwright.dev/docs/evaluating) -- HIGH confidence
- [Playwright Issue #23964: Canvas not visible in trace](https://github.com/microsoft/playwright/issues/23964) -- HIGH confidence
- [Playwright Issue #19225: Canvas elements in screenshots](https://github.com/microsoft/playwright/issues/19225) -- HIGH confidence
- [Playwright Issue #38433: Disk space from uncleaned traces](https://github.com/microsoft/playwright/issues/38433) -- HIGH confidence
- [Currents: Headless vs Headed in Playwright](https://currents.dev/posts/when-tests-should-run-headless-vs-headed-in-playwright) -- HIGH confidence
- [Playwright Issue #21227: webServer config with Vite](https://github.com/microsoft/playwright/issues/21227) -- MEDIUM confidence
- [Vite Issue #12883: Flaky tests with Playwright](https://github.com/vitejs/vite/issues/12883) -- MEDIUM confidence
- [Deepchecks: LLM Token Limits](https://www.deepchecks.com/5-approaches-to-solve-llm-token-limits/) -- MEDIUM confidence
- [Pinecone: Chunking Strategies](https://www.pinecone.io/learn/chunking-strategies/) -- MEDIUM confidence
- [Supabase Playwright login via REST API](https://mokkapps.de/blog/login-at-supabase-via-rest-api-in-playwright-e2e-test) -- MEDIUM confidence
- [TestRig: Reduced Playwright artifact storage by 60%](https://www.testrigtechnologies.com/how-testrig-reduced-playwright-test-artifact-storage-by-more-than-60-real-ci-cd-insights/) -- MEDIUM confidence
