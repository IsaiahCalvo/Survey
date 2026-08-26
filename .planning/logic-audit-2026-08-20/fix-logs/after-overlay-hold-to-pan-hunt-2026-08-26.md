# Hunt remaining overlay leftovers after Hold to pan — 2026-08-26

## Leftover taken

**None.** Genuine hunt of remaining shortcuts-overlay vs live-handler leftovers after tip `efedf1f2` / product `162aa1f5`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay Hold to pan / the z-order family / the nine exhausted hunts. Did **not** invent clipboard overlay rows, Open file / UL-03, Duplicate / Backspace / Y / G alias rows, Ctrl+P / Ctrl+Shift+P, or Electron-only Export. Did **not** invent Line `/AP`, callout Rotation, user-settable callout `verticalAlign`, a richTextEditor, eraser-cut Width restroke, or imported-outline Width restroke. HIGH-RISK files not touched. Did **not** stamp `file.id`. Did **not** take leftover-18.

## Hunt (live + source)

| Candidate | Live / source probe | Verdict |
|---|---|---|
| **Hold to pan / z-order / Fit / Save / Undo / Delete / Find / Shift+E** | overlay catalog + `PDFViewer` / `SVGAnnotationLayer` / `PdfjsViewerContainer` | **already listed** |
| **Bare R / O / I / S / N / W / F / D / G / M / U** | `?testPdf=` after V | **not live** — Select stays; Rectangle / Ellipse / Pen stay off. Omitting them is correct |
| **Live P** | same | **still live** — Pen arms |
| **Ctrl+Shift+E Export** | web `keydown` + Electron menu only | **not a web leftover** — no download; do not invent an overlay Export row (same class as Ctrl+O / UL-03) |
| **Clipboard / Duplicate / Backspace / Y / G / Print** | overlay + handlers | **not taken** — clipboard already live (P1-34); Duplicate not a live annotation chord; aliases stay aliases; Print panel compile-hidden |
| leftover-18 | — | **not taken** |

Live `/?testPdf=clickable-link-test.pdf` at 1440 — overlay lists the live catalog; leftover letters invent **0** tools; `Ctrl+Shift+E` invents **0** downloads; hubPreview overlay **0**; `file.id` null; viewBox **`0 0 612 792`**. 390 edge: overlay lists the same catalog.

## Files

- `tests/afterOverlayHoldToPanHunt.test.mjs`
- `debug/scenarios/e2e-after-overlay-hold-to-pan-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/fix-logs/after-overlay-hold-to-pan-hunt-2026-08-26.md`
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` / `E2E-STATUS.md` / `E2E-UNLISTED.md` this-pass only

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-after-overlay-hold-to-pan-hunt.spec.mjs` **2 / 2 (6.0s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — V arms Select; leftover letters keep Select; live P arms Pen; `?` lists the live catalog
- Break: web Ctrl+Shift+E invents **0** downloads; overlay invents **0** Duplicate / Copy / Cut / Paste / Open file / Backspace / Print / Export rows; hubPreview overlay **0**
- Edge: 390 overlay lists the same catalog; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `afterOverlayHoldToPanHunt` + leftover18FailClosed **15 / 15**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Duplicate — remaining, not taken (not a live annotation chord)
- Overlay still omits Backspace-alias Delete — remaining, not taken (alias)
- Overlay still omits Y-alias Redo — remaining, not taken (alias)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases)
- Overlay still omits Ctrl+P / Ctrl+Shift+P — remaining, not taken (custom Print panel stays compile-hidden)
- Overlay still omits Ctrl+Shift+E Export — remaining, not taken (Electron File menu only; web chord is not live)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
