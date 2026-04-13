# HANDOFF — Phase 12 gap bugs (bugs #1, #1b, #2, #2.5 shipped — #3, #4 remaining)

**Session:** 2026-04-12 late · **Branch:** `post-v2.0/cleanup` · **Context at handoff:** 12%

## Where we are

Plan 12-01 checkpoint remains OPEN. Four gap bugs shipped and user-verified this session. Two remain before 12-01 can close.

**Do NOT close Plan 12-01 or advance to Wave 2 (Plan 12-02 EDIT-12) until bugs #3 and #4 are resolved and the user re-verifies the full 15-check manual checklist.**

## Commits landed this session

```
0d0c3218 fix(12-01): replace fitToPage() with direct zoomTo() — bug #2.5 v2
cd64c03d fix(12-01): skip pdf.js re-fit effect in Syncfusion mode — bug #2.5  (superseded by v2)
4839f1e3 fix(12-01): compute fit-height from live Syncfusion DOM — bug #2
3a3db09a fix(12-01): reconcile React scale from DOM at load — bug #1b
b77405f2 fix(12-01): live-update zoom input during deferred setScale (bug #1)
9b0c6f15 feat(12-01): wire snapAngleToNearest45 into rotate branch — EDIT-11
df43b0f2 feat(12-01): lower zoom floor 50%→10% — ZOOM-09 atomic 2-file commit
8ed6b703 test(12-01): add snapAngleToNearest45 helper + test scaffolds
```

All on `post-v2.0/cleanup`. 79/79 tests green. Six App.jsx Always-Protected carve-outs justified in Plan 12-01 commit messages.

## Bugs — status

| # | Status | Bug | File(s) | Risk |
|---|--------|-----|---------|------|
| 1 | ✅ `b77405f` | Zoom input display lag | `App.jsx:~12202` | — |
| 1b | ✅ `3a3db09` | Load-time React↔Syncfusion scale desync | `App.jsx` onDocumentLoad | — |
| 2 | ✅ `4839f1e` | Fit-height wrong calc (pdf.js points vs Syncfusion render) | `App.jsx:12655 FIT_HEIGHT branch` | — |
| 2.5 | ✅ `0d0c3218` | Fit-page continuous-scroll runaway cascade (~90 pageChange/sec) | `App.jsx:12651 FIT_PAGE branch` — root cause was `magnification.fitToPage()` itself (Syncfusion-internal side effect). Fix: replace with DOM-measured `zoomTo()` matching bug #2 pattern. | — |
| 3 | ⏳ NEXT | Blue glow/hitbox scales with zoom in selection mode | `SVGSelectionOverlay.jsx` — almost certainly missing `vector-effect="non-scaling-stroke"` on the glow stroke element | low, ~1 LOC |
| 4 | ⏳ HARDEST | Edit-mode shape handles misaligned (circles hit/miss, rects slightly off) | `FabricEditCanvas.jsx` + `PageAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx` — container-aware measurement race at small zooms | high, needs heavy cross-file instrumentation, **earmark own `/clear` session** |

## Key insight: Syncfusion zoom family

After bugs #2 and #2.5, the pattern is established: **in Syncfusion mode, never trust `magnification.fitToPage()` / `fitToWidth()` / `fitToHeight()` — always compute the target scale from the live DOM and call `magnification.zoomTo(percent)` directly.**

- `magnification.fitToPage()` has a Syncfusion-internal side effect (exact mechanism unknown — possibly scroll-mode flag or wheel delta recalibration) that causes runaway pageChange cascades on continuous scroll at low zoom. Confirmed reproducible.
- `zoomTo()` does NOT trigger the cascade.
- Fit-width (`fitToWidth()`) does not seem to exhibit the cascade — left alone for now. If it surfaces later, apply the same DOM-measurement pattern.

**The DOM-measurement formula** (used in both bug #2 and #2.5 v2):
```js
const wrapperEl = syncfusionWrapperRef.current;
const pageDiv = wrapperEl?.querySelector('.e-pv-page-div');
const currentZoomPercent = magnification.zoomFactor ?? viewer.getZoomValue?.();
const realPageW = pageDiv.offsetWidth / (currentZoomPercent / 100);
const realPageH = pageDiv.offsetHeight / (currentZoomPercent / 100);
// then compute widthScale / heightScale / min for fit-page
```

This is the same class of root cause as the canvas sizing gotcha from 2026-03-22: **trust the DOM, not pdf.js point sizes, when Syncfusion is the renderer.** Consider adding to CLAUDE.md gotchas in a cleanup pass.

## First bug #2.5 attempt (superseded)

The first bug #2.5 fix (`cd64c03d`) gated the `[pageNum, zoomMode]` effect with `!useSyncfusionRenderer` based on a wrong hypothesis about stale `ctrlMode`. That diagnosis was confirmed in logs (controller WAS stuck at fitWidth, effect WAS jumping zoom to 118%) but the fix did NOT eliminate the cascade — meaning the stale-ctrlMode re-zoom was a real-but-secondary bug, not the primary cascade cause.

**The gate on the effect is still valid and should stay** — it prevents a separate bug (brief 67→118% flash when clicking fit-page) that wasn't the user's primary complaint but is real. Do not revert `cd64c03d`.

The primary fix is `0d0c3218` (replace fitToPage with zoomTo).

## First actions in next session

1. Read this file
2. Read `.planning/phases/12-shape-edit-polish/.continue-here.md`
3. Ask user: "Bugs #1, #1b, #2, and #2.5 are all user-verified. Ready to start bug #3 (blue glow scales with zoom)?"
4. Bug #3 — open `src/components/SVGSelectionOverlay.jsx`, grep for the glow/stroke element, add `vector-effect="non-scaling-stroke"` attribute. Ship as atomic commit. User verifies.
5. Bug #4 — **get its own `/clear` session**. Heavy cross-file work across `FabricEditCanvas.jsx`, `PageAnnotationLayer.jsx`, `SVGSelectionOverlay.jsx`. Logs will be large. Do NOT start in an already-used context.

After bug #4 clears → user re-runs the full 15-check manual checklist from the original Plan 12-01 checkpoint → write `12-01-SUMMARY.md` → advance `STATE.md` → start Wave 2 (Plan 12-02 EDIT-12 RotationInputField) → write `12-RECONCILIATION.md` before closing Phase 12.

## Environment

- Dev server: http://localhost:5173/ (verify PID with `lsof -i:5173`)
- Test PDF: `Package 2 - Rev 4 -- IC.pdf`, page 6
- User preference: laymen's explanations, terse output, no emojis, one-bug-at-a-time, diagnostic logs over Kapture MCP
- Tests: `npm test` — 79/79 green baseline
- User is on Electron wrapper

## User's workflow rule (enforce for #3 and #4)

Per-bug loop:
1. Instrument aggressively (or use existing logs)
2. User reproduces, saves console to `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log` (overwritten per bug)
3. Diagnose from logs
4. Ship minimal fix as own commit (remove instrumentation in same commit)
5. User verifies ONE thing, not fifteen
6. Next bug
