# Feature Landscape: Automated Visual Debugging Pipeline

**Domain:** Automated visual debugging and testing pipeline for canvas-based PDF annotation app
**Researched:** 2026-03-12
**Supersedes:** Previous FEATURES.md (zoom rendering features, 2026-03-04)

## Table Stakes

Features the pipeline needs or it is not useful. Missing any of these means you are still debugging manually.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Playwright test harness with deterministic scenarios** | Without scripted, repeatable test sequences the pipeline has no inputs. Every run must reproduce the exact same interactions to compare results across code changes. | Medium | Existing `ralph-test/zoom-test.mjs` proves the pattern. Needs formalization: scenario registry, parameterized runs, CLI interface. |
| **Dev-only test route (auth bypass)** | Fragile login flows (email/password fill, wait for auth modal) break constantly and add 3-8 seconds per run. Every professional Playwright harness separates auth from test scenarios. | Low | Express middleware or URL param (`?devMode=true`) that auto-authenticates and opens a specific document. Gate behind `NODE_ENV=development`. |
| **Synchronized artifact capture** | The whole point: screenshot, video, console log, app state, and performance data captured together with a shared timeline. Without synchronization, you cannot correlate "this screenshot was taken when the app was in this state." | High | Must timestamp all artifacts from a single `performance.now()` epoch. Video frames, screenshots, console messages, and state snapshots need a shared `sessionT` offset. |
| **Screenshot capture at deterministic points** | Screenshots before/after each action are the primary evidence for visual bugs. Playwright's `page.screenshot()` with `fullPage` and element-targeted variants. | Low | Already proven in `ralph-test/` (20+ screenshots captured). Needs naming convention and automatic association with scenario step. |
| **Console log capture and persistence** | Console messages reveal internal errors, warnings, and debug output (`[pdfDebug]` events). Without capturing these, you lose half the diagnostic signal. | Low | `page.on('console', ...)` already used in zoom-test.mjs. Needs structured persistence: timestamped JSONL file per session. |
| **Video recording** | Flicker bugs are sub-frame timing issues. A single screenshot misses the glitch. Video at 30fps captures the visual artifact even when you cannot predict exactly when it occurs. | Low | Playwright built-in: `recordVideo: { dir: sessionDir, size: { width: 1400, height: 900 } }`. Zero custom code needed. |
| **Session folder structure (folder-per-run)** | Every run produces multiple artifacts that must be kept together and inspectable without tooling. Flat file dumps are useless after 5 runs. | Low | Convention: `sessions/YYYY-MM-DD_HH-mm-ss_{scenario}/` containing `video.webm`, `screenshots/`, `console.jsonl`, `state-snapshots.jsonl`, `perf.json`, `manifest.json`. |
| **Session manifest (metadata)** | Which scenario ran, when, git SHA, zoom levels tested, pass/fail result, artifact paths. Without this, a session folder is a pile of opaque files. | Low | `manifest.json` written at session start (config) and updated at end (results, duration, pass/fail). |
| **Extended debug API (window.__debugPipeline)** | Playwright needs to read internal app state: current zoom level, annotation count, canvas container count, portal host status, freeze state. `pdfDebug.js` exposes counters and event rates, but not the rendering pipeline internals needed for flicker diagnosis. | Medium | Extend `window.pdfDebug.dump()` to include zoom state, CSS transform active flag, `renderedScale` vs `targetScale`, visible page list, portal host count, freeze status. Add `window.__debugPipeline` for pipeline-specific queries. |
| **App state snapshots at scenario steps** | At each scripted action, capture the full debug state (`pdfDebug.dump()` + extended fields). This creates a timeline of internal state that correlates with screenshots. | Medium | `page.evaluate(() => window.pdfDebug.dump())` at each step. Store as JSONL with timestamp and step label. |
| **Pass/fail determination per scenario** | The pipeline must answer "did this scenario pass?" with a boolean. Without automated pass/fail, a human must review every artifact manually, defeating the purpose. | Medium | Already implemented in zoom-test.mjs (`minCC >= 1`). Generalize: each scenario defines its own pass criteria (canvas container count, no console errors, visual diff below threshold). |

## Differentiators

