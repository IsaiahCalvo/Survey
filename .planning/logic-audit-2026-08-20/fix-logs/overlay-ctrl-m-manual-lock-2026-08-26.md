# Overlay Ctrl+M Manual lock — 2026-08-26

## Leftover taken

**Overlay omits Ctrl+M Manual lock** (not leftover-18). Ctrl+M is a live viewer chord (`zoomController.setMode(ZOOM_MODES.MANUAL, { scale: scaleRef.current })`). The shortcuts overlay already listed Ctrl+0 / Ctrl+1 / Ctrl+2 next to Zoom in/out, but omitted the sibling Manual lock chord. Distinct from leftover-18, V-04 Fit width keyboard apply, Ctrl+2 / Ctrl+M apply leftover, rail Zoom ±, UL-06 Zoom %, and inventing Open file / UL-03.

Did **not** replay the nine exhausted hunts. Did **not** invent Manual lock chrome (Fit options still filters `ZOOM_MODES.MANUAL`). Did **not** invent clipboard overlay rows. Did **not** invent Open file / UL-03.

## Product

`src/components/KeyboardShortcutsOverlay.jsx` (not high-risk):

- Navigation catalog now lists `{ keys: ['Ctrl', 'M'], description: 'Manual lock' }` immediately after Ctrl+2 Fit height
- Comment names the Ctrl+M pairing next to the Fit siblings the same leftover class as Shift+E / Fit width

HIGH-RISK files not touched. Product writers not changed. `file.id` not stamped. CORS `*` untouched. `zoomGeneration` / viewBox / container-aware scale untouched.

## Live proof

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Playwright `e2e-overlay-ctrl-m-manual-lock.spec.mjs` **2 / 2 (6.5s)**.

- Intended: `?testPdf=clickable-link-test.pdf` at 1440 — Ctrl+2 Fit height **104%** `data-active`; Ctrl+M holds **104%** / Fit height inactive / not measure; Fit options Manual button **0**; `?` overlay lists **Manual lock** next to Fit height
- Break: zoom % INPUT `Ctrl+M` / `Ctrl+2` do not steal; second `?` toggles closed; overlay invents **0** Copy / Cut / Paste / Open file rows; hubPreview overlay **0**
- Edge: 390 overlay lists Manual lock; Ctrl+M invents **0** marks; viewBox **`0 0 612 792`**; `file.id` null

Focused Node `overlayCtrlMManualLock` + leftover18FailClosed **16 / 16**. Isolated **8448** still standing (`crossing500.maxAllocatedBytes = 8_448 MiB`; `p95CommitMs` 75 / `maxCommitMs` 250). Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk file). Isolated 8448 not reached. `graphify` CLI absent.

## Hunt remaining unique leftovers (NOT leftover-18)

- Overlay still lists no clipboard shortcuts — remaining, not taken (P1-34 handlers already live)
- Overlay lists Ctrl+O Open document — Electron File menu only; web viewer has no handler — not taken (do not invent Open file / UL-03)
- Official Square reimport miss stays a spec-only flake — not taken, not aligned down
- Eraser-cut paper-ink Width still patches `sourceWidth` only — remaining, not taken
- Imported filled outline without `paperCenterline` still patches `sourceWidth` only — remaining, not taken
- leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45
- leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24

Goal stays OPEN. Parent owns PR 800.
