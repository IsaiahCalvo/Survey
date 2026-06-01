> Multi-agent investigation (16 agents: 6 researchers → draft → 8 adversarial verifiers → finalize), 2026-05-31.
> Source log: `Downloads/PDF render comparison 2026-05-31 21-26-47.log`. EmbedPDF packages: v2.14.3, pdfium binary sha256 `745cae55…`.
> Verifier tally: 4 confirmed / 4 partial / 0 refuted. Corrections from the partials are folded into the body below.

# EmbedPDF vs pdf.js: Why pdf.js Won the Bake-Off (and Why the Result Is Not Yet Trustworthy)

## 1. Bottom line up front

**The current bake-off is unfair, and you should not act on its result yet.** In the log, pdf.js beat EmbedPDF on smoothness by ~8.7x on worst frame (41.4ms vs 358.8ms). But EmbedPDF was deliberately hobbled to run PDFium **on the main thread** (`worker: false`, `EmbedpdfArm.jsx:126`) while pdf.js ran its parsing in a Web Worker. So the headline gap measures a config flag, not the two libraries.

The hobble's **cited reason is provably false in the part that static analysis can reach.** The in-code comment gave two reasons:
1. The worker "wants cross-origin-isolation headers — COOP same-origin + COEP require-corp — which we deliberately don't set, for MSAL."
2. "The off-thread worker engine **hangs on open-document in our Vite dev server.**"

Reason 1 is **wrong**: EmbedPDF's `pdfium.wasm` is single-threaded with zero SharedArrayBuffer / pthread / Atomics, so the worker cannot need cross-origin isolation for the SharedArrayBuffer reason. Reason 2 — the empirical hang — is **untested by this review and remains plausible** from non-header causes (module/blob worker + WASM fetch under Vite dev, MIME/range-request quirks; note the existing `mode: 'full-fetch'` workaround that exists precisely because the dev server mishandles Range requests).

**So: the fix is cheap, but not "free."** Flipping `worker: true` removes a false constraint, but it must be *run and confirmed to open the document* before any re-match — because the one claim we could not refute is the one that would block it. Recommendation: apply the fix, verify it actually loads, instrument raster on both arms, then run a fair re-match. Keep the pdf.js arm as the untouched control.

---

## 2. Forensic answer — why pdf.js beat EmbedPDF, ranked

### Root cause 1 — Main-thread raster (`worker: false`). DECISIVE. (high)
`EmbedpdfArm.jsx:126` calls `usePdfiumEngine({ ...wasmUrl, worker: false })`. The engines hook defaults `worker = true` (`engines/dist/react/index.js:8`, verified byte-exact). With `worker: false` the hook imports `pdfium-direct-engine` (zero `new Worker`), so all PDFium decode/raster runs on the main thread and blocks rAF. pdf.js runs its **parsing** off-thread. Worst frame 358.8ms (14fps) vs 41.4ms (33fps).

**Why this is the driver and not raster size:** pdf.js sustained its *largest* rasters at its 1192% peak zoom with worst frames of only ~9.3ms, while EmbedPDF stalled 358.8ms at a *small* 43%-zoom raster. Large raster correlated with smooth frames; the stall tracks main-thread placement, not pixel count.

> **Verifier correction:** the "310% vs 1192%" framing conflates each arm's **session-peak** zoom with the zoom **at the worst frame**. Both worst frames actually occurred at **low** zoom — EmbedPDF's 358.8ms at **43%**, pdf.js's 41.4ms at **57%**. The thread-placement conclusion survives and is in fact *stronger* (pdf.js stayed smooth even at its 1192% peak).

### Root cause 2 — The `worker: false` justification is false in its cited mechanism. (high, one untested caveat)
- EmbedPDF's `pdfium.wasm` (sha256 `745cae55…`; **not** the Syncfusion binary `50a628f3…`) is **single-threaded**: the WASM memory is internally defined with the **shared bit unset** (flags `0x01`, not `0x03`), and all 37 imports are single-threaded env/wasi primitives. Zero SharedArrayBuffer / pthread / Atomics / futex.
- The worker engine is an inline-Blob `{ type: "module" }` Worker communicating by `postMessage`. Zero SharedArrayBuffer, zero `crossOriginIsolated`.
- **Therefore the COOP/COEP-for-SharedArrayBuffer rationale cannot apply.**

