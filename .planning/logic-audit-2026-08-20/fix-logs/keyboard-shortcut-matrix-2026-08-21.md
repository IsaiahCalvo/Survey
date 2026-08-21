# Keyboard shortcut matrix — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay waves 5–13 / flatten / survey-marker / pages menu / History restore / PDF-link ftp / thin leftovers / callout last-writer / hub extras / every-swatch pickers / leftover-18 fail-closed save/export / mobile 390×844 chrome / pageInputRef.  
No secrets. Did not invent `.env.local`. Did not stamp `file.id`. Cap **8448** / **75/250** not loosened.

## Candidate pick (first unique unproven + reachable)

| # | Candidate | Verdict |
|---|---|---|
| 1 | Print | Available surface already proven (Cmd+P / Cmd+Shift+P). Custom panel compile-gated `PRINT_PANEL_ENABLED=false` (UL-39–43 + `e2e-print-panel.spec.mjs`). No toolbar Print button. Native dialog leftover. |
| 2 | Export option matrix | No options UI. `exportAnnotatedPdf` is one-click (`AppShell` → `handleExportAnnotatedPDF`). leftover-18-unblock downloaded `.pdf` and did not click flatten/page-range because those controls do not exist. Not invented. |
| 3 | Embedded image/stamp | No create tool. Native `/Stamp` is unsupported import (notice + preserve, not Fabric). Cannot select/resize/rotate/delete without inventing a renderer. No stamp fixture. |
| 4 | Measurement / calibration | Not compiled-in (internal Electron-factor only). |
| 5 | **Keyboard shortcut matrix** | **This pass.** Delete, Ctrl+]/[, Ctrl+F, tool letters, Esc. Duplicate / Group not compiled-in. |
| 6 | Tablet 768×1024 | No tablet-specific chrome (`isTablet` / 768 hit-target split absent). 390 mobile already proven. |
| 7 | Search find bar | V-08 + wave6 Next wrap / Esc clear / no-match already Playwright-asserted. No case toggle. Previous is a thinner leftover, not first. |
| 8 | Multi-select / group / ungroup | V-02 / P1-05 proven. Group/Ungroup compile-hidden (`Cmd+G` early-return). |

## Live-proved

Playwright `debug/scenarios/e2e-keyboard-shortcut-matrix.spec.mjs` **1 / 1 (4.2s)** on reused Vite `http://localhost:5173`. Node `tests/keyboardShortcutMatrix.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Overlay catalog | `?` on `?testPdf=` opens (DevTestRoute remounts it; AppShell hides it on the production viewer). Lists Pen / Select / Search / Esc. **No** Delete / Duplicate / Bring forward rows. Esc closes. |
| Tool letters | P/H/T/Q/L/A arm via `btn-active`. C mounts `[data-counter-overlay]`. V clears it. |
| Ctrl+F | Focuses `Search text in PDF...` (prior V-08 used the tab click). |
| Z-order hotkeys | Two overlapping user rects. **Ctrl+]** places A above B. **Ctrl+[** places A behind B. Overlap-aware — does not jump past imported `39R`. **Ctrl+Shift+]** front / **Ctrl+Shift+[** back. |
| Delete | Delete (not Backspace) removes the selected owned rect; sibling stays. |
| Break | Delete while zoom % INPUT is focused is a no-op. Z-order keys with no selection leave sibling order unchanged. |
| Edge | **Ctrl+D** does not invent a Duplicate clone. **Ctrl+G** / **Ctrl+Shift+G** stay compile-hidden. Esc does not delete the selected mark. `file.id` stays null. |

## Product

No min-viable product diff. No high-risk files edited.

Harness notes (not product bugs):

- Sub-toolbar tools use `btn-active`, not `aria-pressed`.
- A page click while Callout is armed mounts the editor and swallows the next tool letter.
- `Ctrl+[` / `Ctrl+]` pass the nearest overlapping neighbor; imported natives can remain first in the full SVG sibling list.

Invariants unchanged: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Still parked / thinner

- Leftover-18 hosts (auto-login, captcha, Stripe, MSAL, second account, native Electron pick, cloud persist).
- Search **Previous** match (Next wrap already wave6).
- Custom Print panel (flag off).
- Stamp/image edit (unsupported import).
- Measurement / tablet / Group-Ungroup as user tools.

## Files

- `debug/scenarios/e2e-keyboard-shortcut-matrix.spec.mjs`
- `tests/keyboardShortcutMatrix.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- this receipt

Goal stays open.
