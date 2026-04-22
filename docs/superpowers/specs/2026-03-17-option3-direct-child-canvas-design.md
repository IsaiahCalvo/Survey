# Option 3: Make Fabric.js Canvas a Direct Child of Syncfusion Page Divs

## Problem

When the user zooms, annotations flicker — appearing at wrong sizes and positions before settling. This happens because our annotation canvases are connected to Syncfusion's page divs through a complex "React portal" system with freeze/unfreeze, snapshot/live presentation modes, CSS transform overlays, and confirm-pending timers. This system has multiple timing windows where things go wrong.

A reference app (at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App`) avoids flicker entirely by making its annotation overlays **direct children** of Syncfusion's page divs with `width: 100%; height: 100%`. When Syncfusion resizes the page div during zoom, the overlay resizes with it automatically. No custom zoom code needed.

## Goal

Simplify our annotation overlay system to behave like the reference app: annotation canvases stay attached to the page div and scale with it naturally during zoom. Remove the complex freeze/snapshot/confirm-pending machinery that causes timing bugs.

## Files Touched

- **Heavily modify:** `src/App.jsx` (~25,000+ lines — zoom handler, render loop, refs/state cleanup)
- **Simplify:** `src/PageAnnotationLayer.jsx` (~9,750 lines — remove zoom-related props and some deferred logic)
- **No changes:** `src/components/LightweightAnnotationOverlay.jsx`, `src/components/SyncfusionPDFContainer.jsx`, annotation data model, drawing tools

## Architecture Overview

### Current (Complex)
```
Syncfusion Page Div (destroyed/recreated during zoom)
  └── Stable Portal Host (persistent div, re-attached after recreation)
        └── Live Root (z-index 20, visibility toggled)
        └── Snapshot Root (z-index 24, cached image shown during transition)
              └── React Portal → PageAnnotationLayer → Fabric.js Canvas
```
Zoom flow: freeze portals → CSS transform overlay → defer React state → settle timer → confirm-pending → per-page canvas rebuild → remove CSS transform → unfreeze.

### Target (Simple)
```
Syncfusion Page Div
  └── Overlay Div (position: absolute; width: 100%; height: 100%)
        └── React Portal → PageAnnotationLayer → Fabric.js Canvas
                         → SearchHighlightLayer
                         → LightweightAnnotationOverlay (during interactions)
```
Zoom flow: CSS transform on overlay div during zoom → settle → canvas redraw at new resolution → remove CSS transform.

## Key Insight

The reference app's developer explained why their SVG overlays scale perfectly:
> "The SVG annotation overlays are children of Syncfusion's page divs, styled with `position: absolute; width: 100%; height: 100%` and use a `viewBox`. This means the SVG scales proportionally with its parent container automatically — when Syncfusion resizes the page div during zoom, the SVG scales with it."

Our Fabric.js canvas can't use `viewBox` (that's SVG-specific), but we can achieve a similar effect:
1. Keep the canvas at its current pixel size during zoom
2. Apply CSS `transform: scale(ratio)` + `transform-origin: top left` to visually match the new zoom level
3. After zoom settles, redraw the canvas at the correct resolution and remove the CSS transform

During the transition, the canvas will look slightly blurry (like zooming into a photo) but will **never disappear or jump to a wrong position**. This is the same behavior as Adobe Acrobat and pdf.js.

## Implementation Plan

**Important: Work on a feature branch.** Keep the current code on `Layer-Revamp` intact until this is verified. Create a new branch like `option3-direct-child-canvas`.

**Work incrementally:** Get Steps 1-3 working and testable before moving to Steps 4-6. Verify zoom behavior after each step.

### Step 1: Create a simplified overlay attachment function

**File:** `src/App.jsx`

Create a new function `attachOverlayToPageDiv(pageNumber)` that:
1. Finds the Syncfusion page div. Use the existing approach from `resolveSyncfusionLivePageHost()` (around line ~12003-12022). The current code queries by both ID pattern (`{viewerElementId}_pageDiv_{pageIndex}`) and by `data-page-number` attribute. Copy this lookup logic — do NOT change it.
2. Creates or reuses a persistent overlay div per page (store in a ref like `overlayDivsRef`)
3. Styles it: `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 20;`
4. Appends it to the page div if not already attached
5. Returns the overlay div as a portal target

This replaces:
- `syncfusionStablePortalHostsRef`
- `syncfusionStablePortalLiveRootsRef`
- `syncfusionStablePortalSnapshotHostsRef`
- `ensureSyncfusionStablePortalChildren()` (around line ~9620-9657)
- `resolveSyncfusionOverlayPortalHost()` (around line ~12039-12088)

### Step 2: Simplify ALL zoom handlers

**There are 3 zoom entry points in App.jsx.** All must be simplified:

#### 2a. `handleSyncfusionZoomChange` (lines ~12337-12487)
This is the main zoom handler fired by Syncfusion's `onZoomChanged` event.

Replace with a simpler version:
1. Update `scaleRef.current` with the new scale (keep this)
2. Calculate the scale ratio: `newScale / baseScale` (where `baseScale` is the scale when zoom started)
3. Apply `transform: scale(ratio); transform-origin: top left;` to each page's overlay div (use `overlayDivsRef`)
4. Start/restart a settle timer (1000ms)
5. When the timer fires:
   - Remove the CSS transform from all overlay divs
   - Update the `scale` React state so PAL re-renders at the correct resolution
6. Keep: `markSyncfusionInteractionActive()` calls, zoom mode tracking, `bumpOverlayLagEventTotal()`

#### 2b. Keyboard/toolbar zoom handler (around line ~21204-21216)
This handler has its own settle timer that calls `beginSyncfusionScaleConfirmPending('keyboard_toolbar_settle')`.
- Remove the `beginSyncfusionScaleConfirmPending` call
- The zoom will flow through `handleSyncfusionZoomChange` anyway (Syncfusion fires `onZoomChanged` for all zoom methods), so this handler may just need its confirm-pending call removed.

#### 2c. Ctrl+key zoom handler (around line ~21691-21703)
Same as 2b — has its own settle timer calling `beginSyncfusionScaleConfirmPending('ctrl_key_settle')`.
- Remove the `beginSyncfusionScaleConfirmPending` call.

#### 2d. Interaction finalize-idle handler (around line ~10663)
Calls `beginSyncfusionScaleConfirmPending('finalize_idle')`.
- Remove this call. The finalize-idle handler can stay otherwise.

**Remove from all zoom paths:**
- `zoomOverlayTransformActiveRef` and its freeze behavior
- `syncfusionPendingZoomScaleRef` (deferred scale commits)
- `syncfusionScaleConfirmPendingRef` and the entire confirm-pending system
- `beginSyncfusionScaleConfirmPending()` (all 4 call sites)
- `cancelSyncfusionScaleConfirmPending()`
- `handlePALScaleApplied()` (the per-page confirmation callback)
- `syncSyncfusionZoomPresentationPage()` and presentation mode logic
- `prepareSyncfusionZoomPresentationSwap()`
- The `queueSyncfusionOverlayTransformSync()` RAF loop

### Step 3: Simplify the render loop (portal creation)

**File:** `src/App.jsx` — the render section (lines ~24330-24700)

Replace the current complex render logic. The simplified version must include ALL sibling components that currently render alongside PageAnnotationLayer:

```jsx
// For each visible page with annotations:
const overlayDiv = attachOverlayToPageDiv(pageNumber);
if (!overlayDiv) return null;

// Scale: always use the current viewer scale. No freezing.
const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : (scale > 0 ? scale : 1);

return createPortal(
  <div
    key={`syncfusion-overlay-${pageNumber}`}
    ref={(node) => {
      if (node) {
        syncfusionOverlayLayerRefs.current[pageNumber] = node;
      } else {
        delete syncfusionOverlayLayerRefs.current[pageNumber];
      }
    }}
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 20,
    }}
  >
    {/* Search highlights — KEEP THIS */}
    {searchResultsByPage[pageNumber]?.length > 0 && (
      <SearchHighlightLayer
        pageNumber={pageNumber}
        width={resolvedPageSize.width}
        height={resolvedPageSize.height}
        scale={layerScale}
        highlights={searchResultsByPage[pageNumber]}
        activeMatchId={currentMatch?.id}
        isActiveMatchOnThisPage={currentMatch?.pageNumber === pageNumber}
      />
    )}

    {/* Annotation layer — simplified */}
    <PageAnnotationLayer
      pageNumber={pageNumber}
      width={resolvedPageSize.width}
      height={resolvedPageSize.height}
      scale={layerScale}
      // ... all other existing props EXCEPT: onScaleApplied, presentationApiRegistry, isHidden
      // Keep: isInteracting, isZooming (PAL still uses these to defer canvas resize)
    />

    {/* Lightweight overlay for proxy rendering during interactions — KEEP THIS */}
    {shouldRenderLightweightAnnotations && (
      <LightweightAnnotationOverlay proxyPayload={proxyPayload} />
    )}
  </div>,
  overlayDiv
);
```

**About `layerScale`:** The current code computes `layerScale` through ~20 lines of logic involving frozen scales, committed scales, fallback scales, etc. (lines 24468-24493). Replace ALL of that with simply using the current viewer scale. The complexity existed because of the freeze mechanism — with no freeze, just use the live scale. `syncfusionViewerScale` is the best source — it comes from `getSyncfusionPageScale()` which reads the actual viewer zoom. Fall back to the React `scale` state.

**About `pointer-events`:** The overlay wrapper div has `pointer-events: none`, but PageAnnotationLayer internally manages pointer events on its own canvas element. The canvas itself uses `pointer-events: auto` when drawing tools are active. This is how it currently works and does not change.

**Remove from render loop:**
- `shouldFreezePortalHost` logic and all its downstream effects
- `shouldFreezeOverlayScale` logic
- `frozenPageNumbers` calculation
- `syncfusionFrozenOverlayPagesRef`
- `syncfusionLastNonEmptyOverlayPagesRef`
- `syncfusionCachedPageRectsRef`
- `syncfusionInteractionPortalHostsRef`
- The `syncfusionOverlayContentRefs` ref callback with all its transform reapplication logic (lines 24545-24603)
- `zoomFrozenBaseScale` calculation
- Snapshot/live root management (`ensureSyncfusionStablePortalChildren`, `syncSyncfusionZoomPresentationPage`)

### Step 4: Simplify PageAnnotationLayer zoom handling

**File:** `src/PageAnnotationLayer.jsx` — scale useEffect (lines ~7788-8028)

**Keep `isInteracting` and `isZooming` props** — they're still useful for deferring expensive canvas resizes during scroll/drag/zoom. The interaction deferral (line 7807-7810) prevents expensive Fabric.js redraws during panning, which is a separate concern from zoom flicker.

Simplify:
1. **Keep:** `isInteracting` check that defers canvas operations (line 7807-7810)
2. **Keep:** `isZooming` latch and settle timer for deferred resize (lines 7814-7955)
3. **Keep:** Center-page-first priority, deferred render for off-screen pages
4. **Remove:** Wrapper CSS transform logic (lines 7891-7894) — App.jsx handles this on the overlay div now
5. **Remove:** `onScaleApplied` callback calls (lines 7914-7916, 7927-7929, 7941-7943, 8006-8008, 8014-8016). Remove the prop from the component signature (line ~3138).
6. **Remove:** `presentationApiRegistry` prop (line ~3139)
7. **Remove:** `isHidden` prop and the early return at line 7798

### Step 5: Handle page container recreation

When Syncfusion destroys and recreates a page div, our overlay div (which was a child) is removed from the DOM. We need to detect this and re-attach the overlay div to the new page div.

**File:** `src/App.jsx`

**Mechanism:** Add a `useEffect` that watches `syncfusionPageContainers` state (already tracked via MutationObserver in `SyncfusionPDFContainer.jsx`). When it changes:

```jsx
useEffect(() => {
  const overlayDivs = overlayDivsRef.current;
  Object.entries(syncfusionPageContainers).forEach(([pageKey, pageDiv]) => {
    const pageNumber = Number(pageKey);
    const overlayDiv = overlayDivs[pageNumber];
    if (overlayDiv && pageDiv && pageDiv.isConnected && overlayDiv.parentElement !== pageDiv) {
      pageDiv.appendChild(overlayDiv);
    }
  });
}, [syncfusionPageContainers]);
```

**Why this works:** The overlay div is the same JavaScript object — its reference never changes. React portals render into the target by reference, not by DOM position. So moving the div to a new parent does not cause React to unmount/remount the portal children. The Fabric.js canvas stays intact.

**Brief visibility gap:** If there is a gap between the old page div being destroyed and the new one appearing, the overlay div will be detached from the DOM during that gap. This means annotations may be invisible for 1-2 frames. This is much better than the current multi-frame flicker at wrong sizes. If even this is unacceptable, proceed to Option 2.

### Step 6: Remove dead code

**After Steps 1-5 are verified working,** remove all now-unused refs, state, functions, and effects. This is cleanup only — do not remove anything until zoom works correctly.

**Refs to remove from App.jsx:**
- `zoomOverlayTransformActiveRef`, `zoomOverlayBaseScaleRef`, `zoomOverlaySettleTimerRef`
- `syncfusionFallbackHostsRef`
- `syncfusionStablePortalHostsRef` (replaced by `overlayDivsRef`)
- `syncfusionStablePortalLiveRootsRef`, `syncfusionStablePortalSnapshotHostsRef`
- `syncfusionPagePresentationApisRef`
- `syncfusionLastNonEmptyOverlayPagesRef`, `syncfusionFrozenOverlayPagesRef`
- `syncfusionScaleConfirmHiddenPagesRef`, `syncfusionScaleConfirmVisibleSwapPagesRef`
- `syncfusionScaleConfirmSwapGroupIdRef`
- `syncfusionZoomPresentationByPageRef`
- `syncfusionScaleConfirmRevealRafByPageRef`, `syncfusionScaleConfirmRevealPendingPagesRef`
- `syncfusionLastPALScaleAppliedPhaseByPageRef`, `syncfusionLastPALRevealPhaseByPageRef`
- `syncfusionCachedPageRectsRef`
- `syncfusionOverlayTransformRatioByPageRef`, `syncfusionOverlayTransformNodeByPageRef`
- `syncfusionOverlayTransformStatsRef`
- `syncfusionScaleConfirmPendingRef`, `syncfusionScaleConfirmPendingPagesRef`, `syncfusionScaleConfirmTimerRef`
- `syncfusionPendingZoomScaleRef`

**Functions to remove from App.jsx:**
- `ensureSyncfusionStablePortalChildren()`
- `resolveSyncfusionZoomPresentationMode()`
- `syncSyncfusionZoomPresentationPage()`
- `prepareSyncfusionZoomPresentationSwap()`
- `beginSyncfusionScaleConfirmPending()`
- `cancelSyncfusionScaleConfirmPending()`
- `handlePALScaleApplied()`
- `syncScaleConfirmHiddenPages()`
- `cancelSyncfusionScaleConfirmReveal()`
- `applySyncfusionPendingOverlayTransformToNode()`
- `applySyncfusionOverlayTransformSync()`
- `queueSyncfusionOverlayTransformSync()`
- `captureSyncfusionFrozenOverlayPages()`
- `resolveSyncfusionOverlayPortalHost()`

**Props to remove from PageAnnotationLayer (line ~3081-3140):**
- `onScaleApplied` (line ~3138)
- `presentationApiRegistry` (line ~3139)
- `isHidden` (line ~3135)

## What Stays The Same

- **PageAnnotationLayer component** — still uses Fabric.js, still handles drawing tools, undo/redo, selection, etc.
- **Annotation data model** — no changes to how annotations are stored/loaded
- **LightweightAnnotationOverlay** — still used for proxy rendering during pan/scroll interactions. Still rendered inside the portal alongside PAL.
- **SearchHighlightLayer** — still rendered inside the portal alongside PAL.
- **Page container tracking** — still uses MutationObserver to detect page div changes
- **Syncfusion PDF viewer configuration** — no changes
- **Zoom controls** (toolbar buttons, keyboard shortcuts, scroll wheel) — still work the same way
- **`isInteracting` prop on PAL** — still used to defer canvas operations during scroll/drag
- **`isZooming` prop on PAL** — still used to latch zoom mode for deferred canvas resize
- **The interaction phase system** (`syncfusionInteractionPhase` idle/interacting/committing) — stays for scroll/drag proxy rendering

## Testing Plan

1. Open a PDF with annotations on multiple pages (use "Package 2 - Rev 4 -- IC.pdf", page 6)
2. Test all 6 zoom methods:
   - Ctrl+scroll wheel zoom
   - Toolbar zoom in/out buttons
   - Zoom percentage dropdown
   - Fit-to-page
   - Fit-to-width
   - Pinch-to-zoom (if on trackpad)
3. For each zoom method, verify:
   - Annotations stay visible during zoom (no disappearing)
   - Annotations stay in the correct position (no jumping)
   - Annotations may look briefly blurry during zoom (acceptable)
   - After zoom settles, annotations are crisp at the new resolution
4. Test rapid consecutive zooms (zoom in, immediately zoom in again before settle)
5. Test zooming while scrolled to different pages
6. Test that drawing tools still work correctly after zoom
7. Test search highlights are visible and positioned correctly at different zoom levels
8. Test pan/scroll behavior (should still be smooth, LightweightAnnotationOverlay proxy should still work)
9. Test that undo/redo works after zoom
10. Verify no console errors during any zoom operation

## Risk Assessment

**Low risk:** The core drawing system (Fabric.js, annotation data, tool handling) is untouched. We're only changing how the canvas is attached to the DOM and how zoom transitions are handled.

**Medium risk:** If Syncfusion truly destroys page divs during zoom (rather than just resizing them), our overlay div will be removed from the DOM momentarily. The re-attachment logic (Step 5) handles this, but there could be a 1-2 frame flash. This is much better than the current multi-frame flicker at wrong sizes/positions.

**Fallback:** If this approach doesn't eliminate flicker, proceed to Option 2 (SVG display + Fabric.js editing). The spec is at `docs/superpowers/specs/2026-03-17-option2-svg-display-fabric-edit-design.md`.