> **Verifier corrections:** (a) The core render path returns results (including rendered bitmaps) via `postMessage` with **no transfer list** — structured-clone copy; the only transferred ArrayBuffer is in the *separate* image-encoder pool, not the render path. (b) Precise framing: the comment's **cited SAB/COOP-COEP reason is wrong**, but its other claim — that the worker **hangs on open-document in the Vite dev server** — is a runtime symptom static analysis cannot refute. The mechanism is debunked; the operational "it just works" conclusion is **not yet proven.**

### Root cause 3 — No raster decoupling on the commit frame. (high)
On each 150ms zoom-settle commit, `setScale` fans out to two unthrottled consequences on the (blocked) main thread:
- **Full-page base re-raster:** `RenderLayer` effect (`plugin-render/dist/react/index.js:33-58`) calls `renderPage({ options: { scaleFactor: actualScale } })` with `actualScale` in its deps — whole page, no `renderPageRect`, no debounce.
- **Unthrottled tile recompute:** `plugin-tiling/dist/index.js:215-217` — `onScaleChanged → recalculateTilesForDocument` synchronously. (The 50ms throttle wraps **only** the scroll subscription, not the scale path.)

Mid-gesture is smooth in both arms (CSS transform), so the entire penalty lands on the single gesture-end commit frame.

### Root cause 4 — Mounted-page growth, but confounded by zoom. (medium — downgraded)
`defaultBufferSize: 2` gives a two-sided overscan; mounted pages climbed 3→4→5→7→8 (peak 8) vs pdf.js peaking at 5.

