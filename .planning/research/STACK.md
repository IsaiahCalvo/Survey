# Technology Stack: Automated Debug & Testing Pipeline

**Project:** BetaSafe Survey Tool -- v2.0 Debug Annotations
**Researched:** 2026-03-12
**Mode:** Brownfield enhancement -- adding automated debugging infrastructure to existing Electron/React PDF annotation app

## Executive Summary

The automated debugging pipeline requires additions in five categories: (1) browser automation, (2) artifact capture, (3) post-processing, and (4) LLM-friendly output formatting. The existing app stack (Syncfusion PDF Viewer, Fabric.js, React 18, Vite, Electron) is untouched -- all new dependencies are dev-only.

Playwright is the clear choice for browser automation, providing built-in video recording (WebM), tracing (DOM snapshots + network + actions), screenshots, and CDP access for low-level performance metrics -- all from a single dependency. Post-processing uses sharp (already installed as a devDependency), pixelmatch for screenshot diff/anomaly detection, and ffmpeg-static for keyframe extraction from video. No database -- NDJSON (newline-delimited JSON) files in folder-per-run for all structured data, directly readable by LLMs and `grep` alike.

Total new devDependencies: 5 packages. No production dependencies added.

## Recommended Stack

### Browser Automation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@playwright/test` | ^1.58.0 | Test runner + browser automation + built-in assertions | Single dependency provides Chromium automation, video recording, tracing, screenshot capture, CDP sessions, and a test runner with retries and parallelism. The project targets Chromium via Vite dev server -- Playwright's primary use case. Version 1.58.2 is current as of March 2026. |
| Playwright Chromium (bundled) | Auto-managed | Browser binary for automation | Playwright downloads and manages its own Chromium builds. As of 1.57+, uses "Chrome for Testing" builds matching real Chrome behavior. No separate browser install needed. |

**Confidence: HIGH** -- Playwright is the standard for this exact use case (automating web apps in Chromium). Verified via official docs and npm registry.

**Why not Cypress:** Cypress runs inside the browser, cannot open CDP sessions for performance metrics, has no built-in video of the quality needed, and does not support programmatic tracing. Playwright runs outside the browser with full control.

**Why not Puppeteer:** Puppeteer provides raw CDP access but no test runner, no built-in assertions, no parallel test execution, and no trace viewer. Playwright is the evolution of Puppeteer by the same team, with all those features added.

### Artifact Capture (Built Into Playwright)

These are not separate dependencies -- they are Playwright APIs configured per browser context.

| Capability | Playwright API | Format | Notes |
|------------|---------------|--------|-------|
| Video recording | `browser.newContext({ recordVideo: { dir, size } })` | WebM | Records full session. Default 800x800 max, configurable to viewport size. Available after context closes. |
| Screenshots | `page.screenshot({ path, fullPage })` | PNG | On-demand at any point during test. Full-page or clipped region. |
| Tracing | `context.tracing.start({ screenshots, snapshots, sources })` | ZIP (contains JSON + PNGs) | Captures DOM snapshots, network activity, action timeline. Viewable in Trace Viewer or parseable as ZIP. |
| Console logs | `page.on('console', msg => ...)` | Captured in-memory, write to NDJSON | All console.log/warn/error/debug messages with timestamps. Types: log, debug, info, error, warning, dir, trace, etc. |
| Page errors | `page.on('pageerror', error => ...)` | Captured in-memory, write to NDJSON | Uncaught exceptions and unhandled promise rejections. |
| Network | `context.tracing` or `page.on('request'/'response')` | Included in trace ZIP, or captured manually | HAR recording also available via `context.routeFromHAR()`. |
| Performance metrics | CDP session: `Performance.getMetrics` | JSON | LayoutDuration, RecalcStyleDuration, ScriptDuration, TaskDuration, JSHeapUsedSize, Nodes, LayoutCount. Requires `page.context().newCDPSession(page)`. |
| Custom app events | `page.evaluate()` to read `window.pdfPerf`, `window.__pdfHistoryDebug` | JSON | Bridge existing debug APIs into the capture pipeline. Poll or subscribe via `page.exposeFunction()`. |

**Confidence: HIGH** -- All verified via official Playwright documentation (playwright.dev/docs/api/).

### Image Processing & Anomaly Detection

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `sharp` | ^0.34.5 | Image manipulation, resizing, format conversion | **Already installed** as a devDependency. High-performance libvips-based. Use for resizing screenshots to consistent dimensions before comparison, extracting regions of interest, and generating thumbnails for timeline views. |
| `pixelmatch` | ^7.1.0 | Pixel-level screenshot comparison / anomaly detection | 150 lines, zero dependencies, works on raw RGBA typed arrays. ~15M monthly downloads. Detects anti-aliased pixel differences. Use to compare consecutive screenshots and flag frames where annotation positions shifted (the "flicker" signal). Returns mismatch count + diff image. |
| `pngjs` | ^7.0.0 | PNG decode/encode for pixelmatch input | pixelmatch requires raw RGBA buffers. pngjs decodes PNGs to `{ data, width, height }` format that pixelmatch consumes. Zero dependencies, synchronous API via `PNG.sync.read()`. |

