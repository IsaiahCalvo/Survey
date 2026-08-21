# KAL-436 — survey-rail category close contract

- Date: 2026-08-20
- Status: **closed**
- ID: **KAL-436** (category-select close) + **P2-35(b)** (animated sheet dismiss)
- Rail already used `dismissSurveySheet()` for category pick. The lifecycle source-contract still expected a hard `setIsSurveyPanelCollapsed(true)` in that handler.

Did **not** edit: `src/SurveySpacesRail.jsx`, `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`. No commit.

## Files changed

- `tests/kal436SurveyTransitionLifecycle.test.mjs` — category handler now asserts `dismissSurveySheet()` (and forbids a hard collapse in that click). Also asserts dismiss actually collapses: desktop `setIsSurveyPanelCollapsed(true)`, mobile `requestSurveySheetClose()` → `useMobileSheetMotion(collapseSurveySheet)` → `setIsSurveyPanelCollapsed(true)`.

## What landed

1. **Intended close path.** Category pick keeps the P2-35(b) close: `dismissSurveySheet()`. Desktop collapses immediately. Mobile stays mounted, runs `requestClose` (`closing` + `translateY(100%)` for `SHEET_CLOSE_MS`), then `collapseSurveySheet` sets collapsed.
2. **No dual-wire.** Adding `setIsSurveyPanelCollapsed(true)` next to dismiss would skip the mobile close animation (P2-35(b) leftover). Rail left unchanged.
3. **PDF still not reset.** Handler still only sets `selectedCategoryId`, dismisses the sheet, and switches to `survey-marker`. Still no `await` / `setPdfDoc` / `window.location`.

## Tests

```
node --test tests/kal436SurveyTransitionLifecycle.test.mjs
```

**8 pass / 0 fail.**

Covered: category handler uses `dismissSurveySheet()` not a hard collapse; dismiss collapses on desktop and requestCloses on mobile; `collapseSurveySheet` is the motion `onClose` and sets collapsed.

## Remaining risk

- This is a source-contract test. It does not mount the rail or tick the 170ms close timer. Live mobile close is covered by `tests/mobileSheetCloseAnimation.test.mjs` / `src/mobile/__tests__/useMobileSheetMotion.close.test.mjs` (P2-35(b)).
- `useMobileSheetMotion.js` in this worktree still lacks `resetMotion` and a generation-guarded timer (same leftover as P2-35(b)). Rapid-reopen safety is the ignore-next-hide flag.
- Desktop collapse is still instant. That is intentional.
