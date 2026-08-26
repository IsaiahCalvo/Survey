# Imported Polygon Fill Opacity export /IC + /AP /ca — 2026-08-26

## Leftover taken

Color Fill Opacity on a selected imported non-cloud polygon (selection maps to rect Color Fill). Live toolbar already wrote rgba fill and flatten already applied fill `/ca`, but `createPolygonAnnotation` wrote hex `/IC` only and attached `/AP` only when `isCloud`. Acrobat stayed opaque until Fill was re-touched. Same class as Cloud Fill `/AP` `/ca`. Distinct from leftover-18, Polygon `/BS` `/CA` (`28f352f4`), Polygon Cloud Bump `/AP` (`20c386d7`), 390 stroke `minOpacity` 0 (`265da833`), and Cloud Fill `/ca`. Did **not** invent a create-poly tool.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after 390 mobile stroke `minOpacity` 0 (`3cf60031` / product `265da833`).

| Key | Toolbar | Verdict |
|---|---|---|
| Polygon `/IC` without alpha | selected imported polygon Fill Opacity | **LIVE leftover** — screen rgba 0.4; export wrote hex `/IC` and skipped `/AP` |
| Other `isCloud` / special-case skips that drop a live toolbar style | Style Cloud / Fill | **aligned** — Square + Polygon Cloud already attach faded `/AP`; non-cloud Polygon was the remaining skip |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay 390 stroke floor, Polygon `/BS` `/CA`, or Cloud Fill `/ca`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- `polygonAppearancePath` — imported vertices → form-space PDF path (cloud scallops when intensity is set)
- `/IC` from `resolveLiveShapeFill` — hex stay; opacity-0 fill does not invent an interior
- Non-cloud faded fill attaches `/AP` ExtGState `/ca` (same helper as Square / Cloud)
- Stroke-only fade still rides dict `/CA` (no fill `/AP`)
- Opaque fill + opaque stroke still **omit** `/AP` so default export stays byte-identical
- Cloud path unchanged (`/BE` + `/AP` when fade or Bump > 2)

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a create-poly tool.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-polygon-fill-opacity-export.spec.mjs` **2 / 2 (7.5s)**.

- Intended: `?testPdf=e2e-poly-vertices.pdf` → Select imported 4-vertex polygon → Color Fill Opacity `40` writes fill rgba **0.4**; Export writes Polygon `/IC` hex + `/AP` `/ca` **0.4** (no `/BE`, no dict `/CA`); `?testPdf=` reimport keeps fill ~0.4; `file.id` null; viewBox `0 0 612 792`; no Polygon create button
- Break: empty export invents 0 fade; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; no Polygon create button

Node `pdfPolygonFillOpacityExport` proves selected-patch rgba fill 0.4, `/IC` hex + AP `/ca` 0.4, stroke-only dict `/CA` 0.4 omits `/IC` `/AP`, opaque omits `/AP`, flatten `/ca` 0.4, opacity-0 fill does not invent yellow.

Focused Node `pdfPolygonFillOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Imported Polygon non-cloud Fill Opacity now writes `/IC` + faded `/AP` `/ca` — not a leftover
- Imported Polygon non-cloud Style dash / Color Opacity now writes `/BS` + `/CA`; desktop Border Opacity floor lifted — not a leftover
- 390 mobile stroke Color Opacity floor lifted — not a leftover
- Imported PolyLine Style dash / Color Opacity now writes `/BS` + `/CA` — not a leftover
- Imported Polygon Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Square Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Cloud stroke `/CA` already rides `needsFade` — not a leftover
- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Other `isCloud` skips checked this pass — Square + Polygon Cloud already attach faded `/AP`
- Selected-shape Fill Opacity 0 now stays 0 after Select — not a leftover
- Nominated 0.08 / 0.2 view-floor family — **complete**
- Other `"0"` / empty-string falsy parsers — **aligned**
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
- Square import of `/AP` `/ca` without app metadata — Survey-to-Survey uses metadata
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