**Confidence: HIGH** -- pixelmatch is the de facto standard for screenshot comparison in Node.js (used by Playwright internally for visual comparison). sharp is already in the project.

**Why not `looks-same`:** Heavier dependency, designed for visual regression testing with "tolerance" thresholds. We need precise pixel diffs to detect subtle annotation position shifts (1-2px flicker), not fuzzy "close enough" matching.

**Why not `odiff`:** Rust-based, faster than pixelmatch for large images, but adds a native binary dependency. The screenshots are viewport-sized (~1280x800), not megapixel images. pixelmatch handles this in <10ms.

### Video Post-Processing (Keyframe Extraction)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ffmpeg-static` | ^5.3.0 | Static FFmpeg binary (no system install required) | Bundles FFmpeg 6.1.1 for macOS/Linux/Windows. Dev-only. No system PATH dependency. Works on any machine without FFmpeg installed. |
| `fluent-ffmpeg` | ^2.1.3 | Node.js API for FFmpeg commands | Fluent API for constructing FFmpeg pipelines. Use for: extracting keyframes (I-frames) from WebM recordings, extracting frames at specific timestamps (aligned to anomaly events), generating thumbnails at regular intervals for timeline strip. |

**Confidence: MEDIUM** -- ffmpeg-static and fluent-ffmpeg are mature and widely used. The MEDIUM rating is because Playwright's WebM format and ffmpeg's keyframe extraction from WebM specifically has not been verified end-to-end. WebM uses VP8/VP9 codec which ffmpeg fully supports, so this should work, but needs integration testing.

**Why not `extract-keyframes` npm package:** Last updated 2019, depends on an older fluent-ffmpeg version, writes to /tmp by default. Better to use fluent-ffmpeg directly with a few lines of code.

**Why not skip video processing entirely:** The post-zoom flicker is a 50-200ms visual artifact. Video at 30fps gives ~2-6 frames of evidence. Extracting those frames as PNGs and running pixelmatch on consecutive pairs is the most reliable way to detect and document the flicker automatically.

### Session Storage & Structured Data

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| NDJSON (built-in) | N/A (JSON.stringify per line) | Structured event logs, timeline data, analysis output | No library needed -- `fs.appendFileSync(path, JSON.stringify(event) + '\n')`. Each line is a self-contained JSON object. Streamable, greppable, appendable, LLM-parseable. One event per line means partial file reads work (unlike JSON arrays). |
| Node.js `fs` (built-in) | N/A | File I/O for session bundles | mkdir, writeFile, copyFile, readdir. No external dependency needed for folder-per-run storage. |
| Node.js `path` (built-in) | N/A | Cross-platform path construction | Session bundle paths: `debug-sessions/{timestamp}-{scenario-name}/` |
| `adm-zip` or Node.js `zlib` | Built-in | Extract Playwright trace ZIP for analysis | Playwright traces are ZIP files containing JSON action logs and PNG screenshots. Use Node.js built-in zlib + tar-stream, or the lightweight adm-zip if needed. Prefer built-in to avoid another dependency. |

**Confidence: HIGH** -- NDJSON is a well-established pattern for structured logging. No external dependency needed. The folder-per-run approach is explicitly specified in PROJECT.md as the design decision.

### LLM-Friendly Output

No additional libraries needed. The pipeline produces artifacts in formats that LLMs consume natively:

| Artifact | Format | LLM Consumption Strategy |
|----------|--------|--------------------------|
| Event timeline | NDJSON | Each line is a JSON event with timestamp, type, data. LLM reads N lines at a time. |
| Console logs | NDJSON | Filtered by severity (error/warn) for focused analysis. Full log available for deep dives. |
| Performance metrics | JSON snapshots | Taken at key moments (before zoom, during zoom, after zoom). Small, self-contained. |
| Screenshot diffs | PNG + JSON summary | Diff image for visual inspection. JSON summary has mismatch percentage, bounding box of changed region, timestamp. |
| Anomaly report | JSON | Post-processing output: detected anomalies with timestamps, severity, evidence file references. |
| Session manifest | JSON | Index file listing all artifacts in the session bundle with metadata. LLM reads this first to understand what is available. |
| Keyframes | PNG files + NDJSON index | Extracted frames with timestamps. Index file maps frame number to timestamp and event context. |

**Confidence: HIGH** -- JSON and NDJSON are the formats LLMs handle best. No novel format needed.

