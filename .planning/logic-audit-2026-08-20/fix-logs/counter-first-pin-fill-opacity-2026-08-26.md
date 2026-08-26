# Counter first-pin Fill Opacity persist — 2026-08-26

## Leftover taken

Counter first-pin create on the live Counter tool. Live toolbar writes next-draw Fill as `composeColorForPatch(fillColor, fillOpacity)` (Counter colors Fill Opacity). First-pin auto-create stamped `fillColor` hex, so a faded next-draw never reached persist / reimport / export until the user touched Opacity again (`handleFillOpacityChange` patches existing pins). Distinct from Counter Circle AP `/ca` (`e0657973`), which already fades a pin AFTER that toolbar patch.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from textbox fillOpacity `/ca` (`f31aeb27`), callout fillOpacity `/ca` (`1cbd6f3c`), textbox fill COLOR (`2ff769aa`), callout fill COLOR (`d623243d`), callout `borderOpacity` (`8f92a453`), shape `/ca` vs `/CA` (`8a4fb20a`), and arrowhead flatten opacity (`6b8b2bb3`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + live toolbar after textbox fillOpacity `/ca` (`8cc10480` / product `f31aeb27`):

| Key | Toolbar | Verdict |
|---|---|---|
| textbox fill rgba vs `/C` | Color Fill Opacity | **aligned** — `/C` + AP `/ca` (`f31aeb27`) |
| callout fillOpacity vs `/ca` | Color Fill Opacity | **aligned** (`1cbd6f3c`) |
| line / arrow stroke + flatten arrowhead | Color Opacity | **aligned** (`6b8b2bb3`) |
| polygon `/IC` | no live polygon tool | **not invented** |
| **counter first-pin `fillColor` hex** | Counter colors Fill Opacity | **LIVE leftover** — create-time hex until Opacity patches |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** open Counter caret (parked 0 on fresh `?testPdf=`). No other non-high-risk writer/toolbar leftover remained.

## Product

`src/PDFViewer.jsx` first-pin auto-create (`!seriesId`) assigned `seriesColor = fillColor || '#ef4444'` (hex). Even after Fill Opacity wrote rgba onto `activeCounterSeriesColorRef`, the auto-create overwrite dropped the fade.

Min-viable:

- `src/PDFViewer.jsx` — `seriesColor = composeColorForPatch(fillColor || '#ef4444', fillOpacity)` on first-pin auto-create

HIGH-RISK file: min-viable only. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay textbox fillOpacity, callout fillOpacity, Counter Circle `/ca`, shape `/ca` vs `/CA`, or arrowhead flatten.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-counter-first-pin-fill-opacity.spec.mjs` **2 / 2 (8.2s)**.

- Intended: Shapes → Counter + Counter colors Fill Opacity `40` **before any pin** + place first pin writes rgba fill **0.4** without touching Opacity again; Export annotated PDF writes Circle AP `/ca` **0.4**; no dict `/CA` on that Circle; `?testPdf=` reimport keeps fill rgba ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Counter colors **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCounterFirstPinFillOpacity` proves first-pin source compose, hex-only is opaque 1, first-pin-shaped export AP `/ca` 0.4, opaque omits `/ca`.

Focused Node `pdfCounterFirstPinFillOpacity` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Counter first-pin now composes fillColor + fillOpacity at create — not a leftover
- Textbox fill rgba export already writes `/C` + AP `/ca` — not a leftover
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
