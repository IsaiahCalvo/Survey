# Imported Underline / StrikeOut Select Fill export /CA — 2026-08-26

## Leftover taken

Not leftover-18. Live imported StrikeOut 4638R / Underline 4640R stay glow-only (0 resize handles), but Select Color Fill already stamped rgba fill + `edited`, and `EDITED_IMPORT_SUBTYPE_WRITERS` leftover-omitted those subtypes so export leftover-fell through to Square and leftover-dropped `/CA` until Fill was re-touched on a real Square. Product writers now re-emit `/Underline` / `/StrikeOut` + `/CA` from fill alpha. Distinct from leftover-18, Highlight 4636R live resize (`cb83ce61`), imported Underline / StrikeOut `/QuadPoints` (`002e59e1`), imported Highlight `/CA` (`c1bfc00a`), and the thirteen exhausted classes.

Did **not** invent Underline/StrikeOut create tools, live resize handles, Font family chrome, Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, leftover-18 hosts, or stamp `file.id`. HIGH-RISK files not touched.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Underline / StrikeOut after live resize** | `?testPdf=se011.pdf` select 4640R / 4638R | **not live** — glow-only, **0** resize handles |
| **Select Fill on StrikeOut 4638R then export** | same | **LIVE leftover** — screen fill `/CA` ~0.40 + `edited`; export leftover-dropped `/CA` (Square fallthrough) |
| **Cloud first-create after Ellipse sibling** | `?testPdf=` first-create | **already aligned** — Bump **8** / Fill **40** / no leftover dash |
| **Highlighter Width 4 + Opacity 30 after sibling** | same | **already aligned** |
| leftover-18 | — | **not taken** |

Live `/?testPdf=se011.pdf` at 1440 — Select StrikeOut `4638R` Fill **40** writes fill **0.4** + `edited`; Export annotated PDF writes StrikeOut `/CA` **0.40** (not leftover Square). `/?testPdf=clickable-link-test.pdf` Cloud after Ellipse + Highlighter after sibling already ride. hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: hex / Font chrome **0**.

## Files

- `src/utils/pdfAnnotationsPdfLib.js`
- `tests/afterUnderlineStrikeSelectFillExportHunt.test.mjs`
- `debug/scenarios/e2e-after-underline-resize-cloud-highlighter-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-underline-strike-select-fill-export-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not in the high-risk list. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-underline-resize-cloud-highlighter-hunt.spec.mjs` **2 / 2 (11.8s)**.

- Intended: StrikeOut Select Fill 40 keeps StrikeOut + `/CA` 0.40; Cloud Bump 8 + Fill 40 after Ellipse; Highlighter Width 4 + Opacity 30 after sibling
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox **`0 0 612 792`**; `file.id` null; hex / Font chrome **0**

Focused Node `afterUnderlineStrikeSelectFillExportHunt` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` ran after the product change: standing `annotationContextMenuitem` leftover official vs spec Enter still fails — **not taken, not aligned down**. Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Duplicate — remaining, not taken (not a live annotation chord)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Leftover-18 human-gated stay parked. Parent owns PR 800.
