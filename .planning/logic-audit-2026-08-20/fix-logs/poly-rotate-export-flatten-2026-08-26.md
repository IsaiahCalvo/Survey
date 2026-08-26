# Imported Polygon / PolyLine Rotation export `/Vertices` + flatten — 2026-08-26

## Leftover taken

Live bbox-edit Rotation already stamped fabric `angle` (mtr / Rotation pill) and SurveyAppAnnotation already kept leftover `points` + angle, and the SVG already rotated about the leftover AABB center, but `polygonWorldPoint` ignored `angle` so `createPolygonAnnotation` / `createPolyLineAnnotation` wrote leftover `/Vertices` and `drawFlattenedPolygon` painted leftover world points. Acrobat / print stayed untilted until Rotation was re-touched. Native Polygon / PolyLine have no rotation `/AP` — bake the tilted world vertices into `/Vertices` and flatten. Angle 0 / absent keep leftover `/Vertices`. Metadata keeps leftover `points` so reimport is not double-rotated. Do not invent a create-poly tool. Did **not** invent Line `/AP` or callout Rotation.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53.

## Why this leftover

Prefer next live leftover after Line / Arrow Rotation export `/L` (`1694b10f` / product `ffb920dd`). Previous hunter probed `polygonWorldPoint` ignores `angle` and left it. Live `/?testPdf=e2e-poly-vertices.pdf` + bbox-edit Rotation writes leftover points + angle 45; export `/Vertices` + flatten now bake the tilt.

| Candidate | Live control | Verdict |
|---|---|---|
| Imported Polygon / PolyLine Rotation 45 `/Vertices` + flatten | bbox-edit Rotation pill | **LIVE leftover** — screen + metadata keep 45 leftover; `/Vertices` + print stayed untilted |
| Line / Arrow Rotation `/L` + flatten | bbox-edit Rotation pill | already landed — not replayed |
| Textbox / Square / Ellipse Rotation `/AP` `/Matrix` | Rotation pill | already landed — not replayed |
| Callout box Rotation | — | **not live** — do not invent |
| Line `/AP` | — | native Line has none — do not invent |
| Counter pin Rotation | — | `lockRotation` — do not invent |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Files

- `src/utils/pdfAnnotationsPdfLib.js` — `leftoverPolygonWorldPoint` + `polygonRotatePivot`; `polygonWorldPoint` rotates leftover world about the AABB center; Polygon / PolyLine `/Vertices` + flatten consume it
- `tests/pdfPolyRotateExportFlatten.test.mjs`
- `debug/scenarios/e2e-poly-rotate-export-flatten.spec.mjs`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a create-poly tool. Print panel stays compile-hidden.

## Product

- `b7f72810` — bake imported Polygon/PolyLine Rotation into `/Vertices` and flatten

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-poly-rotate-export-flatten.spec.mjs` **2 / 2 (7.2s)**.

- Intended: `?testPdf=e2e-poly-vertices.pdf` → Select 4-vertex polygon + bbox-edit Rotation `45` writes leftover points + angle **45**; Export writes Polygon `/Vertices` **not leftover** + SurveyAppAnnotation angle **45** + leftover `points`; `?testPdf=` reimport keeps 45; `file.id` null; viewBox `0 0 612 792`; no Polygon create button
- Break: empty export invents 0 rotated polygons; hubPreview Color **0**
- Edge: 390 keeps viewBox / `file.id` / no invent; no Color (mobile chrome has no Color); no invent

Node `pdfPolyRotateExportFlatten` proves leftover + angle 45 stay on the object; annotated export bakes `/Vertices` off leftover and keeps metadata leftover + 45; angle 0 keeps leftover `/Vertices`; flatten 45 writes rotated coords; PolyLine shares the writer.

Focused Node `pdfPolyRotateExportFlatten` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Imported Polygon / PolyLine Rotation now bakes `/Vertices` + flatten — not a leftover after this pass
- Line / Arrow Rotation now bakes `/L` + flatten — not a leftover
- Ellipse / Circle Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Square / rect Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Textbox faded-fill Rotation now writes `/AP` `/Matrix` + flatten `cm` — not a leftover
- Counter pin Rotation — `lockRotation`; do not invent
- Line `/AP` — native Line has no `/AP`; do not invent
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
