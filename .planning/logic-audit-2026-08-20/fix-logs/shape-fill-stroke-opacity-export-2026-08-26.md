# Shape independent fill /ca vs stroke /CA + flatten — 2026-08-26

## Leftover taken

Shape Fill vs Border opacity on live rectangle/ellipse. Live toolbar writes independent rgba (`fill` / `stroke` via `composeAnnotationColor`). Export Square/Circle wrote `/C`+`/IC` from hex only and a single dict `/CA` cannot represent both, so a faded fill printed and exported opaque (or a shared `/CA` faded the border too). Default unfilled rects store `rgba(..., 0)` which is not the string `transparent`, so `/IC` used to invent an opaque white fill.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from callout `borderOpacity` export (`8f92a453`), textbox `stroke` export (`99a07184`), textbox `backgroundColor` export (`2ff769aa`), and callout `fillColor` export (`d623243d`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| callout `borderOpacity` | Color Border Opacity | Already Line `/CA` + flatten (`8f92a453`) — not replayed |
| textbox `stroke` / `strokeWidth` | Color Border + Width | Already `/Border` + flatten (`99a07184`) — not replayed |
| textbox `backgroundColor` | Color Fill tab | Already `/C` + flatten (`2ff769aa`) — not replayed |
| callout `fillColor` / `fillOpacity` | Color Fill tab | Already `/C` + flatten (`d623243d`) — not replayed |
| callout Stroke / Width | Color Border + Size | Toolbar maps to `borderColor` / `lineThickness` — **aligned** |
| pen / highlighter opacity | Color Opacity | Ink writers already `paintAlpha` + `/CA` — **aligned** |
| **shape `fill` vs `stroke` opacity** | Color Fill / Border Opacity | **LIVE leftover** — one `/CA` cannot represent both |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`.

## Product

`createSquareAnnotation` / `createCircleAnnotation` / rotated `createEllipseAnnotation` used hex-only `/C`+`/IC`. A user-picked Fill Opacity (0.4) with Border 100 stayed on-screen and never reached Acrobat or print as independent alphas.

Min-viable:

- `src/utils/annotationStyleCatalog.js` — `resolveShapeFill` / `resolveShapeStroke` (live rgba `fill` / `stroke`)
- `src/utils/pdfAnnotationsPdfLib.js` — `attachIndependentShapeAppearance`: ExtGState `/ca` = fill alpha, `/CA` = stroke alpha; dict `/CA` only for stroke-only fade; omit `/IC` when fill is not visible; flatten uses the same resolvers so opacity-0 rgba does not invent an opaque box

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay callout borderOpacity, textbox fill, textbox stroke, or callout fill. `/C` stays the stroke hex. `/IC` stays the fill hex.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-shape-fill-stroke-opacity-export.spec.mjs` **2 / 2 (8.0s)**.

- Intended: Shapes → Rectangle + Color Fill Opacity `40` + Export annotated PDF writes Square AP `/ca` **0.4**; no shared dict `/CA` on that Square; `?testPdf=` reimport keeps fill rgba ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfShapeFillStrokeOpacityExport` also proves red fill `/IC` + blue stroke `/C`, divergent AP `/ca` 0.4 vs `/CA` 0.2, stroke-only dict `/CA`, opacity-0 fill omits `/IC` and does not invent opaque red on flatten.

Focused Node `pdfShapeFillStrokeOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout Stroke / Width already maps `strokeColor` → `borderColor` / `lineThickness` — not a leftover
- Shape Fill already writes `fill` — not a leftover (opacity now independent)
- Textbox Fill already writes `backgroundColor` `/C` — not a leftover
- Textbox Border already writes `stroke` `/Border` — not a leftover
- Callout fill already writes `fillColor` `/C` — not a leftover
- Callout borderOpacity already writes Line `/CA` — not a leftover
- Pen / highlighter opacity already on ink `/CA` — not a leftover
- Polygon `/IC` without alpha is similar but live toolbar is rect/ellipse — not this leftover
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
