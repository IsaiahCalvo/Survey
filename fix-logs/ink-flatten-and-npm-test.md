# Ink print flatten + official npm test — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product commit:** `aa0f0964`  
**Goal:** stays open

Did **not** replay leftover 18. No prod SQL. No budget loosen (8448 / 75/250). No secrets.  
Did **not** invent a flatten rewrite (no filled-paper-ink polygon path, no hairline, no Z).

`e2e-export-scale-leftovers` spec/receipt already on the branch (`3112ca7b` / `2fbc943c`) — not untracked.

## Ink verdict — user-visible miss; min-diff applied

`drawFlattenedObject` `type === 'path'` drew `fabricPathToSvgPath(obj.path)` at origin `{0, pageHeight}` with **raw** commands.

Ink **export** already bakes `createInkPageTransform` / `transformInkPath` once (`tests/pdfInkAffineExport.test.mjs`). After move/scale/rotate the authored path stays local:

| Gesture | Product commit | What print saw before |
|---|---|---|
| Fresh draw | `left=0 top=0` pathOffset omitted — path is page-absolute | Identity. Existing on-page test still holds. |
| Move | `commitInkObjectMove` → localize, keep path, set `left/top` + `pathOffset` + `center-v1` | Raw path = **unmoved** stroke |
| Scale | `commitInkObjectResize` (same localize + `scaleX/Y`) | Raw path = **unscaled** stroke |
| Rotate | `applyPageAffineToInkObject` / `angle` + `pathOffset` | Raw path = **unrotated** stroke |

Screen (`createInkPathAffine` in SVG) and export already apply that affine. Print did not. After a move of `(20,10)` a stroke starting at `(50,60)` still flattened at `(50,60)` instead of `(70,70)`.

**Min-diff** (`src/utils/pdfAnnotationsPdfLib.js` path branch only):

- `normalizeOperationalInkPath` → `createInkPageTransform` → `transformInkPath` → `fabricPathToSvgPath`
- Stroke width `max(0.5, strokeWidth * transform.strokeScale)` — same scalar export uses for `/Border`

High-risk files **not** edited (`PDFViewer.jsx`, PAL, FabricEraser, SVG layer, `viewerShared.js`, `package.json`, `vite.config.js`).

Invariants held: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

Not invented: filled highlighter as polygons (still stroke-only flatten, now at the transformed location).

### Intended / break / edge

`node --test tests/inkPrintFlattenAffine.test.mjs tests/printFlattenOnPage.test.mjs tests/pdfInkAffineExport.test.mjs tests/exportScaleLeftovers.test.mjs` → **31 / 31**

- **Intended (move):** `commitInkObjectMove(..., 20, 10)` first device point = affine `(70, pageHeight-70)`
- **Break:** moved start is not raw `(50, pageHeight-60)`
- **Intended (scale):** `commitInkObjectResize` device start = `createInkPathAffine.point`
- **Intended (rotate):** `left/top/scale/angle/pathOffset` fixture matches the same affine
- **Edge:** unmoved absolute ink (`left=0`, no pathOffset) stays identity — existing on-page pen test still maps `(50,60)` → device `(50, pageHeight-60)`

Official suite also ran `tests/inkPrintFlattenAffine.test.mjs` → **5 / 5**.

## Official `npm test`

```
node scripts/run-node-tests.mjs
```

(`npm test` is the same script.) ~139s wall.

| Run | Exit | What failed |
|---|---|---|
| Official after `aa0f0964` | **1** | **cap leftover only** — `tests/partialEraserComplexity.test.mjs` `500 crossing cuts` **11960.00 MiB > 8448.00 MiB** |

### Fail list

| Kind | File / test | Detail | Action |
|---|---|---|---|
| **Cap leftover (left)** | `tests/partialEraserComplexity.test.mjs:636` — 500 crossing cuts preserve every component inside bounded memory and release time | `total allocation 11960.00 MiB exceeded 8448.00 MiB` | **Left.** Same leftover as `fix-logs/eraser-memory-cap.md` / `fix-logs/npm-test-after-thirteen.md`. Cap **8448** unchanged. |

No other official-suite fails. Main files **0 fail** (447 files; `pass 0` rows are `# SKIP`, not fails). Isolated `annotationDocConcurrency` **103 / 103**. Isolated `partialEraseCurveLocality` **15 / 15**. Isolated `partialEraserComplexity` **9 / 10**. Runner stopped before `svgPathTransformFidelity` (first isolated fail).

Timing 75 / 250 **not loosened** (crossing fail is allocation, after wall/CPU asserts).

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Goal

Stays **open**.
