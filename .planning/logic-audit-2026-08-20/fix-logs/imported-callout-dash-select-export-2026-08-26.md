# Imported FreeTextCallout /BS /D Select Width export — 2026-08-26

## Leftover taken

Not leftover-18. Live imported FreeTextCallout with native `/BS` `/S` `/D` `[6 4]` leftover-omitted `lineStyle` so the adapter leftover-painted solid. Select Width then leftover-mapped the callout group through `legacyArrowGroupToLine` and leftover-replaced native dashed `/BS` with leftover-solid `/Line` (no `/BS`, no box). Product now stamps `/D` as `lineStyle: dashed` on Callout import (same contract as Square / Circle / Line) and excludes callout groups from the leftover Line mapper. Distinct from leftover-18, Square / Circle dash (`3b04c6e9` / `46f1e443`), imported Line / Poly dash (class 18/19), imported Arrow `/LE` OpenArrow (`c1b2f79f`), and inventing Line `/AP`.

Did **not** invent Circle / Diamond / Butt endings, Line `/AP`, stamp renderer, Note/Link create, create-poly tool, Font family chrome, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, leftover-18 hosts, or stamp `file.id`. HIGH-RISK files not touched.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Imported FreeTextCallout /BS /D then Select Width export** | `?testPdf=e2e-imported-callout-dash.pdf` | **LIVE leftover** — import leftover-omitted `lineStyle`; Select Width leftover-replaced native dashed `/BS` with leftover-solid `/Line` |
| **Imported Ink /BS dash** | convertInk uses `/AP` paint dash | **not taken** — no NEW leftover vs class 16/19 |
| **Cloud rotate then Select/export** | source `createSquareAnnotation` | **not taken** — cloud `/AP` `/Matrix` already rides `needsRotate` |
| leftover-18 | — | **not taken** |

Live `/?testPdf=e2e-imported-callout-dash.pdf` at 1440 — Select Callout Width **8** keeps `lineStyle` **dashed**; Export annotated PDF keeps `/BS` **`[6 4]`** (not leftover-solid Line). hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: hex / Font chrome **0**.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `src/utils/calloutImportAdapter.js`
- `src/utils/pdfAnnotationsPdfLib.js`
- `scripts/e2e-imported-callout-dash-fixture.mjs`
- `debug/fixtures/e2e-imported-callout-dash.pdf`
- `tests/pdfImportedCalloutDashSelectExport.test.mjs`
- `tests/afterImportedCalloutDashSelectHunt.test.mjs`
- `debug/scenarios/e2e-imported-callout-dash-select-export.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-callout-dash-select-export-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not in the high-risk list. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Fresh Vite `http://127.0.0.1:5178` (HTTP 200; 5173/5177 were stale). Playwright `e2e-imported-callout-dash-select-export.spec.mjs` **2 / 2 (5.6s)**.

- Intended: imported Callout Select Width 8 keeps `/BS` `[6 4]` (not leftover-solid Line)
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox **`0 0 612 792`**; `file.id` null; hex / Font chrome **0**

Focused Node `afterImportedCalloutDashSelectHunt` + `pdfImportedCalloutDashSelectExport` + leftover18FailClosed **21 / 21**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Official Square reimport miss stays spec-only flake — not taken, not aligned down. Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Imported Ink `/BS` dash — convertInk uses `/AP` paint dash; not taken
- Cloud rotate then Select/export persist — source already aligned; not taken
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Leftover-18 human-gated stay parked. Parent owns PR 800.
