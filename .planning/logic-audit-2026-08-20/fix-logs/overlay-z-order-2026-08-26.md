# Overlay Bring to front — 2026-08-26

## Leftover taken

**Overlay omits Bring to front** (not leftover-18). Duplicate is **not** a live annotation chord (`Ctrl+D` does not clone; `e2e-keyboard-shortcut-matrix` already proves that). `Ctrl+Shift+]` is the live selected-annotation Bring to front chord (`SVGAnnotationLayer` BracketRight + shift → `'front'`). The shortcuts overlay already listed Delete selected next to Undo/Redo, but omitted that sibling z-order chord. Distinct from leftover-18, inventing Open file / UL-03 for overlay Ctrl+O, inventing clipboard overlay rows, inventing Duplicate overlay rows, and inventing Bring forward / Send backward / Send to back this pass (one sibling gap).

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent a Duplicate overlay row. Did **not** invent the other three z-order catalog rows. Did **not** take leftover-18.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Actions catalog now lists `{ keys: ['Ctrl', 'Shift', ']'], description: 'Bring to front' }` immediately after Delete selected
- Comment names the z-order pairing next to Delete the same leftover class as Delete / Ctrl+Z / Ctrl+S / Shift+F3 / F3 / Ctrl+M / Shift+E
- Catalog contracts (`shortcutsOverlay`, `keyboardShortcutMatrix`, overlay catalog spec) now expect Bring to front listed and still omit Duplicate / Bring forward / Send backward / Send to back

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-z-order.spec.mjs` **2 / 2 (6.6s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — create two overlapping Rects; `Ctrl+Shift+]` places A in front of B; `?` overlay lists **Bring to front** next to Delete selected
- Break: empty-selection `Ctrl+Shift+]` invents **0**; zoom % INPUT does not steal `Ctrl+Shift+]`; second `?` toggles closed; overlay invents **0** Duplicate / Bring forward / Send backward / Send to back / Copy / Cut / Paste / Open file / Backspace rows; hubPreview overlay **0**
- Edge: 390 overlay lists Bring to front; empty-selection `Ctrl+Shift+]` invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayZOrder` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still omits Bring forward / Send backward / Send to back — remaining, not taken (one sibling gap this pass)
- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Duplicate — remaining, not taken (not a live annotation chord)
- Overlay still omits Backspace-alias Delete — remaining, not taken (alias)
- Overlay still omits Y-alias Redo — remaining, not taken (alias)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
