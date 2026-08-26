# Imported Squiggly Select Color export /CA — 2026-08-26

## Leftover taken

Not leftover-18. Live imported Squiggly 39R stays glow-only (0 resize handles), but Select Color Opacity already stamped rgba stroke + `edited`, and `EDITED_IMPORT_SUBTYPE_WRITERS` leftover-omitted Squiggly so export leftover-fell through to Ink. Product writer now re-emits `/Squiggly` + `/CA` from stroke alpha + path bounds. Distinct from leftover-18, StrikeOut/Underline Select Fill `/CA` (`7962b2b2`), Highlight 4636R live resize (`cb83ce61`), imported Ink stroke `/CA`, and the fourteen exhausted classes.

Did **not** invent Squiggly create tools, live resize handles, Width-on-squiggly `/BS`, Font family chrome, Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, leftover-18 hosts, or stamp `file.id`. HIGH-RISK files not touched.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Squiggly Select Color Opacity on 39R then export** | `?testPdf=clickable-link-test.pdf` select 39R | **LIVE leftover** — screen stroke `/CA` ~0.40 + `edited`; export leftover-emitted `/Ink` `/CA` 0.40 (no `/Squiggly`) |
| **Squiggly Select Fill** | same | **not live** — path maps to pen chrome; Fill tab **0** |
| **Underline / StrikeOut after live resize** | se011 4640R / 4638R | **not taken** — just-landed `7962b2b2` |
| leftover-18 | — | **not taken** |

Live `/?testPdf=clickable-link-test.pdf` at 1440 — Select Squiggly `39R` Color Opacity **40** writes stroke **0.4** + `edited`; Export annotated PDF writes Squiggly `/CA` **0.40** (not leftover Ink). hubPreview Color / Width **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: hex / Font chrome **0**.

## Files

- `src/utils/pdfAnnotationsPdfLib.js`
- `tests/pdfImportedSquigglySelectColorExport.test.mjs`
- `tests/afterSquigglySelectColorExportHunt.test.mjs`
- `debug/scenarios/e2e-after-squiggly-select-color-export-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/imported-squiggly-select-color-export-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not in the high-risk list. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-squiggly-select-color-export-hunt.spec.mjs` **2 / 2 (5.0s)**.

- Intended: Squiggly Select Color 40 keeps Squiggly + `/CA` 0.40
- Break: hubPreview Color / Width **0**
- Edge: 390 viewBox **`0 0 612 792`**; `file.id` null; hex / Font chrome **0**

Focused Node `afterSquigglySelectColorExportHunt` + `pdfImportedSquigglySelectColorExport` + leftover18FailClosed **18 / 18**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Duplicate — remaining, not taken (not a live annotation chord)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Leftover-18 human-gated stay parked. Parent owns PR 800.
