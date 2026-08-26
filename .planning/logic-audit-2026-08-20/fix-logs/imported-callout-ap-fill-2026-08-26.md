# Imported FreeTextCallout `/AP` box fill vs leftover transparent — 2026-08-26

## Leftover taken

Not leftover-18. Live imported FreeTextCallout 4631R on `se011.pdf` already had native `/AP` box fill (`0 g` + `B`, black, matching `/C`), but import leftover-required `/IC` so the adapter leftover-painted **transparent** / fillOpacity **0** until Fill was re-touched. Distinct from leftover-18, imported FreeTextCallout missing `/BS/W` Width (`9a40bfbe`), imported FreeTextCallout `/LE` OpenArrow (`bed94263`), imported FreeText `/DS` align (`b8690a09`), imported FreeText `/RC` (`b1303706`), imported Underline / StrikeOut `/QuadPoints` (`002e59e1`), imported Highlight `/CA` (`c1bfc00a`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`) + sourceWidth (`2ef84780`), package2 Ink `/AP` stroke union (`662f01ce`), imported-outline Width restroke, inventing Line `/AP`, and inventing a user-settable callout `verticalAlign`. Callout `/IC` still wins; visible `/AP` fill is the fallback. `/C` is still not the box (Drawboard leftover-painted text color as fill). Plain FreeText still ignores this `/AP` fill fallback.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-ink tool, or a name/`type`/row leftover. Did **not** take fontFamily Helv vs Arial (richTextEditor). Did **not** take imported-outline Width restroke. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Official Square reimport miss | official test + live first-create | **spec-only flake** — not taken, not aligned down |
| Imported Highlight `/CA` leftover hex | se011 4636R | already landed (`c1bfc00a`) |
| Imported FreeText 4631R `/RC` vs leftover `/DS` | se011 | already landed (`b1303706`) |
| Imported FreeText 13246R leftover left vs `/DS` center | package2-rev4 page 6 | already landed (`b8690a09`) |
| package2 page 9 Ink `/AP` stroke union | package2-rev4 | already landed (`662f01ce`) |
| Imported Square / Circle / Polygon stroke `/CA` | fixtures | already landed |
| Imported filled Ink `/CA` × AP fillAlpha | clickable-link-test 67R | already landed (`6cece8fe`) |
| Imported filled Ink 67R leftover Width 3 vs `/BS/W` 18 | clickable-link-test | already landed (`2ef84780`) |
| Imported FreeTextCallout 4631R leftover solidTriangle vs `/LE` OpenArrow | se011 page 3 | already landed (`bed94263`) |
| Imported FreeTextCallout 4631R leftover Width 2 vs native default 1 | se011 page 3 | already landed (`9a40bfbe`) |
| Imported PolyLine 51R | clickable-link-test | native `/CA` 1, **no** `/LE` — not a leftover |
| Imported Line | se011 / clickable / kal412 / package2 | **0** Line annots — not a leftover |
| Imported Stamp | kal412 11R | unsupported notice — not a leftover |
| Imported Squiggly / Highlight leftover `/Rect` | clickable 39R / se011 4636R | leftover `/Rect` padding **~2pt** — not leftover-wide; not taken |
| 4631R `/RD` unused | se011 | appearance already extracted the inner box (107×43.81) — not a leftover |
| Cloud `I=null` → 2 | clickable 59R / se011 4549R | `/AP` already paints substantial scallops — not a leftover |
| package2 FreeText 13246R fontFamily Helv vs `/DS` Arial | package2-rev4 | not taken (richTextEditor) |
| 13246R `/DS` `text-valign: top` | package2-rev4 | default is already **top** — not a leftover |
| package2 Square 3408R Contents "Submitted" | package2-rev4 | no `/AP`; AutoCAD SHX title; skip/proxy — not a leftover |
| **Imported FreeTextCallout 4631R leftover transparent vs `/AP` black fill** | `?testPdf=se011.pdf` page 3 | **LIVE leftover** — Select Fill leftover **0** / transparent; native `/AP` `0 g` + `B` **black** |

Live `/?testPdf=se011.pdf` at 1440 — imported callout `4631R` fillOpacity **1** / fillColor **#000000** (not leftover **0** / transparent); page jump invents 0 extra 4631R; hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 1224 792`**. 390 edge: viewBox / `file.id` / no invent / Callout create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedCalloutApFill.test.mjs`
- `debug/scenarios/e2e-imported-callout-ap-fill.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-callout-ap-fill-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-callout-ap-fill.spec.mjs` **2 / 2 (7.5s)**.

- Intended: imported callout `4631R` fillOpacity **1** / fillColor **#000000** (not leftover **0** / transparent)
- Break: page jump invents 0 extra 4631R; hubPreview Color / Width **0**
- Edge: 390 viewBox / `file.id` / no invent / Callout create **0**

Focused Node `pdfImportedCalloutApFill` + leftover18FailClosed **18 / 18**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. Official Square reimport miss confirmed spec-only flake — not taken, not aligned down.

## Hunt remaining unique leftovers (NOT leftover-18)

- Official Square reimport miss stays a spec-only flake (test object omits Width; live first-create stamps Width 3) — not taken, not aligned down
- Squiggly / Highlight leftover `/Rect` padding stays ~2pt — not leftover-wide; not taken
- package2 FreeText 13246R fontFamily leftover **Helv** vs `/DS` **Arial** — not taken (richTextEditor)
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
