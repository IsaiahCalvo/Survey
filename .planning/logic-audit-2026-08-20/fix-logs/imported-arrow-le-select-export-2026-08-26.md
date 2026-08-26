# Imported Arrow /LE Select Width export — 2026-08-26

## Leftover taken

Not leftover-18. Live imported Line with native `/LE` **OpenArrow** already mapped to Arrow (`tool: 'arrow'`) and kept `pdfLineEndings`, but import leftover-omitted `data.arrowheadStyle` so SVG + `resolveExportedLineEnding2` leftover-defaulted **ClosedArrow**. Select Width then leftover-replaced native `/LE` OpenArrow with ClosedArrow. Product now stamps `openTriangle` on import and prefers imported `/LE` before the live Arrow default. Distinct from leftover-18, imported Line Width/dash (`3b5bbbc4`), callout `/LE` OpenArrow, and inventing Line `/AP`.

Did **not** invent Circle / Diamond / Butt endings, Line `/AP`, stamp renderer, Note/Link create, create-poly tool, Font family chrome, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, leftover-18 hosts, or stamp `file.id`. HIGH-RISK files not touched.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Imported Arrow /LE OpenArrow then Select Width export** | `?testPdf=e2e-imported-arrow-le.pdf` 5R | **LIVE leftover** — import `pdfLineEndings` `['None','OpenArrow']` + `tool: 'arrow'`; leftover `arrowheadStyle` undefined; Select Width **8** + `edited`; leftover export `/LE` `ClosedArrow` |
| **Cloud rotate then Select/export** | source `createSquareAnnotation` | **not taken** — cloud `/AP` `/Matrix` already rides `needsRotate` |
| **Highlighter first-create after Cloud** | — | **not taken** — no NEW leftover vs class 13/18 |
| leftover-18 | — | **not taken** |

Live `/?testPdf=e2e-imported-arrow-le.pdf` at 1440 — Select Arrow `5R` Width **8** writes `openTriangle` + `edited`; Export annotated PDF writes `/Line` `/LE` **OpenArrow** + `/Border` **8**. hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: hex / Font chrome **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `src/utils/pdfAnnotationsPdfLib.js`
- `scripts/e2e-imported-arrow-le-fixture.mjs`
- `debug/fixtures/e2e-imported-arrow-le.pdf`
- `tests/pdfImportedArrowLeSelectExport.test.mjs`
- `tests/afterImportedArrowLeSelectHunt.test.mjs`
- `debug/scenarios/e2e-imported-arrow-le-select-export.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-arrow-le-select-export-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not in the high-risk list. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-arrow-le-select-export.spec.mjs` **2 / 2 (5.0s)**.

- Intended: imported Arrow Select Width 8 keeps `/LE` OpenArrow (not leftover ClosedArrow)
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox **`0 0 612 792`**; `file.id` null; hex / Font chrome **0**

Focused Node `afterImportedArrowLeSelectHunt` + `pdfImportedArrowLeSelectExport` + leftover18FailClosed **18 / 18**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Official Square reimport miss stays spec-only flake — not taken, not aligned down. Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Cloud rotate then Select/export persist — source already aligned; not taken
- Highlighter first-create after Cloud — no NEW leftover vs class 13/18; not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Leftover-18 human-gated stay parked. Parent owns PR 800.
