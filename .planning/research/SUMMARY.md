# Project Research Summary

**Project:** BetaSafe Survey Tool — v2.0 Automated Debug & Analysis Pipeline
**Domain:** Playwright-driven automated debugging infrastructure for Electron/React PDF annotation app
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

This project adds a deterministic automated debugging pipeline on top of an existing Electron/React PDF annotation app (Syncfusion PDF Viewer + Fabric.js annotation layer). The core principle is explicit and consistent across all four research areas: Playwright scripts collect evidence with high fidelity, humans and LLMs analyze that evidence. No AI improvisation in test generation. No app behavior changes in debug mode. The pipeline is observational — it captures what the app does, not what we want it to do. Every design decision should preserve this separation.

The recommended approach is a 5-phase build in strict dependency order: Foundation (session infrastructure + auth bypass) then Capture Modules (Playwright video/screenshots/console/CDP state) then Scenario Execution (deterministic scripts + pass/fail) then Post-Processing (timeline merge + anomaly detection + visual diffs) then LLM Integration (chunked artifacts + analysis prompt templates). The architecture's central tension is that the primary debugging target — a 50-200ms post-zoom canvas flicker — may be uncapturable by screenshots alone. Video recording is therefore non-negotiable as a first-class artifact, with frame extraction as a post-processing step. Everything else is built around this constraint.

The three most dangerous failure modes are: (1) building the entire capture pipeline before verifying that Fabric.js canvas content actually appears in Playwright screenshots (it historically does not without specific configuration); (2) adding instrumentation to the app's zoom/render hot path that changes timing enough to suppress the exact race condition being debugged (Heisenbug); and (3) accumulating GB-scale artifact storage without a retention policy. All three are preventable with upfront design choices in Phase 1. The existing `ralph-test/zoom-test.mjs` prototype proves the core approach is sound — the v2.0 work is formalization and scaling, not invention.

## Key Findings

### Recommended Stack

The pipeline adds exactly 5 new devDependencies to the existing project: `@playwright/test` (browser automation + test runner), `pixelmatch` (screenshot pixel comparison), `pngjs` (PNG decode for pixelmatch input), `ffmpeg-static` (bundled FFmpeg binary for video frame extraction), and `fluent-ffmpeg` (Node.js FFmpeg API). `sharp` is already installed. Zero production dependencies are added. All data is stored as NDJSON (newline-delimited JSON, one event per line) in folder-per-run session directories — no database. The existing Vite dev server on port 5173 is the automation target, with Playwright's `webServer` config auto-starting it.

See full details: `.planning/research/STACK.md`

**Core technologies:**
- `@playwright/test` ^1.58.0: Browser automation + video + tracing + CDP access — single dependency that replaces Puppeteer + a test runner + separate video tooling
- `pixelmatch` ^7.1.0: Pixel-level screenshot comparison — zero dependencies, detects 1-2px annotation position shifts that human review misses
- `pngjs` ^7.0.0: PNG decode/encode — required by pixelmatch for raw RGBA buffer input
- `ffmpeg-static` ^5.3.0 + `fluent-ffmpeg` ^2.1.3: Video frame extraction — bundled FFmpeg binary, no system dependency, extracts keyframes from Playwright WebM recordings
- NDJSON via built-in `JSON.stringify`: Structured event logs — crash-safe append-only, greppable, LLM-readable without any library

### Expected Features

The research defines a clear 3-tier MVP structure. Phase 1 features are blockers: without them, the pipeline does not run at all. Phase 2 features provide internal visibility into the React rendering state. Phase 3 features close the loop with automated analysis and LLM-ready output.

See full details: `.planning/research/FEATURES.md`

**Must have (table stakes — pipeline cannot function without these):**
- Playwright test harness with deterministic scenario scripts — without this there are no inputs
- Dev-only auth bypass route — fragile login flows break test automation; gate behind `import.meta.env.DEV`
- Session folder structure with manifest — every run must produce an inspectable artifact bundle
- Screenshot capture at deterministic step boundaries — primary evidence collection
- Video recording (Playwright built-in, zero custom code) — required for sub-frame flicker capture
- Console log capture and persistence as JSONL — captures half the diagnostic signal
- App state snapshots at each scenario step — correlates visual artifacts with internal state
- Pass/fail determination per scenario — without this, all review is manual

