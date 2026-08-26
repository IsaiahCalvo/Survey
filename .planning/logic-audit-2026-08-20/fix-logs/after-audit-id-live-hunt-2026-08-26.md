# Hunt remaining unfixed LIVE audit IDs — 2026-08-26

## Leftover taken

**None.** Genuine hunt of remaining unfixed LIVE audit IDs after tip `d7278a38` / product `c22e7910`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay the two exhausted classes (export/`/AP`/flatten/decode at `e4c0f78d`; Select chrome / persist / swatch independence at `d7278a38`). Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, eraser-cut Width restroke, imported-outline Width restroke, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer next unfixed LIVE audit ID that is not leftover-18:

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **P1-21** tool-switch mid-rect | `?testPdf=clickable-link-test.pdf` Rectangle drag → Pen | **already aligned** — commits a `rect` (not discarded) |
| **P1-27** legacy `circle` restyle | `?testPdf=kal412-mixed-import-e2e.pdf` | **not live** — imported natives present; non-counter `circle` count **0**. Gates already include `circle` |
| **P1-20** Ctrl+Shift+D dumps | source `shapeBleedDiagnostics.js` | **already aligned** — `if (!spyOn) return` |
| **P1-28** blank text ghost | source `textEditCommit.js` | **already aligned** — existing blank → `null` |
| **P1-16** hidden survey markers | source `PDFViewer.jsx` | **already aligned** — `!selectedModuleId \|\| moduleId === selectedModuleId` |
| **P1-25 / P1-26** legacy group arrows | source `PDFViewer.jsx` | **not live** — Ctrl+Shift+V is renderer toggle, not create-legacy-arrow |
| **P1-32** rotation hold-arrow | source `RotationInputField.jsx` | **already aligned** — one `interactionId` per hold |
| **KB-1** eraser penetration | source `eraserPolicy.js` | **already aligned** — non-ink `'skip'` in partial |
| **KB-2** z-order persist | source `annotationZOrder.js` | **already aligned** — stamps `data.zOrder` |
| leftover-18 human-gated | — | **not taken** |

Live probe (`/?testPdf=clickable-link-test.pdf` + kal412 + `?hubPreview=1`): P1-21 mid-switch committed a rect; kal412 imported natives with **0** non-counter circles; empty reload invents 0; hubPreview Color **0**; `file.id` null; viewBox **`0 0 612 792`**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** replay `pdfAnnotationsPdfLib.js` `/AP` writers. Did **not** restroke eraser-cut paper-ink or imported outlines without a centerline.

## Files

- `tests/afterCalloutFillSwatchAuditIdHunt.test.mjs`
- `debug/scenarios/e2e-audit-id-live-probe.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-audit-id-live-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-audit-id-live-probe.spec.mjs` **2 / 2 (6.2s)**.

- Intended: P1-21 Rectangle mid-switch to Pen commits a `rect`; kal412 imports natives with **0** non-counter circles
- Break: empty reload invents 0; hubPreview Color **0**
- Edge: 390 viewBox / `file.id` / no invent; hubPreview Rectangle **0**

Node `afterCalloutFillSwatchAuditIdHunt` proves P1-21 flush, P1-27 circle gates, P1-32 one `interactionId`, P1-20 spy gate, P1-28 blank → `null`, P1-16 all-module paint, P1-25 renderer toggle, KB-1 `'skip'` / KB-2 `zOrder`, isolated 8448 / 75/250 standing.

Focused Node `afterCalloutFillSwatchAuditIdHunt` + leftover18FailClosed **21 / 21**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- P1-21 already commits mid-switch — not a leftover
- P1-27 not live on kal412 (0 imported non-counter circles) — not a leftover
- P1-20 / P1-28 / P1-16 / P1-32 / KB-1 / KB-2 already aligned in-tree
- P1-25 / P1-26 have no live create-legacy-arrow path
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- Counter pin Rotation — `lockRotation`; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
