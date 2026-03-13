# Phase 8: Post-Processing + Analysis - Research

**Researched:** 2026-03-13
**Domain:** JSONL timeline merging, anomaly detection, image diffing (Node.js CLI)
**Confidence:** HIGH

## Summary

Phase 8 transforms raw debug session artifacts (screenshots, state.jsonl, console.jsonl, performance.jsonl, manifest.json, video) into processed analysis outputs: a unified timeline (`timeline.json`), human-readable narrative (`timeline.md`), anomaly report (`anomalies.json`), and visual diff images (`diffs/`). This is pure Node.js file processing -- no browser, no Playwright, no React. All inputs are already produced by Phase 7's capture pipeline and follow well-documented schemas.

All required libraries are already installed: `pixelmatch@4.0.2`, `pngjs@3.x`, and `sharp@0.34.5` are present in `node_modules`. The JSONL files use `sessionMs` as a universal sort key, making timeline merging a straightforward read-parse-sort operation. The anomaly detection rules are fully specified in CONTEXT.md with exact thresholds and severity tiers.

**Primary recommendation:** Build a modular post-processing pipeline as separate `.mjs` files under `debug/lib/` (matching the existing module pattern), with a CLI entry point that reads a session folder path and writes processed outputs into the same folder.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Anomaly types:** Four distinct types with specific detection rules:
  1. Race condition (DOM mutation added -> pal_mount delta) -- warning at >100ms, critical if screenshot falls within gap
  2. Canvas container drop to 0 -- always critical
  3. Freeze overhang (freezeState stuck beyond 3000ms) -- always critical
  4. Scale divergence (renderedScale != targetScale beyond 3000ms) -- warning
- **Anomaly severity tiers:** Critical / Warning / Info with exact thresholds defined
- **Signal cross-referencing:** Anomaly detection MUST cross-reference performance marks with state.jsonl mutations for per-page event chains
- **Anomaly output format:** Each anomaly includes type, severity, sessionMs, page number, detail string, refs (screenshot filename, state entry index)
- **Timeline narrative style:** Phased narrative grouped by scenario step with session summary header, per-step sections, CDP metrics as step-boundary deltas
- **Console error bursts are NOT a separate anomaly type** -- console data stays in timeline.json only

