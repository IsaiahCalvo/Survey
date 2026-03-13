# Phase 8: Post-Processing + Analysis - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Raw session artifacts (screenshots, state.jsonl, console.jsonl, performance.jsonl, video, manifest.json) are automatically processed into a unified timeline (`timeline.json`), a synthesized narrative (`timeline.md`), anomaly reports (`anomalies.json`), and visual diffs (`diffs/`). No LLM integration, no chunking, no prompt templates -- those are Phase 9.

</domain>

<decisions>
## Implementation Decisions

### Anomaly detection rules

Four distinct anomaly types, each with its own detection rule:

1. **Race condition (dom_pageAdded -> pal_mount delta)** -- The core anomaly. Calculate the time delta between `dom_pageAdded` and `pal_mount` performance marks for the same page number. Flag as warning at >100ms. Escalate to critical if any screenshot's `sessionMs` falls within the gap (meaning the flicker was potentially visible in a captured frame).

2. **Canvas container drop** -- `canvasContainerCount` drops to 0 at any point in state.jsonl. Critical severity always. Hard failure: all annotation canvases gone.

3. **Freeze overhang** -- `freezeState` stuck at `true` beyond the 3000ms confirm-pending timer. Critical severity. Portal host freeze never released, annotations stuck in stale state.

4. **Scale divergence** -- `renderedScale != targetScale` persisting beyond the 3000ms confirm-pending window. Warning severity. Classic zoom flicker symptom: Syncfusion zoom finished but Fabric.js canvas layout hasn't caught up.

Console error bursts are NOT a separate anomaly type -- console data stays in timeline.json for raw reference but doesn't trigger its own rule.

### Anomaly severity tiers

Three tiers mapping to urgency:
- **Critical** -- Canvas container drop to 0, freeze overhang > 3s, race condition gap that spans a captured screenshot frame
- **Warning** -- Race condition delta > 100ms (not spanning screenshot), scale divergence beyond confirm-pending window
- **Info** -- Race condition delta 50-100ms, brief scale mismatch within expected settling window

### Signal cross-referencing

Anomaly detection MUST cross-reference performance marks with state.jsonl mutations to build per-page event chains. The race condition anomaly specifically needs both:
- **Performance marks** for precise sub-millisecond timing (dom_pageAdded, pal_mount, fabric_renderEnd)
- **State.jsonl mutations** for context (was freeze active? what was scale? what was canvasContainerCount?)

Per-page event chains reconstruct the full lifecycle: dom_pageRemoved -> dom_pageAdded -> pal_mount -> fabric_renderEnd, with gaps identified between each transition.

### Anomaly output format

Each anomaly in `anomalies.json` includes: type, severity, sessionMs, page number, human-readable detail string, and refs (screenshot filename, state entry index) for cross-navigation.

### Timeline narrative style (timeline.md)

**Phased narrative** grouped by scenario step (matching CaptureContext step numbers):

1. **Session summary header** (3-5 lines) -- scenario name, parameters, pass/fail result, anomaly count by severity, 1-2 sentence verdict. Gives Phase 9 LLM immediate context.

2. **Per-step sections** -- Each step gets a heading with time range and duration. Contains:
   - Synthesized summary of what happened (not raw event dump)
   - Key events as bullet points with sessionMs timestamps
   - Anomaly callouts inline (with severity icon and reference to screenshot)
   - Noise collapsed: rapid DOM mutations summarized as count + time span (e.g., "page 6 destroyed/recreated 3 times over 45ms")

3. **CDP metrics as step-boundary deltas** -- Show LayoutCount, TaskDuration, RecalcStyleCount changes between step start and end. Only displayed when delta exceeds thresholds (LayoutCount > 20, TaskDuration > 100ms).

### Claude's Discretion
- Visual diff approach (pixelmatch thresholds, full viewport vs cropped, mismatch % that flags significance)
- Processing trigger (standalone CLI, chained after scenario, or both)
- Internal architecture of the post-processing pipeline (module structure, function signatures)
- How timeline.json structures merged entries (schema details)
- Mutation detail level in narrative: Claude picks right granularity based on mutation count (few = list them, many = summarize)

</decisions>

<specifics>
## Specific Ideas

- The per-page event chain (dom_pageRemoved -> dom_pageAdded -> pal_mount -> fabric_renderEnd) is the diagnostic centerpiece -- it directly maps to the failure mode where Syncfusion destroys/recreates a virtualized page but React's PAL mount lags behind
- Timeline.md is specifically designed to feed Phase 9's LLM chunker -- it must be "pre-digested" so the LLM reads synthesized analysis, not raw telemetry
- Noise synthesis example: "Syncfusion rapidly destroyed and recreated page 6 three times over 45ms" is far more useful to an LLM than 6 individual mutation entries
- Gap isolation example: "React failed to mount PageAnnotationLayer on page 6 before the visual frame was captured at sessionMs 1240" -- this is the exact sentence an LLM needs to identify the root cause
- Anomaly refs must point to specific screenshot filenames so Phase 9 can include the visual evidence alongside the narrative

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `debug/lib/session.mjs`: Session folder utilities -- post-processor reads manifest.json to find artifacts
- `debug/lib/capture.mjs`: CaptureContext defines step structure -- post-processor mirrors step grouping
- `debug/lib/screenshot.mjs`: Screenshot naming convention (`step-NN_MMMMMms_timing-description.png`) -- post-processor parses these for sessionMs and step number
- `debug/lib/state-capture.mjs`: State entry schema (sessionMs, step, action, zoomLevel, renderedScale, targetScale, freezeState, canvasContainerCount, pageStatus, mutations, signals) -- anomaly detector's primary input
- `debug/lib/perf-capture.mjs`: Performance entry schema (sessionMs, type='mark'|'cdp', name, detail, metrics) -- anomaly detector's timing source
- `debug/lib/console-capture.mjs`: Console entry schema (sessionMs, level, text, location, stackTrace) -- timeline merger input

### Established Patterns
- JSONL format with `sessionMs` as universal timestamp -- timeline merger sorts by this field
- `appendFileSync` for atomic line writes -- post-processor reads these line-by-line
- Performance marks use `category_event` naming (zoom_start, dom_pageAdded, pal_mount, fabric_renderEnd) -- anomaly detector parses these names
- Manifest.json contains `captureStartMs` for video alignment and `criteriaResults` for pass/fail detail

### Integration Points
- Input: `debug/debug-sessions/<timestamp>_<scenario>/` folders containing all raw artifacts
- Output: Same session folder, enriched with `timeline.json`, `timeline.md`, `anomalies.json`, `diffs/`
- `package.json`: Needs post-processing CLI entry point
- Phase 9 consumes: timeline.md (narrative), anomalies.json (flagged issues), diffs/ (visual evidence), timeline.json (raw merged data)

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 08-post-processing-analysis*
*Context gathered: 2026-03-13*
