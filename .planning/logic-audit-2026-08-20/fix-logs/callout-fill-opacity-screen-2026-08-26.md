# Callout Fill Opacity below 8% as-is on screen — 2026-08-26

## Leftover taken

User-set Callout Color Fill Opacity below 8% on first-create / view. Live Color Fill Opacity already offered 0–100 (field min 0), and persist / export / flatten already honored the 0–1 value, but view / spec / PAL floored `Math.max(..., 0.08)` so a next-draw Fill of 0/1/2/3/4/5/6/7 painted a ghost 8% until Fill was re-touched. Distinct from leftover-18, callout fillOpacity FreeText `/ca` export (`callout-fill-opacity-export-2026-08-26.md`), callout fill COLOR `/C`, and C-01 swatch / hex / Transparent apply. Field min 0 stayed. Did not invent a floor of 0.08.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live clamp / persist leftover after highlighter first-stroke Width below 8 (`da5593a9` / product `3eebc6a2`):

| Key | Toolbar | Verdict |
|---|---|---|
| **Callout Fill Opacity &lt; 8%** | Color Fill Opacity | **LIVE leftover** — catalog 0–100; view floored 0.08 |
| Callout Fill Opacity ≥ 8% | Color Fill Opacity | **aligned** — persist / export `/ca` already |
| Callout Border Opacity &lt; 20% | Color Border Opacity | remaining view floor `Math.max(..., 0.2)` — not this leftover |
| Pen Width min / Eraser Size min / Cloud Bump min / Counter Size min | Size / Bump | **aligned** — catalog mins match field clamps |
| Highlighter first-stroke Width &lt; 8 | Width | **aligned** — just landed |
| Font color / Bold / Italic | richTextEditor | stay 0 — do not invent that editor |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** invent a floor of 0.08. Did **not** take leftover-18.

## Product

`src/utils/svgAnnotationRenderers.jsx`:

- Live view `fillOpacity` is `Math.max(0, Math.min(1, Number(callout.style?.fillOpacity ?? 0.4)))` — no 0.08 floor

`src/utils/calloutEditAdapter.js`:

- Spec / edit overlay matches view — no 0.08 floor

`src/utils/annotationCanvasPainter.js`:

- Canvas painter matches view — no 0.08 floor

Missing still defaults to 0.4. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. HIGH-RISK `PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` not touched (toolbar swatch preview still floors 0.08 — not this leftover). Did **not** replay highlighter first-stroke Width.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-fill-opacity-screen.spec.mjs` **2 / 2 (9.1s)**.

- Intended: Callout + Color Fill Opacity **5** **before any box** + first callout writes `fillOpacity` **0.05** and SVG `fill-opacity` **0.05**; Export annotated PDF writes FreeText AP `/ca` **0.05**; reimport keeps 0.05 on screen
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 Fill Opacity **0** stamps **0** (no floor of 0.08); viewBox / `file.id` / no invent

Node `pdfCalloutFillOpacityScreen` proves view / spec / PAL no longer floor, spec paints 0.05 / 0 / 0.07 / 1 as-is, missing still 0.4, export `/ca` 0.05, picker minOpacity 0.

Focused Node `pdfCalloutFillOpacityScreen` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout Fill Opacity below 8% now paints as-is — not a leftover
- Callout Fill Opacity export `/ca` already aligned — not a leftover
- Callout Border Opacity view still floors `Math.max(..., 0.2)` — remaining clamp leftover (not taken)
- PDFViewer selected-callout toolbar swatch still floors Fill 0.08 — high-risk preview, not taken
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

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.
