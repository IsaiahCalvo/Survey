# Selected-callout Fill swatch independent of Border — 2026-08-26

## Leftover taken

User-selected Callout Color Fill swatch after Border. Live Color Fill / Border already offered 0–100 and persist / export / flatten / page view already honored the 0–1 values independently, and Select chrome already dropped the 0.08 / 0.2 floors (`3f10d86c`), but `selectedPreviewColors` multiplied leftover Border into Fill so a Fill of **90** + Border of **10** painted the Color disc at **9%** until Fill was re-touched. Distinct from leftover-18, selected-callout swatch floor 0.08 / 0.2, callout Fill / Border Opacity screen floors, selected paper-ink Width rebuild, and C-01 swatch / hex / Transparent apply. Field min 0 stayed. Did not invent a floor of 0.08 or 0.2.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / create-path / view clamp / Select chrome leftover after selected paper-ink Width rebuild (`fd29cb7d` / product `57422073`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Selected-callout Fill swatch × leftover Border** | Color Fill after Select | **LIVE leftover** — Fill 90 + Border 10 painted disc **0.09** |
| Selected paper-ink Width baked outline | Width after Select | **aligned** — just landed `57422073` |
| Eraser-cut paper-ink Width | Width after Select | skip is intentional — restroke would restore erased bits |
| Imported outline Width (no centerline) | Width after Select | skip is intentional — no centerline to restroke |
| Style Dotted Ellipse `/AP` | Style | **aligned** — not replayed |
| Font / B / I / size persist | Font chrome | **not live** — richTextEditor edit-only |
| Line `/AP` | Line | **not a leftover** — native Line has no `/AP` |
| leftover-18 human-gated | — | **not taken** |

Live probe before the fix (`/?testPdf=clickable-link-test.pdf`): Callout Fill **90** + Border **10** wrote `fillOpacity` **0.9** / `borderOpacity` **0.1**; Select Color disc `fillSwatchA` **0.09** (leftover 90×10) while Border ring stayed **0.10**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** replay `pdfAnnotationsPdfLib.js` `/AP` writers. Did **not** restroke eraser-cut paper-ink or imported outlines without a centerline.

## Product

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Selected-callout Fill swatch uses `fillOpacityValue` only — no leftover `borderOpacity * fillOpacityValue`

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay paper-ink Width rebuild or export/`/AP` writers.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-toolbar-swatch-fill-independence.spec.mjs` **2 / 2 (15.4s)**.

- Intended: Callout Fill **90** + Border **10** first box writes `fillOpacity` **0.90** + `borderOpacity` **0.10**; Select Color disc stays **0.90** (not leftover **0.09**) and Border ring stays **0.10**
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; mobile Callout keeps Fill disc **0.90**

Node `pdfCalloutToolbarSwatchFillIndependence` proves Fill 90 + Border 10 paints `rgba(..., 0.9)` not leftover `0.09`, missing Fill still 0.4, picker minOpacity 0, isolated 8448 / 75/250 standing.

Focused Node `pdfCalloutToolbarSwatchFillIndependence` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected-callout Fill swatch no longer multiplies leftover Border — not a leftover after this pass
- Selected-callout Color swatch floor 0.08 / 0.2 already aligned — not a leftover
- Selected paper-ink Width rebuild already aligned — not a leftover
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Style Dotted already writes Ellipse `/AP` — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
