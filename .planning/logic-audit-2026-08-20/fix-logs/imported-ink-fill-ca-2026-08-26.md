# Imported filled Ink /CA independent of leftover AP fillAlpha — 2026-08-26

## Leftover taken

Not leftover-18. Live imported filled Ink 67R on `clickable-link-test.pdf` already had native `/CA` **0.34902** and `/AP` fillAlpha **0.34902** (no dict `/ca`), but import leftover-multiplied both so the screen painted fill **0.12** until Opacity was re-touched. Product `6cece8fe`. Distinct from leftover-18, imported Ink/Polygon/PolyLine dash+opacity export (`37c41caf` / `28f352f4` / `61a8c33b`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported-outline Width restroke, and the four exhausted hunts. Prior 67R probe only ruled out the `/CA` vs `/ca` class (no `/ca`); it did not check the double-multiply leftover.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Imported Square 55R / cloud 59R / Polygon 63R | `?testPdf=clickable-link-test.pdf` | already landed (`8dfe219d` / `29458ffa`) — stroke **1** |
| Imported PolyLine 51R | same fixture | native `/CA` 1, **no** `/ca`; screen stroke already **1** — not a leftover |
| **Imported Ink 67R fill /CA × AP fillAlpha** | same fixture | **LIVE leftover** — native `/CA` 0.34902 + AP fillAlpha 0.34902; screen fill was leftover **0.1218** |
| se011 Highlight 4636R | `?testPdf=se011.pdf` | `/CA` 0.40, no `/ca`; visual `opacity` **0.399994** — already aligned |
| se011 Polygon 4549R | same fixture | same `/CA` 1 / `/ca` 0.30 class as 63R — already landed |
| package2 / kal412 / e2e-poly FreeText / Line | fixtures | no differing `/CA`+`/ca` pair — not this leftover |
| leftover-18 human-gated | — | **not taken** |

Live `/?testPdf=clickable-link-test.pdf` at 1440 — imported Ink `67R` fill **~0.35** (not leftover **0.12**); empty reload invents 0 extra Inks; hubPreview Color **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: viewBox / `file.id` / no invent / Ink create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedInkFillCa.test.mjs`
- `debug/scenarios/e2e-imported-ink-fill-ca.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-ink-fill-ca-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-ink-fill-ca.spec.mjs` **2 / 2 (5.6s)**.

- Intended: imported Ink `67R` fill **~0.35** (not leftover **0.12**)
- Break: reload invents 0 extra Inks; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Ink create **0**; fill still **~0.35**

Focused Node `pdfImportedInkFillCa` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
