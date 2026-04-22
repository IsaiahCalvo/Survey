# Phase 4: PAL Zoom Simplification - Research (v2)

**Researched:** 2026-03-21 (replaces 2026-03-19 v1)
**Domain:** Fabric.js 5.x canvas resize/zoom coordination, multi-timer zoom pipeline, CSS transform lifecycle, React useEffect timing
**Confidence:** HIGH (informed by 4 failed implementation attempts + root cause analysis)

## Summary

Phase 4 simplifies PageAnnotationLayer's scale useEffect by removing its independent 300ms settle timer and dead props (`onScaleApplied`, `presentationApiRegistry`, `isHidden`). After 4 failed implementation attempts that were all reverted, this research identifies the true root cause and proposes a NEW approach that addresses it.

**The fundamental discovery:** All 4 prior attempts failed because they removed `onScaleApplied` (the callback from PAL to App.jsx) without addressing `beginSyncfusionScaleConfirmPending` -- the App.jsx function that HIDES live canvases and starts a 3000ms safety timer. The `onScaleApplied` callback was the ONLY mechanism that clears that hidden state before the 3000ms timer fires. Removing the callback without neutralizing the hiding system guarantees a 3-second blank canvas.

**The second critical discovery:** Phase 3 changed `layerScale` to be LIVE (line 24597: `const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1`). The old frozen/live `layerScale` switching is commented out (lines 24520-24567). This means the entire `beginSyncfusionScaleConfirmPending` system -- which was designed for the frozen-to-live transition -- is now operating on STALE assumptions. It hides live canvases and creates presentation snapshots for a transition that no longer exists in the active render loop.

**Primary recommendation:** The correct approach has TWO parts done in strict order:
1. **Neutralize `beginSyncfusionScaleConfirmPending` in the zoom settle path** -- replace the call at line 12635 with a direct `resetSyncfusionOverlayTransformStyles()` call. Since `layerScale` is already live (Phase 3), there is no frozen-to-live transition to mask. The confirm-pending system's canvas-hiding behavior is now actively harmful.
2. **Then simplify PAL's scale useEffect** -- remove the 300ms timer, remove dead props. But KEEP a debounce mechanism (either re-use the `isZooming` prop or add a short internal debounce) because `layerScale` now changes on EVERY zoom event (since it's live), and PAL must not redraw on every intermediate scale.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Settle timer coordination:** App.jsx owns the official zoom state with its 1000ms settle timer -- single source of truth. PAL's internal 300ms settle timer (`zoomSettleTimerRef`) is removed entirely. PAL reacts to `isZooming` prop transitions from App.jsx. Keep `isInteracting` check that defers canvas operations during scroll/drag. Keep `inZoomModeRef` latch but set/cleared based on `isZooming` prop, not an independent timer.
- **Post-zoom redraw sequence:** Strict ordering: (1) redraw canvas at new native scale (setWidth/setHeight/setZoom/renderAll), (2) remove CSS transforms (swap blurry for crisp), (3) restore pointer events. Center-page-first priority kept. Tiered rendering (center -> visible -> off-screen) uses `isZooming` transition as trigger instead of internal settle timer.
- **Props to remove:** `onScaleApplied` (callback to App.jsx for old confirm-pending system), `presentationApiRegistry` (no longer needed), `isHidden` (remove prop and early return). Remove wrapper CSS transform logic from PAL (lines 7891-7894) -- App.jsx handles this on the overlay div.
- **Drawing tool verification:** Detailed stroke-accuracy checks, not smoke tests. Verify bounding boxes and stroke paths land correctly in viewer coordinate space after zoom. Confirm Fabric.js calcOffset is called after overlay transform removal so pointer coordinates are correct.
- **Search & proxy layers:** SearchHighlightLayer and LightweightAnnotationOverlay inherit CSS transforms from overlay divs -- no zoom-specific changes needed. Just verify coordinate systems respect final un-transformed state.

### Claude's Discretion

- Exact mechanism for PAL to detect `isZooming` false -> true -> false transition (useEffect dependency vs ref comparison)
- How to coordinate the redraw-then-remove-transform sequence with App.jsx (callback vs ref signal vs event)
- Whether center-page detection logic needs any adjustment for the new overlay div structure
- Error handling for edge cases (e.g., fabricRef.current is null when zoom settles)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ZOOM-09 | Canvas redraws at correct resolution after zoom settles (crisp, not blurry) | PAL scale useEffect simplification + App.jsx zoom settle timer now calls `resetSyncfusionOverlayTransformStyles()` directly instead of `beginSyncfusionScaleConfirmPending()`. PAL debounces live scale changes and only redraws after 1000ms settle. |
| OVLY-04 | Fabric.js pointer events work correctly with CSS-transformed parent | Fabric.js 5.x `getPointer()` auto-calls `calcOffset()` and computes cssScale correction. Once CSS transform is removed and canvas redrawn at native size, pointer events self-correct. |
| PRES-01 | Drawing tools (pen, shapes, callouts, regions) work correctly after zoom | After CSS transform removal + canvas redraw, Fabric.js pointer coordinate system is correct. Verify stroke-accuracy with bounding box assertions. |
| PRES-02 | Search highlights visible and positioned correctly at all zoom levels | SearchHighlightLayer is a sibling child of the overlay div -- inherits CSS transforms during zoom, gets live `layerScale` after settle. No code changes needed -- just verification. |
| PRES-03 | Undo/redo works after zoom | Fabric.js undo/redo operates on canvas object state, not coordinates or scale. Zoom changes don't push to undo stack. Verify undo/redo stack integrity post-zoom. |
| PRES-04 | Pan/scroll proxy rendering (LightweightAnnotationOverlay) still works | LightweightAnnotationOverlay is a sibling child of overlay div, receives same `layerScale` prop. No code changes needed -- just verification. |
| PRES-05 | No console errors during any zoom operation | Remove `onScaleApplied` calls (prevents undefined callback errors), guard `fabricRef.current` null checks, ensure removed props have safe defaults. Neutralize confirm-pending prevents the `[AnnotPerf] 3000ms safety timeout` warning. |

