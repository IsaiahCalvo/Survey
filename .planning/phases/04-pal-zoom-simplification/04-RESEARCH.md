# Phase 4: PAL Zoom Simplification - Research

**Researched:** 2026-03-19
**Domain:** Fabric.js 5.x canvas resize/zoom coordination, CSS transform pointer correction, React useEffect lifecycle for post-zoom redraw
**Confidence:** HIGH

## Summary

Phase 4 simplifies PageAnnotationLayer's scale useEffect by removing its independent 300ms settle timer and instead reacting to scale prop changes driven by App.jsx's 1000ms overlay settle timer. The core work is: (1) remove PAL's internal settle timer and the three dead props (`onScaleApplied`, `presentationApiRegistry`, `isHidden`), (2) simplify the scale useEffect to detect zoom-end via the `isZooming` prop transition and trigger a strict redraw-then-remove-transform-then-restore-pointer-events sequence, and (3) verify that Fabric.js pointer coordinates work correctly after the overlay div's CSS transform is removed.

A critical timing discovery: the `isZooming` prop (from `useZoomState`) becomes false after only ~60ms of no scale changes, but App.jsx's overlay CSS transforms persist for 1000ms. This means `isZooming` is NOT the overlay settle signal -- it fires ~940ms too early. Phase 4 must either: (a) change `isZooming` to derive from `overlayZoomActiveRef`, or (b) use the `scale` prop change as the trigger (since `layerScale` switches from frozen to live scale when the overlay settle timer fires, causing a prop change). Option (b) is simpler -- the existing scale useEffect already detects scale changes, so PAL just needs to handle the zoom-end path correctly when `inZoomModeRef` is true and a new scale arrives.

**Primary recommendation:** Keep the scale prop change as the primary trigger for post-zoom canvas redraw. Remove PAL's 300ms settle timer entirely. When PAL detects a scale change while `inZoomModeRef` is true and `isZooming` is false, execute the tiered redraw sequence immediately (no independent timer). The `isZooming` prop still gates the zoom latch entry, but zoom-end is detected by `!isZooming && inZoomModeRef.current && scaleChanged`.

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
| ZOOM-09 | Canvas redraws at correct resolution after zoom settles (crisp, not blurry) | PAL scale useEffect simplification: remove 300ms timer, use scale prop change + inZoomModeRef latch to trigger tiered Fabric.js resize (setWidth/setHeight/setZoom/renderAll) |
| OVLY-04 | Fabric.js pointer events work correctly with CSS-transformed parent | Fabric.js 5.x `getPointer()` auto-calls `calcOffset()` on every mouse event and computes cssScale correction from `getBoundingClientRect()`. Once CSS transform is removed and canvas redrawn at native size, pointer events self-correct. No explicit `calcOffset()` call needed. |
| PRES-01 | Drawing tools (pen, shapes, callouts, regions) work correctly after zoom | After CSS transform removal + canvas redraw, Fabric.js pointer coordinate system is correct. PAL's canvas `pointerEvents: auto` on line 8871 gates tool interaction. Verify stroke-accuracy with bounding box assertions. |
| PRES-02 | Search highlights visible and positioned correctly at all zoom levels | SearchHighlightLayer is a sibling child of the overlay div -- inherits CSS transforms during zoom, gets live `layerScale` after settle. No code changes needed -- just verification. |
| PRES-03 | Undo/redo works after zoom | Fabric.js undo/redo operates on canvas object state, not coordinates or scale. Zoom changes don't push to undo stack. Verify undo/redo stack integrity post-zoom. |
| PRES-04 | Pan/scroll proxy rendering (LightweightAnnotationOverlay) still works | LightweightAnnotationOverlay is a sibling child of overlay div, receives same `layerScale` prop. No code changes needed -- just verification. |
| PRES-05 | No console errors during any zoom operation | Remove `onScaleApplied` calls (prevents undefined callback errors), guard `fabricRef.current` null checks, ensure removed props have safe defaults in destructuring. |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fabric | 5.5.2 | Canvas annotation rendering, pointer events, object manipulation | Already in use. Canvas resize via setWidth/setHeight/setZoom/renderAll is the established pattern. |
| React | 18.x | Component lifecycle, useEffect for scale tracking | Already in use. useEffect dependency array drives scale change detection. |
| @playwright/test | 1.58.2 | E2E verification of zoom behavior | Already in use. Existing test infrastructure in `debug/scenarios/`. |

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
  App.jsx                   # layerScale computation update (~lines 24643-24662),
                            # isZooming prop source update, handlePALScaleApplied removal
