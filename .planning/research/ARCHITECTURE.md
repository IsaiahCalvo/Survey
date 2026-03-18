# Architecture Patterns

**Domain:** Canvas annotation overlay system for PDF viewer zoom
**Researched:** 2026-03-17

## Recommended Architecture

### Target System Overview

Replace the current multi-layer portal/freeze/snapshot/confirm-pending system with a direct-child overlay model where each annotation canvas lives inside its Syncfusion page div and scales with it during zoom.

```
Syncfusion Page Div (e-pv-page-div)
  |
  +-- [Syncfusion internals: text layer, canvas, etc.]
  |
  +-- Overlay Div (persistent, position:absolute, 100% x 100%)
        |
        +-- React Portal target
              |
              +-- Wrapper Div (z-index:20, pointer-events:none)
                    |
                    +-- SearchHighlightLayer
                    +-- PageAnnotationLayer (Fabric.js canvas)
                    +-- LightweightAnnotationOverlay (during interactions)
                    +-- SpaceRegionOverlay (when regions active)
```

### Why This Structure

The current architecture uses a 5-layer indirection chain: Syncfusion page div -> stable portal host -> live root / snapshot root -> React portal -> PAL. This exists to protect against Syncfusion destroying page divs during zoom — but the protection mechanism itself (freeze/unfreeze timing, snapshot capture, confirm-pending windows, deferred scale commits) is where all the flicker bugs originate.

The target architecture uses a 2-layer chain: Syncfusion page div -> persistent overlay div -> React portal -> PAL. The overlay div is a plain JavaScript object stored in a ref. When Syncfusion destroys a page div, the overlay div detaches from the DOM but the React portal continues to target it by reference. When the new page div appears, `appendChild()` moves the overlay div into the new parent. React never sees a container change, so it never unmounts/remounts the portal children — the Fabric.js canvas stays intact.

