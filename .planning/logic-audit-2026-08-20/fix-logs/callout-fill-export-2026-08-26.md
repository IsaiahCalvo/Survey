# Callout fillColor FreeText /C + flatten — 2026-08-26

## Leftover taken

Callout Fill (`style.fillColor` / `fillOpacity`) dropped on annotated PDF `/C` and print flatten. Not leftover-18. Not a name/`type`/row leftover. Not P1-12 / P1-38 / P1-53 (those stomp one-liners are already in tree). Distinct from textbox `textAlign` export (`29bce7bb`) and textbox `verticalAlign` export (`c226548a`).

P1-12 (`historyHelpers.js:124` `startsWith('excel:')`) — **already fixed**.
P1-38 (`CompactColorPicker.jsx:340` `Math.abs(localOpacity - matchOpacityPct) <= 1`) — **already fixed**.
P1-53 (`syncStatusViewModel.js:41-48` `pending` before queue-offline) — **already fixed**.

## Hunt (surfaces + keys)

Prefer next live export/flatten/persist bug. Checked `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + `pdfAppAnnotationMetadata.js` `STYLE_KEYS` against live toolbar:

| Key | Toolbar | Verdict |
|---|---|---|
| `textAlign` | Text alignment 3×3 | Already `/Q` + flatten (`29bce7bb`) — not replayed |
| `verticalAlign` | Text alignment 3×3 | Already metadata + flatten (`c226548a`) — not replayed |
| `fontWeight` / `fontStyle` | Bold / Italic | `/DA` + flatten already |
| `underline` / `linethrough` | Underline / Strike | Flatten decorations already; no `/DA` operator |
| `strokeDashArray` / callout `lineStyle` | Style Solid/Dashed/Dotted | `/BS` + flatten already |
| `rx` / `ry` | no dedicated toolbar | STYLE_KEYS already; flatten already |
| `opacity` (shape) | Color slider | already on writers |
| **callout `fillColor` / `fillOpacity`** | Color Fill tab | **LIVE leftover** — export/flatten read `backgroundColor` |

Did **not** invent envelope extras (`overline`, `direction`, `strokeDashOffset`, `textBackgroundColor`). Did **not** click swatch / hex / Transparent. Did **not** stamp `file.id`.

## Product

`createCalloutAnnotations` passed `style.backgroundColor` into FreeText `/C`. Live toolbar writes `style.fillColor`. `drawFlattenedCallout` used `style.backgroundColor \|\| '#ffffff'`, so a transparent on-screen box printed white and a user-picked fill never reached Acrobat/`?testPdf=` `/C`.

Min-viable:

- `src/utils/annotationStyleCatalog.js` — `resolveCalloutBoxFill` (live `fillColor`, leftover `backgroundColor`, `fillOpacity`)
- `src/utils/pdfAnnotationsPdfLib.js` — write `/C` from that hex; flatten the paint (transparent stays empty)

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Did **not** replay `textAlign` or `verticalAlign`.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-callout-fill-export.spec.mjs` **2 / 2 (7.8s)**.

- Intended: Text → Callout + type `Y` + Export annotated PDF writes FreeText `/C` matching next-draw Fill (`#FFFFFF` → `[1,1,1]`); `?testPdf=` reimport keeps `fillColor`; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent

Node `pdfCalloutFillExport` also proves `#FFFF00` `/C` `[1,1,0]`, leftover `backgroundColor`, transparent omit `/C`, flatten yellow vs no invented white, `fillOpacity` 0.4.

Focused Node `pdfCalloutFillExport` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null
- Subscription Manage / Usage tabs
- Create bookmark group / Add bookmarks to group dialog internals (exhausted)
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
