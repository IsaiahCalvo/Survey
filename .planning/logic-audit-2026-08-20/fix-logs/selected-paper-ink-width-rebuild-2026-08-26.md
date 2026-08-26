# Selected paper-ink Width rebuilds baked outline — 2026-08-26

## Leftover taken

User-selected Pen / Highlighter Width. Live toolbar already wrote Width as `sourceWidth`, and Select chrome already reads that field (`f9ae9160`), but the page / export paint the baked filled outline (`path` + `polygons`). Select Width patched leftover `sourceWidth` only, so a Width **4** stroke stayed visually **4** after Width **20**. Distinct from leftover-18, selected paper-ink Select chrome (`f9ae9160`), selected-shape Fill Opacity 0 sync, Pen / Highlighter first-stroke persist, and C-01 swatch / hex / Transparent apply. Field clamp 1–50 stayed. Did not invent a richTextEditor. Did not restroke eraser-cut strokes (that would restore erased bits). Did not invent imported-outline Width without a centerline.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / create-path / view clamp / Select chrome leftover after selected paper-ink Select chrome (`5ace3f50` / product `f9ae9160`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Selected paper-ink Width baked outline** | Width after Select | **LIVE leftover** — sourceWidth 20, bboxH/polyH stayed 4 |
| Style Dotted Ellipse `/AP` | Style | **aligned** — not replayed |
| Font / B / I / size persist | Font chrome | **not live** — richTextEditor edit-only |
| Line `/AP` | Line | **not a leftover** — native Line has no `/AP` |
| leftover-18 human-gated | — | **not taken** |

Live probe before the fix (`/?testPdf=clickable-link-test.pdf`): Pen Width **4** `bboxH` **4** / `polyH` **4**; Select Width **20** wrote `sourceWidth` **20** and left `bboxH` **4** / `polyH` **4** / `pathLen` **70**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** replay `pdfAnnotationsPdfLib.js` `/AP` writers.

## Product

`src/utils/productionPaperInk.js` (not high-risk):

- `rebuildProductionPaperInkWidth` — restroke `path` / `polygons` / bounds from `paperCenterline`
- Skip when there is no centerline (imported outlines) or eraser cuts exist

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Select Width patch calls `rebuildProductionPaperInkWidth` instead of leftover `{ sourceWidth }` only

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Arrow flatten Arrowhead or export/`/AP` writers.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-selected-paper-ink-width-rebuild.spec.mjs` **2 / 2 (7.5s)**.

- Intended: Pen Width **4** first stroke (`bboxH` / `polyH` ~4) + Select Width **20** rebuilds baked outline (`bboxH` / `polyH` > 16, leftover `strokeWidth` stays 0)
- Break: empty export invents 0; hubPreview Width **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfSelectedPaperInkWidthRebuild` proves rebuild grows leftover height 4 → 20, skips invented centerline / eraser cuts, Select patch calls rebuild, isolated 8448 / 75/250 standing.

Focused Node `pdfSelectedPaperInkWidthRebuild` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected paper-ink Color / Opacity / Width chrome now reads fill / sourceWidth — not a leftover
- Color selected-patch now writes fill — not a leftover
- Width selected-patch now rebuilds baked paper-ink polygons — not a leftover after this pass
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Style Dotted already writes Ellipse `/AP` — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
