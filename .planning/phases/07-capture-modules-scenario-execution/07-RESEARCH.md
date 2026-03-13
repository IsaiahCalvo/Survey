# Phase 7: Capture Modules + Scenario Execution - Research

**Researched:** 2026-03-12
**Domain:** Playwright-based deterministic scenario execution with synchronized multi-artifact capture
**Confidence:** HIGH

## Summary

Phase 7 builds on the existing Phase 5/6 infrastructure (Playwright test harness, session folders, debug bridge, readiness signals) to create a complete scenario execution pipeline. The scenario drives the app through a zoom sequence, captures synchronized artifacts (video, screenshots, console logs, state snapshots, performance metrics), determines pass/fail, and is runnable from a single CLI command.

The core challenge is **coordination**: five capture streams (video, screenshots, console, state, performance) must share a synchronized timeline anchored to `performance.timeOrigin`. Playwright 1.58.2 (already installed) provides all necessary APIs: built-in video recording (WebM), `page.on('console')` for message interception, CDP sessions for `Performance.getMetrics`, and `page.screenshot()` with readiness-gated timing. The existing `debug/lib/session.mjs` handles session folder creation and manifest finalization, and `debugBridge.js` provides `snapshot()`, `waitFor()`, and `debugMark()`.

The recommended approach is to author scenarios as Playwright test files (`.spec.mjs`) that use shared capture modules (imported from `debug/lib/`). The CLI entry point (`npm run debug:scenario <name>`) translates to `npx playwright test --grep <name>` with appropriate config. Parameterization uses environment variables parsed in the test file, keeping scenario code simple and the CLI interface clean.

**Primary recommendation:** Build capture modules as importable helpers in `debug/lib/`, wire them into a scenario test file pattern, and use Playwright's native video + CDP session for recording and performance capture.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Screenshot naming convention: `step-01_02150ms_before-zoom-200pct.png` (step number + sessionMs + action description)
- Baseline screenshot at step-00: `step-00_00000ms_baseline.png`
- Before/after pairs at each scripted action boundary
- JSONL stream separation: `state.jsonl` (per-step bridge snapshots), `performance.jsonl` (high-frequency timing + CDP metrics)
- state.jsonl contains: sessionMs, step number, action name, zoomLevel, renderedScale, targetScale, freezeState, canvasContainerCount, pageStatus array, drained mutations
- performance.jsonl contains: performance.mark() entries AND CDP metrics, each with sessionMs and type ('mark' or 'cdp')
- Synchronized timeline baseline: sessionMs = browser's `performance.now()`, all entries stamped relative to `performance.timeOrigin`
- Video alignment: manifest records `captureStartMs` so video frame offset = sessionMs - captureStartMs
- Console capture: ALL levels (log, warn, error, info), tagged with level field, stack traces for errors
- console.jsonl format: `{"sessionMs":5100,"level":"error","text":"...","stackTrace":"..."}`
- No post-processing, no anomaly detection, no LLM integration (those are Phases 8-9)

