# Hunt after Arrow flatten Arrowhead style — 2026-08-26

## Leftover taken

**None.** Real hunt after tip `2a95dd30` / product `aa0b87ef`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay Arrow flatten 6-style Arrowhead. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, Square / Circle `/BS`, or a create-poly tool. HIGH-RISK files not touched. Did **not** stamp `file.id`.

## Hunt (live + source)

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Probed `pdfAnnotationsPdfLib.js` + `annotationStyleCatalog.js` + `useDatabase.js` DEFAULT_TOOL_PREFERENCES against the LIVE toolbar after Arrow flatten `aa0b87ef`.

| Candidate | Live control | Verdict |
|---|---|---|
| Arrow flatten 6-style Arrowhead | Arrowhead picker | **already landed** `aa0b87ef` — flatten uses `buildArrowheadRenderSpec`; leftover `drawArrowHead` gone |
| Style Dotted `[2,4]` Ellipse `/AP` | Style Dotted | **already aligned** — same writer as Dashed; first Ellipse after Dotted writes `[2,4]` + Circle `/AP` `[2 4] 0 d`; reimport keeps Dotted; no `/BS` invent |
| Plain Line `/AP` | Line tool | **not a leftover** — native Line has no `/AP`; dash rides `/BS`; first-create stays headless |
| Font / B / I / size persist | Font chrome | **not live** — `richTextEditor` edit-only; Font button count **0** on idle editor |
| TEXT_PADDING 6 vs `/AP` textPad 4 | — | **view gutter**, not a toolbar style |
| Callout box Rotation / user-settable `verticalAlign` | — | **not live** — do not invent |
| Counter pin Rotation | — | `lockRotation` — do not invent |
| Ink flatten dash | Pen Style | **not live** — Style chrome hidden for pen; residue `strokeDashArray` is null |
| SurveyMarker `/CA` | Fix19 | leftover-18 / needs `file.id` — **not taken** |
| `\r` / unpaired `\` / `#` / café / `a) Hi` / `Hi 😀` | Text | **already survive** `pdfEncodedString` hex fallback |
| JSON `\t` escape | Text | **already covered** — `decodeText()` ≠ text → `PDFHexString.fromText` |
| Square / Circle dict `/BS`; Line / Callout leader dash `/AP` | Style | **confirmed LIVE not leftovers** |
| leftover-18 human-gated | — | **not taken** |

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent a create-ink or create-polygon tool. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** align official `annotationContextMenuitem` down. Did **not** invent Square / Circle `/BS`. Did **not** invent Line `/AP`. Did **not** invent callout `verticalAlign` or callout Rotation.

## Files

- `tests/afterArrowHeadFlattenIndependentHunt.test.mjs`
- `debug/scenarios/e2e-after-arrow-head-flatten-independent-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-arrow-head-flatten-independent-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-arrow-head-flatten-independent-hunt.spec.mjs` **2 / 2 (7.1s)**.

- Intended: `?testPdf=clickable-link-test.pdf` → Style Dotted first Ellipse writes `[2,4]` + SVG dotted; Font chrome **0**; Export writes Circle `/AP` `[2 4] 0 d` and omits `/BS`; reimport keeps Dotted; `file.id` null; viewBox `0 0 612 792`
- Break: empty export invents **0**; hubPreview Style / Invite / Send / Open file **0**
- Edge: 390 keeps viewBox / `file.id` / Font **0** / no invent

Node `afterArrowHeadFlattenIndependentHunt` proves Dotted `/AP` `[2 4]`; Line stays headless with no `/AP`; known-fixed decode still survives; JSON `\t` already hex-falls-back; Arrow flatten already consumes `buildArrowheadRenderSpec`.

Focused Node `afterArrowHeadFlattenIndependentHunt` + leftover18FailClosed **18 / 18**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Arrow flatten 6-style Arrowhead now uses `buildArrowheadRenderSpec` — not a leftover after `aa0b87ef`
- Style Dotted already rides the Dashed `/AP` writers — not a leftover
- Line `/AP` — native Line has no `/AP`; do not invent
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- Ink flatten dash — Style chrome hidden for pen; do not invent
- Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken)
- Projects desktop file rows (Open file)
- Activity File / Edited (need View activity)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
