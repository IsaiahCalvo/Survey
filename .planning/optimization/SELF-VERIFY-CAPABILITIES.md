# Self-Verify Capabilities — Survey BetaSafeS2

_Research conducted 2026-06-05. Read-only audit of existing test and automation infrastructure._

---

## 1. Headless Backend Harness — `agent-cli/`

The `agent-cli/` directory is a Node.js CLI that drives the **real Supabase backend** without touching the Electron GUI. It is the agent's primary headless verification surface.

### Authentication / Credentials

Two modes. Both read from `.env` + `.env.local` via `agent-cli/lib/env.mjs` (gitignored; loaded at runtime):

| Mode | Key(s) required | RLS |
|------|----------------|-----|
| `--mode user` (default) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEV_AUTO_LOGIN_EMAIL`, `VITE_DEV_AUTO_LOGIN_PASSWORD` | Enforced — real cost |
| `--mode service` | `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Bypassed — floor only |

### Scripts in `agent-cli/`

#### `index.mjs` — Main multi-command CLI

```
node agent-cli/index.mjs docs [--limit N] [--mode user|service]
node agent-cli/index.mjs open <documentId> [--mode user|service]
node agent-cli/index.mjs survey-read <documentId> [--mode user|service]
node agent-cli/index.mjs open-render <documentId> [--mode] [--runs N]
node agent-cli/index.mjs open-render --path <storagePath>
node agent-cli/index.mjs watermark <documentId> [--mode user|service]
node agent-cli/index.mjs snapshot <documentId>
node agent-cli/index.mjs compact <documentId>
node agent-cli/index.mjs open-fast <documentId>
node agent-cli/index.mjs sweep [--write] [--force] [--limit N]
```

**What it proves:**
- `docs` — lists visible documents (sealed vs pre-cutover) as the dev user.
- `open` — reproduces the full annotation-hydrate keyset-pagination read and reports per-round-trip timing and total open time.
- `survey-read` — exact mirror of `getDocumentAnnotations()` with the same offset-pagination loop and the in-memory legacy-fabric row drop; reports post-drop ground-truth `rowCount`.
- `open-render` — downloads the real PDF binary from storage, parses with pdf.js and pdf-lib, and times each stage (download / getDocument / all-page getPage+getViewport / all-page getAnnotations / pdf-lib parse). Runs twice and reports warm.
- `watermark` — read-only probe that reports whether the marker fast-open SKIP would fire for a document (compares `documents.annotations_changed_at` vs `doc_yjs_state.meta.changedAt`).
- `compact` / `open-fast` / `sweep` — build and read gzip-JSON snapshots, prove the fast-path read, sweep all documents.

**What it does NOT prove:** anything that requires a rendered browser page — PDF visual correctness, annotation drawing, zoom, pan, scroll.

---

#### `profile-open.mjs` — Playwright longtask profiler

```
node agent-cli/profile-open.mjs ["Package 2 - Rev 4 -- IC.pdf"]
HEADFUL=1 node agent-cli/profile-open.mjs
```

**Requires:** `localhost:5173` already running (dev server). Spins up Chromium via Playwright, auto-logs in, opens the named document tile, measures main-thread longtasks (`PerformanceObserver`) and time-to-first-canvas. Does not take a screenshot by default.

---

#### `repro-sleep-wake.mjs` — Sleep/wake hang regression proof

```
node agent-cli/repro-sleep-wake.mjs ["Package 2 - Rev 4 -- IC.pdf"]
STUCK_MS=30000 HEADFUL=1 node agent-cli/repro-sleep-wake.mjs
```

**Requires:** `localhost:5173`. Playwright-driven. Opens the heavy doc, simulates network death (Playwright offline + intercepted storage routes), wakes the browser, watches whether the viewer recovers to a painted canvas or stays on "Loading…". Outputs a screenshot to `agent-cli/repro-sleep-wake-result.png`. Exits 0 (recovered) or 1 (stuck). This is an active regression test for `PDFViewer.jsx`'s watchdog fix.

---

#### `verify-authlock.mjs` — Auth-token lock profiler

```
node agent-cli/verify-authlock.mjs
```

**Requires:** `localhost:5173`. Playwright-driven. Records network timeline for `doc_yjs_state`, `document_presence`, and auth requests during document open; detects the 5-second orphaned-lock stall signature.

---

#### `verify-interaction-diag.mjs` — Tool-switch + draw + eraser smoke

```
node agent-cli/verify-interaction-diag.mjs
```

