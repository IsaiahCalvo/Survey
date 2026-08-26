# Filled paper-ink flatten fill — 2026-08-26

## Leftover taken

Print flatten of Pen / Highlighter filled paper-ink. Live toolbar writes Color Opacity as rgba `fill` (`stroke: 'transparent'`, `strokeWidth: 0`). Export Ink `/CA` + AP `/ca` already faded the blob. Flatten `drawFlattenedObject` path branch stroked the outline hex-only: transparent stroke fell back to black and `strokeWidth` 0 became 1 (`0 || 1`). Highlighter 40% yellow printed as an opaque 1pt black stroke. Distinct from leftover-18, pen first-stroke opacity (`87173d9d`), highlighter `highlightColor` compose, and arrowhead flatten `/CA` (`6b8b2bb3`).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export / flatten bug after session-shared Text Fill (`57062466` / product `63792671`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Highlighter flatten fill** | Color Opacity (print flatten) | **LIVE leftover** — flatten stroked black 1pt; export `/CA` 0.4 already aligned |
| Pen flatten fill | Color Opacity (print flatten) | same path — `isFilledPaperInk` |
| Callout Fill after Text | Color Fill | **aligned** — last leftover already asserts Callout keeps white / 90 |
| Rect Fill after Callout | Color Fill | **aligned** — Rect defaults include `fillOpacity: 0` |
| Line Fill after Rect | Color | **no Fill chrome** on Line / Arrow / Pen |
| Highlighter color after Pen | Color | **aligned** — both have `strokeColor` |
| Counter Number after Shapes | Number | **aligned** — Counter has `strokeColor` |
| Width / Opacity / Style / Arrowhead sibling pairs | Width / Opacity / Style / Arrowhead | **aligned** — last hunter + Text Fill receipt |
| Cloud Bump persist | Bump | session-only; Style Cloud restores; Bump not in prefs — **not taken** |
| text first-create Fill | Color Fill | **intentional empty** — do not invent first-create Fill |

Did **not** invent envelope extras. Did **not** take C-01 (no swatch / hex / Transparent). Did **not** stamp `file.id`. Did **not** invent first-create Fill. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool.

## Product

`src/utils/pdfAnnotationsPdfLib.js`:

- `drawFlattenedObject` path branch now fills `isFilledPaperInk` blobs from `resolveLiveShapeFill` (rgba → hex + `/ca`)
- Highlighter / multiply stamps `blendMode: 'Multiply'`
- Opacity-0 fill writes `/ca` 0 instead of inventing a black stroke
- Legacy stroked paths (non-filled ink) keep the existing `borderColor` / `borderWidth` lane
- HIGH-RISK files **not touched** this pass

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Text Fill / Arrowhead / Style dash.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-ink-flatten-fill.spec.mjs` pending this pass.

- Intended: Highlighter Color Opacity 40 → first stroke fill rgba 0.4 → Export annotated PDF writes Ink `/CA` 0.4; `?testPdf=` reimport keeps fill; Node flatten fills `#FFFF00` at `/ca` 0.4 (no black 1pt stroke); `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfInkFlattenFill` proves fill-on-create, export `/CA`, flatten fill `/ca` 0.4, opaque pen fill, opacity-0 `/ca` 0.

Focused Node `pdfInkFlattenFill` + leftover18FailClosed pending. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Filled paper-ink flatten now fills the blob at live Opacity — not a leftover
- Session-shared Text Fill chrome now resets empty after Callout / Counter — not a leftover
- Session-shared Arrowhead now resets per tool after Callout / Arrow — not a leftover
- Session-shared Style dash now resets per tool after Callout / Rect — not a leftover
- Text first-create now resets Width to 1 after Callout / Highlighter — not a leftover
- Textbox first-create now stamps next-draw Style / Border Opacity / Border / Width — not a leftover
- Textbox first-create empty background is intentional — do not invent a first-create Fill
- Width after remaining pairs (Pen ↔ Highlighter, Line ↔ Arrow, Text ↔ Callout) — confirmed aligned
- Opacity / Color hue / Eraser type sibling pairs — confirmed aligned
- Callout / Rect / Counter Fill after sibling — confirmed aligned (defaults present)
- Cloud Bump is session-only (Style Cloud persists; Bump not in prefs) — not taken
- Counter first-pin now loads badge Fill `#ef4444` / 100 — not a leftover
- Callout first-create already stamps borderColor / lineThickness / borderOpacity / lineStyle / arrowheadStyle — not a leftover
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