## Complete New Dependency List

### devDependencies Only (zero production impact)

```bash
# Browser automation (includes Chromium download)
npm install -D @playwright/test

# Screenshot comparison
npm install -D pixelmatch pngjs

# Video post-processing
npm install -D ffmpeg-static fluent-ffmpeg
```

### Already Installed (no action needed)

| Package | Version | Used For |
|---------|---------|----------|
| `sharp` | ^0.34.5 | Image resize/crop for region extraction, thumbnail generation |
| `vite` | ^5.2.0 | Dev server (automation target) |

### One-Time Setup

```bash
# After npm install, download Playwright's Chromium
npx playwright install chromium
```

## Integration Points With Existing Stack

### Vite Dev Server (Target)

Playwright launches Chromium and navigates to `http://localhost:5173`. The dev server must be running. Use Playwright's `webServer` config to auto-start it:

```javascript
// playwright.config.js
export default {
  webServer: {
    command: 'npm run dev:ui',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
};
```

### Existing Debug APIs (Bridge)

The app already exposes `window.pdfPerf`, `window.__pdfHistoryDebug`, and `pdfDebug.js` counters. Playwright captures these via:

```javascript
// Read debug state at any point
const perfData = await page.evaluate(() => window.pdfPerf?.getMetrics());
const historyState = await page.evaluate(() => window.__pdfHistoryDebug?.getState());
```

### Syncfusion PDF Viewer (Automation Target)

Playwright automates the viewer via DOM selectors (Syncfusion renders standard HTML elements with `e-pv-*` class prefixes). Zoom is triggered via:
- Keyboard shortcuts (Ctrl+Plus/Minus)
- Mouse wheel with Ctrl
- Toolbar button clicks
- Programmatic: `page.evaluate(() => viewer.magnificationModule.zoomTo(200))`

### Fabric.js Canvas (Observation Target)

Annotation flicker is detected by screenshot comparison, not by reading Fabric.js internals. However, canvas state can be queried:

```javascript
const canvasState = await page.evaluate(() => {
  const canvas = window.__fabricCanvases?.[pageNumber];
  return canvas?.getObjects().map(o => ({ type: o.type, left: o.left, top: o.top, scaleX: o.scaleX }));
});
```

### Dev-Only Test Route (New)

