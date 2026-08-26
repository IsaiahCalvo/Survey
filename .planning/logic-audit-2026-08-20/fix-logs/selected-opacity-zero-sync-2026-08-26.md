# Selected-shape Fill Opacity 0 as-is after Select — 2026-08-26

## Leftover taken

User-selected shape / textbox / path Color Fill / Border sync still dropped rgba alpha **0**. Live Color Fill / Border already offered 0–100 (field min 0), and persist / export / flatten / page view already honored `rgba(..., 0)`, but `getOpacityFromEntityColor` treated `match[4]` `"0"` as missing (falsy) so Select synced Fill / Border Opacity to **100** until the picker was re-touched. Distinct from leftover-18, selected-callout Color swatch floors (`callout-toolbar-swatch-opacity-2026-08-26.md`), callout Fill / Border Opacity screen floors, and C-01 swatch / hex / Transparent apply. Field min 0 stayed. Did not invent a floor of 0 → 100.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live clamp leftover after selected-callout Color swatch (`e63e66f0` / product `3f10d86c`):

| Key | Toolbar | Verdict |
|---|---|---|
| Other `Math.max(..., 0.08)` / `0.2` view floors | — | **none** — last hunter correct |
| **Selected-shape Fill Opacity 0 → 100** | Color Fill after Select | **LIVE leftover** — picker 0–100; Select invented 100 |
| Textbox / shape / counter / highlighter screen floors | Color Opacity | **aligned** — rgba as-is |
| Official `annotationContextMenuitem` spec Enter | — | source already has Enter — **not taken** |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent a floor of 0 → 100. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover.

## Product

`src/viewerShared.js` (HIGH-RISK, min-viable):

- `getOpacityFromEntityColor` treats `match[4] != null && match[4] !== ''` so rgba alpha `"0"` returns **0**
- Hex / missing alpha still default 100
- `PDFViewer` Select sync still reads this helper for fill / stroke (unchanged call sites)

`file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. `PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` not touched. Did **not** replay selected-callout Color swatch floors.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-selected-opacity-zero-sync.spec.mjs` **2 / 2 (9.7s)**.

- Intended: Shapes → Rectangle default Fill stamps rgba **0**; Select + click keeps Fill picker Opacity slider **disabled** (transparentMode); Fill Opacity **5** then Select shows spinbutton **5**
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 Rectangle **0** (no invent); viewBox / `file.id` / no floor of 0 → 100

Node `pdfSelectedOpacityZeroSync` proves `rgba(..., 0)` → 0, `0.05` → 5, hex still 100, no falsy `match[4]`, isolated 8448 / 75/250 standing.

Focused Node `pdfSelectedOpacityZeroSync` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec (`keyboard.press('Enter')` vs live spec — not taken; not aligned down). Isolated 8448 not reached because official fail-stops first.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected-shape Fill Opacity 0 now stays 0 after Select — not a leftover
- Selected-callout Color swatch Fill / Border now paint as-is — not a leftover
- Callout Border Opacity below 20% now paints as-is — not a leftover
- Callout Fill Opacity below 8% now paints as-is — not a leftover
- Nominated 0.08 / 0.2 view-floor family — **complete**
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