### Claude's Discretion
- Scenario authoring model (Playwright test format vs standalone script vs custom abstraction)
- CLI entry point implementation (`npm run debug:scenario <name>` wiring)
- Pass/fail criteria specifics (thresholds, strictness, how result is surfaced)
- Parameter passing mechanism (CLI flags vs config object)
- Video recording configuration (Playwright built-in vs CDP)
- Capture module internal architecture (how capture modules coordinate)
- How CDP `Performance.getMetrics` is polled and at what frequency

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAPT-01 | Screenshots at every deterministic step boundary with descriptive filenames | Playwright `page.screenshot()` + locked naming convention `step-NN_MMMMMs_description.png` |
| CAPT-02 | Video recorded for entire session via Playwright built-in (WebM, 720p) | Playwright `video: 'on'` config + `page.video().saveAs()` to copy into session folder |
| CAPT-03 | Console messages captured with timestamps as `console.jsonl` | Playwright `page.on('console')` + ConsoleMessage API (type, text, location) |
| CAPT-04 | App state snapshots at each step via `window.__debugBridge.snapshot()` as `state.jsonl` | Existing bridge API with `drainMutations: true` option |
| CAPT-05 | Pass/fail determination at scenario end based on scenario-defined criteria | Playwright `expect()` assertions + result recorded in manifest |
| CAPT-06 | All artifacts share synchronized timeline via `performance.timeOrigin` mapped to `sessionMs` | Browser `performance.now()` already used by bridge; captureStartMs in manifest for video alignment |
| CAPT-07 | Performance metrics via CDP (`Performance.getMetrics`) as `performance.jsonl` | CDP session via `page.context().newCDPSession(page)` + periodic polling |
| CAPT-08 | Screenshots wait for `window.__debugReady` before capture | Existing `waitFor('ready')` API from Phase 6 |
| FOUN-07 | Scenarios parameterizable (zoom range, speed, starting page) | Environment variables parsed in test file; CLI passes them |
| FOUN-08 | CLI entry point `npm run debug:scenario <name>` produces session folder | npm script wrapping `npx playwright test --config debug/playwright.config.mjs --grep <name>` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | 1.58.2 | Test runner, browser automation, video recording | Already installed, proven in Phases 5-6 |
| Node.js fs | built-in | JSONL file writing (appendFileSync for low-volume, step-boundary writes) | No external deps needed for line-by-line JSONL |
| CDP (Chrome DevTools Protocol) | via Playwright | Performance.getMetrics for system-level metrics | Only way to get LayoutCount, RecalcStyleCount, etc. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| path (Node built-in) | built-in | File path construction for artifacts | Session folder file management |
| child_process (Node built-in) | built-in | Git SHA capture in session.mjs | Already used in existing session.mjs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright built-in video | CDP screencast | CDP gives frame-level control but requires manual WebM encoding -- massive complexity for marginal gain |
| appendFileSync for JSONL | createWriteStream | Streams are better for high-frequency writes, but state.jsonl writes happen at step boundaries (5-10 writes per scenario) -- appendFileSync is simpler and sufficient |
| Environment variables for params | Playwright projects | Projects are heavier infrastructure; env vars are simpler for a single-developer debug tool |

**Installation:**
```bash
# No new packages needed -- everything is already installed or built-in
# Playwright 1.58.2 is in devDependencies
# All other dependencies are Node.js built-ins
```

## Architecture Patterns

### Recommended Project Structure
```
debug/
├── lib/
│   ├── session.mjs          # (existing) Session creation + manifest finalization
│   ├── capture.mjs           # (NEW) Capture coordinator -- wires all capture modules
│   ├── console-capture.mjs   # (NEW) Console message → console.jsonl
│   ├── state-capture.mjs     # (NEW) Bridge snapshots → state.jsonl
│   ├── perf-capture.mjs      # (NEW) CDP metrics + performance marks → performance.jsonl
│   └── screenshot.mjs        # (NEW) Readiness-gated screenshots with naming convention
├── scenarios/
│   ├── smoke.spec.mjs        # (existing) Phase 5 gate test
│   ├── bridge-snapshot.spec.mjs  # (existing) Phase 6 bridge tests
│   ├── readiness-signals.spec.mjs # (existing) Phase 6 readiness tests
│   └── zoom-flicker.spec.mjs     # (NEW) Main zoom scenario
├── playwright.config.mjs     # (existing, needs video + scenario project config)
├── fixtures/                 # (existing)
└── debug-sessions/           # (existing) Session output folder
```