**Requires:** `localhost:5173`. Playwright-driven. Opens a doc, programmatically switches tools (pan/select), performs a mouse drag (pan), tries to switch to the eraser via `window.__bottomToolbarApi.setActiveTool('eraser')`, does a swipe. Captures `[InteractionDiag]` console markers. **Note:** does not assert annotation persistence — it only checks that the instrumentation fires.

---

#### `selftest-load-watchdog.mjs` — Pure state-machine test (no server needed)

```
node agent-cli/selftest-load-watchdog.mjs
```

**No dependencies.** Runs a virtual time model of `PDFViewer.jsx`'s `loadPDF` + watchdog effect contract. Proves the legacy world hangs forever on a dead socket while the fixed world recovers via the hang-timeout retry. Exits 0/1. **This is safe to run in any context.**

---

#### `selftest-log-fix.mjs` — Console-log fallback self-test

```
node agent-cli/selftest-log-fix.mjs
```

**Requires:** `localhost:5173`. Playwright-driven. Verifies the in-page buffer fallback branch in `main.jsx` survives a page reload and never produces "(no console output captured)" when the buffer is non-empty.

---

#### `survey-roundtrip.mjs` — Lossless snapshot roundtrip proof

```
node agent-cli/survey-roundtrip.mjs <documentId> [--mode user|service]
```

**Requires credentials.** Reads real survey marker rows from Supabase, runs them through the real `writeByPageSnapshot` / `readByPageSnapshot` (imported directly from `src/`) against an **in-memory stub** (never touches the real `doc_yjs_state`), then deep-equals the reconstructed `surveyMarkers` map against the source. Exits 0 on lossless, 1 on failure. **This is the gold standard persistence regression test for the survey marker snapshot path.**

---

#### `proof-snapshot-invariant.mjs` — DB data-integrity safety proof

```
node agent-cli/proof-snapshot-invariant.mjs [documentId]
```

**Requires credentials (user mode).** Read-only. Proves `meta.changedAt <= live marker` AND `durable newest updated_at <= live marker` hold for the live snapshot.

---

#### `proof-dataloss-stamp.mjs` — Watermark stamp data-loss scenario proof

```
node agent-cli/proof-dataloss-stamp.mjs [documentId]
```

**Requires credentials.** Read-only. Proves the pre-read-marker stamping strategy prevents the data-loss SKIP scenario.

---

#### `bench-fanout.mjs` — Yjs fan-out batch vs individual timing

```
node agent-cli/bench-fanout.mjs [count]
```

**No server needed.** Uses real `applyFabricCommit` from `src/`. Benchmarks individual-transaction vs batched-transaction fan-out and asserts identical Y.Map state.

---

#### `bench-hydrate.mjs` — Yjs hydration diagnostic timing

```
node agent-cli/bench-hydrate.mjs [count]
```

**No server needed.** Times `materialization forEach` vs now-gated diagnostic passes over a synthetic Y.Doc built with the real bridge.

---

### Other agent-cli scripts (diagnostics / one-offs)

| File | Purpose |
|------|---------|
| `diag-open.mjs` | Playwright diagnostic of document open |
| `diag-log-continuity.mjs` | Console-log buffer continuity diagnostic |
| `test-cdp-vs-console.mjs` / `test-cdp-vs-console2.mjs` | CDP vs page.on('console') capture comparison |
| `test-react-mount.mjs` | Verifies React mounts under Playwright |
| `test-logging-buffer.mjs` / `test-logging-install.mjs` | In-page buffer wiring tests |
| `test-patch-overwrite.mjs` | Data-overwrite edge case test |
| `test-main-running.mjs` | Check if the app is live |
| `test-execution-order.mjs` / `test-final-timing.mjs` / `test-timing.mjs` | Timing micro-tests |
| `test-vite-logger.mjs` / `test-vite-logger2.mjs` | Vite log forwarding tests |
| `test-script-order.mjs` | Script init order tests |
| `test-orphaned-logs.mjs` | Orphaned log line detection |

---

## 2. App Launch Modes

### Dev server (browser build)

```
npm run dev:ui          # launches Vite only on port auto-detected by find-port.js (typically 5173)
npm run dev:electron    # waits for localhost:5173, then launches Electron
npm run dev             # both: node find-port.js → Vite + Electron together
npm run dev:legacy      # concurrently with -k
```

**`find-port.js`** starts Vite, parses its stdout for `localhost:(\d+)`, sets `DEV_PORT` env var, then spawns Electron. Port is **typically 5173** but auto-increments if taken.

