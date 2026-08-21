# E2E live-prove — export / print scale leftovers (polygon + circle)

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Prior receipt:** `fix-logs/export-scale-leftovers.md` (`2b0ddbcf`, Node 23/23)  
**Goal:** stays open

Did **not** retry leftover 18. No prod SQL. No budget loosen. No secrets.  
Did **not** invent ink print-flatten. No product miss found this pass.

Vite reused at `http://localhost:5173` (`?testPdf=clickable-link-test.pdf` and a generated oval Circle fixture). High-risk files not edited.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-export-scale-leftovers.spec.mjs
```

**Live: 4 / 4 passed (12.2s)**

## Verdicts

| Case | Verdict | Live proof |
|---|---|---|
| **1** Polyline / polygon resize then export/print — vertices world-scaled | **pass** | `clickable-link-test.pdf` imports Polygon `63R` + PolyLine `51R`. Live Export at scale=1 writes `/Vertices` = `left+point.x`. Same live SVG objects with the isPointsShape commit (`scaleX=2` / `scaleY=2` and `2/3`) through Vite-imported `savePDFWithAnnotationsPdfLib` + print flatten write world-scaled vertices, not raw. Print second vertex x matches `left+2*point.x`, not `left+point.x`. Imported points-shapes have empty `data-anno-id`; UI resize handles never arm — not a new export bug. |
| **2** Circle (and imported oval) resize then export — `/Rect` uses scaled radii | **pass** | Drew Ellipse, corner-resized to `scaleX≈1.79` `scaleY≈1.54` with `rx/ry` unbaked. Export `/Rect` `[98.92, 521.18, 248.68, 664.28]` = `radius*\|scale\|` box (screen ~150×143), not the unscaled 84×93. Vite-import of the live object matches. |
| **3** Break: scale=1 still `left+point.x` / unscaled radius | **pass** | Live imported PolyLine export equals `left+point.x` / world-at-scale-1. Drawn Ellipse at `scaleX=1` (`left=111.16`, `rx=35.72`, `ry=46.52`) exports unscaled `/Rect`. |
| **4** Edge: non-uniform `scaleX≠scaleY` oval stays elliptical | **pass** | Side-handle resize `scaleX≈1.86` `scaleY=1` → `/Rect` width 178 ≠ height 109. Generated imported Circle `/Rect [20,150,60,170]` is 40×20 (not the min-radius 20×20 square). |

Ink flatten **not invented**. No user-visible ink miss confirmed.

## Extra product fix

**None.** `pdfAnnotationsPdfLib.js` from `2b0ddbcf` held under live Export + Vite-imported print.

High-risk files not edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-export-scale-leftovers.spec.mjs`

## Goal

Stays **open**.
