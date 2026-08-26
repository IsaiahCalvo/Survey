# Selected-callout Color swatch Fill / Border Opacity as-is — 2026-08-26

## Leftover taken

User-selected Callout Color swatch still floored Fill at 8% and Border at 20%. Live Color Fill / Border Opacity already offered 0–100 (field min 0), and persist / export / flatten / page view already honored the 0–1 value, but `PDFViewer` `selectedPreviewColors` used `Math.max(..., 0.08)` / `Math.max(..., 0.2)` so a selected Fill of 0–7 or Border of 0–19 painted a ghost 8% / 20% swatch until the picker was re-touched. Distinct from leftover-18, callout Fill Opacity screen floor (`callout-fill-opacity-screen-2026-08-26.md`), callout Border Opacity screen floor (`callout-border-opacity-screen-2026-08-26.md`), and C-01 swatch / hex / Transparent apply. Field min 0 stayed. Did not invent a floor of 0.08 or 0.2.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live clamp leftover after callout Border Opacity below 20 (`e651c653` / product `5cc4a178`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Selected-callout Color swatch Fill 0.08 / Border 0.2** | Color Fill / Border preview | **LIVE leftover** — picker 0–100; selected swatch floored |
| Other non-high-risk view floors (`Math.max(..., 0.08)` / `0.2`) | — | **none** — only PDFViewer still had them |
| Callout Border Opacity &lt; 20% on page | Color Border Opacity | **aligned** — just landed |
| Callout Fill Opacity &lt; 8% on page | Color Fill Opacity | **aligned** |
| Pen Width min / Eraser Size min / Cloud Bump min / Counter Size min | Size / Bump | **aligned** — catalog mins match field clamps |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent a floor of 0.08 or 0.2. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover.

## Product

`src/PDFViewer.jsx` (HIGH-RISK, min-viable):

- Selected-callout toolbar swatch `borderOpacity` is `Math.max(0, Math.min(1, Number(style.borderOpacity ?? 1)))` — no 0.2 floor
- Selected-callout toolbar swatch `fillOpacityValue` is `Math.max(0, Math.min(1, Number(style.fillOpacity ?? 0.4)))` — no 0.08 floor
- Fill preview still multiplies `borderOpacity * fillOpacityValue` (unchanged)

Missing still defaults to Border 1 / Fill 0.4. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` not touched. Did **not** replay callout Fill / Border Opacity screen floors.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-toolbar-swatch-opacity.spec.mjs` **2 / 2 (23.7s)**.

- Intended: Callout + Color Fill Opacity **5** + first callout writes `fillOpacity` **0.05**; Select + click box paints Color Fill swatch alpha **0.05** (not 0.08); Color Border Opacity **10** stamps `borderOpacity` **0.10** and Color Border swatch alpha **0.10** (not 0.20)
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 Callout **0** (no invent); viewBox / `file.id` / no floor of 0.08 or 0.2

Node `pdfCalloutToolbarSwatchOpacity` proves PDFViewer no longer floors, swatch math paints 0.05 / 0.10 / 0 / 0.19 as-is, missing still Fill 0.4 / Border 1, picker minOpacity 0, isolated 8448 / 75/250 standing.

Focused Node `pdfCalloutToolbarSwatchOpacity` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected-callout Color swatch Fill / Border now paint as-is — not a leftover
- Callout Border Opacity below 20% now paints as-is — not a leftover
- Callout Fill Opacity below 8% now paints as-is — not a leftover
- Callout Border Opacity export `/CA` already aligned — not a leftover
- Highlighter / Pen first-stroke Width already aligned — not a leftover
- Pen Width min / Eraser Size min / Cloud Bump min / Counter Size min — catalog mins match field clamps
- Textbox first-create now stamps next-draw Color Fill when the user set it — not a leftover
- Eraser Size now persists per tool after remount — not a leftover
- Cloud Bump now persists per tool after remount — not a leftover
- Session-shared Text Fill / Arrowhead / Style dash already aligned
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
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.