### Pattern 1: Capture Coordinator
**What:** A single `CaptureContext` object created per scenario that coordinates all capture streams (console, state, perf, screenshot), manages JSONL file handles, and provides a clean API for the scenario script.
**When to use:** Every scenario test file creates a CaptureContext at test start.
**Example:**
```javascript
// debug/lib/capture.mjs
import { createSession, finalizeSession, getSessionBaseDir } from './session.mjs';
import { startConsoleCapture, stopConsoleCapture } from './console-capture.mjs';
import { captureState } from './state-capture.mjs';
import { startPerfCapture, stopPerfCapture } from './perf-capture.mjs';
import { takeScreenshot } from './screenshot.mjs';

export class CaptureContext {
  constructor(scenarioName, page) {
    this.page = page;
    this.scenarioName = scenarioName;
    this.stepCount = 0;
    const baseDir = getSessionBaseDir();
    const { sessionDir, manifest } = createSession(scenarioName, baseDir);
    this.sessionDir = sessionDir;
    this.manifest = manifest;
    this.artifacts = [];
    this.captureStartMs = null;
  }

  async start() {
    // Record captureStartMs from browser for video alignment
    this.captureStartMs = await this.page.evaluate(() => performance.now());
    this.manifest.captureStartMs = this.captureStartMs;

    // Start continuous captures
    startConsoleCapture(this.page, this.sessionDir);
    await startPerfCapture(this.page, this.sessionDir);
  }

  async step(actionName, actionFn) {
    const stepNum = this.stepCount++;
    // Before screenshot
    await takeScreenshot(this.page, this.sessionDir, stepNum, 'before', actionName);
    // State snapshot before
    await captureState(this.page, this.sessionDir, stepNum, actionName);
    // Execute the action
    await actionFn();
    // Wait for readiness after action
    await this.page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30000 }));
    // After screenshot
    await takeScreenshot(this.page, this.sessionDir, stepNum, 'after', actionName);
  }

  async finalize(result) {
    stopConsoleCapture();
    await stopPerfCapture(this.page, this.sessionDir);
    // Copy video into session folder
    // (video.saveAs handles waiting for completion)
    finalizeSession(this.sessionDir, this.manifest, result, this.artifacts);
  }
}
```

### Pattern 2: Readiness-Gated Screenshot
**What:** Every screenshot call waits for `window.__debugReady.waitFor('ready')` before capturing, preventing race conditions with Syncfusion page rebuilds.
**When to use:** All screenshots in scenarios.
**Example:**
```javascript
// debug/lib/screenshot.mjs
import path from 'node:path';

export async function takeScreenshot(page, sessionDir, stepNum, timing, actionName) {
  // Wait for readiness signal (CAPT-08)
  await page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30000 }));

  // Get sessionMs from browser for filename
  const sessionMs = await page.evaluate(() => performance.now());
  const msStr = String(Math.round(sessionMs)).padStart(5, '0');
  const stepStr = String(stepNum).padStart(2, '0');
  const safeName = actionName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const filename = `step-${stepStr}_${msStr}ms_${timing}-${safeName}.png`;

  await page.screenshot({
    path: path.join(sessionDir, filename),
    fullPage: false,
  });

  return { filename, sessionMs };
}
```

### Pattern 3: CDP Session for Performance Metrics
**What:** Open a CDP session at scenario start, enable `Performance` domain, poll `Performance.getMetrics` at intervals and at step boundaries.
**When to use:** Every scenario that needs `performance.jsonl`.
**Example:**
```javascript
// debug/lib/perf-capture.mjs
import { appendFileSync } from 'node:fs';
import path from 'node:path';

let cdpClient = null;
let pollInterval = null;

export async function startPerfCapture(page, sessionDir) {
  cdpClient = await page.context().newCDPSession(page);
  await cdpClient.send('Performance.enable');

  const filePath = path.join(sessionDir, 'performance.jsonl');

  // Poll CDP metrics every 500ms
  pollInterval = setInterval(async () => {
    try {
      const { metrics } = await cdpClient.send('Performance.getMetrics');
      const sessionMs = await page.evaluate(() => performance.now());
      const entry = {
        sessionMs,
        type: 'cdp',
        metrics: Object.fromEntries(metrics.map(m => [m.name, m.value])),
      };
      appendFileSync(filePath, JSON.stringify(entry) + '\n');
    } catch { /* page may have closed */ }
  }, 500);
}

export async function stopPerfCapture(page, sessionDir) {
  if (pollInterval) clearInterval(pollInterval);

  // Final flush: collect performance marks from browser
  const marks = await page.evaluate(() =>
    performance.getEntriesByType('mark')
      .filter(m => m.name.includes('_'))
      .map(m => ({ name: m.name, startTime: m.startTime, detail: m.detail }))
  );

  const filePath = path.join(sessionDir, 'performance.jsonl');
  for (const mark of marks) {
    const entry = {
      sessionMs: mark.startTime,
      type: 'mark',
      name: mark.name,
      detail: mark.detail,
    };
    appendFileSync(filePath, JSON.stringify(entry) + '\n');
  }
}
```

