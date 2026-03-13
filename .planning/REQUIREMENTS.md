# Requirements: Debug Annotations v2.0

**Defined:** 2026-03-12
**Core Value:** Automated, deterministic capture of synchronized debugging artifacts for LLM-assisted annotation rendering diagnosis

## v2.0 Requirements

Requirements for Debug Annotations milestone. Each maps to roadmap phases.

### Foundation

- [x] **FOUN-01**: Dev-only test route loads a bundled test PDF at `localhost:5173?testPdf=<name>` without requiring Supabase authentication
- [x] **FOUN-02**: Dev-only test route is compile-time guarded (`import.meta.env.DEV`) and produces zero code in production builds
- [x] **FOUN-03**: Playwright test harness launches Chromium against the Vite dev server with `channel: 'chromium'` for consistent canvas rendering
- [x] **FOUN-04**: Playwright harness auto-starts the Vite dev server via `webServer` config if not already running
- [x] **FOUN-05**: Each test run creates a session folder at `debug-sessions/<timestamp>_<scenario>/` containing all artifacts
- [x] **FOUN-06**: Each session folder contains a `manifest.json` with scenario name, git SHA, start/end time, pass/fail result, and artifact file paths
- [ ] **FOUN-07**: Scenario scripts are parameterizable — same scenario can run with different zoom ranges, speeds, and starting pages
- [ ] **FOUN-08**: CLI entry point (`npm run debug:scenario <name>`) runs a named scenario and produces a session folder

### Capture

- [x] **CAPT-01**: Screenshots captured at every deterministic step boundary (before/after each scripted action) with descriptive filenames
- [x] **CAPT-02**: Video recorded for the entire session duration via Playwright's built-in recording (WebM, 720p)
- [x] **CAPT-03**: Console messages (log, warn, error) captured with timestamps and persisted as `console.jsonl`
- [x] **CAPT-04**: App state snapshots captured at each step via `window.__debugBridge.snapshot()` and persisted as `state.jsonl`
- [ ] **CAPT-05**: Pass/fail determination runs automatically at scenario end based on scenario-defined criteria (e.g., canvas container count >= 1, no console errors)
- [x] **CAPT-06**: All artifacts share a synchronized timeline — browser `performance.timeOrigin` mapped to Node.js epoch at session start, all timestamps stored as `sessionMs` offset
- [x] **CAPT-07**: Performance metrics collected via CDP (`Performance.getMetrics`) including Layout Shift, Long Tasks, and paint timing, stored as `performance.jsonl`
- [x] **CAPT-08**: Screenshots wait for `window.__debugReady` readiness signal before capture to avoid race conditions with Syncfusion page rebuilds

### Instrumentation

- [x] **INST-01**: `window.__debugBridge` API exposes current zoom level, rendered scale, target scale, portal host count, freeze state, and canvas container count
- [x] **INST-02**: `window.__debugBridge.snapshot()` returns a flat, JSON-serializable object (no Fabric.js objects, no circular references)
- [x] **INST-03**: `window.__debugReady` exposes readiness signals: annotations rendered, zoom settled, page navigation complete
- [x] **INST-04**: Debug bridge is compile-time guarded (`import.meta.env.DEV`) — zero overhead in production
- [x] **INST-05**: DOM mutation monitoring tracks Syncfusion `e-pv-page-div` container destroy/recreate events with timestamps, stored in state snapshots
- [x] **INST-06**: Instrumentation uses `performance.mark()` (0.01ms) not `console.log` in hot paths to avoid altering timing-sensitive race conditions

### Processing

- [ ] **PROC-01**: Anomaly detector scans `state.jsonl` and flags suspicious transitions: canvas container count drops to 0, portal host disconnects, console error bursts, rendered scale diverging from target scale
- [ ] **PROC-02**: Anomaly detector produces `anomalies.json` with timestamp, type, severity, and references to related screenshots/state entries
- [ ] **PROC-03**: Visual diff via pixelmatch compares before/after screenshots at each step, producing diff images and mismatch percentages stored in `diffs/`
- [ ] **PROC-04**: Timeline merger sorts all JSONL streams by `sessionMs` into a unified `timeline.json`
- [ ] **PROC-05**: Timeline summary generates a human/LLM-readable `timeline.md` narrative of the session (chronological events with key state changes highlighted)
- [ ] **PROC-06**: LLM chunker splits session artifacts into context-window-sized chunks keyed to semantic units (per zoom operation, per anomaly) with source code references
- [ ] **PROC-07**: Analysis prompt template (`analysis-prompt.md`) provides structured instructions for LLM analysis including manifest, timeline, key snapshots, and what to look for

