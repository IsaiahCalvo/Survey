# Textbox wrap export `/AP` — 2026-08-26

## Leftover taken

Faded-fill FreeText `/AP` wrap + SurveyAppAnnotation JSON through `PDFString`. Live editor already stored `\n` / wrapped lines, flatten already used `wrapFlattenedTextLines`, but `attachCalloutFreeTextFillAppearance` painted the whole `Contents` as one `Tj` so Acrobat used the faded `/AP` and stayed a single leftover line until Fill was re-touched opaque (which omits `/AP`). Single-line / absent stay one `Tm` + `Tj`. Opaque fill still omits `/AP`. Reimport then dropped wrap + fade because `PDFString.decodeText` treated JSON `\n` as a PDF newline and `parsePdfAppAnnotationMetadata` returned null. Do not invent a richTextEditor.

**Callout faded-fill `/AP` shares this writer** — callouts already wrap on screen; this pass does **not** invent callout `verticalAlign`. Line / Callout leader dash `/AP` stay confirmed LIVE not leftovers (no `/AP`; native `/BS`). Square / Circle dict `/BS` stays confirmed not a leftover.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Did **not** invent a create-poly / create-ink tool.

## Why this leftover

Prefer next live persist / export / flatten leftover after textbox faded-fill `/AP` verticalAlign (`c16008bb` / product `7e4dbfb5`). Last hunter said nominated FreeText `/AP` fill writers look complete (dash + textAlign + verticalAlign) and remaining `Tm` is the Counter pin label. Probe proved wrap was missed: faded `Hi\nGo` FreeText `/AP` stayed one leftover `Tj` until this pass wrote `wrapFlattenedTextLines` into the `/AP` stream. Counter pin label `Tm` stays faded via GS1 `/ca` — no live Number style is still dropped; not taken.

| Candidate | Live control | Verdict |
|---|---|---|
| Textbox faded-fill `/AP` wrap | Enter wrap + Fill Opacity | **LIVE leftover** — screen + flatten already wrap; `/AP` painted one leftover `Tj` |
| SurveyAppAnnotation JSON through `PDFString` | same wrap reimport | **LIVE leftover** — `decodeText` turned JSON `\n` into a real newline so metadata parse failed |
| Callout faded-fill `/AP` wrap | same writer | **same fix** — callouts already wrap; do not invent `verticalAlign` |
| Counter pin label `Tm` | Number color / opacity / Size | **not a leftover** — GS1 `/ca` + layout already ride live Number styles |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign`.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — faded-fill FreeText `/AP` wraps via `wrapFlattenedTextLines`; per-line `Tm` + `Tj`; `pdfJsonString` escapes `\` so JSON metadata survives `decodeText`
- `tests/pdfTextboxWrapExportAp.test.mjs`
- `debug/scenarios/e2e-textbox-wrap-export-ap.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Product

- `8cf5b8fa` — faded wrap writes `/AP` `Tm` + `Tj` per line
- `a86078b6` — SurveyAppAnnotation / callout / counter / layer JSON survives `PDFString.decodeText`

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-wrap-export-ap.spec.mjs` **2 / 2 (8.5s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → type `Hi` + Enter + `Go` + Color Fill Opacity 40 writes two live lines + fill **0.4**; Export writes FreeText `/AP` two `Tj` (`Hi`, `Go`) and two `Tm` (second y below first); `?testPdf=` reimport keeps wrap + fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 textboxes; hubPreview Text alignment **0**
- Edge: 390 keeps viewBox / `file.id` / wrap; no invent

Node `pdfTextboxWrapExportAp` proves faded `Hi\nGo` writes `/AP` `Tj` **Hi** + **Go** and two `Tm` stepped by **14**; faded single-line `/AP` stays one `Tm` at **62**; opaque wrap omits `/AP`; `decodeText` + `parsePdfAppAnnotationMetadata` keeps `geometry.text` `Hi\nGo` and fill **0.4**.

Focused Node `pdfTextboxWrapExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox faded-fill `/AP` wrap now paints one `Tm` + `Tj` per `wrapFlattenedTextLines` line — not a leftover
- SurveyAppAnnotation JSON `\n` now survives `PDFString.decodeText` — not a leftover
- Callout faded-fill `/AP` wrap shares that writer — not a leftover
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
- Nominated FreeText `/AP` fill writers — dash + textAlign + verticalAlign + wrap
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
