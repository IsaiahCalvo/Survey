# Textbox fillOpacity FreeText /C + /AP /ca — 2026-08-26

## Leftover taken

Textbox Fill Opacity on the live Text tool. Live toolbar writes Fill as `backgroundColor` rgba from `composeColorForPatch` (Color Fill Opacity). Export wrote hex-only `/C`, so a faded fill reached Acrobat opaque. Flatten already applied `parsePdfDrawColor` / `/ca`. `/AP /ca` was gated on `calloutMetadataJson`.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from textbox fill COLOR `/C` (`2ff769aa`), callout fillOpacity `/ca` (`1cbd6f3c`), callout fill COLOR `/C` (`d623243d`), callout `borderOpacity` Line `/CA` (`8f92a453`), shape `/ca` vs `/CA` (`8a4fb20a`), Counter fill `/ca` (`e0657973`), and arrowhead flatten opacity (`6b8b2bb3`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| **textbox fill rgba vs `/C`** | Color Fill Opacity | **LIVE leftover** — flatten already `/ca`; export hex-only `/C` (`/AP` gated on callout) |
| counter first-pin `fillColor` hex | Counter colors | PDFViewer create-time hex until Fill Opacity patches — high-risk, not taken |
| polygon `/IC` | no live polygon tool | **not invented** |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** touch PDFViewer.

## Product

`createFreeTextAnnotation` already resolved `backgroundColor` via `resolveTextboxBoxFill` and omitted `/C` when `visible:false`, but ExtGState `/ca` on `/AP` ran only when `options.calloutMetadataJson` was set. A faded textbox still exported opaque `/C`.

Min-viable:

- `src/utils/pdfAnnotationsPdfLib.js` — attach FreeText fill `/AP /ca` whenever `boxFill.visible && boxFill.opacity < 0.99999` (not only callouts); `/C` stays the fill hex; opaque omits `/AP`
- `src/utils/annotationStyleCatalog.js` — comment: faded rgba rides `/AP /ca`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay textbox fill COLOR, callout fillOpacity, textbox stroke, callout borderOpacity, shape `/ca` vs `/CA`, Counter fill, or arrowhead flatten. Counter first-pin create-time hex stays for the next hunter.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-fill-opacity-export.spec.mjs` **2 / 2 (8.9s)**.

- Intended: Text + type `Y` + Color Fill spectrum + Opacity `40` + Export annotated PDF writes FreeText AP `/ca` **0.4**; `/C` stays the fill hex; `?testPdf=` reimport keeps rgba fillOpacity ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFillOpacityExport` also proves `/C` hex + AP `/ca` 0.4, opaque omits `/ca`, opacity-0 omits `/C`, flatten `/ca` 0.4.

Focused Node `pdfTextboxFillOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox fill rgba export now writes `/C` + AP `/ca`; opacity-0 omits `/C` — not a leftover
- Counter first-pin create still stamps `fillColor` hex until Fill Opacity patches (PDFViewer, high-risk) — remaining persist leftover
- Callout fillOpacity export already writes `/C` + AP `/ca` — not a leftover
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
