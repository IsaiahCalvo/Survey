# Textbox first-create Color Fill persist — 2026-08-26

## Leftover taken

User-set Text Color Fill on first-create. Live toolbar writes Fill as `fillColor` / `fillOpacity` and selected-patch already writes `backgroundColor`, but first-create used envelope `backgroundColor: ''` so a next-draw Fill never reached persist / export / reimport until Fill was touched again. Empty-default `fillOpacity` 0 stays `''` — did not invent a first-create Fill on an empty-default textbox. Distinct from leftover-18, Text Fill after sibling (`63792671`), textbox first-create Width / Color Border / Border Opacity / Style, Eraser Size persist (`53d63a7c`), and textbox fillOpacity `/C` of an already-patched box.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export / flatten bug after Eraser Size persist (`f5a851fc` / product `53d63a7c`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Text first-create Fill** | Color Fill | **LIVE leftover** — user-set Fill dropped to envelope empty until Fill was re-touched |
| Empty-default Text Fill | Color Fill | **intentional empty** — opacity 0 still stamps `''` |
| Ellipse Cloud Bump | Bump | **no Cloud chrome** — Style Cloud + Bump are Rect-only |
| Eraser Size persist | Size (Eraser) | **aligned** — just landed (`53d63a7c`) |
| Width / Opacity / Color / Style / Arrowhead / Fill sibling pairs | Width / Opacity / Color / Style / Arrowhead / Fill | **aligned** |
| Line Fill after Rect | Color | **no Fill chrome** on Line / Arrow / Pen |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |
| Highlighter caret / text-highlight | Draw caret | compile-hidden caret 0 — not taken |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill on empty default. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent Cloud/Bump on Ellipse.

## Product

`src/utils/textEditCommit.js`:

- `boxFillFromToolbar(fillColor, fillOpacity)` composes rgba when opacity > 0; empty / transparent / opacity 0 stays `''`
- `buildNewTextCommitJSON` stamps `backgroundColor` from that compose

`src/components/TextEditOverlay.jsx`:

- First-create style + commit prefer live Fill over envelope empty
- Overlay exposes `data-first-create-fill*` for live proof

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Passes `fillColor` / `fillOpacity` into TextEditOverlay (2 lines)

`src/utils/annotationStyleCatalog.js`:

- `resolveTextboxBoxFill` comment now names first-create Fill

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Eraser Size / Cloud Bump / Text Fill after sibling.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-first-create-fill.spec.mjs` **2 / 2 (9.5s)**.

- Intended: Text + Color Fill Opacity **40** **before any box** + first box writes `backgroundColor` rgba **0.4** and FreeText `/C`; reimport keeps Fill 0.4
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFirstCreateFill` proves overlay + PDFViewer pass Fill, `boxFillFromToolbar` stamps user-set and keeps empty default, first-create commit keeps rgba 0.4, export writes `/C` only when Fill is set.

Focused Node `pdfTextboxFirstCreateFill` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` run after HIGH-RISK `PDFViewer.jsx` (2-line prop pass). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox first-create now stamps next-draw Color Fill when the user set it — not a leftover
- Textbox first-create empty background is still intentional when Fill stays 0
- Eraser Size now persists per tool after remount — not a leftover
- Cloud Bump now persists per tool after remount — not a leftover
- Ellipse has no Cloud / Bump chrome — not a leftover
- Filled paper-ink flatten now fills the blob at live Opacity — not a leftover
- Session-shared Text Fill chrome now resets empty after Callout / Counter — not a leftover
- Session-shared Arrowhead now resets per tool after Callout / Arrow — not a leftover
- Session-shared Style dash now resets per tool after Callout / Rect — not a leftover
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Width after remaining pairs (Pen ↔ Highlighter, Line ↔ Arrow, Text ↔ Callout) — confirmed aligned
- Opacity / Color hue / Eraser type sibling pairs — confirmed aligned
- Callout / Rect / Counter Fill after sibling — confirmed aligned (defaults present)
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle / arrowheadStyle / fill — not a leftover
- Rect / ellipse / line / arrow first-draw already stamp dash + Width + fill — not a leftover
- Pen / highlighter first-stroke Width + opacity already aligned — not a leftover
- Highlighter first-stroke Width still clamps `Math.max(strokeWidth, 8)` — only shows if Width is set below 8
- Partial erase first-swipe Size / Type already aligned — not a leftover
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
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