**The browser build** is a full-featured React SPA accessible at `http://localhost:5173/` in any browser while the dev server is running. It includes special dev-only query-string routes:

- `/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf` — opens a local test PDF (served from `debug/fixtures/` via Vite's `debugFixturesPlugin`) bypassing the dashboard authentication/selection flow.
- Auto-login when `VITE_DEV_AUTO_LOGIN_EMAIL` / `VITE_DEV_AUTO_LOGIN_PASSWORD` are set in `.env.local`.

**Crucially: the browser build at `localhost:5173` is a viable automation target.** Several agent-cli Playwright scripts already rely on it. The `?testPdf=` route eliminates the need to navigate the dashboard.

### Production Electron build

```
npm run dist            # vite build then electron-builder → macOS DMG
```

Entry point: `src/electron-main.js`. Main process attaches a continuous console log listener (`renderer-console.continuous.log` under `app.getAppPath()/Logs/`) that captures all renderer messages across page reloads.

### Playwright debug suite

```
npm run test:debug      # npx playwright test --config debug/playwright.config.mjs
npm run debug:scenario  # with --grep filter
```

Config: `debug/playwright.config.mjs`. Base URL `http://localhost:5173`. Reuses existing server. Timeout 120 s. Video on by default. 33 spec files in `debug/scenarios/`.

### Node unit test suite

```
npm test                # node scripts/run-node-tests.mjs
```

Runs all `*.test.mjs` files under `tests/` and `src/**/__tests__/` using Node.js `--test`. Approximately 80+ test files covering annotation logic, CRDT bridge, PDF export, history, collab, search, etc. These are pure-Node and do not require a running server.

---

## 3. Available Browser Automation Tools in This Claude Code Session

### `mcp__kapture__*` (Kapture MCP)

A browser-tab automation MCP with tools including: `list_tabs`, `navigate`, `screenshot`, `click`, `fill`, `hover`, `keypress`, `dom`, `elements`, `elementsFromPoint`, `console_logs`, `select`, `focus`, `blur`, `back`, `forward`, `reload`, `close`, `new_tab`, `show`, `tab_detail`.

**Realistic plan for this app:**
1. Confirm `localhost:5173` is running (agent cannot start it — user must have dev server up).
2. `mcp__kapture__navigate` to `http://localhost:5173/?testPdf=...` to open the test PDF directly.
3. `mcp__kapture__screenshot` to capture the viewer state.
4. `mcp__kapture__console_logs` to read the in-page `window.__consoleLogBuffer` output.
5. `mcp__kapture__click` on toolbar buttons (pen, eraser, zoom controls) by selector or coordinate.
6. `mcp__kapture__dom` / `mcp__kapture__elements` to query annotation overlay state (`[data-overlay-page]`, `[data-anno-id]`, `.canvas-container canvas`).

**Auth:** the `?testPdf=` URL bypasses the dashboard; auto-login via env vars handles Supabase auth. No Electron IPC needed.

**Limitation:** Kapture attaches to an existing browser tab — it cannot launch Electron. It operates on whatever tabs are open in the user's browser. The agent must confirm a `localhost:5173` tab is present before using these tools.

---

### `mcp__plugin_playwright_playwright__*` (Playwright MCP)

Playwright MCP tools: `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_type`, `browser_press_key`, `browser_take_screenshot`, `browser_snapshot`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_hover`, `browser_drag`, `browser_drop`, `browser_select_option`, `browser_wait_for`, `browser_handle_dialog`, `browser_file_upload`, `browser_resize`, `browser_tabs`, `browser_navigate_back`, `browser_run_code_unsafe`, `browser_network_request`, `browser_close`.

**Realistic plan:**
1. `browser_navigate` to `http://localhost:5173/?testPdf=...`.
2. `browser_wait_for` on `.e-pv-viewer-container` or a canvas element to confirm load.
3. `browser_take_screenshot` before and after a draw action for visual diff.
4. `browser_evaluate` to read `window.__debugBridge.snapshot()`, `window.pdfOverlayRecorder.dump()`, or DOM state.
5. `browser_console_messages` to watch for errors.
6. `browser_click` + mouse drag for annotation drawing (combining `browser_click` on canvas, though true mouse-path drawing may need `browser_run_code_unsafe` to dispatch PointerEvents).
7. `browser_network_requests` to watch Supabase save requests complete.

**Advantage over Kapture:** Playwright MCP can spawn its own browser context independent of whatever the user has open. It does not require a pre-existing tab.

**Auth requirement:** Same as above — `localhost:5173` must already be serving. Auto-login via `.env.local` credentials.

---

## 4. Behavior Checklist — Regression Coverage Status

| Behavior | Current Coverage | Verification Method |
|----------|-----------------|---------------------|
| **Document open speed** (annotation hydrate) | **COVERED** — `agent-cli/index.mjs open` measures wall-clock + per-round-trip timing against real DB | (a) Headless backend |
| **Document open speed** (PDF binary parse) | **COVERED** — `agent-cli/index.mjs open-render` times all 5 pipeline stages | (a) Headless backend |
| **Fast-open snapshot path** (skip-durable-read) | **COVERED** — `watermark`, `proof-snapshot-invariant`, `proof-dataloss-stamp` prove stamp invariants | (a) Headless backend |
| **Snapshot roundtrip losslessness** | **COVERED** — `survey-roundtrip.mjs` deep-equals source vs reconstructed map, exits 0/1 | (a) Headless backend |
| **Annotation load count** (ground truth) | **COVERED** — `survey-read` command reports post-drop `rowCount` | (a) Headless backend |
| **Sleep/wake loading hang recovery** | **COVERED** — `selftest-load-watchdog.mjs` (pure) + `repro-sleep-wake.mjs` (browser) | (a/b) both |
| **PDF renders at correct pages / non-blank canvas** | **COVERED** — `debug/scenarios/smoke.spec.mjs` checks non-blank canvas pixels on page 6 | (b) Browser automation |
| **Annotation draw + canvas content visible** | **PARTIALLY COVERED** — smoke test checks canvas pixels but does not draw a new annotation | (b) Browser automation |
| **Annotation draw → Supabase save → reload survival** | **NOT COVERED** — no end-to-end draw+save+reload test exists | (b) Needs browser automation + network watch |
| **Eraser stroke removes annotation pixels** | **NOT COVERED** — `verify-interaction-diag.mjs` fires the eraser but does not assert pixel change or DB deletion | (b) Browser automation or (c) human |
| **Annotation persistence after page navigation** | **NOT COVERED** | (b) Needs browser automation |
| **Zoom feel — overlay CSS transform fires and clears** | **COVERED** — `debug/scenarios/zoom-handler.spec.mjs` checks `[data-overlay-page]` transforms during and after zoom settle | (b) Browser automation |
| **Zoom feel — no runaway wheel acceleration** | **COVERED** — `tests/performance/overlayPresentationGate.test.mjs` asserts `SYNCFUSION_WHEEL_ZOOM_EXPONENT <= 0.004` and `MAX_STEP < 25%` via source-text regex | (a) Pure Node (source-text gate) |
| **Scroll feel — no blank pages, jank rate, worst frame** | **COVERED** — `debug/scenarios/scroll-feel-probe.spec.mjs` measures wheel→scroll→RAF pipeline with quantitative criteria | (b) Browser automation |
| **Pan — drag moves scroll position** | **PARTIALLY** — `verify-interaction-diag.mjs` fires a mouse drag but only checks `[InteractionDiag]` console output, not scroll position delta | (b) Needs assertion |
| **Multi-user presence — cursors visible** | **NOT COVERED** (e2e) — `tests/phase29-e2e/two-clients-*.spec.mjs` require `.bot-credentials.json` and `window.__navigateToPage` seam; most skip at runtime | (b/c) Needs bot credentials + seam |
| **Multi-user collab — remote annotation appears** | **UNIT COVERED** — `tests/phase29/` unit tests lock the CRDT bridge contract; e2e shell exists but runtime-skips | (a) Unit only; (b) Needs bot creds |
| **Search — text panel finds matches** | **NOT COVERED** | (b/c) Needs browser automation |
| **Auth-token lock stall (5s delay)** | **PARTIALLY COVERED** — `verify-authlock.mjs` measures request timeline but does not pass/fail automatically | (b) Browser automation (manual analysis) |
| **Console-log fallback correctness** | **COVERED** — `selftest-log-fix.mjs` asserts fallback branch never produces empty string | (b) Browser automation |
| **Annotation overlay positioning at correct scale** | **COVERED** — `debug/scenarios/overlay-attachment.spec.mjs` checks `position:absolute, width:100%, height:100%, z-index:20` | (b) Browser automation |
| **Overlay presentation gap (annotations before PDF page)** | **COVERED** — `overlayPresentationGate.test.mjs` source-text gate + `scroll-feel-probe` runtime measurement | (a/b) Both |
| **Yjs fan-out performance regression** | **COVERED** — `bench-fanout.mjs` asserts identical Y.Map state across batched vs individual paths | (a) Pure Node |

---

## 5. Coverage Gaps — Prioritized

### Gap 1 (Critical): Draw → Save → Reload survival (no test)

There is no automated test that:
1. Draws a new annotation stroke on a canvas
2. Waits for the Supabase `upsert` to complete (can watch `network_requests` for POST to `document_annotations`)
3. Reloads the page
4. Asserts the annotation is still present (non-blank canvas pixels at the same location, or `[data-anno-id]` count unchanged)

This is the most important regression for the canvas/annotation files.

### Gap 2 (Critical): Eraser effect (no assertion)

`verify-interaction-diag.mjs` fires the eraser but only reads console markers. There is no assertion that:
- A specific pixel region changed to blank after an eraser swipe
- The erased annotation was deleted from Supabase

### Gap 3 (High): Pan scroll delta assertion

The pan-drag test fires mouse events but does not assert that `scrollTop` / `scrollLeft` changed by a meaningful amount.

### Gap 4 (High): Search text panel

No test covers the `SearchTextPanel` at all.

### Gap 5 (Medium): Multi-user collab e2e

The two-client e2e specs runtime-skip because `.bot-credentials.json` is not provisioned and `window.__navigateToPage` seam is not yet exposed. The unit tests at `tests/phase29/` lock the bridge contract, but live sync between two browsers is never verified automatically.

### Gap 6 (Low): `verify-authlock.mjs` has no pass/fail exit code

The auth-lock timeline is printed but the script does not exit 1 when it detects contention.

---

## 6. Recommended Next Steps (Smallest Concrete Additions)

### Step 1 — `debug/scenarios/annotation-draw-save-reload.spec.mjs` (Playwright, ~100 lines)

Use the `?testPdf=` route. Draw one pen stroke via mouse events on the canvas. Wait for a POST to `rest/v1/document_annotations` to complete (`page.waitForResponse`). Reload. Assert the canvas still has non-blank pixels in the same region (screenshot diff against a saved baseline using Playwright's `toHaveScreenshot()`) OR assert `[data-anno-id]` count > 0 in the SVG layer.

**Drives:** Playwright MCP or `npm run test:debug --grep annotation-draw`.

**Proves:** draw path, Supabase save, page reload, hydration correctness, and canvas sizing invariant all at once.

### Step 2 — `debug/scenarios/eraser-removes-stroke.spec.mjs` (Playwright, ~80 lines)

After step 1, add a companion spec: draw a stroke, screenshot, switch to eraser, swipe over it, screenshot again, assert pixel diff > threshold. Optionally watch the DELETE request to Supabase.

### Step 3 — Extend `selftest-load-watchdog.mjs` pattern into a save-failure watchdog test

Pure-Node, no server. Model the `annotationCloudSync` retry/recovery state machine the same way `selftest-load-watchdog.mjs` models the PDF load watchdog. Test that a transient Supabase 5xx causes a retry and the annotation is not lost.

### Step 4 — Add pass/fail exit code to `verify-authlock.mjs`

Replace the `console.log` analysis with `process.exit(contention ? 1 : 0)`. Then it can be run in CI as a regression gate.

### Step 5 — Provision `.bot-credentials.json` and expose `window.__navigateToPage`

Both are pre-identified prerequisites in the existing e2e shell at `tests/phase29-e2e/`. Once in place the two-client collaboration specs automatically upgrade from skip to live.

---

## Summary: What the Agent Can Do Today

| Capability | Can run now? |
|-----------|-------------|
| Measure real DB annotation load time | Yes — `node agent-cli/index.mjs open <id>` |
| Measure real PDF binary parse time | Yes — `node agent-cli/index.mjs open-render <id>` |
| Prove snapshot losslessness | Yes — `node agent-cli/survey-roundtrip.mjs <id>` |
| Prove snapshot data-safety invariants | Yes — `proof-snapshot-invariant.mjs`, `proof-dataloss-stamp.mjs` |
| Run all unit tests (no server) | Yes — `npm test` |
| Run zoom/scroll/overlay Playwright specs | Yes — `npm run test:debug` (needs `localhost:5173` running) |
| Drive browser via Playwright MCP or Kapture | Yes — navigate to `http://localhost:5173/?testPdf=...`, screenshot, evaluate, click |
| Prove draw → save → reload cycle | **No — needs new spec (see Step 1)** |
| Prove eraser removes stroke | **No — needs new spec (see Step 2)** |
| Verify multi-user collab live | **No — needs bot credentials (see Step 5)** |