Features that make the pipeline powerful rather than just functional. Not expected in a v1 debug tool, but high value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Visual diff between screenshots (pixelmatch)** | Automated pixel-level comparison between "before" and "after" screenshots. Detects flicker, position shifts, and scale errors that human eyes miss in side-by-side comparison. Produces a diff image highlighting exactly what changed. | Medium | pixelmatch is the standard library (Mapbox, 5.3KB, zero dependencies). Playwright has built-in `toHaveScreenshot()` but we want diff artifacts stored per session, not just test assertions. Custom: capture baseline, capture post-action, run pixelmatch, store diff image + mismatch percentage. |
| **Performance metrics collection (CDP)** | Capture Layout Shift (CLS), Long Tasks, paint timing, and custom `performance.mark()`/`performance.measure()` data via Chrome DevTools Protocol. Quantifies rendering performance beyond "it looks right." | Medium | `page.context().newCDPSession(page)` already used in zoom-test.mjs for input dispatch. Add `Performance.enable()`, `Performance.getMetrics()`, and PerformanceObserver for layout-shift entries. Store as `perf.json` per session. |
| **DOM mutation monitoring during scenarios** | Track when Syncfusion destroys/recreates page containers (`e-pv-page-div`), which is the root cause of portal host disconnection bugs. Captures the exact mutation that triggers annotation disappearance. | Medium | MutationObserver injected via `page.evaluate()`. Monitors `e-pv-pages-container` for childList changes. Log mutations with timestamps to correlate with video/screenshot timeline. |
| **Keyframe extraction from video** | Auto-detect "interesting" frames in recorded video: moments where pixel content changes rapidly (potential flicker), frames at scenario step boundaries, frames where metrics spike. Reduces a 30-second video to 5-10 key frames. | High | Two approaches: (1) Simple: screenshot at each scripted step boundary (already have this). (2) Advanced: post-process video with frame differencing to find pixel-delta spikes. Start with (1), defer (2). |
| **Timeline summary (human-readable)** | A single `timeline.md` file that narrates the session: "0ms: baseline captured, 150ms: zoom in started, 800ms: canvas containers dropped to 0, 1200ms: containers restored, 6000ms: settled." Readable by a human or LLM without opening any other file. | Medium | Post-processing step. Merge `state-snapshots.jsonl` + `console.jsonl` + `perf.json` into a chronological narrative. Template-driven (not AI-generated at this stage). |
| **LLM-friendly artifact chunking** | Structure all artifacts so they fit in an LLM context window (~100-200K tokens) for analysis. Chunk large files (console logs, state snapshots) into labeled segments. Include a "reader's guide" that tells the LLM what each file is and what to look for. | Medium | `analysis-prompt.md` template: "You are analyzing a debug session for [scenario]. Here is the manifest, timeline, and key state snapshots. Screenshots are attached as images. Identify the root cause of [symptom]." Chunk console logs by scenario step, not by arbitrary token count. |
| **Anomaly detection in state snapshots** | Automatically flag state transitions that indicate a bug: canvas container count dropping to 0, `renderedScale` diverging from `targetScale` for more than N ms, console error spikes. No AI needed -- simple threshold rules on structured data. | Medium | Rule engine on `state-snapshots.jsonl`: `if (snapshot.cc === 0 && prev.cc > 0) flag("canvas-drop", snapshot)`. Produces `anomalies.json` with timestamp, type, severity, and relevant state diff. |
| **Scenario parameterization** | Run the same scenario with different parameters: zoom range (50-400% vs 100-200%), zoom speed (fast vs slow wheel events), starting page (page 1 vs page 6 with annotations). Multiplies test coverage without writing new scenarios. | Low | Scenario functions accept a config object: `{ zoomStart, zoomEnd, stepCount, waitMs }`. CLI passes variants. |
| **Network request logging** | Capture Supabase API calls, PDF blob fetches, and any failed requests during scenarios. Network errors can cause state corruption that manifests as rendering bugs. | Low | `page.on('request')` and `page.on('response')` listeners. Filter to relevant domains. Store as `network.jsonl`. |
| **Trace file recording** | Playwright's built-in trace (`tracing.start()`) captures DOM snapshots, network, console, and action timeline in a single `.zip`. Viewable in Playwright Trace Viewer -- the gold standard for post-mortem debugging. | Low | `context.tracing.start({ screenshots: true, snapshots: true })` and `context.tracing.stop({ path: traceFile })`. One line of config. Produces rich artifact at zero development cost. |

