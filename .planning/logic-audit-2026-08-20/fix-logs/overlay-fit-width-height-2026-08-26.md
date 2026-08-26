# Overlay Ctrl+1 Fit width / Ctrl+2 Fit height — 2026-08-26

## Leftover taken

**Overlay omits Ctrl+1 Fit width and Ctrl+2 Fit height** (not leftover-18). Ctrl+1 / Ctrl+2 are live viewer chords (`ZOOM_MODES.FIT_WIDTH` / `FIT_HEIGHT`). The shortcuts overlay already listed Ctrl+0 Fit page next to Zoom in/out, but omitted the sibling fit-mode chords. Distinct from leftover-18, V-04 Fit width keyboard apply, Ctrl+2 / Ctrl+M apply leftover, rail Zoom ±, UL-06 Zoom %, and inventing Open file / UL-03.

Did **not** replay the nine exhausted hunts. Did **not** invent a Ctrl+M Manual overlay row. Did **not** invent clipboard overlay rows. Did **not** invent Open file / UL-03.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Navigation catalog now lists `{ keys: ['Ctrl', '1'], description: 'Fit width' }` and `{ keys: ['Ctrl', '2'], description: 'Fit height' }` immediately after Ctrl+0 Fit page
- Comment names the Ctrl+0 / Ctrl+1 / Ctrl+2 pairing the same way as E / Shift+E

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-fit-width-height.spec.mjs` **2 / 2 (6.9s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — Ctrl+1 forces Fit width (`data-active`); Ctrl+2 forces Fit height; `?` overlay lists **Fit width** and **Fit height** next to Fit page
- Break: zoom % INPUT `Ctrl+1` does not apply Fit width; second `?` toggles closed; overlay invents **0** Manual / Copy / Cut / Paste / Open file rows; hubPreview overlay **0**
- Edge: 390 overlay lists Fit width / Fit height; Ctrl+1 / Ctrl+2 invent **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayFitWidthHeight` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Overlay still omits Ctrl+M Manual lock — remaining, not taken (live chord; not a Fit sibling)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
