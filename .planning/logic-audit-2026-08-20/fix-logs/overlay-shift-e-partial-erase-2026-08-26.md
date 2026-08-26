# Overlay Shift+E Partial erase — 2026-08-26

## Leftover taken

**Overlay omits Shift+E Partial erase** (not leftover-18). Shift+E is a live viewer chord (`setActiveTool('eraser')` + `setEraserMode('partial')`). The shortcuts overlay already paired Shift+V with Select and listed E, but omitted the sibling Partial erase chord. Distinct from leftover-18, D-03 type apply / skip-delete, Eraser Type caret / menuitem, and inventing Open file / UL-03 for overlay Ctrl+O.

Did **not** replay the nine exhausted hunts. Did **not** invent Partial erase chrome that does not exist. Did **not** invent a Full stroke erase shortcut (no live chord). Did **not** invent clipboard overlay rows. Did **not** invent Open file / UL-03.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Tools catalog now lists `{ keys: ['Shift', 'E'], description: 'Partial erase' }` immediately after E
- Comment names the E / Shift+E pairing the same way as V / Shift+V

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-shift-e-partial-erase.spec.mjs` **2 / 2 (5.7s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — E keeps remembered Full stroke; Shift+E forces Partial erase (`eraserMode` **partial**); `?` overlay lists **Partial erase** next to Eraser
- Break: zoom % INPUT `e` does not steal; second `?` toggles closed; overlay invents **0** Full stroke / Copy / Cut / Paste / Open file rows; hubPreview overlay **0**
- Edge: 390 overlay lists Partial erase; Shift+E invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayShiftEPartialErase` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
