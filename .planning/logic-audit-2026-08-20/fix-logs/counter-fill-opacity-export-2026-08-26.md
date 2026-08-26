# Counter fill opacity Circle /AP /ca + flatten — 2026-08-26

## Leftover taken

Counter Fill opacity on the live Counter tool. Live toolbar writes Fill as rgba `fill` (`composeColorForPatch` / `handleFillOpacityChange` on Counter colors Fill Opacity). Export Circle `/AP` painted the pin hex-only (and opacity-0 rgba fell back to the stroke as the body), so a faded pin reached Acrobat opaque. Flatten already applied `parsePdfDrawColor` opacity.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from shape rect/ellipse independent `/ca` vs `/CA` (`8a4fb20a`), callout `borderOpacity` Line `/CA` (`8f92a453`), textbox fill `/C` (`2ff769aa`), and callout fillColor `/C` (`d623243d`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| line / arrow stroke opacity | Color Opacity | Export Line `/CA` + flatten shaft already apply rgba — **aligned**. Flatten arrowhead (`drawArrowHead`) still omits opacity — remaining, not this leftover |
| callout `fillOpacity` vs `/ca` | Color Fill Opacity | Flatten already `/ca` 0.4; export still hex-only `/C` (print is not opaque) — **not this leftover** |
| textbox fill rgba | Color Fill Opacity | Flatten already `/ca` 0.4; export `/C` hex-only — **not this leftover** |
| polygon `/IC` | no live polygon tool | **not invented** |
| **counter `fill` opacity** | Counter colors Fill Opacity | **LIVE leftover** — Circle `/AP` painted hex-only |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** open Counter caret (parked 0 on fresh `?testPdf=`). Did **not** touch PDFViewer create-time hex-without-opacity (high-risk; first pin still stamps `fillColor` hex until Fill Opacity patches the series).

## Product

`createCircleAnnotation` counter `/AP` used `fillColor || color` (hex RGB, no ExtGState). A user-picked Fill Opacity (0.4) stayed on-screen after the toolbar patch and never reached Acrobat.

Min-viable:

- `src/utils/pdfAnnotationsPdfLib.js` — counter `/AP`: ExtGState `/ca` = fill alpha on the pin body only; reset before the number; omit body + `/IC` when fill is not visible so opacity-0 rgba does not invent a stroke-colored pin

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay shape fill/stroke, callout borderOpacity, textbox fill, textbox stroke, or callout fill. `/IC` stays the fill hex. Dict `/CA` omitted so the number does not fade.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-counter-fill-opacity-export.spec.mjs` **2 / 2 (9.3s)**.

- Intended: Shapes → Counter + place pin + Counter colors Fill Opacity `40` + Export annotated PDF writes Circle AP `/ca` **0.4**; no dict `/CA` on that Circle; `?testPdf=` reimport keeps fill rgba ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Counter colors **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCounterFillOpacityExport` also proves `/IC` hex + AP `/ca` 0.4, opaque omits `/ca`, opacity-0 omits `/IC`, flatten `/ca` 0.4 and opacity-0 `/ca` 0.

Focused Node `pdfCounterFillOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Line / Arrow stroke opacity export + flatten shaft already apply rgba `/CA` — not a leftover
- Line / Arrow flatten **arrowhead** still omits opacity (`drawArrowHead`) — remaining flatten leftover
- Callout fillOpacity flatten already `/ca`; export still hex-only `/C` (fillOpacity 0 invents `/C`) — remaining export leftover
- Textbox fill rgba flatten already `/ca`; export `/C` hex-only — remaining export leftover
- Counter first-pin create still stamps `fillColor` hex until Fill Opacity patches (PDFViewer, high-risk) — remaining persist leftover
- Shape Fill already writes independent `/ca` vs `/CA` — not a leftover
- Textbox Border already writes `stroke` `/Border` — not a leftover
- Callout fill already writes `fillColor` `/C` — not a leftover
- Callout borderOpacity already writes Line `/CA` — not a leftover
- Pen / highlighter opacity already on ink `/CA` — not a leftover
- Polygon `/IC` without alpha — live toolbar is Counter/rect/ellipse, no polygon tool
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
