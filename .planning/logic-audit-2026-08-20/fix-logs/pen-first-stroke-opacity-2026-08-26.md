# Pen first-stroke Color Opacity persist — 2026-08-26

## Leftover taken

Pen first-stroke create on the live Pen tool. Live toolbar writes next-draw Color as hex `strokeColor` + `strokeOpacity` (Color Opacity). First-stroke `buildFreehandCommitJSON` stamped `strokeColor` hex, so a faded next-draw never reached persist / reimport / export until the user touched Opacity again (`handleStrokeOpacityChange` patches selected ink). Highlighter already rode `highlightColor={composeColorForPatch(strokeColor, strokeOpacity)}`. Distinct from ink `/CA` of already-rgba fills and leftover-18.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from Counter first-pin fillOpacity persist (`66dff649`), Counter Circle AP `/ca` (`e0657973`), textbox fillOpacity `/ca` (`f31aeb27`), callout fillOpacity `/ca` (`1cbd6f3c`), and arrowhead flatten opacity (`6b8b2bb3`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live create-path / persist / export bug after Counter first-pin (`f4f96833` / product `66dff649`):

| Key | Toolbar | Verdict |
|---|---|---|
| rect / ellipse first-draw fill+stroke | Color Fill / Border Opacity + Width + dash | **aligned** — `composeAnnotationColor` |
| line / arrow first-draw stroke | Color Opacity + Width + dash | **aligned** — `composeAnnotationColor` |
| callout first-create fill/border | Color Fill / Border Opacity | **aligned** — separate `fillOpacity` / `borderOpacity` fields |
| textbox first-create box fill | Color Fill | **intentional empty** until Color Fill patches (`resolveTextboxBoxFill`) |
| highlighter first-stroke | Color Opacity | **aligned** — `highlightColor={composeColorForPatch(...)}` |
| **pen first-stroke `strokeColor` hex** | Color Opacity | **LIVE leftover** — create-time hex until Opacity patches |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** take C-01. Did **not** invent a polygon tool. Did **not** stamp `file.id`.

## Product

`src/utils/annotationCreationCommit.js` `buildFreehandCommitJSON` assigned pen `color: strokeColor` (hex). SVG preview used the same hex. Highlighter already composed.

Min-viable:

- `src/utils/annotationCreationCommit.js` — pen `color = composeAnnotationColor(strokeColor, strokeOpacity)`
- `src/components/SVGAnnotationLayer.jsx` — pass `strokeOpacity` into the commit builder; preview stroke uses `composeAnnotationColor(strokeColor, strokeOpacity)`

HIGH-RISK file (`SVGAnnotationLayer.jsx`): min-viable only. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Counter first-pin, textbox fillOpacity, callout fillOpacity, or highlighter highlightColor.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-pen-first-stroke-opacity.spec.mjs` **2 / 2 (8.1s)**.

- Intended: Draw → Pen + Color Opacity `40` **before any stroke** + first stroke writes rgba fill **0.4** without touching Opacity again; Export annotated PDF writes Ink `/CA` **0.4**; `?testPdf=` reimport keeps fill rgba ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfPenFirstStrokeOpacity` proves first-stroke source compose, hex-only is opaque 1, first-stroke-shaped export Ink `/CA` 0.4, highlighter still uses highlightColor.

Focused Node `pdfPenFirstStrokeOpacity` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

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
