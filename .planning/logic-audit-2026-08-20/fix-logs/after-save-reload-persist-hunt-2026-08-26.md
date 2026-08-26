# Hunt local save/reload + undo + resize — 2026-08-26

## Leftover taken

**None.** Genuine hunt of the pivoted class after tip `ca258573` / product `c22e7910`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay the three exhausted classes (export/`/AP`/flatten/decode at `e4c0f78d`; Select chrome / persist / swatch independence at `d7278a38`; remaining live audit IDs at `ca258573`). Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, eraser-cut Width restroke, imported-outline Width restroke, or a name/`type`/row leftover. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

Prefer next live leftover on an untested class:

| Candidate | Live control | Verdict |
|---|---|---|
| **Selected rect Fill / Width / Dash / Rotation remount** | Color Fill 40 + Width 8 + Style Dashed + Rotation 45, then remount (no `file.id`) | **already aligned** — remount keeps fill **0.4**, Width **8**, dash **[6,4]**, angle **45** |
| **Selected textbox Fill remount** | Color Fill 40, remount | **already aligned** — `backgroundColor` **0.4** |
| **Selected callout Fill remount** | Color Fill 40, remount | **already aligned** — `fillOpacity` **0.4** |
| **Selected pen Width remount** | Select Width 20 after first stroke | **already aligned** — `sourceWidth` **20** + rebuilt outline `bboxH` **> 16** |
| **Undo / redo after selected Fill** | Color Fill 40 then Ctrl+Z / Ctrl+Shift+Z | **already aligned** — undo restores prior fill; redo restores **0.4** |
| **Undo after selected Rotation** | Rotation 45 then Ctrl+Z | **already aligned** — angle **0** |
| **Resize after selected Dash + Fill** | Style Dashed + Fill 40, `br` grow, remount | **already aligned** — dash + fill held; remount keeps grown `vw` |

Live probe (`/?testPdf=clickable-link-test.pdf`): toolbar writes survived remount / undo / resize. Empty reload invents 0; hubPreview Color **0**; `file.id` null; viewBox **`0 0 612 792`**.

Did **not** invent envelope extras. Did **not** take C-01. Did **not** stamp `file.id`. Did **not** invent a Font picker / richTextEditor. Did **not** invent Line `/AP`. Did **not** take leftover-18. Did **not** take a name/`type`/row leftover. Did **not** replay `pdfAnnotationsPdfLib.js` `/AP` writers. Did **not** restroke eraser-cut paper-ink or imported outlines without a centerline.

## Files

- `tests/afterSaveReloadPersistHunt.test.mjs`
- `debug/scenarios/e2e-save-reload-style-persist-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-save-reload-persist-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched. Print panel stays compile-hidden.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-save-reload-style-persist-hunt.spec.mjs` **2 / 2 (6.5s)**.

- Intended: selected Rect Fill **40** + Width **8** + Dashed + Rotation **45** remounts as-is
- Break: hubPreview Color **0**; empty remount invents 0
- Edge: 390 viewBox / `file.id` / no invent

Additional live probes (not the 2/2 pair): textbox Fill remount; callout Fill remount; pen Width 20 remount; undo/redo Fill; undo Rotation 45; `br` resize keeps dash/fill and remounts grown `vw`.

Focused Node `afterSaveReloadPersistHunt` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- Selected-style local remount already aligned — not a leftover
- Undo / redo after selected Fill / Rotation already aligned — not a leftover
- Resize after selected Dash + Fill already keeps style + grown `vw` — not a leftover
- Eraser-cut paper-ink Width still patches `sourceWidth` only (restroke would restore erased bits) — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- Font color / Bold / Italic / fontFamily / fontSize stay 0 without richTextEditor
- Line `/AP` — native Line has no `/AP`; do not invent
- Callout box Rotation — callouts have no live box Rotation; do not invent
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
