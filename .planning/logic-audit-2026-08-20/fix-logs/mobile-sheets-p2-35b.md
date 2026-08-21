# P2-35(b) — mobile sheet exits run the close animation

- Date: 2026-08-20
- Status: **closed** for allowlisted call sites
- ID: **P2-35(b)**
- Prerequisite: hook already exposes `requestClose` (P2-35(a)). This worktree's hook still does **not** export `resetMotion` or generation-guard the close timer; call sites tolerate that and guard stale hides themselves.

`ISSUE-INVENTORY.md` and `fix-logs/mobile-sheets.md` were not on disk in this worktree when this slice started. Scope taken from the P2-35(b) brief: replace hard-hide exits with `requestClose` / equivalent animated close.

Did **not** edit: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `useMobileSheetMotion.js`. No commit.

## Files changed

- `src/PDFSidebar.jsx` — mobile `closePanel` / toggle / handle / backdrop / Exit Spaces route through `requestSheetClose`; imperative `requestClose` alias; ignore-next-hide on rapid reopen
- `src/SurveySpacesRail.jsx` — backdrop, header close, handle, template picker, category minimize, chrome `collapseRequestKey`, and `exitSurveyMode` use `dismissSurveySheet` (animated on mobile)
- `src/AppShell.jsx` — document-sheet chrome uses `requestClose` via `closeMobileDocumentSheet`
- `src/mobile/MobilePdfViewerChrome.jsx` — tool-change and presence/more/sync/history exits use `requestTextSheetClose` / `requestUsersSheetClose`
- Tests: `src/mobile/__tests__/useMobileSheetMotion.close.test.mjs`, `tests/mobileSheetCloseAnimation.test.mjs`

## What landed

1. **Intended close path.** User/chrome exits keep the sheet mounted (`is-collapsed` / portal open) while the hook sets `closing` and `translateY(100%)` for `SHEET_CLOSE_MS` (170ms), then the real hide runs in `onClose`.
2. **Already-closed.** `closePanel` / `dismissSurveySheet` / `dismissUsersSheet` no-op when the sheet is already hidden. A second `requestClose` while `closing` is already true does not double-fire `onClose`.
3. **Rapid reopen.** Call sites mark a pending hide stale if the user reopens while `closing` is true, so the hook timer cannot collapse the newly opened sheet. `resetMotion?.()` is called on open so a later hook export is used automatically.
4. **Unmount mid-close.** Call-site ignore flag + tests prove unmount during the timer does not throw. The hook itself still invokes `onClose` after unmount (no generation guard in this tree).

## Leftover call sites (not in allowlist / not user exits)

| Site | Why leftover |
|---|---|
| `AppShell` viewer-leave (`isViewerVisible` false) | Hard-resets `mobileDocumentPanelState` / survey / aux. `#chrome-left-host` is `display:none`; an exit animation would not be visible. |
| `AppShell.closeMobileDocumentSheet` fallback `closePanel()` | Only if the rail handle lacks `requestClose`. Live handle now exposes it. |
| `MobileToolProperties` early returns (region / survey / live text) | Switching into those trees unmounts the text-defaults portal mid-close. Tool-change still *starts* `requestClose`; the portal can disappear if the render path changes. |
| Desktop `SurveySpacesRail` collapse | Instant by design (no bottom-sheet motion). |
| `PDFViewer.jsx` | **No leftover.** No `useMobileSheetMotion` / `requestClose` / `setIsSurveyPanelCollapsed(true)`. |

## Tests

```
node --test src/mobile/__tests__/useMobileSheetMotion.close.test.mjs tests/mobileSheetCloseAnimation.test.mjs
```

**10 pass / 0 fail.**

Covered: intended `requestClose` → `closing` → `onClose` after 170ms; already-closing no-op; already-closed no-op; rapid reopen ignores stale hide; unmount mid-close does not throw; source contracts for all four allowlisted call sites; PDFViewer has nothing to migrate.

## Remaining risk

- `useMobileSheetMotion.js` in this worktree still lacks `resetMotion` and a generation-guarded timer. Call-site `resetMotion?.()` is a no-op until P2-35(a) lands here. Rapid-reopen safety is the ignore-next-hide flag, not the hook.
- Hook `onClose` can still fire after unmount (React 18 does not throw; we only assert no extra fan-out).
- Viewer-leave and region/survey property-strip swaps can still hard-unmount a sheet. Those are not user dismissals of an open mobile sheet.
- `closePanel` identity is now animated on mobile. Anything that assumed a synchronous hide will see a 170ms delay. AppShell survey/aux swaps rely on that delay on purpose.
