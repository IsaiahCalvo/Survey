# Textbox first-create Color Border persist — 2026-08-26

## Leftover taken

Textbox first-create on the live Text tool. Live toolbar writes next-draw Color Border as `strokeColor`. First-create `TextEditOverlay` hardcoded `stroke: '#000000'`, so a next-draw Color Border never reached persist / reimport / export until the user touched Border again (`patchSelectedStroke` on select). Text-tool `DEFAULT_TOOL_PREFERENCES.strokeColor` is already `#000000`, so the leftover only shows after Border leaves that default. Callout first-create already stamps `borderColor` from `strokeColor`. Distinct from textbox first-create Width (`866693f6`), textbox stroke `/Border` of an already-patched box (`99a07184`), and leftover-18.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from Pen first-stroke opacity persist (`87173d9d`), Counter first-pin fillOpacity persist (`66dff649`), and textbox first-create Width (`866693f6`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after textbox first-create Width (`fe789ad6` / product `866693f6`):

| Key | Toolbar | Verdict |
|---|---|---|
| textbox first-create Width | Width | **aligned** — `strokeWidth` from live toolbar (`866693f6`) |
| callout first-create Color / Width | Color Border + Width | **aligned** — `borderColor` / `lineThickness` from `strokeColor` / `strokeWidth` |
| textbox first-create Fill | Color Fill | **intentional empty** until Color Fill patches |
| textbox / callout first-create fontSize / align | Font / Text alignment | **parked** — 0 without `richTextEditor` |
| **textbox first-create `stroke: '#000000'`** | Color Border | **LIVE leftover** — create-time black until Border patches |

Did **not** invent envelope extras. Did **not** take C-01 (spectrum only; Hex field read, not typed). Did **not** invent a polygon tool. Did **not** stamp `file.id`.

## Product

`src/components/TextEditOverlay.jsx` isNewText assigned `stroke: '#000000'`. PDFViewer already passed `strokeColor`. Text-tool default Border is `#000000` (`useDatabase.js` `DEFAULT_TOOL_PREFERENCES.text`), so the Color button Fill swatch (`#FF0000`) is not the leftover.

Min-viable:

- `src/components/TextEditOverlay.jsx` — new-text `stroke = strokeColor || '#000000'`; commit prefers live `strokeColor`
- `src/utils/annotationStyleCatalog.js` — comment: first-create now stamps live Color Border + Width

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay first-create Width, textbox stroke export, or callout Color.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-first-create-stroke.spec.mjs` **2 / 2 (8.0s)**.

- Intended: Text + Color Border spectrum **before any box** + first box writes live `stroke` without touching Border again; Export annotated PDF writes FreeText metadata `stroke`; `?testPdf=` reimport keeps `stroke`; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFirstCreateStroke` proves first-create overlay reads live Color Border, omitted stroke stays `#000000`, first-create-shaped export metadata stroke `#00FF00`.

Focused Node `pdfTextboxFirstCreateStroke` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox first-create now stamps next-draw Color Border — not a leftover
- Textbox first-create Width already stamps strokeWidth — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches
- Textbox first-create Border Opacity — next persist leftover if first box ignores next-draw fade until Opacity is re-touched
- Pen first-stroke Width already aligned — not a leftover
- Highlighter first-stroke Width already aligned — not a leftover
- Callout first-create Width already stamps lineThickness — not a leftover
- Pen first-stroke now composes strokeColor + strokeOpacity at create — not a leftover
- Highlighter first-stroke already composes via highlightColor — not a leftover
- Rect / ellipse / line / arrow first-draw already compose — not a leftover
- Callout first-create already stamps fillOpacity / borderOpacity — not a leftover
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
