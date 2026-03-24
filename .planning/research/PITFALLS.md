# Domain Pitfalls

**Domain:** SVG display + Canvas edit-only annotation layer
**Researched:** 2026-03-23

## Critical Pitfalls

Mistakes that cause rewrites or major architectural issues.

### Pitfall 1: Missing pathOffset on Fabric.js Path Objects

**What goes wrong:** Pen/highlighter strokes render at incorrect positions in SVG. A stroke drawn in the center of the page might appear offset by 50-200px.

**Why it happens:** Fabric.js Path objects have a `pathOffset` property that represents the difference between the object's center point and the path data's origin (0,0). When Fabric renders on Canvas, it applies this offset internally. When you render the path data as SVG `d` attribute, the offset is not included -- you must apply it manually.

**Consequences:** All freehand annotations (pen, highlighter) appear at wrong positions. This is the most common annotation type, so it is immediately visible and breaks user trust.

**Prevention:** Apply pathOffset as a negative translate inside the annotation's transform group:
```jsx
<g transform={`translate(${obj.left}, ${obj.top}) scale(${obj.scaleX}, ${obj.scaleY})`}>
  <path
    d={pathData}
    transform={`translate(${-(obj.pathOffset?.x || 0)}, ${-(obj.pathOffset?.y || 0)})`}
  />
</g>
```

**Detection:** Compare SVG rendering against Fabric.js Canvas rendering on the same page. Any position mismatch on pen strokes indicates missing pathOffset.

### Pitfall 2: Fabric.js canvas.dispose() Is Async in React useEffect Cleanup

**What goes wrong:** Canvas event listeners remain active after component unmounts, causing "cannot read property of null" errors and potential memory leaks.

**Why it happens:** `canvas.dispose()` returns a Promise in Fabric.js 5.5.2. React's useEffect cleanup function must be synchronous. If you `await dispose()`, the cleanup function becomes async which React ignores. If you just call `dispose()` without awaiting, the Promise resolves after React has already removed the DOM element.

**Consequences:** Console errors on unmount. Potential event listener leaks if dispose's cleanup doesn't complete. In worst case, event handlers fire on unmounted DOM elements.

**Prevention:**
```jsx
useEffect(() => {
  const canvas = new fabric.Canvas(canvasRef.current, opts);
  fabricRef.current = canvas;

  return () => {
    // Null the ref immediately to prevent stale access
    const c = fabricRef.current;
    fabricRef.current = null;
    // dispose() runs async but that's OK -- DOM element is already removed by React
    if (c) c.dispose();
  };
}, []);
```

Guard all Canvas operations with `if (!fabricRef.current) return;` to handle the window between cleanup starting and dispose completing.

**Detection:** Console errors during rapid tool switching or zoom-triggered remounts. Use React StrictMode (which double-mounts in dev) to catch these issues early.

### Pitfall 3: Two Rendering Systems Fighting Over DOM

**What goes wrong:** SVG elements flicker, jump positions, or lose event handlers when both React and an external library (SVG.js, interact.js) modify the same elements.

**Why it happens:** React's reconciliation algorithm assumes it is the sole owner of the DOM tree it manages. If an external library modifies element attributes directly (e.g., `element.setAttribute('x', 100)`), React's virtual DOM becomes stale. On next re-render, React either restores the old value (reverting the library's change) or the library restores its value (reverting React's change).

**Consequences:** Annotations flicker between positions. Selection handles appear in wrong positions. Click handlers stop working because React removed and recreated the element but the library still references the old DOM node.

**Prevention:** Do NOT use SVG.js, interact.js, subjx, or any library that directly mutates SVG elements. Use React state and props as the single source of truth for all SVG attributes. The v1.0 Phase 4 failure was caused by this exact pattern (multiple systems coordinating DOM mutations via timers).

**Detection:** Any visual glitch that happens only on re-render (not on first render) indicates two systems fighting.

### Pitfall 4: Manual Scale Multiplication Instead of viewBox

**What goes wrong:** Developer manually multiplies annotation coordinates by the zoom scale factor, replicating the exact pattern that caused v1.0's problems.