### Pattern 4: Scenario as Playwright Test with Parameters
**What:** Scenarios are `.spec.mjs` files that read parameters from environment variables, use the CaptureContext for artifact collection, and Playwright's `expect()` for pass/fail.
**When to use:** The zoom-flicker scenario (and all future scenarios).
**Example:**
```javascript
// debug/scenarios/zoom-flicker.spec.mjs
import { test, expect } from '@playwright/test';
import { CaptureContext } from '../lib/capture.mjs';

// Parameters from environment (FOUN-07)
const ZOOM_MIN = Number(process.env.ZOOM_MIN || 100);
const ZOOM_MAX = Number(process.env.ZOOM_MAX || 200);
const ZOOM_STEP = Number(process.env.ZOOM_STEP || 25);
const START_PAGE = Number(process.env.START_PAGE || 6);

test('zoom-flicker scenario', async ({ page }) => {
  const ctx = new CaptureContext('zoom-flicker', page);
  await ctx.start();

  // Step 0: Baseline
  await page.goto(`/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`);
  await page.evaluate(() => window.__debugReady.waitFor('pdfLoaded', { timeout: 30000 }));
  // Navigate to start page, zoom sequence, etc.
  // ...
  await ctx.finalize('pass');
});
```

### Anti-Patterns to Avoid
- **Coupling capture logic into scenario files:** Keep capture modules in `debug/lib/` and scenarios in `debug/scenarios/`. Scenarios should read like a script of user actions, not capture plumbing.
- **Using waitForTimeout instead of readiness signals:** Phase 6 built `waitFor('ready')` precisely to replace arbitrary timeouts. Never use `waitForTimeout()` for settling.
- **Appending to JSONL from the browser:** All JSONL writing must happen in Node.js (Playwright test process). The browser provides data via `page.evaluate()`, Node.js writes files.
- **Manual video encoding:** Use Playwright's built-in video recording, not CDP screencast. The complexity of manual WebM encoding is not justified.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video recording | Custom CDP screencast + WebM encoder | Playwright `video: 'on'` config + `page.video().saveAs()` | Playwright handles codec, frame buffering, file finalization automatically |
| Console interception | Custom CDP `Runtime.consoleAPICalled` | Playwright `page.on('console')` | Playwright normalizes console messages across browser versions; provides type, text, location |
| Test runner / CLI | Custom Node.js script launching Chromium | Playwright Test runner (`npx playwright test`) | Handles browser lifecycle, webServer auto-start, timeouts, retries, reporting |
| Session timestamps | Custom Date/epoch tracking | Existing `debug/lib/session.mjs` | Already handles ISO timestamps, git SHA, folder naming |
| Readiness detection | Custom polling loops | Existing `window.__debugReady.waitFor()` | Phase 6 built a debounced, signal-based system with cascading invalidation |
| State capture | Custom DOM queries in Playwright | Existing `window.__debugBridge.snapshot()` | Bridge already computes zoomLevel, freezeState, canvasContainerCount, pageStatus |

**Key insight:** Phase 6 invested heavily in `debugBridge.js` and readiness signals. Phase 7 is the consumer of that investment -- it should call the existing APIs, not reinvent them.

## Common Pitfalls

### Pitfall 1: Video File Lifecycle Timing
**What goes wrong:** Trying to access `page.video().path()` or `page.video().saveAs()` before the browser context closes -- video file is incomplete or empty.
**Why it happens:** Playwright writes video data as a stream and only finalizes the file when the context closes.
**How to avoid:** Call `page.video().saveAs(targetPath)` in a `test.afterEach()` hook AFTER the test body completes. `saveAs()` automatically waits for the page/context to close and the video to be fully written.
**Warning signs:** Zero-length WebM files in session folder, or `saveAs()` promise that never resolves.

### Pitfall 2: Console Message Timing vs sessionMs
**What goes wrong:** Console messages captured via `page.on('console')` don't have a browser-side timestamp -- they arrive in Node.js with unpredictable delay.
**Why it happens:** `page.on('console')` fires asynchronously in Node.js. There is no built-in `performance.now()` timestamp on the `ConsoleMessage` object.
**How to avoid:** When the console handler fires, immediately call `page.evaluate(() => performance.now())` to get the closest possible sessionMs. Alternatively, accept that console timestamps have ~5-50ms jitter and document this in the manifest. For Phases 8-9 analysis, this is sufficient granularity.
**Warning signs:** Console entries with suspiciously identical timestamps, or timestamps that don't correlate with nearby state snapshots.

