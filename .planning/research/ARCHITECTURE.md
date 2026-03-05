# Architecture Patterns: Smooth Zoom Annotation Rendering

**Domain:** PDF annotation layer zoom behavior
**Researched:** 2026-03-04

## Current Architecture

The existing system has a dual-layer rendering architecture:

```
Syncfusion PDF Page Container
  |
  +-- Syncfusion Page Canvas (PDF content rendering)
  |
  +-- Annotation Layer Wrapper (PageAnnotationLayer.jsx)
  |     |
  |     +-- Fabric.js Upper Canvas (interaction/selection)
  |     +-- Fabric.js Lower Canvas (rendered objects)
  |
  +-- Callout Overlay (React-rendered, not Fabric.js)
  |
  +-- LightweightAnnotationOverlay (SVG proxy for virtualization)
```

**Current Zoom Flow (Broken):**
1. User zooms --> Syncfusion fires `onZoomChanged`
2. `scale` state updates --> `useZoomState` computes new `renderedScale` (debounced)
3. While debounce waits, annotation layer has wrong dimensions
4. `PageAnnotationLayer` unmounts or re-renders with new scale
5. Annotations disappear during steps 3-4, reappear at step 5

## Recommended Architecture

### The CSS Transform Bridge

Insert a CSS transform wrapper between the Syncfusion page container and the Fabric.js canvases. This wrapper handles the visual scaling during zoom, while the Fabric.js canvases only re-render after zoom settles.

```
Syncfusion PDF Page Container
  |
  +-- Syncfusion Page Canvas (PDF content rendering)
  |
  +-- [NEW] Zoom Transform Wrapper (CSS transform: scale(cssScale))
  |     |
  |     +-- Annotation Layer (PageAnnotationLayer.jsx)
  |     |     |
  |     |     +-- Fabric.js Upper Canvas (at renderedScale dimensions)
  |     |     +-- Fabric.js Lower Canvas (at renderedScale dimensions)
  |     |
  |     +-- Callout Overlay (React-rendered callouts)
  |
  +-- LightweightAnnotationOverlay (unchanged, used for off-screen page virtualization)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `useZoomState` (existing) | Manages `renderedScale` vs `targetScale` split. Computes `cssScale`. Debounces re-render trigger. | App.jsx (provides zoomStyle), PageAnnotationLayer (provides renderedScale) |
| Zoom Transform Wrapper (new) | Applies CSS `transform: scale(cssScale)` with correct `transform-origin`. Promoted to GPU layer with `will-change: transform`. | Receives `zoomStyle` from `useZoomState`. Wraps annotation layer DOM. |
| `PageAnnotationLayer` (modified) | Renders Fabric.js canvases at `renderedScale` dimensions. Re-renders only when `renderedScale` changes. | Receives `renderedScale` (not `scale`) as its size input. No longer reacts to every `targetScale` change. |
| `handleSyncfusionZoomChange` (modified) | Detects zoom from Syncfusion. Updates `scale` state. Does NOT trigger annotation re-render directly. | Feeds `scale` (as `targetScale`) into `useZoomState`. |

### Data Flow: Zoom Operation

```
     Zoom Input (pinch/scroll/button)
              |
              v
     scale state updates (targetScale = new zoom level)
              |
              v
     useZoomState computes:
       cssScale = targetScale / renderedScale
       isZooming = |cssScale - 1| > 0.001
              |
              +---> [Immediately] CSS transform wrapper applies:
              |       transform: scale(cssScale)
              |       transform-origin: {cursor position}
              |       will-change: transform
              |       (GPU composites instantly, ~0ms)
              |
              +---> [After 140ms idle] renderedScale = targetScale
                      |
                      v
                    cssScale returns to 1.0
                    CSS transform removed
                    PageAnnotationLayer re-renders:
                      1. canvas.setDimensions(newWidth, newHeight)
                      2. canvas.renderAll()
                      3. Callout overlay re-renders at new scale
```

## Patterns to Follow

### Pattern 1: Scale-During, Render-After

**What:** Use CSS transforms for instant visual feedback during zoom. Defer expensive canvas re-rendering until zoom stabilizes.

**When:** Any operation that changes the visual scale of canvas-based content.

**Why:** CSS `transform: scale()` is GPU-composited and costs effectively zero main-thread CPU. Fabric.js `renderAll()` is O(n) in object count and runs on the main thread. By eliminating main-thread work during zoom, we guarantee 60fps.

**Example:**
```javascript
// In useZoomState.js (already implemented)
const cssScale = renderedScale > 0 ? targetScale / renderedScale : 1;