</phase_requirements>

## Failure Analysis (Critical Context)

### Why All 4 Approaches Failed

All 4 attempts share a common failure pattern. The `onScaleApplied` callback from PAL was removed, but the zoom settle timer (line 12597-12636) still calls `beginSyncfusionScaleConfirmPending('zoomChange_settle')` at line 12635. This function does THREE damaging things:

1. **Hides live canvases** via `syncScaleConfirmHiddenPages(pendingPages)` which sets `visibility: hidden` on the live canvas root (line 9697)
2. **Creates presentation snapshot images** via `prepareSyncfusionZoomPresentationSwap` (snapshot overlays for visual continuity during the old frozen-to-live transition)
3. **Starts a 3000ms safety timer** (line 10218) that waits for `handlePALScaleApplied` (the `onScaleApplied` callback) to confirm each page's canvas has been repainted

With `onScaleApplied` removed, step 3's timer ALWAYS fires at 3000ms because no confirmation ever comes. During that 3 seconds, canvases are hidden (step 1). This is the 3-second blank/flicker users see.

### Approach-Specific Failures

| # | What Was Tried | Why It Failed |
|---|---------------|--------------|
| 1 | Remove `syncfusionScaleConfirmPendingRef` from `isZoomActive` gates | CSS transforms stuck, live canvases stayed hidden indefinitely |
| 2 | Reduce 3000ms safety timer to 150ms | Timer fired before PAL could redraw (~250ms+ needed for `useZoomState` debounce + Fabric.js render) |
| 3 | 500ms timer + skip Phase 2 overlay settle cleanup | Fixed timers can't cover Fabric.js render variability (100ms-2000ms). Annotations still flickered. |
| 4 | `onZoomRenderComplete` callback + skip presentation swap | Coordination still wrong -- multiple overlapping systems competing |

### Root Cause

The `beginSyncfusionScaleConfirmPending` system was designed for a world where `layerScale` switched from a FROZEN value to a LIVE value at zoom settle (the old commented-out code at lines 24520-24567). In that world, hiding the live canvas during the switch prevented a visual "pop" from stale-scale pixels. The `onScaleApplied` callback was the coordination mechanism that told App.jsx "PAL has repainted at the new scale, it's safe to show the live canvas now."

**But Phase 3 already removed the frozen/live layerScale switching.** Line 24597 now reads:
```javascript
const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1;
```
This is ALWAYS the live Syncfusion viewer scale. There is no frozen-to-live transition. The canvas-hiding mechanism is protecting against a transition that no longer exists.

### The isZooming Timing Problem

An additional complication: `isZooming` (from `useZoomState(scale)`) does NOT reflect the actual zoom state because:

1. During zoom, `scale` React state is DEFERRED (`syncfusionPendingZoomScaleRef` stores it, `setScale()` is not called)
2. Since `scale` state doesn't change, `useZoomState(scale)` sees no change, so `isZooming` stays FALSE during the actual zoom
3. `isZooming` only briefly becomes TRUE when the deferred scale is flushed at settle (line 12630), then FALSE again after 60ms

BUT `layerScale` in the render loop reads LIVE from Syncfusion (`getZoomValue()`), so PAL's `scale` prop changes on every zoom event (when React re-renders due to `setSyncfusionInteractionPhase`). This means PAL sees scale changes during zoom while `isZooming` is false -- exactly the wrong signal combination.

The old 300ms settle timer in PAL worked around this: it restarted on every scale change, providing the debounce that `isZooming` was supposed to provide but doesn't.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fabric | 5.5.2 | Canvas annotation rendering, pointer events, object manipulation | Already in use. Canvas resize via setWidth/setHeight/setZoom/renderAll is the established pattern. |
| React | 18.x | Component lifecycle, useEffect for scale tracking | Already in use. useEffect dependency array drives scale change detection. |
| @playwright/test | 1.50.1 | E2E verification of zoom behavior | Already in use. Existing test infrastructure in `debug/scenarios/`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @syncfusion/ej2-react-pdfviewer | (existing) | PDF rendering, page div management | Not modified in Phase 4. Provides the page containers and zoom events. |

### Alternatives Considered

None -- Phase 4 is an internal refactor using only existing libraries.

