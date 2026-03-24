# Phase 9: SVG Selection and Interaction - Research

**Researched:** 2026-03-24
**Domain:** SVG pointer-event-driven selection, drag, resize, rotate in React (no external interaction library)
**Confidence:** HIGH

## Summary

Phase 9 adds interactive selection, move, resize, and rotation to the existing SVG display layer (SVGAnnotationLayer.jsx, 306 lines) that was built in Phase 8. The phase operates entirely in SVG -- no Fabric.js Canvas is mounted for any interaction. The double-click to edit merely fires a signal (for Phase 10/11 to consume).

The core technical challenge is three-fold: (1) converting screen/DOM pointer coordinates into SVG viewBox coordinates via `getScreenCTM().inverse()`, (2) rendering selection handles (circles, pills, rotation icon) as SVG elements that remain constant pixel-size at every zoom level using inverse-scale transforms, and (3) updating Fabric.js JSON annotation properties (`left`, `top`, `scaleX`, `scaleY`, `angle`, `width`, `height`) on drag/resize/rotate end, then committing through the existing `handleSaveAnnotations` + `addHistoryCheckpoint` pipeline in App.jsx.

No new runtime dependencies are needed. React pointer events + native SVG coordinate APIs (`DOMPoint`, `getScreenCTM`, `matrixTransform`) cover all interaction math. The project explicitly forbids SVG.js and interact.js (Out of Scope in REQUIREMENTS.md) due to DOM conflicts with React reconciliation.

**Primary recommendation:** Build a `useSVGInteraction` custom hook that manages selection state, pointer capture, and coordinate transforms. The hook returns event handlers that SVGAnnotationLayer attaches to each annotation `<g>` wrapper and to the root `<svg>` element. On interaction end (pointerup), mutate the annotation JSON and call upward through `onSaveAnnotations(pageNumber, updatedJSON)` following the same pattern PAL uses today.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Selection appearance:** Replicate existing Fabric.js handle design in SVG (consistency between SVG display and Canvas edit modes)
- **Bounding box:** Dashed blue outline (`#4a90e2`, `dasharray: 4,4`, 2px border scale factor) -- matches current Fabric.js `borderColor` and `borderDashArray`
- **Corner handles (tl, tr, bl, br):** White filled circles, 14px, with subtle grey border (`#d1d1d1`) and drop shadow -- matches `renderCornerWithShadow` in `fabricCustomization.js`
- **Mid-edge handles (mt, mb):** Horizontal pills (rounded rects), white with shadow -- matches `renderPillControl`
- **Mid-edge handles (ml, mr):** Vertical pills, white with shadow -- matches `renderVerticalPillControl`
- **Rotation handle (mtr):** 24px white circle with rotation icon, positioned 40px above top edge -- matches `renderRotationControl`
- All handles remain constant size at all zoom levels (inverse-scale transform to compensate for viewBox scaling)
- **Hover state:** Subtle blue outline on hover (before click), plus `cursor: pointer` -- signals annotation is clickable
- **Drag & move:** Constrain annotations to page bounds, direct movement (no ghost), free movement (no snap)
- **Resize:** Free resize by default, hold Shift to lock aspect ratio
- **Persistence:** Changes commit to annotation JSON on drag/resize end (mouse release), not during drag
- **Undo:** One undo checkpoint per completed move or resize operation via existing `addHistoryCheckpoint` / `handleSaveAnnotations`
- **Supabase sync:** Debounced 2-3 seconds after local commit (existing pattern)
- **Undo system unchanged:** Full-page snapshot approach (`undoHistory` state in App.jsx, 50-checkpoint cap)

### Claude's Discretion
- SVG event handling approach (native pointer events vs. React synthetic events)
- Transform math implementation (matrix calculations for resize, rotation)
- How to implement constant-size handles (SVG `transform` with inverse scale vs. recalculating pixel sizes)
- Multi-select implementation details (shift-click tracking, group bounding box calculation)
- Hit-testing approach for overlapping annotations (z-order, topmost wins)

