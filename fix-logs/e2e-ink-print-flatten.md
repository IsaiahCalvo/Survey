# E2E live-prove — ink print flatten

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product commit:** `aa0f0964` (`drawFlattenedObject` path branch: `createInkPageTransform` + `transformInkPath` + `strokeWidth * strokeScale`)  
**Goal:** stays open

Did **not** replay leftover 18. Did **not** re-run official `npm test`.  
No prod SQL. No budget loosen (8448 / 75/250). No secrets.

Crossing-cuts allocation leftover **unchanged** (`tests/partialEraserComplexity.test.mjs:604`).

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-ink-print-flatten.spec.mjs
```

**Live: 3 / 3 passed (8.5s).** Print panel stays disabled; flatten is the Vite-imported `savePDFWithFlattenedRegularAnnotationsForPrint` used by markup print, fed the live pen object after real draw / move / resize / rotate-pill on `/?testPdf=clickable-link-test.pdf`.

Device points parsed from the flattened content stream. Expected start = `createInkPathAffine.point` then `y → pageHeight - y`.

## Extra product fix

**None.** High-risk files not edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Cluster | Verdict | Live proof |
|---|---|---|
| **Intended** | **pass** | Draw pen. Fresh `left=0 top=0` no `pathOffset`. Drag localizes (`left/top` + `pathOffset`). BR resize `scaleX≈1.49 scaleY≈1.51`. Rotate pill **90°**. Flatten start `(350.83, 612.30)` === affine; raw would have stayed `(121.59, 600.66)`. |
| **Break** | **pass** | Fresh unmoved ink still `left=0`, no `pathOffset`, `scale=1`, `angle=0`. Flatten start === raw page-absolute `(109.52, 458.00)` === affine. Constructed `left=0` / no-`pathOffset` clone of the live path is the same identity. |
| **Edge** | **pass** | Same stroke: BR scale then rotate pill **45°** (`scaleX≈1.60 scaleY≈1.43`). Flatten start === affine, not raw. Printed `w` = `1.510` = `max(0.5, strokeWidth\|\|1) * strokeScale` (`strokeScale≈1.510`). Live `strokeWidth` is `0` (falsy); flatten already uses `\|\| 1` — not a new miss. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-ink-print-flatten.spec.mjs`

## Goal

Stays **open**.
