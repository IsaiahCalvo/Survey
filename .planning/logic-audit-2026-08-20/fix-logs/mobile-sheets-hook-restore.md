# P2-35(a) restore — hook `resetMotion` + generation-guarded close timer

- Date: 2026-08-20
- Status: **closed**
- ID: **P2-35(a) restore**
- Prerequisite: P2-35(b) call sites already use `requestClose` and `resetMotion?.()`. This worktree's hook had `requestClose` but no `resetMotion` / generation-guard, so those optional calls were silent no-ops.

Did **not** edit: `AppShell.jsx`, `PDFSidebar.jsx`, `SurveySpacesRail.jsx`, `PDFViewer.jsx`, `MobilePdfViewerChrome.jsx`. Did **not** revert `requestClose`. No commit.

## Files changed

- `src/mobile/useMobileSheetMotion.js` — restored close-timer contract
- `tests/mobileSheetMotion.test.mjs` — restored controller / threshold unit tests (were missing from this tree)
- `src/mobile/__tests__/useMobileSheetMotion.close.test.mjs` — hook-level proofs for `resetMotion`, unmount cancel, `isOpen` rising-edge cancel

## What landed

1. **`resetMotion` export.** Cancels the stored close timer, clears drag refs, and sets `closing` / `springing` / `dragY` back to idle. Call-site `resetMotion?.()` now actually runs.
2. **Generation-guarded close timer.** `createSheetCloseController` stores the timeout id and a generation token. `schedule` bumps generation; `cancel` clears the timeout and bumps generation again so a stale callback is a no-op even if it already escaped `clearTimeout`.
3. **Cancel on unmount / `resetMotion` / `isOpen` true.** Cleanup effect cancels on unmount. `resetMotion` (and `cancelPendingClose`) cancel immediately. `isOpen` rising `false → true` calls `resetMotion` so a remounted/reopened parent cannot inherit a previous dismiss.
4. **`onTouchCancel` settles like `onTouchEnd`.** Both route through `settleDrag`.
5. **`requestClose` kept.** Already-closing is still a no-op. Intended close still sets `closing`, slides `translateY(100%)` for `SHEET_CLOSE_MS` (170ms), then fires `onClose`.

## Proofs

| Case | Result |
|---|---|
| Intended close | `requestClose` → `closing` → `onClose` after 170ms |
| Already-closing | extra `requestClose` does not double-fire `onClose` |
| Already-closed | call-site `requestClose` no-ops when the sheet is hidden |
| Rapid reopen | `resetMotion` cancels the timer; `onClose` does not fire; call-site reopen stays open |
| Unmount mid-close | timer cancelled; `onClose` does not fire |
| `isOpen` true | `false → true` rising edge cancels pending close; `onClose` does not fire |

## Tests

```
node --test tests/mobileSheetMotion.test.mjs src/mobile/__tests__/useMobileSheetMotion.close.test.mjs tests/mobileSheetCloseAnimation.test.mjs
```

**16 pass / 0 fail.**

## Remaining risk

- Most live call sites still do not pass `isOpen` into the hook. They rely on explicit `resetMotion()` plus their ignore-next-hide flags. Rising-edge `isOpen` only helps parents that feed the option and actually flip it `false → true`.
- `isOpen` defaulting to `true` does **not** cancel a close already in flight (that would abort every intended dismiss). Staying `true` across `requestClose` is the normal path.
- Viewer-leave and region/survey property-strip swaps can still hard-unmount a sheet. Those are not user dismissals of an open mobile sheet and were out of this allowlist.
- Spring-back and close share one controller. A close scheduled after a spring-back replaces the spring timer (intended). Two overlapping spring-backs would also replace each other.
