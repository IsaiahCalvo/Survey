# mobile-sheets — fix log

Date: 2026-08-20
Allowlist: `src/mobile/useMobileSheetMotion.js`, `tests/mobileSheetMotion.test.mjs`.
Did not edit PDFSidebar / AppShell / MobilePdfViewerChrome / SurveySpacesRail (call sites).

## P2-35 — Mobile bottom sheets: reopen race, missing exits, stuck mid-drag (3 subs)

### (a) Dismiss-then-reopen race (uncancellable close timer)

- Status: **closed**
- Files changed: `src/mobile/useMobileSheetMotion.js` (`createSheetCloseController`, unmount cancel, `cancelPendingClose`, `resetMotion`, optional `isOpen` → reset)
- Intended behavior confirmed: scheduling a close, cancelling, then scheduling again only fires the second close. A cancelled generation is a no-op if the stale timeout still runs. Unmount clears the timer so a remounted sheet cannot inherit `onClose`.
- Break / adversarial attempts: fake timers; cancel-then-invoke captured callback; reopen via `isOpen` false→true resets motion.
- Edges covered: generation token; shared controller so a later schedule replaces the pending one.
- Remaining risk: consumers that keep the same hook instance and flip visibility **without** passing `isOpen` or calling `resetMotion()` can still look closed until the next touch. PDFSidebar is the shared-instance case — it should pass `isOpen` or call `resetMotion` on open (out of allowlist).

### (b) Survey-sheet close paths hard-hide (no exit animation)

- Status: **closed at the hook; call sites still hard-hide**
- Files changed: hook now exposes `requestClose`, `resetMotion`, `cancelPendingClose`. All hook-owned closes go through the slide-down timer.
- Intended behavior confirmed: `requestClose` is the animated path; `resetMotion` is the reopen/resync path.
- Break / adversarial attempts: reduced-motion short-circuits to immediate `onClose` after reset (no stranded `closing` flag).
- Remaining risk: `SurveySpacesRail.jsx` / `PDFSidebar.jsx` / `AppShell.jsx` / `MobilePdfViewerChrome.jsx` still have hard-hide setters named in the inventory. Those files were out of allowlist. Sub (b) is hook-ready; E2E will stay glitchy until those setters call `requestClose`.

### (c) No `touchcancel` — interrupted drag leaves the sheet stranded

- Status: **closed**
- Files changed: `dragHandlers.onTouchCancel` = same settle as `onTouchEnd`; `onTouchStart` always resets `dragY` to 0
- Intended behavior confirmed: an interrupted drag either dismisses (over threshold) or springs home; a new touch never inherits leftover `dragY`.
- Break / adversarial attempts: dismiss thresholds (dy 82 exclusive, vy 0.65 exclusive) locked by test; missing `matchMedia` is not reduced-motion.
- Edges covered: `canStartDrag` reject also zeros `dragY`.

- Test command + result: `node --test tests/mobileSheetMotion.test.mjs` → pass