### Pitfall 3: CDP Session Detachment During Page Navigation
**What goes wrong:** CDP session becomes detached after page navigation or context changes, causing `Performance.getMetrics` to throw.
**Why it happens:** CDP sessions are tied to a specific target. Navigation or page reload can detach the session.
**How to avoid:** Wrap CDP calls in try/catch. Re-establish the session if it detaches. For this project, the test page loads once and doesn't navigate (just zoom), so this risk is low.
**Warning signs:** `Protocol error: Session closed` errors in test output.

### Pitfall 4: Performance Marks Cleared on Navigation
**What goes wrong:** `performance.getEntriesByType('mark')` returns empty array because marks were cleared.
**Why it happens:** Full page navigation clears the performance timeline. In this project, the dev test route does a single page load, but `clearMarks()` or `clearMeasures()` calls in app code could also clear them.
**How to avoid:** Collect marks at step boundaries (not just at the end), or verify that the app doesn't call `performance.clearMarks()`. Alternatively, collect marks incrementally during the scenario.
**Warning signs:** `performance.jsonl` has marks only from the final step, not from earlier steps.

### Pitfall 5: Screenshot Race with Syncfusion Rerender
**What goes wrong:** Screenshot captures a partially-rendered state where Syncfusion has destroyed page divs but hasn't recreated them yet.
**Why it happens:** The known zoom bug -- Syncfusion destroys/recreates `e-pv-page-div` elements during zoom, creating a ~50-200ms gap.
**How to avoid:** Always use `waitFor('ready')` before screenshots (CAPT-08). This waits for `domSettled`, `zoomSettled`, and `annotationsMounted` signals with 75ms debounce.
**Warning signs:** Screenshots showing blank white rectangles where annotations should be.

### Pitfall 6: JSONL File Corruption from Concurrent Writes
**What goes wrong:** Two capture modules try to write to the same JSONL file simultaneously, producing garbled lines.
**Why it happens:** `appendFileSync` is synchronous and atomic per call in Node.js, but if two async paths reach it at the same time with overlapping data, lines can interleave.
**How to avoid:** Each JSONL file has exactly ONE writer module: `console-capture.mjs` writes `console.jsonl`, `state-capture.mjs` writes `state.jsonl`, `perf-capture.mjs` writes `performance.jsonl`. Never share a file between modules. `appendFileSync` for POSIX-compliant small writes (< PIPE_BUF = 4096 bytes) is atomic -- each JSONL line is well under this limit.
**Warning signs:** JSON parse errors when reading back JSONL files.

## Code Examples

Verified patterns from existing codebase and official documentation:

### Console Capture Module
```javascript
// debug/lib/console-capture.mjs
import { appendFileSync } from 'node:fs';
import path from 'node:path';

let handler = null;

export function startConsoleCapture(page, sessionDir) {
  const filePath = path.join(sessionDir, 'console.jsonl');

  handler = async (msg) => {
    // Get sessionMs from browser (closest possible to when message was logged)
    let sessionMs;
    try {
      sessionMs = await page.evaluate(() => performance.now());
    } catch {
      sessionMs = -1; // Page may have closed
    }

    const entry = {
      sessionMs: Math.round(sessionMs),
      level: msg.type(), // 'log', 'error', 'warning', 'info', etc.
      text: msg.text(),
      location: msg.location(),
    };

    // Include stack trace for errors
    if (msg.type() === 'error') {
      entry.stackTrace = msg.text(); // Error text typically includes stack
    }

    appendFileSync(filePath, JSON.stringify(entry) + '\n');
  };

  page.on('console', handler);
}

export function stopConsoleCapture(page) {
  if (handler) {
    page.removeListener('console', handler);
    handler = null;
  }
}
```

### State Capture at Step Boundary
```javascript
// debug/lib/state-capture.mjs
import { appendFileSync } from 'node:fs';
import path from 'node:path';

export async function captureState(page, sessionDir, stepNum, actionName) {
  const snapshot = await page.evaluate(() =>
    window.__debugBridge.snapshot({ drainMutations: true })
  );

  const entry = {
    sessionMs: snapshot.sessionMs,
    step: stepNum,
    action: actionName,
    zoomLevel: snapshot.zoomLevel,
    renderedScale: snapshot.renderedScale,
    targetScale: snapshot.targetScale,
    freezeState: snapshot.freezeState,
    canvasContainerCount: snapshot.canvasContainerCount,
    pageStatus: snapshot.pageStatus,
    mutations: snapshot.mutations,
    signals: snapshot.signals,
  };

  const filePath = path.join(sessionDir, 'state.jsonl');
  appendFileSync(filePath, JSON.stringify(entry) + '\n');

  return entry;
}
```

