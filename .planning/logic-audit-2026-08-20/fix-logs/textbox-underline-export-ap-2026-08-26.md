# Textbox underline / strike export `/AP` — 2026-08-26

Product `419eaa98`. Playwright `e2e-textbox-underline-export-ap.spec.mjs` **2 / 2 (9.3s)** on reused Vite `http://127.0.0.1:5173`.

Live edit U / S already stamped `underline` / `linethrough` (callout `style.underline` / `style.strikethrough`). Screen, metadata, and flatten already drew the decoration, but `/DA` has no text-decoration operator and `attachCalloutFreeTextFillAppearance` painted glyphs only so Acrobat stayed undecorated until Fill was re-touched opaque (which omitted `/AP`). Shared writer now strokes the same flatten offsets after `ET`. Opaque + no decoration still omit `/AP`. `/DA` cannot carry U / S — opaque + live toggle still attaches `/AP`. Do not invent a richTextEditor. Do not invent callout Rotation or Line /AP.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53.

## Why this leftover

Prefer next live leftover after Callout leader box-edge export `/L` (`b54bcc11` / product `6a370138`). Rotation bake/`/AP` `/Matrix` family is complete. Probed remaining `/AP` / export / flatten writers against the live toolbar.

| Candidate | Live? | Taken? |
|---|---|---|
| Textbox / Callout U / S `/AP` decoration | live edit U / S | **LIVE leftover** — screen + metadata + flatten keep the line; faded `/AP` stayed glyph-only |
| Ink `/AP` vs dict `/CA` | already fixed | **not taken** |
| Highlight / Underline / Strike markup restyle | select-delete-only / text-highlight menu hidden | **not live** |
| Note Contents | no create host | **not live** |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Live proof

- Intended: `?testPdf=clickable-link-test.pdf` → Text → type `Hi` + Underline + Color Fill Opacity `40` writes text **Hi** + underline **true** + fill **0.4**; Export writes FreeText `/AP` decoration after `ET` + SurveyAppAnnotation leftover underline; `?testPdf=` reimport keeps underline + fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- 390 edge: viewBox / `file.id` / no invent (mobile Underline chrome may be absent)

Node `pdfTextboxUnderlineExportAp` proves faded underline `/AP` strokes after `ET`; faded plain `/AP` stays glyph-only; faded strike `/AP` strokes; opaque + U attaches `/AP`; opaque + no decoration still omits `/AP`; metadata keeps leftover underline.

Focused Node `pdfTextboxUnderlineExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Textbox / Callout U / S now bake `/AP` decoration — not a leftover after this pass
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
