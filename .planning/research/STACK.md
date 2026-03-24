# Technology Stack

**Project:** SVG Migration -- SVG Display + Fabric.js Edit-Only Architecture
**Researched:** 2026-03-23
**Overall confidence:** HIGH (native browser APIs + existing Fabric.js 5.5.2, no new runtime dependencies)

## Recommendation: Zero New Dependencies

The SVG display layer, hit testing, selection handles, and coordinate bridging should all be built with **native SVG + DOM pointer events + React state**, not third-party libraries. The existing `LightweightAnnotationOverlay.jsx` already proves this approach works. Adding SVG.js, interact.js, or similar would introduce a second rendering paradigm competing with React's DOM management -- the exact kind of architectural split that causes bugs in this codebase.

---

## Core Stack (Unchanged)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| React | 18.2.x | UI framework, portal rendering, SVG element rendering | Keep as-is |
| Fabric.js | 5.5.2 | Canvas annotation editing (pen, eraser, text edit only) | Keep -- scope reduced |
| Syncfusion React PDF Viewer | 32.1.19 (local SDK) | PDF rendering, zoom, page management | Keep as-is |
| Vite | 5.2.x | Dev server, HMR, build | Keep as-is |
| Electron | 25.2.x | Desktop wrapper, OAuth, IPC | Keep as-is |
| Supabase | 2.81.x | Annotation persistence, auth | Keep as-is |

## New Capabilities (No New Dependencies)

| Capability | Implementation | Why No Library |
|------------|---------------|----------------|
| SVG display layer | React JSX `<svg>` + `<path>`, `<line>`, `<rect>`, `<foreignObject>` | React already manages DOM; adding SVG.js means two systems fighting over the same elements |
| SVG viewBox zoom | Native `viewBox` attribute on `<svg>` element | Browser handles all scaling automatically -- zero JavaScript needed |
| Hit testing | Native `pointerEvents` on SVG `<g>` elements + `onClick`/`onPointerDown` | SVG elements ARE DOM nodes; React event handlers work directly on them |
| Selection handles | React-rendered SVG `<rect>` corner handles with `onPointerDown` | 50-80 lines of code; no library needed for 8 drag handles |
| Drag/move | `onPointerDown`/`onPointerMove`/`onPointerUp` on SVG elements | Standard DOM events, coordinate math is ~20 lines |
| Resize | Pointer events on corner/edge handle `<rect>` elements | Same pattern as drag, constrained to handle position |
| Rotate | Not needed in SVG select mode (rotation only during Canvas edit) | Fabric.js handles rotation when Canvas is mounted for editing |
| Canvas mount/unmount | React conditional rendering + `useEffect` cleanup | Standard React lifecycle; `fabric.Canvas` in `useEffect`, `canvas.dispose()` in cleanup |
| SVG-Canvas coordinate bridge | Shared unscaled page coordinate system | Both SVG viewBox and Fabric Canvas use the same coordinate space (page width x height) |

## Why NOT SVG.js

**Confidence: HIGH** (evaluated @svgdotjs/svg.js v3.2.5, 800K weekly downloads)

SVG.js is a solid library for imperative SVG manipulation, but it conflicts with React's declarative rendering model.

| Concern | Detail |
|---------|--------|
| **Fights React's DOM management** | SVG.js creates and manages SVG elements imperatively (`SVG().rect(100, 50).move(10, 10)`). React also manages the DOM. Two systems mutating the same SVG tree causes reconciliation bugs, stale references, and unmount chaos. This is the EXACT class of bug that caused v1.0 Phase 4 to fail 4 times. |
| **Plugin ecosystem fragile** | svg.select.js, svg.resize.js, and svg.draggable.js had documented compatibility breaks between SVG.js v2 and v3. GitHub issues #1031, #65, #61 show users unable to combine plugins reliably. |
| **Unnecessary abstraction** | React JSX already renders SVG elements. `<rect x={10} y={20} width={100} height={50} />` is more readable and debuggable than `SVG().rect(100, 50).move(10, 20)`, and React handles updates, keys, and unmounting automatically. |
| **Bundle size** | 2.64MB unpacked. For an app that already has Fabric.js (1.1MB), adding another rendering library is wasteful when native SVG + React does the same job. |

## Why NOT interact.js

**Confidence: HIGH** (evaluated interactjs v1.10.27)

interact.js is excellent for making arbitrary HTML/SVG elements draggable/resizable, but it solves a problem we do not have.

