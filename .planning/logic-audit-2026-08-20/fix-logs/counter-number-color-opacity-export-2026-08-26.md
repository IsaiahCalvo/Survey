# Counter Number color opacity Circle /AP GS1 /ca — 2026-08-26

## Leftover taken

Counter Number color opacity on the live Counter tool. Live toolbar writes Number as rgba `data.numberColor` (`composeColorForPatch` / `handleStrokeOpacityChange` on Counter colors Number Opacity). Flatten already applied `parsePdfDrawColor` opacity. Export Circle `/AP` painted the label hex-only after the Fill `/ca` reset, so a faded Number reached Acrobat opaque.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from Counter Fill Circle AP `/ca` (`e0657973`), Counter first-pin fillOpacity persist (`66dff649`), textbox first-create Style dash (`45acb83d`), and leftover-18.

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after textbox first-create Style dash (`bc16ca02` / product `45acb83d`):

| Key | Toolbar | Verdict |
|---|---|---|
| partial erase first-swipe Size / Type | Eraser Size / Type | **aligned** — `eraserSizeRef.current` at pointer-down; Type already dedicated |
| textbox first-create fontFamily | Font | **parked** — 0 without `richTextEditor` (no live Font picker outside that editor) |
| textbox first-create Fill | Color Fill | **intentional empty** until Color Fill patches |
| callout / shape / pen / highlighter first-create | Color / Width / Style / Opacity | **aligned** |
| **counter `numberColor` opacity** | Counter colors Number Opacity | **LIVE leftover** — Circle `/AP` painted the label hex-only |

Did **not** invent envelope extras. Did **not** take C-01 (Number spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** open Counter caret (parked 0 on fresh `?testPdf=`). Did **not** invent a Font picker / richTextEditor. Did **not** invent first-create Fill on an empty-default textbox.

## Product

`createCircleAnnotation` counter `/AP` used `hexToRGB(data.numberColor)` (RGB only, no ExtGState) after resetting Fill `/ca`. A user-picked Number Opacity (0.4) stayed on-screen after the toolbar patch and never reached Acrobat.

Min-viable:

- `src/utils/annotationStyleCatalog.js` — `resolveCounterNumberColor`
- `src/utils/pdfAnnotationsPdfLib.js` — counter `/AP`: ExtGState `GS1` `/ca` = number alpha after the Fill `/ca` reset; opaque Number omits `GS1`; opacity-0 writes `/ca` 0

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Counter Fill `/ca`, first-pin fillOpacity, or textbox first-create Style. Dict `/CA` omitted so the pin body does not share stroke alpha with the number.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-counter-number-color-opacity-export.spec.mjs` **2 / 2 (8.2s)**.

- Intended: Shapes → Counter + place pin + Counter colors Number Opacity `40` + Export annotated PDF writes Circle AP GS1 `/ca` **0.4**; no dict `/CA` on that Circle; `?testPdf=` reimport keeps numberColor rgba ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Counter colors **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCounterNumberColorOpacityExport` proves `resolveCounterNumberColor` rgba 0.4, export GS1 `/ca` 0.4, opaque omits GS1, opacity-0 GS1 `/ca` 0, flatten `/ca` 0.4 and opacity-0 `/ca` 0.

Focused Node `pdfCounterNumberColorOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent. CreateGoal tool unavailable — no goal armed.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Counter Number color opacity export now writes GS1 `/ca` — not a leftover
- Counter first-pin now composes fillColor + fillOpacity at create — not a leftover
- Counter Fill already writes Circle AP `/ca` — not a leftover
- Textbox first-create now stamps next-draw Style — not a leftover
- Textbox first-create now stamps next-draw Color Border Opacity — not a leftover
- Textbox first-create now stamps next-draw Color Border — not a leftover
- Textbox first-create Width already stamps strokeWidth — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches — do not invent a fill
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width — not a leftover
- Pen / highlighter first-stroke Width + opacity already aligned — not a leftover
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
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
