# E2E-CHROME-04 — mobile sheet `touchcancel` settles like `touchend`

- Date: 2026-08-20
- Status: **closed**
- ID: **E2E-CHROME-04**
- Did **not** edit: `PDFViewer.jsx`, BookmarksPanel, PagesPanel, `useMobileSheetMotion.js`. No commit.

## Files changed

- `src/PDFSidebar.jsx` — mobile handle binds `onTouchCancel={sheetDragHandlers.onTouchCancel}`
- `src/mobile/MobilePdfViewerChrome.jsx` — text-defaults + users sheet handles bind `onTouchCancel`
- `src/SurveySpacesRail.jsx` — mobile survey handle binds `onTouchCancel={surveySheetDragHandlers.onTouchCancel}`
- Tests: **added** `src/mobile/__tests__/useMobileSheetMotion.touchcancel.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-NEW-ISSUES-CHROME.md` — 04 marked closed

## What landed

Hook already exported `dragHandlers.onTouchCancel` → `settleDrag()` (same as `onTouchEnd`). Hosts only forwarded start/move/end, so a cancelled drag left `translateY(Npx)` stranded.

All four live handles now bind cancel to that same handler. `requestClose`, `resetMotion`, and the close-timer generation-guard are unchanged.

## Tests

```
node --test src/mobile/__tests__/useMobileSheetMotion.touchcancel.test.mjs src/mobile/__tests__/useMobileSheetMotion.close.test.mjs tests/mobileSheetMotion.test.mjs tests/mobileSheetCloseAnimation.test.mjs
```

**19 pass / 0 fail.**

Covered:

- Mid-drag `touchcancel` at +30px → `settleDrag` springs home (`translateY(0)` then idle)
- Mid-drag `touchcancel` at +90px → `requestClose` / `translateY(100%)` then `onClose`
- Host source contracts: PDFSidebar, MobilePdfViewerChrome (text + users), SurveySpacesRail bind `onTouchCancel` next to `onTouchEnd`
- Existing close / motion / animation contracts still pass (`requestClose`, `resetMotion`, generation-guard)

## Remaining risk

- Not re-run in a 390×844 browser. Node proves the hook settle + host wiring; Capacitor `touchcancel` (incoming call, OS gesture steal) is still a live-device path.
- Native Capacitor webview still untested (same leftover as E2E-CHROME-02 / P-01).
- A host added later that spreads only start/move/end will regress this. The source-contract test covers the four current sites only.
