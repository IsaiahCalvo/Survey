# Imported Polygon Cloud Bump export /BE + /AP when I > 2 — 2026-08-26

## Leftover taken

Style Cloud + Bump on a selected imported polygon (selection maps to rect Style). Live toolbar already wrote `data.pdfCloudIntensity` and SVG already rebuilt `cloud-polygon` scallops, but `createPolygonAnnotation` keyed only on `cloudBorder` / `fabricObj.cloudIntensity` and skipped `/AP`. PDF `/BE/I` is only 0–2, so an opaque Bump 8 reached Acrobat clamped to 2 until Bump was re-touched. Flatten stroked the raw vertices. Distinct from leftover-18, Square Cloud Bump `/AP` (`99f02811`), Cloud Bump persist (`53d63a7c`), and Cloud Fill Opacity `/ca` (`26885c51`). Did **not** invent a create-poly tool.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after Cloud Bump > 2 export (`56b6f2c1` / product `99f02811`).

| Key | Toolbar | Verdict |
|---|---|---|
| Cloud stroke Opacity export `/CA` | Style Cloud + Color Border Opacity | **aligned** — Square `needsFade` already attaches `/AP` + ExtGState `/CA` |
| Square Cloud Bump > 2 `/AP` | Style Cloud + Bump 3–20 | **aligned** — product `99f02811` |
| Other `isCloud` skips that drop a live toolbar style | selected imported polygon Style Cloud + Bump | **LIVE leftover** — screen `cloud-polygon` + `pdfCloudIntensity` 8; export omitted `/BE` from that field and skipped `/AP` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |
| Polygon `/IC` without alpha | — | not taken as the leftover; `/IC` hex stay as-is. Fade rides `needsFade` `/AP` only when Cloud is on |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay Square Cloud Bump `/AP` or Cloud Fill Opacity `/ca`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- Cloudy Polygon writes `/BE` from `data.pdfCloudIntensity` (same as Square)
- `/IT` `PolygonCloud` when Cloud is on
- Attach faded or oversized `/AP` when `needsFade || needsOversizedBump` (`intensity > 2`)
- Opaque default bump 1–2 still **omit `/AP`** so viewers keep native `/BE` scallops
- Flatten rebuilds scallops via `buildCloudPathCommands` of the live vertices

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Square Cloud Bump `/AP` or Cloud Fill Opacity `/ca`. Did **not** invent a create-poly tool.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-polygon-cloud-bump-export.spec.mjs` **2 / 2 (6.6s)**.

- Intended: `?testPdf=e2e-poly-vertices.pdf` → Select imported 4-vertex polygon → Style Cloud + Bump `8` writes `pdfCloudIntensity` **8** + `cloud-polygon`; Export annotated PDF writes Polygon `/BE` `/I` **8** + `/AP`; `?testPdf=` reimport keeps Cloud + Bump 8; `file.id` null; viewBox `0 0 612 792`; no Polygon create button
- Break: empty export invents 0 Cloud Bump; hubPreview Bump **0**
- Edge: 390 viewBox / `file.id` / no invent; no Polygon create button

Node `pdfPolygonCloudBumpExport` proves selected-patch Bump 8, oversized `/BE` `/I` 8 + `/AP`, opaque default bump 2 omits `/AP`, faded bump 2 still attaches `/AP` for `/ca`, flatten rebuilds scallops.

Focused Node `pdfPolygonCloudBumpExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Imported Polygon Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Square Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Cloud stroke `/CA` already rides `needsFade` — not a leftover
- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Selected-shape Fill Opacity 0 now stays 0 after Select — not a leftover
- Selected-callout Color swatch Fill / Border now paint as-is — not a leftover
- Callout Border Opacity below 20% now paints as-is — not a leftover
- Callout Fill Opacity below 8% now paints as-is — not a leftover
- Nominated 0.08 / 0.2 view-floor family — **complete**
- Other `"0"` / empty-string falsy parsers — **aligned**
- Highlighter / Pen first-stroke Width already aligned — not a leftover
- Pen Width min / Eraser Size min / Cloud Bump min / Counter Size min — catalog mins match field clamps
- Textbox first-create now stamps next-draw Color Fill when the user set it — not a leftover
- Eraser Size now persists per tool after remount — not a leftover
- Cloud Bump now persists per tool after remount — not a leftover
- Session-shared Text Fill / Arrowhead / Style dash already aligned
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
- Polygon `/IC` without alpha — not taken this pass (`/IC` hex stay; fade only on Cloud `/AP`)
- Imported PolyLine Style dash / Color Opacity export (`/BS` `/CA`) — remaining live toolbar drop, not taken
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