| Concern | Detail |
|---------|--------|
| **DOM manipulation outside React** | interact.js modifies element transforms directly via `event.target.style.transform`. In React, position state must flow through React state to trigger re-renders and keep the data model in sync. interact.js's approach bypasses React, causing the visual position to diverge from the data model. |
| **Coordinate transform complexity with scaled SVG** | interact.js reports deltas in screen coordinates. Inside an SVG with a viewBox, screen pixels do not equal SVG user units. Converting interact.js deltas to SVG coordinates requires manual `getScreenCTM().inverse()` math on every event -- the same math you would write without interact.js, making the library provide zero value. |
| **Overkill** | interact.js provides inertia, snapping, dropzones, multi-touch gestures. We need: move a rectangle by dragging, resize by dragging corners. That is ~60 lines of pointer event code. |
| **Last published 2+ years ago** | v1.10.27 was the last release. React wrapper (`react-interactjs`) last updated 10 years ago. |

## Why NOT subjx

**Confidence: MEDIUM** (evaluated subjx v1.1.2, recently updated but low adoption)

subjx provides drag/resize/rotate for SVG elements with a nice API (`subjx('.my-element').drag({})`), but shares the same fundamental problem: imperative DOM manipulation competing with React.

| Concern | Detail |
|---------|--------|
| **Imperative API** | Creates its own control handles by injecting DOM elements. React cannot track or manage these injected elements. |
| **Low adoption** | No weekly download data available; 1 maintainer, ~535 npm dependents. Too risky for a core architectural component. |
| **Same solution, custom-built, is better** | The selection handle UI we need (8 corner/edge handles + bounding box) is 50-80 lines of React SVG. We get React state management, proper unmounting, and zero external DOM mutation for free. |

---

## Technical Implementation Details

### SVG Display Layer

**Confidence: HIGH** (validated by LightweightAnnotationOverlay.jsx + reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App`)

```jsx
// Core pattern: SVG with viewBox in unscaled page coordinates
<svg
  viewBox={`0 0 ${pageWidth} ${pageHeight}`}
  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
  preserveAspectRatio="none"
>
  {annotations.map(ann => renderAnnotation(ann))}
</svg>
```

Key attributes:
- `viewBox="0 0 612 792"` (standard US Letter in PDF points)
- `preserveAspectRatio="none"` -- Syncfusion page div already constrains aspect ratio
- `width: 100%; height: 100%` -- SVG fills the page div, viewBox handles coordinate mapping
- All annotation coordinates stored in unscaled PDF page units (same as Fabric.js JSON)

### SVG Hit Testing

**Confidence: HIGH** (native browser APIs, widely available since July 2020)

Two approaches, use both:

1. **React event handlers on `<g>` elements** (primary):
```jsx
<g
  data-annotation-id={ann.id}
  pointerEvents="auto"         // Enable clicks on this annotation
  onClick={() => onSelect(ann.id)}
  style={{ cursor: 'pointer' }}
>
  <path d={pathData} ... />
</g>
```

2. **`SVGGeometryElement.isPointInFill()` / `isPointInStroke()`** (for precise path hit testing):
```js
// Convert screen click to SVG coordinates
const svgPoint = svgEl.createSVGPoint();
svgPoint.x = clientX;
svgPoint.y = clientY;
const localPoint = svgPoint.matrixTransform(svgEl.getScreenCTM().inverse());

// Test against path geometry
const pathEl = document.querySelector(`[data-annotation-id="${id}"] path`);
pathEl.isPointInStroke(localPoint);  // true/false
```

Browser support: Chrome (all), Firefox 97+, Safari 14.1+, Electron (Chromium-based). Baseline widely available since July 2020.

### SVG Selection Handles

**Confidence: HIGH** (standard React SVG rendering)

Selection handles are React-rendered SVG elements, positioned in viewBox coordinates:

```jsx
// 8 handles: 4 corners + 4 edge midpoints
const handles = [
  { x: bbox.x, y: bbox.y, cursor: 'nwse-resize' },                           // top-left
  { x: bbox.x + bbox.w / 2, y: bbox.y, cursor: 'ns-resize' },                // top-center
  { x: bbox.x + bbox.w, y: bbox.y, cursor: 'nesw-resize' },                  // top-right
  { x: bbox.x + bbox.w, y: bbox.y + bbox.h / 2, cursor: 'ew-resize' },       // right-center
  { x: bbox.x + bbox.w, y: bbox.y + bbox.h, cursor: 'nwse-resize' },         // bottom-right
  { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h, cursor: 'ns-resize' },       // bottom-center
  { x: bbox.x, y: bbox.y + bbox.h, cursor: 'nesw-resize' },                  // bottom-left
  { x: bbox.x, y: bbox.y + bbox.h / 2, cursor: 'ew-resize' },                // left-center
];

{handles.map((h, i) => (
  <rect
    key={i}
    x={h.x - handleHalfSize} y={h.y - handleHalfSize}
    width={handleSize} height={handleSize}
    fill="white" stroke="#4A90E2" strokeWidth={1}
    vectorEffect="non-scaling-stroke"
    style={{ cursor: h.cursor }}
    onPointerDown={(e) => startResize(e, i)}
  />
))}
```

Use `vector-effect="non-scaling-stroke"` on handle outlines so they stay visually consistent regardless of zoom. Handle size should be specified in viewBox units but use a constant visual size by dividing by the current scale factor.

### Canvas Mount/Unmount Lifecycle

**Confidence: HIGH** (standard React pattern + Fabric.js 5.5.2 dispose API)

```jsx
// EditCanvas component -- mounted conditionally based on active tool
function EditCanvas({ pageWidth, pageHeight, annotationsToLoad, onCommit }) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);

  useEffect(() => {
    // Mount: create Fabric canvas (5-15ms)
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: pageWidth,
      height: pageHeight,
      renderOnAddRemove: false,  // Batch rendering for perf
      selection: true,
    });
    fabricRef.current = canvas;

    // Load annotations if editing existing ones
    if (annotationsToLoad) {
      canvas.loadFromJSON(annotationsToLoad, () => canvas.renderAll());
    }

    // Unmount: dispose canvas
    return () => {
      canvas.dispose();  // Note: dispose() is async in Fabric.js 5.5.2
      fabricRef.current = null;
    };
  }, [pageWidth, pageHeight]);

  return <canvas ref={canvasRef} />;
}

