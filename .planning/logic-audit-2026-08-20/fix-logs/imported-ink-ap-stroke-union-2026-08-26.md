# package2 page 9 Ink /AP stroke union martinez `depth` — 2026-08-26

## Leftover taken

Not leftover-18. Live import of `package2-rev4.pdf` page 9 threw martinez `Cannot read properties of undefined (reading 'depth')` inside `styledStrokeCommandsToPolygonSet` → `mergeStyledStrokeGeometries` union, and `processPage` leftover-skipped all **1520** annotations (`page-import-failed`). Product `662f01ce`. Distinct from leftover-18, imported FreeText `/RC` (`b1303706`), Square / Circle / Polygon stroke `/CA` (`8dfe219d` / `29458ffa`), imported filled Ink `/CA` (`6cece8fe`), imported-outline Width restroke, inventing a create-ink tool, and the four exhausted hunts. Import now keeps the live path for `/AP` strokes, isolates one converter throw, and concatenates un-unionable stroke polygons.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| Imported FreeText 4631R /RC vs leftover /DS | `?testPdf=se011.pdf` | already landed (`b1303706`) |
| Imported Square / Circle / Polygon stroke `/CA` | fixtures | already landed |
| Imported filled Ink `/CA` × AP fillAlpha | clickable-link-test 67R | already landed (`6cece8fe`) |
| **package2 page 9 Ink `/AP` stroke union** | `debug/fixtures/package2-rev4.pdf` | **LIVE leftover** — martinez `depth` → `page-import-failed`, 0 objects |
| leftover-18 human-gated | — | **not taken** |

Live `/?testPdf=package2-rev4.pdf` at 1440 — page 9 imported Ink count **stabilizes > 0** (not leftover **0** / `page-import-failed`); page jump invents 0 extra Inks; hubPreview Color **0**; `file.id` null; viewBox **`0 0 …`**. 390 edge: viewBox / `file.id` / no invent / Ink create **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `src/utils/paperAnnotationGeometry.js`
- `tests/pdfImportedInkApStrokeUnion.test.mjs`
- `debug/scenarios/e2e-imported-ink-ap-stroke-union.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-ink-ap-stroke-union-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-ink-ap-stroke-union.spec.mjs` **2 / 2 (12.9s)**.

- Intended: package2 page 9 imported Ink count **> 0** (not leftover page-import-failed **0**)
- Break: page jump invents 0 extra Inks; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Ink create **0**

Focused Node `pdfImportedInkApStrokeUnion` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