A new route (e.g., `/dev-test?pdf=package2&page=6`) bypasses Supabase auth and loads a specific PDF directly. This route is:
- Stripped from production builds via Vite's `import.meta.env.DEV` guards
- Required for deterministic automation (no login flow, no file picker)

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Browser automation | Playwright | Cypress | No CDP access, runs in-browser (can't capture external metrics), limited video control, no trace viewer |
| Browser automation | Playwright | Puppeteer | No test runner, no assertions, no parallel execution, no trace viewer. Same team made Playwright as the successor. |
| Screenshot diff | pixelmatch | looks-same | Too fuzzy for 1-2px annotation position detection. We need exact pixel diffs, not "visually similar." |
| Screenshot diff | pixelmatch | Playwright built-in `toHaveScreenshot()` | Designed for visual regression (pass/fail). We need diff images, mismatch counts, and bounding boxes -- not just assertions. |
| Video processing | ffmpeg-static + fluent-ffmpeg | No video processing | Post-zoom flicker is 50-200ms. Without frame extraction, evidence is locked inside WebM files that LLMs cannot analyze. |
| Video processing | ffmpeg-static | System ffmpeg | System dependency makes setup fragile. ffmpeg-static bundles the binary as an npm package -- works on any machine. |
| Structured data | NDJSON (no library) | SQLite | PROJECT.md explicitly rules out database storage. NDJSON is greppable, appendable, and LLM-readable. |
| Structured data | NDJSON (no library) | ndjson npm package | The npm package adds streaming parse/serialize. We only need `JSON.stringify(obj) + '\n'` -- one line of code. No dependency justified. |
| Trace parsing | Node.js built-in zlib | adm-zip | Playwright traces are standard ZIP files. Node.js built-in `zlib` handles this. Only add adm-zip if the ZIP structure proves complex. |
| LLM output format | JSON/NDJSON | TOON (tabular) | TOON is newer (late 2025) and shows 4% accuracy improvement over JSON in benchmarks, but JSON has universal tooling support and LLMs handle it natively. Not worth the novelty risk for a debugging pipeline. |

## What NOT to Use

### Do NOT use Playwright MCP Server for this

The Playwright MCP server (playwright-mcp) is designed for LLM agents to interactively browse the web. This project needs deterministic scripts, not agent improvisation. PROJECT.md explicitly states: "Deterministic scripts, not AI agent improvisation. LLM analyzes evidence, doesn't generate it."

### Do NOT use Playwright's `toHaveScreenshot()` for anomaly detection

`toHaveScreenshot()` is a pass/fail assertion for visual regression testing. It tells you "different" or "same" but does not produce the diff image, mismatch percentage, or bounding box data needed for LLM analysis. Use pixelmatch directly for rich diff output.

### Do NOT use `playwright-core` instead of `@playwright/test`

`playwright-core` is the library-only package without a test runner. `@playwright/test` includes the test runner, assertions, fixtures, retries, parallelism, and HTML reporter -- all needed for structured scenario execution. The test runner overhead is negligible and the features are essential.

### Do NOT add a real-time monitoring dashboard

PROJECT.md: "files and folders are sufficient." Folder-per-run with NDJSON files. A dashboard adds complexity without value at this stage.

### Do NOT use Canvas screenshot via `canvas.toDataURL()`

While Fabric.js exposes `canvas.toDataURL()`, this only captures the canvas element -- not the full page context (Syncfusion chrome, scroll position, overlapping elements). Playwright's `page.screenshot()` captures exactly what the user sees, which is what matters for flicker detection.

## Performance Considerations

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Playwright launch + navigate | 2-4s | First test. Subsequent tests reuse browser if configured. |
| Screenshot capture | 50-100ms | Full viewport PNG. |
| pixelmatch comparison (1280x800) | 5-10ms | Pure JS, operates on raw RGBA buffers. Negligible. |
| Video frame extraction (single frame) | 200-500ms | ffmpeg seek + decode. Batch extraction is faster per-frame. |
| CDP Performance.getMetrics | <5ms | Single CDP round-trip. |
| Console log capture | 0ms (event-driven) | Asynchronous listener, no polling cost. |
| Session bundle write | 50-200ms | Depends on artifact count. Mostly I/O bound. |
| Trace ZIP save | 100-500ms | Depends on trace length. Includes compression. |

## Folder Structure

```
debug-sessions/
  2026-03-12T14-30-00-zoom-flicker/
    manifest.json              # Session index: scenario, timestamps, artifact list
    events.ndjson              # All captured events (console, performance, custom)
    console.ndjson             # Browser console output
    performance.ndjson         # CDP metrics snapshots
    screenshots/
      001-baseline.png         # Before action
      002-zoom-start.png       # During zoom
      003-zoom-end.png         # After zoom settles
      ...
    diffs/
      002-vs-003-diff.png      # pixelmatch output
      diff-summary.ndjson      # Mismatch percentages per pair
    video/
      session.webm             # Full session recording
    keyframes/
      frame-0042.png           # Extracted at anomaly timestamp
      frame-0043.png
      keyframes.ndjson          # Frame index with timestamps
    trace/
      trace.zip                # Playwright trace (viewable in trace.playwright.dev)
    analysis/
      anomalies.json           # Detected anomalies with evidence references
      timeline-summary.json    # Human/LLM-readable session summary
```

## Sources

- [Playwright Official Documentation -- Tracing API](https://playwright.dev/docs/api/class-tracing) -- HIGH confidence
- [Playwright Official Documentation -- Videos](https://playwright.dev/docs/videos) -- HIGH confidence
- [Playwright Official Documentation -- CDPSession](https://playwright.dev/docs/api/class-cdpsession) -- HIGH confidence
- [Playwright Official Documentation -- ConsoleMessage](https://playwright.dev/docs/api/class-consolemessage) -- HIGH confidence
- [Playwright Release Notes](https://playwright.dev/docs/release-notes) -- HIGH confidence
- [@playwright/test on npm (v1.58.2)](https://www.npmjs.com/package/@playwright/test) -- HIGH confidence
- [pixelmatch on GitHub (mapbox/pixelmatch)](https://github.com/mapbox/pixelmatch) -- HIGH confidence
- [pixelmatch on npm (v7.1.0)](https://www.npmjs.com/package/pixelmatch) -- HIGH confidence
- [sharp Official Documentation](https://sharp.pixelplumbing.com/) -- HIGH confidence
- [ffmpeg-static on npm (v5.3.0)](https://www.npmjs.com/package/ffmpeg-static) -- HIGH confidence
- [fluent-ffmpeg on GitHub](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) -- HIGH confidence
- [pngjs on GitHub](https://github.com/pngjs/pngjs) -- HIGH confidence
- [Playwright CDP Performance Testing (Medium)](https://medium.com/@aishahsofea/automated-performance-testing-with-playwright-and-chrome-devtools-a-deep-dive-52e8b240b00d) -- MEDIUM confidence
- [BrowserStack: Playwright Performance Testing](https://www.browserstack.com/guide/playwright-performance-testing) -- MEDIUM confidence
- [Checkly: Playwright Performance Best Practices](https://www.checklyhq.com/docs/learn/playwright/performance/) -- MEDIUM confidence
