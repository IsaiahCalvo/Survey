# Ralph Loop Test Log — Zoom Fix

## Overview
Testing annotation visibility, scaling, and positioning during all zoom methods.
Target: 3 consecutive clean runs across all zoom methods.

---

## Iteration 4 — 2026-03-11T04:30Z

### What I Did
Discovered and fixed the root cause of cc=0 drops across ALL zoom methods (not just Ctrl+Minus). Previous iterations only caught Ctrl+Minus because other methods had the same race but were harder to trigger consistently. Found 3 interconnected bugs:

1. **Portal host cache empty during freeze** — cache was cleared at interaction idle (line 10027), never repopulated before `zoomOverlayTransformActiveRef` was pre-activated. Fixed: populate cache in all 3 pre-activation sites + removed idle cache clear.
2. **Keyboard zoom bypassed pre-activation** — Ctrl+=/- handled internally by Syncfusion, never went through `setScaleWithViewportPreservation`. Syncfusion destroyed DOM before `handleSyncfusionZoomChange` set the ref. Fixed: new `keydown` capture-phase handler pre-activates refs.
3. **Wheel zoom rAF race** — wheel handler called `zoomTo()` inside rAF callback, but `zoomOverlayTransformActiveRef` wasn't set until `handleSyncfusionZoomChange` fired AFTER `zoomTo()` returned. Fixed: pre-activate in wheel handler before `zoomTo()`.
4. **Safety timer too short** — 800ms confirm safety timer expired before Syncfusion finished re-rendering all pages during extreme zoom-out. Fixed: 800ms→3000ms.
5. **Frozen page list incomplete** — render loop used `syncfusionPageContainers` (potentially empty) for page list even when `shouldFreezePortalHost` was true. Fixed: merge cached portal host pages into frozen list.

### Results Summary

| Test | minCC | Dropped? | Notes |
|---|---|---|---|
| Ctrl+Wheel In (50→400%) | 1 | NO | ✓ |
| **Ctrl+Wheel Out (400→50%)** | **0** | **YES** | 2 transient drops during post-zoom Syncfusion re-renders |
| Ctrl+Plus (50→~250%) | 1 | NO | ✓ FIXED (was dropping to 0 pre-fix) |
| Ctrl+Minus (~250→50%) | 1 | NO | ✓ Still passing |
| Toolbar +/- | Not tested | — | Playwright selector issue (not a code issue) |

