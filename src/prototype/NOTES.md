# Renderer Spikes — KEEP: permanent reference demos

**⚠ DO NOT DELETE `src/prototype/` or its `?spike=…` blocks in `src/main.jsx`.**
The original "throwaway, delete after verdict" note is void: the verdict landed on
the **pdf.js path**, and the demos below are now the **gold-standard reference and
regression test** that the real app's pdf.js engine is being brought up to match
(see `.planning/phases/37-pdfjs-cutover/DEMO-PARITY-BLUEPRINT.md`). They load in
isolation (no auth / Supabase / Pdfjs) so they stay a clean baseline to test
against. A cleanup/Pdfjs-removal pass must leave these in place.

## The three demos (run the dev server, then append to the address)

- `?spike=renderer` — the two-arm mini-viewer below: pdf.js vs EmbedPDF on scroll,
  cursor-anchored zoom, page-locked overlays, and fps/frame/heap meters.
- `?spike=perfgate` — the renderer-ownership zoom-smoothness / perf gate.
- `?spike=features` — the full feature demo: pdf.js pages plus one editable
  Canvas2D annotation model/renderer per mounted page, imported PDF markups,
  pen/select, partial or full erase, space-drag pan, cursor-anchored zoom, text
  search + select/copy, clickable links, and interactive form fields. This is
  THE parity target for the real app.

## Annotation editing stress target

The feature spike includes the 120-page fixture and a stress selector up to
2,000 annotations per page (240,000 document-wide). Pages remain virtualized;
high-density static annotation paints run in an OffscreenCanvas worker and swap
atomically. Filled/thick ink uses polygon subtraction for a real rounded eraser
bite; thin imported ink uses exact swept-capsule centerline cutting. Shortcuts:
`P` pen, `E` erase, `V` select, and hold Space while dragging to pan.

(The EmbedPDF arm and `public/pdfium.wasm` may be retired separately since the
verdict chose pdf.js, but the demos themselves stay.)

## The question

Replace Pdfjs by **owning the renderer on pdf.js** (already in this app), or
adopt **EmbedPDF** (PDFium-WASM, ships a tiling pipeline)? The v1 spike was a
single flattened page and couldn't answer it. This v2 is a real mini-viewer where
**both arms do the same four hard things**, so the comparison is on data, not vibes:

1. Continuous, virtualized multi-page scroll (100+ pages)
2. Cursor-anchored zoom that **holds** its level (no snap-back to 100%)
3. Real, interactive, page-locked annotations on top
4. The same fps / worst-frame / memory meters

## How to run

Dev server, then open `…/?spike=renderer`. It loads in isolation — no auth, no
Supabase, no Pdfjs, no touching `PDFViewer.jsx`.

- **Load PDF…** picks a local file; the four buttons load bundled fixtures
  (`debug/fixtures/`, served at `/debug-fixtures/`): a 120-page doc (scroll/virt
  test), a large 2448×3168 sheet (deep-zoom test), the real 36-page survey
  package, and the small default.
- Switch **Arm A — pdf.js** / **Arm B — EmbedPDF** at the top. Only the active arm
  is mounted, so the meters measure one renderer cleanly (Arm B re-loads its WASM
  on each switch — a few seconds; that cold-start cost is itself a data point).
- Zoom with **ctrl/⌘ + scroll** (anchored at the cursor). Quick buttons:
  Fit / 100% / 400% / 1600%. Drag the colored overlay shapes — they stay locked to
  the page through zoom on both arms (same `viewBox="0 0 W H"` contract as the app).
- Bottom bar: **fps**, **worst frame** (during gestures), **mounted pages**
  (virtualization proof), **raster ms** + **canvas MP** (Arm A) or **page x/total**
  (Arm B), and **heap MB**.

## What each arm is