**Should have (deep visibility and automated analysis):**
- Extended debug API (`window.__debugBridge`) — exposes React refs and zoom state not visible in DOM
- DOM mutation monitoring — tracks when Syncfusion destroys/recreates page containers
- Performance metrics via CDP — Layout Shift, Long Tasks, paint timing
- Anomaly detection (rule-based) — flags cc=0 drops, portal disconnects, error bursts automatically
- Visual diff with pixelmatch — detects position shifts between before/after screenshots
- Timeline summary — single human/LLM-readable narrative of session events

**Defer to v2+:**
- Advanced video frame-differencing for keyframe extraction — complex, low incremental value over step-boundary screenshots
- Scenario parameterization — useful once base scenarios are solid
- Playwright Trace Viewer recording — zero effort to add but produces huge files; add when explicitly needed
- Semantic retrieval / embeddings — explicitly v3 scope per project docs

**Deliberate anti-features (do not build):**
- AI-generated test scenarios — non-deterministic, defeats the core philosophy
- Real-time monitoring dashboard — over-engineered for a local single-developer tool
- CI/CD integration — premature until local pipeline is proven
- Cross-browser or Electron-specific automation — Chromium only, same rendering engine as the app

### Architecture Approach

The architecture is a 4-layer system: App Layer (existing React app + new Debug Bridge window global) then Capture Layer (Playwright + CDP capture modules) then Orchestration Layer (Session Manager + Scenario Runner + Post-Processor) then Storage Layer (folder-per-run NDJSON files). The key structural choice is harness-vs-bridge separation: harness code runs in Node.js (outside the browser), bridge code runs inside the React app. They communicate across the process boundary exclusively via `page.evaluate()` (pull-based polling, not push events). This prevents debug infrastructure from coupling to the app render loop.

See full details: `.planning/research/ARCHITECTURE.md`

**Major components:**
1. **Debug Bridge** (`window.__debugBridge`) — Aggregates existing `pdfPerf`/`pdfDebug`/`__pdfHistoryDebug` APIs and exposes internal React refs (zoom state, portal host status, freeze flags) not visible in DOM. Read-only. Approximately 60 lines in App.jsx, guarded by `import.meta.env.DEV`. Must be built first — all capture modules depend on it.
2. **Session Manager** — Creates `sessions/{timestamp}_{scenario}/` folders, writes manifest, manages artifact file handles. Must be built before any capture module.
3. **Capture Modules** (independent, per-type) — `console-capture.mjs`, `screenshot-capture.mjs`, `video-capture.mjs`, `app-state-capture.mjs`, `performance-capture.mjs`. Each is independent; scenarios enable only what they need.
4. **Scenario Runner** — Deterministic action sequences: navigate to page, execute interactions, coordinate capture start/stop, determine pass/fail. Base class handles setup/teardown; specific scenarios define only the interaction sequence.
5. **Post-Processor** — Timeline Merger (sorts all JSONL streams by `sessionMs`), Anomaly Detector (rule-based pattern matching), LLM Chunker (splits timeline windows into context-sized chunks with source code snippets).

**Critical cross-cutting pattern — Synchronized Artifact Timeline:** All artifacts store timestamps relative to a shared session epoch. At session start, Playwright records `performance.timeOrigin` (browser) and `Date.now()` (Node.js) simultaneously. The offset (`browserToNodeMs`) enables post-processing to sort console logs, screenshots, app state dumps, and video frames onto a single timeline within plus or minus 1ms accuracy.

### Critical Pitfalls

The research identified 5 critical pitfalls (pipeline-breaking), 6 moderate pitfalls (serious but workaroundable), and 5 minor pitfalls (gotchas).

See full details: `.planning/research/PITFALLS.md`

**Top 5 (must prevent in Phase 1-2):**

1. **Canvas content invisible in Playwright traces** — Playwright trace DOM snapshots do not capture Fabric.js canvas pixels by default. Prevention: use `page.screenshot()` and video recording as primary visual capture. Validate canvas content appears in screenshots BEFORE building any infrastructure around it. Test in Phase 1 before proceeding.

2. **Headless vs headed rendering differences** — The default Playwright headless shell uses a stripped-down Chromium renderer that handles CSS transforms, canvas compositing, and GPU acceleration differently from headed mode. Flicker that is visible headed may not reproduce headless. Prevention: use `channel: 'chromium'` (new headless mode) in Playwright config, which uses the same rendering code as headed mode. This decision must be made in Phase 1 as it affects all downstream screenshots.

