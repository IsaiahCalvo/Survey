# Cloud Bump export Square /BE + /AP when I > 2 — 2026-08-26

## Leftover taken

Cloud Bump on the live Style Cloud rectangle. Live toolbar already wrote Style Cloud `/BE` + Bump 1–20, persist already stamped `pdfCloudIntensity`, and flatten already rebuilt the scallops, but `createSquareAnnotation` skipped `/AP` unless fill or stroke faded. PDF `/BE/I` is only 0–2, so an opaque Bump 8 reached Acrobat clamped to 2 until Bump was re-touched. Distinct from leftover-18, Cloud Bump persist (`53d63a7c`), and Cloud Fill Opacity `/ca` (`26885c51`). Cloud stroke `/CA` already rides `needsFade` — confirmed live (fill opaque + stroke 0.4 writes AP `/CA` 0.4; both-fade writes `/ca` + `/CA`; stroke-only writes dict `/CA`) — not taken.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten / import / create-path leftover after Cloud Fill Opacity export (`38e167a3` / product `26885c51`).

| Key | Toolbar | Verdict |
|---|---|---|
| Cloud stroke Opacity export `/CA` | Style Cloud + Color Border Opacity | **aligned** — `needsFade` already attaches `/AP` + ExtGState `/CA`; stroke-only also writes dict `/CA` |
| Other `isCloud` skips that drop a live toolbar style | Style Cloud Bump 3–20 | **LIVE leftover** — persist / flatten already Bump 8; opaque export omitted `/AP` so `/BE/I` 8 is out of spec |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay Cloud Bump persist or Cloud Fill Opacity `/ca`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- Cloudy Square still writes `/BE` with the live Bump
- Attach faded or oversized `/AP` when `needsFade || needsOversizedBump` (`intensity > 2`)
- Opaque default bump 1–2 still **omit `/AP`** so viewers keep native `/BE` scallops
- Cloud path from `buildCloudPathCommands` of the form rect; fallback `0 0 w h re`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay Cloud Bump persist or Cloud Fill Opacity `/ca`.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-cloud-bump-export.spec.mjs` **2 / 2 (7.9s)**.

- Intended: Shapes → Rectangle → Style Cloud + Bump `8` + drag writes `pdfCloudIntensity` **8**; Export annotated PDF writes Square `/BE` `/I` **8** + `/AP`; `?testPdf=` reimport keeps Cloud + Bump 8; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Bump **0**
- Edge: 390 viewBox / `file.id` / no invent; Rectangle create if visible

Node `pdfCloudBumpExport` proves first-create Bump 8, oversized `/BE` `/I` 8 + `/AP`, opaque default bump 2 omits `/AP`, faded bump 2 still attaches `/AP` for `/ca`, flatten rebuilds scallops.

Focused Node `pdfCloudBumpExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
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
- Polygon `/IC` without alpha — live toolbar is Counter/rect/ellipse, no polygon tool
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
