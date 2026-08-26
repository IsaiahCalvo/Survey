# 390 mobile stroke Color Opacity minOpacity 0 — 2026-08-26

## Leftover taken

390 viewport still locked Color Border Opacity at 100 for rect / ellipse / rect-mapped imported polygons after desktop AppShell lifted the same floor (`2161fa7f`). Live probe on reused Vite: slider `min=100` and typing `40` stayed `100`. `MobilePdfViewerChrome` stroke takeover passed `minOpacity: 1` (same one-visible comment as the old AppShell Border floor). Distinct from leftover-18, Polygon `/BS` `/CA` (`28f352f4`), desktop Border `minOpacity` 0 (`2161fa7f`), C-03 Line stroke continuum, and C-06 Match Fill. Did **not** invent a create-poly tool.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten / view-clamp leftover after imported Polygon dash / Opacity (`a5292e77` / product `28f352f4` + clamp `2161fa7f`).

| Key | Toolbar | Verdict |
|---|---|---|
| 390 mobile stroke `minOpacity: 1` | 390 rect / imported-polygon Border | **LIVE leftover** — probe slider min 100; typing 40 stayed 100 |
| Polygon `/IC` without alpha | selected imported polygon Fill Opacity | **not taken** — `/IC` hex stay; fade only on Cloud `/AP` |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |
| Imported Polygon non-cloud Style dash / Color Opacity export `/BS` `/CA` | selected imported polygon Style Dashed + Color Border Opacity | **aligned** — product `28f352f4` + clamp `2161fa7f` |
| Line stroke Opacity at 390 | 390 Line Stroke | **aligned** — Line never inherited the rect/ellipse floor |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay Polygon `/BS` `/CA`.

## Product

`src/mobile/MobilePdfViewerChrome.jsx` (not high-risk):

- Rect/ellipse stroke takeover `minOpacity` is **0**. One-visible stays the fill/stroke `onChange` bump (never both sides 0). `minOpacity: 1` had locked Border fade at 100 so a live 390 fade never reached persist / Polygon `/CA`.
- Match Fill firstPreset unchanged.

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a create-poly tool.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-mobile-stroke-min-opacity.spec.mjs` **2 / 2 (7.4s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 390 — Shapes → Rectangle → Select → Fill and border colors → Stroke → Opacity `40` writes stroke rgba **0.4**; slider min **0**. `?testPdf=e2e-poly-vertices.pdf` at 390 — Select imported 4-vertex polygon → same picker writes stroke **0.4**; slider min **0**; no Polygon create button
- Break: hubPreview Open stroke color picker **0**; 1440 Open stroke color picker **0**
- Edge: viewBox `0 0 612 792`; `file.id` null; no invent create-poly tool

Pre-fix probe: slider min **100**, typing 40 stayed **100**.

Node `mobileStrokeMinOpacity` proves `clampOpacityPercent(40, 0) === 40`, mobile `minOpacity: 0` + one-visible bump, AppShell Border `minOpacity={0}` stays, isolated 8448 / 75/250 standing.

Focused Node `mobileStrokeMinOpacity` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- 390 mobile stroke Color Opacity floor lifted — not a leftover
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
