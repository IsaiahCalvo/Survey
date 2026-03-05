# Technology Stack: Smooth Zoom Annotation Rendering

**Project:** Live Zoom Annotation Rendering
**Researched:** 2026-03-04
**Mode:** Brownfield enhancement -- adding to existing Syncfusion React PDF Viewer with Fabric.js annotation layer

## Executive Summary

The project already has the right foundation. The existing `useZoomState` hook implements the correct "CSS transform during zoom, canvas re-render after" pattern used by Mozilla pdf.js and Adobe Acrobat. The core problem is not a missing technology -- it is that the current implementation does not fully integrate this pattern into the annotation layer lifecycle. The annotation layer (Fabric.js canvases in `PageAnnotationLayer.jsx`) currently re-renders from scratch during zoom, causing annotations to disappear. The fix is architectural, not stack-based: wire the CSS transform scaling through to the annotation layer containers so they scale visually during zoom, then trigger a high-fidelity Fabric.js re-render only after zoom settles.

No new libraries are needed. The solution uses CSS transforms (already partially implemented), existing Fabric.js rendering, and browser-native GPU compositing.

## Recommended Stack

### Core Technique: CSS Transform Scale-During, Re-Render-After

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| CSS `transform: scale()` | Native | Instant visual scaling during zoom | GPU-composited, zero JS cost, sub-frame latency. Already used in `useZoomState.js` but not fully wired to annotation containers. |
| CSS `will-change: transform` | Native | GPU layer promotion during zoom | Tells browser to create dedicated compositor layer. Already in `layerPerformance.js`. Must be toggled on during zoom, off after settle. |
| CSS `contain: layout style paint` | Native | Isolation of annotation layer repaints | Prevents annotation scaling from triggering reflows in Syncfusion's page containers. Already in `ANNOTATION_LAYER_STYLES`. |
| `requestAnimationFrame` | Native | Coordinated transform application | Batch CSS transform updates to align with browser paint cycle. Avoids intermediate frames showing wrong scale. |
| Debounced re-render | Pattern (140ms) | Trigger canvas re-render after zoom settles | Already implemented in `useZoomState.js` at 140ms. This is the right window -- matches pdf.js and Acrobat debounce ranges (100-200ms). |

