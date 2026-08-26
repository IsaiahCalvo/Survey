# Imported FreeText /DS text-align vs leftover left — 2026-08-26

## Leftover taken

Not leftover-18. Live imported FreeText 13246R on `package2-rev4.pdf` page 6 already had native `/DS` `text-align: center` and no `/Q`, but import leftover-dropped that align so the textbox painted leftover-left until Text alignment was re-touched. Product `b8690a09`. Distinct from leftover-18, imported Underline / StrikeOut `/QuadPoints` (`002e59e1`), imported Highlight `/CA` (`c1bfc00a`), imported FreeText `/RC` (`b1303706`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`), package2 Ink `/AP` stroke union (`662f01ce`), imported-outline Width restroke, inventing a richTextEditor, and the four exhausted hunts. `convertFreeTextToFabricTextbox` now stamps `textAlign` from `/RC`, then merged `/Q`+`/DS`, then a local `/DS` parse.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. Did **not** take fontFamily Helv vs Arial (richTextEditor). HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Official Square reimport miss | official test + live first-create | **spec-only flake** — not taken, not aligned down |
| Imported Highlight `/CA` leftover hex | se011 4636R | already landed (`c1bfc00a`) |
| Imported FreeText 4631R `/RC` vs leftover `/DS` | se011 | already landed (`b1303706`) — leftover left matches native `/DS` left |
| package2 page 9 Ink `/AP` stroke union | package2-rev4 | already landed (`662f01ce`) |
| Imported Square / Circle / Polygon stroke `/CA` | fixtures | already landed |
| Imported filled Ink `/CA` × AP fillAlpha | clickable-link-test 67R | already landed (`6cece8fe`) |
| Imported PolyLine 51R | clickable-link-test | native `/CA` 1, **no** `/ca` — not a leftover |
| Imported Line | se011 / clickable / kal412 / package2 | **0** Line annots — not a leftover |
| Imported Stamp | kal412 11R | unsupported notice — not a leftover |
| Imported Squiggly / Highlight leftover `/Rect` | clickable 39R / se011 4636R | leftover `/Rect` padding **~2pt** — not leftover-wide like 4638R; not taken |
| Imported Underline / StrikeOut leftover `/Rect` | se011 4638R / 4640R | already landed (`002e59e1`) |
| **Imported FreeText 13246R leftover left vs `/DS` center** | `?testPdf=package2-rev4.pdf` page 6 | **LIVE leftover** — native `/DS` `text-align:center`; leftover painted **left** |

Live `/?testPdf=package2-rev4.pdf` at 1440 — imported FreeText `13246R` textAlign **center** (not leftover left); page jump invents 0 extra 13246R; hubPreview Color **0**; `file.id` null; viewBox **`0 0 …`**. 390 edge: viewBox / `file.id` / no invent / Text create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedFreetextDsAlign.test.mjs`
- `debug/scenarios/e2e-imported-freetext-ds-align.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-freetext-ds-align-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-freetext-ds-align.spec.mjs` **2 / 2 (9.6s)**.

- Intended: imported FreeText `13246R` textAlign **center** (not leftover left)
- Break: page jump invents 0 extra 13246R; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Text create **0**; textAlign still **center**

Focused Node `pdfImportedFreetextDsAlign` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

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
