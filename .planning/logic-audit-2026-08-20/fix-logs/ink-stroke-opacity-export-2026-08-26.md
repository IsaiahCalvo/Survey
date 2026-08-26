# Imported Ink Color Opacity export dict /CA — 2026-08-26

## Leftover taken

Color Opacity on a selected imported stroked Ink (selection maps to pen Color Opacity). Live toolbar already wrote rgba stroke and flatten already applied `borderOpacity`, but `createInkAnnotation` wrote hex `/C` + AP ExtGState only. Viewers that regenerate from `/InkList` + `/C`, and the importer (`extractAnnotationOpacity` reads dict `/CA`), stayed opaque until Opacity was re-touched. Same class as Line/PolyLine `/CA`. Distinct from leftover-18, filled paper-ink flatten `/CA` (`createFilledPaperInkAnnotation` already writes dict `CA`), Pen first-stroke opacity compose, and Polygon `/IC` `/AP` `/ca` (`61a8c33b`). Did **not** invent a create-ink tool.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after imported Polygon Fill Opacity (`c685f403` / product `61a8c33b`).

| Key | Toolbar | Verdict |
|---|---|---|
| Imported stroked Ink `/C` without dict `/CA` | selected imported Ink Color Opacity | **LIVE leftover** — screen rgba 0.4; export wrote hex `/C` + AP ExtGState only |
| Filled paper-ink flatten `/CA` | Highlighter / Pen fill | **aligned** — `createFilledPaperInkAnnotation` already writes dict `CA` |
| Highlight / Squiggly / Underline / StrikeOut restyle | — | select-delete-only; no live Style / Color / Opacity / Width toolbar |
| Stamp / FileAttachment | — | compile-hidden; no live toolbar |
| Square / Circle Style dash dict `/BS` | Style Dashed | dash lives in `/AP` stream only — confirm LIVE Acrobat/reimport drop before taking |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| Square import of `/AP` `/ca` without app metadata | — | Survey-to-Survey reimport uses metadata — not LIVE on `?testPdf=` of our export |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** replay Polygon `/IC` `/AP` `/ca`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- `createInkAnnotation` — faded imported stroked Ink writes dict `/CA` from live stroke alpha
- `/C` stays the stroke RGB; `/CA` carries the fade (same contract as Line / PolyLine)
- Opaque omits `/CA` so default export stays byte-identical
- Filled paper-ink path unchanged (`createFilledPaperInkAnnotation` already writes dict `CA`)

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a create-ink tool.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-ink-stroke-opacity-export.spec.mjs` **2 / 2 (7.1s)**.

- Intended: `?testPdf=kal405-ink-dots.pdf` → Select imported control stroke `kal405-control-normal-stroke` → Color Opacity `40` writes stroke rgba **0.4**; Export writes Ink dict `/CA` **0.4**; `?testPdf=` reimport keeps fade ~0.4; `file.id` null; viewBox `0 0 400 320`; no Ink create button
- Break: empty export invents 0 fade on the control stroke; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; no Ink create button

Node `pdfInkStrokeOpacityExport` proves selected-patch rgba stroke 0.4, Ink dict `/CA` 0.4, opaque omits `/CA`, flatten `/ca` 0.4 without inventing a paper-ink fill.

Focused Node `pdfInkStrokeOpacityExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Imported stroked Ink Color Opacity now writes dict `/CA` — not a leftover
- Imported Polygon non-cloud Fill Opacity now writes `/IC` + faded `/AP` `/ca` — not a leftover
- Imported Polygon non-cloud Style dash / Color Opacity now writes `/BS` + `/CA`; desktop Border Opacity floor lifted — not a leftover
- 390 mobile stroke Color Opacity floor lifted — not a leftover
- Imported PolyLine Style dash / Color Opacity now writes `/BS` + `/CA` — not a leftover
- Imported Polygon Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Square Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Cloud stroke `/CA` already rides `needsFade` — not a leftover
- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Other `isCloud` skips checked prior pass — Square + Polygon Cloud already attach faded `/AP`
- Highlight / Squiggly / Underline / StrikeOut — select-delete-only; no live restyle toolbar
- Stamp / FileAttachment — compile-hidden
- Square / Circle Style dash dict `/BS` — dash lives in `/AP` stream only; confirm LIVE Acrobat/reimport drop before taking
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
