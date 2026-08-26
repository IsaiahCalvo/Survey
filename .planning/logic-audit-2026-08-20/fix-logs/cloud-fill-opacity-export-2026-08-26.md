# Cloud Fill Opacity export Square /BE + /AP /ca — 2026-08-26

## Leftover taken

Cloud Fill Opacity on the live Style Cloud rectangle. Live toolbar already wrote rgba fill + Style Cloud `/BE`, and flatten already applied fill `/ca`, but `createSquareAnnotation` skipped `attachIndependentShapeAppearance` when `isCloud`. Export wrote `/IC` hex + `/BE` and no `/AP`, so a faded cloud reached Acrobat opaque until Fill was re-touched. Distinct from leftover-18, Cloud Bump persist (`53d63a7c`), plain Square fill/stroke `/ca` (non-cloud), and selected-shape Fill Opacity 0 Select sync (`01e0e5ac`).

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten / import / create-path leftover after selected-shape Fill Opacity 0 sync (`efb31d51` / product `01e0e5ac`). Last hunter said nominated 0.08 / 0.2 view-floor family is complete.

| Key | Toolbar | Verdict |
|---|---|---|
| Other `"0"` / empty-string falsy parsers (`width` / dash / bump / counter size) | Width / Style / Bump / Size | **aligned** — importer `extractAnnotationOpacity` / `normalizeOpacityValue` keep 0; callout Select uses `Number(style.fillOpacity)` |
| `textHighlightOpacity \|\| 0.5` / `textMarkupOpacity \|\| 1` | text-highlight | compile-hidden (`showTextMarkupHighlightMenu = false`) — **not taken** |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| **Cloud Fill Opacity export `/AP`** | Style Cloud + Color Fill Opacity | **LIVE leftover** — persist / flatten / page view already `rgba(..., 0.4)`; export skipped `/AP` |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- `fabricPathCommandsToPdf` — Fabric M/L/Q/C/Z (y-down) → PDF appearance ops (y-up when `flipHeight` is form height); Q elevated to cubic
- Cloudy Square still writes `/BE`; attach faded `/AP` **only when `needsFade`** (fill visible and `< 0.99999`, or stroke visible and faded)
- Opaque clouds still **omit `/AP`** so viewers keep native `/BE` scallops
- Cloud path from `buildCloudPathCommands` of the form rect; fallback `0 0 w h re`

Tradeoff accepted: faded clouds get a cloudy `/AP` with BBox = fabric rect (outward bumps may clip slightly in Acrobat). Opaque default clouds unchanged.

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Cloud Bump persist, plain Square `/ca`, or selected-shape Fill Opacity 0 sync.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-cloud-fill-opacity-export.spec.mjs` **2 / 2 (8.9s)**.

- Intended: Shapes → Rectangle → Style Cloud + Fill Opacity `40` + drag writes fill rgba **0.4**; Export annotated PDF writes Square `/BE` + AP `/ca` **0.4**; no dict `/CA`; `?testPdf=` reimport keeps Cloud + fill ~0.4; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; Rectangle create if visible

Node `pdfCloudFillOpacityExport` proves first-create `rgba(..., 0.4)`, faded `/BE` + AP `/ca` 0.4, stroke-only dict `/CA` 0.4, opaque omits `/AP`, flatten `/ca` 0.4, opacity-0 fill does not invent yellow.

Focused Node `pdfCloudFillOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Selected-shape Fill Opacity 0 now stays 0 after Select — not a leftover
- Selected-callout Color swatch Fill / Border now paint as-is — not a leftover
- Callout Border Opacity below 20% now paints as-is — not a leftover
- Callout Fill Opacity below 8% now paints as-is — not a leftover
- Nominated 0.08 / 0.2 view-floor family — **complete**
- Other `"0"` / empty-string falsy parsers checked this pass — **aligned**
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