## Architecture Patterns

### Recommended Project Structure

No new files. Phase 4 modifies two existing files:

```
src/
  PageAnnotationLayer.jsx   # Scale useEffect simplification (~lines 7788-8028)
  App.jsx                   # Zoom settle timer cleanup (~line 12635),
                            # handlePALScaleApplied removal from PAL render (~line 24722),
                            # onScaleApplied prop removal
debug/
  scenarios/
    pal-zoom.spec.mjs       # Phase 4 Playwright verification tests (already exists)
```

### Pattern 1: Neutralize Confirm-Pending in Zoom Settle (NEW - The Key Fix)

**What:** Replace `beginSyncfusionScaleConfirmPending('zoomChange_settle')` at line 12635 with a direct cleanup call.

**Why:** The confirm-pending system hides live canvases and waits for `onScaleApplied` callbacks. Since Phase 3 removed the frozen/live `layerScale` switching, there is no visual transition to mask. The canvas-hiding is actively harmful.

**The change:**

```javascript
// BEFORE (line 12635, inside the 1000ms zoomOverlaySettleTimerRef callback):
beginSyncfusionScaleConfirmPending('zoomChange_settle');

// AFTER:
// Directly reset overlay transform styles -- no need to hide live canvases
// since layerScale is already live (Phase 3 change, line 24597).
resetSyncfusionOverlayTransformStyles();
```

**What `resetSyncfusionOverlayTransformStyles` does (line 9960-9986):**
- Removes CSS transforms from all overlay content nodes
- Clears `syncfusionOverlayTransformRatioByPageRef`
- Clears pending page sets
- Resets zoom presentation pages (reveals live canvases)
- Clears hidden pages via `syncScaleConfirmHiddenPages([])`
- Cleans up fallback portal hosts

This is exactly the cleanup that SHOULD happen at zoom settle. The confirm-pending system was an intermediate step that is no longer needed.

**Critical: also neutralize `beginSyncfusionScaleConfirmPending('finalize_idle')` at line 10681.** This call happens when the interaction finalization runs. Same reasoning: no frozen/live transition, so no need to hide canvases. Replace with `resetSyncfusionOverlayTransformStyles()`.

**Confidence:** HIGH -- verified by reading the complete zoom flow, the Phase 3 `layerScale` change, and understanding that `resetSyncfusionOverlayTransformStyles` performs all the cleanup that the 3000ms safety timer eventually does anyway.

### Pattern 2: PAL Scale Debounce via inZoomModeRef + isZooming Guard

**What:** PAL's scale useEffect uses `inZoomModeRef` as a latch that prevents redraw during zoom, and only redraws when `isZooming` is false AND a scale change arrives.

**The timing problem and solution:**

With live `layerScale`, PAL receives scale changes on every zoom event. The `isZooming` prop (from `useZoomState`) stays FALSE during zoom because `scale` state is deferred. This means the old approach of "check `isZoomingRef.current` to know if zoom is active" does NOT work as a reliable guard.

**Solution: Use `isInteracting` prop as the zoom-active guard instead of `isZooming`.**

The `isInteracting` prop is `syncfusionInteractionPhase === 'interacting'` (line 24720). This is TRUE during the entire zoom interaction (set by `markSyncfusionInteractionActive` on each zoom event) and goes FALSE when the interaction finalizes. This provides the correct lifecycle:

```
User zooms
  -> markSyncfusionInteractionActive() fires
  -> isInteracting = true (PAL defers all scale changes)
  ...more zoom events...
  -> interaction settle timer fires, finalize runs
  -> isInteracting = false (PAL sees accumulated scale change, redraws)
```

The existing code at line 7807 already defers when `isInteracting` is true:
```javascript
if (isInteracting) {
  pendingScaleRef.current = scale;
  return;
}
```

This means PAL ALREADY has the correct debounce mechanism. When `isInteracting` goes false, the useEffect re-fires (since `isInteracting` is in the dep array), sees the accumulated scale, and takes the direct resize path (since `inZoomModeRef` was never latched because `isInteracting` returned early).

However, there's a subtlety: the interaction finalization may run BEFORE the overlay settle timer (1000ms). The `finalizeSyncfusionInteraction` function (line 10600+) has a guard: if `overlayZoomInProgress` is true, it skips flushing the deferred scale (line 10653-10663). So `isInteracting` goes false while `zoomOverlayTransformActiveRef` is still true. PAL's useEffect fires but `layerScale` may not have changed yet because:
- `syncfusionViewerScale` reads from Syncfusion's live value (already at new zoom)
- BUT `syncfusionPendingZoomScaleRef` isn't flushed until the overlay settle timer fires

Actually wait -- `layerScale` uses `syncfusionViewerScale` which reads LIVE from `syncfusionViewerRef.current?.getZoomValue()`. This already has the new zoom value. So when `isInteracting` goes false, PAL sees the correct final scale and can redraw immediately.

The question is: are CSS transforms still on the overlay divs at that point? YES -- the overlay settle timer hasn't fired yet. But with the confirm-pending system neutralized, the overlay settle timer (line 12129-12154) removes overlay div transforms at 1000ms. PAL redraws at the correct scale before the overlay transforms are removed, which is the CORRECT order (redraw first, then remove transform).