3. **Race conditions between Syncfusion page load and screenshot capture** — Syncfusion destroys and recreates `e-pv-page-div` elements during zoom. A visible canvas does not mean a rendered canvas. Prevention: expose `window.__debugReady = { annotationsRendered: true, zoomSettled: true }` from the app. Playwright must `waitForFunction` on this signal before any screenshot. Never rely on `waitForLoadState('networkidle')` alone.

4. **Serialization depth limits when extracting app state** — `page.evaluate()` silently returns `undefined` for deeply nested objects (Fabric.js objects have circular references and 100+ properties). Prevention: never return raw Fabric.js objects from `page.evaluate()`. The Debug Bridge must pre-serialize all state to flat, serializable shapes inside the browser. Use `page.evaluate(() => JSON.stringify(window.__debugState()))` and parse on the Node.js side.

5. **Instrumentation altering the timing of the bug being debugged (Heisenbug)** — The post-zoom flicker is a 50-200ms race condition. Adding `console.log` (0.1-1ms overhead) or `page.evaluate()` polling (5-20ms) during the flicker window can shift the race condition outcome and make the bug disappear. Prevention: use `performance.mark()` (0.01ms) not `console.log` in hot paths. Do NOT call `page.evaluate()` during the critical flicker window — poll before zoom starts and after the settle timer completes. Validate the bug reproduces WITH instrumentation before trusting any artifacts.

**Additional moderate pitfalls to design around from Phase 1:**
- Vite HMR interference during test runs — use dedicated test Vite instance with `server.hmr: false`
- Auth bypass route leaking to production — use `import.meta.env.DEV` (compile-time) not `process.env.NODE_ENV` (runtime)
- Disk space exhaustion — implement retention policy (keep last N sessions) from day one; record video at 720p

## Implications for Roadmap

The research across all four files converges on the same 5-phase dependency order. The ordering is not arbitrary — earlier phases produce artifacts that later phases require, and skipping phases causes specific, documented failures.

### Phase 1: Pipeline Foundation

**Rationale:** Nothing else can run without session infrastructure and a way to open the app without a login flow. These have no dependencies and unblock everything downstream. Canvas capture validation must happen here — building 2-3 more phases on a broken foundation wastes days.

**Delivers:** A working pipeline that can open the app, navigate to a test page, and produce a session folder with at least one screenshot and a manifest.

**Addresses (from FEATURES.md):** Dev-only auth bypass, Playwright test harness, session folder structure, session manifest.

**Avoids (from PITFALLS.md):** Pitfall 1 (canvas in traces — validate here), Pitfall 2 (headless rendering — configure `channel: 'chromium'` here), Pitfall 6 (HMR interference — dedicated test Vite instance here), Pitfall 7 (auth bypass leak — `import.meta.env.DEV` guard here).

**Research flag:** Needs validation, not deeper research. The pattern is well-documented, but Pitfall 1 (canvas visibility) must be empirically verified with this app before Phase 2 begins.

### Phase 2: Debug Bridge + Readiness Signals

**Rationale:** Internal app state (zoom refs, portal host status, freeze flags) is invisible to Playwright without instrumentation. The capture modules in Phase 3 depend on this data. The Debug Bridge is also where readiness signals (`__debugReady`) live, which prevent race condition screenshots in Phase 3. This is the most dangerous phase for introducing Heisenbugs (Pitfall 11) — it must be designed and validated carefully.

**Delivers:** `window.__debugBridge` with snapshot API, `window.__debugReady` readiness signals, extended `pdfDebug.dump()` output.

**Addresses (from FEATURES.md):** Extended debug API, app state snapshots (richer data), DOM mutation monitoring.

**Avoids (from PITFALLS.md):** Pitfall 3 (Syncfusion readiness signals), Pitfall 4 (serialization depth), Pitfall 11 (Heisenbug instrumentation), Pitfall 13 (flaky Syncfusion DOM waits).

**Research flag:** Standard pattern (window globals in React via useEffect). No additional research needed, but requires careful implementation to avoid Heisenbug risk.

### Phase 3: Capture Modules + Scenario Execution

**Rationale:** With session infrastructure (Phase 1) and the Debug Bridge (Phase 2) in place, the capture modules have everything they need. Port `ralph-test/zoom-test.mjs` into the formal scenario framework as the first scenario. Synchronized timestamps must be implemented here — retroactively aligning timestamps across artifact streams is impractical.

**Delivers:** Full artifact capture for the zoom-flicker scenario: video, screenshots at step boundaries, console JSONL, app state JSONL, performance metrics. Pass/fail determination. CLI entry point.

**Addresses (from FEATURES.md):** Video recording, screenshot capture, console log capture, app state snapshots, pass/fail determination, scenario runner framework, all 6 zoom methods scenario.

