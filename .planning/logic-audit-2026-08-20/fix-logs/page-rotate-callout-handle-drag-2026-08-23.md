# Remapped callout handle drag after page CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.**  
Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write.

Started from tip `6b26de17`. Distinct from leftover-18 / X-01 / rotate persist/handles product / form persist / max-update-depth / 103-ID `2026-08-23c` / UL Counter start / survey-marker `stemSign` (not replayed).

## Why this leftover

`e2e-callout-knee-drag` parked Pages-rotate-then-drag as `rotate-drag-no-move`.  
`e2e-page-rotate-callout-remap` only asserted remapped fractions + handle hit, not persist.

Official `npm test` was green until standing isolated **8448**. This is the next unique leftover: user-drag of remapped callout parts on landscape `viewBox="0 0 792 612"`.

## Product

No product edit. High-risk files untouched.  
`useSVGInteraction` already normalizes `dxNorm = dxPage / pageWidth` from the live viewBox (`pageWidth: width` in `SVGAnnotationLayer`). Playwright **mouse** after Pages rotate misses the landscape host (same class as the parked cheap 20px sample). Dispatching `PointerEvent` on the remapped SVG handle persists.

## Live-proved

`?testPdf=clickable-link-test.pdf` — `file.id` **null**.

| Slice | Evidence |
|---|---|
| Empty CW / CCW | invents **0** |
| Remap | `callout-8b50bd6e-…` box **0.440 / 0.420 → 0.484 / 0.512**; knee **0.212 → 0.750**; viewBox **`0 0 792 612`** |
| Leader (`line2` = whole) | knee **0.750 → 0.821**; box followed **0.484 → 0.555** |
| Undo leader | restores remapped fractions, not leftover portrait |
| Knee | **0.750 → 0.829**; remapped box + tip held |
| ArrowTip | **0.780 → 0.859**; box held |
| Text box | **0.484 → 0.531** |
| Pen-armed | no-op |
| Empty click | invents **0** |
| hubPreview | Callout **0** |
| 390 | viewBox portrait; Pages present; invents **0**; `file.id` null |

Playwright `e2e-page-rotate-callout-handle-drag.spec.mjs` **2 / 2 (12.4s)**.  
Focused Node `pageRotateCalloutHandleDrag` + leftover18 + knee-drag + remap **23 / 23**.

Official `npm test` this turn (before leftover): main green; isolated `annotationDocConcurrency` **103 / 103** + `partialEraseCurveLocality` **15 / 15**; fail-stop `partialEraserComplexity` **9 / 10** standing **12047.56 MiB > 8448.00 MiB**. Cap **8448** / 75/250 **not** loosened.

`graphify` CLI **absent**. Lease **absent**. Goal stays **OPEN**.
