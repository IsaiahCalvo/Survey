# Technology Stack

**Project:** Zoom Flicker Fix -- Direct Child Canvas
**Researched:** 2026-03-17
**Overall confidence:** HIGH (verified against Fabric.js 5.5.2 source code in node_modules)

## Recommended Stack

This is a refactor of an existing application. No new technologies are introduced. The stack section documents what is already in use, what specifically changes, and the technical mechanisms that make this refactor work.

### Core (unchanged)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| React | 18.2.x | UI framework, portal rendering | Keep as-is |
| Fabric.js | 5.5.2 | Canvas annotation drawing/editing | Keep as-is |
| Syncfusion React PDF Viewer | 32.1.19 (local SDK) | PDF rendering, zoom, page management | Keep as-is |
| Vite | 5.2.x | Dev server, HMR, build | Keep as-is |
| Electron | 25.2.x | Desktop wrapper, OAuth, IPC | Keep as-is |
| Supabase | 2.81.x | Annotation persistence, auth | Keep as-is |

### APIs Used (existing, relevant to this refactor)

| API | Purpose | How It Changes |
|-----|---------|---------------|
| `ReactDOM.createPortal(children, container)` | Mount annotation layers into Syncfusion page divs | Container changes from live/snapshot root divs to persistent overlay divs |
| `element.appendChild(child)` | DOM manipulation | New: used to re-attach overlay divs when Syncfusion recreates page divs |
| `element.style.transform` | CSS transforms | New: used for visual scaling during zoom (replaces freeze/snapshot approach) |
| `MutationObserver` (in SyncfusionPDFContainer) | Detect page div creation/destruction | Unchanged, but its output now drives overlay re-attachment |
| `IntersectionObserver` (in PAL) | Detect when offscreen pages scroll into view | Unchanged, used for deferred canvas redraw |
| `Fabric.js Canvas.setWidth/setHeight/setZoom/renderAll` | Canvas resize and redraw | Unchanged, called less frequently (only after zoom settles) |

---

## Critical Technical Mechanisms

### 1. CSS Transform Scale on Canvas Parent -- How and Why It Works

**Confidence: HIGH** (verified against Fabric.js 5.5.2 source code at `node_modules/fabric/dist/fabric.js` lines 12504-12557)

The design applies `transform: scale(ratio); transform-origin: top left;` to the overlay div that is the **parent** of the Fabric.js canvas. This is the same two-phase approach used by Mozilla's pdf.js viewer (`zoomLayer` in `pdf_page_view.js`):

**Phase 1 -- Instant visual feedback via CSS:**
```css
/* Applied to the overlay div wrapper during zoom */
.overlay-div {
  transform: scale(1.5);        /* ratio = newScale / oldScale */
  transform-origin: top left;   /* anchor to top-left corner */
}
```

This is essentially free -- it happens on the GPU compositor thread. The canvas pixels are stretched/compressed but never repainted. The image may look blurry (like zooming into a photo) but annotations stay visible and correctly positioned. This is the same behavior as Adobe Acrobat, pdf.js, and every modern PDF viewer.

**Phase 2 -- Full redraw at new resolution:**
After zoom settles (1000ms debounce), remove the CSS transform and call `setWidth`/`setHeight`/`setZoom`/`renderAll` on the Fabric.js canvas to redraw at the new resolution. The image becomes crisp.

**Why `transform-origin: top left` is mandatory:**
The default `transform-origin` is `center center`. If you scale from the center, the overlay content shifts position relative to the page div, causing a visible "jump." With `top left`, the top-left corner stays anchored to the page div's top-left corner, and the content grows/shrinks from that anchor point -- matching how Syncfusion resizes its own page divs.

### 2. Fabric.js 5.5.2 Pointer Handling with Parent CSS Transforms

**Confidence: HIGH** (verified by reading actual source code)

A common fear is that CSS transforms on a parent element will break Fabric.js mouse/touch interaction. This is NOT the case for Fabric.js 5.5.2, and here is exactly why.

The `getPointer()` method (line 12504) does two things that make parent CSS transforms transparent:

**Step A -- Position calculation via `getBoundingClientRect()`:**
```javascript
// line 12515
bounds = upperCanvasEl.getBoundingClientRect();
```
`getBoundingClientRect()` returns the **visual** bounding box -- it automatically includes all CSS transforms from the element AND all ancestors. If the parent has `transform: scale(1.5)` and the canvas backstore is 800x600, `bounds.width` returns `1200` and `bounds.height` returns `900`. The offset calculation at line 12529 (`calcOffset()`) also uses `getBoundingClientRect()` (line 3478), so `_offset.left` and `_offset.top` are correct in visual space.