**Avoids (from PITFALLS.md):** Pitfall 5 (timeline desynchronization — synchronized epoch here), Pitfall 8 (disk space — retention policy here), Pitfall 10 (uncapturable transient states — video as primary evidence), Pitfall 14 (video recording performance impact — 720p setting), Pitfall 16 (PDF fixture loading — local test fixtures).

**Uses (from STACK.md):** `@playwright/test` (all capture), `pngjs` (PNG I/O for Phase 4), NDJSON append pattern.

**Research flag:** Well-documented Playwright patterns. The only uncertainty is ffmpeg WebM frame extraction (MEDIUM confidence from STACK.md) — verify this works with Playwright's specific WebM output before building post-processing around it.

### Phase 4: Post-Processing + Analysis Layer

**Rationale:** Post-processing requires real session artifacts to develop against — synthetic test data will not catch edge cases in JSONL parsing, timestamp alignment, or anomaly detection thresholds. This phase can only begin once Phase 3 produces real sessions. The anomaly detector's rules (cc=0 drops, portal disconnects, error rate spikes) are known from the v1.0 zoom bug investigation and can be codified directly.

**Delivers:** Timeline merger (single sorted timeline.json), anomaly detector (anomalies.json with evidence references), visual diff via pixelmatch (before/after diff images + mismatch percentages), keyframe extractor (important moment identification).

**Addresses (from FEATURES.md):** Anomaly detection, visual diff (pixelmatch), timeline summary, keyframe extraction (step-boundary variant, not advanced frame-differencing).

**Avoids (from PITFALLS.md):** Pitfall 15 (manifest drift — write manifest last, scan actual folder contents).

**Uses (from STACK.md):** `pixelmatch` + `pngjs` (visual diff), `ffmpeg-static` + `fluent-ffmpeg` (keyframe extraction), `sharp` (image resize/crop for thumbnails).

**Research flag:** Timeline merger and anomaly detection have well-documented JSONL processing patterns. Pixelmatch integration is well-documented. Only uncertainty: ffmpeg WebM keyframe extraction (should be validated in Phase 3 first).

### Phase 5: LLM Integration

**Rationale:** LLM analysis quality depends entirely on artifact quality from Phase 4. Shipping correct capture and post-processing first prevents the situation where LLM chunks contain incoherent timelines and the team attributes bad analysis to LLM limitations instead of bad upstream data.

**Delivers:** Pre-chunked LLM context windows keyed to semantic units (per zoom operation, per anomaly), analysis prompt templates, session reader's guide telling the LLM what each file is and what to look for.

**Addresses (from FEATURES.md):** LLM-friendly artifact chunking, analysis prompt template.

**Avoids (from PITFALLS.md):** Pitfall 9 (LLM context overflow — pre-filter to errors/warnings, chunk by semantic unit not byte size, budget tokens: 30% source code, 40% artifact data, 30% analysis output).

**Research flag:** Needs research. LLM chunking strategies are well-documented but the optimal chunking strategy for this artifact format (multi-stream JSONL with synchronized timestamps) is not. The "chunk by zoom operation" approach is reasonable but needs validation with the target LLM.

### Phase Ordering Rationale

- Session infrastructure must come before capture modules: capture modules need to know where to write files before they can be built
- Debug Bridge must come before scenarios: scenarios call `__debugBridge.snapshot()` and the API must exist
- Capture modules must come before post-processing: post-processing needs real artifacts to develop against (synthetic data misses edge cases)
- Post-processing must come before LLM integration: LLM chunk quality depends on timeline merger and anomaly detector being correct
- This order also matches the pitfall risk profile: the most critical pitfalls (1, 2, 6, 7) are all Phase 1 concerns, ensuring they are resolved before any significant investment in later phases

### Research Flags

Phases requiring validation or deeper research during planning:

- **Phase 1:** Empirically validate that Fabric.js canvas content appears in Playwright screenshots with the specific headless Chromium config (`channel: 'chromium'`). Do this before writing any other infrastructure. If canvas is blank, the entire artifact strategy needs revision.
- **Phase 3:** Validate ffmpeg WebM keyframe extraction works with Playwright's specific WebM output (VP8/VP9). Build a one-off test before building the keyframe extractor module around this assumption.
- **Phase 5:** Research optimal LLM chunking strategy for multi-stream JSONL artifacts with synchronized timestamps. The semantic chunking approach (per zoom operation) is directionally correct but needs tuning for the target LLM context window.

