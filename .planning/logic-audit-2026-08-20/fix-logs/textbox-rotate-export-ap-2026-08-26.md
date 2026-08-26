# Textbox Rotation export `/AP` `/Matrix` — 2026-08-26

## Leftover taken

Live Rotation already stamped fabric `angle` (mtr / Rotation pill) and SurveyAppAnnotation already kept it, but faded-fill FreeText `/AP` stayed axis-aligned and print flatten painted the leftover AABB, so Acrobat / print stayed unrotated until Rotation was re-touched. Write `/AP` `/Matrix` about the form center (same sign as ellipse `/AP`: `matrixTheta = -fabricAngle`) and expand `/Rect` to the tilted AABB. Flatten wraps the leftover box in `q` / `cm` / `Q`. Angle 0 / absent omit `/Matrix` and keep leftover `/Rect` so default faded-fill export stays byte-identical. Callouts share the `/AP` writer but have no live box Rotation — do not invent it.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53. Did **not** invent a create-poly / create-ink tool.

## Why this leftover

Prefer next live `/AP` leftover after textbox unicode export decode (`ed695cf4` / product `df1f8ca4`). `\r` / unpaired `\` / `#` / café / `a) Hi` / `Hi 😀` already survive Contents + JSON. Probe proved faded-fill `/AP` + flatten still dropped live Rotation.

| Candidate | Live control | Verdict |
|---|---|---|
| Textbox Rotation 45 + faded Fill `/AP` + flatten | Rotation pill + Color Fill Opacity | **LIVE leftover** — screen + metadata keep 45; `/AP` + print stayed AABB |
| Textbox `Hi 😀` Contents + JSON | Text + Color Fill Opacity | already landed — not replayed |
| Textbox `a) Hi` Contents + JSON | Text | already landed — not replayed |
| Textbox `\r` / unpaired `\` / `#` / café | Text | **not a leftover** — already survived |
| Callout box Rotation `/AP` | — | **not live** — do not invent |
| Rect / Square / Ellipse Rotation flatten | Rotation pill | **seen, not taken** — dedicated leftover |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — `pdfNeedsRotate` / `pdfRotateMatrixAbout` / `pdfRotatedBoxRect`; faded-fill FreeText `/AP` writes `/Matrix` + expanded `/Rect`; flatten wraps `drawFlattenedText` in `q`/`cm`/`Q`
- `tests/pdfTextboxRotateExportAp.test.mjs`
- `debug/scenarios/e2e-textbox-rotate-export-ap.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Product

- `54611cfc` — write faded textbox Rotation via FreeText `/AP` `/Matrix` so 45° keeps fade

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-rotate-export-ap.spec.mjs` **2 / 2 (9.4s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → type `Hi` + Color Fill spectrum + Opacity 40 + Rotation `45` writes text **Hi** + fill **0.4** + angle **45**; Export writes FreeText `/AP` `/Matrix` cos(-45) + SurveyAppAnnotation angle **45** + faded `backgroundColor`; `?testPdf=` reimport keeps text + fade + 45; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 textboxes; hubPreview Color **0**
- Edge: 390 keeps viewBox / `file.id` / text; no invent

Node `pdfTextboxRotateExportAp` proves faded 45° writes `/AP` `/Matrix` + expanded `/Rect` + metadata angle **45**; angle 0 omits `/Matrix` and keeps leftover `/Rect`; flatten 45 writes `0.7071` `cm`.

Focused Node `pdfTextboxRotateExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover after this pass
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Rect / Square / Ellipse Rotation flatten + `/AP` — seen, not taken
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
