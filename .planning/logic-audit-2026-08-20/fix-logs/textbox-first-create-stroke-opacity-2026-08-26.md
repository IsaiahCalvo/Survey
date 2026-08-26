# Textbox first-create Color Border Opacity persist — 2026-08-26

## Leftover taken

Textbox first-create on the live Text tool. Live toolbar writes next-draw Color Border Opacity as `strokeOpacity` (0–100). Selected-patch composes `stroke` as rgba via `composeColorForPatch`. First-create `TextEditOverlay` stamped `strokeColor` hex only and PDFViewer did not pass `strokeOpacity`, so a next-draw fade never reached persist / reimport / flatten until Opacity was re-touched. Text-tool `DEFAULT_TOOL_PREFERENCES.strokeOpacity` is already `100`, so the leftover only shows after Opacity leaves that default. Callout first-create already stamps `borderOpacity`. Distinct from leftover-18, textbox first-create Width (`866693f6`), first-create Color Border (`490309ac`), and textbox stroke `/Border` of an already-patched box (`99a07184`).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from Pen first-stroke opacity persist (`87173d9d`), Counter first-pin fillOpacity persist (`66dff649`), and textbox first-create Color Border (`490309ac`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after textbox first-create Color Border (`a0aa9015` / product `490309ac`):

| Key | Toolbar | Verdict |
|---|---|---|
| textbox first-create Width | Width | **aligned** — `strokeWidth` from live toolbar (`866693f6`) |
| textbox first-create Color Border | Color Border | **aligned** — `stroke` from live `strokeColor` (`490309ac`) |
| callout first-create Color / Width / Opacity | Color Border + Width + Opacity | **aligned** — `borderColor` / `lineThickness` / `borderOpacity` |
| textbox first-create Fill | Color Fill | **intentional empty** until Color Fill patches |
| textbox / callout first-create fontSize / align | Font / Text alignment | **parked** — 0 without `richTextEditor` |
| **textbox first-create hex-only `stroke`** | Color Border Opacity | **LIVE leftover** — create-time opaque until Opacity patches |

Did **not** invent envelope extras. Did **not** take C-01 (Opacity spinbutton only; no swatch / hex / Transparent). Did **not** invent a polygon tool. Did **not** stamp `file.id`. Did **not** invent a fill on first create.

## Product

`src/components/TextEditOverlay.jsx` isNewText assigned hex-only `stroke`. PDFViewer passed `strokeColor` + `strokeWidth` but not `strokeOpacity`. Text-tool default Opacity is `100` (`useDatabase.js` `DEFAULT_TOOL_PREFERENCES.text`).

Min-viable:

- `src/components/TextEditOverlay.jsx` — new-text `stroke = composeAnnotationColor(strokeColor, strokeOpacity)`; commit prefers live compose
- `src/PDFViewer.jsx` — pass `strokeOpacity={strokeOpacity}` into TextEditOverlay
- `src/utils/annotationStyleCatalog.js` — comment: first-create now stamps live Color Border + Width + Opacity

HIGH-RISK file (`PDFViewer.jsx`): min-viable only. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay first-create Width, first-create Color Border, or textbox stroke export.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-first-create-stroke-opacity.spec.mjs` **2 / 2 (9.2s)**.

- Intended: Text + Color Border Opacity `40` **before any box** + first box writes rgba `0.4` without touching Opacity again; Export annotated PDF writes FreeText metadata stroke fade `0.4`; `?testPdf=` reimport keeps fade `0.4`; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFirstCreateStrokeOpacity` proves first-create overlay composes live Border Opacity, omitted Opacity stays opaque, first-create-shaped export metadata stroke `rgba(0, 0, 0, 0.4)`.

Focused Node `pdfTextboxFirstCreateStrokeOpacity` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox first-create now stamps next-draw Color Border Opacity — not a leftover
- Textbox first-create now stamps next-draw Color Border — not a leftover
- Textbox first-create Width already stamps strokeWidth — not a leftover
- Textbox first-create empty background is intentional until Color Fill patches — do not invent a fill
- Callout first-create already stamps borderColor / lineThickness / borderOpacity — not a leftover
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
