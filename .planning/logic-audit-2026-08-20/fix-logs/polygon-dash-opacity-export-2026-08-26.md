# Imported Polygon Style dash + Color Opacity export /BS + /CA — 2026-08-26

## Leftover taken

Style Dashed / Dotted + Color Opacity on a selected imported non-cloud polygon (selection maps to rect Style + Color). Live toolbar already wrote `strokeDashArray`, but AppShell `minOpacity={1}` locked Border fade at 100 and `createPolygonAnnotation` wrote hex `/C` + `/Border` width only. Acrobat stayed solid and opaque until Style / Opacity were re-touched. Flatten already honoured dash. Distinct from leftover-18, PolyLine `/BS` `/CA` (`cb750ecb`), Polygon Cloud Bump `/AP` (`20c386d7`), Square Cloud Bump `/AP` (`99f02811`), and Cloud stroke `/CA`. Did **not** invent a create-poly tool.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after imported PolyLine dash / Opacity (`e9d87dbf` / product `cb750ecb`).

| Key | Toolbar | Verdict |
|---|---|---|
| Cloud stroke Opacity export `/CA` | Style Cloud + Color Border Opacity | **aligned** — Square `needsFade` already attaches `/AP` + ExtGState `/CA` |
| Square Cloud Bump > 2 `/AP` | Style Cloud + Bump 3–20 | **aligned** — product `99f02811` |
| Imported Polygon Cloud Bump > 2 `/AP` | selected imported polygon Style Cloud + Bump | **aligned** — product `20c386d7` |
| Imported PolyLine Style dash / Color Opacity export `/BS` `/CA` | selected imported polyline Style Dashed + Color Opacity | **aligned** — product `cb750ecb` |
| Imported Polygon non-cloud Style dash / Color Opacity export `/BS` `/CA` | selected imported polygon Style Dashed + Color Border Opacity | **LIVE leftover** — dash reached screen; Border Opacity clamped to 100; export omitted `/BS` and `/CA` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |
| Polygon `/IC` without alpha | — | not taken; `/IC` hex stay as-is; fade only on Cloud `/AP` |
| 390 mobile stroke `minOpacity: 1` | 390 Border | **not taken** — desktop AppShell floor lifted; 390 sheet still locks stroke at 100 (same one-visible comment) |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay PolyLine `/BS` `/CA` or Polygon Cloud Bump `/AP`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- Non-cloud Polygon writes dict `/CA` from `paintAlpha(stroke, opacity)` when fade < 1
- Dashed / Dotted write `/BS` `/S` `/D` + `/D` dash array (same as Line / PolyLine)
- Solid + opaque still **omit** `/BS` and `/CA` so default export stays byte-identical
- Cloud path unchanged (`/BE` + `/AP` when fade or Bump > 2)

`src/AppShell.jsx` (not high-risk):

- Rect-mapped Color Border `minOpacity` is **0**. One-visible stays the applyChange bump (never both sides 0). `minOpacity={1}` had locked Border fade at 100 so live Color Opacity never reached persist / Polygon `/CA`.

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a create-poly tool.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-polygon-dash-opacity-export.spec.mjs` **2 / 2 (7.4s)**.

- Intended: `?testPdf=e2e-poly-vertices.pdf` → Select imported 4-vertex polygon → Style Dashed + Color Border Opacity `40` writes `strokeDashArray` **[6,4]** + rgba **0.4**; Export writes Polygon `/BS` `[6,4]` + `/CA` **0.4** (no `/BE`); `?testPdf=` reimport keeps Dashed + fade; `file.id` null; viewBox `0 0 612 792`; no Polygon create button
- Break: empty export invents 0 dash / fade; hubPreview Style **0**
- Edge: 390 viewBox / `file.id` / no invent; no Polygon create button

Node `pdfPolygonDashOpacityExport` proves selected-patch Dashed + fade, `/BS` `[6,4]` + `/CA` 0.4, dotted `/BS` `[2,4]` omits `/CA`, solid opaque omits both, flatten writes `[6 4] 0 d` and skips solid dash, Cloud `/AP` not invented.

Focused Node `pdfPolygonDashOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Imported Polygon non-cloud Style dash / Color Opacity now writes `/BS` + `/CA`; desktop Border Opacity floor lifted — not a leftover
- Imported PolyLine Style dash / Color Opacity now writes `/BS` + `/CA` — not a leftover
- Imported Polygon Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Square Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Cloud stroke `/CA` already rides `needsFade` — not a leftover
- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Selected-shape Fill Opacity 0 now stays 0 after Select — not a leftover
- Nominated 0.08 / 0.2 view-floor family — **complete**
- Other `"0"` / empty-string falsy parsers — **aligned**
- Font color / Bold / Italic / fontFamily / fontSize / textAlign stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
- Polygon `/IC` without alpha — not taken (`/IC` hex stay; fade only on Cloud `/AP`)
- 390 mobile stroke `minOpacity: 1` — remaining view clamp on the 390 sheet, not taken
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
