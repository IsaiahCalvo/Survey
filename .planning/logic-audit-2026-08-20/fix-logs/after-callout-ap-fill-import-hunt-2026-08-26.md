# Hunt imported leftovers after callout `/AP` fill — 2026-08-26

## Leftover taken

**None.** Genuine hunt of imported-fixture opacity / color / dash / geometry / align / width / arrowhead / fill drops after tip `715f5790` / product `2bbfd646`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay the four exhausted classes (export/`/AP`/flatten/decode at `e4c0f78d`; Select chrome / persist / swatch at `d7278a38`; remaining live audit IDs at `ca258573`; local save/reload + undo/redo + resize at `f1531d5a`). Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, eraser-cut Width restroke, imported-outline Width restroke, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer other imported-fixture leftovers still live in `pdfAnnotationImporter.js` after callout `/AP` fill:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **package2 FreeText 13246R leftover transparent vs `/AP` black `f`** | `?testPdf=package2-rev4.pdf` page 6 | **not a leftover** — `/AP` paints `0 0 0 rg` + rectangle `f` under `/GS0` **`ca` 0 / `CA` 0**. Native box fill is invisible. Import leftover-transparent matches. Do not invent a fill. `/DS` color `#FA3237` + align center already kept. |
| Official Square reimport miss | official test + live first-create | **spec-only flake** — not taken, not aligned down |
| Imported Highlight leftover `/Rect` | se011 4636R | leftover `/Rect` padding **~2pt** (358 vs QuadPoints 356) — not leftover-wide; not taken |
| Imported Squiggly leftover `/Rect` | clickable 39R | leftover `/Rect` padding **~2pt** — not leftover-wide; not taken |
| se011 FreeTextCallout 4631R | se011 page 3 | **already landed** — fill black / Width 1 / OpenArrow / `/RC` `#1172e8` / border `#9643fc` |
| package2 FreeText 13246R fontFamily Helv vs `/DS` Arial | package2-rev4 | not taken (richTextEditor) |
| 4631R `/RD` unused | se011 | appearance already extracted the inner box (107×43.81) — not a leftover |
| Cloud `I=null` → 2 | clickable 59R / se011 4549R | `/AP` already paints substantial scallops — not a leftover |
| Imported PolyLine 51R | clickable-link-test | native `/CA` 1, **no** `/LE` — not a leftover |
| Imported Line | se011 / clickable / kal412 / package2 | **0** Line annots — not a leftover |
| Imported Stamp | kal412 11R | unsupported notice — not a leftover |
| package2 Square 3408R | package2-rev4 | no `/AP`; AutoCAD SHX title — skip/proxy — not a leftover |
| package2 faded Ink 3409R / 3453R / 3465R | package2-rev4 | fill **0.301961** matches `/CA`; `sourceWidth` omitted because `/BS/W` **0** — parked imported-outline Width restroke |
| se011 Ink 4540R | se011 page 1 | `sourceWidth` **5** matches `/BS/W` — already aligned |
| Dashed `/S /D` with non-empty `/D` | all fixtures | **0** — Square / Circle / FreeText missing `strokeDashArray` is not live |
| Circle / Line annots | all fixtures | **0** |

Live `/?testPdf=package2-rev4.pdf` at 1440 — imported FreeText `13246R` backgroundColor **transparent** (native `/GS0` ca 0; not invented black); text `#fa3237` / align **center**; page 6 viewBox **`0 0 …`**. Live `/?testPdf=se011.pdf` — imported callout `4631R` fillOpacity **1** / fillColor **#000000** / Width **1** / Arrowhead **openTriangle** (already landed). hubPreview Color / Width **0**; `file.id` null. 390 edge: viewBox / `file.id` / no invent / Text create **0**.

## Files

- `tests/afterCalloutApFillImportHunt.test.mjs`
- `debug/scenarios/e2e-after-callout-ap-fill-import-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-callout-ap-fill-import-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-callout-ap-fill-import-hunt.spec.mjs` **pending this pass**.

- Intended: 13246R backgroundColor stays **transparent** (native ca 0); 4631R already keeps fill **1** / `#000000` / Width **1** / openTriangle
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox / `file.id` / no invent / Text create **0**

Focused Node `afterCalloutApFillImportHunt` + leftover18FailClosed **pending this pass**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached.

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
