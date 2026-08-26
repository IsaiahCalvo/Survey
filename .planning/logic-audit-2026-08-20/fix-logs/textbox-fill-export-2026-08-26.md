# Textbox backgroundColor FreeText /C + flatten — 2026-08-26

## Leftover taken

Textbox Fill (`backgroundColor`, often `rgba()` from `composeColorForPatch`) dropped on print flatten and opacity-0 still wrote FreeText `/C`. Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from callout `fillColor` export (`d623243d`), textbox `textAlign` export (`29bce7bb`), and textbox `verticalAlign` export (`c226548a`).

P1-12 (`historyHelpers.js` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx` Match Fill ring) — **already fixed**.
P1-53 (`syncStatusViewModel.js` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + `pdfAppAnnotationMetadata.js` `STYLE_KEYS` against live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| callout `fillColor` / `fillOpacity` | Color Fill tab | Already `/C` + flatten (`d623243d`) — not replayed |
| callout Stroke / Width | Color Border + Size | Toolbar maps to `borderColor` / `lineThickness`; writers read those — **aligned** |
| shape `fill` | Color Fill tab | Writers already read `fabricObj.fill` — aligned |
| `textAlign` | Text alignment 3×3 | Already `/Q` + flatten — not replayed |
| `verticalAlign` | Text alignment 3×3 | Already metadata + flatten — not replayed |
| **textbox `backgroundColor`** | Color Fill tab | **LIVE leftover** — flatten drew glyphs only; opacity-0 rgba still wrote `/C` |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** treat glyph `fill` as a leftover box fill. Did **not** take C-01 (Fill spectrum only; no swatch / hex / Transparent). Did **not** stamp `file.id`.

## Product

`createFreeTextAnnotation` treated any non-`'transparent'` `backgroundColor` as `/C`, so `rgba(r,g,b,0)` still exported a yellow box. `drawFlattenedText` never painted `backgroundColor`, so a user-picked Fill never printed.

Min-viable:

- `src/utils/annotationStyleCatalog.js` — `resolveTextboxBoxFill` (live `backgroundColor` hex/rgba; ignore glyph `fill`)
- `src/utils/pdfAnnotationsPdfLib.js` — write `/C` only when visible; flatten paints the box first

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay callout fill, `textAlign`, or `verticalAlign`.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-textbox-fill-export.spec.mjs` **2 / 2 (10.0s)**.

- Intended: Text + type `Y` + Color Fill spectrum + Export annotated PDF writes FreeText `/C` from live `backgroundColor`; `?testPdf=` reimport keeps `backgroundColor`; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfTextboxFillExport` also proves rgba `#FFFF00` `/C` `[1,1,0]`, empty/opacity-0 omit `/C`, flatten yellow vs no invented white, glyph `fill` ignored.

Focused Node `pdfTextboxFillExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Callout Stroke / Width already maps `strokeColor` → `borderColor` / `lineThickness` — not a leftover
- Shape Fill already writes `fill` — not a leftover
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
- Font color / Bold / Italic (0 without richTextEditor)
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
