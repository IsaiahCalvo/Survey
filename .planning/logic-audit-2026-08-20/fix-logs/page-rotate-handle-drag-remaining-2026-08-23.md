# Remapped line/arrow / counter-nubbin / survey-marker handle drag after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from tip `5efaa82e`. Distinct from leftover-18 / X-01 / remapped callout handle-drag / remapper placement catalogs / persist/History/export/save / `mtr` / max-update-depth / 103-ID / UL Counter start / `stemSign` / unrotated `rotate-drag-no-move` (not replayed).

## Hit-test verdict — harness-only

Playwright **mouse** after Pages rotate misses the landscape host. That is **not** a product hit-test bug.

| Probe (remapped line `p2` on `viewBox` `0 0 792 612`) | Value |
|---|---|
| leftover-portrait SVG (`0 0 612 792`) | **0** |
| overlay vs page host (`getBoundingClientRect`) | **0 / 0** (SVG `offsetWidth` is 0 — `width="100%"` artifact, not leftover portrait) |
| `screenToSVG` / `getScreenCTM` | live; handle bbox maps **on-page** |
| `elementFromPoint` at handle bbox | **the handle** |
| Playwright mouse persist | **4.97** (< EPS 6; no-op) |
| PointerEvent persist | **59.64** |

Cites: `src/utils/svgTransformMath.js` `screenToSVG` (`getScreenCTM().inverse()`); `src/components/SVGAnnotationLayer.jsx` `viewBox={\`0 0 ${width} ${height}\`}` + `width/height 100%` + `position:absolute; top:0; left:0`; `useSVGInteraction` `handleId === 'p1' \|\| 'p2'` uses `screenToSVG`. Did **not** invent a mouse-coord remapper.

## Product

No product edit. High-risk files untouched.

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**.

| Type | Evidence |
|---|---|
| Empty CW / CCW | invents **0** |
| Line `e2b4a70c-…` | p1 **110.16, 237.60 → 554.40, 110.16**; PointerEvent `p1`/`p2` persist; undo restores remapped |
| Arrow `d3370aaf-…` | remapped `p2` persist; undo restores remapped |
| Counter `9bc66411-…` | **232.56, 221.76 / 225 → 570.24, 232.56 / 315**; nubbin **315 → 2.64**; undo restores remapped |
| Survey-marker `surveyMarker-625f3b30-…` | **208.08, 308.88 → 483.12, 208.08**; `br` **146.88×142.56 → 178.18×98.74**; undo restores remapped |
| Pen-armed / empty click | invents **0** |
| hubPreview | Line / Counter / marker **0** |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |

Playwright `e2e-page-rotate-line-handle-drag.spec.mjs` **2 / 2 (11.1s)**.  
`e2e-page-rotate-counter-nubbin-handle-drag.spec.mjs` **2 / 2**.  
`e2e-page-rotate-survey-marker-handle-drag.spec.mjs` **2 / 2 (10.5s)**.  
Focused Node `pageRotateHandleDragRemaining` + leftover18 + callout handle-drag **19 / 19**.

Cap **8448** / 75/250 **not** loosened. Official `npm test` not re-run (no high-risk edit).

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