// In parent component:
{activeToolRequiresCanvas && (
  <EditCanvas
    pageWidth={pageWidth}
    pageHeight={pageHeight}
    annotationsToLoad={editingAnnotation}
    onCommit={handleCommit}
  />
)}
```

**Known issue:** `canvas.dispose()` returns a Promise in Fabric.js 5.5.2 but React's `useEffect` cleanup function must be synchronous. The canvas ref is set to null immediately, and the async disposal completes in the background. This is safe because the DOM element is removed by React unmounting, and the dispose just cleans up event listeners and internal state.

### SVG-Canvas Coordinate Bridge

**Confidence: HIGH** (both systems use the same coordinate space)

The bridge is trivially simple because both SVG and Canvas operate in unscaled PDF page coordinates:

| System | Coordinate Space | How Set |
|--------|-----------------|---------|
| SVG layer | PDF page units (e.g., 612x792) | `viewBox="0 0 612 792"` |
| Fabric Canvas | PDF page units (e.g., 612x792) | `new fabric.Canvas(el, { width: 612, height: 792 })` |
| Fabric JSON | PDF page units | Stored as-is from Canvas |

**Screen-to-SVG conversion** (for pointer events):
```js
function screenToSVGCoords(svgElement, clientX, clientY) {
  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(svgElement.getScreenCTM().inverse());
}
```

**pathOffset handling** (critical for Fabric.js Path objects):
```jsx
// Fabric.js stores paths with pathOffset -- the offset from object center to path origin
// When rendering in SVG, apply negative pathOffset as inner translate
<g transform={`translate(${obj.left}, ${obj.top}) scale(${obj.scaleX}, ${obj.scaleY})`}>
  <path
    d={pathData}
    transform={`translate(${-(obj.pathOffset?.x || 0)}, ${-(obj.pathOffset?.y || 0)})`}
  />
