# Architecture Patterns

**Domain:** SVG display + Canvas edit-only annotation layer
**Researched:** 2026-03-23

## Recommended Architecture

```
z-index: 30  |  Fabric Canvas (conditional, only when editing/drawing)
             |  - Transparent background
             |  - Mounts/unmounts per tool activation
             |  - Pen/eraser: covers entire page
             |  - Text/shape edit: covers annotation bounding box (stretch goal)
             |
z-index: 20  |  SVG Layer (always present)
             |  - viewBox="0 0 pageWidth pageHeight"
             |  - Renders ALL committed annotations
             |  - Click handlers for selection
             |  - Selection handles (when annotation selected)
             |  - Zoom handled automatically by viewBox
             |
z-index: 10  |  Syncfusion PDF Page
             |  - Renders PDF content
             |  - Manages page divs
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `SVGAnnotationLayer` (new) | Renders all committed annotations as SVG, handles selection, provides selection handles | Reads from annotation store; dispatches select/move/resize actions |
| `EditCanvas` (new) | Mounts Fabric.js Canvas for active editing (pen, eraser, text), commits changes back | Receives annotation data to load; dispatches commit/cancel actions |
| `AnnotationToolManager` (new or refactored) | State machine for tool selection, coordinates SVG vs Canvas modes | Tells SVGAnnotationLayer and EditCanvas what mode to be in |
| `App.jsx` (existing, modified) | Orchestrates layers, passes annotation data, handles zoom events | Passes props down; receives committed edits up |
| `LightweightAnnotationOverlay` (existing, retired) | Currently does SVG preview during pan/scroll | Replaced by SVGAnnotationLayer; code migrated into new component |

### Data Flow

```
User clicks annotation in SVG Layer
  --> SVGAnnotationLayer dispatches SELECT action
  --> AnnotationContext updates selectedAnnotationId
  --> SVGAnnotationLayer re-renders with selection handles on selected annotation

User double-clicks (or picks pen tool)
  --> AnnotationToolManager sets mode to EDIT / DRAW
  --> EditCanvas mounts (React conditional render)
  --> Canvas loads annotation JSON (if editing existing)
  --> User edits in Canvas
  --> User finishes (click away, press Escape, switch tool)
  --> EditCanvas extracts JSON via canvas.toJSON()
  --> Dispatches COMMIT action with new JSON
  --> EditCanvas unmounts (React conditional render)
  --> SVGAnnotationLayer re-renders with updated annotation

Zoom event (while SVG only)
  --> SVG viewBox handles it automatically. Zero code needed.

Zoom event (while Canvas mounted)
  --> Canvas gets CSS transform for instant visual feedback
  --> After zoom settles (200ms debounce), remount Canvas at new dimensions
  --> SVG layer scales automatically via viewBox throughout
```

## Patterns to Follow

### Pattern 1: SVG viewBox as Coordinate System

**What:** Set SVG viewBox to match PDF page dimensions in points. All annotation coordinates are in this space.

**When:** Always. This is the foundation of the entire architecture.

**Why:** Eliminates ALL coordinate conversion between storage format and display. Fabric.js JSON stores coordinates in page units. SVG viewBox maps page units to screen pixels. The browser handles the math.

```jsx
<svg
  viewBox={`0 0 ${pageWidth} ${pageHeight}`}
  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
  preserveAspectRatio="none"
>
  {/* All coordinates here are in page units (e.g., 612x792 for US Letter) */}
  <path d="M 100 200 L 300 400" stroke="red" strokeWidth={2} />
</svg>
```

### Pattern 2: Pointer Events for SVG Interaction

**What:** Use `onPointerDown` / `onPointerMove` / `onPointerUp` (not onClick/onMouseDown) for all SVG interaction.

**When:** Hit testing, drag, resize, selection.

**Why:** Pointer events unify mouse, touch, and pen input. They support `setPointerCapture()` which is essential for drag operations (keeps receiving events even when pointer leaves the element).

```jsx
function useSVGDrag(svgRef, onDragDelta) {
  const dragging = useRef(false);

  const handlePointerDown = useCallback((e) => {
    e.target.setPointerCapture(e.pointerId);
    dragging.current = true;
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!dragging.current) return;
    // Convert screen delta to SVG units
    const ctm = svgRef.current.getScreenCTM();
    const dx = e.movementX / ctm.a;  // ctm.a = horizontal scale factor
    const dy = e.movementY / ctm.d;  // ctm.d = vertical scale factor
    onDragDelta(dx, dy);
  }, [svgRef, onDragDelta]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}
```

### Pattern 3: Scale-Compensated Handle Sizes

**What:** Selection handles should be a constant visual size regardless of zoom level.

**When:** Rendering selection handles in SVG.

**Why:** At 25% zoom, a 6px handle in viewBox coordinates would be 1.5px on screen (invisible). At 400% zoom, it would be 24px (too large). Divide handle size by the current scale factor.

```jsx
// handleSize in screen pixels (constant visual size)
const HANDLE_SCREEN_PX = 8;

// Convert to viewBox units based on current zoom
const handleSize = HANDLE_SCREEN_PX / currentScale;

<rect
  x={corner.x - handleSize / 2}
  y={corner.y - handleSize / 2}
  width={handleSize}
  height={handleSize}
  vectorEffect="non-scaling-stroke"
