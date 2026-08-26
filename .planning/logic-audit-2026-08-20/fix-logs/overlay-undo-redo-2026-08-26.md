# Overlay Ctrl+Z Undo / Ctrl+Shift+Z Redo — 2026-08-26

## Leftover taken

**Overlay omits Undo/Redo** (not leftover-18). Ctrl+Z / Ctrl+Shift+Z are live viewer chords (`PDFViewer` `handleUndo` / `handleRedo` via `undoRedoHotkeys`). The shortcuts overlay already listed Ctrl+O Open document / Ctrl+S Save document in Actions, but omitted the sibling Edit chords. Undo and Redo share this one listing block. Distinct from leftover-18, E-05 undo/redo apply leftover, inventing Open file / UL-03 for overlay Ctrl+O, inventing Y-alias overlay rows, inventing clipboard overlay rows, and inventing Delete/Duplicate/z-order overlay rows.

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent Y-alias overlay rows. Did **not** take leftover-18. V-09 still omits Delete/Duplicate/z-order.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Actions catalog now lists `{ keys: ['Ctrl', 'Z'], description: 'Undo' }` and `{ keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo' }` immediately after Save document
- Comment names the Undo/Redo pairing next to Save the same leftover class as Ctrl+S / Shift+F3 / F3 / Ctrl+M / Shift+E
- Catalog contracts (`shortcutsOverlay`, `undoRedoStack`, overlay catalog spec) now expect Undo/Redo listed and still omit Delete/Duplicate/z-order

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-undo-redo.spec.mjs` **2 / 2 (6.2s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — create Rect; Ctrl+Z drops it; Ctrl+Shift+Z restores it; `?` overlay lists **Undo** / **Redo** next to Save document
- Break: empty-stack Ctrl+Z invents **0**; zoom % INPUT does not steal Ctrl+Z; second `?` toggles closed; overlay invents **0** Y-alias / Copy / Cut / Paste / Open file / Delete / Duplicate rows; hubPreview overlay **0**
- Edge: 390 overlay lists Undo / Redo; empty-stack Ctrl+Z invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayUndoRedo` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still omits Delete/Duplicate/z-order — remaining, not taken (V-09 catalog contract)
- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Y-alias Redo — remaining, not taken (alias; this leftover listed Ctrl+Shift+Z only)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
