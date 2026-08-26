# Textbox Style dash export `/AP` `[6 4] 0 d` — 2026-08-26

## Leftover taken

Style Dashed on a live Textbox whose Fill is faded. Live toolbar already stamped `strokeDashArray` `[6,4]`, export already wrote `/BS`, flatten already wrote `borderDashArray`, and Survey reimport already kept Dashed via metadata, but `attachCalloutFreeTextFillAppearance` painted fill+text only (`re f`, no stroke) so Acrobat used the faded `/AP` and stayed unframed until Style was re-touched. Same `[dash] 0 d` contract as Ellipse / Square `/AP`. Solid / absent omit the dash. Opaque fill still omits `/AP` so `/BS` stays the native path. Callout boxes pass no stroke — their leaders already write Line `/BS`.

**Line dash `/AP` and Callout leader dash `/AP` confirmed LIVE not leftovers.** Probe: dashed Line / Callout leaders write `/BS` `[6,4]` and have no `/AP`. Square `/AP` already writes `[6 4] 0 d`. Square / Circle dict `/BS` stays confirmed not a leftover.

Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Did **not** invent a create-poly / create-ink tool.

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live persist / export / flatten leftover after Ellipse `/AP` dash (`e552ec84` / product `cbd564c1`).

| Key | Toolbar | Verdict |
|---|---|---|
| Textbox faded-fill `/AP` dash / Border | Style Dashed + Fill Opacity | **LIVE leftover** — screen `[6,4]`; `/BS` + flatten already dashed; `/AP` painted `re f` only |
| Line Style dash `/AP` | Style Dashed | **not a leftover** — no `/AP`; native `/BS` `[6,4]` |
| Callout leader dash `/AP` | Style Dashed | **not a leftover** — Line pieces write `/BS`; no `/AP` |
| Square `/AP` dash | Style Dashed | **aligned** — `attachIndependentShapeAppearance` already writes `[6 4] 0 d` |
| Square / Circle Style dash dict `/BS` | Style Dashed | **not a leftover** — reimport keeps dash via `/AP` + metadata |
| Imported Polygon / PolyLine flatten dash | Style Dashed | **aligned** — already writes `borderDashArray` |
| Cloud flatten dash | Style Cloud | **not live** — Cloud and Dashed are exclusive |
| Imported Ink flatten dash | — | Pen has no Style toolbar |
| Highlight / Squiggly / Underline / StrikeOut restyle | — | select-delete-only; no live Style / Color / Opacity / Width toolbar |
| Stamp / FileAttachment | — | compile-hidden; no live toolbar |
| Official `annotationContextMenuitem` leftover official vs spec Enter | — | source already has Enter — **not taken** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`.

## Product

`src/utils/pdfAnnotationsPdfLib.js` (not high-risk):

- `attachCalloutFreeTextFillAppearance` — faded-fill `/AP` now strokes the live Border; dashed / dotted write `[dash] 0 d` from `resolveTextboxBoxStroke`
- Solid / absent omit the dash so default faded-fill export stays byte-identical except the added stroke when Border is visible
- Opaque fill still omits `/AP`; `/BS` unchanged
- Callout boxes pass no stroke — `/AP` stays fill+text

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** invent a Line `/AP` leftover. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-dash-export-ap.spec.mjs` **2 / 2 (8.9s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Text → Style Dashed + Color Fill Opacity 40 writes `strokeDashArray` **[6,4]** + fill rgba **0.4**; Export writes FreeText `/AP` `[6 4] 0 d` and keeps `/BS`; `?testPdf=` reimport keeps Dashed + fade; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0 textboxes; hubPreview Style **0**
- Edge: 390 viewBox / `file.id` / no invent; Text Style Dashed still stamps `[6,4]` when reachable

Node `pdfTextboxDashExportAp` proves faded Dashed `[6,4]` writes `/AP` `[6 4] 0 d` and keeps `/BS`; faded solid `/AP` strokes without a non-empty dash; opaque dashed omits `/AP`.

Focused Node `pdfTextboxDashExportAp` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Textbox faded-fill Style dash now writes `/AP` `[6 4] 0 d` — not a leftover
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
