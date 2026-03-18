# Domain Pitfalls: Canvas Overlay Zoom Refactor (Direct Child Attachment)

**Domain:** PDF viewer annotation overlay zoom handling refactor
**Researched:** 2026-03-17
**Confidence:** HIGH (verified against codebase, Fabric.js documentation, React documentation, and community issue trackers)

## Critical Pitfalls

Mistakes that cause rewrites, regressions, or major user-visible breakage.

---

### Pitfall 1: Fabric.js Pointer Coordinate Corruption After DOM Reparenting

**What goes wrong:** After moving the overlay div (and thus the Fabric.js canvas) to a new Syncfusion page div via `appendChild()`, all pointer coordinates become wrong. Users click on one annotation but a different one is selected (or nothing is selected). Drawing tools place strokes in the wrong location. The canvas appears to work visually but interaction is silently broken.

**Why it happens:** Fabric.js caches the canvas element's offset relative to the document viewport at initialization time and during window resize events. When the canvas's DOM parent changes (Step 5 of the design spec -- re-attaching overlay div after Syncfusion recreates page containers), the cached offset becomes stale. Fabric.js uses `getBoundingClientRect()` internally for `getPointer()`, but the cached `_offset` values used for coordinate translation are not automatically recalculated on DOM moves. This is a well-documented issue (fabricjs/fabric.js#778, #748, #82).

**Consequences:**
- Pen/highlighter strokes drawn at wrong canvas positions
- Selection hit-testing fails (objects not selectable at their visual location)
- Eraser misses targets
- Context menus appear at wrong positions
- All of these failures are SILENT -- no console errors, just wrong behavior

**Prevention:**
1. After every `pageDiv.appendChild(overlayDiv)` call in the `useEffect` watching `syncfusionPageContainers`, immediately call `fabricRef.current.calcOffset()` on every Fabric.js canvas instance whose overlay div was reparented.
2. PAL does not directly expose `calcOffset()` -- either:
   - Add a ref-based imperative handle (`useImperativeHandle`) to PAL that exposes a `recalcOffset()` method, OR
   - Trigger the recalculation by briefly toggling a `forceRecalcOffset` prop, OR
   - Have PAL listen for its container element being reparented (e.g., via a ResizeObserver or by checking `parentElement` in the scale useEffect) and call `calcOffset()` automatically.
3. After `calcOffset()`, also call `setCoords()` on all canvas objects to update their interactive bounding boxes.
4. Test by: zoom in, wait for settle, then try to select/draw on annotations. If coordinates are off, this pitfall was hit.

**Detection (warning signs):**
- Annotations visually present but not selectable after zoom
- Drawing strokes appear offset from cursor
- Works fine on initial load, breaks only after a zoom cycle that triggers page container recreation

**Phase mapping:** Must be addressed in Step 5 (Handle page container recreation) and verified immediately in Step 5 testing. Do NOT defer to Step 6.

**Sources:**
- [fabricjs/fabric.js#778 - Moving parent wrapper loses coordinates](https://github.com/fabricjs/fabric.js/issues/778)
- [fabricjs/fabric.js#748 - calcOffset/setCoords issue](https://github.com/fabricjs/fabric.js/issues/748)
- [Fabric.js Gotchas - setCoords documentation](https://fabricjs.com/docs/old-docs/gotchas/)

---

### Pitfall 2: CSS Transform on Overlay Div Breaks Fabric.js Pointer Events During Zoom

**What goes wrong:** The design spec applies `transform: scale(ratio)` + `transform-origin: top left` to the overlay div during zoom transitions (Step 2). While this provides correct visual scaling, it can break Fabric.js mouse/pointer interactions if a user attempts to draw or select during the zoom transition window.

**Why it happens:** When a CSS transform is active on an ancestor element, `getBoundingClientRect()` returns the element's rendered (transformed) dimensions. Fabric.js 5.5.2's `getPointer()` does use `getBoundingClientRect()` and should theoretically handle this correctly. However, the `_offset` cache (updated by `calcOffset()`) uses `offsetWidth`/`offsetHeight` which do NOT reflect CSS transforms. If `calcOffset()` runs while the transform is active, the cached offset will be wrong for the post-transform state. Additionally, when `offsetWidth` and `getBoundingClientRect().width` disagree (which happens under CSS transforms), Fabric.js coordinate math produces inconsistent results.

**Consequences:**
- If a user tries to interact during the zoom transition (before settle), annotations are drawn at wrong positions
- After zoom settles (CSS transform removed + canvas redrawn), everything works again
- The danger is if the CSS transform is NOT properly removed after settle -- then ALL drawing/selection is permanently broken until the next zoom cycle

**Prevention:**
1. Disable pointer events on the canvas during the entire CSS transform phase. The overlay div already has `pointer-events: none` in the design spec, and PAL manages its own `pointer-events: auto` on the canvas element (line ~8871). During the CSS transform phase, PAL should also set `pointer-events: none` on its canvas wrapper.
2. Use the existing `isZooming` prop to disable pointer events. The code at line ~8871 conditionally sets `pointerEvents` based on the active tool -- extend this to also return `'none'` when `isZooming` is true.
3. Ensure the CSS transform removal (in the settle timer callback) happens BEFORE triggering the canvas resize/redraw. If the transform is still present when Fabric.js calls `renderAll()` and subsequently `calcOffset()`, the new offset calculation will be wrong.
4. Never leave a CSS transform on the overlay div after settle. Add a safety sweep: after the settle timer fires, iterate all overlay divs and force-clear any remaining transforms.

**Detection (warning signs):**
- Drawing works at some zoom levels but not others
- Annotations drawn during zoom appear offset from cursor
- After removing CSS transform, `calcOffset()` returns wrong values

**Phase mapping:** Step 2 (Simplify zoom handlers) -- the CSS transform application/removal logic. Step 4 (PAL zoom handling) -- the pointer-events disabling during zoom.

**Sources:**
- [CSS transform issue with canvas coordinates - mapbox/mapbox-gl-js#7701](https://github.com/mapbox/mapbox-gl-js/issues/7701)
- [DOM Element Dimensions and CSS Transforms](https://www.impressivewebs.com/dom-element-dimensions-and-css-transforms/)
- [fabricjs/fabric.js#778 - offset recalculation after DOM change](https://github.com/fabricjs/fabric.js/issues/778)

---

### Pitfall 3: React Portal Target Stability -- Changing `createPortal` Target Triggers Full Unmount/Remount

**What goes wrong:** If the `createPortal(children, domNode)` call receives a DIFFERENT `domNode` reference between renders, React unmounts ALL portal children (including the Fabric.js canvas component) and remounts them from scratch. This destroys the Fabric.js canvas instance, all its in-memory objects, event listeners, undo history references, and any in-progress drawing operations.

**Why it happens:** React treats `createPortal` target identity as part of its reconciliation. If the target DOM node reference changes, React sees it as a new portal and tears down the old one completely. The design spec creates overlay divs via `overlayDivsRef` and reuses them, which should avoid this -- but there are several ways the reference can accidentally change:
- Creating a new overlay div when the old one was detached (instead of reattaching the existing one)
- A re-render path that calls `document.createElement('div')` again for a page that already has an overlay div
- The overlay div reference in the ref being cleared when Syncfusion removes the page div

**Consequences:**
- Fabric.js canvas destroyed mid-zoom
- All annotation objects in memory lost (must reload from data model)
- Active drawing operations cancelled
- Undo/redo stack references invalidated
- 500ms+ re-initialization time per canvas (setWidth + setHeight + renderAll)
- Visual flash as canvas disappears and reappears

**Prevention:**
1. The `overlayDivsRef.current[pageNumber]` must be treated as an eternal reference for the lifetime of the document. NEVER delete or recreate entries. The `attachOverlayToPageDiv()` function (Step 1) must check `overlayDivsRef.current[pageNumber]` FIRST and only create a new div if none exists.
2. When Syncfusion destroys a page div, the overlay div becomes an orphan (detached from DOM but still in memory via the ref). This is CORRECT behavior. The re-attachment effect (Step 5) will put it back.
3. Do NOT clean up `overlayDivsRef` entries when pages leave the viewport. The div must persist even when not visible, because clearing it and recreating it later would change the `createPortal` target reference.
4. Add a guard: if `overlayDivsRef.current[pageNumber]` already exists, return the existing div instead of creating a new one. Never overwrite.

**Detection (warning signs):**
- Fabric.js canvas `dispose()` called unexpectedly during zoom (check PAL cleanup effect at line ~7783)
- Annotations disappear and then slowly reappear after zoom
- Console shows PAL component mounting/unmounting during zoom cycles
- `[Page X] Disposal error` messages in console during zoom

**Phase mapping:** Step 1 (Create overlay attachment function) and Step 3 (Render loop). These two steps MUST maintain portal target identity. Verify by adding a temporary `console.warn` in PAL's mount/unmount cleanup effect that fires if `fabricRef.current` is being disposed during what should be a zoom cycle.

**Sources:**
- [React createPortal documentation](https://react.dev/reference/react-dom/createPortal)
- [React Issue #12247 - Portal container changes cause remounting](https://github.com/facebook/react/issues/12247)
- [React Issue #10826 - Cannot prevent portal unmounting](https://github.com/facebook/react/issues/10826)

---

### Pitfall 4: Dual Settle Timer Race Condition (App.jsx 1000ms vs PAL 300ms)

**What goes wrong:** The design spec introduces a 1000ms settle timer in `handleSyncfusionZoomChange` (Step 2a, item 4). PAL already has its own 300ms settle timer (line ~7955) for deferred Fabric.js canvas resize. These two timers interact in ways that cause either: (a) the CSS transform being removed before PAL has redrawn at the new resolution (flash of stale pixels), or (b) PAL trying to resize while the CSS transform is still active (wrong dimensions calculated from transformed layout).

**Why it happens:** Two independent debounce timers operate on the same visual output but have no coordination:
- App.jsx timer (1000ms): removes CSS transform from overlay div, then updates React `scale` state
- PAL timer (300ms after receiving new scale prop): performs expensive Fabric.js `setWidth`/`setHeight`/`setZoom`/`renderAll`

If the App.jsx timer fires at T=1000ms, it removes the CSS transform and sets the scale state. React propagates the new scale to PAL. PAL's scale useEffect fires, enters zoom mode via the latch, and starts its own 300ms timer. The CSS transform is already removed at this point, so for 300ms the canvas shows the OLD resolution at the NEW zoom level -- visually wrong (blurry at low-to-high zoom, pixelated at high-to-low zoom).

**Consequences:**
- 300ms window where annotations appear at wrong resolution after zoom
- If the user rapid-zooms, the two timers can interleave unpredictably
- The exact timing depends on React batching, which varies by React version and concurrent mode

**Prevention:**
1. Do NOT remove the CSS transform in the App.jsx settle timer. Instead, only update the React `scale` state. Let PAL's own settle/render logic handle both: (a) resize the canvas to the new resolution, THEN (b) remove the CSS transform from the wrapper div (PAL already does this at lines 7903-7906 by clearing `wrapperEl.style.transform`).
2. The App.jsx settle timer should: release the `scale` state freeze (so PAL receives the new scale) and nothing else. PAL is responsible for the visual transition from CSS-scaled to natively-rendered.
3. Alternatively, keep a single timer system. Since PAL already has a well-tested settle mechanism with center-page priority and deferred rendering for off-screen pages (lines 7876-7953), let it be the authority. App.jsx should only freeze scale state during zoom and release it after the last zoom event + a small buffer (500ms, since PAL's 300ms timer handles the rest).
4. Add a `data-css-scaled` attribute to the overlay div when CSS transform is active, and have PAL check it in `doFabricRender` to clear the parent transform only when it is actually present.

**Detection (warning signs):**
- Brief flash of blurry/wrong-size annotations AFTER zoom settles (not during zoom)
- Flash duration is approximately 300ms
- More visible when zooming to higher zoom levels (the resolution mismatch is more obvious)
- Inconsistent behavior between zoom methods (some fire Syncfusion's onZoomChanged at different rates)

**Phase mapping:** Step 2 (Simplify zoom handlers) must carefully coordinate with Step 4 (PAL zoom handling). Test them together, not independently.

---

### Pitfall 5: Incomplete Dead Code Removal Leaves Zombie Refs That Overwrite New Logic

**What goes wrong:** The design spec lists ~20 refs and ~14 functions to remove in Step 6. If any of these are only partially removed (function deleted but call site missed, or ref deleted but still written to elsewhere), the app crashes at runtime or silently reverts to old behavior. Worse: if old effects/callbacks that reference removed refs are left in place, they can overwrite the new overlay div state or interfere with the simplified zoom flow.

**Why it happens:** App.jsx is 25,000+ lines with 615+ hook calls and 227 useState declarations. The refs and functions being removed are deeply entangled:
- `syncfusionStablePortalHostsRef` is referenced in the render loop, in `ensureSyncfusionStablePortalChildren`, in `resolveSyncfusionOverlayPortalHost`, and in several effects
- `zoomOverlayTransformActiveRef` is read in the render loop's `shouldFreezePortalHost` calculation (line ~24337), in ref callbacks (line ~24585), and in the zoom handler (line ~12355)
- `beginSyncfusionScaleConfirmPending` is called from 4 different locations (zoom settle at line ~12473, keyboard settle, ctrl-key settle, finalize-idle at line ~10663)

Missing a single call site means the old code path still executes, and it will try to manipulate DOM elements or refs that no longer exist or have been replaced by the new system.

**Consequences:**
- `TypeError: Cannot read properties of undefined` at runtime
- Silent data corruption if old code writes to a ref that new code also reads
- Intermittent failures that only occur under specific zoom paths (e.g., works with scroll wheel but crashes with toolbar buttons)
- Extremely difficult to debug because the error manifests far from the root cause

**Prevention:**
1. Before deleting ANY ref or function, grep the entire codebase for ALL references to it. Not just the file -- check for dynamic access patterns and string references too.
2. Delete in dependency order: first remove call sites, then remove the functions, then remove the refs/state. NEVER remove a ref before removing all code that reads/writes it.
3. After removing each function, run the dev server and test ALL 6 zoom methods. Do not batch removals.
4. Use a checklist approach: for each item in the design spec's removal lists, mark off (a) all call sites found, (b) all call sites removed, (c) build succeeds, (d) tested.
5. For the render loop specifically (lines ~24330-24700): rewrite the entire section rather than surgically removing pieces. The existing logic is too interwoven -- 370 lines of tightly coupled ref reads, portal host resolution, frozen scale calculations, and presentation mode syncing. Write the new simple version, then replace the entire block.

**Detection (warning signs):**
- Any `undefined` or `TypeError` errors in the console after the refactor
- Zoom works differently depending on which method is used (some methods trigger different code paths)
- Memory leaks from orphaned timers (check `setTimeout` calls in removed functions that never get `clearTimeout`)
- `clearTimeout` called on timer IDs from removed refs (harmless no-ops that hide missing cleanup)

**Phase mapping:** Step 6 (Remove dead code). Must be the LAST step, after Steps 1-5 are fully verified. Do NOT interleave cleanup with feature work.

---

## Moderate Pitfalls

Mistakes that cause bugs requiring investigation but not full rewrites.

---

### Pitfall 6: Overlay Div Sizing Mismatch During Syncfusion's Multi-Frame Zoom Resize

**What goes wrong:** The overlay div is styled `width: 100%; height: 100%` so it fills its parent page div. But during Syncfusion's zoom transition, the page div dimensions change in discrete steps (Syncfusion updates width/height CSS properties on the page div over multiple frames). During this window, `width: 100%` resolves to intermediate sizes.

**Why it happens:** Syncfusion's zoom implementation resizes page divs by setting explicit pixel dimensions. The resize may not happen in a single frame -- it can take 2-3 frames for Syncfusion to reach the final dimensions.

**Prevention:**
1. The overlay div's `width: 100%; height: 100%` is actually fine for the final state, because by the time the settle timer fires and PAL redraws, the page div is at its final size.
2. During the CSS transform phase, the overlay div should NOT be resized by PAL. The CSS `transform: scale(ratio)` handles visual sizing. The canvas inside stays at its old pixel dimensions.
3. If PAL reads `offsetWidth`/`offsetHeight` from the overlay div or its wrapper to compute canvas dimensions (e.g., in `wrapperEl.getBoundingClientRect()` at line ~7879), it may get intermediate values during zoom. PAL should use the `width` and `height` PROPS (which come from `resolvedPageSize`) rather than measuring its DOM container for dimension calculations.

**Detection:**
- Canvas dimensions don't match expected size at certain zoom levels
- Annotations appear slightly stretched or compressed after zoom
- Issue is more visible on large zoom jumps (e.g., 50% to 200%)

**Phase mapping:** Step 3 (Render loop) and Step 4 (PAL zoom handling). Verify that PAL uses props not DOM measurements for sizing.

---

### Pitfall 7: MutationObserver Fires Before New Page Div is Fully Initialized

**What goes wrong:** The `SyncfusionPDFContainer` MutationObserver (line ~311) fires on `childList` changes to the page container. When Syncfusion destroys and recreates a page div during zoom, the MutationObserver fires when the new div is added. But the new div may not yet have all its attributes set (e.g., `data-page-number`).

**Why it happens:** MutationObservers fire synchronously within the microtask queue after a DOM mutation. Syncfusion may add the page div in one step, then set its attributes in subsequent steps. The observer fires after the first step.

**Prevention:**
1. The re-attachment `useEffect` in Step 5 watches `syncfusionPageContainers` state, not the raw MutationObserver. The `emitPageContainerMap` in SyncfusionPDFContainer already debounces via `requestAnimationFrame` (`schedulePageContainerRefresh` at line ~256). This provides a 1-frame delay.
2. The overlay div is appended as a child of the page div -- it does not depend on the page div's internal structure. As long as the page div element itself exists and is connected, appending is safe.
3. The `computePageContainerMap` function (line ~198) resolves page numbers via multiple fallback strategies (dataset, ID pattern, attribute). This is resilient to partially-initialized divs.
4. Edge case: if Syncfusion fires multiple rapid DOM mutations during a single zoom operation, the state-driven useEffect will batch them naturally (React batches state updates within the same event loop tick).

**Detection:**
- Overlay div attached to wrong page div (rare)
- Annotations briefly appear on wrong page during zoom
- `overlayDiv.parentElement !== pageDiv` condition in useEffect fires repeatedly for the same page

**Phase mapping:** Step 5 (Handle page container recreation). Likely a non-issue due to existing debouncing, but verify during testing.

---

### Pitfall 8: Fabric.js `renderAll()` Triggered During CSS Transform Phase Wastes CPU

**What goes wrong:** If something triggers `canvas.renderAll()` while the overlay div has a CSS transform applied (during zoom transition), the canvas re-renders at its old resolution. This is visually acceptable (CSS transform handles scaling) but wastes 5-30ms of main thread time per canvas per render. If multiple pages trigger simultaneous renders, this can cause jank during what should be a smooth CSS-only transition.

**Why it happens:** External events can trigger `renderAll()` during the zoom window: annotation data changes from Supabase real-time subscription, undo/redo operations, selection state changes, or highlight updates. The current code does not guard all of these paths against mid-zoom re-renders.

**Prevention:**
1. During the CSS transform phase (`isZooming === true`), PAL should suppress non-essential `renderAll()` calls. The existing `isInteracting` check (line 7807) already handles some cases by deferring canvas operations.
2. Audit all paths that can trigger `renderAll()` inside PAL and ensure they respect the zoom latch (`inZoomModeRef`).
3. If a render must happen during zoom, use `requestRenderAll()` instead of `renderAll()` -- it batches to the next animation frame and coalesces redundant renders.

**Detection:**
- Performance profiler shows Fabric.js `renderAll` calls during active zoom gesture
- Zoom feels janky on pages with many annotations (50+)
- CPU spikes during zoom that are not present on pages without annotations

**Phase mapping:** Step 4 (PAL zoom handling). Audit all `renderAll()` trigger paths.

**Sources:**
- [Fabric.js Optimizing Performance Wiki](https://github.com/fabricjs/fabric.js/wiki/Optimizing-performance)
- [fabricjs/fabric.js#5885 - Performance with hundreds of objects](https://github.com/fabricjs/fabric.js/issues/5885)

---

### Pitfall 9: `overlayDivsRef` Memory Growth on Long Sessions With Large PDFs

**What goes wrong:** The design spec stores overlay divs permanently in `overlayDivsRef.current[pageNumber]`. For a 500-page PDF where the user scrolls through all pages, this means 500 div elements are created and never garbage collected. Each div potentially has an attached React portal with a Fabric.js canvas instance.

**Why it happens:** The "never delete overlay divs" rule (Pitfall 3 prevention) is correct for portal stability, but it means DOM nodes accumulate. React portals keep their entire subtree in memory even when the target div is detached from the DOM.

**Prevention:**
1. This is acceptable for most PDFs (100-200 pages). The overlay div itself is lightweight (~200 bytes) -- the concern is the React portal children (PAL + Fabric.js canvas).
2. The render loop should only create portals for pages that have annotations OR are currently visible. Pages without annotations and outside the viewport should not have portals rendered into their overlay divs. The existing page filtering logic already does this.
3. When a page leaves the viewport AND has no annotations, unmount the portal children by returning `null` from the render function for that page. The overlay div stays in `overlayDivsRef` (for future reuse), but no React children are mounted into it. This means the Fabric.js canvas is disposed, freeing its memory.
4. Monitor memory usage during testing with large PDFs. If canvas instances are not being disposed when pages scroll far out of view, investigate.

**Detection:**
- Memory usage grows steadily as user scrolls through document
- Browser DevTools "Elements" panel shows increasing number of canvas elements
- Performance degrades after scrolling through many pages

**Phase mapping:** Step 3 (Render loop). Ensure the page filtering logic correctly limits which pages have active portals.

---

### Pitfall 10: `isZooming` Prop Flicker Between Scroll-Wheel Zoom Events Causes Premature Settle

**What goes wrong:** The `isZooming` prop passed to PAL briefly flickers to `false` between consecutive scroll-wheel zoom events. If PAL's settle timer fires during this false gap, it triggers an expensive canvas resize/render that is immediately invalidated by the next zoom event.

**Why it happens:** Scroll-wheel zoom fires discrete `onZoomChanged` events with ~100-200ms gaps. If the interaction tracking timeout (controlled by `markSyncfusionInteractionActive`) is shorter than this gap, `isZooming` transitions to `false` momentarily. PAL's settle timer (300ms) can fire during a gap between scroll events.

**Prevention:**
1. PAL already has the `inZoomModeRef` latch (line ~7814-7816) that prevents this -- once zoom starts, the latch stays true until the settle timer fires AND `isZoomingRef.current` is false. This is the correct pattern and MUST be preserved during the refactor.
2. The settle callback (line ~7851-7857) re-checks `isZoomingRef.current` and restarts the timer if zoom is still active. This guard MUST be preserved.
3. Do NOT change the settle timer from 300ms to a longer value to "fix" this -- the 300ms is carefully tuned for responsiveness. The latch pattern is the correct solution.

**Detection:**
- Canvas briefly goes blank/white during rapid scroll-wheel zoom
- Expensive `renderAll` fires multiple times per zoom gesture (check with Performance profiler)
- Annotations redraw at intermediate zoom levels during continuous scroll-wheel zoom

**Phase mapping:** Step 4 (Simplify PAL zoom handling). When the design spec says "Keep: isZooming latch and settle timer," take this literally -- preserve the entire pattern, not just the boolean.

---

## Minor Pitfalls

Issues that cause confusion or minor visual artifacts but are easily fixed.

---

### Pitfall 11: CSS Transform `transform-origin` Conflict Between App.jsx and PAL

**What goes wrong:** The design spec (Step 2a) sets `transform-origin: top left` on the overlay div in App.jsx. PAL's existing code (line ~7894) also sets `transform-origin: top left` on the Fabric.js `wrapperEl`. If both are active simultaneously during the transition from CSS-scaled to natively-rendered, the compound transform could produce incorrect visual positioning (though in practice, `top left` + `top left` nests correctly -- this is more of a maintenance hazard).

**Prevention:** With the new architecture, ONLY App.jsx should apply CSS transforms to the overlay div during zoom. PAL should NOT apply CSS transforms to `wrapperEl` during zoom (design spec Step 4, item 4 explicitly says to remove this). Ensure Step 4 removes the PAL wrapper transform logic (lines 7891-7906) before Step 2 adds the overlay div transform.

**Phase mapping:** Step 2 and Step 4 -- these must be coordinated.

---

### Pitfall 12: Sibling Layers (SearchHighlightLayer, SpaceRegionOverlay) Get Wrong Scale During CSS Transform

**What goes wrong:** SearchHighlightLayer, SpaceRegionOverlay, and LightweightAnnotationOverlay all receive `layerScale` as a prop. During the CSS transform phase, `layerScale` should be the PRE-zoom scale (since the CSS transform handles visual scaling). If `layerScale` is set to the NEW scale during the transform phase, these components render at the new size, and the CSS transform then scales them AGAIN -- a double-scaling effect.

**Prevention:** If the App.jsx settle timer freezes the React `scale` state during zoom (by deferring `setScale()` until the timer fires, as the design spec implies), then `layerScale` will naturally stay at the pre-zoom value during the transform phase. Verify this by logging `layerScale` during a zoom transition. If it changes before the CSS transform is removed, there is a double-scaling bug.

**Detection:**
- Search highlights appear too large or too small during zoom
- Region overlays jump or flash during zoom
- Double-scaling effect: elements grow/shrink too far then snap back on settle

**Phase mapping:** Step 2 (scale state freezing) and Step 3 (render loop layerScale calculation).

---

### Pitfall 13: Handling the "Overlay Div Exists But Page Div Does Not" Orphan State

**What goes wrong:** When Syncfusion destroys a page div during zoom, the overlay div (stored in `overlayDivsRef`) becomes an orphan -- it exists in the ref but has no parent in the DOM (`!overlayDiv.isConnected`). If `attachOverlayToPageDiv()` returns the orphaned div as the portal target, React renders children into a detached DOM node. This works (React portals CAN render into detached nodes) but the content is invisible to the user.

**Prevention:**
1. `attachOverlayToPageDiv()` should check whether the overlay div is connected. If not, attempt to find the page div and re-attach. If no page div exists yet, return `null` to skip rendering for this page this frame.
2. Returning `null` means the portal is not rendered this frame. When the re-attachment effect (Step 5) runs and appends the overlay div to the new page div, the next render cycle will find it connected and render the portal.
3. This brief invisibility (1-2 frames) is the intended behavior per the design spec: "much better than the current multi-frame flicker at wrong sizes."

**Phase mapping:** Step 1 (attachOverlayToPageDiv) and Step 5 (re-attachment).

---

### Pitfall 14: Adding CSS `transition` to the Overlay Transform

**What goes wrong:** Adding `transition: transform 300ms ease` to the overlay div to smooth the zoom animation causes the overlay to lag behind Syncfusion's instant page resize. Syncfusion resizes page divs synchronously during zoom. A CSS transition would cause the overlay to animate to the new size over 300ms, producing visible misalignment.

**Prevention:** Do not add CSS transition to the overlay div's transform. Apply the scale synchronously in the zoom handler. The visual effect of instant CSS transform scaling is already smooth because the GPU compositor applies it within a single frame.

---

### Pitfall 15: Using CSS `zoom` Property Instead of `transform: scale()`

**What goes wrong:** The CSS `zoom` property changes the element's layout box, affecting `offsetWidth`/`offsetHeight` and triggering layout recalculation. Fabric.js's pointer math relies on `getBoundingClientRect()`, which correctly handles `transform: scale()` but interacts unpredictably with `zoom` (since `zoom` changes both layout and rendering dimensions).

**Prevention:** Use `transform: scale()` exclusively. It is a compositor-only operation (no layout recalculation) and is verified to work with Fabric.js's coordinate system.

---

## Phase-Specific Warnings

| Phase / Step | Likely Pitfall | Mitigation |
|---|---|---|
| Step 1: Overlay attachment function | **Pitfall 3** (portal target identity) | Never recreate overlay divs. Check ref first, reuse always. |
| Step 2: Simplify zoom handlers | **Pitfall 2** (CSS transform breaks pointer events) | Disable pointer events during transform phase. Clear transforms before `calcOffset()`. |
| Step 2: Simplify zoom handlers | **Pitfall 4** (dual timer race condition) | App.jsx timer only releases scale state. PAL handles canvas resize + transform removal. |
| Step 3: Render loop | **Pitfall 3** (portal target change) | Always pass same `overlayDiv` reference to `createPortal`. Never overwrite refs. |
| Step 3: Render loop | **Pitfall 12** (wrong scale for sibling layers) | Freeze `layerScale` to base scale during CSS transform phase (defer `setScale()`). |
| Step 4: PAL zoom handling | **Pitfall 10** (isZooming flicker) | Preserve `inZoomModeRef` latch AND the settle callback re-check pattern. |
| Step 4: PAL zoom handling | **Pitfall 11** (double transform-origin) | Remove PAL wrapper CSS transform code. Only App.jsx applies CSS transforms. |
| Step 4: PAL zoom handling | **Pitfall 8** (wasted renderAll during zoom) | Audit all `renderAll()` triggers; guard with zoom latch. |
| Step 5: Page container recreation | **Pitfall 1** (Fabric.js coordinates broken) | Call `calcOffset()` + `setCoords()` on all objects after every re-attachment. |
| Step 5: Page container recreation | **Pitfall 7** (MutationObserver timing) | Rely on state-driven useEffect with existing rAF debounce. |
| Step 6: Dead code removal | **Pitfall 5** (incomplete removal) | Grep every identifier before removing. Delete in dependency order. Test after each removal. Rewrite render loop as a block rather than surgical edits. |

---

## Summary of Severity by Phase

| Phase | Critical Pitfalls | Moderate Pitfalls | Minor Pitfalls |
|---|---|---|---|
| Step 1 (Overlay attachment) | #3 | #9 | #13 |
| Step 2 (Zoom handlers) | #2, #4 | | #12, #14, #15 |
| Step 3 (Render loop) | #3 | #9 | #12 |
| Step 4 (PAL zoom handling) | | #6, #8, #10 | #11 |
| Step 5 (Page recreation) | #1 | #7 | #13 |
| Step 6 (Dead code removal) | #5 | | |

**Highest-risk phase:** Step 5 (page container recreation) -- it combines DOM manipulation with Fabric.js coordinate systems and React portal lifecycle. This is where Pitfall 1 (the most insidious bug, because it is silent) will surface.

**Second highest-risk phase:** Step 2 (zoom handler simplification) -- dual timers and CSS transform coordination require careful orchestration between App.jsx and PAL.

---

## Sources

### Verified (HIGH confidence)
- [fabricjs/fabric.js#778 - Moving parent wrapper loses coordinates](https://github.com/fabricjs/fabric.js/issues/778)
- [fabricjs/fabric.js#748 - calcOffset/setCoords issue](https://github.com/fabricjs/fabric.js/issues/748)
- [fabricjs/fabric.js#82 - Mouse coordinates incorrect in scrolled div](https://github.com/fabricjs/fabric.js/issues/82)
- [Fabric.js Gotchas - setCoords documentation](https://fabricjs.com/docs/old-docs/gotchas/)
- [Fabric.js Optimizing Performance Wiki](https://github.com/fabricjs/fabric.js/wiki/Optimizing-performance)
- [React createPortal documentation](https://react.dev/reference/react-dom/createPortal)
- [React Issue #12247 - Portal container changes cause remounting](https://github.com/facebook/react/issues/12247)

### Research (MEDIUM confidence)
- [CSS transform issue with canvas coordinates - mapbox/mapbox-gl-js#7701](https://github.com/mapbox/mapbox-gl-js/issues/7701)
- [DOM Element Dimensions and CSS Transforms](https://www.impressivewebs.com/dom-element-dimensions-and-css-transforms/)
- [fabricjs/fabric.js#5885 - Performance with hundreds of objects](https://github.com/fabricjs/fabric.js/issues/5885)
- [Canvas blur after rescale - fabricjs/fabric.js#7502](https://github.com/fabricjs/fabric.js/issues/7502)
- [React Issue #10826 - Cannot prevent portal unmounting](https://github.com/facebook/react/issues/10826)

### Project-specific
- Codebase analysis: `src/App.jsx` (lines ~9580-9710, ~12337-12487, ~24330-24700)
- Codebase analysis: `src/PageAnnotationLayer.jsx` (lines ~7788-8028, ~8869-8873)
- Codebase analysis: `src/components/SyncfusionPDFContainer.jsx` (lines ~198-317)
- Design spec: `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md`
- Project memory: Zoom Bug section (MEMORY.md)
- Known concerns: `.planning/codebase/CONCERNS.md`