## Anti-Features

Features to deliberately NOT build. Each represents a tempting rabbit hole that would derail the pipeline.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **AI-generated test scenarios** | LLM improvisation produces non-deterministic, non-reproducible tests. Defeats the core philosophy: deterministic scripts, LLM analyzes evidence. | Human writes scenario scripts. LLM reads artifacts. Clear separation of concerns. |
| **Automated fix generation** | LLM suggesting code changes based on artifacts is tempting but premature. Fix quality depends on artifact quality, which is unproven. Wrong fixes waste more time than manual debugging. | LLM produces a structured analysis report (root cause hypothesis, evidence citations, suggested investigation areas). Human decides what to change. |
| **Real-time monitoring dashboard** | A live WebSocket dashboard showing metrics as tests run is over-engineered for a local-only tool used by one developer. Session folders are inspected after runs, not during. | Files and folders. `cat manifest.json` and `open timeline.md` are the "dashboard." |
| **CI/CD pipeline integration** | Wiring into GitHub Actions, artifact upload, PR gating -- all premature. The pipeline runs locally, manually triggered, for the foreseeable future. CI adds config complexity without value until the local pipeline is proven. | `npm run debug:scenario zoom-all` from terminal. Results in local `sessions/` folder. |
| **Database storage for sessions** | SQLite or Supabase for session metadata, query by date/scenario/pass-fail. Over-engineered until you have 100+ sessions. Folders are queryable with `ls` and `grep`. | Flat folders with `manifest.json`. Consider database only when folder-per-run management becomes painful (PROJECT.md already says this). |
| **Electron-specific automation** | Electron's CDP support is flakier than Chromium. The rendering behavior is identical since the app runs in Chromium's renderer process anyway. | Target `localhost:5173` in Playwright-launched Chromium. Same DOM, same rendering, better stability. |
| **Cross-browser testing** | Firefox and WebKit rendering differences are irrelevant -- this is an Electron app that only runs in Chromium. Cross-browser adds 3x run time for zero value. | Chromium only. One browser, one rendering engine, one set of baselines. |
| **Screenshot diffing against golden baselines** | Traditional visual regression testing (compare against checked-in baseline images) is fragile for this app because annotation content varies, PDF rendering has sub-pixel differences, and the goal is flicker detection, not pixel-perfect consistency. | Diff between "before" and "after" within the same session (self-comparison). Detect unexpected changes, not deviation from a golden image. |
| **Video frame-by-frame analysis** | Extracting every frame from a 30fps video and running pixel analysis is computationally expensive and produces massive artifacts. For a 30-second scenario, that is 900 frames. | Keyframe extraction at step boundaries (10-15 frames per scenario). Video exists for human playback review, not automated frame analysis. |
| **Gemini embeddings / semantic retrieval** | Embedding session artifacts for semantic search is v3 scope (PROJECT.md explicitly defers this). Must prove capture quality first. | Flat file organization with good naming. `grep` is the search engine for now. |

## Feature Dependencies

```
Dev-only test route ─────────────────────┐
                                         v
Playwright test harness ──────────> Deterministic Scenarios
         │                                │
         v                                v
  Session folder structure ────> Session manifest (metadata)
         │
         ├──> Video recording (Playwright built-in)
         ├──> Screenshot capture at deterministic points
         ├──> Console log capture and persistence
         └──> App state snapshots at scenario steps
                    │
                    ├──> Pass/fail determination (reads state snapshots)
                    ├──> Anomaly detection (reads state snapshots)
                    └──> Timeline summary (merges all artifacts)
                              │
                              v
                    LLM-friendly artifact chunking

Extended debug API ──────────> App state snapshots (richer data)
                               DOM mutation monitoring (richer data)

Visual diff (pixelmatch) ──── Requires: Screenshot capture
Performance metrics (CDP) ─── Requires: Playwright harness + CDP session
Network request logging ───── Requires: Playwright harness
Trace file recording ──────── Requires: Playwright harness
Scenario parameterization ─── Requires: Deterministic scenarios
Keyframe extraction ───────── Requires: Video recording OR Screenshot capture
```