### Deferred Ideas (OUT OF SCOPE)
- Snap-to-grid / snap-to-alignment during drag -- tracked as ADVN-02
- Keyboard shortcuts for annotation operations (delete, copy, paste, nudge) -- tracked as ADVN-01
- Annotation grouping/ungrouping -- tracked as ADVN-03
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTR-01 | Click annotation to select (visual highlight) | Pointer event on `<g>` wrapper; selection state in hook; bounding box + dashed border overlay |
| INTR-02 | Selected annotation shows resize handles at corners and midpoints | 8 SVG handle elements (4 corner circles, 4 edge pills) positioned at bounding box points |
| INTR-03 | Handles remain constant size during zoom | Inverse-scale transform using `1/currentScale` computed from viewBox vs. container size |
| INTR-04 | Drag selected annotation to reposition (pointer events, no Canvas) | `pointerdown` + `setPointerCapture` + `pointermove` delta in viewBox coords + `pointerup` commit |
| INTR-05 | Drag resize handles to scale annotation | Handle-specific drag logic updating `scaleX`/`scaleY` (or `width`/`height`) with optional Shift lock |
| INTR-06 | Rotate annotation via rotation handle | Rotation handle drag computes angle from center; updates `angle` property |
| INTR-07 | Multi-select via shift-click, group selection highlight | `selectedIds` Set in state; group bounding box computed as union of individual boxes |
| INTR-08 | Drag/delete multiple selected annotations as group | Group move applies delta to all; delete removes all from `objects[]` array |
| INTR-09 | Click empty space deselects all | `pointerdown` on root `<svg>` with no target clears selection |
| INTR-10 | Double-click transitions to Canvas edit mode | `onDoubleClick` on annotation `<g>` fires callback prop (actual Canvas mount is Phase 10/11) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component model, state, refs, memo | Already in project |
| Native SVG APIs | Browser built-in | `getScreenCTM()`, `DOMPoint`, `matrixTransform()` | Zero-dependency coordinate transforms |
| Native Pointer Events | Browser built-in | `pointerdown`, `pointermove`, `pointerup`, `setPointerCapture` | Unified mouse/touch, no library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Fabric.js | 5.5.2 (existing) | JSON data model definition (not used at runtime in SVG mode) | Reference only -- annotation JSON schema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native pointer events | interact.js | Explicitly forbidden in REQUIREMENTS.md -- DOM conflict with React |
| Native pointer events | SVG.js | Explicitly forbidden in REQUIREMENTS.md -- DOM conflict with React |
| Custom hook | react-draggable-svg | Tiny lib, but adds dependency for simple pattern; doesn't handle resize/rotate |
| Manual SVG handles | @panzoom/panzoom | Wrong abstraction -- viewport zoom, not object selection handles |

**Installation:**
```bash
# No new packages needed -- all browser-native APIs
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── components/
│   ├── SVGAnnotationLayer.jsx     # Modified: add pointer events, selection overlay, hover
│   └── SVGSelectionOverlay.jsx    # NEW: renders bounding box + handles for selected annotations
├── hooks/
│   └── useSVGInteraction.js       # NEW: selection state, drag/resize/rotate logic, coordinate transforms
├── utils/
│   ├── svgAnnotationRenderers.jsx # Modified: wrap each annotation in <g> with data attrs for hit-testing
│   ├── svgBoundingBox.js          # NEW: compute bounding boxes from Fabric.js JSON objects
│   ├── svgHandlePositions.js      # NEW: compute 8 handle + rotation handle positions for a given bbox + angle
│   └── svgTransformMath.js        # NEW: coordinate conversion, rotation math, constrain-to-page
└── assets/
    └── rotate-icon.svg            # Existing: reuse for rotation handle
```

