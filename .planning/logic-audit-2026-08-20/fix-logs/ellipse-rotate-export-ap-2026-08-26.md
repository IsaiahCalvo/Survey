# Ellipse / Circle Rotation export `/AP` `/Matrix` — 2026-08-26

## Leftover taken

Live Rotation already stamped fabric `angle` (mtr / Rotation pill) and SurveyAppAnnotation already kept it, but live `circle` used `createCircleAnnotation` with no `angle` so `/AP` stayed axis-aligned, and print flatten painted the leftover oval, so Acrobat / print stayed unrotated until Rotation was re-touched. Write Circle `/AP` `/Matrix` about the form center (same sign as Square / FreeText `/AP`: `matrixTheta = -fabricAngle`) and expand `/Rect` to the tilted AABB. Flatten wraps `drawEllipse` in `q` / `cm` / `Q`. Angle 0 / absent omit `/Matrix` and keep leftover `/Rect` so default Circle export stays byte-identical. Imported type `ellipse` already had `createEllipseAnnotation` `/AP` `/Matrix` — that writer is unchanged. Counters take the pin `/AP` branch and `lockRotation` — do not invent counter body Rotation. Callouts have no live box Rotation — do not invent.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53. Did **not** invent a create-poly / create-ink tool.

## Why this leftover

Prefer next live `/AP` leftover after Square Rotation export `/AP` (`3643c6d8` / product `c99e1e1e`). Previous hunter parked Ellipse / Circle Rotation as dedicated. Probe proved live Ellipse mtr writes `angle`; live `circle` `/AP` + flatten still dropped it. Took Ellipse / Circle only — Square already landed.

| Candidate | Live control | Verdict |
|---|---|---|
| Ellipse / Circle Rotation 45 + faded Fill `/AP` + flatten | Rotation pill + Color Fill Opacity | **LIVE leftover** — screen + metadata keep 45; live `circle` `/AP` + print stayed AABB |
| Rect / Square Rotation 45 + faded Fill `/AP` + flatten | Rotation pill + Color Fill Opacity | already landed — not replayed |
| Textbox Rotation 45 + faded Fill `/AP` + flatten | Rotation pill + Color Fill Opacity | already landed — not replayed |
| Callout box Rotation `/AP` | — | **not live** — do not invent |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — `createCircleAnnotation` expands `/Rect` and passes `angle` to `attachIndependentShapeAppearance`; flatten circle/ellipse wraps `drawEllipse` in `q`/`cm`/`Q`
- `tests/pdfEllipseRotateExportAp.test.mjs`
- `tests/pdfSquareRotateExportAp.test.mjs` — host assertion no longer requires the parked "do not invent Ellipse flatten" comment
- `debug/scenarios/e2e-ellipse-rotate-export-ap.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Product

- `12349da3` — write faded Circle Rotation via `/AP` `/Matrix` so 45° keeps fade

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-ellipse-rotate-export-ap.spec.mjs` **2 / 2 (8.1s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Shapes → Ellipse + Color Fill Opacity `40` + Rotation `45` writes fill **0.4** + angle **45**; Export writes Circle `/AP` `/Matrix` cos(-45) + SurveyAppAnnotation angle **45** + faded `fill`; `?testPdf=` reimport keeps fade + 45; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 ellipses; hubPreview Color **0**
- Edge: 390 keeps viewBox / `file.id` / ellipse create; no Color Fill (mobile chrome has no Color); no invent

Node `pdfEllipseRotateExportAp` proves faded 45° live `circle` writes `/AP` `/Matrix` + expanded `/Rect` + metadata angle **45**; angle 0 omits `/Matrix` and keeps leftover `/Rect`; flatten circle/ellipse 45 writes `0.7071` `cm`.

Focused Node `pdfEllipseRotateExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Ellipse / Circle Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover after this pass
- Square / rect Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Textbox `Hi 😀` / `✓ Hi` Contents + SurveyAppAnnotation now survive `PDFHexString` load — not a leftover
- Callout / counter / note / layer JSON share `pdfEncodedString` — same unicode write
- `\r` / unpaired `\` / `#` / café already survived PDFString — not leftovers
- NBSP now rides hex via the same round-trip gate — not taken separately
- Textbox faded Border `/AP` `/CA` now attaches when Fill is empty or opaque — not a leftover
- Callout faded Border `/AP` `/CA` shares that writer — not a leftover
- Textbox faded-fill `/AP` wrap now paints one `Tm` + `Tj` per `wrapFlattenedTextLines` line — not a leftover
- SurveyAppAnnotation JSON `\n` now survives `PDFString.decodeText` — not a leftover
- Textbox faded-fill `/AP` verticalAlign now places Tm y via `flattenedTextBlockOffset` — not a leftover
- Callout faded-fill `/AP` verticalAlign — callouts have no `verticalAlign`; do not invent
- Textbox faded-fill `/AP` textAlign now places Tm x via `flattenedTextInlineOffset` — not a leftover
- Callout faded-fill `/AP` textAlign shares that writer — not a leftover
- Textbox faded-fill Style dash now writes `/AP` `[6 4] 0 d` — not a leftover
- Callout faded-fill Style dash now writes `/AP` `[6 4] 0 d` — not a leftover
- Ellipse / Circle Style dash export now writes `/AP` `[6 4] 0 d` — not a leftover
- Ellipse / Circle Style dash flatten now writes `borderDashArray` — not a leftover
- Line / Callout leader Style dash `/AP` — **confirmed not a leftover** (no `/AP`; native `/BS`)
- Square `/AP` dash — already aligned
- Square / Circle Style dash dict `/BS` — **confirmed not a leftover** (reimport keeps dash via `/AP` + metadata)
- Counter pin label `Tm` — **confirmed not a leftover** (GS1 `/ca` + layout already ride live Number styles)
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
