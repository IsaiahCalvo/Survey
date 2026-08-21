# E2E live-prove — text / textbox flatten scale

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product commit:** `99478f57` (`createFreeTextAnnotation` / `drawFlattenedText`: wrap `/Rect` and print height by `|scaleX|` / `|scaleY|`)  
**Goal:** stays open

Did **not** replay leftover 18. Did **not** re-run official `npm test`.  
No prod SQL. No budget loosen (8448 / 75/250). No secrets.  
Did **not** invent image/stamp writers.

Crossing-cuts allocation leftover **unchanged**.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-text-flatten-scale.spec.mjs
```

**Live: 3 / 3 passed (8.6s).** Objects drawn on `/?testPdf=clickable-link-test.pdf`. Export/print is the Vite-imported `savePDFWithAnnotationsPdfLib` / `savePDFWithFlattenedRegularAnnotationsForPrint` used by annotated export and markup print.

Group-resize chrome is still `moveOnly={true}` (handles hidden). Intended/edge apply the live hook persist contract (`target.scaleX = (orig.scaleX || 1) * Math.abs(sx)`, text width unbaked) to a live-drawn textbox — same pattern as imported polygon leftovers. Individual resize is a real BR handle drag.

## Extra product fix

**None.** `99478f57` held. High-risk files not edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Cluster | Verdict | Live proof |
|---|---|---|
| **Intended** | **pass** | Drew textbox `AAAA BBBB` (`width=73.44 height=54 scale=1`). Group-resize UI **hidden**. Persist contract `scaleX=2 scaleY=2` left width unbaked. Export `/Rect [97.92, 525.60, 244.80, 633.60]` = 146.88×108, not raw `[97.92, 579.60, 171.36, 633.60]`. Print overlay **1** `Tj` at scaled wrap; raw width **2** `Tj`. |
| **Break** | **pass** | Individual BR resize baked `scaleX=1 scaleY=1`. Width `97.92 → 188.03`, height `54 → 90.04`. Export `/Rect` matches raw baked box `[122.40, 385.16, 310.43, 475.20]`, not a re-multiplied scale. |
| **Edge** | **pass** | Non-uniform persist `scaleX=2 scaleY=3` on live `85.68×54`. `/Rect` width 171.36 (`*|scaleX|`) ≠ height 162 (`*|scaleY|`). Wrap isolate: `width=40 scaleX=2` → **1** `Tj`; `width=40 scaleX=1` → **2** `Tj`. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-text-flatten-scale.spec.mjs`

## Goal

Stays **open**.