### Claude's Discretion
- Visual diff approach (pixelmatch thresholds, full viewport vs cropped, mismatch % significance)
- Processing trigger (standalone CLI, chained after scenario, or both)
- Internal architecture of the post-processing pipeline (module structure, function signatures)
- Timeline.json merged entry schema details
- Mutation detail level in narrative (few = list them, many = summarize)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROC-01 | Anomaly detector scans state.jsonl and flags suspicious transitions: canvas container count drops to 0, portal host disconnects, console error bursts, rendered scale diverging from target scale | Anomaly detection module with four locked rules operating on state.jsonl + performance.jsonl data. Per CONTEXT.md, console error bursts are NOT a separate anomaly type. |
| PROC-02 | Anomaly detector produces anomalies.json with timestamp, type, severity, and references to related screenshots/state entries | Output schema with type, severity, sessionMs, page, detail, refs. Screenshot correlation via filename sessionMs parsing. |
| PROC-03 | Visual diff via pixelmatch compares before/after screenshots at each step, producing diff images and mismatch percentages stored in diffs/ | pixelmatch@4.0.2 + pngjs already installed. Screenshots follow `step-NN_MMMMMms_timing-description.png` naming convention, pairs identified by step number. |
| PROC-04 | Timeline merger sorts all JSONL streams by sessionMs into unified timeline.json | Three JSONL files (state, console, performance) all share sessionMs field. Read, parse, concat, sort, write. |
| PROC-05 | Timeline summary generates human/LLM-readable timeline.md narrative of the session | Phased narrative per CONTEXT.md: session header, per-step sections with synthesized events, anomaly callouts, CDP metric deltas. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pixelmatch | 4.0.2 | Pixel-level image comparison | Already installed. Pure function, zero dependencies, works on raw RGBA buffers. Returns mismatch pixel count. |
| pngjs | 3.x | PNG encode/decode for pixelmatch | Already installed (pixelmatch dependency). `PNG.sync.read()` and `PNG.sync.write()` for synchronous I/O. |
| sharp | 0.34.5 | Image dimension normalization (if needed) | Already in devDependencies. Only needed if before/after screenshots differ in dimensions (unlikely but safe fallback). |
| node:fs | built-in | File I/O (readFileSync, writeFileSync, mkdirSync) | Matches existing patterns in debug/lib modules. |
| node:path | built-in | Path manipulation | Matches existing patterns. |
| node:test | built-in | Unit test runner | Project standard (see tests/*.test.mjs). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:readline | built-in | Line-by-line JSONL parsing | For streaming JSONL reads if files are large. However, readFileSync + split('\n') is simpler and sufficient for session-sized files (<1MB). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pixelmatch | sharp.composite() | Sharp can overlay/compare but lacks pixel-level mismatch counting and diff visualization |
| pngjs | sharp | sharp can read PNG to raw buffer, but pngjs matches pixelmatch's expected API exactly |
| Custom JSONL parser | ndjson or JSONStream | Overkill -- session JSONL files are small enough for readFileSync + split + JSON.parse |

**Installation:**
```bash
# Nothing to install -- all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure
```
debug/
  lib/
    capture.mjs          # (existing) CaptureContext
    session.mjs          # (existing) Session creation
    screenshot.mjs       # (existing) Screenshot capture
    state-capture.mjs    # (existing) State capture
    perf-capture.mjs     # (existing) Performance capture
    console-capture.mjs  # (existing) Console capture
    post-process.mjs     # NEW: Pipeline orchestrator (reads session, calls modules)
    timeline-merger.mjs  # NEW: Merges JSONL streams into timeline.json
    anomaly-detector.mjs # NEW: Scans timeline data for anomalies
    visual-diff.mjs      # NEW: Generates screenshot diffs
    timeline-writer.mjs  # NEW: Generates timeline.md narrative
```

### Pattern 1: Pipeline Orchestrator
**What:** `post-process.mjs` exports a single `processSession(sessionDir)` function that orchestrates the pipeline: merge timeline -> detect anomalies -> generate diffs -> write narrative. Each step is a separate module function that takes inputs and returns outputs.
**When to use:** Always -- this is the main entry point.
**Example:**
```javascript
// debug/lib/post-process.mjs
import { mergeTimeline } from './timeline-merger.mjs';
import { detectAnomalies } from './anomaly-detector.mjs';
import { generateDiffs } from './visual-diff.mjs';
import { writeNarrative } from './timeline-writer.mjs';

export async function processSession(sessionDir) {
  // 1. Read manifest to understand session structure
  const manifest = JSON.parse(readFileSync(join(sessionDir, 'manifest.json'), 'utf-8'));

  // 2. Merge all JSONL streams into unified timeline
  const timeline = mergeTimeline(sessionDir);
  writeFileSync(join(sessionDir, 'timeline.json'), JSON.stringify(timeline, null, 2));

  // 3. Detect anomalies from merged timeline
  const anomalies = detectAnomalies(timeline, manifest);
  writeFileSync(join(sessionDir, 'anomalies.json'), JSON.stringify(anomalies, null, 2));

  // 4. Generate visual diffs for step boundaries
  await generateDiffs(sessionDir, manifest);

  // 5. Write human/LLM-readable narrative
  const narrative = writeNarrative(timeline, anomalies, manifest, sessionDir);
  writeFileSync(join(sessionDir, 'timeline.md'), narrative);

  return { timeline, anomalies };
}
```

### Pattern 2: JSONL Stream Parsing
**What:** Read JSONL files, parse each line, tag with source type, merge into sorted array.
**When to use:** Timeline merger.
**Example:**
```javascript
function readJsonl(filePath, source) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line, index) => {
    const entry = JSON.parse(line);
    return { ...entry, _source: source, _index: index };
  });
}

export function mergeTimeline(sessionDir) {
  const state = readJsonl(join(sessionDir, 'state.jsonl'), 'state');
  const perf = readJsonl(join(sessionDir, 'performance.jsonl'), 'performance');
  const console = readJsonl(join(sessionDir, 'console.jsonl'), 'console');

  const merged = [...state, ...perf, ...console];
  merged.sort((a, b) => a.sessionMs - b.sessionMs);
  return merged;
}
```

### Pattern 3: Screenshot Filename Parsing
**What:** Extract step number, sessionMs, and timing from screenshot filenames.
**When to use:** Visual diff pairing and anomaly cross-referencing.
**Example:**
```javascript
// Filename format: step-NN_MMMMMms_timing-description.png
const SCREENSHOT_REGEX = /^step-(\d{2})_(\d+)ms_(\w+)-(.+)\.png$/;

function parseScreenshotName(filename) {
  const match = filename.match(SCREENSHOT_REGEX);
  if (!match) return null;
  return {
    step: Number(match[1]),
    sessionMs: Number(match[2]),
    timing: match[3],       // 'baseline', 'before', 'after'
    description: match[4],
  };
}
```

### Pattern 4: Per-Page Event Chain Reconstruction
**What:** Build the diagnostic event chain (pal_unmount -> DOM mutation added -> pal_mount -> fabric_renderEnd) for each page, correlating performance marks with state.jsonl mutations.
**When to use:** Race condition anomaly detection.
**Example:**
```javascript
function buildPageEventChains(timeline) {
  const chains = {}; // pageNumber -> array of events

  for (const entry of timeline) {
    if (entry._source === 'performance' && entry.type === 'mark') {
      const page = entry.detail?.page;
      if (page == null) continue;
      if (!chains[page]) chains[page] = [];
      chains[page].push({
        event: entry.name,   // pal_mount, pal_unmount, fabric_renderEnd, etc.
        sessionMs: entry.sessionMs,
        detail: entry.detail,
      });
    }
    if (entry._source === 'state' && entry.mutations?.length > 0) {
      for (const mut of entry.mutations) {
        const page = mut.pageNumber;
        if (page == null) continue;
        if (!chains[page]) chains[page] = [];
        chains[page].push({
          event: `dom_page${mut.type === 'added' ? 'Added' : 'Removed'}`,
          sessionMs: mut.sessionMs,
          detail: mut,
        });
      }
    }
  }

  // Sort each page's chain by sessionMs
  for (const page of Object.keys(chains)) {
    chains[page].sort((a, b) => a.sessionMs - b.sessionMs);
  }
  return chains;
}
```

### Anti-Patterns to Avoid
- **Processing in Playwright context:** All post-processing is pure Node.js file I/O -- never run it inside a browser page.evaluate(). The data is already on disk.
- **Streaming overkill:** Session JSONL files are typically <1MB. Don't use streaming parsers or line-reader libraries. readFileSync + split('\n') is correct and simpler.
- **Modifying source artifacts:** Post-processing writes NEW files (timeline.json, anomalies.json, diffs/, timeline.md). Never modify the original JSONL or screenshot files.
- **Hardcoding session paths:** Always accept sessionDir as parameter, never hardcode paths to specific sessions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image pixel comparison | Custom pixel-loop RGB diff | pixelmatch + pngjs | Anti-aliasing detection, YIQ color space, battle-tested thresholds |
| PNG decode/encode | Manual buffer manipulation | pngjs `PNG.sync.read/write` | Handles interlacing, bit depth, color types correctly |
| Image resizing (dimension mismatch) | Canvas-based resize | sharp.resize() | Already installed, handles edge cases, native performance |

**Key insight:** The only "hard" library usage in this phase is pixelmatch, and its API is a single function call. The real complexity is in the anomaly detection logic (business rules, not library integration) and the narrative generation (text formatting, not algorithmic difficulty).

## Common Pitfalls

### Pitfall 1: DOM Mutation Events Are NOT Performance Marks
**What goes wrong:** CONTEXT.md references `dom_pageAdded` and `dom_pageRemoved` as if they are performance marks alongside `pal_mount` and `fabric_renderEnd`. They are NOT. DOM mutations are captured by MutationObserver and stored in the `mutations` array within `state.jsonl` entries, not in `performance.jsonl`.
**Why it happens:** The CONTEXT.md uses conceptual event names that map to different physical data sources.
**How to avoid:** The anomaly detector must cross-reference TWO data sources:
  - **Performance marks** from `performance.jsonl`: `pal_mount`, `pal_unmount`, `fabric_renderStart`, `fabric_renderEnd`, `zoom_start`, `zoom_end`, `portal_freeze`, `portal_unfreeze`, `pdf_loaded`
  - **DOM mutations** from `state.jsonl` `mutations` array: `{ type: 'added'|'removed', pageNumber, sessionMs, hasAnnotationLayer, hasFabricCanvas, pairSeq }`
**Warning signs:** If the anomaly detector only reads performance.jsonl, it will miss DOM mutation timing entirely.

### Pitfall 2: State Mutations Are Snapshotted Per-Step, Not Continuous
**What goes wrong:** Assuming state.jsonl has continuous real-time data. It doesn't -- it captures snapshots at step boundaries (before each scenario action). The `mutations` array within each state entry contains DOM mutations that occurred SINCE the last drain, but there are no state entries between steps.
**Why it happens:** CaptureContext.step() calls captureState() once per step with `drainMutations: true`.
**How to avoid:** Use performance.jsonl marks (which are continuous) for precise timing, and state.jsonl for context (freeze state, scale values, canvas counts at step boundaries).
**Warning signs:** Trying to detect "freeze overhang" purely from state.jsonl will miss timing -- you need to check both freezeState values across consecutive state entries AND the time gap between them.

### Pitfall 3: Screenshot Dimensions May Differ Between Zoom Steps
**What goes wrong:** pixelmatch requires identical dimensions for img1 and img2. After a zoom operation, the viewport content may render at a different scale, but since screenshots are full-viewport (`fullPage: false` with fixed viewport 1400x900), they should be identical in pixel dimensions.
**Why it happens:** False alarm in most cases -- Playwright viewport is fixed. But worth a defensive check.
**How to avoid:** Add a dimension check before pixelmatch: if `img1.width !== img2.width || img1.height !== img2.height`, skip the comparison and log a warning instead of crashing.

### Pitfall 4: Empty or Missing JSONL Files
**What goes wrong:** A session may have an empty console.jsonl (no console messages fired) or a session that failed early may lack some files entirely.
**Why it happens:** console-capture.mjs creates an empty file on start, but if capture failed early, files may be missing.
**How to avoid:** Always check `existsSync()` before reading JSONL files. Treat missing/empty files as zero entries, not errors.

### Pitfall 5: Pixelmatch Version 4.x Is CJS, Not ESM
**What goes wrong:** Importing with `import pixelmatch from 'pixelmatch'` may fail in pure ESM contexts because pixelmatch 4.0.2 uses `module.exports`.
**Why it happens:** The installed version (4.0.2) predates ESM adoption. Version 5.x+ is ESM-only.
**How to avoid:** Use `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const pixelmatch = require('pixelmatch');` OR use dynamic import which handles CJS interop: `const pixelmatch = (await import('pixelmatch')).default;`. Test this during implementation.

### Pitfall 6: sessionMs Precision in Sorting
**What goes wrong:** Multiple events can share the same integer sessionMs (e.g., two marks at sessionMs 11316). Sorting is stable in V8 but event ordering within the same millisecond depends on source file ordering.
**Why it happens:** Performance marks can fire within the same millisecond. State.jsonl uses `Math.round()` on sessionMs.
**How to avoid:** Use a stable sort with tie-breaking by source priority: performance marks first (most precise), then state entries, then console entries. Within same source, preserve original file order.

## Code Examples

### Visual Diff Generation (pixelmatch + pngjs)
```javascript
// Source: pixelmatch README + project screenshot naming convention
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pixelmatch = require('pixelmatch');

export async function generateDiffs(sessionDir) {
  const diffsDir = join(sessionDir, 'diffs');
  mkdirSync(diffsDir, { recursive: true });

  // Find screenshot pairs: same step, before/after timing
  const files = readdirSync(sessionDir).filter(f => f.endsWith('.png'));
  const parsed = files.map(f => ({ filename: f, ...parseScreenshotName(f) })).filter(Boolean);

  const steps = [...new Set(parsed.map(p => p.step))].sort((a, b) => a - b);
  const results = [];

  for (const step of steps) {
    const before = parsed.find(p => p.step === step && p.timing === 'before');
    const after = parsed.find(p => p.step === step && p.timing === 'after');
    if (!before || !after) continue;

    const img1 = PNG.sync.read(readFileSync(join(sessionDir, before.filename)));
    const img2 = PNG.sync.read(readFileSync(join(sessionDir, after.filename)));

    if (img1.width !== img2.width || img1.height !== img2.height) {
      results.push({ step, error: 'dimension_mismatch', before: before.filename, after: after.filename });
      continue;
    }

    const { width, height } = img1;
    const diff = new PNG({ width, height });
    const mismatchCount = pixelmatch(img1.data, img2.data, diff.data, width, height, {
      threshold: 0.1,
      includeAA: false,
    });

    const totalPixels = width * height;
    const mismatchPct = ((mismatchCount / totalPixels) * 100).toFixed(2);
    const diffFilename = `step-${String(step).padStart(2, '0')}_diff.png`;

    writeFileSync(join(diffsDir, diffFilename), PNG.sync.write(diff));

    results.push({
      step,
      before: before.filename,
      after: after.filename,
      diffImage: `diffs/${diffFilename}`,
      mismatchCount,
      mismatchPct: Number(mismatchPct),
      totalPixels,
    });
  }

  // Write diff summary
  writeFileSync(join(diffsDir, 'summary.json'), JSON.stringify(results, null, 2));
  return results;
}
```

### Anomaly Detection: Canvas Container Drop
```javascript
function detectCanvasContainerDrop(stateEntries) {
  const anomalies = [];
  for (let i = 0; i < stateEntries.length; i++) {
    const entry = stateEntries[i];
    if (entry.canvasContainerCount === 0) {
      anomalies.push({
        type: 'canvas_container_drop',
        severity: 'critical',
        sessionMs: entry.sessionMs,
        page: null,
        detail: `Canvas container count dropped to 0 at step ${entry.step} (${entry.action})`,
        refs: {
          stateIndex: i,
          screenshot: findNearestScreenshot(entry.sessionMs, screenshots),
        },
      });
    }
  }
  return anomalies;
}
```

### Anomaly Detection: Freeze Overhang
```javascript
function detectFreezeOverhang(stateEntries) {
  const anomalies = [];
  const CONFIRM_PENDING_TIMEOUT_MS = 3000;

  for (let i = 1; i < stateEntries.length; i++) {
    const prev = stateEntries[i - 1];
    const curr = stateEntries[i];
    const isFrozen = prev.freezeState?.scaleConfirmPending === true
      || prev.freezeState?.zoomOverlayTransformActive === true;

    if (isFrozen) {
      const duration = curr.sessionMs - prev.sessionMs;
      if (duration > CONFIRM_PENDING_TIMEOUT_MS) {
        anomalies.push({
          type: 'freeze_overhang',
          severity: 'critical',
          sessionMs: prev.sessionMs,
          page: null,
          detail: `Freeze state stuck for ${Math.round(duration)}ms (> ${CONFIRM_PENDING_TIMEOUT_MS}ms threshold) between step ${prev.step} and step ${curr.step}`,
          refs: {
            stateIndex: i - 1,
            screenshot: findNearestScreenshot(prev.sessionMs, screenshots),
          },
        });
      }
    }
  }
  return anomalies;
}
```

### Anomaly Detection: Scale Divergence
```javascript
function detectScaleDivergence(stateEntries) {
  const anomalies = [];
  const CONFIRM_PENDING_TIMEOUT_MS = 3000;

  for (let i = 1; i < stateEntries.length; i++) {
    const prev = stateEntries[i - 1];
    const curr = stateEntries[i];

    if (prev.renderedScale != null && prev.targetScale != null
        && prev.renderedScale !== prev.targetScale) {
      const duration = curr.sessionMs - prev.sessionMs;
      if (duration > CONFIRM_PENDING_TIMEOUT_MS) {
        anomalies.push({
          type: 'scale_divergence',
          severity: 'warning',
          sessionMs: prev.sessionMs,
          page: null,
          detail: `renderedScale (${prev.renderedScale}) != targetScale (${prev.targetScale}) persisted for ${Math.round(duration)}ms at step ${prev.step}`,
          refs: {
            stateIndex: i - 1,
            screenshot: findNearestScreenshot(prev.sessionMs, screenshots),
          },
        });
      }
    }
  }
  return anomalies;
}
```

### Anomaly Detection: Race Condition (DOM Mutation -> PAL Mount Gap)
```javascript
function detectRaceConditions(pageChains, screenshots) {
  const anomalies = [];
  const WARNING_THRESHOLD_MS = 100;
  const INFO_THRESHOLD_MS = 50;

  for (const [pageNum, events] of Object.entries(pageChains)) {
    for (let i = 0; i < events.length; i++) {
      if (events[i].event !== 'dom_pageAdded') continue;

      // Find next pal_mount for the same page
      const mountEvent = events.slice(i + 1).find(e => e.event === 'pal_mount');
      if (!mountEvent) continue;

      const delta = mountEvent.sessionMs - events[i].sessionMs;
      if (delta < INFO_THRESHOLD_MS) continue;

      // Check if any screenshot falls within the gap
      const gapStart = events[i].sessionMs;
      const gapEnd = mountEvent.sessionMs;
      const screenshotInGap = screenshots.find(s =>
        s.sessionMs >= gapStart && s.sessionMs <= gapEnd
      );

      const severity = screenshotInGap ? 'critical'
        : delta > WARNING_THRESHOLD_MS ? 'warning'
        : 'info';

      anomalies.push({
        type: 'race_condition',
        severity,
        sessionMs: events[i].sessionMs,
        page: Number(pageNum),
        detail: `${Math.round(delta)}ms gap between DOM page added and PAL mount on page ${pageNum}${screenshotInGap ? ` (screenshot ${screenshotInGap.filename} captured during gap)` : ''}`,
        refs: {
          stateIndex: null,
          screenshot: screenshotInGap?.filename
            || findNearestScreenshot(events[i].sessionMs, screenshots),
        },
      });
    }
  }
  return anomalies;
}
```

### Timeline Narrative Header
```javascript
function generateSessionHeader(manifest, anomalies) {
  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const warningCount = anomalies.filter(a => a.severity === 'warning').length;
  const infoCount = anomalies.filter(a => a.severity === 'info').length;

  const verdict = criticalCount > 0
    ? 'Session contains critical anomalies requiring investigation.'
    : warningCount > 0
    ? 'Session completed with warnings -- review recommended.'
    : 'Session completed cleanly with no anomalies detected.';

  return [
    `# Session Report: ${manifest.scenario}`,
    '',
    `**Result:** ${manifest.result.toUpperCase()}`,
    `**Duration:** ${new Date(manifest.endTime) - new Date(manifest.startTime)}ms`,
    `**Anomalies:** ${criticalCount} critical, ${warningCount} warning, ${infoCount} info`,
    '',
    verdict,
    '',
  ].join('\n');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pixelmatch 4.x (CJS) | pixelmatch 6.x (ESM) | 2024+ | Project uses 4.0.2 (CJS). Works fine, just needs CJS interop import. No need to upgrade. |
| Manual image dimension matching | sharp auto-resize | N/A | Not needed unless screenshot dimensions vary (they don't with fixed viewport). |

**Deprecated/outdated:**
- None relevant to this phase. All libraries used are stable and appropriate.

## Open Questions

1. **Handling multiple session folders**
   - What we know: CLI takes a single session folder path
   - What's unclear: Whether we need batch processing or glob-based multi-session runs
   - Recommendation: Start with single-session processing. Batch can be added trivially later since each session is independent.

2. **Post-processing trigger integration**
   - What we know: CONTEXT.md marks this as Claude's discretion (standalone CLI, chained after scenario, or both)
   - What's unclear: Whether the CLI should auto-run after `debug:scenario` or be a separate `debug:process` command
   - Recommendation: Both. Create `npm run debug:process <session-folder>` as standalone, AND optionally chain it at the end of CaptureContext.finalize() or as a Playwright afterAll hook. Standalone-first, integration-second.

3. **Visual diff significance threshold**
   - What we know: pixelmatch produces raw mismatch count and we compute percentage
   - What's unclear: What mismatch percentage is "significant" enough to flag
   - Recommendation: Store all diffs regardless. Use 1% as the "significant change" threshold in timeline.md narrative (below 1% is likely anti-aliasing noise). This is metadata, not filtering -- all diffs are always generated.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js native test runner (`node:test`) |
| Config file | None (project uses `--experimental-default-type=module --test`) |
| Quick run command | `node --experimental-default-type=module --test tests/post-process.test.mjs` |
| Full suite command | `node --experimental-default-type=module --test tests/*.test.mjs` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROC-01 | Anomaly detector flags canvas container drop, freeze overhang, scale divergence, race condition | unit | `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs` | No -- Wave 0 |
| PROC-02 | Anomaly output schema has type, severity, sessionMs, page, detail, refs | unit | `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs` | No -- Wave 0 |
| PROC-03 | pixelmatch generates diff images and mismatch % for step boundaries | unit | `node --experimental-default-type=module --test tests/visual-diff.test.mjs` | No -- Wave 0 |
| PROC-04 | Timeline merger produces sorted unified JSON from three JSONL sources | unit | `node --experimental-default-type=module --test tests/timeline-merger.test.mjs` | No -- Wave 0 |
| PROC-05 | Timeline summary generates markdown with header, per-step sections, anomaly callouts | unit | `node --experimental-default-type=module --test tests/timeline-writer.test.mjs` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `node --experimental-default-type=module --test tests/anomaly-detector.test.mjs tests/timeline-merger.test.mjs tests/visual-diff.test.mjs tests/timeline-writer.test.mjs`
- **Per wave merge:** `node --experimental-default-type=module --test tests/*.test.mjs`
- **Phase gate:** Full suite green + run `npm run debug:process` on actual session folder from Phase 7

### Wave 0 Gaps
- [ ] `tests/anomaly-detector.test.mjs` -- covers PROC-01, PROC-02
- [ ] `tests/visual-diff.test.mjs` -- covers PROC-03
- [ ] `tests/timeline-merger.test.mjs` -- covers PROC-04
- [ ] `tests/timeline-writer.test.mjs` -- covers PROC-05
- [ ] `debug/fixtures/mock-session/` -- synthetic session folder with known JSONL data and small test screenshots for deterministic testing
- [ ] Framework install: none needed (node:test is built-in)

## Data Schema Reference

### Existing Input Schemas (from Phase 7)

**state.jsonl entry:**
```json
{
  "sessionMs": 14170.7,
  "step": 1,
  "action": "zoom-100pct",
  "zoomLevel": 0.5,
  "renderedScale": 0.5,
  "targetScale": 1,
  "freezeState": {
    "zoomOverlayTransformActive": false,
    "scaleConfirmPending": false
  },
  "canvasContainerCount": 7,
  "pageStatus": [{"page": 1, "visible": true, "syncfusionDom": true, "palMounted": false, "fabricCanvas": false}],
  "mutations": [
    {"type": "added", "pageNumber": 6, "sessionMs": 14100.5, "hasAnnotationLayer": false, "hasFabricCanvas": false, "pairSeq": null, "seq": 1}
  ],
  "signals": {"pdfLoaded": true, "zoomSettled": true, "domSettled": true, "annotationsMounted": true}
}
```

**performance.jsonl entry (CDP type):**
```json
{
  "sessionMs": 14156,
  "type": "cdp",
  "metrics": {"LayoutCount": 4, "RecalcStyleCount": 58, "TaskDuration": 0.247, "...": "..."}
}
```

**performance.jsonl entry (mark type):**
```json
{
  "sessionMs": 10895,
  "type": "mark",
  "name": "pal_mount",
  "detail": {"page": 5}
}
```

**console.jsonl entry:**
```json
{
  "sessionMs": 12345,
  "level": "error",
  "text": "Error message text",
  "location": {"url": "...", "lineNumber": 100},
  "stackTrace": "..."
}
```

**manifest.json (relevant fields):**
```json
{
  "scenario": "zoom-flicker",
  "result": "pass",
  "captureStartMs": 13474.3,
  "criteriaResults": {
    "canvasContainersPresent": {"pass": true, "value": 7},
    "noConsoleErrors": {"pass": true, "errorCount": 0}
  }
}
```

**Screenshot filename convention:**
```
step-NN_MMMMMms_timing-description.png
step-00_13597ms_baseline-initial-state.png
step-01_13953ms_before-zoom-100pct.png
step-01_14789ms_after-zoom-100pct.png
```

### Available Performance Mark Names
From actual data and source code:
| Mark Name | Detail Fields | Source |
|-----------|---------------|--------|
| `pal_mount` | `{ page }` | PageAnnotationLayer.jsx |
| `pal_unmount` | `{ page }` | PageAnnotationLayer.jsx |
| `fabric_renderStart` | `{ page, source?, scale? }` | PageAnnotationLayer.jsx |
| `fabric_renderEnd` | `{ page, source?, scale? }` | PageAnnotationLayer.jsx |
| `zoom_start` | `{ scale, targetScale?, source }` | App.jsx |
| `zoom_end` | `{ source }` | App.jsx |
| `portal_freeze` | `{ reason, source }` | App.jsx |
| `portal_unfreeze` | `{ reason }` | App.jsx |
| `pdf_loaded` | `{ pageCount, currentPage }` | App.jsx |

**NOTE:** `dom_pageAdded` and `dom_pageRemoved` are NOT performance marks. They are DOM mutation records stored in `state.jsonl` `mutations` arrays with `type: 'added'` or `type: 'removed'`.

## Sources

### Primary (HIGH confidence)
- Project source code: `debug/lib/*.mjs` (6 modules), `src/utils/debugBridge.js`, `debug/scenarios/zoom-flicker.spec.mjs`
- Actual session data: `debug/debug-sessions/20260313T040742_zoom-flicker/` (manifest.json, state.jsonl, performance.jsonl, console.jsonl, 20 screenshots)
- pixelmatch source: `node_modules/pixelmatch/index.js` (v4.0.2, CJS export)
- [pixelmatch GitHub README](https://github.com/mapbox/pixelmatch) -- API signature, options, Node.js example

### Secondary (MEDIUM confidence)
- pngjs `PNG.sync.read/write` API -- verified via installed package and pixelmatch README example

### Tertiary (LOW confidence)
- None -- all findings verified against actual project code and data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in node_modules
- Architecture: HIGH -- follows established `debug/lib/*.mjs` module pattern exactly
- Pitfalls: HIGH -- all pitfalls verified against actual session data (especially the dom_pageAdded misconception verified by grepping source code and real performance.jsonl)
- Data schemas: HIGH -- all schemas verified against actual session output files
- Anomaly detection rules: HIGH -- locked in CONTEXT.md with exact thresholds

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable -- no fast-moving dependencies)