## Previous Milestone (v1.0 — Zoom Fix)

Carried forward for reference. These are partially validated.

### Zoom Visibility (Partially Validated)

- ✓ **ZVIS-01**: Annotations stay visible during zoom — v1.0 (CSS transform overlay)
- ✓ **ZVIS-02**: Annotations scale smoothly during zoom — v1.0 (GPU-accelerated transforms)

### Zoom Correctness (Partially Validated)

- **ZCOR-01**: Positional accuracy during zoom — partially working, post-zoom flicker remains
- **ZCOR-02**: No flicker during/after zoom — NOT MET, this is the first debug target
- **ZCOR-03**: Transform-origin alignment — partially working

## Future Requirements

Deferred to later milestones.

### Retrieval & Indexing (v3+)

- **RETR-01**: Gemini Embedding 2 indexes screenshots, video segments, and log summaries for semantic search
- **RETR-02**: Semantic search retrieves relevant artifact chunks by natural language query

### Infrastructure (v3+)

- **INFR-01**: CI pipeline runs scenarios on every PR and reports pass/fail
- **INFR-02**: Session retention policy auto-deletes sessions older than N days
- **INFR-03**: Network request logging captures Supabase API calls and failed requests
- **INFR-04**: Playwright trace recording produces .zip viewable in Trace Viewer

## Out of Scope

| Feature | Reason |
|---------|--------|
| AI-generated test scenarios | Non-deterministic, defeats core philosophy of scripted evidence collection |
| Automated fix generation | Premature — LLM analyzes evidence, human decides fixes |
| Real-time monitoring dashboard | Over-engineered for single-developer local tool |
| CI/CD pipeline integration | Premature until local pipeline is proven |
| Database storage for sessions | Folder-per-run is sufficient; database only when file-based becomes painful |
| Electron-specific automation | Same rendering engine as Chromium; targeting Vite dev server is more stable |
| Cross-browser testing | App only runs in Chromium (Electron); other browsers add zero value |
| Golden baseline screenshot diffing | Annotation content varies; within-session self-comparison is the right pattern |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 5 | Complete |
| FOUN-02 | Phase 5 | Complete |
| FOUN-03 | Phase 5 | Complete |
| FOUN-04 | Phase 5 | Complete |
| FOUN-05 | Phase 5 | Complete |
| FOUN-06 | Phase 5 | Complete |
| FOUN-07 | Phase 7 | Pending |
| FOUN-08 | Phase 7 | Pending |
| CAPT-01 | Phase 7 | Complete |
| CAPT-02 | Phase 7 | Complete |
| CAPT-03 | Phase 7 | Complete |
| CAPT-04 | Phase 7 | Complete |
| CAPT-05 | Phase 7 | Pending |
| CAPT-06 | Phase 7 | Complete |
| CAPT-07 | Phase 7 | Complete |
| CAPT-08 | Phase 7 | Complete |
| INST-01 | Phase 6 | Complete |
| INST-02 | Phase 6 | Complete |
| INST-03 | Phase 6 | Complete |
| INST-04 | Phase 6 | Complete |
| INST-05 | Phase 6 | Complete |
| INST-06 | Phase 6 | Complete |
| PROC-01 | Phase 8 | Pending |
| PROC-02 | Phase 8 | Pending |
| PROC-03 | Phase 8 | Pending |
| PROC-04 | Phase 8 | Pending |
| PROC-05 | Phase 8 | Pending |
| PROC-06 | Phase 9 | Pending |
| PROC-07 | Phase 9 | Pending |

**Coverage:**
- v2.0 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after roadmap phase mapping*
