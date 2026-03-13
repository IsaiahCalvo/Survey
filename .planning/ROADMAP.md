# Roadmap: BetaSafe Survey Tool

## Milestones

- ✅ **v1.0 Zoom Fix** - Phases 1-4 (shipped 2026-03-11)
- 🚧 **v2.0 Debug Annotations** - Phases 5-9 (in progress)

## Phases

<details>
<summary>v1.0 Zoom Fix (Phases 1-4) - SHIPPED 2026-03-11</summary>

- [x] **Phase 1: CSS Transform Scaling** - Annotations stay visible and scale smoothly during zoom
- [x] **Phase 2: Positional Accuracy** - Annotations track page content with cursor-centered zoom
- [x] **Phase 3: Flicker-Free Transitions** - Three-ref freeze prevents portal host disconnection during zoom
- [x] **Phase 4: Scale Caching** - Deferred (unnecessary after three-ref freeze approach)

</details>

### v2.0 Debug Annotations

**Phase Numbering:**
- Integer phases (5, 6, 7, 8, 9): Planned milestone work
- Decimal phases (e.g., 5.1): Urgent insertions (marked with INSERTED)

- [x] **Phase 5: Pipeline Foundation** - Dev test route, Playwright harness, session folder infrastructure, and canvas capture validation (completed 2026-03-12)
- [ ] **Phase 6: Debug Bridge + Readiness Signals** - App instrumentation exposing internal state for external capture
- [ ] **Phase 7: Capture Modules + Scenario Execution** - Full artifact capture with deterministic scenario scripts and CLI entry point
- [ ] **Phase 8: Post-Processing + Analysis** - Anomaly detection, visual diffs, and unified timeline from raw session artifacts
- [ ] **Phase 9: LLM Integration** - Chunked artifacts and prompt templates for LLM-assisted diagnosis

## Phase Details

### Phase 5: Pipeline Foundation
**Goal**: A working pipeline can open the app without authentication, navigate to a test page, and produce a session folder with a screenshot proving Fabric.js canvas content is captured
**Depends on**: Nothing (first phase of v2.0 milestone)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, FOUN-06
**Success Criteria** (what must be TRUE):
  1. Running a test script opens the app at `localhost:5173?testPdf=<name>` and displays a PDF with annotations visible -- no login required
  2. The dev test route produces zero code in a production build (verified by building and inspecting output)
  3. Playwright launches Chromium against the Vite dev server and a screenshot of an annotated page shows Fabric.js canvas content (not blank canvases)
  4. Each test run creates a `debug-sessions/<timestamp>_<scenario>/` folder containing a `manifest.json` with scenario name, git SHA, start/end time, and artifact paths
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md -- Dev test route and fixture infrastructure (FOUN-01, FOUN-02)
- [x] 05-02-PLAN.md -- Playwright harness, session folders, and canvas capture validation (FOUN-03, FOUN-04, FOUN-05, FOUN-06)

### Phase 6: Debug Bridge + Readiness Signals
**Goal**: The app exposes its internal rendering state through window globals that external tools can query without altering timing-sensitive behavior
**Depends on**: Phase 5
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05, INST-06
**Success Criteria** (what must be TRUE):
  1. `window.__debugBridge.snapshot()` returns a flat JSON object containing zoom level, rendered scale, target scale, portal host count, freeze state, and canvas container count
  2. `window.__debugReady` accurately reports when annotations are rendered, zoom has settled, and page navigation is complete -- Playwright can wait on these signals before taking action
  3. DOM mutation events for Syncfusion `e-pv-page-div` container destroy/recreate appear in state snapshots with timestamps
  4. Debug instrumentation uses `performance.mark()` in hot paths and produces zero overhead in production builds
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Capture Modules + Scenario Execution
**Goal**: A deterministic scenario script drives the app through a zoom sequence, captures synchronized artifacts (video, screenshots, console, state, performance), determines pass/fail, and is runnable from a single CLI command
**Depends on**: Phase 6
**Requirements**: CAPT-01, CAPT-02, CAPT-03, CAPT-04, CAPT-05, CAPT-06, CAPT-07, CAPT-08, FOUN-07, FOUN-08
**Success Criteria** (what must be TRUE):
  1. Running `npm run debug:scenario zoom-flicker` produces a session folder containing: video (WebM), step-boundary screenshots, `console.jsonl`, `state.jsonl`, `performance.jsonl`, and `manifest.json`
  2. All artifacts share a synchronized timeline -- any event in `console.jsonl` can be correlated to the matching frame in the video and the matching entry in `state.jsonl` by `sessionMs` offset
  3. Screenshots are captured only after `window.__debugReady` signals readiness, avoiding race conditions with Syncfusion page rebuilds
  4. The scenario determines pass/fail automatically based on defined criteria (canvas container count, console error absence) and records the result in the manifest
  5. The same scenario can run with different parameters (zoom range, speed, starting page) without code changes
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Post-Processing + Analysis
**Goal**: Raw session artifacts are automatically processed into a unified timeline, anomaly reports, and visual diffs that highlight exactly when and where rendering problems occurred
**Depends on**: Phase 7
**Requirements**: PROC-01, PROC-02, PROC-03, PROC-04, PROC-05
**Success Criteria** (what must be TRUE):
  1. Running post-processing on a session folder produces `timeline.json` (all JSONL streams merged and sorted by `sessionMs`) and `timeline.md` (human-readable narrative of session events with key state changes highlighted)
  2. `anomalies.json` flags suspicious transitions -- canvas container count dropping to 0, portal host disconnects, console error bursts, rendered scale diverging from target scale -- with timestamps and references to related screenshots/state entries
  3. `diffs/` folder contains before/after screenshot comparisons with diff images and mismatch percentages for every step boundary
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

### Phase 9: LLM Integration
**Goal**: Session artifacts are chunked into context-window-sized pieces with source code references so an LLM can analyze a debugging session and identify root causes
**Depends on**: Phase 8
**Requirements**: PROC-06, PROC-07
**Success Criteria** (what must be TRUE):
  1. Session artifacts are split into chunks keyed to semantic units (per zoom operation, per anomaly) with relevant source code snippets included -- each chunk fits within an LLM context window
  2. The analysis prompt template (`analysis-prompt.md`) provides structured instructions that, when given to an LLM with a session's chunks, produces a diagnosis identifying the timeline of events, the anomaly, and candidate root causes in the source code
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. CSS Transform Scaling | v1.0 | 2/2 | Complete | 2026-03-11 |
| 2. Positional Accuracy | v1.0 | 2/2 | Complete | 2026-03-11 |
| 3. Flicker-Free Transitions | v1.0 | 1/1 | Complete | 2026-03-11 |
| 4. Scale Caching | v1.0 | 0/0 | Deferred | - |
| 5. Pipeline Foundation | v2.0 | 2/2 | Complete | 2026-03-12 |
| 6. Debug Bridge + Readiness Signals | v2.0 | 0/? | Not started | - |
| 7. Capture Modules + Scenario Execution | v2.0 | 0/? | Not started | - |
| 8. Post-Processing + Analysis | v2.0 | 0/? | Not started | - |
| 9. LLM Integration | v2.0 | 0/? | Not started | - |
