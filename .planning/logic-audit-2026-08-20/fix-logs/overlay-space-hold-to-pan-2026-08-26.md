# Overlay Hold to pan — 2026-08-26

## Leftover taken

**Overlay omits Hold to pan** (not leftover-18). Space is the live hold-to-pan chord (`PdfjsViewerContainer` `activateSpacePan`). The shortcuts overlay already listed page arrows / Home / End next to Zoom, but omitted that sibling view-pan chord. V-01 already proved the hold-Space overflow-drag path — this pass only lists the live chord. Distinct from leftover-18, inventing Open file / UL-03 for overlay Ctrl+O, inventing clipboard overlay rows, and inventing Duplicate overlay rows.

Did **not** replay the nine exhausted hunts. Did **not** invent Open file / UL-03. Did **not** invent clipboard overlay rows. Did **not** invent a Duplicate overlay row. Did **not** take leftover-18.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Navigation catalog now lists `{ keys: ['Space'], description: 'Hold to pan' }` immediately after Last page
- Comment names the Hold to pan pairing next to Last page / Zoom the same leftover class as Send backward / Bring forward / Send to back / Bring to front / Delete / Ctrl+Z / Ctrl+S / Shift+F3 / F3 / Ctrl+M / Shift+E
- Catalog contracts (`shortcutsOverlay`, `keyboardShortcutMatrix`, overlay catalog spec) now expect Hold to pan listed and still omit Duplicate

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-space-hold-to-pan.spec.mjs` **2 / 2 (6.1s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — Select drops toolbar-Pan; hold Space arms `data-space-pan`; release restores off; `?` overlay lists **Hold to pan** next to Last page / Zoom
- Break: Search INPUT types a space and does not arm pan; zoom % INPUT Space does not steal / rewrite %; second `?` toggles closed; overlay invents **0** Duplicate / Copy / Cut / Paste / Open file / Backspace rows; hubPreview overlay **0**
- Edge: 390 overlay lists Hold to pan; hold Space arms then release; invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlaySpaceHoldToPan` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Duplicate — remaining, not taken (not a live annotation chord)
- Overlay still omits Backspace-alias Delete — remaining, not taken (alias)
- Overlay still omits Y-alias Redo — remaining, not taken (alias)
- Overlay still omits G-alias Find next/previous — remaining, not taken (aliases)
- Overlay still omits Ctrl+P / Ctrl+Shift+P — remaining, not taken (custom Print panel stays compile-hidden)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