Phases with standard well-documented patterns (skip research-phase):

- **Phase 2:** `window` global via React `useEffect` is a standard pattern. The Debug Bridge design in ARCHITECTURE.md is detailed enough to implement directly.
- **Phase 3 (capture):** All Playwright capture APIs are HIGH confidence from official docs. Screenshot, video, console capture, CDP metrics — no additional research needed.
- **Phase 4 (pixelmatch):** pixelmatch is the de facto standard, extensively documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core recommendations verified against official docs and npm registry. Only MEDIUM area: ffmpeg WebM output format compatibility — needs integration test, not further research. |
| Features | HIGH | Feature list derived from existing working prototype (`ralph-test/zoom-test.mjs`) plus well-documented Playwright patterns. Differentiator features are clearly separated from table stakes. |
| Architecture | HIGH | Core patterns proven in existing prototype. 4-layer architecture mirrors standard Playwright test infrastructure. The Debug Bridge pattern already exists in App.jsx (see `window.__pdfHistoryDebug` at line ~13735). |
| Pitfalls | HIGH | All critical pitfalls backed by official Playwright GitHub issues and documentation. The canvas-visibility pitfall (1) and Heisenbug risk (11) are specific to this app's architecture and well-evidenced. |

**Overall confidence:** HIGH

### Gaps to Address

- **ffmpeg WebM compatibility:** STACK.md rates this MEDIUM because "Playwright's WebM format and ffmpeg's keyframe extraction from WebM specifically has not been verified end-to-end." Resolve by running a one-off extraction test (5 lines of code) during Phase 3, before building the keyframe extractor module.
- **Flicker captureability:** The 50-200ms flicker window may be entirely missed by async screenshots. The research prescribes video + frame extraction as the solution, but this has not been validated on this specific app. The first session run should include a manual video review to confirm flicker appears in the recording.
- **Debug Bridge scope:** The research identifies which App.jsx refs need to be exposed (approximately 40-60 lines), but the exact ref names and their locations in the 1.3MB App.jsx need confirmation at implementation time. The existing `window.__pdfHistoryDebug` pattern at line ~13735 provides the implementation template.
- **LLM chunk format validation:** The optimal LLM chunk format (token budget, semantic boundaries, how much source code to include) cannot be determined without running actual analysis sessions. Build Phase 5 iteratively — ship a basic chunker and refine based on LLM analysis quality.

## Sources

### Primary (HIGH confidence)

- [Playwright Official Docs — Tracing, Videos, CDPSession, Screenshots, ConsoleMessage](https://playwright.dev) — all capture module APIs
- [Playwright Release Notes](https://playwright.dev/docs/release-notes) — version 1.58.2 current as of 2026-03-12
- [@playwright/test npm](https://www.npmjs.com/package/@playwright/test) — version confirmation
- [pixelmatch GitHub (mapbox/pixelmatch)](https://github.com/mapbox/pixelmatch) — screenshot comparison approach
- [Playwright Issue #23964: Canvas not visible in trace](https://github.com/microsoft/playwright/issues/23964) — critical pitfall 1 source
- [Playwright Issue #38433: Disk space from uncleaned traces](https://github.com/microsoft/playwright/issues/38433) — pitfall 8 source
- [Currents: Headless vs Headed in Playwright](https://currents.dev/posts/when-tests-should-run-headless-vs-headed-in-playwright) — pitfall 2 source
- Existing codebase: `ralph-test/zoom-test.mjs`, `src/utils/pdfDebug.js`, `src/utils/performanceLogger.js`, `src/App.jsx` line ~13735

### Secondary (MEDIUM confidence)

- [fluent-ffmpeg GitHub](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) — video processing API
- [Playwright Performance Testing (BrowserStack/Checkly)](https://www.browserstack.com/guide/playwright-performance-testing) — CDP session coordination patterns
- [Supabase Playwright testing via REST API](https://mokkapps.de/blog/login-at-supabase-via-rest-api-in-playwright-e2e-test) — auth bypass approach
- [Pinecone: Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/) — Phase 5 chunking approach
- [Vite Issue #12883: Flaky tests with Playwright](https://github.com/vitejs/vite/issues/12883) — HMR interference pitfall

### Tertiary (LOW confidence — needs validation during implementation)

- ffmpeg WebM VP8/VP9 keyframe extraction — documented capability, unverified with Playwright's specific output format
- LLM token budget recommendations (30/40/30 split) — reasonable heuristic, needs tuning against actual session sizes

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