### Pattern 1: Pointer Event Lifecycle with setPointerCapture
**What:** Use `setPointerCapture` on `pointerdown` to keep receiving `pointermove`/`pointerup` even when cursor leaves the element. This is essential for drag operations.
**When to use:** Every drag interaction (move, resize, rotate).
**Example:**
```jsx
// Source: MDN Pointer Events + verified pattern from hashrock gist
const handlePointerDown = (e) => {
  e.target.setPointerCapture(e.pointerId);
  e.stopPropagation(); // prevent SVG background from receiving this
  const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
  setDragState({
    active: true,
    startX: svgPoint.x,
    startY: svgPoint.y,
    originalLeft: annotation.left,
    originalTop: annotation.top,
  });
};

const handlePointerMove = (e) => {
  if (!dragState.active) return;
  const svgPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
  const dx = svgPoint.x - dragState.startX;
  const dy = svgPoint.y - dragState.startY;
  // Update visual position only (no data mutation)
  setVisualOffset({ x: dx, y: dy });
};

const handlePointerUp = (e) => {
  if (!dragState.active) return;
  // Commit: mutate annotation JSON and save
  commitMove(dx, dy);
  setDragState({ active: false });
};
```

### Pattern 2: Screen-to-SVG Coordinate Conversion
**What:** Convert DOM `clientX`/`clientY` to SVG viewBox coordinates using `getScreenCTM().inverse()`.
**When to use:** Every pointer event handler that needs to compute positions in annotation space.
**Example:**
```javascript
// Source: MDN SVG Coordinate Systems, David Hamann article
function screenToSVG(svgElement, clientX, clientY) {
  const point = new DOMPoint(clientX, clientY);
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY }; // fallback
  const inverseCTM = ctm.inverse();
  const svgPoint = point.matrixTransform(inverseCTM);
  return { x: svgPoint.x, y: svgPoint.y };
}
```

### Pattern 3: Constant-Size Handles via Inverse Scale
**What:** Handles must appear the same pixel size regardless of zoom. Since the SVG uses `viewBox`, all content scales with zoom. Handles need an inverse scale transform.
**When to use:** Every handle element (corners, pills, rotation).
**Example:**
```jsx
// Source: SVG viewBox spec + verified approach
// currentScale = containerWidth / viewBoxWidth (derived from SVG element measurement)
const handleSize = 14; // desired pixel size
const inverseScale = 1 / currentScale;

<circle
  cx={handleX} cy={handleY}
  r={handleSize * inverseScale / 2}
  fill="white" stroke="#d1d1d1" strokeWidth={1 * inverseScale}
  style={{ filter: `drop-shadow(0 ${1 * inverseScale}px ${3 * inverseScale}px rgba(0,0,0,0.15))` }}
/>
```

### Pattern 4: Visual-Only Updates During Drag (No Data Mutation)
**What:** During drag/resize/rotate, only update a `transform` attribute on the annotation `<g>` wrapper. Do NOT mutate annotation data until `pointerup`.
**When to use:** All drag interactions.
**Why:** Avoids expensive re-renders of the entire annotation list. The `useMemo` in SVGAnnotationLayer depends on `annotations.objects` -- mutating during drag would trigger full recalculation on every pointer move frame.
**Example:**
```jsx
// During drag: apply temporary visual transform
<g
  transform={isDragging ? `translate(${visualOffset.x}, ${visualOffset.y})` : ''}
  style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
>
  {renderAnnotation(obj)}
</g>
```

### Pattern 5: Bounding Box Computation from Fabric.js JSON
**What:** Compute axis-aligned bounding box (AABB) from Fabric.js object properties for selection overlay positioning.
**When to use:** Selection highlight rendering, resize handle positioning, hit-testing.
**Example:**
```javascript
// Source: Fabric.js JSON schema analysis from existing codebase
function getAnnotationBBox(obj) {
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const width = (obj.width ?? 0) * (obj.scaleX ?? 1);
  const height = (obj.height ?? 0) * (obj.scaleY ?? 1);
  const angle = obj.angle ?? 0;

  if (angle === 0) {
    return { x: left, y: top, width, height, angle: 0 };
  }

  // For rotated objects: return the OBB (oriented bounding box)
  // Handles use corners of the rotated box, not the AABB
  return { x: left, y: top, width, height, angle };
}
```