### Critical Path

The shortest path to a useful pipeline:

```
1. Dev-only test route (unblocks everything)
2. Playwright harness + session folder structure (infrastructure)
3. Scenario scripts + screenshot + console + video capture (evidence collection)
4. Extended debug API + state snapshots (internal visibility)
5. Pass/fail determination (automation payoff)
```

Everything else (pixelmatch, anomaly detection, timeline summary, LLM chunking) is valuable but builds on top of steps 1-5.

## MVP Recommendation

### Phase 1: Pipeline Foundation (must-have)

Build the minimum viable pipeline that can run one scenario and produce inspectable artifacts.

1. **Dev-only test route** -- Bypass auth, auto-open specific document
2. **Playwright harness** -- Launch browser, navigate, scenario runner framework
3. **Session folder structure** -- `sessions/{timestamp}_{scenario}/` with manifest
4. **One scenario: zoom-all** -- Port existing `zoom-test.mjs` into the new framework
5. **Basic artifact capture** -- Screenshots at step boundaries, video, console log
6. **Pass/fail from canvas container count** -- Existing `minCC >= 1` logic

### Phase 2: Deep Visibility

Add internal state capture and correlation.

7. **Extended debug API** -- Zoom state, portal host status, freeze flags
8. **State snapshots at each step** -- Full debug dump as JSONL
9. **DOM mutation monitoring** -- Track Syncfusion page container changes
10. **Performance metrics via CDP** -- Layout shift, long tasks, paint timing

### Phase 3: Analysis Layer

Add automated analysis and LLM-ready output.

11. **Anomaly detection** -- Rule-based flagging of suspicious state transitions
12. **Visual diff (pixelmatch)** -- Before/after pixel comparison per step
13. **Timeline summary** -- Human-readable chronological narrative
14. **LLM-friendly chunking** -- Analysis prompt template + chunked artifacts

### Defer

- **Keyframe extraction from video** (advanced variant): Complex, low incremental value over step-boundary screenshots
- **Scenario parameterization**: Nice but not needed until base scenarios are solid
- **Trace file recording**: Zero-effort to add but produces huge files; add when you actually need Trace Viewer's time-travel debugging

## Complexity Budget

| Complexity | Features | Estimated Effort |
|------------|----------|-----------------|
| Low | Dev route, session folders, manifest, video, console capture, screenshots, trace recording, network logging, scenario params | 1-2 hours each |
| Medium | Playwright harness framework, synchronized timestamps, extended debug API, state snapshots, pass/fail logic, pixelmatch diffing, anomaly detection, timeline summary, LLM chunking, DOM mutation monitoring, performance metrics | 3-8 hours each |
| High | Synchronized artifact capture (full timeline correlation), keyframe extraction (video frame analysis) | 1-2 days each |

## Sources

- [Playwright Visual Comparisons (official docs)](https://playwright.dev/docs/test-snapshots)
- [Playwright Videos (official docs)](https://playwright.dev/docs/videos)
- [Playwright Trace Viewer (official docs)](https://playwright.dev/docs/trace-viewer)
- [Playwright Evaluating JavaScript (official docs)](https://playwright.dev/docs/evaluating)
- [pixelmatch (Mapbox)](https://github.com/mapbox/pixelmatch)
- [Checkly: Measuring Page Performance Using Playwright](https://www.checklyhq.com/docs/learn/playwright/performance/)
- [Playwright CDPSession API](https://playwright.dev/docs/api/class-cdpsession)
- [HTML5 Canvas Testing (askui.com)](https://www.askui.com/blog-posts/html5-canvas-testing-techniques-tools-and-best-practices)
- [Canvas Visual Testing with Retries (Gleb Bahmutov)](https://glebbahmutov.com/blog/canvas-testing/)
- [Patrick Desjardins: Console and Network Logs in Playwright](https://patrickdesjardins.com/blog/adding-console-and-network-logs-in-playwright)
- [Pinecone: Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/)
- [Integrating Software Artifacts for LLM-based Bug Localization (ACM)](https://dl.acm.org/doi/10.1145/3770581)
- Existing codebase: `ralph-test/zoom-test.mjs`, `src/utils/pdfDebug.js`, `.playwright-mcp/` console logs