**Step B -- CSS scale correction:**
```javascript
// lines 12547-12551
cssScale = {
  width: upperCanvasEl.width / boundsWidth,    // 800 / 1200 = 0.667
  height: upperCanvasEl.height / boundsHeight  // 600 / 900 = 0.667
};
// lines 12553-12556
return {
  x: pointer.x * cssScale.width,   // visual coords -> canvas coords
  y: pointer.y * cssScale.height
};
```
This maps from visual (screen) coordinates back to canvas (backstore) coordinates. The ratio `backstore / visual` is exactly `1 / parentScale`, which is the correct inverse mapping.

**What this means for the refactor:**
- Drawing tools will work correctly even while the CSS transform is active on the parent
- Hit testing (object selection, eraser, region detection) will work correctly
- `calcOffset()` is called on every pointer event, so offset changes from CSS transforms are always current
- NO monkey-patching of `getPointer` is needed
- NO coordinate correction logic is needed in App.jsx or PageAnnotationLayer.jsx

**Caveat -- `isZooming` should still disable drawing during rapid zoom:**
While the pointer math is correct for a static CSS transform, rapid zoom-scroll generates dozens of zoom events per second. During this window, the Fabric.js canvas should not accept drawing input because: (a) the underlying data scale changes mid-stroke, and (b) the settle timer hasn't fired yet. The existing `isZooming` prop on PAL already handles this correctly.

### 3. Fabric.js `setDimensions` -- When to Use What

**Confidence: HIGH** (verified at `node_modules/fabric/dist/fabric.js` lines 9467-9496)

`setDimensions(dimensions, options)` has two modes:

| Mode | What It Does | When to Use |
|------|-------------|-------------|
| Default (no options) | Sets backstore AND CSS dimensions, triggers `requestRenderAll()` | After zoom settles, to redraw at new resolution |
| `{ cssOnly: true }` | Sets only CSS `style.width` / `style.height`, NO redraw | NOT recommended for this refactor (see below) |
| `{ backstoreOnly: true }` | Sets only `canvas.width` / `canvas.height`, triggers redraw | Rare, for retina scaling adjustments |

**For this refactor, use `setWidth()` + `setHeight()` + `setZoom()` + `renderAll()` (the existing pattern):**
The current PAL code already does this correctly at lines 7907-7912. Do not change this. The CSS transform on the parent overlay div handles the visual transition; when it's time to redraw, remove the CSS transform and let Fabric.js do a full resize + render.

**Do NOT use `setDimensions({ cssOnly: true })` as the zoom transition mechanism.** While it changes CSS dimensions without a backstore resize, it triggers `_initRetinaScaling()` and `calcOffset()` (line 9488-9489), which can cause unexpected side effects mid-zoom. The CSS transform on the parent div is simpler, cheaper, and does not touch Fabric.js internals at all.

### 4. Canvas Resize Performance Cost

**Confidence: HIGH** (verified in source code)

When `setWidth(w)` or `setHeight(h)` is called on a Fabric.js canvas:
1. It sets `canvas.width` on both `lowerCanvasEl` and `upperCanvasEl` (line 9506-9515)
2. Setting `canvas.width` clears ALL canvas content (browser behavior, not Fabric.js)
3. `_initRetinaScaling()` re-scales the context for retina displays (line 9488)
4. `requestRenderAll()` queues a full redraw (line 9492)

**Cost:** The redraw (`renderAll`) is the expensive part. For a page with 50-100 annotations, this is 5-30ms depending on complexity. This is why the design defers it until zoom settles -- running it on every zoom event would cause jank.

**The tiered render strategy in PAL should be preserved:**
- Center page: immediate render via stagger queue
- Visible non-center pages: deferred render (800ms delay)
- Off-screen pages: render when scrolled into view

This tiering already exists in PAL (lines 7920-7938) and should NOT be removed. The only change is removing the `onScaleApplied` callback and `isHidden` prop.

### 5. React Portal Re-parenting -- Why `appendChild` Works

**Confidence: HIGH** (verified against React 18 portal behavior)

When Syncfusion destroys a page div and creates a new one, the overlay div (which was a child of the old page div) becomes detached from the DOM. The fix is:

```javascript
newPageDiv.appendChild(overlayDiv);  // re-attach the same div object
```