### Anti-Patterns to Avoid
- **Mutating annotation JSON during drag:** Triggers expensive `useMemo` recalculation in SVGAnnotationLayer on every frame. Use visual-only transform during drag, commit on pointerup.
- **Using React state for per-frame drag position:** `setState` on every `pointermove` causes a React render per frame. Use refs for the drag offset and imperatively update the DOM transform attribute during drag, or use `requestAnimationFrame` batching.
- **Adding pointer events to individual SVG primitives (path, rect, etc.):** Instead, wrap each annotation in a `<g>` with pointer events on the group. This simplifies hit-testing and allows a single invisible hit-area rect behind complex shapes (like pen strokes).
- **Ignoring pathOffset in hit-testing:** Pen stroke annotations have a `pathOffset` that shifts the visual rendering. The bounding box must account for this offset to correctly determine clickability.
- **Modifying zoom/scale system in App.jsx:** CLAUDE.md explicitly forbids this. SVG viewBox handles zoom automatically -- no touch needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Screen-to-SVG coordinate conversion | Manual math with container offsets and scale | `getScreenCTM().inverse()` + `DOMPoint.matrixTransform()` | Accounts for all CSS transforms, scroll, zoom, viewBox automatically |
| Pointer capture during drag | Manual window-level event listeners | `element.setPointerCapture(pointerId)` | Handles cursor leaving element, touch events, pen input |
| Undo checkpoints | Custom undo system | Existing `addHistoryCheckpoint` in App.jsx | Full-page snapshot with 50-cap, already works, tested |
| Supabase sync | Custom sync logic | Existing `handleSaveAnnotations` pipeline | Already handles debounce, RLS errors, structural errors |
| Annotation JSON structure | New data model | Existing Fabric.js JSON `{ objects: [...] }` | Same format used by Canvas mode; no migration needed |

**Key insight:** The entire persistence pipeline (local state update -> undo checkpoint -> localStorage save -> Supabase sync) already exists in App.jsx. Phase 9 just needs to produce updated annotation JSON and pass it through `handleSaveAnnotations(pageNumber, updatedJSON, saveContext)`, which is already a prop (`onSaveAnnotations`) available to SVGAnnotationLayer.

## Common Pitfalls

