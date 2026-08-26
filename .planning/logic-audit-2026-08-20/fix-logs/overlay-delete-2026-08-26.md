# Overlay Delete selected — 2026-08-26

## Leftover taken

**Overlay omits Delete** (not leftover-18). Delete/Backspace are live viewer chords (`SVGAnnotationLayer` selected-annotation handler). The shortcuts overlay already listed Ctrl+Z Undo / Ctrl+Shift+Z Redo in Actions, but omitted the sibling Delete chord. Distinct from leftover-18, inventing Open file / UL-03 for overlay Ctrl+O, inventing Backspace-alias overlay rows, inventing clipboard overlay rows, and inventing Duplicate/z-order overlay rows.

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent Backspace-alias overlay rows. Did **not** take leftover-18. V-09 still omits Duplicate/z-order.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Actions catalog now lists `{ keys: ['Delete'], description: 'Delete selected' }` immediately after Redo
- Comment names the Delete pairing next to Undo/Redo the same leftover class as Ctrl+Z / Ctrl+S / Shift+F3 / F3 / Ctrl+M / Shift+E
- Catalog contracts (`shortcutsOverlay`, `keyboardShortcutMatrix`, overlay catalog spec) now expect Delete selected listed and still omit Duplicate/z-order / Backspace-alias rows

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-delete.spec.mjs` **2 / 2 (6.4s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — create two Rects; Delete drops the selected one; sibling stays; `?` overlay lists **Delete selected** next to Undo/Redo
- Break: empty-selection Delete invents **0**; zoom % INPUT does not steal Delete; second `?` toggles closed; overlay invents **0** Backspace / Y-alias / Copy / Cut / Paste / Open file / Duplicate rows; hubPreview overlay **0**
- Edge: 390 overlay lists Delete selected; empty-selection Delete invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayDelete` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still omits Duplicate/z-order — remaining, not taken (V-09 catalog contract)
- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Backspace-alias Delete — remaining, not taken (alias; this leftover listed Delete only)
- Overlay still omits Y-alias Redo — remaining, not taken (alias)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
