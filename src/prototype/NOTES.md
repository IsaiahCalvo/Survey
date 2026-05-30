# Renderer Spike — throwaway prototype (v2: real two-arm mini-viewer)

**This is throwaway code.** Delete `src/prototype/` and the `?spike=renderer`
block in `src/main.jsx` once the verdict below is recorded. Also remove the
EmbedPDF deps from `package.json` and `public/pdfium.wasm` if we don't keep it.

## The question

Replace Syncfusion by **owning the renderer on pdf.js** (already in this app), or
adopt **EmbedPDF** (PDFium-WASM, ships a tiling pipeline)? The v1 spike was a
single flattened page and couldn't answer it. This v2 is a real mini-viewer where
**both arms do the same four hard things**, so the comparison is on data, not vibes:

1. Continuous, virtualized multi-page scroll (100+ pages)
2. Cursor-anchored zoom that **holds** its level (no snap-back to 100%)
3. Real, interactive, page-locked annotations on top
4. The same fps / worst-frame / memory meters

## How to run

Dev server, then open `…/?spike=renderer`. It loads in isolation — no auth, no
Supabase, no Syncfusion, no touching `PDFViewer.jsx`.

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
  only pages within ~1.2 viewports mount a canvas. Cursor-anchored zoom via
  `new_scroll = (old_scroll + cursor)·ratio − cursor`; committed scale persists.
  Render-on-settle (CSS-upscale during the gesture, crisp DPR-correct re-raster
  ~180ms after). Double-buffered, cancellable renders with a generation guard.
  A canvas-budget **CLAMP** makes the pdf.js-direct deep-zoom **crispness cliff**
  visible (when "canvas" turns red, that bitmap is capped and CSS-upscaled = blur).
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
