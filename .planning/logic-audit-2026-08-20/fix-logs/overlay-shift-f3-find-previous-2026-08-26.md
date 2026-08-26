# Overlay Shift+F3 Find previous — 2026-08-26

## Leftover taken

**Overlay omits Shift+F3 Find previous** (not leftover-18). Shift+F3 is a live Search previous-match chord (`SearchTextPanel` `goToPrevMatch`). The shortcuts overlay already listed F3 Find next in Actions, but omitted the sibling Shift+F3 chord. Distinct from leftover-18, V-08 Search apply, F3/Ctrl+G alias apply leftover, inventing Open file / UL-03 for overlay Ctrl+O, inventing G-alias overlay rows, and inventing clipboard overlay rows.

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent G-alias overlay rows. Did **not** take leftover-18. V-09 still omits Undo/Redo/Delete/Duplicate/z-order.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Actions catalog now lists `{ keys: ['Shift', 'F3'], description: 'Find previous' }` immediately after Find next
- Comment names the Shift+F3 pairing next to F3 the same leftover class as F3 / Ctrl+S / Ctrl+M / Shift+E

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-shift-f3-find-previous.spec.mjs` **2 / 2 (6.1s)**.

- Intended: `?testPdf=text-search-glyph-lab.pdf` at 1440 — Helvetica **12** hits; F3 walks **1→2**; Shift+F3 walks **2→1**; `?` overlay lists **Find previous** next to Find next
- Break: Shift+F3 with find-bar never opened does not open Search; second `?` toggles closed; overlay invents **0** G-alias / Copy / Cut / Paste / Open file rows; hubPreview overlay **0**
- Edge: 390 overlay lists Find previous; Shift+F3 invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayShiftF3FindPrevious` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still omits Undo/Redo/Delete/Duplicate/z-order — remaining, not taken (V-09 catalog contract)
- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases; this leftover listed Shift+F3 only)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