React portals render into a container by **reference**, not by DOM tree position. Moving a portal container div to a new parent does NOT cause React to unmount/remount the portal children. The Fabric.js canvas inside the portal stays intact -- no canvas destruction, no state loss, no re-initialization.

This is confirmed by the React docs: "Portals only change the physical placement of the DOM node. In every other way, the JSX you render into a portal acts as a child node of the React component that renders it."

### 6. `will-change: transform` Optimization

**Confidence: MEDIUM** (standard CSS optimization, but test to verify no memory issues)

Adding `will-change: transform` to the overlay div promotes it to its own GPU compositing layer, making subsequent `transform: scale()` changes nearly free:

```css
.overlay-div {
  will-change: transform;  /* Promote to compositor layer */
}
```

**When to add it:** Set `will-change: transform` when zoom starts (or on the overlay div permanently if memory allows). Remove it after zoom settles and the CSS transform is removed, to free GPU memory.

**Caution for this app:** Each visible page gets its own overlay div with a Fabric.js canvas. On a 5-page visible spread, that is 5 compositor layers + 5 canvas backstore buffers. This is fine for desktop (Electron), but do not add `will-change` to ALL pages -- only visible ones. Fortunately, the existing page virtualization (only rendering overlays for nearby pages) already limits this.

---

## What Gets Removed (dead code after refactor)

| Category | Count | Examples |
|----------|-------|---------|
| Refs in App.jsx | 30+ | `zoomOverlayTransformActiveRef`, `syncfusionStablePortalHostsRef`, `syncfusionScaleConfirmPendingRef`, `syncfusionPendingZoomScaleRef`, `syncfusionFrozenOverlayPagesRef`, etc. |
| Functions in App.jsx | 14 | `ensureSyncfusionStablePortalChildren`, `beginSyncfusionScaleConfirmPending`, `handlePALScaleApplied`, `syncSyncfusionZoomPresentationPage`, `prepareSyncfusionZoomPresentationSwap`, `queueSyncfusionOverlayTransformSync`, etc. |
| Props on PAL | 3 | `onScaleApplied`, `presentationApiRegistry`, `isHidden` |
| Render loop logic | ~200 lines | Frozen page numbers, interaction windows, stable portal host chain, scale computation with fallbacks |

## What Gets Added

| Addition | Size | Purpose |
|----------|------|---------|
| `overlayDivsRef` | 1 ref | Stores persistent overlay divs per page |
| `attachOverlayToPageDiv()` | ~15 lines | Creates/reuses/attaches overlay divs to Syncfusion page divs |
| Re-attachment `useEffect` | ~10 lines | Watches `syncfusionPageContainers`, re-attaches overlay divs when page divs are recreated |
| Simplified zoom handler | ~30 lines | CSS `transform: scale(ratio)` on overlay divs during zoom + settle timer |
| Simplified render loop | ~50 lines | Direct portal creation without freeze/snapshot logic |

---

## What NOT to Do (and Why)

### Do NOT apply CSS transform to the Fabric.js canvas element directly
Apply it to the **parent overlay div**. If you set `transform: scale()` on the canvas element itself, Fabric.js's wrapper div (`.canvas-container`) will not scale, causing a mismatch between the canvas visual size and the wrapper's click area. The wrapper clips overflow, so scaled-up content gets cut off.

### Do NOT use `canvas.setDimensions({ cssOnly: true })` as the zoom transition
This calls `_initRetinaScaling()` and `calcOffset()` internally (line 9488-9489), which modifies the canvas context's scale transform. Mid-zoom, this causes Fabric.js internal state to diverge from the visual state. Use a plain CSS transform on the parent div instead -- it does not touch Fabric.js internals at all.

### Do NOT call `canvas.setWidth()`/`setHeight()` during rapid zoom events
Each call clears the canvas backstore (browser behavior), triggers retina re-scaling, and queues a full redraw. At 10-20 zoom events per second, this causes severe jank. Only call these after the zoom settle timer fires.

### Do NOT use CSS `zoom` property instead of `transform: scale()`
The CSS `zoom` property changes the element's layout box, affecting `offsetWidth`/`offsetHeight`. Fabric.js uses `getBoundingClientRect()` for pointer calculations, which correctly accounts for `transform: scale()`. But `zoom` interacts differently with layout calculations and can cause incorrect object positioning. Stick with `transform: scale()`.

