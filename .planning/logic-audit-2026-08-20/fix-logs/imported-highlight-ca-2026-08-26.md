# Imported Highlight /CA baked into fill rgba — 2026-08-26

## Leftover taken

Not leftover-18. Live imported Highlight 4636R on `se011.pdf` already had native `/CA` **0.399994** and no `/ca`, but import leftover-split that fade onto leftover hex fill + `object.opacity` so Select read leftover **100** until Opacity was re-touched. Product `c1bfc00a`. Distinct from leftover-18, imported FreeText `/RC` (`b1303706`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`), package2 Ink `/AP` stroke union (`662f01ce`), imported-outline Width restroke, inventing a richTextEditor, and the four exhausted hunts. `convertSurveyMarkerToFabricRect` now bakes `/CA` into fill rgba like Square / Circle / Polygon / Ink and does not leftover-split onto `object.opacity` (export would leftover-multiply rgba × opacity).

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Official Square reimport miss (`exported app-created PDF annotations reimport`) | official test + export dump + live first-create | **spec-only flake** — test object omits `strokeWidth`; export writes Border `[0,0,0]`; import `allowExplicitZero` drops invisible Square. Live first-create stamps Width **3**. **Not taken, not aligned down.** |
| Imported Square / Circle / Polygon stroke `/CA` | fixtures | already landed |
| Imported filled Ink `/CA` × AP fillAlpha | clickable-link-test 67R | already landed (`6cece8fe`) |
| Imported FreeText 4631R `/RC` vs leftover `/DS` | se011 | already landed (`b1303706`) |
| package2 page 9 Ink `/AP` stroke union | package2-rev4 | already landed (`662f01ce`) |
| Imported PolyLine 51R | clickable-link-test | native `/CA` 1, **no** `/ca` — not a leftover |
| se011 Polygon 4549R | se011 | same `/CA` 1 / `/ca` 0.30 class — already landed |
| **Imported Highlight 4636R `/CA` leftover hex** | `?testPdf=se011.pdf` page 1 | **LIVE leftover** — native `/CA` 0.40; leftover hex fill + `object.opacity`; Select leftover **100** |
| leftover-18 human-gated | — | **not taken** |

Live `/?testPdf=se011.pdf` at 1440 — imported Highlight `4636R` fill **~0.40** rgba (not leftover hex / leftover **100**); reload invents 0 extra 4636R; hubPreview Color **0**; `file.id` null; viewBox **`0 0 …`**. 390 edge: viewBox / `file.id` / no invent / Highlight create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedHighlightCa.test.mjs`
- `debug/scenarios/e2e-imported-highlight-ca.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-highlight-ca-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-highlight-ca.spec.mjs` **2 / 2 (6.7s)**.

- Intended: imported Highlight `4636R` fill **~0.40** rgba (not leftover hex)
- Break: reload invents 0 extra 4636R; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Highlight create **0**; fill still **~0.40**

Focused Node `pdfImportedHighlightCa` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Official Square reimport miss stays a spec-only flake (test object omits Width; live first-create stamps Width 3) — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
