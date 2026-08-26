# Textbox first-create Width persist — 2026-08-26

## Leftover taken

Textbox first-create on the live Text tool. Live toolbar writes next-draw Width as `strokeWidth`. First-create `TextEditOverlay` hardcoded `strokeWidth: 1`, so a next-draw Width never reached persist / reimport / export until the user touched Width again (`handleStrokeWidthChange` patches selected text). Callout first-create already stamps `lineThickness` from `strokeWidth`. Distinct from textbox stroke `/Border` of an already-patched box (`99a07184`) and leftover-18.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from Pen first-stroke opacity persist (`87173d9d`), Counter first-pin fillOpacity persist (`66dff649`), textbox fillOpacity `/ca` (`f31aeb27`), and textbox stroke export (`99a07184`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after Pen first-stroke (`008e23a3` / product `87173d9d`):

| Key | Toolbar | Verdict |
|---|---|---|
| pen first-stroke Width | Width | **aligned** — `buildFreehandCommitJSON` `width: strokeWidth` |
| highlighter first-stroke Width | Width | **aligned** — `Math.max(strokeWidth, 8)` |
| partial erase first-swipe Size | Eraser Size | **aligned** — `eraserSizeRef.current` at pointer-down |
| rect / ellipse / line / arrow first-draw Width | Width | **aligned** — `strokeWidth` in commit builders |
| callout first-create Width | Width | **aligned** — `lineThickness` from `strokeWidth` |
| textbox / callout first-create fontSize / align | Font / Text alignment | **parked** — 0 without `richTextEditor` |
| **textbox first-create `strokeWidth: 1`** | Width | **LIVE leftover** — create-time 1 until Width patches |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** invent a polygon tool. Did **not** stamp `file.id`. Did **not** take Color Border first-create (`stroke: '#000000'` still hardcoded) — next unique leftover.

## Product

`src/components/TextEditOverlay.jsx` isNewText assigned `strokeWidth: 1`. PDFViewer passed `strokeColor` but not live Width.

Min-viable:

- `src/components/TextEditOverlay.jsx` — new-text `strokeWidth = Math.max(1, Number(strokeWidth) || 1)`
- `src/PDFViewer.jsx` — pass `strokeWidth={strokeWidth}` into TextEditOverlay

HIGH-RISK file (`PDFViewer.jsx`): min-viable only. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Pen first-stroke opacity, textbox stroke export, or callout Width.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-first-create-width.spec.mjs` **2 / 2 (8.5s)**.

- Intended: Text + Width `8` **before any box** + first box writes `strokeWidth` **8** without touching Width again; Export annotated PDF writes FreeText `/Border` **8**; `?testPdf=` reimport keeps `strokeWidth` 8; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFirstCreateWidth` proves first-create overlay reads live Width, omitted Width stays 1, first-create-shaped export FreeText `/Border` 8.

Focused Node `pdfTextboxFirstCreateWidth` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox first-create now stamps next-draw Width — not a leftover
- Textbox first-create Color Border still hardcodes `stroke: '#000000'` until Border is touched again — remaining persist leftover
- Pen first-stroke Width already aligned — not a leftover
- Highlighter first-stroke Width already aligned — not a leftover
- Callout first-create Width already stamps lineThickness — not a leftover
- Pen first-stroke now composes strokeColor + strokeOpacity at create — not a leftover
- Highlighter first-stroke already composes via highlightColor — not a leftover
- Rect / ellipse / line / arrow first-draw already compose — not a leftover
- Callout first-create already stamps fillOpacity / borderOpacity — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches
- Counter first-pin now composes fillColor + fillOpacity at create — not a leftover
- Textbox fill rgba export already writes `/C` + AP `/ca` — not a leftover
- Callout fillOpacity export already writes `/C` + AP `/ca` — not a leftover
- Line / Arrow flatten arrowhead now applies rgba `/CA` — not a leftover
- Shape Fill already writes independent `/ca` vs `/CA` — not a leftover
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