**Revised sequence:**
```
1. User zooms -> isInteracting=true, CSS transforms applied to overlays
2. PAL defers (isInteracting early return)
3. ...more zoom events...
4. Interaction settle (~500ms after last event)
   -> isInteracting=false
   -> PAL useEffect fires, sees new layerScale from live Syncfusion
   -> PAL redraws canvas at new native size (tiered: center -> visible -> off-screen)
5. Overlay settle timer fires (~1000ms after last zoom event)
   -> CSS transforms removed from overlay divs (Phase 2 timer, line 12129-12154)
   -> resetSyncfusionOverlayTransformStyles() removes CSS transforms from content nodes
   -> Canvas already has correct pixels from step 4 -> NO visual pop
```

This works. PAL redraws BEFORE the CSS transform is removed, which is exactly the redraw-before-transform-removal pattern from the CONTEXT.md decisions.

**Confidence:** MEDIUM -- the timing between interaction settle and overlay settle needs careful verification. If interaction settle happens significantly before overlay settle, PAL would try to redraw while CSS transforms are still active. The Fabric.js render itself is correct (it uses canvas internal coordinates), but the visual appearance during the gap might show both the CSS-scaled version and the new native-sized version overlapping for a moment.

### Pattern 3: Tiered Post-Zoom Rendering (Keep As-Is)

**What:** Center page redraws immediately, visible non-center pages redraw after a short delay, off-screen pages redraw when scrolled into view.

**When to use:** When multiple Fabric.js canvases need expensive resize/re-render but only one is visually critical.

**Existing implementation (keep):**

```javascript
if (isCenterPage) {
  enqueueZoomResize(doFabricRender);
} else if (isVisible) {
  deferredZoomScaleRef.current = { tw, th, finalScale };
  const deferTimerId = setTimeout(() => {
    if (inZoomModeRef.current) return;
    if (!deferredZoomScaleRef.current) return;
    enqueueZoomResize(doFabricRender);
  }, 800);
  deferredZoomScaleRef.current._timerId = deferTimerId;
} else {
  deferredZoomScaleRef.current = { tw, th, finalScale };
  viewportObserverRef.current = new IntersectionObserver(...);
  viewportObserverRef.current.observe(wrapperEl);
}
```

### Anti-Patterns to Avoid

- **Removing `onScaleApplied` without neutralizing `beginSyncfusionScaleConfirmPending`:** This was the #1 cause of all 4 failures. The confirm-pending system hides canvases and relies on the callback to unhide them. Remove the callback -> canvases stay hidden for 3 seconds.
- **Using `isZooming` from `useZoomState` as a zoom-active signal:** `isZooming` stays FALSE during actual zoom because `scale` state is deferred. It only briefly becomes TRUE at settle for ~60ms. It does NOT indicate whether zoom is in progress.
- **Replacing timers with shorter timers:** Approaches 2 and 3 showed that fixed-duration timers can't cover the variability of Fabric.js rendering (100ms-2000ms). The correct approach is event-driven (prop changes), not timer-driven.
- **Running PAL canvas redraws during active zoom:** With live `layerScale`, PAL receives scale changes on every zoom event. Without a debounce (either `isInteracting` early return or an internal timer), PAL would attempt expensive Fabric.js redraws on every intermediate zoom value, causing jank and potential crashes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canvas pointer coordinate correction after CSS transform | Custom offset calculation | Fabric.js `getPointer()` auto-calls `calcOffset()` + cssScale correction | Fabric.js 5.x already handles getBoundingClientRect-based offset on every mouse event |
| Staggered multi-canvas rendering | Custom priority queue | Existing `enqueueZoomResize()` + double-rAF pattern | Already implemented at PAL lines 3054-3078 |
| Viewport-based lazy rendering | Custom scroll listeners | Existing `IntersectionObserver` pattern in PAL | Already implemented at PAL lines 7944-7952 |
| Canvas-hiding during scale transition | New visibility system | Neutralize old system, rely on redraw-before-transform-removal | The hiding system was for frozen-to-live transition that Phase 3 removed |

**Key insight:** The infrastructure for Phase 4 already exists. The job is: (a) neutralize the confirm-pending system that's now doing more harm than good, then (b) simplify PAL's useEffect now that the coordination mechanism (onScaleApplied) is no longer needed.

## Common Pitfalls

### Pitfall 1: Not Neutralizing beginSyncfusionScaleConfirmPending (CRITICAL)

**What goes wrong:** Live canvases are hidden for 3 seconds after every zoom.

**Why it happens:** `beginSyncfusionScaleConfirmPending` at line 12635 and line 10681 sets `visibility: hidden` on the live canvas root and starts a 3000ms safety timer. Without `onScaleApplied` callbacks, nothing clears the hidden state before the timer fires.

**How to avoid:** Replace both calls with `resetSyncfusionOverlayTransformStyles()` which performs the same cleanup without hiding canvases. This is the FIRST change to make before any PAL modifications.

**Warning signs:** Canvas disappears for ~3 seconds after zoom. Console shows `[AnnotPerf] 3000ms safety timeout -- PAL never confirmed`.