**Why it happens:** The existing `LightweightAnnotationOverlay.jsx` manually scales coordinates (`preview.left * safeScale`). Developers familiar with this code may copy the pattern into the new SVG layer.

**Consequences:** Reintroduces the container-aware sizing gotcha. Electron zoom factor creates mismatch between computed scale and actual display scale. Annotations drift at certain zoom levels.

**Prevention:** Use SVG viewBox. Store and render ALL coordinates in unscaled page units. Never multiply by scale factor. The viewBox-to-viewport mapping handles all scaling at the browser engine level.

```jsx
// WRONG: manual scaling (current LightweightAnnotationOverlay pattern)
<rect x={obj.left * scale} y={obj.top * scale} width={obj.width * scale} />

// RIGHT: viewBox handles scaling
<svg viewBox={`0 0 ${pageWidth} ${pageHeight}`} style={{ width: '100%', height: '100%' }}>
  <rect x={obj.left} y={obj.top} width={obj.width} />
</svg>
```

**Detection:** If you see any `* scale` or `* zoom` in SVG coordinate calculations, something is wrong. The only place scale should appear is in handle sizing (scale-compensated handle size).

## Moderate Pitfalls

### Pitfall 5: Pointer Events Blocked by SVG Root

**What goes wrong:** Clicks on annotations don't register. Users cannot select annotations.

**Why it happens:** The SVG root element has `pointer-events: auto` by default, which means it captures all clicks before they reach child elements. If the SVG overlaps the entire page, it also blocks clicks on the PDF content below.

**Prevention:** Set `pointer-events: none` on the SVG root element. Set `pointer-events: auto` only on annotation `<g>` elements that should be interactive.

```jsx
<svg style={{ pointerEvents: 'none' }} ...>
  <g pointerEvents="auto" onClick={() => onSelect(id)}>
    <path ... />
  </g>
</svg>
```

### Pitfall 6: Selection Handle Size at Extreme Zoom

**What goes wrong:** At 25% zoom, selection handles are invisible (1-2 screen pixels). At 400% zoom, handles are enormous (32+ screen pixels).

**Why it happens:** If handle size is specified in viewBox units without compensation, the viewBox scaling affects handle size proportionally with zoom.

**Prevention:** Divide handle size by current scale to maintain constant screen size:
```jsx
const handleViewBoxSize = HANDLE_SCREEN_PX / currentScale;
```

Also apply `vector-effect="non-scaling-stroke"` on handle borders so stroke width stays constant.

### Pitfall 7: foreignObject Text Rendering Inconsistencies

**What goes wrong:** Text annotations (rendered via `<foreignObject>`) have slightly different line wrapping, font metrics, or positioning compared to Fabric.js Canvas text rendering.

**Why it happens:** `<foreignObject>` embeds HTML inside SVG. The HTML text layout engine has different kerning, line-height calculations, and word-wrap behavior than Fabric.js's custom text rendering. Font fallback chains may differ.

**Prevention:**
- Match Fabric.js text properties to CSS: `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textAlign`, `lineHeight`
- Set `white-space: pre-wrap` to preserve line breaks from Fabric.js text
- Accept minor differences (1-2px) as cosmetically acceptable -- exact pixel match is impossible between Canvas text and HTML text
- Test with the actual fonts used in the application

### Pitfall 8: Canvas Mounts During Rapid Tool Switching

**What goes wrong:** User rapidly switches between pen -> select -> pen. Canvas mounts, unmounts, mounts again. Second mount fails because dispose() from first unmount hasn't completed yet.

**Why it happens:** Fabric.js canvas.dispose() is async. If React unmounts and remounts the EditCanvas component within the dispose() execution window (~1 frame), the new Canvas may try to initialize on a DOM element that the old dispose() is still cleaning up.

**Prevention:** Use React `key` prop to force full component teardown/recreation:
```jsx
<EditCanvas key={`edit-${toolActivationCount}`} ... />
```
Alternatively, debounce tool switches by 50ms (one frame) to ensure dispose completes.

### Pitfall 9: Committing Annotations During Zoom

**What goes wrong:** User is drawing a pen stroke when zoom begins. The stroke-in-progress is lost.

