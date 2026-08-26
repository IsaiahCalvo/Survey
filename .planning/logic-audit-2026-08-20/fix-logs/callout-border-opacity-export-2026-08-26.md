# Callout borderOpacity Line /CA + flatten — 2026-08-26

## Leftover taken

Callout Color Border Opacity (`style.borderOpacity`) dropped on print flatten and export Line / FreeText pieces omitted `/CA`. Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from callout `fillColor` export (`d623243d`), textbox `backgroundColor` export (`2ff769aa`), textbox `stroke` export (`99a07184`), textbox `textAlign` export (`29bce7bb`), and textbox `verticalAlign` export (`c226548a`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + `pdfAppAnnotationMetadata.js` `STYLE_KEYS` against live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| textbox `backgroundColor` | Color Fill tab | Already `/C` + flatten (`2ff769aa`) — not replayed |
| callout `fillColor` / `fillOpacity` | Color Fill tab | Already `/C` + flatten (`d623243d`) — not replayed |
| textbox `stroke` / `strokeWidth` | Color Border + Width | Already `/Border` + flatten (`99a07184`) — not replayed |
| callout Stroke / Width | Color Border + Size | Toolbar maps to `borderColor` / `lineThickness`; writers read those — **aligned** |
| shape `fill` | Color Fill tab | Writers already read `fabricObj.fill` — aligned |
| pen / highlighter opacity | Color Opacity | Ink writers already `paintAlpha` + `/CA` / ExtGState — **aligned** |
| **callout `borderOpacity`** | Color Border Opacity | **LIVE leftover** — flatten stroked hex at opacity 1; export omitted Line `/CA` |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** take shape `/CA` (fill vs stroke opacities are independent; a single `/CA` cannot represent both).

## Product

`createCalloutAnnotations` / `drawFlattenedCallout` used `style.borderColor` hex only. A user-picked Opacity (0.4) stayed on-screen via SVG `<g opacity>` and never reached Acrobat or print.

Min-viable:

- `src/utils/annotationStyleCatalog.js` — `resolveCalloutBorder` (live `borderColor` + `borderOpacity`; `lineColor` leftover)
- `src/utils/pdfAnnotationsPdfLib.js` — Line `/CA` when fade < 1; FreeText `/CA` matches SVG group opacity; flatten paints rgba / ExtGState `/ca`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay textbox fill, textbox stroke, callout fill, `textAlign`, or `verticalAlign`. `/C` stays the stroke hex.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-border-opacity-export.spec.mjs` **2 / 2 (9.2s)**.

- Intended: Callout + Color Border Opacity `40` + type `Y` + Export annotated PDF writes survey-callout Line `/CA` **0.4** from live `borderOpacity`; FreeText `/CA` 0.4; `?testPdf=` reimport keeps `borderOpacity`; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCalloutBorderOpacityExport` also proves red `#FF0000` Line `/CA` 0.4, opaque omits `/CA`, leftover `lineColor` still fades, flatten ExtGState `/ca` 0.4 vs no invented fade.

Focused Node `pdfCalloutBorderOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout Stroke / Width already maps `strokeColor` → `borderColor` / `lineThickness` — not a leftover
- Shape Fill already writes `fill` — not a leftover
- Textbox Fill already writes `backgroundColor` `/C` — not a leftover
- Textbox Border already writes `stroke` `/Border` — not a leftover
- Callout fill already writes `fillColor` `/C` — not a leftover
- Pen / highlighter opacity already on ink `/CA` — not a leftover
- Shape fill-vs-stroke independent `/CA` — single annotation `/CA` cannot represent both (not taken)
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null
- Subscription Manage / Usage tabs
- Spaces expand / delete (Create space)
- Survey item Notes (needs a placed marker)
- C-01 swatch / hex / Transparent apply; Send viewer invite apply
- Font color / Bold / Italic (0 without richTextEditor)
- Highlighter caret compile-hidden; Counter caret 0
- Pages unnamed cards (tab-as-switcher)
- Idle editor unnamed text+checkbox (Forms / X-05 host-proved)
- Activity Close (A-06); Manage Team role trigger 0; History Version history trigger 0
- Desktop archived Permanently delete; dirty Cancel / Save
- Module-tab rename; ResetPassword success Back to Survey
- Hub Search `⌘K` (display-only; classified 2026-08-22)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.