- **Arm A — pdf.js (`PdfjsArm.jsx`)**: built directly on `pdfjs-dist`. Cumulative
  page-offset layout + per-page placeholders (stable scrollbar for 100+ pages);
  only pages within ~1.2 viewports mount a canvas. **Zoom matches EmbedPDF**: same
  gain (`factor = 1 − deltaY·0.01`) and the same gesture model — during a ctrl/⌘
  +wheel gesture the whole page-stack scales as ONE rigid CSS-transformed unit
  about the cursor (content + overlay locked together, frame-perfect pinning, no
  per-frame re-layout), then commits to the real layout + DPR-correct re-raster
  ~150ms after the last tick, anchored so the cursor point holds. Double-buffered,
  cancellable renders with a generation guard. A canvas-budget **CLAMP** makes the
  pdf.js-direct deep-zoom **crispness cliff** visible (when "canvas" turns red, that
  bitmap is capped and CSS-upscaled = blur).

- **Comparison logger (`spikeLogger.js`)**: every entry is tagged by tab (pdf.js /
  EmbedPDF) and file (bundled fixture vs a local desktop file). Captures the
  trackpad zoom-input rate (ticks/s + Δ/s), the actual PDF zoom rate (%/s), cursor
  position, fps + worst frame, mounted-page count, and raster ms. **💾 Save log**
  downloads `PDF render comparison <YYYY-MM-DD HH-MM-SS>.log` — drop it in the Logs
  folder and share it back to compare rounds / catch regressions.
- **Arm B — EmbedPDF (`EmbedpdfArm.jsx`)**: plug-and-play the open-source plugins —
  `engines` (PDFium-WASM), `viewport`+`scroll` (continuous virtualized scroll),
  `render` (base raster), **`tiling`** (hi-res tiles over the visible area = crisp
  deep zoom), `zoom` (`ZoomGestureWrapper` = cursor-anchored ctrl/⌘+wheel). Our
  same `InteractiveOverlay` is mounted in each page wrapper.

## Verified working (browser-driven, 2026-05-30, the 120-page fixture)

- **Arm A**: 2–3 of 120 pages mounted (rest placeholders); scrolling to 40%
  unmounted the top pages and mounted 47–49. Cursor zoom 200%→844%→1600% and
  **held** (scrollbar + scroll position scaled to keep the cursor point fixed).
  At 1600% the canvas hit the 80 MP budget and showed **⚠ CLAMPED** (the cliff).
- **Arm B**: PDFium renders pages; continuous scroll to 50% → page 61/120 with
  5 pages mounted; cursor zoom 225%→2254% and held; tiling kept grid lines crisp
  at 2254% (no clamp). Same overlay renders identically.
- Zero console errors on load and on arm switch.

## Caveats to weigh in the verdict

- **Arm B runs PDFium on the MAIN THREAD** (`worker: false`). The off-thread
  worker engine hangs on open-document in our Vite dev server — it wants
  cross-origin-isolation headers (COOP `same-origin` + COEP `require-corp`) that we
  deliberately don't set (MSAL needs COEP `unsafe-none`). Main-thread raster is a
  **fair** comparison to Arm A (pdf.js also rasters on the main thread), but
  EmbedPDF's worker mode could be smoother still in the real app once those headers
  are set. Re-test smoothness with the worker before a final call.
- **Memory**: Arm B's heap climbed steeply at extreme zoom (~4.8 GB at 2254% on the
  synthetic sheet) — tiling holds many bitmaps. Watch heap on the real heaviest
  sheet at the zoom levels you actually use.
- The dev fixture server returns 200 (full body) even for Range requests, so Arm B
  loads with `mode: 'full-fetch'`. The real app would use range requests.

## VERDICT (fill in — test on your heaviest CAD/survey sheet)

- Heaviest sheet tested: _____ (dimensions, page count)
- Arm A smoothness (fps / worst frame) during deep-zoom sweep: _____
- Arm A: at what zoom % does "canvas" go CLAMPED (blurry)? _____
- Arm B (EmbedPDF tiling): stays crisp there? smoothness? heap? _____
- Decision: **pdf.js path** / **EmbedPDF path** / **needs DIY tiling on pdf.js** — _____
- Date / who: _____