**Why it happens:** Zoom triggers Canvas remount (CSS transform -> settle -> unmount -> remount at new size). If the in-progress stroke isn't committed before unmount, it's discarded.

**Prevention:** On zoom start, immediately commit any in-progress stroke:
```js
// Zoom handler
if (canvasRef.current && canvasRef.current.isDrawingMode) {
  // Force-complete the current stroke
  canvasRef.current.fire('mouse:up', {});
  commitPendingStrokes();
}
// Then apply CSS transform for visual feedback
```

## Minor Pitfalls

### Pitfall 10: SVG `preserveAspectRatio` Setting

**What goes wrong:** Annotations have slight horizontal or vertical offset because SVG preserves aspect ratio while the page div doesn't match exactly.

**Prevention:** Use `preserveAspectRatio="none"` because the Syncfusion page div already constrains the correct aspect ratio. The SVG should fill the div completely without adding its own aspect ratio constraints.

### Pitfall 11: Firefox SVG viewBox Sub-Pixel Rounding

**What goes wrong:** Annotations shimmer or shift by 0.5px at certain zoom levels in Firefox.

**Prevention:** Round viewBox values to integers: `viewBox="0 0 612 792"` not `viewBox="0 0 612.5 792.3"`. PDF page dimensions should already be integers.

### Pitfall 12: SVG z-Order Mismatches

**What goes wrong:** An annotation that should be on top appears behind another.

**Why it happens:** SVG paints elements in DOM order (last element = on top). If annotations are stored in a different order than their visual z-index, they render in the wrong stacking order.

**Prevention:** Ensure annotations are rendered in the same order they were created/stacked. If the existing data model has a z-index or creation order, sort by it before rendering.

### Pitfall 13: Hit Testing Misses on Thin Strokes

**What goes wrong:** User clicks directly on a 1px pen stroke but the click doesn't register because the stroke is too thin to hit reliably.

**Prevention:** Use a combination approach:
- Render an invisible "hit area" path with `strokeWidth={Math.max(8, originalStrokeWidth)}` and `stroke="transparent"` behind the visible path
- Or use `isPointInStroke()` with a tolerance (inflate the test area)
- Or set `pointer-events="stroke"` with padded stroke-width on the `<g>` wrapper

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| SVG display layer | pathOffset handling (#1) | Test every annotation type against Canvas rendering; regression test with known positions |
| SVG display layer | Manual scale multiplication (#4) | Code review rule: no `* scale` in SVG coordinates. viewBox only. |
| SVG selection/interaction | Pointer events blocked (#5) | Set pointer-events correctly on SVG root vs annotation groups |
| SVG selection/interaction | Handle sizing at zoom extremes (#6) | Scale-compensated handle sizes; test at 25%, 100%, 400% |
| Canvas mount/unmount | dispose() async (#2) | Null ref immediately; guard all operations; use React StrictMode |
| Canvas mount/unmount | Rapid tool switching (#8) | Key-based remounting; optional 50ms debounce |
| Zoom during active tools | In-progress stroke loss (#9) | Auto-commit on zoom start; test with rapid zoom-while-drawing |
| Text annotations | foreignObject inconsistencies (#7) | Match CSS to Fabric text props; accept minor differences |

## Sources

- [Fabric.js pathOffset PR #5668](https://github.com/fabricjs/fabric.js/pull/5668/files) -- pathOffset coordinate handling
- [Fabric.js dispose bug #8899](https://github.com/fabricjs/fabric.js/issues/8899) -- async dispose in React
- [Fabric.js dispose error #10482](https://github.com/fabricjs/fabric.js/issues/10482) -- unmount errors
- [SVG.js plugin compat #1031](https://github.com/svgdotjs/svg.js/issues/1031) -- two-system DOM conflicts
- [interact.js SVG resize bug #202](https://github.com/taye/interact.js/issues/202) -- coordinate transform issues
- Obsidian vault `CC-SVG Migration Research.md` -- performance benchmarks, browser gotchas
- Obsidian vault `CC-Architecture Overview.md` -- 5-timer system failure history
- CLAUDE.md project instructions -- zoom system fragility warnings