This pattern is explicitly recommended by the React team for portal reparenting (see React issue #12247: "create an intermediate DOM node that you control, keep the portal rendering into the same node, but manually move that node to different parents using appendChild()").

## Component Boundaries

| Component | Responsibility | Owns | Communicates With |
|-----------|---------------|------|-------------------|
| **App.jsx (Zoom Orchestrator)** | Receives zoom events from Syncfusion, applies CSS transforms to overlay divs during zoom transition, manages settle timer, commits final scale to React state | `overlayDivsRef` (persistent overlay divs), `scaleRef`, settle timer | Syncfusion viewer (zoom events in), PAL (scale prop out), overlay divs (CSS transforms) |
| **App.jsx (Overlay Manager)** | Creates/stores persistent overlay divs, attaches them to Syncfusion page divs, re-attaches when page divs are recreated | `overlayDivsRef`, page container tracking | SyncfusionPDFContainer (page container map), React render loop (portal targets) |
| **App.jsx (Render Loop)** | Creates React portals into overlay divs for each visible page, passes scale/annotations/tools as props | Portal creation, prop computation | Overlay Manager (portal targets), PAL (props), SearchHighlightLayer, LightweightAnnotationOverlay |
| **SyncfusionPDFContainer** | Renders Syncfusion viewer, detects page container changes via MutationObserver, reports page container map | `syncfusionPageContainers` state, MutationObserver | App.jsx (page container map, zoom events) |
| **PageAnnotationLayer (PAL)** | Manages Fabric.js canvas lifecycle, handles drawing tools, defers expensive canvas resize during zoom via `isZooming` latch and settle timer | Fabric.js canvas, zoom latch, scale settle timer, viewport-aware deferred rendering | App.jsx (receives scale/isZooming/isInteracting props), Fabric.js canvas (resize/render) |
| **SearchHighlightLayer** | SVG-based search result highlights, scales via props | SVG elements | App.jsx (receives highlights and scale) |
| **LightweightAnnotationOverlay** | Lightweight proxy rendering during pan/scroll interactions | Static SVG snapshot | App.jsx (receives proxy payload during interactions) |

## Data Flow

### Zoom Event Flow (the critical path)

```
1. USER ACTION
   User triggers zoom (any of 6 methods)
        |
        v
2. SYNCFUSION FIRES onZoomChanged
   Syncfusion internally resizes/recreates page divs
   Fires callback with new zoomValue
        |
        v
3. APP.JSX handleSyncfusionZoomChange
   a. Update scaleRef.current = newScale / 100
   b. Calculate ratio = newScale / baseScale
   c. Apply CSS transform to every overlay div:
      overlayDiv.style.transform = `scale(${ratio})`
      overlayDiv.style.transformOrigin = 'top left'
   d. (Re)start settle timer (1000ms)
   e. Mark interaction active
        |
        |  [During zoom: visual scaling via CSS]
        |  Canvas is at old resolution but visually
        |  scaled to match new zoom level.
        |  Looks blurry but never jumps or disappears.
        |
        v
4. SETTLE TIMER FIRES (1000ms of no new zoom events)
   a. Remove CSS transforms from all overlay divs
   b. Commit scale to React state: setScale(finalScale)
   c. This triggers React re-render with new scale prop
        |
        v
5. PAL RECEIVES NEW SCALE PROP
   a. Scale useEffect fires
   b. isZooming latch is active -> enters deferred path
   c. PAL starts its own 300ms settle timer
        |
        v
6. PAL SETTLE TIMER FIRES
   a. Classify page priority (center / visible / offscreen)
   b. Center page: immediate Fabric.js resize + renderAll
   c. Visible pages: CSS scale now, delayed Fabric render (800ms)
   d. Offscreen pages: CSS scale now, render on scroll-into-view (IntersectionObserver)
        |
        v
7. FABRIC.JS CANVAS REDRAWS
   a. canvas.setWidth(width * finalScale)
   b. canvas.setHeight(height * finalScale)
   c. canvas.setZoom(finalScale)
   d. canvas.renderAll() (expensive: 200-500ms per page)
   e. Clear CSS transform on canvas wrapper
   f. Canvas is now crisp at new resolution
```

### Page Container Recreation Flow

```
1. SYNCFUSION DESTROYS PAGE DIV
   (Happens during zoom or scroll to distant pages)
   Overlay div is detached from DOM
   React portal still targets overlay div by reference
   Fabric.js canvas is in memory but not in DOM
   -> Annotations invisible for 1-2 frames
        |
        v
2. SYNCFUSION CREATES NEW PAGE DIV
   MutationObserver in SyncfusionPDFContainer detects new div
   Updates syncfusionPageContainers state
        |
        v
3. APP.JSX useEffect FIRES (watches syncfusionPageContainers)
   For each page: if overlayDiv exists and its parent !== new pageDiv:
     pageDiv.appendChild(overlayDiv)
   Overlay div is back in DOM
   React portal children (PAL, canvas) immediately visible again
   No unmount/remount occurred
```

### Scale Computation Flow (simplified)

```
CURRENT (20+ lines of frozen/committed/fallback logic):
  zoomFrozenBaseScale > 0
    ? zoomFrozenBaseScale
    : shouldFreezeOverlayScale
      ? frozenPageScale (committed or measured)
      : fallbackPageScale (measured or viewer or 1)

TARGET (2 lines):
  const layerScale = syncfusionViewerScale > 0
    ? syncfusionViewerScale
    : (scale > 0 ? scale : 1);
```

The complexity existed because the freeze mechanism required holding scale at a stale value while CSS transforms provided visual scaling. With no freeze, just use the live viewer scale. `syncfusionViewerScale` comes from `getSyncfusionPageScale()` which reads the actual viewer zoom level, so it is always current.

## Patterns to Follow

### Pattern 1: Persistent Portal Target (critical)

**What:** Create a DOM div once, store it in a ref, and always use the same div reference as the `createPortal()` target. Move the div between parents as needed, but never replace it.

**When:** Always. This is the foundation of the architecture.

**Why:** React's `createPortal(children, container)` uses `container` as an identity key. If you pass a different DOM node, React unmounts and remounts all children. For a Fabric.js canvas, this means destroying the entire canvas (losing drawing state, event handlers, internal objects) and recreating it from scratch. By keeping the same div reference and using `appendChild()` to move it, React performs a reconciliation pass (cheap) instead of a mount cycle (expensive and destructive).

**Example:**
```javascript
// Initialize once (in attachOverlayToPageDiv or first render)
if (!overlayDivsRef.current[pageNumber]) {
  const div = document.createElement('div');
  div.setAttribute('data-overlay-portal', String(pageNumber));
  div.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
  overlayDivsRef.current[pageNumber] = div;
}

// Attach to page div (may be called multiple times as divs are recreated)
const overlayDiv = overlayDivsRef.current[pageNumber];
if (pageDiv.isConnected && overlayDiv.parentElement !== pageDiv) {
  pageDiv.appendChild(overlayDiv);
}

// In render loop — always same reference
return createPortal(<OverlayContent />, overlayDiv);
```

### Pattern 2: CSS Transform Bridge During Zoom

**What:** During zoom transition, apply `transform: scale(ratio)` with `transform-origin: top left` to the overlay div. This makes the canvas visually match the new zoom level without any Fabric.js redraws.

**When:** From the moment `handleSyncfusionZoomChange` fires until the settle timer completes and PAL has redrawn the canvas.

**Why:** A Fabric.js `renderAll()` takes 200-500ms per page. During a zoom gesture (which fires events every ~16ms), you cannot afford to redraw. CSS transforms are handled by the compositor thread (near-zero cost, no main thread blocking). The visual result is a blurry but correctly positioned canvas — identical to how Adobe Acrobat and pdf.js handle zoom.

**Example:**
```javascript
// In handleSyncfusionZoomChange:
const ratio = newScale / baseScale;
Object.values(overlayDivsRef.current).forEach(div => {
  if (div.isConnected) {
    div.style.transform = `scale(${ratio})`;
    div.style.transformOrigin = 'top left';
  }
});

// In settle timer callback:
Object.values(overlayDivsRef.current).forEach(div => {
  div.style.transform = '';
  div.style.transformOrigin = '';
});
setScale(finalScale); // Triggers PAL re-render at new resolution
```

### Pattern 3: Tiered Canvas Redraw Priority

**What:** After zoom settles, redraw pages in priority order: center page first (immediate), visible non-center pages second (delayed), offscreen pages third (on scroll into view).

**When:** After PAL's zoom settle timer fires (300ms after last scale change while `isZooming` is false).

**Why:** A Fabric.js `renderAll()` is expensive. If 5 pages are visible, doing all 5 at once blocks the main thread for 1-2.5 seconds. By doing the center page first (the one the user is looking at), the user sees a crisp result within one frame. Other pages remain CSS-scaled (blurry but positioned correctly) and redraw in the background.

**This pattern already exists in PAL** (lines 7870-7953) and should be preserved unchanged. The center-page detection uses `getBoundingClientRect()` against `window.innerHeight / 2`. Offscreen pages use `IntersectionObserver` to render lazily.

### Pattern 4: Zoom Latch with Settle Timer

**What:** Once a zoom event is detected, latch `inZoomModeRef = true` and do not unlatch until the settle timer fires AND `isZooming` prop is false. While latched, all canvas resize operations are deferred.

**When:** Inside PAL's scale `useEffect`.

**Why:** Scroll-wheel zoom fires many events with brief gaps. Without a latch, the `isZooming` prop might flicker `false` for 1-2 frames between events, causing a premature expensive canvas resize that gets immediately invalidated by the next zoom event. The latch prevents this — once zoom starts, only the settle timer can end it.

**This pattern already exists in PAL** and should be preserved unchanged.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Changing the createPortal Container Reference

**What:** Passing a different DOM node to `createPortal()` across renders (e.g., because Syncfusion created a new page div).

**Why bad:** React unmounts all portal children (destroying Fabric.js canvas state, losing drawing in progress, breaking event handlers) and remounts them from scratch. For a canvas with 50+ annotation objects, this takes 500ms+ and causes a visible flash.

**Instead:** Use a persistent overlay div (Pattern 1). Move it with `appendChild()`.

### Anti-Pattern 2: Deferred Scale Commits with Frozen State

**What:** The current system holds a "frozen" scale during zoom, defers the real scale commit, then uses a multi-step confirm-pending protocol to reveal each page as its canvas rebuilds.

**Why bad:** The timing coordination between freeze, deferred commit, confirm-pending, per-page reveal, and safety fallbacks has 15+ refs, 8+ functions, and dozens of edge cases. Every new zoom method or Syncfusion version update introduces new timing bugs. The existing code has 260+ lines of dead-code-candidate refs/functions listed in the design spec.

**Instead:** Use CSS transforms for visual scaling during zoom (Pattern 2). No freeze needed — the canvas at old resolution, CSS-scaled to match new zoom, looks correct. After settle, commit scale directly and let PAL handle the redraw at its own pace.

### Anti-Pattern 3: Snapshot/Live Presentation Modes

**What:** The current system captures a snapshot image of the canvas before zoom, shows the snapshot during zoom, hides the live canvas, then swaps back after redraw.

**Why bad:** Snapshot capture via `toDataURL()` is itself expensive (100-200ms per page) and must happen synchronously before zoom starts. This adds latency to the zoom gesture start. The snapshot/live swap logic adds complexity and creates more timing windows for bugs.

**Instead:** CSS transforms on the live canvas provide the same visual stability without any snapshot overhead. The live canvas, scaled via CSS, looks identical to a snapshot (both are rasterized at the old resolution).

### Anti-Pattern 4: Multiple Settle Timers at Different Layers

**What:** Having both App.jsx and PAL running independent settle timers that coordinate via callbacks (`onScaleApplied`).

**Why bad:** Two independent timers create race conditions. If App.jsx's timer fires and commits scale, but PAL's timer hasn't settled yet, PAL may start an expensive redraw that gets interrupted by a late zoom event.

**Instead:** App.jsx settle timer (1000ms) controls the CSS transform lifecycle and scale commit. PAL settle timer (300ms) controls the canvas redraw lifecycle. They are sequential, not parallel: App.jsx commits scale -> PAL receives new scale prop -> PAL's settle timer starts -> canvas redraws. The `onScaleApplied` callback (and its entire confirm-pending chain) is removed.

## Component Dependency Graph (Build Order)

```
Step 1: attachOverlayToPageDiv()
  Creates persistent overlay divs, stores in overlayDivsRef
  Replaces: syncfusionStablePortalHostsRef, ensureSyncfusionStablePortalChildren,
            resolveSyncfusionOverlayPortalHost
  No dependencies on other new code.

Step 2: handleSyncfusionZoomChange (simplified)
  Uses: overlayDivsRef (from Step 1)
  Replaces: freeze/snapshot/confirm-pending flow
  Depends on: Step 1 (needs overlay divs to apply CSS transforms)

Step 3: Render loop (simplified)
  Uses: overlayDivsRef (from Step 1), layerScale (simplified computation)
  Replaces: frozen page numbers, interaction windows, stable portal host chain
  Depends on: Step 1 (portal targets), Step 2 (scale computation)

Step 4: PAL zoom handling (simplified)
  Removes: onScaleApplied callback, presentationApiRegistry, isHidden prop
  Keeps: isZooming latch, settle timer, tiered redraw priority
  Depends on: Steps 1-3 working (PAL receives correct scale prop)

Step 5: Page container re-attachment useEffect
  Uses: overlayDivsRef (from Step 1), syncfusionPageContainers (existing)
  Depends on: Step 1 (overlay divs exist to re-attach)

Step 6: Dead code removal
  Depends on: Steps 1-5 verified working
```

**Why this order:** Steps 1-3 form the critical path. Step 1 must exist before Step 2 can apply CSS transforms or Step 3 can create portals. Step 2 (zoom handler) and Step 3 (render loop) can theoretically be developed in parallel, but verifying zoom behavior requires both. Step 4 is a simplification of existing code that reduces coupling. Step 5 handles a specific edge case (page recreation) and can be verified independently. Step 6 is pure cleanup.

## Scalability Considerations

| Concern | Current Impact | Target Impact |
|---------|---------------|---------------|
| Number of visible pages during zoom | Each page has freeze/snapshot/confirm-pending state = O(pages * refs). 10 visible pages = 10 snapshot captures + 10 confirm-pending trackers. | Each page gets one CSS transform = O(pages). 10 visible pages = 10 style assignments (microseconds each). |
| Rapid consecutive zooms | Each zoom restarts confirm-pending timers for all pages. Cancelled confirmations leave stale CSS transforms that must be cleaned up. Multiple code paths handle "what if zoom restarts during confirm." | Each zoom updates CSS transform ratios. No state to clean up on cancellation — the next transform simply overwrites the previous one. |
| Refs and state tracked | 30+ refs for zoom-related state (listed in design spec Step 6). Each ref is a potential source of stale-state bugs. | 1 ref: `overlayDivsRef`. Scale tracked in `scaleRef` (already exists). Settle timer tracked in 1 ref. |
| Code volume | ~150 lines in handleSyncfusionZoomChange, ~400 lines in render loop for portal host resolution and scale computation, ~100 lines each for 8 helper functions. | ~30 lines in handleSyncfusionZoomChange, ~50 lines in render loop, 1 helper function (attachOverlayToPageDiv). |
| Large PDFs (100+ pages) | Frozen overlay page lists, cached page rects, interaction portal host snapshots all grow with page count. MutationObserver fires for every page div change. | Overlay divs created lazily per visible page. Re-attachment useEffect iterates only over pages in `syncfusionPageContainers` (already bounded by Syncfusion's virtualization). |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 1-2 frame flash when Syncfusion destroys/recreates page div | Medium | Low (far better than current multi-frame flicker) | Re-attachment useEffect fires on next React commit. If unacceptable, fall back to Option 2 (SVG display). |
| CSS transform causes layout shift on sibling elements | Low | Medium | Overlay div is `position: absolute` — CSS transforms do not affect layout flow of siblings. `transform-origin: top left` ensures scaling expands down-right only. |
| `isConnected` check misses edge case where div is in a detached fragment | Low | Low | Syncfusion divs are always in the live DOM or fully removed. Fragment attachment is not a pattern Syncfusion uses. |
| Rapid zoom produces visible blur for extended period | Low | Low (matches Adobe Acrobat behavior) | 1000ms settle timer + 300ms PAL settle = 1.3s max blur. Reduce settle timers if testing shows faster settling is safe. |

## Sources

- [React #12247: Portal container reparenting](https://github.com/facebook/react/issues/12247) -- React team confirms `appendChild()` of portal target does not cause unmount/remount. HIGH confidence.
- [React #10826: Portal unmounting on container change](https://github.com/facebook/react/issues/10826) -- Confirms that passing a different container to `createPortal()` causes unmount. HIGH confidence.
- [react-reverse-portal: Build once, move anywhere](https://github.com/httptoolkit/react-reverse-portal) -- Library implementing the persistent-node pattern. Validates the approach. MEDIUM confidence.
- [Fabric.js zoom and pan patterns](https://github.com/fabricjs/fabric.js/discussions/7052) -- Community discussion on CSS transform vs Fabric.js internal zoom. MEDIUM confidence.
- [Syncfusion React PDF Viewer magnification docs](https://help.syncfusion.com/document-processing/pdf/pdf-viewer/react/magnification) -- Official Syncfusion zoom documentation. HIGH confidence.
- Design spec: `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` -- Project-specific design document. HIGH confidence.
- Codebase analysis: `src/App.jsx` lines 12337-12487 (zoom handler), 24330-24720 (render loop), 9620-9672 (portal host creation). PRIMARY source.
- Codebase analysis: `src/PageAnnotationLayer.jsx` lines 7788-8028 (scale useEffect with tiered redraw). PRIMARY source.
