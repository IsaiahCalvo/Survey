# Textbox unicode export decode — 2026-08-26

## Leftover taken

`PDFString.of` writes `charCodeAt` as a single PDFDocEncoding byte. Live editor + faded Fill already stamped emoji (`Hi 😀`) / checkmark (`✓ Hi`) and rgba fill, but 😀 injected a NUL and ✓ became `0x13`, so `decodeText` + `JSON.parse` dropped the SurveyAppAnnotation blob and Survey-to-Survey reimport lost text + fade. CJK / € garbled Contents while fade survived. `\r`, unpaired `\`, `#`, and café already survived. Write UTF-16BE via `PDFHexString.fromText` when the escaped PDFString does not round-trip; ASCII `a) Hi` / wrap `\n` stay on the escaped PDFString path. Callout / counter / note / layer JSON share that write. Do not invent a richTextEditor or font embed for `/AP` `Tj`.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53. Did **not** invent a create-poly / create-ink tool.

## Why this leftover

Prefer next live PDF literal / decode leftover after textbox paren export decode (`38059a38` / product `9ef43581`). Probe proved decodeText / JSON metadata still drops a toolbar style when text contains high Unicode.

| Candidate | Live control | Verdict |
|---|---|---|
| Textbox `Hi 😀` + faded Fill reimport | Text + Color Fill Opacity | **LIVE leftover** — screen + flatten keep text + fade; export NUL dropped both |
| Textbox `✓ Hi` + faded Fill reimport | same | **same leftover** — `0x13` invalidates JSON |
| Textbox CJK / € | same | Contents garbled; fade survived — same write |
| Textbox `\r` / unpaired `\` / `#` / café | Text | **not a leftover** — already survived |
| Callout / counter / note high Unicode | same `pdfEncodedString` | **same fix** — do not invent `verticalAlign` |
| Textbox `a) Hi` Contents + JSON | Text | already landed — not replayed |
| Textbox faded Border `/AP` `/CA` | Color Border Opacity | already landed — not replayed |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign`.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — `pdfEncodedString` uses `PDFHexString.fromText` when escaped `PDFString` does not round-trip; Contents + JSON metadata share that write
- `tests/pdfTextboxUnicodeExportDecode.test.mjs`
- `debug/scenarios/e2e-textbox-unicode-export-decode.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Product

- `df1f8ca4` — write high-Unicode Contents / SurveyAppAnnotation via `PDFHexString.fromText` so `Hi 😀` + faded fill survives load

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-unicode-export-decode.spec.mjs` **2 / 2 (8.6s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → insert `Hi 😀` + Color Fill spectrum + Opacity 40 writes text **Hi 😀** + fill **0.4**; Export writes hex Contents **Hi 😀** + SurveyAppAnnotation `geometry.text` + faded `backgroundColor`; `?testPdf=` reimport keeps text + fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 textboxes; hubPreview Color **0**
- Edge: 390 keeps viewBox / `file.id` / text; no invent

Node `pdfTextboxUnicodeExportDecode` proves `Hi 😀` + fill **0.4** survives `PDFDocument.load` as hex Contents + `geometry.text` + faded `backgroundColor`; `✓ Hi`, `中文`, `€100`, and ASCII `a) Hi` still survive.

Focused Node `pdfTextboxUnicodeExportDecode` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox `Hi 😀` / `✓ Hi` Contents + SurveyAppAnnotation now survive `PDFHexString` load — not a leftover after this pass
- Callout / counter / note / layer JSON share `pdfEncodedString` — same fix
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
- Nominated FreeText `/AP` fill writers — dash + textAlign + verticalAlign + wrap + Border `/CA`
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