### Pitfall 1: viewBox Coordinate Mismatch
**What goes wrong:** Pointer event `clientX`/`clientY` are in screen pixels, but SVG elements are positioned in viewBox coordinates (e.g., 0-612 for a US Letter page). A naive `e.clientX - rect.left` gives wrong results when zoom changes.
**Why it happens:** The viewBox creates a coordinate transform between screen and SVG space that scales non-linearly when the container is resized.
**How to avoid:** Always use `getScreenCTM().inverse()` to convert pointer positions. Cache the CTM at the start of a drag (it won't change during a single drag operation since zoom is not happening simultaneously).
**Warning signs:** Annotations jump to wrong positions on drag start, or drag distance is wrong at different zoom levels.

### Pitfall 2: Stale Refs During Pointer Capture
**What goes wrong:** If drag handlers reference React state directly, they see stale values because `setPointerCapture` keeps the same handler reference throughout the drag.
**Why it happens:** Pointer capture doesn't re-bind the event handler when state changes.
**How to avoid:** Use refs for all values that change during drag (drag offset, current position). Only read state at drag start and write state at drag end.
**Warning signs:** Drag position lags behind cursor, or snaps back to old position.

### Pitfall 3: Path Annotations Have Non-Standard Bounding Boxes
**What goes wrong:** Path annotations (pen strokes, highlighters) use `pathOffset` to shift the visual rendering. Computing bounding box from just `left`/`top`/`width`/`height` gives wrong results.
**Why it happens:** Fabric.js paths store their origin differently from shapes. The `pathOffset.x`/`pathOffset.y` values shift where the path data renders relative to `left`/`top`.
**How to avoid:** For paths, the bounding box calculation must account for pathOffset: the visual top-left is at `(left - pathOffset.x * scaleX, top - pathOffset.y * scaleY)` approximately. However, for selection/move purposes, just using `left`/`top` as the drag anchor and applying delta works fine -- the pathOffset transform is baked into the SVG render.
**Warning signs:** Selection highlight appears offset from the actual pen stroke visual.

### Pitfall 4: Resize Changes Different Properties Per Type
**What goes wrong:** Shapes (rect, ellipse) can resize by changing `width`/`height` OR by changing `scaleX`/`scaleY`. Mixing approaches causes inconsistency with how Canvas mode serializes them.
**Why it happens:** Fabric.js uses `scaleX`/`scaleY` during interactive transforms, and the JSON stores these scale factors. The actual rendered size is `width * scaleX`.
**How to avoid:** During SVG resize, update `scaleX`/`scaleY` (not `width`/`height`). This matches what Fabric.js does during Canvas-mode resize, keeping the JSON consistent.
**Warning signs:** Annotation appears correct in SVG mode but wrong size when switching to Canvas edit mode.

### Pitfall 5: Rotation Handle Angle Calculation
**What goes wrong:** Rotation angle wraps incorrectly, producing negative angles or angles > 360, which then look wrong in both SVG and Canvas.
**Why it happens:** `Math.atan2` returns -PI to PI. Fabric.js stores angles in degrees (0-360).
**How to avoid:** Normalize: `angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 90 + 360) % 360`. The +90 is because rotation is measured from 12-o'clock (top) in Fabric.js, not from 3-o'clock (right) like atan2.
**Warning signs:** Annotation snaps to unexpected angle when rotation starts, or angle wraps incorrectly across 0/360 boundary.

### Pitfall 6: Multi-Select Group Move Precision
**What goes wrong:** Moving multiple selected annotations causes them to drift apart over successive moves.
**Why it happens:** Floating-point accumulation when applying the same delta to each object's `left`/`top`.
**How to avoid:** On drag start, record the original `left`/`top` of every selected annotation. On each move frame, compute new positions as `original + totalDelta` (not `current + frameDelta`).
**Warning signs:** Selected annotations slowly spread apart after repeated group moves.

### Pitfall 7: pointerEvents: 'none' on Root SVG
**What goes wrong:** The current SVGAnnotationLayer root `<svg>` has `pointerEvents: 'none'` in its inline style. Adding click handlers won't work.
**Why it happens:** Phase 8 set this intentionally for display-only mode -- annotations shouldn't block clicks on the PDF viewer underneath.
**How to avoid:** Change to `pointerEvents: 'auto'` when in selection/interaction mode, and `'none'` only when a drawing tool is active (so clicks pass through to Canvas in future phases). This is a controlled change on the SVG element only.
**Warning signs:** Clicks on annotations do nothing, no hover cursor change.

## Code Examples

Verified patterns from the existing codebase and official sources:

### Coordinate Conversion (Screen to ViewBox)
```javascript
// Source: MDN getScreenCTM, DOMPoint API
// This is the critical utility for all pointer interactions
function screenToSVG(svgEl, clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return pt.matrixTransform(ctm.inverse());
}
```

### Selection Overlay with Constant-Size Handles
```jsx
// Source: fabricCustomization.js handle specs + SVG inverse-scale pattern
const SVGSelectionOverlay = ({ bbox, angle, inverseScale, onHandleDrag }) => {
  const { x, y, width, height } = bbox;
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Handle positions relative to bbox
  const handles = [
    { id: 'tl', hx: x, hy: y },
    { id: 'tr', hx: x + width, hy: y },
    { id: 'bl', hx: x, hy: y + height },
    { id: 'br', hx: x + width, hy: y + height },
    { id: 'mt', hx: cx, hy: y },
    { id: 'mb', hx: cx, hy: y + height },
    { id: 'ml', hx: x, hy: cy },
    { id: 'mr', hx: x + width, hy: cy },
  ];

  return (
    <g transform={`rotate(${angle}, ${cx}, ${cy})`}>
      {/* Dashed bounding box */}
      <rect
        x={x} y={y} width={width} height={height}
        fill="none" stroke="#4a90e2"
        strokeWidth={2 * inverseScale}
        strokeDasharray={`${4 * inverseScale},${4 * inverseScale}`}
        vectorEffect="non-scaling-stroke"
      />
      {/* Corner handles: 14px circles */}
      {handles.filter(h => ['tl','tr','bl','br'].includes(h.id)).map(h => (
        <circle
          key={h.id}
          cx={h.hx} cy={h.hy}
          r={7 * inverseScale}
          fill="white" stroke="#d1d1d1"
          strokeWidth={1 * inverseScale}
          style={{ cursor: getCursorForHandle(h.id, angle) }}
          onPointerDown={(e) => onHandleDrag(e, h.id)}
        />
      ))}
      {/* Mid-edge horizontal pills (mt, mb) */}
      {handles.filter(h => ['mt','mb'].includes(h.id)).map(h => (
        <rect
          key={h.id}
          x={h.hx - 18 * inverseScale} y={h.hy - 5 * inverseScale}
          width={36 * inverseScale} height={10 * inverseScale}
          rx={5 * inverseScale}
          fill="white" stroke="#d1d1d1"
          strokeWidth={1 * inverseScale}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={(e) => onHandleDrag(e, h.id)}
        />
      ))}
      {/* Mid-edge vertical pills (ml, mr) */}
      {handles.filter(h => ['ml','mr'].includes(h.id)).map(h => (
        <rect
          key={h.id}
          x={h.hx - 5 * inverseScale} y={h.hy - 18 * inverseScale}
          width={10 * inverseScale} height={36 * inverseScale}
          rx={5 * inverseScale}
          fill="white" stroke="#d1d1d1"
          strokeWidth={1 * inverseScale}
          style={{ cursor: 'ew-resize' }}
          onPointerDown={(e) => onHandleDrag(e, h.id)}
        />
      ))}
      {/* Rotation handle: 24px circle, 40px above top */}
      <g>
        <line
          x1={cx} y1={y} x2={cx} y2={y - 40 * inverseScale}
          stroke="#d1d1d1" strokeWidth={1 * inverseScale}
        />
        <circle
          cx={cx} cy={y - 40 * inverseScale}
          r={12 * inverseScale}
          fill="white" stroke="#e0e0e0"
          strokeWidth={1 * inverseScale}
          style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => onHandleDrag(e, 'mtr')}
        />
        {/* Rotation icon via <image> or inline SVG paths */}
      </g>
    </g>
  );
};
```

### Data Mutation on Interaction End
```javascript
// Source: existing handleSaveAnnotations pattern in App.jsx (line 22588)
// Called on pointerup after drag/resize/rotate completes
function commitAnnotationChange(pageNumber, annotationIndex, updates, onSaveAnnotations, addHistoryCheckpoint) {
  // 1. Create checkpoint BEFORE making changes
  addHistoryCheckpoint('annotations:svg-interaction', {
    pageNumber,
    source: 'svg:object-modified',
    action: updates.action // 'move', 'scale', 'rotate'
  });

  // 2. Deep clone annotations and apply updates
  const updatedAnnotations = JSON.parse(JSON.stringify(currentAnnotations));
  const obj = updatedAnnotations.objects[annotationIndex];
  if (updates.left !== undefined) obj.left = updates.left;
  if (updates.top !== undefined) obj.top = updates.top;
  if (updates.scaleX !== undefined) obj.scaleX = updates.scaleX;
  if (updates.scaleY !== undefined) obj.scaleY = updates.scaleY;
  if (updates.angle !== undefined) obj.angle = updates.angle;

  // 3. Save through existing pipeline
  onSaveAnnotations(pageNumber, updatedAnnotations, {
    source: 'object:modified',
    action: updates.action,
    checkpointPolicy: 'skip' // checkpoint already added above
  });
}
```

### Hit-Testing with Invisible Rect Behind Complex Shapes
```jsx
// Source: verified SVG interaction pattern
// For paths (pen strokes), the actual <path> shape is very thin.
// Add an invisible wider hit-area rect behind it.
<g data-annotation-index={index} data-annotation-id={obj.id}>
  {/* Invisible hit area -- wider than the visible stroke */}
  <rect
    x={bbox.x} y={bbox.y}
    width={bbox.width} height={bbox.height}
    fill="transparent"
    stroke="none"
    style={{ pointerEvents: 'fill', cursor: isSelected ? 'move' : 'pointer' }}
    onPointerDown={handleAnnotationPointerDown}
    onDoubleClick={handleAnnotationDoubleClick}
  />
  {/* Visible annotation render */}
  {renderAnnotation(obj, index)}
</g>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mouse events + manual coordinate math | Pointer events + setPointerCapture | Pointer Events Level 2 (2020+) | Unified mouse/touch/pen; capture survives leaving element |
| `createSVGPoint()` + `getScreenCTM()` | `new DOMPoint()` + `getScreenCTM()` | DOMPoint replaces SVGPoint (2020+) | `createSVGPoint` is deprecated; `DOMPoint` is the standard |
| SVG.js / D3 for interaction | Native SVG + React pointer events | React 17+ with pointer event support | Zero dependencies; React handles event delegation |
| Fabric.js toSVG() for rendering | Custom JSON-to-SVG renderers | Project decision (Phase 8) | Avoids Fabric.js text positioning bugs |

**Deprecated/outdated:**
- `SVGElement.createSVGPoint()`: Deprecated in favor of `new DOMPoint()`. Still works but should use DOMPoint.
- `mousedown`/`mousemove`/`mouseup`: Pointer events are the modern replacement. Pointer events handle touch and pen in addition to mouse.

## Open Questions

1. **Arrow group bounding box computation**
   - What we know: Arrows are Fabric.js groups (`type: 'group'`) containing a line child and optional triangle arrowhead. The group has `left`, `top`, `width`, `height`, `scaleX`, `scaleY`.
   - What's unclear: Whether group-level `width`/`height` reliably represent the visual bounds, or if we need to compute from children.
   - Recommendation: Start with group-level properties; validate visually during implementation. If bounds are wrong, compute from line endpoint coordinates.

2. **Callout annotation selection semantics**
   - What we know: Callouts have separate elements (arrowTip, knee, textBox) and are stored separately from the `annotations.objects` array. They use normalized (0-1) coordinates.
   - What's unclear: Whether selecting a callout means selecting the whole callout or individual parts. How drag should work (move whole callout? move just the text box?).
   - Recommendation: Treat callout as a single selectable unit. Drag moves the entire callout (all three points by the same delta). Advanced per-handle editing deferred to Canvas edit mode.

3. **Performance with many annotations**
   - What we know: Pages can have 400+ annotation objects (MAX_PREVIEW_OBJECTS = 420 in current code). Each wrapped in a `<g>` with event handlers.
   - What's unclear: Whether 420 individual pointer event listeners cause performance issues.
   - Recommendation: Use event delegation on the root `<svg>` element and identify target annotations via `data-annotation-index` attributes. This avoids per-element listener overhead.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (existing, in `debug/` directory) + Node test runner (existing, in `tests/`) |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npm test` (Node test runner for unit tests) |
| Full suite command | `npm run test:debug` (Playwright e2e, requires dev server) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTR-01 | Click annotation selects it | e2e | `npx playwright test --config debug/playwright.config.mjs debug/scenarios/svg-selection.spec.mjs` | No -- Wave 0 |
| INTR-02 | Selected shows resize handles | e2e | Same spec as INTR-01 | No -- Wave 0 |
| INTR-03 | Handles constant size at zoom | e2e | Same spec, zoom then screenshot compare | No -- Wave 0 |
| INTR-04 | Drag to reposition | e2e | `npx playwright test ... svg-drag.spec.mjs` | No -- Wave 0 |
| INTR-05 | Resize via handles | e2e | Same spec as INTR-04 | No -- Wave 0 |
| INTR-06 | Rotate via handle | e2e | Same spec as INTR-04 | No -- Wave 0 |
| INTR-07 | Multi-select shift-click | e2e | `npx playwright test ... svg-multiselect.spec.mjs` | No -- Wave 0 |
| INTR-08 | Group drag/delete | e2e | Same spec as INTR-07 | No -- Wave 0 |
| INTR-09 | Click empty deselects | e2e | Same spec as INTR-01 | No -- Wave 0 |
| INTR-10 | Double-click edit trigger | e2e | Same spec as INTR-01 | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** Manual visual verification in dev server (interaction is inherently visual)
- **Per wave merge:** Full Playwright e2e suite green
- **Phase gate:** All 10 INTR requirements verified via Playwright before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `debug/scenarios/svg-selection.spec.mjs` -- covers INTR-01, INTR-02, INTR-03, INTR-09, INTR-10
- [ ] `debug/scenarios/svg-drag.spec.mjs` -- covers INTR-04, INTR-05, INTR-06
- [ ] `debug/scenarios/svg-multiselect.spec.mjs` -- covers INTR-07, INTR-08
- [ ] `tests/svgBoundingBox.test.mjs` -- unit tests for bbox computation from Fabric.js JSON
- [ ] `tests/svgTransformMath.test.mjs` -- unit tests for coordinate conversion, angle normalization

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/components/SVGAnnotationLayer.jsx` (306 lines, Phase 8 foundation)
- Existing codebase: `src/utils/fabricCustomization.js` (283 lines, handle design specs)
- Existing codebase: `src/utils/svgAnnotationRenderers.jsx` (435 lines, render functions)
- Existing codebase: `src/App.jsx` lines 14390-15118 (undo system), 22588-22744 (handleSaveAnnotations)
- [MDN - SVG transform attribute](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/transform)
- [W3C SVG Coordinate Systems](https://www.w3.org/TR/SVGTiny12/coords.html)

### Secondary (MEDIUM confidence)
- [David Hamann - SVG viewport to element coordinates](https://davidhamann.de/2023/01/13/svg-javascript-transform-viewport-to-element-coordinates/) -- getScreenCTM inverse pattern
- [w3tutorials - SVG coordinate transform matrix for drag/resize after rotation](https://www.w3tutorials.net/blog/svg-coordinates-with-transform-matrix/) -- inverse matrix for rotated elements
- [hashrock gist - SVG drag and drop with React hooks](https://gist.github.com/hashrock/0e8f10d9a233127c5e33b09ca6883ff4) -- setPointerCapture pattern
- [Peter Collingridge - Draggable SVG elements](https://www.petercollingridge.co.uk/tutorials/svg/interactive/dragging/) -- fundamental SVG drag tutorial

### Tertiary (LOW confidence)
- [Smashing Magazine - SVG Pointer Events Property](https://www.smashingmagazine.com/2018/05/svg-interaction-pointer-events-property/) -- pointer-events CSS property reference (2018, still accurate)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all browser-native APIs well-documented and stable
- Architecture: HIGH - Pattern directly follows existing codebase conventions (hook + component + utility)
- Pitfalls: HIGH - Identified from codebase analysis (pathOffset, pointerEvents: none, coordinate systems) and verified with external sources
- Handle design: HIGH - Exact specs extracted from fabricCustomization.js (lines 192-283)
- Transform math: MEDIUM - Rotation and resize formulas verified with multiple sources but need validation against Fabric.js-specific JSON quirks
- Multi-select group operations: MEDIUM - Pattern is straightforward but callout handling has open questions

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable domain -- SVG and Pointer Events APIs are mature)