/>
```

### Pattern 4: Canvas Mount/Unmount as React Lifecycle

**What:** Treat Fabric.js Canvas as a React-managed resource via `useEffect`.

**When:** Any tool that needs Canvas (pen, eraser, text edit, shape edit).

**Why:** React controls when the Canvas exists. No manual DOM tracking, no orphaned canvases, no memory leaks.

```jsx
// Parent decides when Canvas exists
{needsCanvas && <EditCanvas key={editSessionId} ... />}

// EditCanvas manages Fabric lifecycle internally
useEffect(() => {
  const canvas = new fabric.Canvas(ref.current, opts);
  // ... setup
  return () => { canvas.dispose(); };
}, []);
```

Using `key={editSessionId}` forces React to fully unmount and remount the component when the edit session changes, ensuring a clean Canvas every time.

### Pattern 5: Commit Flow (Canvas to SVG)

**What:** When user finishes editing in Canvas, extract JSON, update annotation store, unmount Canvas.

**When:** User clicks away, presses Escape, switches tool, or zoom begins.

**Why:** SVG layer always shows the latest committed state. Canvas is transient.

```
[Canvas active] --> user finishes editing
  --> const json = canvas.toJSON(customProperties);
  --> dispatch({ type: 'UPDATE_ANNOTATION', id, data: json });
  --> setNeedsCanvas(false);  // React unmounts EditCanvas
  --> SVGAnnotationLayer re-renders with updated annotation
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Two Rendering Systems Owning the Same DOM

**What:** Using SVG.js/interact.js alongside React to manipulate SVG elements.

**Why bad:** React's reconciliation assumes it owns the DOM tree. If an external library modifies attributes, React's virtual DOM becomes stale. On next render, React either overwrites the library's changes or the library overwrites React's. This causes flickering, position jumps, and lost state. This is exactly what happened with the 5-timer system -- multiple systems coordinating DOM mutations.

**Instead:** All SVG attributes flow through React props/state. React is the single owner of the SVG DOM.

### Anti-Pattern 2: Keeping Canvas Permanently Mounted But Hidden

**What:** Mounting Fabric Canvas on component init and hiding it with CSS when not needed.

**Why bad:** Defeats the primary benefit of the migration (memory savings). A hidden Canvas still consumes ~44MB per page at retina. Also keeps all Canvas event listeners active, potentially interfering with SVG pointer events.

**Instead:** Truly unmount Canvas (React conditional rendering). 5-15ms creation time is negligible.

### Anti-Pattern 3: Converting Between Coordinate Systems

**What:** Storing annotations in one coordinate space and converting to another for display.

**Why bad:** Every conversion is a potential rounding error and a source of "annotation shifted 1px" bugs. The current codebase has the container-aware sizing gotcha specifically because of coordinate system mismatch.

**Instead:** One coordinate system everywhere: unscaled PDF page units. SVG viewBox and Fabric Canvas both use the same units. Store in the same units. No conversion needed.

### Anti-Pattern 4: Timer-Based Coordination Between Layers

**What:** Using setTimeout/debounce to coordinate between SVG and Canvas layers.

**Why bad:** This is what the v1.0 5-timer system does. Timers are inherently racy, browser-speed-dependent, and create edge cases at every boundary.

**Instead:** React state drives which layer is active. State transitions are synchronous and deterministic. The only timer needed is a zoom settle debounce (200ms), and it only affects Canvas remounting, not SVG rendering.

### Anti-Pattern 5: pathOffset as Afterthought

**What:** Rendering Fabric.js Path objects in SVG without applying pathOffset.

**Why bad:** Paths render at incorrect positions. The offset can be 50-200px depending on the path. This is the #1 cause of "annotation looks right in Canvas but wrong in SVG" bugs.

**Instead:** Always apply pathOffset as the first thing when converting Path objects to SVG:
```jsx
transform={`translate(${-(pathOffset?.x || 0)}, ${-(pathOffset?.y || 0)})`}
```

## Scalability Considerations

| Concern | At 50 annotations/page | At 300 annotations/page | At 1000+ annotations/page |
|---------|----------------------|------------------------|--------------------------|
| SVG render time | <2ms, 60fps | ~8ms, 60fps | ~15ms, needs testing |
| Hit testing | Native pointer events, instant | Native pointer events, instant | May need spatial index if slow |
| Selection handles | 8 SVG rects, negligible | 8 SVG rects, negligible | 8 SVG rects, negligible |
| Canvas mount (for editing) | 5-15ms | 5-15ms (only selected annotation loaded) | 5-15ms (only selected annotation loaded) |
| Eraser Canvas load | ~20ms (load 50 objects) | ~100ms (load 300 objects) | ~200ms+ (consider pagination) |
| Memory (display mode) | SVG DOM: ~1KB/node = ~50KB | ~300KB | ~1MB (still 44x less than Canvas) |

## Sources

- Obsidian vault `CC-Architecture Overview.md` -- z-index layer diagram, tool behavior matrix
- Obsidian vault `CC-SVG Migration Research.md` -- performance benchmarks, browser gotchas
- PROJECT.md -- architectural constraints and scope
- [Peter Collingridge SVG interaction tutorials](https://www.petercollingridge.co.uk/tutorials/svg/interactive/dragging/)
- [SVG viewBox zoom mechanics](https://thecompetentdev.com/weeklyjstips/tips/47_svg_viewbox_zoom/)
- [Fabric.js performance optimization](https://github.com/fabricjs/fabric.js/wiki/Optimizing-performance)
- [Fabric.js React unmount issue #8899](https://github.com/fabricjs/fabric.js/issues/8899)