> **Verifier corrections:** (a) "**Never release**" is FALSE — after peaking at 8, EmbedPDF released 8→7→6 and held at 6 for the final ~3.5s. (b) The climb is driven mainly by **zooming OUT to 27%** (more pages fit the viewport), not by `bufferSize` alone. (c) pdf.js is **not "capped at 5" by design** — it uses a `vh*1.2` overscan and hit 5 only because it was never zoomed below 57%; EmbedPDF was taken to 27% (>2x further out) on the same file. The 5-vs-8 gap is largely a zoom-range artifact. (Aside: `bufferSize: 2` is actually *below* the library's own default of 4.)

### Root cause 5 — Tab-switch engine cold-start. (medium)
Switching arms re-instantiates the whole PDFium engine + plugin graph: first spike 133.7ms ~0.7s after switching to EmbedPDF. A one-time mount cost, not steady-state jank.

### Root cause 6 — EmbedPDF raster duration was never measured. (high)
`MetricsBridge` emits only `{zoomPct, currentPage, totalPages, mounted}` — no `performance.now`, no `rasterMs`. The raster cell in the UI renders only in the pdf.js branch. So the log shows `raster=—ms` / avg 0ms for EmbedPDF. EmbedPDF *does* raster; the **duration is just uninstrumented**, surfacing only indirectly as worst-frame spikes. The head-to-head was judged on fps/worst-frame alone — the deciding per-page number was never captured for one side.

### The two-axis summary
- **WHERE the raster runs.** pdf.js parses off-thread; EmbedPDF rasters on-thread (`worker: false`). Structural driver.
  > **Verifier correction:** pdf.js raster does **NOT** run in the worker — in v3.11.174 only parsing/operator-list generation is off-thread; rasterization runs on the **main thread** (`CanvasGraphics` 11x in the main bundle, 0x in the worker bundle; the arm paints into a main-thread canvas). pdf.js's advantage is that its *parsing* is off-thread; **both** libraries raster on the main thread.
- **WHEN it runs.** Both use render-on-settle ~150ms after the last wheel tick with a CSS transform during the gesture — **confirmed in installed source for both arms** (identical `1 - deltaY*0.01` gain, identical 150ms timer). So mid-gesture is smooth in both; EmbedPDF's penalty lands on the commit frame, on the already-blocked thread.
  > pdf.js's "slow raster (181ms avg), smooth frames (41.4ms worst)" is the **render-on-settle** design, not thread offload: the CSS-transform preview keeps the gesture at frame rate while the slow main-thread render is debounced 150ms off the critical path.

---

## 3. What EmbedPDF actually offers — and which path fits us

- **Snippet (`@embedpdf/snippet` / `@embedpdf/react-pdf-viewer`):** a prebuilt batteries-included drop-in viewer (`EmbedPDF.init({type:'container',target,src,theme})` mounts toolbar/sidebar/thumbnails/scroll/zoom/search/annotations). Customization bounded to Commands/Icons/Schema + disabledCategories; **no documented custom-plugin or per-page-overlay API.** Not installed. Useful only as a stock smoothness reference — **wrong shape** for our Survey Marker overlay.
- **Engines (`@embedpdf/engines`):** the PDFium-WASM runtime. `usePdfiumEngine({wasmUrl, worker, logger, encoderPoolSize, fontFallback})`, default `worker: true`. `worker: true` → off-thread inline-Blob module Worker; `worker: false` → direct/main-thread engine. Single-threaded WASM → **no COI headers needed**. `encoderPoolSize` (default 0) parallelizes encode off-thread via OffscreenCanvas.
- **PDFium (`@embedpdf/pdfium`):** Google's engine as a ~4.6MB WASM; renders to a BGRA buffer encoded to a Blob (PNG default). Raster cost **quadratic in scale·dpr**. Rotation (e.g. `/Rotate-270`) baked into pixels via the device matrix, with a `normalizeRotation` doc-open option. `maxZoom` up to 60x makes real deep zoom reachable — a battle-tested rasterizer we'd otherwise write.
- **Plugins (headless composition — what we use):** viewport / scroll (`bufferSize` virtualization) / render (base raster) / tiling (768px hi-res tiles over a low-res base, CSS-stretch continuity = no white flash) / zoom (CSS transform during gesture, commit 150ms after last tick) / interaction-manager / document-manager. **This stack lets us mount our own per-page SVG overlay (Survey Marker), which the Snippet cannot, and aligns with the own-the-zoom north star.** (The 150ms wheel debounce is hardcoded, no config prop.)

**Path that fits us: the headless plugin stack with our own SVG overlay** — not the Snippet. That is already what the EmbedPDF arm mounts.

---

## 4. The correct EmbedPDF setup for smooth deep-zoom

Core change:

```js
usePdfiumEngine({ wasmUrl: '/pdfium.wasm', worker: true, logger: console, encoderPoolSize: 3 })
```

1. **`worker: true`** — move PDFium parse/raster off the main thread. The SharedArrayBuffer/COOP-COEP objection does not apply (single-threaded WASM), so **no Vite header change is required for that reason**; keep current headers and MSAL untouched. **Gating step:** the comment also records an empirical open-document **hang** in the Vite dev server this review could not refute — flip it, run it, confirm the document actually loads. If it hangs, suspect dev-server serving of the blob/module worker, WASM fetch from worker scope, MIME, or Range handling (note the `mode: 'full-fetch'` workaround) — not headers.
2. **`logger: console`** — none is passed today, so a worker open-document error is invisible. Highest-value diagnostic for confirming whether the hang reproduces and why.
3. **`encoderPoolSize` 2-4** (capped to hardware concurrency) — default 0 serializes encode; a pool parallelizes off-thread PNG/Blob encode so tile/page delivery doesn't stall during rapid zoom.
4. **Cap the base RenderLayer scale** — keep the base a cheap blurry backdrop and let tiles own crispness; removes one full-page re-raster per mounted page per commit.
5. **Lower `defaultBufferSize` 2 → 1** — trims off-screen mount cost (secondary; the 3→8 growth was driven mainly by zooming out, and the window already releases).
6. **Tiling:** keep `tileSize 768`; code default for `overlapPx` is 2.5 (arm sets 5); keep `extraRings 0` for cursor zoom. Once off-thread, optionally `extraRings 1` to kill blank-tile pop-in and `defaultImageType: 'image/webp'` to shave encode/transfer vs PNG.
7. **Deep-zoom memory/DPR:** cap effective DPR ~1.5-2 (engine floors dpr at 1 but does not cap it; cost is quadratic in scale·dpr). For `/Rotate-270` sheets pass `rotation: Degree270` or open with `normalizeRotation: true` so tile grid + annotation coords stay in unrotated space. Bound `maxZoom` (60x default is generous; the reducer transiently holds old+new-scale tiles during a zoom).
8. **Fix the metrics bridge before re-judging:** time `renderTile`/`renderPage` round-trips (or subscribe to the tiling plugin's tile-rendering events) and report `rasterMs`; mirror the readout into the EmbedPDF branch of the spike UI. Without this the re-match is blind on the deciding number.
9. **Test trap:** `maxZoom: 60` is unreachable in one wheel gesture — the per-gesture CSS accumulator is hard-clamped to `[0.1, 10]`. Reach deep zoom via multiple gestures or the quick-zoom buttons.

---

## 5. Exactly what's misconfigured now, and the diffs

| Where | Current | Change to | Why |
|---|---|---|---|
| engine init | `worker: false` | `worker: true, logger: console, encoderPoolSize: 3` | Off-thread PDFium; the cited COI rationale is false. **Then run and confirm load.** |
| engine-init comment | asserts COOP/COEP-for-MSAL blocks the worker | rewrite: cited SAB/COI reason debunked; only the dev-server hang is open | Keeps the comment honest |
| scroll registration | `defaultBufferSize: 2` | `defaultBufferSize: 1` | Trim off-screen mount cost (secondary) |
| RenderLayer base scale | uncapped (tracks `actualScale`) | cap to a fixed low scale | Kill full-page re-raster per page per commit |
| MetricsBridge + spike UI | no raster timing in EmbedPDF branch | add `rasterMs` instrumentation + readout | Make the deciding number measurable before re-judging |

Do **not** touch the pdf.js arm — it is the control.

---

## 6. Recommendation and next steps

**Run a FAIR re-match after fixing AND verifying EmbedPDF.** The current log measures a config flag whose cited justification is debunked — but the fix is not "essentially free": one claim survived scrutiny (the documented dev-server open-document hang). So the fix is cheap to attempt and low-risk to headers/MSAL, but it carries a real unknown that must be cleared by running it.

1. Apply the §5 diffs to the EmbedPDF arm.
2. **Run it and confirm the document opens off-thread.** If it hangs, diagnose with the new logger (worker WASM fetch / MIME / Range under Vite) before concluding anything.
3. Re-run the identical two-arm protocol with **matched gesture counts and zoom ranges** (current log compared 27–310% EmbedPDF vs 57–1192% pdf.js on the same file) and **raster measured on both arms**.
4. **Then decide.** Honest read: EmbedPDF's worker + tiling architecture is strictly better matched to the own-the-zoom north star and to heavy survey/CAD sheets than a hand-rolled pdf.js viewer — tiling gives bounded-cost deep zoom where pdf.js-direct hits a crispness cliff (our pdf.js arm's deliberate budget clamp exists precisely to expose that cliff), and PDFium is a battle-tested rasterizer we'd otherwise reimplement. Expect the fair re-match to narrow or close the gap, possibly favoring EmbedPDF at deep zoom — but that is a hypothesis to test, not a foregone conclusion.
5. Keep the pdf.js arm as the untouched control through the re-match. The next move is fixing **and verifying** EmbedPDF, not investing further in pdf.js.

---

## Appendix — load-bearing claims, verifier status

1. **CONFIRMED.** Arm forces `worker: false`; engines hook defaults `worker = true` (byte-exact, v2.14.3).
2. **PARTIAL.** SAB/COI mechanism debunked (single-threaded WASM, shared bit unset). But core path uses structured-clone copy (transfer only in the encoder pool), and the comment's empirical dev-server hang is **untested** — the *cited reason* is wrong, not necessarily the whole comment.
3. **PARTIAL.** pdf.js **parse** runs in a Web Worker; **raster runs on the main thread**. Smoothness comes from render-on-settle + CSS transform, not thread offload.
4. **PARTIAL.** 358.8ms vs 41.4ms (8.67x) confirmed. 310%/1192% are session-peak zooms, not zoom-at-worst-frame — both worst frames occurred at low zoom (43% / 57%). Thread-placement conclusion holds (stronger). EmbedPDF raster never instrumented, so "not raster size" is an inference.
5. **CONFIRMED.** Both arms render-on-settle 150ms after the last wheel tick with a CSS transform during the gesture; penalty lands on the commit frame.
6. **CONFIRMED.** Per zoom commit: full-page re-raster + unthrottled tile recompute; only scroll is throttled (50ms).
7. **PARTIAL.** `bufferSize: 2` and 3→8 vs 5 confirmed. But "never release" is false (8→7→6); the climb is driven mainly by zoom-out to 27%; pdf.js is not "capped at 5" by design; the comparison is confounded by unequal zoom ranges. (`bufferSize: 2` is below the library default of 4.)
8. **CONFIRMED.** EmbedPDF `rasterMs` never measured; raster work happens, its duration is unmeasured.