debug/
  scenarios/
    pal-zoom.spec.mjs       # NEW: Phase 4 Playwright verification tests
```

### Pattern 1: Scale-Prop-Driven Zoom End Detection

**What:** PAL detects zoom end by observing when `isZooming` goes false AND the scale prop changes, rather than running its own timer.

**When to use:** When a child component needs to react to a parent's debounced state transition.

**How it works in this codebase:**

The critical timing chain is:

```
User zooms
  -> App.jsx handleSyncfusionZoomChange fires
  -> overlayZoomActiveRef = true, CSS transforms applied to overlay divs
  -> PAL receives isZooming=true prop, enters zoom latch (inZoomModeRef=true)
  -> PAL stores pendingScaleRef but does NOT resize canvas
  ...1000ms of no zoom input...
  -> App.jsx overlay settle timer fires
  -> overlayZoomActiveRef = false
  -> CSS transforms removed from overlay divs
  -> Render loop: isZoomActive becomes false
  -> layerScale switches from frozenPageScale to fallbackPageScale (live measured scale)
  -> PAL receives new scale prop
  -> PAL scale useEffect fires: inZoomModeRef is true, isZooming is false
  -> Execute tiered redraw (center -> visible -> off-screen)
  -> Clear inZoomModeRef
```

**Key insight:** The scale prop change IS the settle signal. When App.jsx's render loop switches from frozen to live scale, PAL sees a new `scale` prop value. If `inZoomModeRef` is latched and `isZooming` is false, that's the cue to redraw.

### Pattern 2: Tiered Post-Zoom Rendering

**What:** Center page redraws immediately, visible non-center pages redraw after a short delay, off-screen pages redraw when scrolled into view.

**When to use:** When multiple Fabric.js canvases need expensive resize/re-render but only one is visually critical.

**Existing implementation (keep as-is):**

```javascript
// In PAL scale useEffect settle callback:
if (isCenterPage) {
  // Tier 1: Immediate render via stagger queue (double-rAF)
  enqueueZoomResize(doFabricRender);
} else if (isVisible) {
  // Tier 2: Delayed render (800ms after center page)
  deferredZoomScaleRef.current = { tw, th, finalScale };
  setTimeout(() => enqueueZoomResize(doFabricRender), 800);
} else {
  // Tier 3: IntersectionObserver -- render when scrolled into view
  deferredZoomScaleRef.current = { tw, th, finalScale };
  viewportObserverRef.current = new IntersectionObserver(...);
}
```

This pattern remains. The only change is how the settle callback is triggered (prop change instead of 300ms timer).

### Pattern 3: Redraw-Before-Transform-Removal

**What:** Canvas redraws at new native size BEFORE the CSS transform is removed, preventing a visual "pop" where stale pixels are shown at wrong scale.

**When to use:** Whenever CSS transforms are used as a zoom transition strategy.

**Sequence (from UI-SPEC):**

```
1. fabricRef.current.setWidth(tw)    // Set new pixel width
2. fabricRef.current.setHeight(th)   // Set new pixel height
3. fabricRef.current.setZoom(scale)  // Set Fabric.js internal zoom
4. fabricRef.current.renderAll()     // Paint fresh pixels
5. wrapperEl.style.transform = ''   // Remove CSS scale (crisp pixels now visible)
6. // Pointer events auto-restore (overlay div's pointer-events:none is the gate)
```

**Critical invariant:** Steps 1-4 MUST complete before step 5. The `doFabricRender` function in PAL already does this (lines 7898-7918).

### Anti-Patterns to Avoid

- **Running independent timers in child components when parent owns the state:** PAL's current 300ms timer races with App.jsx's 1000ms timer. Remove it.
- **Using `isZooming` from `useZoomState` as the overlay settle signal:** `isZooming` from `useZoomState` goes false after ~60ms (when `renderedScale` catches up), but overlay CSS transforms persist for 1000ms. These are different signals.
- **Calling `onScaleApplied` after removing it from the prop signature:** Ensure ALL 5 call sites are removed (lines 7914-7916, 7927-7929, 7941-7943, 8006-8008, 8014-8016).
- **Removing `schedulePaintCommitted` along with `onScaleApplied`:** `schedulePaintCommitted` internally calls `onScaleApplied` (line 3226-3228). Since `onScaleApplied` defaults to `null`, the conditional check `typeof onScaleApplied === 'function'` will safely no-op. But `schedulePaintCommitted` also manages `paintCommitTokenRef` which may be used by other code. Keep the function, just let the `onScaleApplied` call inside it no-op.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canvas pointer coordinate correction after CSS transform | Custom offset calculation | Fabric.js `getPointer()` auto-calls `calcOffset()` + cssScale correction | Fabric.js 5.x already handles getBoundingClientRect-based offset on every mouse event (line 12529 of fabric.js). It also computes cssScale ratio (lines 12547-12551) to correct for CSS transforms on canvas or parent. |
| Staggered multi-canvas rendering | Custom priority queue | Existing `enqueueZoomResize()` + double-rAF pattern | Already implemented at PAL lines 3054-3078. Double-rAF ensures browser composites CSS state before running heavy Fabric render. |
| Viewport-based lazy rendering | Custom scroll listeners | Existing `IntersectionObserver` pattern in PAL | Already implemented at PAL lines 7944-7952. Fires once when off-screen page scrolls into view. |

**Key insight:** Most of the infrastructure needed for Phase 4 already exists in PAL. The job is simplification (removing the 300ms timer and dead props), not building new systems.

## Common Pitfalls

### Pitfall 1: isZooming Timing Mismatch

**What goes wrong:** Using `isZooming` from `useZoomState` as the overlay settle signal causes PAL to start canvas redraw ~940ms too early (while CSS transforms are still active on overlay divs).

**Why it happens:** `useZoomState.isZooming` is based on a 60ms debounce of `renderedScale` vs `targetScale`. It goes false as soon as React state catches up. But the overlay CSS transforms persist until App.jsx's 1000ms settle timer fires.

**How to avoid:** Do NOT use `isZooming` going false as the sole trigger for canvas redraw. Instead, detect zoom-end via:
- `inZoomModeRef.current === true` (zoom was active)
- `!isZooming` (useZoomState says scale is stable)
- Scale prop actually changed (from frozen to live value -- this happens when overlay settle timer fires and `isZoomActive` becomes false in the render loop)

The scale prop change is the authoritative signal because it only happens when `layerScale` switches from frozen to live in the render loop, which only happens when `overlayZoomActiveRef` goes false.

**Warning signs:** Canvas redraws while overlay divs still have CSS transforms -> visual pop (flash of wrong-scale annotations for 1 frame).

### Pitfall 2: Fabric.js Pointer Events with Active CSS Transform

**What goes wrong:** If pointer events are re-enabled while a CSS `transform: scale(ratio)` is still on the overlay div, Fabric.js `getPointer()` computes wrong coordinates because `getBoundingClientRect()` returns scaled bounds but `upperCanvasEl.width` reflects the unscaled canvas.

**Why it happens:** Fabric.js 5.x's `getPointer` (line 12504-12557 of fabric.js) computes `cssScale = { width: upperCanvasEl.width / boundsWidth, height: upperCanvasEl.height / boundsHeight }`. If the canvas is 1000px wide internally but the overlay div is CSS-scaled 2x, `boundsWidth` would be 2000px, giving `cssScale = 0.5`. This INVERTS the correction -- clicks at (100, 100) visual would be mapped to (50, 50) canvas.

**How to avoid:** The overlay div has `pointer-events: none` during zoom (set by App.jsx). Ensure pointer events are NOT restored until AFTER: (1) canvas is redrawn at new native size, AND (2) CSS transform is removed from the overlay div. In the current design, the overlay div's pointer-events gate is managed at the wrapper level, and PAL's internal canvas manages its own pointer-events based on the active tool (line 8871). The wrapper's `pointer-events: none` prevents any mouse events from reaching the canvas during zoom.

**Warning signs:** Strokes landing at wrong positions after zoom, selection hit-testing failing.

### Pitfall 3: Double-Rendering on Prop Change

**What goes wrong:** When `layerScale` switches from frozen to live after zoom settle, PAL's scale useEffect fires. If the direct-resize path (non-zoom) also fires because `inZoomModeRef` was already cleared, the canvas may be resized twice.

**Why it happens:** The scale useEffect has two paths: zoom-mode (deferred) and direct (immediate rAF). If `inZoomModeRef` is cleared too early, the scale change from frozen->live hits the direct path and queues an rAF. Then if the zoom-mode settle callback also fires (from a pending timer), the canvas gets two resizes.

**How to avoid:** Clear `inZoomModeRef` INSIDE the settle callback, AFTER the Fabric render is queued. This is the existing pattern (line 7868). Since PAL's independent 300ms timer is being removed, the settle callback will be triggered by the scale prop change while `inZoomModeRef` is still latched. The callback clears the latch after queuing.

**Warning signs:** Canvas flickering or double-rendering after zoom settle. Console timing logs showing two `fabric_renderStart` events in quick succession.

### Pitfall 4: Stale `onScaleApplied` References in `schedulePaintCommitted`

**What goes wrong:** `schedulePaintCommitted` (line 3204) has `onScaleApplied` in its closure via the useCallback dependency array (line 3233). After removing `onScaleApplied` from the prop list, the default value becomes `null`. The `typeof onScaleApplied === 'function'` check (line 3226) will safely no-op.

**Why it happens:** `schedulePaintCommitted` is used for the double-rAF paint-commit lifecycle which also tracks `paintCommitTokenRef`. It's referenced by the scale useEffect.

**How to avoid:** Keep `schedulePaintCommitted` function. Remove `onScaleApplied` from its dependency array. The internal `typeof onScaleApplied === 'function'` guard ensures no crash. But remove it from the useCallback deps to avoid unnecessary re-creation.

**Warning signs:** React "missing dependency" lint warning if `onScaleApplied` is removed from deps but still referenced inside the callback.

### Pitfall 5: Wrapper CSS Transform on Non-Center Pages

**What goes wrong:** PAL currently applies a per-page CSS transform to `wrapperEl` (the Fabric canvas wrapper) for non-center pages (lines 7891-7894). This is a PAL-level transform SEPARATE from the overlay div transform applied by App.jsx.

**Why it happens:** The PAL wrapper transform was a bridge: when App.jsx removed the overlay transform per-page (via confirm-pending), non-center pages that hadn't finished their Fabric render yet needed a wrapper transform to maintain visual continuity.

**How to avoid:** Remove the PAL wrapper CSS transform logic entirely (lines 7891-7894 and the cleanup at lines 7903-7906). In the new design, App.jsx removes overlay div transforms globally when the settle timer fires. PAL's tiered rendering handles the visual gap: center page gets immediate Fabric render, non-center pages show the CSS-scaled (blurry) overlay until their delayed render fires. The overlay div transform removal happens AFTER the center page's Fabric render, so the brief blurriness of non-center pages is the expected behavior.

**Warning signs:** Non-center pages showing wrong-scale annotations for a frame after zoom settle.

## Code Examples

### Simplified Scale useEffect Structure

```javascript
// Source: Analysis of PAL lines 7788-8028 with CONTEXT.md decisions applied
useEffect(() => {
  // REMOVED: if (isHidden) return;
  if (!fabricRef.current || !width || !height) return;

  const canvas = fabricRef.current;
  const currentZoom = canvas.getZoom();
  const scaleJump = Math.abs(scale - currentZoom);

  // Interaction deferral (KEEP -- separate concern from zoom)
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

    // Cancel pending viewport observer/deferred timer
    if (viewportObserverRef.current) {
      viewportObserverRef.current.disconnect();
      viewportObserverRef.current = null;
    }
    if (deferredZoomScaleRef.current?._timerId) {
      clearTimeout(deferredZoomScaleRef.current._timerId);
    }
    deferredZoomScaleRef.current = null;

    // REMOVED: 300ms zoomSettleTimerRef timer
    // CHANGED: If isZooming is still true, just store pending and return.
    // If isZooming is false, this scale change IS the settle signal.
    if (isZoomingRef.current) {
      // Still zooming -- just store pending, wait for next scale change
      return;
    }

    // Zoom settled! Execute tiered redraw.
    // (Settle callback body from existing code, minus the timer wrapper)
    const finalScale = pendingScaleRef.current ?? scale;
    pendingScaleRef.current = null;
    const tw = Math.floor(width * finalScale);
    const th = Math.floor(height * finalScale);
    inZoomModeRef.current = false;

    // ... tiered rendering (center -> visible -> off-screen) ...
    // Same as existing doFabricRender + tier classification code
    // REMOVED: wrapperEl CSS transform for non-center pages (lines 7891-7894)
    // REMOVED: onScaleApplied callbacks (5 call sites)
    return;
  }

  // Direct resize path (no zoom in progress) -- KEEP as-is minus onScaleApplied
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

  // Auto-recalculates offset on every pointer event
  this.calcOffset();
  pointer.x = pointer.x - this._offset.left;
  pointer.y = pointer.y - this._offset.top;

  // CSS scale correction: canvas internal size vs visual (BoundingClientRect) size
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

### App.jsx layerScale Simplification Target

```javascript
// Source: App.jsx render loop lines 24643-24662 (current Phase 3 state)
// Current: frozen scale during zoom, live scale after
const layerScale = isZoomActive
  ? frozenPageScale    // Prevents PAL re-render during zoom
  : fallbackPageScale; // Live measured scale after settle

// Phase 4 change: This logic stays. The key is that when overlayZoomActiveRef
// goes false (settle timer fires), isZoomActive becomes false in the next render,
// causing layerScale to switch from frozen to live. This prop change triggers
// PAL's scale useEffect.
```

## State of the Art

| Old Approach (Current PAL) | New Approach (Phase 4) | Impact |
|---------------------------|------------------------|--------|
| PAL runs independent 300ms settle timer | PAL reacts to scale prop change (driven by App.jsx 1000ms settle) | Eliminates timer race condition, single source of truth |
| PAL applies wrapper CSS transform for non-center pages | App.jsx handles all CSS transforms on overlay divs | Removes redundant transform layer, simplifies coordinate system |
| PAL calls `onScaleApplied` back to App.jsx for per-page confirm-pending | No callback needed -- App.jsx removes transforms globally on settle | Removes entire callback chain, ~14 call sites eliminated |
| `isHidden` prop gates PAL rendering | Overlay div visibility handled by render loop (portal creation/removal) | One less prop, simpler component API |

**Deprecated/removed in Phase 4:**
- `zoomSettleTimerRef` (PAL): Independent 300ms timer -- replaced by scale prop change detection
- `onScaleApplied` prop: Confirm-pending callback -- no longer needed
- `presentationApiRegistry` prop: Zoom presentation mode -- no longer needed
- `isHidden` prop: Early-return gate -- overlay div lifecycle handles this
- PAL wrapper CSS transform (lines 7891-7894, 7903-7906): Redundant with overlay div transforms

## Open Questions

1. **`isZooming` prop source: `useZoomState` vs `overlayZoomActiveRef`**
   - What we know: `useZoomState.isZooming` goes false after ~60ms. `overlayZoomActiveRef` goes false after 1000ms (the authoritative settle signal). PAL currently receives `isZooming` from `useZoomState`.
   - What's unclear: Should Phase 4 change the `isZooming` prop to derive from `overlayZoomActiveRef`? Or keep the current source and rely on the scale prop change as the actual settle signal?
   - Recommendation: Keep `isZooming` from `useZoomState` as-is. The scale prop change (frozen -> live) is the authoritative trigger. `isZooming` is used only to SET the zoom latch (`inZoomModeRef`), not to CLEAR it. The latch is cleared when a scale change arrives while `!isZoomingRef.current`. This works because the scale prop only changes when App.jsx's overlay settle timer fires.

2. **`schedulePaintCommitted` cleanup**
   - What we know: `schedulePaintCommitted` internally calls `onScaleApplied` (line 3226-3228). With `onScaleApplied` defaulting to `null`, the call no-ops safely.
   - What's unclear: Should `schedulePaintCommitted` be simplified to remove the `onScaleApplied` call entirely, or left as-is for minimal diff?
   - Recommendation: Remove `onScaleApplied` from `schedulePaintCommitted`'s useCallback dependency array and remove the conditional call inside it. This is a small cleanup that prevents lint warnings and makes the dead-code removal explicit. Keep the double-rAF paint-commit pattern itself -- it's still used for compositing coordination.

3. **Center page detection with new overlay div structure**
   - What we know: Center page detection uses `wrapperEl.getBoundingClientRect()` to find which canvas straddles the viewport center (lines 7878-7885).
   - What's unclear: Does the new overlay div structure affect `wrapperEl` positioning?
   - Recommendation: No change needed. `wrapperEl` is Fabric.js's internal canvas wrapper (created by Fabric.js, not by our code). Its position in the DOM is inside the overlay div, which is positioned `absolute; top:0; left:0; width:100%; height:100%` inside the page div. `getBoundingClientRect()` reflects the final visual position regardless of DOM hierarchy.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | @playwright/test 1.58.2 |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test --config debug/playwright.config.mjs --grep "pal-zoom"` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZOOM-09 | Canvas redraws crisp after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "canvas redraws crisp"` | No -- Wave 0 |
| OVLY-04 | Fabric.js pointer events work after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "pointer events"` | No -- Wave 0 |
| PRES-01 | Drawing tools work after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "drawing tools"` | No -- Wave 0 |
| PRES-02 | Search highlights positioned correctly | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "search highlights"` | No -- Wave 0 |
| PRES-03 | Undo/redo works after zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "undo.redo"` | No -- Wave 0 |
| PRES-04 | Proxy rendering works at all zoom levels | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "proxy rendering"` | No -- Wave 0 |
| PRES-05 | No console errors during zoom | e2e | `npx playwright test --config debug/playwright.config.mjs --grep "no console errors"` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx playwright test --config debug/playwright.config.mjs --grep "pal-zoom" -x`
- **Per wave merge:** `npx playwright test --config debug/playwright.config.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `debug/scenarios/pal-zoom.spec.mjs` -- covers ZOOM-09, OVLY-04, PRES-01 through PRES-05
- [ ] Shared helper: `setupPage()` function (copy from zoom-handler.spec.mjs for consistency)
- [ ] Shared helper: `getCanvasDimensions()` function to read Fabric canvas internal dimensions for ZOOM-09 crisp verification
- [ ] Console error collector: `page.on('console', ...)` listener pattern for PRES-05

## Sources

### Primary (HIGH confidence)

- **Fabric.js 5.5.2 source** (`node_modules/fabric/dist/fabric.js`) -- Verified `calcOffset()` (line 9149), `getPointer()` (lines 12504-12557), `getElementOffset()` (lines 3455-3485), `_onResize` auto-calcOffset (line 13339). Fabric.js 5.x auto-corrects pointer coordinates via `getBoundingClientRect()` cssScale ratio.
- **PAL scale useEffect** (`src/PageAnnotationLayer.jsx` lines 7788-8028) -- Full code read. Identified 300ms settle timer (line 7955), 5 `onScaleApplied` call sites, wrapper CSS transform (lines 7891-7894), tiered rendering pattern, `inZoomModeRef` latch behavior.
- **App.jsx overlay settle timer** (`src/App.jsx` lines 12117-12178) -- Full code read. 1000ms primary + 5000ms safety timer. Removes CSS transforms and resets `overlayZoomActiveRef`.
- **App.jsx render loop** (`src/App.jsx` lines 24571-24840) -- Full code read. `layerScale` frozen vs live computation. Portal creation targeting `overlayDivsRef`.
- **`useZoomState` hook** (`src/hooks/useZoomState.js`) -- Full code read. 60ms debounce. `isZooming = Math.abs(cssScale - 1) > 0.001`.
- **UI-SPEC** (`.planning/phases/04-pal-zoom-simplification/04-UI-SPEC.md`) -- Visual invariants, redraw sequence contract, pointer event restoration order.
- **CONTEXT.md** (`.planning/phases/04-pal-zoom-simplification/04-CONTEXT.md`) -- Locked decisions on settle timer removal, prop removal, redraw sequence.

### Secondary (MEDIUM confidence)

- [Fabric.js GitHub Issue #748](https://github.com/fabricjs/fabric.js/issues/748) -- calcOffset/setCoords interaction patterns
- [Fabric.js GitHub Issue #781](https://github.com/fabricjs/fabric.js/issues/781) -- Mouse position with scrolled parent div
- [Fabric.js 5 Transformations docs](https://fabric5.fabricjs.com/using-transformations) -- Coordinate system explanation

### Tertiary (LOW confidence)

None -- all findings verified against source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in use, no new dependencies
- Architecture: HIGH -- Phase 4 simplifies existing code rather than introducing new patterns. All code paths verified by reading source.
- Pitfalls: HIGH -- Timing mismatch between `isZooming` and overlay settle timer verified by reading both `useZoomState.js` (60ms debounce) and `App.jsx` (1000ms settle timer). Fabric.js pointer correction verified by reading `getPointer()` source.

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable -- Fabric.js 5.x is mature, no breaking changes expected)
