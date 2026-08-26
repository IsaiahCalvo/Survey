# Callout screen-center export `/AP` Tm y — 2026-08-26

Product `0e3c1db8`. Playwright `e2e-callout-valign-export-ap.spec.mjs` **2 / 2 (7.6s)** on reused Vite `http://127.0.0.1:5173`.

Live callout text is always vertically centered on screen (`buildCalloutTextContentStyle` `justifyContent: 'center'`). Color Fill Opacity already attached faded FreeText `/AP`, but the writer passed no `verticalAlign` so Acrobat stayed leftover top until Fill was re-touched opaque (which omits `/AP`). Flatten used leftover top the same way. Shared writer now bakes `verticalAlign: 'middle'` into faded `/AP` Tm y and flatten. Opaque fill still omits `/AP`. Do not invent a user-settable callout `verticalAlign` control (the view ignores leftover `style.verticalAlign`). Do not invent callout Rotation or Line `/AP`.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53.

## Why this leftover

Prefer next live leftover after Textbox underline / strike export `/AP` (`6e086e41` / product `419eaa98`). Rotation bake/`/AP` `/Matrix` family is complete. Probed remaining `/AP` / export / flatten writers against the live toolbar.

| Candidate | Live? | Taken? |
|---|---|---|
| Callout faded `/AP` leftover top vs screen-center | live Color Fill Opacity 40 + always-centered screen | **LIVE leftover** — screen centers; faded `/AP` + flatten stayed leftover top |
| Callout U / S `/AP` decoration | shared writer already fixed | **not taken** |
| Ink `/AP` vs dict `/CA` | already fixed | **not taken** |
| Highlight / Underline / Strike markup restyle | select-delete-only / text-highlight menu hidden | **not live** |
| Note Contents | no create host | **not live** |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent a user-settable callout `verticalAlign` control. Did **not** invent callout Rotation.

## Live proof

- Intended: `?testPdf=clickable-link-test.pdf` → Text → Callout + Color Fill Opacity `40` + `Hi` + br resize tall writes text **Hi** + fill **0.4** + screen `justifyContent` **center**; Export writes FreeText `/AP` Tm y **below leftover top**; `?testPdf=` reimport keeps fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- 390 edge: viewBox / `file.id` / no invent (mobile Callout chrome may be absent)

Node `pdfCalloutValignExportAp` proves faded `/AP` Tm y equals screen-center and sits >20 below leftover top; opaque fill still omits `/AP`; no Line `/AP`; flatten `<4869> Tj` Tm y sits below leftover top.

Focused Node `pdfCalloutValignExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Callout faded `/AP` now bakes screen-center Tm y + flatten — not a leftover after this pass
- Textbox / Callout U / S now bake `/AP` decoration — not a leftover
- Callout leader box-edge now bakes `/L` + flatten — not a leftover
- Imported Polygon / PolyLine Rotation now bakes `/Vertices` + flatten — not a leftover
- Line / Arrow Rotation now bakes `/L` + flatten — not a leftover
- Ellipse / Circle Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Square / rect Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Textbox `Hi 😀` / `✓ Hi` Contents + SurveyAppAnnotation now survive `PDFHexString` load — not a leftover
- `\r` / unpaired `\` / `#` / café / `a) Hi` already survived PDFString — not leftovers
- Line / Callout leader Style dash `/AP` — **confirmed not a leftover** (no `/AP`; native `/BS`)
- Square / Circle Style dash dict `/BS` — **confirmed not a leftover** (reimport keeps dash via `/AP` + metadata)
- Counter pin label `Tm` — **confirmed not a leftover** (GS1 `/ca` + layout already ride live Number styles)
- Highlight / Underline / Strike markup — select-delete-only / text-highlight menu hidden — **not live**
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24
