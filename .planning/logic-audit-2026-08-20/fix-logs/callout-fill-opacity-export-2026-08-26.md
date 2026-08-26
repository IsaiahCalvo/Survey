# Callout fillOpacity FreeText /C + /AP /ca — 2026-08-26

## Leftover taken

Callout Fill Opacity on the live Callout tool. Live toolbar writes Fill as `style.fillColor` + `style.fillOpacity` (Color Fill Opacity). Export passed `resolveCalloutBoxFill(style).hex`, so fillOpacity 0 invented `/C` and a faded fill reached Acrobat opaque. Flatten already applied `parsePdfDrawColor` / `/ca`.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from callout fill COLOR `/C` (`d623243d`), textbox fill `/C` (`2ff769aa`), callout `borderOpacity` Line `/CA` (`8f92a453`), shape `/ca` vs `/CA` (`8a4fb20a`), Counter fill `/ca` (`e0657973`), and arrowhead flatten opacity (`6b8b2bb3`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| **callout `fillOpacity` vs `/C`** | Color Fill Opacity | **LIVE leftover** — flatten already `/ca`; export hex-only `/C` (fillOpacity 0 invents `/C`) |
| textbox fill rgba | Color Fill Opacity | Flatten already `/ca`; export `/C` hex-only — remaining, not this leftover |
| counter first-pin `fillColor` hex | Counter colors | PDFViewer create-time hex until Fill Opacity patches — high-risk, not taken |
| polygon `/IC` | no live polygon tool | **not invented** |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** touch PDFViewer.

## Product

`createCalloutAnnotations` passed `.hex` into FreeText `/C`. `resolveCalloutBoxFill` still carries a hex when `visible:false` (fillOpacity 0), so `resolveTextboxBoxFill` treated it as opaque. Faded fills lost alpha.

Min-viable:

- `src/utils/pdfAnnotationsPdfLib.js` — pass `boxFill.paint` (or `transparent` when not visible); faded callout FreeText writes ExtGState `/ca` on `/AP`; `/C` stays the fill hex; opaque omits `/AP`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay callout fill COLOR, textbox fill, textbox stroke, callout borderOpacity, shape `/ca` vs `/CA`, Counter fill, or arrowhead flatten. Textbox fill rgba export stays hex-only `/C` for the next hunter.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-fill-opacity-export.spec.mjs` **2 / 2 (9.2s)**.

- Intended: Text → Callout + Color Fill Opacity `40` + type `Y` + Export annotated PDF writes FreeText AP `/ca` **0.4**; `/C` stays the fill hex; `?testPdf=` reimport keeps `fillOpacity` ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCalloutFillOpacityExport` also proves `/C` hex + AP `/ca` 0.4, opaque omits `/ca`, fillOpacity 0 omits `/C`, flatten `/ca` 0.4.

Focused Node `pdfCalloutFillOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout fillOpacity export now writes `/C` + AP `/ca`; fillOpacity 0 omits `/C` — not a leftover
- Textbox fill rgba flatten already `/ca`; export `/C` hex-only — remaining export leftover
- Counter first-pin create still stamps `fillColor` hex until Fill Opacity patches (PDFViewer, high-risk) — remaining persist leftover
- Line / Arrow flatten arrowhead now applies rgba `/CA` — not a leftover
- Line / Arrow export `/CA` already apply rgba — not a leftover
- Shape Fill already writes independent `/ca` vs `/CA` — not a leftover
- Textbox Border already writes `stroke` `/Border` — not a leftover
- Callout fill already writes `fillColor` `/C` — not a leftover
- Callout borderOpacity already writes Line `/CA` — not a leftover
- Counter Fill already writes Circle AP `/ca` — not a leftover
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
