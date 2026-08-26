# Imported Underline / StrikeOut /QuadPoints vs leftover /Rect — 2026-08-26

## Leftover taken

Not leftover-18. Live imported StrikeOut 4638R / Underline 4640R on `se011.pdf` already had native `/QuadPoints` (word AABB), but import leftover-used padded `/Rect` so the painted bar was leftover-wide (**200** / **272** vs QuadPoints **180** / **252**) until the markup was deleted. Product `002e59e1`. Distinct from leftover-18, imported Highlight `/CA` (`c1bfc00a`), imported FreeText `/RC` (`b1303706`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`), package2 Ink `/AP` stroke union (`662f01ce`), imported-outline Width restroke, inventing a richTextEditor, and the four exhausted hunts. `convertUnderlineToFabricRect` now prefers `/QuadPoints` AABB and falls back to leftover `/Rect` only when QuadPoints are missing.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18. Did **not** invent Squiggly / Highlight QuadPoints leftovers (clickable / se011 Highlight leftover `/Rect` padding is ~2pt, not taken).

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Official Square reimport miss (`exported app-created PDF annotations reimport`) | official test + export dump + live first-create | **spec-only flake** — test object omits `strokeWidth`; export writes Border `[0,0,0]`; import `allowExplicitZero` drops invisible Square. Live first-create stamps Width **3**. **Not taken, not aligned down.** |
| Imported Highlight `/CA` leftover hex | se011 4636R | already landed (`c1bfc00a`) |
| Imported FreeText 4631R `/RC` vs leftover `/DS` | se011 | already landed (`b1303706`) |
| package2 page 9 Ink `/AP` stroke union | package2-rev4 | already landed (`662f01ce`) |
| Imported Square / Circle / Polygon stroke `/CA` | fixtures | already landed |
| Imported filled Ink `/CA` × AP fillAlpha | clickable-link-test 67R | already landed (`6cece8fe`) |
| Imported PolyLine 51R | clickable-link-test | native `/CA` 1, **no** `/ca` — not a leftover |
| Imported Line | se011 / clickable / kal412 | **0** Line annots — not a leftover |
| Imported Stamp | kal412 11R | unsupported notice — not a leftover |
| Imported Underline / StrikeOut leftover hex `/CA` | se011 + clickable | native `/CA` 1 or omitted — not a leftover fade |
| **Imported StrikeOut 4638R / Underline 4640R leftover `/Rect`** | `?testPdf=se011.pdf` page 1 | **LIVE leftover** — native `/QuadPoints` w **180** / **252**; leftover `/Rect` painted **200** / **272** |

Live `/?testPdf=se011.pdf` at 1440 — imported StrikeOut `4638R` visualWidth **~180** (not leftover **200**); Underline `4640R` visualWidth **~252** (not leftover **272**); reload invents 0 extra 4638R / 4640R; hubPreview Color **0**; `file.id` null; viewBox **`0 0 …`**. 390 edge: viewBox / `file.id` / no invent / Underline create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedUnderlineQuadPoints.test.mjs`
- `debug/scenarios/e2e-imported-underline-quadpoints.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-underline-quadpoints-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-underline-quadpoints.spec.mjs` **2 / 2 (6.8s)**.

- Intended: imported StrikeOut `4638R` visualWidth **~180**; Underline `4640R` visualWidth **~252** (not leftover `/Rect`)
- Break: reload invents 0 extra 4638R / 4640R; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Underline create **0**; StrikeOut width still **~180**

Focused Node `pdfImportedUnderlineQuadPoints` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Official Square reimport miss stays a spec-only flake (test object omits Width; live first-create stamps Width 3) — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