### Ctrl+Wheel Out Analysis
- Drops at t=2583ms and t=4888ms (2 frames total out of 700+)
- Root cause: Syncfusion lazy-renders many new pages when zooming from 400%→50% (1-2 pages → 7+ pages visible). Each page creation involves DOM destruction/recreation. When React portal host changes (real→fallback or vice versa), React unmounts/remounts the portal, causing transient cc=0.
- This is the most extreme zoom case (8x range). Normal zoom operations pass clean.
- Possible fix: keep portals mounted on disconnected hosts (React doesn't auto-unmount), or use MutationObserver to detect when Syncfusion finishes all re-renders.

### Code Changes (5 edits to App.jsx)
1. **Render loop (~line 23417)**: Merge cached portal host pages into `frozenPageNumbers` when `shouldFreezePortalHost` is true
2. **`setScaleWithViewportPreservation` (~line 20332)**: Cache portal hosts in addition to page rects during pre-activation
3. **`handleSyncfusionZoomChange` (~line 11694)**: Cache portal hosts during first zoom event
4. **Wheel handler (~line 11095)**: Pre-activate `zoomOverlayTransformActiveRef` + cache portal hosts before `zoomTo()`
5. **New `keydown` capture handler (~line 20839)**: Intercept Ctrl+=/- before Syncfusion, pre-activate zoom refs
6. **Finalize idle (~line 10027)**: Removed portal host cache clear (cache preserved for confirm-pending phase)
7. **Safety timers (4 locations)**: 800ms→3000ms

### Assessment
**Major improvement.** Fixed Ctrl+Plus/Minus (were dropping to 0, now minCC=1). Only remaining failure is extreme Ctrl+Wheel Out (400%→50%) with 2 transient drops during Syncfusion's massive page re-rendering — a fundamentally different issue (React portal host switching).

### Next Action
1. Fix Ctrl+Wheel Out drops — investigate keeping portals on disconnected hosts
2. Fix toolbar Playwright selector for E/F tests
3. Remove debug logging (`[RALPH-DEBUG]` lines)
4. If all pass → clean run 1 of 3

---

## Iteration 3 — 2026-03-11T04:00Z

### What I Did
Fixed the Ctrl+Minus 1-frame drop from iteration 2. Root cause: keyboard/toolbar zoom goes through `setScaleWithViewportPreservation` → `zoomTo()`, but `zoomOverlayTransformActiveRef` wasn't activated until `handleSyncfusionZoomChange` fired — AFTER Syncfusion destroyed DOM. Three fixes applied:

1. **Pre-activate `zoomOverlayTransformActiveRef` in `setScaleWithViewportPreservation`** before calling `zoomTo()` — ensures portal host freeze is active before Syncfusion touches DOM
2. **Restart settle timer in `setScaleWithViewportPreservation`** — prevents stale settle timers from previous zoom steps from releasing the ref mid-sequence during rapid keypresses
3. **Cache page rects in `setScaleWithViewportPreservation`** — `handleSyncfusionZoomChange` skips caching when ref is already true, so rects must be cached here for fallback hosts
4. **Fallback portal hosts** — when `shouldFreezePortalHost` is true but all cached hosts are disconnected, creates temporary DOM elements positioned using cached rects so React portals stay mounted

### Results Summary

| Test | minCC | Dropped? | Notes |
|---|---|---|---|
| Ctrl+Wheel In (50→400%) | 1 | NO | ✓ |
| Ctrl+Wheel Out (high→50%) | 4+ | NO | ✓ (was dropping in earlier run before settle timer fix) |
| Ctrl+Plus (100→249%) | 3 | NO | ✓ |
| **Ctrl+Minus (249→50%)** | **4** | **NO** | **✓ FIXED! Was dropping to 0 in iteration 2** |
| Toolbar +/- | Not tested | — | Playwright button selector errored, not a code issue |

### Code Changes (3 edits to App.jsx)

1. **`setScaleWithViewportPreservation` (~line 20331)**: Pre-activate `zoomOverlayTransformActiveRef`, cache page rects, restart settle timer with full settle/confirm-pending logic
2. **`resolveSyncfusionOverlayPortalHost` (~line 11364)**: Create fallback DOM hosts when cached hosts are disconnected during freeze
3. **`resetSyncfusionOverlayTransformStyles` (~line 9576)**: Clean up fallback hosts when zoom completes

### Assessment
**Ctrl+Minus is FIXED.** The 3 code changes (pre-activation + settle timer restart + fallback hosts) prevent the 1-frame canvas container drop. This is the first iteration where Ctrl+Minus passes.

Need iteration 4 to run ALL zoom methods (including toolbar) for a full clean pass. Target: 3 consecutive clean runs.

### Next Action
1. Re-run full test suite including toolbar buttons (fix Playwright button selector)
2. If all pass → clean run 1 of 3
3. Run 2 more times for consistency

---

## Iteration 2 — 2026-03-11T03:25Z

### What I Did
Second test run (no code changes). Improved monitor: parent-walking transform detection + PerformanceObserver Long Tasks API.

### Results Summary

| Test | minCC | Dropped? | Transforms | Long Tasks | Longest Task |
|---|---|---|---|---|---|
| Ctrl+Wheel In (50→400%) | 1 | NO | 156 frames | 13 | 369ms |
| Ctrl+Wheel Out (100→50%) | 7 | NO | 143 frames | 3 | 376ms |
| Ctrl+Plus (100→249%) | 3 | NO | 297 frames | 14 | 133ms |
| **Ctrl+Minus (249→50%)** | **0** | **YES** | 237 frames | 7 | 437ms |

### FAILURE: Ctrl+Minus dropped canvas containers to 0

Detailed analysis:
- Only **1 frame** at zero (t=158ms) — transient, not sustained
- Timeline: cc=1 from t=0-152ms → cc=0 at t=158ms → recovery
- Visually: screenshots before/during/settled all show annotations present
- The drop happens during first Ctrl+Minus keypress — Syncfusion DOM replacement
- This zoom path may not trigger the same `zoomOverlayTransformActiveRef` protection as wheel zoom

### Investigation Needed
- How does Ctrl+Minus keyboard zoom enter the app? Does it go through `handleSyncfusionZoomChange`?
- Does the keyboard shortcut path set `zoomOverlayTransformActiveRef = true` before Syncfusion re-renders?
- The wheel zoom path uses `onWheel` handler which explicitly calls `zoomTo()` and sets the ref. Keyboard zoom may bypass this.
- Key code: App.jsx line 11630 (`shouldDeferScaleCommit`), line 23304 (`shouldFreezePortalHost`)

### Toolbar Tests
Not run in this iteration (ran out of time investigating Ctrl+Minus failure).

### Console
- 0 app errors during zoom tests
- 6 TypeErrors from Playwright evaluate wrapper (not app-related)
- "All pages confirmed scale" logged after each zoom (confirm-pending working)

### Assessment
**NOT a clean run.** Ctrl+Minus has a 1-frame canvas drop. Need to investigate keyboard zoom code path and ensure it activates the same portal-freeze protections as wheel zoom.

### Next Action
1. Read App.jsx keyboard shortcut handling to understand Ctrl+/- code path
2. Verify if `zoomOverlayTransformActiveRef` is set during keyboard zoom
3. If not, add the same protection for keyboard-triggered zoom
4. Re-test all methods

---

## Iteration 1 — 2026-03-11T03:15Z

### What I Did
Baseline test — no code changes. Testing the 7 targeted fixes already applied (three-ref freeze + two-phase settle from previous session).

### Tests Run
All 6 testable zoom methods: Ctrl+Wheel In/Out, Ctrl+Plus/Minus, Toolbar +/- buttons. Plus mid-zoom screenshot sequence.

### Results Per Zoom Method

#### Test A: Ctrl+Wheel Zoom In (15 events, 50ms apart)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=1 at 400%)
- Flickering observed: NO (in screenshots)
- Position shift observed: NO
- Incorrect sizing observed: NO
- Jank metrics: Unreliable — rAF monitor blocked during Syncfusion re-renders (avg 105s per frame delta = main thread frozen)
- Screenshot: ralph-test/iter1-after-ctrl-wheel-zoomin.png
- Zoom range: 50% → 400%
- Console: "[AnnotPerf] All pages confirmed scale" logged (confirm-pending flow working)

#### Test B: Ctrl+Wheel Zoom Out (15 events, 50ms apart)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=7)
- Flickering observed: NO
- Position shift observed: NO
- Incorrect sizing observed: NO
- Screenshot: ralph-test/iter1-after-ctrl-wheel-zoomout.png
- Zoom range: 100% → 50%

#### Test C: Ctrl+Plus (5 presses, 300ms apart)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=4)
- Flickering observed: NO
- Position shift observed: NO
- Incorrect sizing observed: NO
- Screenshot: ralph-test/iter1-after-ctrl-plus.png
- Zoom range: 50% → 240%
- Console: 13 Canvas2D readback warnings (Fabric.js, expected)

#### Test D: Ctrl+Minus (5 presses, 300ms apart)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=4)
- Flickering observed: NO
- Position shift observed: NO
- Incorrect sizing observed: NO
- Screenshot: ralph-test/iter1-after-ctrl-minus.png
- Zoom range: 240% → 50%

#### Test E: Toolbar Zoom In Button (5 clicks)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=7)
- Flickering observed: NO
- Position shift observed: NO
- Incorrect sizing observed: NO
- Screenshot: ralph-test/iter1-after-toolbar-zoomin.png
- Zoom range: 50% → 124%

#### Test F: Toolbar Zoom Out Button (5 clicks)
- Annotations visible during zoom: YES
- Annotations visible after zoom settles: YES
- Canvas container count dropped to 0: NO (min=7)
- Flickering observed: NO
- Position shift observed: NO
- Incorrect sizing observed: NO
- Screenshot: ralph-test/iter1-after-toolbar-zoomout.png
- Zoom range: 124% → 50%

#### Test G: Trackpad Pinch
- Cannot simulate via CDP — requires manual testing

#### Mid-Zoom Screenshot Sequence (Ctrl+Wheel 50%→400%)
- Baseline (50%): Annotations visible — circles, red text, green checks
- Mid-zoom (100%): Annotations present — purple shading, red marks visible
- Just-after zoom: Content rendered
- Settled (400%): Clean render, crisp at final zoom level
- Screenshots: ralph-test/iter1-during-zoom-*.png

### DOM State
- canvas-container count before: 7 (at 50%)
- canvas-container minimum during Ctrl+Wheel zoom: 1 (at 400% — expected, fewer pages visible at high zoom)
- canvas-container minimum during toolbar/keyboard: 4-7
- lower-canvas count: matches canvas-container (never dropped)
- Portal hosts connected: All stayed connected during monitoring
- Fallback hosts active: 0 (framesWithTransforms=0 — fallback host mechanism not yet implemented in render loop)

### Console Errors/Warnings
- Errors: 0
- Warnings: 16 (all Canvas2D readback warnings from Fabric.js — expected/harmless)
- "[AnnotPerf] All pages confirmed scale" — logged after every zoom operation (confirm-pending flow working correctly)
- "[AnnotPerf] 800ms safety timeout" — fired once at initial page load (NOT during zoom — acceptable)
- No portal, unmount, or annotation-related errors

### Assessment

**The 7 targeted fixes appear to be working well for all testable zoom methods.**

Positive findings:
1. Canvas containers NEVER dropped to zero in any test
2. Annotations visible in all screenshots (during and after zoom)
3. Confirm-pending flow fires correctly ("All pages confirmed scale" after each zoom)
4. No console errors
5. All zoom methods (Ctrl+Wheel, Ctrl+Plus/Minus, Toolbar) working

Concerns/caveats:
1. **rAF jank monitoring unreliable** — Syncfusion blocking re-renders freeze the main thread, making rAF frame deltas meaningless (105s deltas). Need PerformanceObserver or Long Tasks API instead.
2. **framesWithTransforms=0** — The CSS transform overlay detection in monitor uses `[class*="overlay"]` selector which may not match the actual annotation overlay elements. Either transforms are applied/removed between rAF frames, or the selector needs updating.
3. **CDP vs real wheel events** — Playwright CDP `Input.dispatchMouseEvent` may behave differently from real OS-level wheel events. The 30-50ms timing between events may not match real scrollwheel/trackpad behavior.
4. **Trackpad pinch untestable via CDP** — Requires manual verification.
5. **Position accuracy not pixel-verified** — Screenshots show annotations are present but I haven't verified pixel-accurate positioning (would need baseline comparison).

### Next Action
This counts as **clean run 1 of 3**. Run the full test suite again to confirm consistency. If it passes again, that's run 2 of 3.
