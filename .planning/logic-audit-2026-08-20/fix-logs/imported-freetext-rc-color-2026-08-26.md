# Imported FreeText /RC independent of leftover /DS — 2026-08-26

## Leftover taken

Not leftover-18. Live imported FreeTextCallout 4631R on `se011.pdf` already had native `/RC` **#1172E8** and leftover `/DS` **#9643FC** (DA the same purple), but import preferred leftover `/DS` so the screen painted text **purple** until Color was re-touched. Product `b1303706`. Distinct from leftover-18, imported Ink/Polygon/PolyLine dash+opacity export, Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`), imported-outline Width restroke, inventing a richTextEditor, and the four exhausted hunts. `/RC` was already parsed into `defaultAppearanceData`; `convertFreeTextToFabricTextbox` just preferred leftover `/DS`.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Imported Square 55R / cloud 59R / Polygon 63R | `?testPdf=clickable-link-test.pdf` | already landed (`8dfe219d` / `29458ffa`) — stroke **1** |
| Imported Ink 67R fill /CA × AP fillAlpha | same fixture | already landed (`6cece8fe`) — fill **~0.35** |
| Imported PolyLine 51R | same fixture | native `/CA` 1, **no** `/ca`; screen stroke already **1** — not a leftover |
| se011 Highlight 4636R | `?testPdf=se011.pdf` | `/CA` 0.40, no `/ca`; visual `opacity` **0.399994** — already aligned |
| se011 Polygon 4549R | same fixture | same `/CA` 1 / `/ca` 0.30 class as 63R — already landed |
| package2 / kal412 Line | fixtures | no Line annots — not this leftover |
| kal441 / clickable Widget | fixtures | form-field owned; importer silent-ignore — not a leftover |
| kal412 Stamp | fixture | unsupported notice (no `/CA`/`/ca`) — not this leftover |
| **Imported FreeText 4631R /RC vs leftover /DS** | `?testPdf=se011.pdf` page 3 | **LIVE leftover** — native `/RC` #1172E8 + `/DS` #9643FC; screen text was leftover **purple** |
| leftover-18 human-gated | — | **not taken** |

Live `/?testPdf=se011.pdf` at 1440 — imported FreeTextCallout `4631R` fontColor **#1172e8** (not leftover **#9643fc**); page jump invents 0 extra 4631R; hubPreview Color **0**; `file.id` null; viewBox **`0 0 1224 792`**. 390 edge: viewBox / `file.id` / no invent / Callout create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedFreetextRcColor.test.mjs`
- `debug/scenarios/e2e-imported-freetext-rc-color.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-freetext-rc-color-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-freetext-rc-color.spec.mjs` **2 / 2 (6.6s)**.

- Intended: imported FreeText `4631R` fontColor **#1172e8** (not leftover **#9643fc**)
- Break: page jump invents 0 extra 4631R; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Callout create **0**; fontColor still **#1172e8**

Focused Node `pdfImportedFreetextRcColor` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- package2 page 9 Ink `/AP` stroke union can throw `martinez` `depth` and skip the page — remaining, not taken
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