// Apply to wrapper (new)
const zoomStyle = isZooming ? {
  transform: `scale(${cssScale})`,
  transformOrigin: getTransformOrigin(),
  willChange: 'transform',
  backfaceVisibility: 'hidden',
} : {
  willChange: 'auto',
};
```

### Pattern 2: Atomic State Transition

**What:** When removing the CSS transform and applying new canvas dimensions, do both in the same `requestAnimationFrame` to prevent visual "pop."

**When:** `renderedScale` updates (zoom settles).

**Why:** If CSS transform is removed in frame N but canvas resizes in frame N+1, the user sees one frame of the old-size canvas without scaling -- a visible flicker.

**Example:**
```javascript
// When renderedScale changes:
requestAnimationFrame(() => {
  // 1. Update canvas dimensions
  fabricCanvas.setDimensions({
    width: pageWidth * renderedScale,
    height: pageHeight * renderedScale
  });

  // 2. CSS transform automatically becomes scale(1) since
  //    cssScale = targetScale / renderedScale = 1
  //    React re-render removes transform in same paint cycle

  // 3. Re-render objects at new scale
  fabricCanvas.renderAll();
});
```

### Pattern 3: Transform-Origin Alignment

**What:** The CSS transform-origin on the annotation wrapper must match the zoom anchor point used by Syncfusion's page scaling.

**When:** Cursor-centered zoom (pinch, Ctrl+scroll).

**Why:** If transform-origins differ, the annotation layer scales from a different point than the page content, causing annotations to appear to "drift" away from their anchored positions during zoom.

**Example:**
```javascript
// Compute transform origin relative to annotation wrapper
const getTransformOrigin = (cursorX, cursorY, scrollLeft, scrollTop) => {
  // Cursor position relative to the annotation wrapper's top-left
  const originX = cursorX + scrollLeft;
  const originY = cursorY + scrollTop;
  return `${originX}px ${originY}px`;
};
```

### Pattern 4: Pointer Event Blocking During Zoom

**What:** Disable pointer events on the annotation layer during CSS transform phase.

**When:** `isZooming` is true.

**Why:** Mouse coordinates during CSS transform do not map correctly to Fabric.js object coordinates. Allowing interaction during zoom would cause misclicks, wrong selections, and coordinate confusion. Professional tools (Acrobat, Bluebeam) also block interaction during active zoom.

**Example:**
```javascript
const wrapperStyle = {
  ...zoomStyle,
  pointerEvents: isZooming ? 'none' : 'auto',
};
```

### Pattern 5: Conditional will-change

**What:** Set `will-change: transform` only during active zoom, remove when idle.

**When:** Toggle based on `isZooming` state.

**Why:** `will-change: transform` promotes the element to a dedicated GPU compositor layer, consuming GPU memory. Per-page annotation layers across a 100+ page document would waste significant GPU memory if all promoted permanently. Promote only during zoom, demote after.

**Example (already in useZoomState.js):**
```javascript
zoomStyle: isZooming ? {
  willChange: 'transform',
  // ...
} : {
  willChange: 'auto',
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Fabric.js setZoom() During Active Zoom

**What:** Calling `canvas.setZoom(newScale)` on every zoom input event.

**Why bad:** `setZoom()` internally calls `renderAll()`, which iterates every object on the canvas and calls `render(ctx)`. This is O(n) per frame. At 60fps zoom events with 50 objects, this is 3000 render calls per second on the main thread.

**Instead:** Apply CSS `transform: scale()` to the wrapper. Call `setZoom()` / re-render only after zoom settles.

### Anti-Pattern 2: Unmounting Annotation Layer During Zoom

**What:** React unmounts `PageAnnotationLayer` when scale changes, then remounts at new scale.

**Why bad:** Unmounting destroys the Fabric.js canvas, all object state, and the rendered bitmap. Remounting requires rebuilding everything from scratch. This is the most expensive possible response to a zoom change and causes the "annotations disappear" problem.

**Instead:** Keep the annotation layer mounted. CSS transform provides the visual scaling. Only resize the canvas (without unmounting) after zoom settles.

### Anti-Pattern 3: Different Transform Origins for Page and Annotations

**What:** Syncfusion's page container scales from one origin, annotation wrapper scales from a different origin.

**Why bad:** Annotations appear to slide/drift relative to the page content during zoom. At 2x zoom, even a 10px origin mismatch becomes a 20px visual offset.

**Instead:** Read Syncfusion's scroll position and cursor coordinates to compute the exact same transform-origin for the annotation wrapper.

### Anti-Pattern 4: Using CSS zoom Property

**What:** Using `zoom: 2` instead of `transform: scale(2)`.

**Why bad:** CSS `zoom` triggers layout recalculation -- the browser recalculates the element's layout box, which cascades to sibling and parent layout. `transform: scale()` operates purely in the compositing phase -- no layout recalculation. In a complex DOM with Syncfusion's scroll containers, `zoom` would cause layout thrashing.

**Instead:** Always use `transform: scale()`.

## Scalability Considerations

| Concern | 10 annotations/page | 100 annotations/page | 500+ annotations/page |
|---------|---------------------|----------------------|----------------------|
| CSS transform during zoom | No impact (GPU only) | No impact (GPU only) | No impact (GPU only) |
| Post-zoom Fabric.js re-render | < 5ms | 10-30ms | 50-150ms (may need optimization) |
| Memory (GPU layer per page) | Negligible | Negligible | Negligible (canvas bitmap size, not object count) |
| Fabric.js object caching | Not needed | Helpful | Essential -- enable `objectCaching: true` |

For 500+ annotations per page, consider:
- `skipOffscreen: true` on Fabric.js canvas to skip rendering objects outside the visible viewport
- Annotation culling: only add visible annotations to the Fabric.js canvas
- OffscreenCanvas for the post-zoom re-render (move off main thread)

These optimizations are NOT needed for the initial implementation. The typical page has 10-50 annotations.

## Sources

- Existing codebase: `useZoomState.js`, `PageAnnotationLayer.jsx`, `layerPerformance.js`, `App.jsx`
- [pdf.js PR #19128](https://github.com/mozilla/pdf.js/pull/19128) -- PDFPageDetailView architecture
- [MDN: CSS contain](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Using_CSS_containment)
- [Jake Archibald: CSS transform order for zoom (2025)](https://jakearchibald.com/2025/animating-zooming/)
- [Fabric.js performance optimization](https://hackernoon.com/optimizing-performance-in-fabricjs-5-14-best-practices-and-tips)
