# Unlisted-controls wave — 2026-08-21

Did not edit `PDFViewer.jsx`. Vite 5173 reused.

## Fixes

1. Print **Clear** (`pagesToPrint = '0'`) survived blur/clamp. Helpers in `src/components/printRangeUtils.js`.
2. Share `parseEmails` lowercases + dedupes (`src/home/shareInviteParse.js`).
3. KeyboardShortcutsOverlay Close now has `aria-label="Close"`.

## Proof (wave 1)

- `node --test tests/e2eUnlistedControls.test.mjs` → 10 / 0 fail
- `node scripts/e2e-unlisted-live.mjs` on `?testPdf=clickable-link-test.pdf` → overlay / B / Fit / Forms-hidden / History

## Wave 2 — remaining 18 (2026-08-21)

Did not edit `PDFViewer.jsx`. Vite 5173 reused.

### Helpers

- `clampCopies` (0/−4 → 1, 1000 → 999) and `applyPageRotation` (mod 360) in `printRangeUtils.js`; PrintPanel uses them.

### Proof

- Node suite now **16 / 0 fail**.
- Live: zoom 200 / 0→min / 9999→4000 / 50→min; page 0+99 stay 1, jump 3 on 120-page; collapse 48↔272; Search + Spaces tabs; pages-thumb Duplicate; Style Cloud bump; counter start #; Edit text disabled; print panel not opened (`PRINT_PANEL_ENABLED=false`); sync/presence hidden.

### No new product bugs

Zoom 0/1/50 → 100% is the engine dynamic minimum, not a clamp bug. Print panel / AccountSettings / Share mint / mark context-menu live paths filed as blocked.
