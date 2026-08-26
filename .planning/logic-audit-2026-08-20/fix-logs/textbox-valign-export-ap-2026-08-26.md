# Textbox verticalAlign export `/AP` Tm y — 2026-08-26

## Leftover taken

Text alignment middle/bottom on a live Textbox whose Fill is faded. Live toolbar already stamped `verticalAlign`, export already wrote SurveyAppAnnotation metadata, and flatten already honored `flattenedTextBlockOffset`, but `attachCalloutFreeTextFillAppearance` painted glyphs at `y = formHeight - size - 4` so Acrobat used the faded `/AP` and stayed top-aligned until Fill was re-touched opaque (which omits `/AP`). There is no `/Q` counterpart. Top / absent stay at that leftover y. Opaque fill still omits `/AP`. Do not invent a richTextEditor.

**Callout faded-fill `/AP` shares this writer** — callouts do not carry `verticalAlign` (only `style.textAlign`); do not invent a callout verticalAlign pass-through. Line / Callout leader dash `/AP` stay confirmed LIVE not leftovers (no `/AP`; native `/BS`). Square / Circle dict `/BS` stays confirmed not a leftover.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Did **not** invent a create-poly / create-ink tool.

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after textbox faded-fill `/AP` textAlign (`5f8ffb4a` / product `4c2bfe8e`). Last hunter nominated faded-fill `/AP` verticalAlign. Probe proved it: faded bottom FreeText `/AP` Tm stayed at leftover top until this pass wrote `flattenedTextBlockOffset` into Tm y.

| Key | Toolbar | Verdict |
|---|---|---|
| Textbox faded-fill `/AP` verticalAlign | Text alignment + Fill Opacity | **LIVE leftover** — screen + metadata + flatten already bottom; `/AP` painted leftover top |
| Callout faded-fill `/AP` verticalAlign | same writer | **not a leftover** — callouts have no `verticalAlign`; do not invent |
| Textbox verticalAlign metadata + flatten | Text alignment | **aligned** — product `c226548a` |
| Textbox faded-fill `/AP` textAlign | Text alignment + Fill Opacity | **aligned** — product `4c2bfe8e` |
| Textbox faded-fill `/AP` dash / Border | Style Dashed + Fill Opacity | **aligned** — product `4590d6b5` |
| Callout faded-fill box `/AP` dash | Style Dashed + Fill Opacity | **aligned** — product `3afd731d` |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` `[6,4]` |
| Callout leader dash `/AP` | Style Dashed | **not a leftover** — Line pieces write `/BS`; no `/AP` |
| Highlight / Squiggly / Underline / StrikeOut restyle | — | select-delete-only; no live Style / Color / Opacity / Width toolbar |
| Stamp / FileAttachment | — | compile-hidden; no live toolbar |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- `attachCalloutFreeTextFillAppearance` — faded FreeText `/AP` now places `Tm` y via `flattenedTextBlockOffset` (same helper flatten uses)
- `createFreeTextAnnotation` — passes live `fabricObj.verticalAlign` into that writer
- Top / absent stay at `formHeight - size - 4` so default faded-fill export stays byte-identical
- Opaque fill still omits `/AP`

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-valign-export-ap.spec.mjs` **2 / 2 (9.0s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → Text alignment `bottom left` + Color Fill Opacity 40 writes `verticalAlign` **bottom** + fill **0.4**; Export writes FreeText `/AP` Tm y **below leftover top** (near 4pt inset); `?testPdf=` reimport keeps bottom + fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 textboxes; hubPreview Text alignment **0**
- Edge: 390 viewBox / `file.id` / no invent; Text alignment still stamps when reachable

Node `pdfTextboxValignExportAp` proves faded bottom writes `/AP` Tm y **4** (leftover top on the 80pt fixture is **62**); faded top `/AP` stays at **62**; opaque bottom omits `/AP`.

Focused Node `pdfTextboxValignExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox faded-fill `/AP` verticalAlign now places Tm y via `flattenedTextBlockOffset` — not a leftover
- Callout faded-fill `/AP` verticalAlign — callouts have no `verticalAlign`; do not invent
- Textbox faded-fill `/AP` textAlign now places Tm x via `flattenedTextInlineOffset` — not a leftover
- Callout faded-fill `/AP` textAlign shares that writer — not a leftover
- Textbox faded-fill Style dash now writes `/AP` `[6 4] 0 d` — not a leftover
- Callout faded-fill Style dash now writes `/AP` `[6 4] 0 d` — not a leftover
- Ellipse / Circle Style dash export now writes `/AP` `[6 4] 0 d` — not a leftover
- Ellipse / Circle Style dash flatten now writes `borderDashArray` — not a leftover
- Line / Callout leader Style dash `/AP` — **confirmed not a leftover** (no `/AP`; native `/BS`)
- Square `/AP` dash — already aligned
- Square / Circle Style dash dict `/BS` — **confirmed not a leftover** (reimport keeps dash via `/AP` + metadata)
- Imported stroked Ink Color Opacity now writes dict `/CA` — not a leftover
- Imported Polygon non-cloud Fill Opacity now writes `/IC` + faded `/AP` `/ca` — not a leftover
- Imported Polygon non-cloud Style dash / Color Opacity now writes `/BS` + `/CA`; desktop Border Opacity floor lifted — not a leftover
- 390 mobile stroke Color Opacity floor lifted — not a leftover
- Imported PolyLine Style dash / Color Opacity now writes `/BS` + `/CA` — not a leftover
- Imported Polygon Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Square Cloud Bump > 2 now writes `/BE` + `/AP` — not a leftover
- Cloud stroke `/CA` already rides `needsFade` — not a leftover
- Cloud Fill Opacity export now writes `/BE` + faded `/AP` `/ca` — not a leftover
- Imported Polygon / PolyLine flatten dash — already writes `borderDashArray`
- Cloud flatten dash — Cloud and Dashed are exclusive
- Imported Ink flatten dash — Pen has no Style toolbar
- Highlight / Squiggly / Underline / StrikeOut — select-delete-only; no live restyle toolbar
- Stamp / FileAttachment — compile-hidden
- Nominated 0.08 / 0.2 view-floor family — **complete**
- Other `"0"` / empty-string falsy parsers — **aligned**
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Highlighter caret / text-highlight compile-hidden — not taken
- Square import of `/AP` `/ca` without app metadata — Survey-to-Survey uses metadata
- Other `/AP` stream writers checked this pass — FreeText fill `/AP` now honors dash + textAlign + verticalAlign; remaining `Tm` is the Counter pin label (already faded via GS1 `/ca`)
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
