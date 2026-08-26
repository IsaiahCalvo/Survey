# Overlay Ctrl+S Save document — 2026-08-26

## Leftover taken

**Overlay omits Ctrl+S Save document** (not leftover-18). Ctrl+S is a live viewer chord (`handleSaveDocument()` app-state save). The shortcuts overlay already listed Ctrl+O Open document and Ctrl+F Search text in Actions, but omitted the sibling Save chord. Distinct from leftover-18, local `?testPdf=` save/reload, inventing Open file / UL-03 for overlay Ctrl+O, and inventing clipboard overlay rows.

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent Fit-options Manual chrome. Did **not** take leftover-18. V-09 still omits Undo/Redo/Delete/Duplicate/z-order/F3.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Actions catalog now lists `{ keys: ['Ctrl', 'S'], description: 'Save document' }` immediately after Ctrl+O Open document / before Search text
- Comment names the Ctrl+S pairing next to Open / Search the same leftover class as Shift+E / Fit width / Ctrl+M

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-ctrl-s-save.spec.mjs` **2 / 2 (6.0s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — Ctrl+S fires `[PDFSaveExport] app-state-save` (2 hits); `?` overlay lists **Save document** next to Search text
- Break: zoom % INPUT `Ctrl+S` does not steal; second `?` toggles closed; overlay invents **0** Copy / Cut / Paste / Open file rows; hubPreview overlay **0** (fresh page — Chromium Save-page after INPUT Ctrl+S ERR_ABORTS same-tab nav)
- Edge: 390 overlay lists Save document; Ctrl+S invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayCtrlSSave` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Undo/Redo/Delete/Duplicate/z-order/F3 — remaining, not taken (V-09 catalog contract)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
