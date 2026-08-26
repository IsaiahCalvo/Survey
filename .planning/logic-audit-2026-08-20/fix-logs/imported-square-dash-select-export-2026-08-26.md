# Imported Square / Circle /BS /D Select Width export — 2026-08-26

## Leftover taken

Not leftover-18. Live imported Square with native `/BS` `/S` `/D` `[6 4]` leftover-omitted `strokeDashArray` so the screen painted leftover-solid. Select Width then leftover-replaced native dashed `/BS` with leftover-solid `/AP`. Product now stamps `/D` on Square / Circle import (same contract as Line / PolyLine / Polygon). Distinct from leftover-18, Square rotate (class 16), imported Polygon Width/dash (`c1f129ca`), imported Arrow `/LE` OpenArrow (`c1b2f79f`), and inventing Square / Circle dict `/BS`.

Did **not** invent Circle / Diamond / Butt endings, Line `/AP`, stamp renderer, Note/Link create, create-poly tool, Font family chrome, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, leftover-18 hosts, or stamp `file.id`. HIGH-RISK files not touched.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Imported Square / Circle /BS /D then Select Width export** | `?testPdf=e2e-imported-square-dash.pdf` Square | **LIVE leftover** — import leftover-omitted `strokeDashArray`; Select Width **8** + `edited`; leftover export `/AP` solid |
| **Cloud rotate then Select/export** | source `createSquareAnnotation` | **not taken** — cloud `/AP` `/Matrix` already rides `needsRotate` |
| **Highlighter first-create after Cloud** | — | **not taken** — no NEW leftover vs class 13/18 |
| **Callout imported `/LE` after Select Width** | se011 4631R | **not taken** — `openTriangle` already landed `bed94263` |
| leftover-18 | — | **not taken** |

Live `/?testPdf=e2e-imported-square-dash.pdf` at 1440 — Select Square Width **8** writes `[6,4]` + `edited`; Export annotated PDF writes `/Square` `/AP` **`[6 4] 0 d`** + `/Border` **8**. hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: hex / Font chrome **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `scripts/e2e-imported-square-dash-fixture.mjs`
- `debug/fixtures/e2e-imported-square-dash.pdf`
- `tests/pdfImportedSquareDashSelectExport.test.mjs`
- `tests/afterImportedSquareDashSelectHunt.test.mjs`
- `debug/scenarios/e2e-imported-square-dash-select-export.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-square-dash-select-export-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not in the high-risk list. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-square-dash-select-export.spec.mjs` pending this-pass run.

- Intended: imported Square Select Width 8 keeps `/AP` `[6 4] 0 d` (not leftover-solid)
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox **`0 0 612 792`**; `file.id` null; hex / Font chrome **0**

Focused Node `afterImportedSquareDashSelectHunt` + `pdfImportedSquareDashSelectExport` + leftover18FailClosed **20 / 20**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Official Square reimport miss stays spec-only flake — not taken, not aligned down. Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Cloud rotate then Select/export persist — source already aligned; not taken
- Highlighter first-create after Cloud — no NEW leftover vs class 13/18; not taken
- Callout imported `/LE` after Select Width — already landed; not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Leftover-18 human-gated stay parked. Parent owns PR 800.