### Playwright Config with Video Enabled
```javascript
// debug/playwright.config.mjs -- updated for Phase 7
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scenarios',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chromium',
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: {
      mode: 'on',
      size: { width: 1400, height: 900 },  // Match viewport for 1:1 pixel mapping
    },
    screenshot: 'off',  // We take manual screenshots at specific points
  },
  webServer: {
    command: 'npm run dev:ui',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'chromium' },
    },
  ],
});
```

### CLI Entry Point (package.json script)
```json
{
  "scripts": {
    "debug:scenario": "npx playwright test --config debug/playwright.config.mjs --grep"
  }
}
```
Usage: `npm run debug:scenario -- zoom-flicker`
With parameters: `ZOOM_MAX=300 START_PAGE=8 npm run debug:scenario -- zoom-flicker`

### Video SaveAs in afterEach
```javascript
// Pattern for copying Playwright's video into the session folder
test.afterEach(async ({ page }) => {
  if (page.video()) {
    const videoPath = path.join(sessionDir, 'recording.webm');
    await page.video().saveAs(videoPath);
    artifacts.push({ type: 'video', path: 'recording.webm', description: 'Full session recording' });
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `waitForTimeout(5000)` | `waitFor('ready')` readiness signals | Phase 6 (2026-03-12) | Deterministic timing, faster tests |
| Manual CDP screencast | Playwright `video: 'on'` | Playwright 1.12+ | Zero-config WebM recording |
| Custom browser launch | Playwright `webServer` config | Phase 5 (2026-03-12) | Auto-starts Vite dev server |
| Individual console.log | `debugMark()` + `performance.mark()` | Phase 6 (2026-03-12) | 0.01ms overhead, no timing interference |

**Deprecated/outdated:**
- `waitForTimeout()`: Still works but should never be used when readiness signals are available (per Phase 6 decisions)
- `video: 'retain-on-failure'`: Not suitable for this use case -- we always want the video for analysis

## Open Questions

1. **CDP Polling Frequency for Performance Metrics**
   - What we know: `Performance.getMetrics` returns cumulative counters (LayoutCount, etc.), not per-frame data. More frequent polling gives finer granularity but adds overhead.
   - What's unclear: Optimal polling interval. 500ms seems reasonable (2x per second), but may miss short layout storms.
   - Recommendation: Start with 500ms polling. Phase 8 anomaly detection can determine if finer granularity is needed. The interval should be configurable.

2. **Console Message Timestamp Accuracy**
   - What we know: `page.on('console')` fires asynchronously in Node.js. There's a non-deterministic delay between when the browser logs and when Node.js receives the event.
   - What's unclear: Typical jitter magnitude (likely 5-50ms based on IPC overhead).
   - Recommendation: Use `page.evaluate(() => performance.now())` as the timestamp source for each console message. Accept that this adds ~2ms per message. For Phase 7's purposes (capture everything, analyze in Phase 8), this is sufficient.

3. **Video Size and Session Folder Disk Usage**
   - What we know: WebM at 1400x900 for a 30-60 second scenario will be ~5-15MB. Screenshots are ~200-500KB each. JSONL files are tiny (<100KB).
   - What's unclear: Whether the user wants video size constraints or compression settings.
   - Recommendation: Use viewport-matched video size (1400x900) for 1:1 pixel mapping with screenshots. No compression changes needed -- Playwright's default WebM encoding is efficient.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | @playwright/test 1.58.2 |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker"` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAPT-01 | Screenshots at step boundaries with naming convention | integration | `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x` | No -- Wave 0 |
