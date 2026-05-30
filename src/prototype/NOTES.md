# Renderer Spike — throwaway prototype

**This is throwaway code.** Delete `src/prototype/` and the `?spike=renderer` block
in `src/main.jsx` once the question below is answered and the verdict recorded.

## The question

Can we replace Syncfusion by **owning the renderer on pdf.js (already in this app)** and
get (a) buttery zoom/scroll and (b) crisp deep zoom on our heaviest survey/CAD sheets —
or do we need **EmbedPDF** (PDFium-WASM, which ships a tiling pipeline)?

Background: research + a code read established that pdf.js is already this app's PDF
engine, and that smooth zoom is a *viewport/raster-strategy* problem, not an *engine*
problem. The one genuine unknown is pdf.js's deep-zoom **crispness cliff** on large-format
sheets (it rasters one canvas per page; past a size budget it must blur or tile). This
spike makes that cliff visible and measurable.

## How to run

Dev server, then open the app URL with `?spike=renderer` (e.g.
`http://localhost:5173/?spike=renderer`). It loads in isolation — no auth, no
Syncfusion, no touching `PDFViewer.jsx`.

1. Click **Load PDF…** and pick your **heaviest large-format CAD/survey sheet**. The
   bundled default is small and NOT a real stress test.
2. It auto-selects the largest page. Zoom with **ctrl/⌘ + scroll** (or the Fit / 100% /
   400% / 1600% buttons). Pan with plain scroll/drag. Toggle **Rotate** for the 90/270 test.
3. Watch the bottom bar:
   - **fps / worst frame** during an active zoom sweep — green = smooth.
   - **canvas …MP** — if it turns red **CLAMPED**, that is the exact point pdf.js-direct
     goes blurry and tiling becomes necessary. Note the zoom % where it happens.
   - **raster ms** — how long a re-render takes after the zoom settles (the "snap").
   - **heap MB** — watch for runaway growth.
4. The red/blue/green **overlay** shapes prove the annotation layer stays pixel-locked to
   the page through zoom and rotation (the `viewBox="0 0 W H"` contract).

## Arms

- **Arm A — pdf.js**: fully wired (direct render, transform-during-gesture →
  reraster-on-settle, RenderTask cancellation, DPR-correct, clamp-to-show-the-cliff).
- **Arm B — EmbedPDF**: placeholder. Wire only if Arm A blurs/janks on the worst sheet:
  `npm i @embedpdf/core @embedpdf/engines`, mount its headless scroller + tiling/zoom
  plugins on the same sheet with the same overlay, measure the same numbers.

## Still to build (if Arm A passes, these may be unnecessary)

- Multi-page virtualized scroll for the 200+ page memory test.
- A 2-tile-deep DIY tiling experiment for the single biggest sheet (the fix if Arm A clamps).
- Arm B (EmbedPDF) for the head-to-head.

## VERDICT (fill in)

- Heaviest sheet tested: _____ (dimensions, page count)
- Smoothness during zoom (fps / worst frame): _____
- Crispness: does it clamp/blur? At what zoom %? _____
- Decision: **pdf.js path** / **EmbedPDF path** / **needs DIY tiling** — _____
- Date / who: _____
