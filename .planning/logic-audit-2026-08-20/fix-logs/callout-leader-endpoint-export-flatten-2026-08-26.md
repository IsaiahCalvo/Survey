# Callout leader box-edge export `/L` + flatten — 2026-08-26

## Leftover taken

Live Callout already routed line1 from the textbox EDGE nearest the knee (`calculateCalloutConnection` / `renderCallout`) and SurveyAppCallout already kept leftover knee + box, but `createCalloutAnnotations` / `drawFlattenedCallout` hardcoded `textBox.left` + mid-height so Acrobat / print stayed attached to the leftover left-middle until the knee was re-touched. Shared writer now uses `calculateCalloutConnection`. Metadata keeps leftover knee / box so reimport is not double-routed. Do not invent Line `/AP` or callout Rotation.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53.

## Why this leftover

Prefer next live leftover after imported Polygon / PolyLine Rotation export `/Vertices` (`ce40872f` / product `b7f72810`). Rotation bake/`/AP` `/Matrix` family is complete. Probed remaining `/AP` / export / flatten writers against the live toolbar.

| Candidate | Live control | Verdict |
|---|---|---|
| Callout leader box-edge `/L` + flatten | knee / box handles | **LIVE leftover** — screen + metadata keep edge attach; `/L` + print stayed leftover left-middle |
| Ink `/AP` vs dict `/CA` | selected imported Ink Color Opacity | already landed — not replayed |
| Highlight / Underline / StrikeOut restyle | — | select-delete-only; no live Style / Color / Opacity / Width toolbar |
| Note Contents | — | no live Note create / edit host — do not invent |
| Line / Arrow Rotation `/L` | bbox-edit Rotation pill | already landed — not replayed |
| Textbox / Square / Ellipse Rotation `/AP` `/Matrix` | Rotation pill | already landed — not replayed |
| Callout box Rotation | — | **not live** — do not invent |
| Line `/AP` | — | native Line has none — do not invent |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — `resolveCalloutLeaderWorld` via `calculateCalloutConnection`; export `/L` + flatten consume live `line1Start` / `effectiveKnee` / `line2Start`
- `tests/pdfCalloutLeaderEndpointExport.test.mjs`
- `debug/scenarios/e2e-callout-leader-endpoint-export.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent Line `/AP` or callout Rotation. Print panel stays compile-hidden.

## Product

- `6a370138` — bake callout leader `/L` + flatten from the live box-edge attach

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-leader-endpoint-export.spec.mjs` **2 / 2 (7.9s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → Callout `Y` + Select + knee drag past the box right writes screen line1 x1 on the **right edge**; Export writes Line `/L` **not leftover left-middle** + SurveyAppCallout leftover knee / box; `?testPdf=` reimport keeps right-edge attach; `file.id` null; viewBox `0 0 612 792`; no Line `/AP`
- Break: empty export invents 0 callouts; hubPreview Color **0**
- Edge: 390 keeps viewBox / `file.id` / no invent; Color **0**; no invent

Node `pdfCalloutLeaderEndpointExport` proves knee-right `/L` starts on the right edge; knee-left `/L` uses leftover left edge at the knee y (not leftover mid-height); flatten paints the live right-edge attach; metadata keeps leftover knee / box.

Focused Node `pdfCalloutLeaderEndpointExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout leader box-edge now bakes `/L` + flatten — not a leftover after this pass
- Imported Polygon / PolyLine Rotation now bakes `/Vertices` + flatten — not a leftover
- Line / Arrow Rotation now bakes `/L` + flatten — not a leftover
- Ellipse / Circle Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Square / rect Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Counter pin Rotation — `lockRotation`; do not invent
- Line `/AP` — native Line has no `/AP`; do not invent
- Highlight / Underline / StrikeOut — select-delete-only; no live restyle toolbar
- Note Contents — no live Note create / edit host
- Textbox `Hi 😀` / `✓ Hi` Contents + SurveyAppAnnotation now survive `PDFHexString` load — not a leftover
- `\r` / unpaired `\` / `#` / café / `a) Hi` already survived PDFString — not leftovers
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
