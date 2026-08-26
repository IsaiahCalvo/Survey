# Arrow flatten Arrowhead style — 2026-08-26

Product `aa0b87ef`. Playwright `e2e-arrow-head-flatten-style.spec.mjs` **2 / 2 (7.2s)** on reused Vite `http://127.0.0.1:5173`.

Live Arrowhead already stamped `data.arrowheadStyle` and the SVG / canvas surfaces already painted the 6-style spec (`buildArrowheadRenderSpec`). Export `/LE` already mapped Open circle → Circle. Print flatten used leftover `drawArrowHead` (two-line V) for every Arrow, so Open circle / None / Solid triangle / Horizontal line printed as that leftover chevron until Arrowhead was re-touched. Shared flatten now uses the same spec + shaft shorten callout flatten already uses. Plain Line stays headless. Native Line has no `/AP` — do not invent.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53.

## Why this leftover

Prefer next live leftover after Callout screen-center export `/AP` Tm y (`0548312d` / product `0e3c1db8`). Font / B / I / size already land in FreeText `/DA` + faded `/AP` (`Times-BoldItalic` 24 Tf). Probed remaining `/AP` / export / flatten writers against the live toolbar.

| Candidate | Live? | Taken? |
|---|---|---|
| Arrow flatten leftover two-line V vs live Arrowhead | live Arrowhead Open circle / None / Solid triangle | **LIVE leftover** — screen + `/LE` keep the style; flatten printed a leftover V |
| Faded FreeText Font / B / I / size `/AP` | live first-create strip | **already aligned** — `/DA` + `/F1 24 Tf` |
| TEXT_PADDING 6 vs `/AP` textPad 4 | view gutter, not a toolbar style; wrap leftover locked 4pt | **not taken** |
| Font persist / remount / next-draw | Font chrome is edit-only; do not invent a richTextEditor | **not taken** |
| Callout U / S `/AP` decoration | shared writer already fixed | **not taken** |
| Highlight / Underline / Strike markup restyle | select-delete-only / text-highlight menu hidden | **not live** |
| Note Contents | no create host | **not live** |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent a user-settable callout `verticalAlign` control. Did **not** invent callout Rotation.

## Live proof

- Intended: `?testPdf=clickable-link-test.pdf` → Shapes → Arrow + Arrowhead `Open circle` writes `arrowheadStyle` **openCircle** + SVG circle; Export writes Line `/LE` **Circle**; `?testPdf=` reimport keeps Open circle; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- 390 edge: viewBox / `file.id` / no invent (mobile Arrow chrome may be absent)

Node `pdfArrowHeadFlattenStyle` proves flatten Open circle paints bezier arcs (not leftover two-line V); None omits a head; Solid triangle fills; plain Line stays headless; export `/LE` Circle / None.

Focused Node `pdfArrowHeadFlattenStyle` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Arrow flatten now bakes the live 6-style Arrowhead spec — not a leftover after this pass
- Arrow flatten opacity still dedicated (shaft + filled head `/CA` / `/ca`)
- Callout faded `/AP` now bakes screen-center Tm y + flatten — not a leftover
- Textbox / Callout U / S now bake `/AP` decoration — not a leftover
- Callout leader box-edge now bakes `/L` + flatten — not a leftover
- Imported Polygon / PolyLine Rotation now bakes `/Vertices` + flatten — not a leftover
- Line / Arrow Rotation now bakes `/L` + flatten — not a leftover
- Ellipse / Circle Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Square / rect Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Textbox `Hi 😀` / `✓ Hi` Contents + SurveyAppAnnotation now survive `PDFHexString` load — not a leftover
- `\r` / unpaired `\` / `#` / café / `a) Hi` already survived PDFString — not leftovers
- Font / B / I / size already land in FreeText `/DA` + faded `/AP` — not a leftover
- Line / Callout leader Style dash `/AP` — **confirmed not a leftover** (no `/AP`; native `/BS`)
- Square / Circle Style dash dict `/BS` — **confirmed not a leftover** (reimport keeps dash via `/AP` + metadata)
- Highlight / Underline / Strike markup — select-delete-only / text-highlight menu hidden — **not live**
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24
