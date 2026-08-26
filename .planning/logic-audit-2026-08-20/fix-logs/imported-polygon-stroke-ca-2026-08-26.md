# Imported Polygon stroke /CA independent of fill /ca — 2026-08-26

## Leftover taken

Not leftover-18. Live imported Polygon 63R on `clickable-link-test.pdf` already had native `/CA` **1** and `/ca` **~0.30**, but `extractAnnotationOpacity` preferred leftover fill `/ca` for the border so the screen painted stroke **0.30** until Border was re-touched. Product `29458ffa`. Distinct from leftover-18, imported Ink/Polygon/PolyLine dash+opacity export (`28f352f4` / `61a8c33b`), Square / Circle stroke `/CA` (`8dfe219d`), imported-outline Width restroke, and the four exhausted hunts.

Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, a create-poly or create-ink tool, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer import of fixture PDFs that are not Survey-to-Survey reimport of a just-drawn annot:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Imported Polygon 63R stroke /CA** | `?testPdf=clickable-link-test.pdf` | **LIVE leftover** — native `/CA` 1 / `/ca` 0.301961; screen stroke was leftover **0.301961** |
| Imported Square 55R / cloud 59R | same fixture | already landed (`8dfe219d`) — screen stroke **1** |
| Imported PolyLine 51R | same fixture | native `/CA` 1, **no** `/ca`; screen stroke already **1** — not a leftover |
| Imported Ink 67R | same fixture | `/CA` 0.34902, no `/ca`; filled appearance (`stroke` none) — not this class |
| kal412 / kal405 / e2e-poly dash | fixtures | already landed — not replayed |
| leftover-18 human-gated | — | **not taken** |

Live `/?testPdf=clickable-link-test.pdf` at 1440 — imported Polygon `63R` fill **~0.30** + stroke **~1** (not leftover **0.30**); empty reload invents 0 extra Polygons; hubPreview Color **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: viewBox / `file.id` / no invent / no Polygon create button.

## Files

- `src/utils/pdfAnnotationImporter.js`
- `tests/pdfImportedPolygonStrokeCa.test.mjs`
- `debug/scenarios/e2e-imported-polygon-stroke-ca.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-polygon-stroke-ca-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-imported-polygon-stroke-ca.spec.mjs` **2 / 2 (5.0s)**.

- Intended: imported Polygon `63R` fill **~0.30** + stroke **~1** (not leftover **0.30**)
- Break: reload invents 0 extra Polygons; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent / Polygon create **0**; stroke still **~1**

Focused Node `pdfImportedPolygonStrokeCa` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