### Do NOT remove the `isZooming` prop from PageAnnotationLayer
While Fabric.js pointer math works correctly with a static CSS transform, the `isZooming` prop serves a different purpose: it latches a "zoom mode" that defers expensive canvas resizes until zoom settles. Removing it would cause canvas resizes on every intermediate zoom event.

### Do NOT remove the tiered render strategy in PAL
The center-page-first, visible-deferred, offscreen-lazy strategy (PAL lines 7920-7938) prevents jank when zooming multi-page documents. The refactor removes the `onScaleApplied` callback but keeps the tiering logic intact.

### Do NOT use `requestAnimationFrame` loops for CSS transform application
The current code uses `queueSyncfusionOverlayTransformSync()` with a RAF loop to apply transforms. The new approach is simpler: apply the transform directly in the zoom handler (which fires on main thread from Syncfusion's event). No RAF loop needed.

### Do NOT add `transition` CSS to the overlay div's transform
Adding `transition: transform 300ms ease` would create a smooth animation, but it causes the overlay to lag behind Syncfusion's page resize. Syncfusion resizes instantly; the overlay must match instantly. The transform should be applied synchronously, not animated.

---

## Alternatives Considered

| Decision | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Canvas overlay approach | Direct child canvas (Option 3) | SVG display + Fabric.js editing (Option 2) | Option 2 requires a dual-mode system (SVG for display, Fabric.js for editing) which adds complexity. Option 3 preserves the existing Fabric.js system entirely. |
| Zoom visual bridge | CSS `transform: scale()` on parent div | Canvas snapshot (`toDataURL`) | Snapshot capture is 100-200ms per page and must happen synchronously before zoom. CSS transforms are free (GPU compositor thread). |
| Pointer handling | Rely on Fabric.js 5.5.2 built-in `getBoundingClientRect` | Monkey-patch `getPointer` | Not needed. Verified in source (line 12515) that `getBoundingClientRect()` on the upper canvas already accounts for all ancestor CSS transforms. |
| Portal reparenting | `appendChild` persistent div | React reverse-portal library | No new dependency needed. `appendChild` is a 1-line DOM operation. React portals render by container reference, not DOM position. |
| Re-attachment trigger | `useEffect` on `syncfusionPageContainers` | New `MutationObserver` on viewer root | `MutationObserver` already exists in `SyncfusionPDFContainer` and surfaces results as React state. Adding another would duplicate detection. |
| Scale source during render | `syncfusionViewerScale` with `scale` state fallback | Complex frozen/committed/fallback scale chain | The 20-line scale computation in the current render loop exists because of the freeze mechanism. With no freeze, just use the live viewer scale. |

## Installation

No new packages. No `package.json` changes.

```bash
# Nothing to install. This is a refactor using existing dependencies.
```

## Sources

### Verified (HIGH confidence)
- Fabric.js 5.5.2 source: `node_modules/fabric/dist/fabric.js` -- `getPointer()` at line 12504, `setDimensions()` at line 9467, `calcOffset()` at line 9149, `getElementOffset()` at line 3455, `_initRetinaScaling()` at line 9125
- Project `package.json` for current versions
- Reference app: `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App/packages/client/src/pages/Viewer.tsx` -- SVG overlay pattern at lines 144-285
- Design spec: `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md`
- MDN `getBoundingClientRect()`: returns visual bounding box including all CSS transforms from element and ancestors

### Research (MEDIUM confidence)
- [Fabric.js CSS-scale issue #868](https://github.com/fabricjs/fabric.js/issues/868) -- Historical discussion of CSS scaling support, confirmed `getPointer` uses `getBoundingClientRect`
- [Fabric.js `setDimensions` PR #1420](https://github.com/fabricjs/fabric.js/pull/1420) -- `cssOnly` option implementation
- [pdf.js smooth zoom bug 1659492](https://bugzilla.mozilla.org/show_bug.cgi?id=1659492) -- Two-phase zoom approach (CSS transform then re-render)
- [Performant Drag and Zoom with Fabric.js (2025)](https://medium.com/@Fjonan/performant-drag-and-zoom-using-fabric-js-3f320492f24b) -- CSS transform scale + Fabric.js redraw pattern
- [MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) -- Confirms visual bounding box includes CSS transforms
- [MDN CSS transform-origin](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin) -- Anchor point for scale transforms
- [GPU acceleration with will-change (2025)](https://www.lexo.ch/blog/2025/01/boost-css-performance-with-will-change-and-transform-translate3d-why-gpu-acceleration-matters/) -- Compositor layer promotion for transform performance