**Confidence: HIGH** -- This is the standard pattern used by pdf.js (verified via PR #19128), Adobe Acrobat, Bluebeam, and DrawboardPDF. The project already partially implements it.

### Canvas Rendering (Existing -- No Changes Needed)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Fabric.js | 5.5.2 | Annotation canvas rendering | Already in use. Handles all annotation types (shapes, freehand, text, callouts). |
| Canvas 2D API | Native | Underlying rendering context | Used by Fabric.js. No reason to switch to WebGL for this use case. |

**Confidence: HIGH** -- The annotation rendering stack is correct. The problem is zoom lifecycle, not rendering technology.

### GPU Acceleration (Existing -- Needs Tuning)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `translateZ(0)` / `translate3d(0,0,0)` | CSS | Force GPU layer creation | Already applied via `layerPerformance.js`. Creates compositor layer so `scale()` transform runs entirely on GPU. |
| `backfaceVisibility: hidden` | CSS | GPU optimization hint | Already applied. Reduces compositor work by telling browser the back face is never visible. |
| `isolation: isolate` | CSS | Stacking context isolation | Already applied. Prevents annotation layer compositing from affecting Syncfusion layers. |

**Confidence: HIGH** -- These are standard, well-understood browser optimizations already present in the codebase.

### Zoom Event Integration (Syncfusion-Specific)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Syncfusion `onZoomChanged` | 32.1.19 | Detect zoom start/end from Syncfusion viewer | Already wired via `handleSyncfusionZoomChange`. Provides `zoomValue` payload. |
| Syncfusion `magnificationModule.zoomTo()` | 32.1.19 | Programmatic zoom control | Already in use. Needed for toolbar zoom buttons and keyboard shortcuts. |
| Wheel event interception | Native | Detect pinch-zoom and Ctrl+scroll | Already implemented via `handleSyncfusionWrapperWheel`. Must coordinate with CSS transform application. |

**Confidence: HIGH** -- Syncfusion integration points are already established and working.

## The Pattern in Detail

### Phase 1: Zoom Starts (CSS Transform)

```
User pinch/scroll/click-zoom
    |
    v
Scale state changes (targetScale)
    |
    v
useZoomState computes cssScale = targetScale / renderedScale
    |
    v
CSS transform: scale(cssScale) applied to annotation layer wrapper
    |
    v
GPU composites the scaled layer instantly (< 1ms)
    |
    v
Annotations appear scaled (slightly blurry at extreme zoom, acceptable)
```

### Phase 2: Zoom Settles (Canvas Re-render)

```
No zoom input for 140ms (debounce)
    |
    v
renderedScale updates to match targetScale
    |
    v
cssScale returns to 1.0, CSS transform removed
    |
    v
Fabric.js re-renders at new zoom level (crisp, high-fidelity)
    |
    v
Annotation layer dimensions resize to match new page dimensions
```

### Critical Implementation Details

**Transform Origin:** Must match the zoom anchor point (cursor position). Already computed in `useZoomState.getTransformOrigin()`. If the annotation layer wrapper's transform-origin does not match the Syncfusion page's zoom anchor, annotations will appear to "slide" during zoom.

**Layer Sizing:** During CSS transform scaling, the annotation layer wrapper's pixel dimensions stay at the `renderedScale` size. The CSS transform visually scales it. After zoom settles, the wrapper must resize to `targetScale` dimensions simultaneously with removing the CSS transform. If these are not atomic (same frame), there will be a visible "pop."

**Fabric.js Re-render:** After zoom settles, call `canvas.setDimensions()` then `canvas.renderAll()`. Do NOT call `canvas.setZoom()` during the CSS transform phase -- this triggers a full Fabric.js re-render which defeats the purpose.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Mid-zoom visual | CSS `transform: scale()` | Fabric.js `setZoom()` | `setZoom()` triggers full `renderAll()` -- loops all objects, calls render() on each. O(n) per frame. CSS scale is O(1) GPU compositing. |
| Mid-zoom visual | CSS `transform: scale()` | Canvas context `setTransform()` | Still requires clearing and redrawing all objects. CSS scale operates on the already-rendered bitmap. |
| Mid-zoom visual | CSS `transform: scale()` | SVG proxy (LightweightAnnotationOverlay) | SVG proxy already exists but is a simplified representation. CSS scale preserves exact visual fidelity of the full Fabric.js render. |
| Rendering engine | Fabric.js (Canvas 2D) | WebGL (via PixiJS or raw) | WebGL has faster redraw for large object counts, but the zoom problem is not redraw speed -- it is eliminating redraws entirely during zoom. CSS transform solves this regardless of rendering engine. Migration cost vastly outweighs benefit. |
| Rendering engine | Fabric.js (Canvas 2D) | OffscreenCanvas + Worker | OffscreenCanvas moves rendering off main thread, but CSS transform already eliminates main-thread rendering during zoom. OffscreenCanvas would only help with the post-zoom re-render, which is already fast enough (single frame). Not worth the complexity. |
| Post-zoom render | Debounced re-render (140ms) | Immediate re-render | Would cause jank during rapid zoom changes. Users zoom in multiple quick gestures. Debounce absorbs rapid input. |
| Post-zoom render | Debounced re-render (140ms) | `requestIdleCallback` re-render | Too unpredictable timing. User expects crisp annotations within ~200ms of stopping zoom. `requestIdleCallback` can delay up to 50ms+ on busy main threads. |
| Zoom detection | Syncfusion `onZoomChanged` + wheel events | MutationObserver on Syncfusion DOM | Fragile -- depends on Syncfusion's internal DOM structure which changes across versions. Event-based detection is stable. |

## What NOT to Do

### Do NOT call Fabric.js `setZoom()` during active zooming
**Why:** `setZoom()` triggers `renderAll()` which iterates all canvas objects and calls each object's `render()` method. With 50+ annotations per page, this takes 5-15ms per call. At 60fps zoom events, this causes 100% main thread saturation and visible jank.

### Do NOT use CSS `zoom` property instead of `transform: scale()`
**Why:** CSS `zoom` triggers layout recalculation. `transform: scale()` does not affect layout -- it operates purely at the compositing stage. The `zoom` property would cause Syncfusion's scroll containers to recalculate dimensions on every zoom step. (Source: Jake Archibald, "Animating zooming using CSS", 2025)

### Do NOT use CSS `transition` on the scale transform
**Why:** CSS transitions interpolate the scale smoothly over time, which fights with real-time user input. Pinch-zoom and scroll-zoom provide continuous input -- the visual must track input exactly, not animate toward it. Any transition delay creates perceived input lag. The `useZoomState.js` correctly omits transitions.

### Do NOT set `willReadFrequently: true` on annotation canvases during zoom
**Why:** `willReadFrequently: true` disables GPU acceleration for that canvas context. The existing code correctly patches `getContext()` to set this only for Fabric.js upper/lower canvases (which need `getImageData()` for eraser operations), but during zoom the CSS transform handles the visual -- no pixel reads occur. If GPU acceleration is disabled, the CSS transform compositing will be slower. (Source: Kevin Schiener, "Slow HTML Canvas Performance?", 2024 -- `willReadFrequently: true` increased commit time from 0.1ms to 47ms)

### Do NOT re-render the Fabric.js canvas at every intermediate zoom level
**Why:** This is the current broken behavior. Each intermediate zoom level triggers a full tear-down and rebuild of the canvas at the new scale. This is the root cause of annotations disappearing during zoom.

### Do NOT use transform order `scale(n) translate(x, y)` for cursor-centered zoom
**Why:** Scale acts as a multiplier for translate values, creating non-linear motion. Use `translate(x, y) scale(n)` or pre-multiply translate values by the scale factor. (Source: Jake Archibald, "Animating zooming using CSS: transform order is important", 2025)

## Supporting Libraries (Already Installed -- No New Dependencies)

| Library | Version | Role in Zoom | Notes |
|---------|---------|-------------|-------|
| `fabric` | 5.5.2 | Post-zoom re-render | Call `setDimensions()` + `renderAll()` after zoom settles. Disable `objectCaching` during dimension changes to avoid stale cache. |
| `react` | 18.2 | State management for zoom lifecycle | `useZoomState` hook manages `renderedScale` / `cssScale` split. `useSyncExternalStore` used by AnnotationStore for page-level subscriptions. |
| `react-window` | 2.2.1 | Virtualized page list | May need coordination -- CSS transform on annotation layer must not interfere with react-window's scroll position calculations. |

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Electron |
|---------|--------|---------|--------|----------|
| `transform: scale()` | All | All | All | All |
| `will-change` | All | All | All | All |
| `contain` | 52+ | 69+ | 15.4+ | All (Chromium) |
| `contentVisibility` | 85+ | 125+ | 18+ | All (Chromium) |
| `OffscreenCanvas` | 69+ | 105+ | 16.4+ | All (Chromium) |
| `requestAnimationFrame` | All | All | All | All |

The app targets Electron (Chromium-based), so all features have full support. Browser compatibility is not a concern.

## Performance Budget

| Phase | Target | Measurement |
|-------|--------|-------------|
| CSS transform application | < 1ms | GPU compositing only, no JS cost |
| Zoom input to visual update | < 16ms (1 frame) | CSS transform applied in same rAF as input |
| Post-zoom debounce | 140ms after last input | Matches existing `RENDER_DEBOUNCE_MS` |
| Post-zoom Fabric.js re-render | < 50ms | `setDimensions()` + `renderAll()` for typical page (~50 objects) |
| Total zoom-to-crisp latency | < 200ms after zoom stops | 140ms debounce + < 50ms render |

## Sources

- [pdf.js PR #19128: CSS zoom fallback with high-res partial views](https://github.com/mozilla/pdf.js/pull/19128) -- HIGH confidence
- [Jake Archibald: Animating zooming using CSS (2025)](https://jakearchibald.com/2025/animating-zooming/) -- HIGH confidence
- [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) -- HIGH confidence
- [Kevin Schiener: Canvas willReadFrequently (2024)](https://www.schiener.io/2024-08-02/canvas-willreadfrequently) -- MEDIUM confidence
- [web.dev: OffscreenCanvas](https://web.dev/articles/offscreen-canvas) -- HIGH confidence
- [Fabric.js Zoom Performance Discussion #10392](https://github.com/fabricjs/fabric.js/discussions/10392) -- MEDIUM confidence
- [HackerNoon: Optimizing Performance in Fabric.js 5](https://hackernoon.com/optimizing-performance-in-fabricjs-5-14-best-practices-and-tips) -- MEDIUM confidence
- [Chrome DevBlog: GPU acceleration in 2D canvas](https://developer.chrome.com/blog/taking-advantage-of-gpu-acceleration-in-the-2d-canvas) -- HIGH confidence (older but fundamentals unchanged)
- [MDN: CSS contain property](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Using_CSS_containment) -- HIGH confidence