</g>
```

Without pathOffset correction, paths render at incorrect positions. This is the #1 coordinate mismatch between Canvas and SVG rendering. The existing LightweightAnnotationOverlay does NOT handle pathOffset (listed as a known gap) -- the SVG display layer must.

---

## CSS Properties Required

| Property | Value | Purpose | Support |
|----------|-------|---------|---------|
| `vector-effect` | `non-scaling-stroke` | Stroke width stays constant regardless of zoom | Chrome all, Firefox 15+, Safari 5.1+, Electron |
| `pointer-events` | `auto` on `<g>`, `none` on `<svg>` root | Enable click-through on SVG root, clicks on individual annotations | Universal |
| `touch-action` | `none` on interactive SVG elements | Prevent browser interpreting drags as scroll/zoom on touch devices | Universal |
| `contain` | `layout style paint` on SVG wrapper div | Performance isolation from rest of page | Chrome 52+, Firefox 69+, Safari 15.4+ |

## Browser APIs Used (No Polyfills Needed)

| API | Purpose | Baseline |
|-----|---------|----------|
| `SVGSVGElement.createSVGPoint()` | Create point for coordinate transforms | Universal |
| `SVGElement.getScreenCTM()` | Get screen coordinate transform matrix | Universal |
| `DOMMatrix.inverse()` | Invert transform matrix for screen-to-SVG conversion | Universal |
| `SVGGeometryElement.isPointInFill()` | Precise hit testing on paths | July 2020+ |
| `SVGGeometryElement.isPointInStroke()` | Hit testing on strokes (unfilled paths) | July 2020+ |
| `PointerEvent` | Unified mouse/touch/pen events | Universal in target browsers |

---

## What NOT to Add

| Do NOT add | Why |
|------------|-----|
| SVG.js (`@svgdotjs/svg.js`) | Fights React DOM management; plugin ecosystem fragile across versions |
| interact.js (`interactjs`) | Bypasses React state; coordinate conversion in scaled SVG negates its value |
| subjx | Imperative DOM injection; low adoption; same code is trivial in React |
| D3.js (for drag) | Massive dependency for a feature that is 20 lines of pointer event code |
| react-draggable | HTML-focused; does not handle SVG coordinate systems |
| @dnd-kit (for SVG) | Already in deps for list DnD; NOT designed for SVG spatial manipulation |
| Snap.svg / Raphael | Legacy libraries, no React integration, abandoned |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| SVG rendering | React JSX (native) | SVG.js v3.2.5 | Imperative API fights React reconciliation; plugin compat issues |
| Drag/resize | Pointer events + React state | interact.js v1.10.27 | Screen-coord deltas useless inside scaled viewBox; stale maintenance |
| Hit testing | Native SVG pointer events + isPointInFill | Custom spatial index (quadtree) | Overkill for <500 annotations per page; native browser hit testing is faster |
| Selection handles | React-rendered SVG rects | subjx v1.1.2 | Injects own DOM; 50 lines of React code replaces entire library |
| Coordinate bridge | Shared viewBox coordinate space | Matrix transform library | Both systems already use same units; no conversion needed |

---

## Installation

```bash
# No new packages needed. Zero npm install commands.
# All capabilities come from native browser APIs + existing React + existing Fabric.js.
```

## Sources

- [SVG.js official docs](https://svgjs.dev/docs/3.2/manipulating/) -- evaluated v3.2.5 manipulating API
- [SVG.js plugin compatibility issues](https://github.com/svgdotjs/svg.js/issues/1031) -- select/resize plugin v3 problems
- [interact.js official site](https://interactjs.io/) -- evaluated drag/resize/gesture API
- [interact.js SVG coordinate issues](https://github.com/taye/interact.js/issues/202) -- drag after resize SVG bug
- [subjx GitHub](https://github.com/nichollascarter/subjx) -- evaluated drag/resize/rotate for SVG
- [MDN isPointInFill](https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/isPointInFill) -- browser compat baseline July 2020
- [MDN isPointInStroke](https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/isPointInStroke) -- browser compat baseline July 2020
- [MDN vector-effect](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect) -- non-scaling-stroke support
- [Scaling SVGs without scaling strokes (2025)](https://wildfirestudios.ca/blog/scaling-svgs-without-scaling-their-strokes-2025-edition/) -- practical non-scaling-stroke guide
- [Fabric.js pathOffset PR #5668](https://github.com/fabricjs/fabric.js/pull/5668/files) -- path coordinate handling
- [Fabric.js toSVG Part 3](https://fabricjs.com/docs/old-docs/fabric-intro-part-3/) -- SVG serialization docs
- [Fabric.js dispose in React issue #8899](https://github.com/fabricjs/fabric.js/issues/8899) -- unmount cleanup pattern
- [Fabric.js performance wiki](https://github.com/fabricjs/fabric.js/wiki/Optimizing-performance) -- renderOnAddRemove optimization
- [SVG viewBox zoom tutorial](https://thecompetentdev.com/weeklyjstips/tips/47_svg_viewbox_zoom/) -- viewBox scaling mechanics
- [Peter Collingridge SVG dragging tutorial](https://www.petercollingridge.co.uk/tutorials/svg/interactive/dragging/) -- native SVG drag pattern
- [SVG drag with React hooks gist](https://gist.github.com/hashrock/0e8f10d9a233127c5e33b09ca6883ff4) -- React + SVG pointer events
- Reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` -- confirms SVG overlay + viewBox pattern with Syncfusion
- Obsidian vault research: `CC-SVG Migration Research.md`, `CC-Architecture Overview.md` -- prior analysis