### Pitfall 2: PAL Redraws During Active Zoom (Live layerScale)

**What goes wrong:** PAL attempts expensive Fabric.js redraws on every intermediate zoom scale value, causing jank and visual artifacts.

**Why it happens:** Phase 3 changed `layerScale` to be live (line 24597). Every zoom event triggers a React re-render (via `setSyncfusionInteractionPhase`), which re-computes `layerScale` from Syncfusion's current zoom value, which passes a new `scale` prop to PAL.

**How to avoid:** The existing `isInteracting` early return (line 7807) already handles this correctly. When `isInteracting` is true, PAL stores the scale and returns immediately. The key is to NOT remove this guard or change it in a way that lets intermediate scales through.

**Warning signs:** Multiple `fabric_renderStart` events during a single zoom gesture. Canvas flickering/blanking mid-zoom.

### Pitfall 3: Interaction Settle vs Overlay Settle Timing Gap

**What goes wrong:** PAL redraws the canvas when `isInteracting` goes false, but CSS transforms are still on the overlay divs (overlay settle timer hasn't fired yet).

**Why it happens:** The interaction settle timer and overlay settle timer are independent:
- Interaction: `syncfusionInteractionTimerRef` (hold-based, fires when `Date.now() > syncfusionInteractionUntilRef`)
- Overlay: `overlayZoomSettleTimerRef` (1000ms debounce from last zoom event)

The interaction typically settles 200-500ms after the last zoom event (depending on `SYNCFUSION_INTERACTION_SETTLE_MS`). The overlay settles 1000ms after the last zoom event. So there's a ~500-800ms gap where PAL has redrawn but CSS transforms are still present.

**How to avoid:** This gap is actually CORRECT behavior. The sequence is:
1. PAL redraws at new native size (correct pixels ready)
2. CSS transforms are removed (old blurry pixels replaced by new crisp pixels)

The visual result: during the gap, the overlay has both a CSS transform AND a correctly-sized canvas. The CSS transform scales the canvas visually, but since the canvas is now at the correct native size, the visual effect is the same as the final un-transformed state. There should be no visible glitch.

If there IS a visible glitch, it means the CSS transform ratio is significantly different from 1 during the gap. This could happen if the overlay base scale was captured incorrectly. Monitor `zoomOverlayBaseScaleRef.current` during testing.

**Warning signs:** Brief visual "pop" or size jump when overlay CSS transforms are removed.

### Pitfall 4: Stale onScaleApplied References in schedulePaintCommitted

**What goes wrong:** `schedulePaintCommitted` (line 3204) has `onScaleApplied` in its closure. After removing `onScaleApplied` from the prop list, the default value becomes `null`.

**How to avoid:** The `typeof onScaleApplied === 'function'` check (line 3226) safely no-ops. Remove `onScaleApplied` from the useCallback deps array (line 3233) and from the internal call. Keep the double-rAF paint-commit pattern itself.

**Warning signs:** React "missing dependency" lint warning.

### Pitfall 5: Multiple beginSyncfusionScaleConfirmPending Call Sites

**What goes wrong:** Only neutralizing the zoom settle call (line 12635) but missing the finalize_idle call (line 10681) or other call sites.

**Why it happens:** `beginSyncfusionScaleConfirmPending` is called from 4 places:
1. Line 12635: `zoomChange_settle` (inside 1000ms zoom settle timer) -- NEUTRALIZE
2. Line 10681: `finalize_idle` (inside finalizeSyncfusionInteraction) -- NEUTRALIZE
3. Line 21385: `keyboard_toolbar_settle` (keyboard/toolbar zoom handler) -- NEUTRALIZE
4. Line 21878: `ctrl_key_settle` (ctrl+wheel zoom handler) -- NEUTRALIZE

ALL 4 must be neutralized by replacing with `resetSyncfusionOverlayTransformStyles()`.

**How to avoid:** grep for `beginSyncfusionScaleConfirmPending(` and address ALL call sites.

**Warning signs:** Zoom works with ctrl+scroll but fails with toolbar buttons, or vice versa.

### Pitfall 6: Wrapper CSS Transform on Non-Center Pages

**What goes wrong:** PAL applies a per-page CSS transform to `wrapperEl` (lines 7891-7894) for non-center pages. This is separate from the overlay div transform.

**How to avoid:** Remove the PAL wrapper CSS transform logic. With confirm-pending neutralized, the overlay settle timer (line 12129-12154) removes overlay div transforms globally. Non-center pages show CSS-scaled (blurry) overlay until their delayed Fabric render fires (800ms). This brief blurriness is expected.

**Warning signs:** Non-center pages show wrong-scale annotations for a frame after zoom settle.

## Code Examples

### App.jsx: Neutralize beginSyncfusionScaleConfirmPending (The Key Fix)

```javascript
// Source: Analysis of App.jsx lines 12597-12636 with failure analysis applied

// BEFORE (line 12635, inside 1000ms zoomOverlaySettleTimerRef callback):
beginSyncfusionScaleConfirmPending('zoomChange_settle');

// AFTER:
// Phase 4: Directly reset overlay transform styles.
// The confirm-pending system was designed for the old frozen/live layerScale
// transition (Phase 3 removed this, line 24597). With live layerScale,
// PAL already has the correct scale and redraws when isInteracting goes false.
// Hiding canvases via confirm-pending causes the 3-second flicker bug.
resetSyncfusionOverlayTransformStyles();
```

```javascript
// Also in finalizeSyncfusionInteraction (line 10679-10681):
// BEFORE:
if (!overlayZoomInProgress) {
  console.log(`[AnnotPerf] finalize idle (${reason}) — deferring CSS transform removal...`);
  beginSyncfusionScaleConfirmPending('finalize_idle');
}

// AFTER:
if (!overlayZoomInProgress) {
  resetSyncfusionOverlayTransformStyles();
}
```

```javascript
// Also in keyboard/toolbar zoom handler (line 21385):
// BEFORE:
beginSyncfusionScaleConfirmPending('keyboard_toolbar_settle');

// AFTER:
resetSyncfusionOverlayTransformStyles();
```

```javascript
// Also in ctrl+wheel zoom handler (line 21878):
// BEFORE:
beginSyncfusionScaleConfirmPending('ctrl_key_settle');

// AFTER:
resetSyncfusionOverlayTransformStyles();
```

### PAL: Simplified Scale useEffect Structure

```javascript
// Source: Analysis of PAL lines 7788-8028 with failure analysis applied
useEffect(() => {
  // REMOVED: if (isHidden) return;
  if (!fabricRef.current || !width || !height) return;

  const canvas = fabricRef.current;
  const currentZoom = canvas.getZoom();
  const scaleJump = Math.abs(scale - currentZoom);

  // Interaction deferral (KEEP -- this is now the primary zoom debounce)
  // During zoom, isInteracting is TRUE, so PAL defers all scale changes.
  // When zoom interaction finalizes, isInteracting goes FALSE and PAL redraws.
  if (isInteracting) {
    pendingScaleRef.current = scale;
    return;
  }

  // Enter zoom mode on zoom signal or large scale jump
  if (isZooming || scaleJump > 0.01) {
    inZoomModeRef.current = true;
  }

  // Deferred resize path (zoom mode active)
  if (inZoomModeRef.current) {
    const prevPending = pendingScaleRef.current;
    pendingScaleRef.current = scale;

    const scaleActuallyChanged = prevPending === null || Math.abs(scale - prevPending) > 0.001;
    if (!scaleActuallyChanged) return;

    cancelPendingPaintCommit();
    if (scaleUpdateFrameRef.current) {
      cancelAnimationFrame(scaleUpdateFrameRef.current);
      scaleUpdateFrameRef.current = null;
    }

    if (viewportObserverRef.current) {
      viewportObserverRef.current.disconnect();
      viewportObserverRef.current = null;
    }
    if (deferredZoomScaleRef.current?._timerId) {
      clearTimeout(deferredZoomScaleRef.current._timerId);
    }
    deferredZoomScaleRef.current = null;

    // REMOVED: 300ms zoomSettleTimerRef timer.
    // CHANGED: If isZooming is still true, store pending and return.
    // If isZooming is false AND isInteracting is false (which it is,
    // because we passed the isInteracting guard above), this is the
    // settle signal.
    if (isZoomingRef.current) {
      return;
    }

    // Zoom settled! Execute tiered redraw.
    const finalScale = pendingScaleRef.current ?? scale;
    pendingScaleRef.current = null;
    const tw = Math.floor(width * finalScale);
    const th = Math.floor(height * finalScale);
    inZoomModeRef.current = false;

    // ... tiered rendering (center -> visible -> off-screen) ...
    // REMOVED: wrapperEl CSS transform for non-center pages
    // REMOVED: onScaleApplied callbacks (all 5 call sites)
    return;
  }

  // Direct resize path (no zoom in progress) -- KEEP minus onScaleApplied
  // ...
}, [cancelPendingPaintCommit, scale, schedulePaintCommitted, width, height,
    isInteracting, isZooming, pageNumber]);
// REMOVED from deps: isHidden, onScaleApplied
```

### Fabric.js 5.x Pointer Auto-Correction

```javascript
// Source: node_modules/fabric/dist/fabric.js lines 12504-12557
// Fabric.js getPointer() already handles CSS transforms:
getPointer: function (e, ignoreZoom) {
  var pointer = getPointer(e),
      upperCanvasEl = this.upperCanvasEl,
      bounds = upperCanvasEl.getBoundingClientRect(),
      boundsWidth = bounds.width || 0,
      boundsHeight = bounds.height || 0;

  this.calcOffset();
  pointer.x = pointer.x - this._offset.left;
  pointer.y = pointer.y - this._offset.top;

  cssScale = {
    width: upperCanvasEl.width / boundsWidth,
    height: upperCanvasEl.height / boundsHeight
  };
  return {
    x: pointer.x * cssScale.width,
    y: pointer.y * cssScale.height
  };
}
// After CSS transform removal + native-size canvas redraw:
// boundsWidth === upperCanvasEl.width -> cssScale === 1:1 -> pointer coords correct
```

## Implementation Strategy (NEW)

The implementation MUST follow this strict order to avoid the failures of the previous 4 attempts:

### Step 1: Neutralize beginSyncfusionScaleConfirmPending (App.jsx only)

Replace ALL 4 call sites of `beginSyncfusionScaleConfirmPending` with `resetSyncfusionOverlayTransformStyles()`. This is a SAFE change because:
- `resetSyncfusionOverlayTransformStyles` performs a superset of the cleanup that the 3000ms safety timer does
- It does NOT hide canvases (no `syncScaleConfirmHiddenPages` with page list)
- It DOES remove CSS transforms, clear pending page sets, and reveal hidden canvases

**Verify after Step 1:** Zoom still works. Annotations stay visible (no 3-second blank). The 300ms PAL timer and `onScaleApplied` callback are still in place -- they're just no longer needed because the confirm-pending system is neutralized.

### Step 2: Remove onScaleApplied prop from PAL render (App.jsx)

Remove `onScaleApplied={handlePALScaleApplied}` from line 24722. Since confirm-pending is neutralized, the callback is a no-op. PAL's internal `typeof onScaleApplied === 'function'` guards will safely no-op.

**Verify after Step 2:** Same behavior as Step 1. No regression.

### Step 3: Simplify PAL scale useEffect (PageAnnotationLayer.jsx)

Now that the App.jsx side is safe, simplify PAL:
- Remove `isHidden` prop and early return
- Remove `onScaleApplied` prop (already null from Step 2)
- Remove `presentationApiRegistry` prop
- Remove `zoomSettleTimerRef` and the 300ms timer
- Remove wrapper CSS transform logic (lines 7891-7894, 7903-7906)
- Remove all 5 `onScaleApplied` call sites
- Clean up `schedulePaintCommitted` to remove `onScaleApplied` from deps
- Update scale useEffect dependency array

**Verify after Step 3:** Full E2E suite passes. Manual verification confirms crisp rendering after zoom.

### Why This Order Matters

Steps 1 and 2 are changes to App.jsx that make the system SAFE without modifying PAL at all. The old PAL code (with 300ms timer, `onScaleApplied` calls) still works correctly -- it's just that the `onScaleApplied` callbacks no longer do anything useful because confirm-pending is neutralized.

Only after the App.jsx side is verified do we touch PAL (Step 3). If Step 3 causes issues, we can revert just the PAL changes while keeping the App.jsx fixes (Steps 1-2), and we'd STILL have eliminated the 3-second flicker.

## State of the Art

| Old Approach (Current) | New Approach (Phase 4) | Impact |
|------------------------|------------------------|--------|
| `beginSyncfusionScaleConfirmPending` hides canvases at zoom settle | `resetSyncfusionOverlayTransformStyles` cleans up without hiding | Eliminates the 3-second blank canvas |
| PAL runs independent 300ms settle timer | PAL uses `isInteracting` prop as debounce (already exists) | Eliminates timer race condition |
| PAL applies wrapper CSS transform for non-center pages | App.jsx handles all CSS transforms on overlay divs | Removes redundant transform layer |
| PAL calls `onScaleApplied` back to App.jsx | No callback needed -- confirm-pending is neutralized | Removes entire callback chain |
| `isHidden` prop gates PAL rendering | Overlay div lifecycle handled by render loop | Simpler component API |
| `layerScale` switched from frozen to live at settle | `layerScale` is always live (Phase 3) | The frozen/live transition that confirm-pending was protecting no longer exists |

**Deprecated/removed in Phase 4:**
- `beginSyncfusionScaleConfirmPending` call sites: All 4 replaced with `resetSyncfusionOverlayTransformStyles`
- `zoomSettleTimerRef` (PAL): Independent 300ms timer -- removed
- `onScaleApplied` prop: Confirm-pending callback -- no longer passed to PAL
- `presentationApiRegistry` prop: Zoom presentation mode -- no longer passed to PAL
- `isHidden` prop: Early-return gate -- overlay div lifecycle handles this
- PAL wrapper CSS transform (lines 7891-7894, 7903-7906): Redundant with overlay div transforms

## Open Questions

1. **Should `beginSyncfusionScaleConfirmPending` function be deleted or just its call sites neutralized?**
   - What we know: The function has 20+ lines of complex logic. Removing call sites is safer than deleting the function.
   - What's unclear: Are there any other code paths that depend on `syncfusionScaleConfirmPendingRef.current` being true? (Answer: yes, several guards check it, but they're all in the commented-out Phase 3 code or in `handlePALScaleApplied` which won't be called.)
   - Recommendation: Neutralize call sites only. Leave function definition for Phase 6 dead code removal. This is consistent with the Phase 3 approach of commenting out old code.

2. **Interaction settle timing vs overlay settle timing**
   - What we know: Interaction settles ~200-500ms after last zoom event. Overlay settles at 1000ms.
   - What's unclear: Is the 500-800ms gap between PAL redraw and overlay transform removal visually noticeable?
   - Recommendation: Test empirically. If there's a visible glitch during the gap, consider delaying PAL's redraw until the overlay settle timer fires. But this should be unnecessary because the CSS transform on the overlay div scales the already-correctly-sized canvas, producing the same visual result.

3. **Multiple `beginSyncfusionScaleConfirmPending` call sites in keyboard/toolbar handlers**
   - What we know: Lines 21385 and 21878 call `beginSyncfusionScaleConfirmPending` from keyboard/toolbar zoom handlers.
   - What's unclear: Do these handlers go through the same `handleSyncfusionZoomChange` path? (Answer: yes, they call `setScale` and `startOverlayZoomSettleTimer`, which eventually leads to the same settle flow.)
   - Recommendation: Neutralize all 4 call sites. Test all zoom methods (ctrl+scroll, toolbar +/-, dropdown, fit-to-page, fit-to-width, pinch).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | @playwright/test 1.50.1 |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs --grep "pal-zoom"` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZOOM-09 | Canvas redraws crisp after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "canvas redraws crisp"` | Yes (pal-zoom.spec.mjs test 1) |
| OVLY-04 | Pointer events restored after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "pointer events"` | Yes (pal-zoom.spec.mjs test 2) |
| PRES-01 | Drawing tools work after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "drawing tools"` | Yes (pal-zoom.spec.mjs test 3) |
| PRES-02 | Search highlights positioned correctly | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "search highlights"` | Yes (pal-zoom.spec.mjs test 4) |
| PRES-03 | Undo/redo works after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "undo.redo"` | Yes (pal-zoom.spec.mjs test 5) |
| PRES-04 | Proxy rendering works at all zoom levels | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "proxy rendering"` | Yes (pal-zoom.spec.mjs test 6) |
| PRES-05 | No console errors during zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "no console errors"` | Yes (pal-zoom.spec.mjs test 7) |

### Sampling Rate

- **Per task commit:** `npx playwright test --config debug/playwright.config.mjs --grep "pal-zoom" -x`
- **Per wave merge:** `npx playwright test --config debug/playwright.config.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None -- existing test infrastructure covers all phase requirements. Test file `debug/scenarios/pal-zoom.spec.mjs` was created in Plan 04-01 and exists with all 7 tests.

## Sources

### Primary (HIGH confidence)

- **App.jsx zoom settle timer** (lines 12597-12636) -- Full code read. Identified `beginSyncfusionScaleConfirmPending('zoomChange_settle')` as the root cause of canvas hiding.
- **App.jsx `beginSyncfusionScaleConfirmPending`** (lines 10155-10232) -- Full code read. Confirmed it calls `syncScaleConfirmHiddenPages` (sets `visibility: hidden`), `prepareSyncfusionZoomPresentationSwap` (snapshot images), and starts 3000ms safety timer.
- **App.jsx `handlePALScaleApplied`** (lines 10704-10791) -- Full code read. Confirmed it's the ONLY mechanism that clears confirm-pending state (removes hidden pages, removes CSS transforms per-page).
- **App.jsx `resetSyncfusionOverlayTransformStyles`** (lines 9960-9986) -- Full code read. Confirmed it performs ALL cleanup that the 3000ms safety timer does: removes transforms, clears pending pages, reveals hidden canvases, cleans up fallbacks.
- **App.jsx render loop** (lines 24569-24760) -- Full code read. Confirmed Phase 3 changed `layerScale` to live (line 24597), old frozen/live switching is commented out (lines 24520-24567).
- **PAL scale useEffect** (lines 7788-8028) -- Full code read. Confirmed `isInteracting` guard at line 7807 provides correct zoom debounce.
- **`useZoomState` hook** (lines 1-111) -- Full code read. Confirmed 60ms debounce, `isZooming = Math.abs(cssScale - 1) > 0.001`. `isZooming` stays FALSE during deferred-scale zoom.
- **Fabric.js 5.5.2 source** (`node_modules/fabric/dist/fabric.js`) -- Verified `calcOffset()`, `getPointer()`, cssScale correction.
- **HANDOFF.md** -- Full read. All 4 failed approaches and root cause analysis informed this research.
- **`debug/scenarios/pal-zoom.spec.mjs`** -- Full read. 7 E2E tests verified as correct and covering all phase requirements.

### Secondary (MEDIUM confidence)

- App.jsx keyboard/toolbar zoom handler (lines 21300-21465) -- Identified `beginSyncfusionScaleConfirmPending('keyboard_toolbar_settle')` call site.
- App.jsx ctrl+wheel zoom handler (lines 21830-21890) -- Identified `beginSyncfusionScaleConfirmPending('ctrl_key_settle')` call site.

### Tertiary (LOW confidence)

None -- all findings verified against source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in use, no new dependencies
- Architecture (Pattern 1 - neutralize confirm-pending): HIGH -- Clear root cause, `resetSyncfusionOverlayTransformStyles` verified to perform correct cleanup, Phase 3 `layerScale` change verified
- Architecture (Pattern 2 - PAL debounce via isInteracting): MEDIUM -- Timing gap between interaction settle and overlay settle needs empirical verification
- Pitfalls: HIGH -- All 5 pitfalls derived directly from the 4 failed attempts and verified against source code
- Implementation strategy (strict order): HIGH -- Each step is independently verifiable and revertible

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable -- Fabric.js 5.x is mature, no breaking changes expected)