| CAPT-02 | Video recorded as WebM | integration | (verified by checking recording.webm exists in session folder after scenario run) | No -- Wave 0 |
| CAPT-03 | Console messages in console.jsonl | integration | (verified by checking console.jsonl has entries after scenario run) | No -- Wave 0 |
| CAPT-04 | State snapshots in state.jsonl | integration | (verified by checking state.jsonl entries match step count) | No -- Wave 0 |
| CAPT-05 | Pass/fail determination in manifest | integration | (verified by checking manifest.json result field) | No -- Wave 0 |
| CAPT-06 | Synchronized timeline via sessionMs | integration | (verified by checking all JSONL entries have valid sessionMs and screenshots have ms in filename) | No -- Wave 0 |
| CAPT-07 | CDP performance metrics in performance.jsonl | integration | (verified by checking performance.jsonl has both 'mark' and 'cdp' type entries) | No -- Wave 0 |
| CAPT-08 | Screenshots wait for readiness signal | integration | (verified by non-blank screenshot content after zoom actions) | No -- Wave 0 |
| FOUN-07 | Parameterizable scenarios | integration | `ZOOM_MAX=150 npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x` | No -- Wave 0 |
| FOUN-08 | CLI entry point | smoke | `npm run debug:scenario -- zoom-flicker` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test --config debug/playwright.config.mjs --grep "zoom-flicker" -x`
- **Per wave merge:** `npx playwright test --config debug/playwright.config.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `debug/scenarios/zoom-flicker.spec.mjs` -- the main scenario test file (covers CAPT-01 through CAPT-08, FOUN-07)
- [ ] `debug/lib/capture.mjs` -- capture coordinator module
- [ ] `debug/lib/console-capture.mjs` -- console capture module
- [ ] `debug/lib/state-capture.mjs` -- state capture module
- [ ] `debug/lib/perf-capture.mjs` -- performance capture module
- [ ] `debug/lib/screenshot.mjs` -- readiness-gated screenshot module
- [ ] `package.json` script `debug:scenario` -- CLI entry point (covers FOUN-08)
- [ ] `debug/playwright.config.mjs` update -- video enabled

## Sources

### Primary (HIGH confidence)
- Playwright official docs: [Videos](https://playwright.dev/docs/videos) -- video recording modes, size config, WebM format
- Playwright official docs: [Video class](https://playwright.dev/docs/api/class-video) -- path(), saveAs(), delete() methods
- Playwright official docs: [ConsoleMessage class](https://playwright.dev/docs/api/class-consolemessage) -- type(), text(), location(), args() methods
- Playwright official docs: [CDPSession class](https://playwright.dev/docs/api/class-cdpsession) -- newCDPSession(), send(), on() methods
- Playwright official docs: [Parameterize tests](https://playwright.dev/docs/test-parameterize) -- env vars, project-level, array-based approaches
- Playwright official docs: [CLI commands](https://playwright.dev/docs/test-cli) -- --grep, --project, --headed flags
- Chrome DevTools Protocol: [Performance domain](https://chromedevtools.github.io/devtools-protocol/tot/Performance/) -- enable, getMetrics, metrics event
- Existing codebase: `debug/lib/session.mjs` -- session creation pattern
- Existing codebase: `src/utils/debugBridge.js` -- snapshot(), waitFor(), debugMark() APIs
- Existing codebase: `debug/scenarios/*.spec.mjs` -- established test patterns

### Secondary (MEDIUM confidence)
- [Automated Performance Testing with Playwright and Chrome DevTools](https://medium.com/@aishahsofea/automated-performance-testing-with-playwright-and-chrome-devtools-a-deep-dive-52e8b240b00d) -- CDP Performance.getMetrics metric names list
- [The Power of Chrome Devtools Protocol Part IV](https://medium.com/globant/the-power-of-chrome-devtools-protocol-d4711a1db53d) -- CDP metric names (LayoutCount, RecalcStyleCount, LayoutDuration, etc.)

### Tertiary (LOW confidence)
- Console timestamp accuracy (5-50ms jitter estimate) -- based on general IPC overhead knowledge, not measured in this specific project

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and proven in Phases 5-6
- Architecture: HIGH -- builds directly on established patterns in existing codebase
- Capture APIs: HIGH -- verified against official Playwright and CDP documentation
- Pitfalls: MEDIUM -- based on official docs and common patterns, but some (console timing jitter) are estimates
- Parameterization: HIGH -- standard Playwright pattern with env vars

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable -- all libraries are at fixed versions)
