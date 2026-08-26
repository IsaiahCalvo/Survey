# Textbox verticalAlign export/reimport — 2026-08-26

## Leftover taken

Textbox `verticalAlign` (middle/bottom) dropped on annotated PDF export/reimport and print flatten. Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js:124` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx:340` `Math.abs(localOpacity - matchOpacityPct) <= 1`) — **already fixed**.
P1-53 (`syncStatusViewModel.js:41-48` `pending` before queue-offline) — **already fixed**.

## Product

`STYLE_KEYS` already listed `textAlign`. `verticalAlign` was the one-sided gap, so `buildPdfAppAnnotationMetadata` / `applyPdfAppAnnotationMetadata` stripped middle/bottom on the SurveyAppAnnotation blob. Callouts were unaffected (they serialize the whole `style` object). Print flatten always used `top + min(height, fontSize+2)`.

Min-viable:

- `src/utils/pdfAppAnnotationMetadata.js` — add `'verticalAlign'` next to `'textAlign'`
- `src/utils/annotationStyleCatalog.js` — `flattenedTextBlockOffset`
- `src/utils/pdfAnnotationsPdfLib.js` — honor that offset in `drawFlattenedText`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-vertical-align-export.spec.mjs` **2 / 2 (10.6s)**.

- Intended: tall Text + `bottom left` + Export annotated PDF → `?testPdf=_e2e-textbox-vertical-align-export.pdf` keeps `verticalAlign` **bottom**; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; dismiss align without a cell keeps **top**; hubPreview Text alignment **0**
- Edge: 390 viewBox / `file.id` / no invent (mobile Text alignment applied when live)

Focused Node `pdfTextVerticalAlignExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null
- Subscription Manage / Usage tabs
- Create bookmark group / Add bookmarks to group dialog internals (exhausted)
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
