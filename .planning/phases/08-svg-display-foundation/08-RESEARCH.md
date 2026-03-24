# Phase 8: SVG Display Foundation - Research

**Researched:** 2026-03-23
**Domain:** SVG annotation rendering from Fabric.js JSON, React component architecture, browser-native zoom via viewBox
**Confidence:** HIGH

## Summary

Phase 8 replaces Canvas-based annotation display with SVG elements inside a single `<svg viewBox>` per page. The existing `LightweightAnnotationOverlay.jsx` (505 lines) already renders paths, lines, arrows, and callouts as SVG -- it is the 80% starting point. The remaining work is: (1) adding viewBox-based coordinate system instead of manual JavaScript scaling, (2) implementing pathOffset handling for correct pen/highlighter positioning, (3) adding highlight blend mode, (4) implementing text via foreignObject, (5) adding eraser support (erased paths already have modified path data in JSON -- no separate clipPath needed), (6) porting the full three-layer visibility/filtering logic from PAL, and (7) wiring up the renderer toggle.

The key architectural insight: SVG viewBox eliminates all JavaScript zoom coordination. When `<svg viewBox="0 0 612 792" width="100%" height="100%">` is placed inside the overlay div that already tracks Syncfusion page dimensions (from v1.0 Phase 3), the browser handles all scaling automatically. Annotations are stored and rendered in unscaled PDF page coordinates. `vector-effect="non-scaling-stroke"` keeps stroke widths constant at any zoom level.

**Primary recommendation:** Evolve LightweightAnnotationOverlay into SVGAnnotationLayer as a new component, keeping the existing overlay as-is for fallback during the toggle period. Use a single root `<svg>` with viewBox per page, render all annotation types as direct SVG children, and port the three-layer filtering logic from PAL lines ~8625-8810.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Positionally exact: annotations must appear at correct positions, sizes, and colors matching Canvas output
- Minor differences in anti-aliasing, text kerning, or sub-pixel rendering are acceptable
- NOT pixel-perfect -- effort should focus on correctness, not matching Canvas compositing artifacts
- Highlights must use `mix-blend-mode: multiply` in SVG (same blend mode as Canvas)
- Text annotations via foreignObject: minor word-wrap/line-break differences from Fabric IText are acceptable as long as content, position, font/size/color are correct
- Eraser clipPaths must work correctly in Phase 8 -- erased annotations are common enough that broken rendering would be noticeable
- Side-by-side toggle: keep both SVG and Canvas rendering available during development
- Toggle mechanism: URL parameter (`?renderer=svg` / `?renderer=canvas`) sets default, keyboard shortcut (e.g., Ctrl+Shift+V) toggles on the fly
- When SVG mode is active, PAL (PageAnnotationLayer) does NOT mount -- saves ~44MB per visible page in Canvas memory
- When Canvas mode is active (toggle or default), PAL mounts normally as current behavior
- Toggle persists through all v2.0 phases (8-11), removed in final cleanup after v2.0 completion
- Priority tier 1 (most used): pen strokes, highlights, callouts, lines/arrows
- Priority tier 2: shapes, standalone text
- Build order: priority types working across all pages first, then add tier 2 types
- Current test PDF ("Package 2 - Rev 4 -- IC.pdf") only has highlights and pen strokes
- Missing types (lines, arrows, callouts, shapes, text) need to be created before full verification
- Test data creation approach: Claude's discretion (script or manual)

### Claude's Discretion
- SVGAnnotationLayer component architecture (new component vs. evolving LightweightAnnotationOverlay)
- Exact keyboard shortcut for renderer toggle
- Test data creation approach (scripted vs. manual setup instructions)
- Build sequence within each tier (e.g., pen before highlights, or together)
- SVG element structure (single root `<svg viewBox>` vs. grouped `<g>` elements)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISP-01 | All 7 annotation types render as SVG elements in SVGAnnotationLayer | Architecture pattern: single SVG root with type-specific renderers; existing overlay covers paths/lines/arrows/callouts already |
| DISP-02 | SVG viewBox matches PDF page dimensions, auto-scales with zoom | viewBox pattern: `viewBox="0 0 pageWidth pageHeight"` with `width="100%" height="100%"` on overlay div; zero JS needed |
| DISP-03 | Fabric.js path objects render with correct pathOffset handling | pathOffset transform pattern: `translate(left, top) scale(scaleX, scaleY) translate(-pathOffset.x, -pathOffset.y)`; verified against PAL lines 2920-2932 |
| DISP-04 | strokeUniform renders as SVG non-scaling-stroke | `vector-effect="non-scaling-stroke"` -- 92% browser support, all target browsers (Chrome, Firefox 15+, Safari 5.1+, Electron) |
| DISP-05 | Highlights render with correct opacity and mix-blend-mode: multiply | SVG `<rect>` with `style="mix-blend-mode: multiply"` and opacity from Fabric.js JSON |
| DISP-06 | Eraser clipPaths render correctly | Key finding: eraser uses boolean path subtraction (booleanErasePath), modifying path data directly in JSON. Erased paths are stored with modified `path` commands and `fill` instead of `stroke`. SVG renders them as-is -- no separate clipPath logic needed |
| DISP-07 | Text annotations render via foreignObject | `<foreignObject>` with HTML div inside; font family, size, weight, color, and word-wrap from Fabric.js textbox/i-text JSON |
| DISP-08 | Callout annotations render as SVG lines + rect + text | Existing overlay already renders callout lines, knee, circle, rect. Add text via foreignObject inside the rect. Use `calculateCalloutConnection()` utility |
| DISP-09 | Arrow annotations render with correct arrowhead geometry | Existing overlay renders arrows as line + polygon. Geometry is in Fabric.js group > line + triangle children |
| DISP-10 | Region/space filtering works in SVG layer | Must port three-layer visibility logic from PAL lines ~8625-8810: base layer (no moduleId/regionId), middle layer (moduleId), top layer (regionId), lightbulb toggle |
| DISP-11 | SVGAnnotationLayer replaces LightweightAnnotationOverlay | Toggle mechanism: URL param + keyboard shortcut; when SVG active, LightweightAnnotationOverlay unmounts, PAL does NOT mount |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | (existing) | Component rendering, memo, useMemo | Already in project |
| SVG (browser-native) | SVG 1.1/2.0 | Annotation display with viewBox | Zero dependency, browser-native zoom scaling |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `calculateCalloutConnection()` | (existing utility) | Callout line geometry | Every callout render |
| `geometryEraser.js` | (existing utility) | NOT needed for display | Erased data already baked into JSON |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SVG in React | SVG.js / D3.js | DOM conflict with React reconciliation; adds dependency; violates zero-new-deps constraint |
| foreignObject for text | SVG `<text>` + manual line breaking | No word-wrap in SVG text; would need to manually split lines -- foreignObject is simpler and supports full CSS |
| Fabric.js `toSVG()` | N/A | Documented text positioning bugs (from PROJECT.md Out of Scope); custom JSON-to-SVG is more reliable |

**Installation:**
```bash
# No new dependencies needed -- zero new runtime dependencies is a project constraint
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  components/
    SVGAnnotationLayer.jsx          # NEW: Main SVG display component (~400-600 lines)
    LightweightAnnotationOverlay.jsx # EXISTING: Kept as fallback during toggle period
  utils/
    calloutGeometry.js               # EXISTING: Reused for callout rendering
    svgAnnotationRenderers.js        # NEW: Type-specific SVG render functions
```

### Pattern 1: Single SVG Root with viewBox
**What:** One `<svg>` element per page with viewBox matching PDF page dimensions. All annotations rendered as children.
**When to use:** Always -- this is the core pattern for Phase 8.
**Why:** Eliminates all JavaScript zoom coordination. The browser scales everything automatically.
**Example:**
```jsx
// Source: MDN viewBox docs + project architecture decision
const SVGAnnotationLayer = memo(({ pageNumber, width, height, annotations, callouts, ...filterProps }) => {
  // width/height are unscaled PDF page dimensions (e.g., 612x792 for letter)
  // The parent overlay div already tracks Syncfusion page size from v1.0 Phase 3
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        overflow: 'hidden'
      }}
      preserveAspectRatio="none"
    >
      {/* All annotation elements rendered here in unscaled page coordinates */}
    </svg>
  );
});
```

**Critical detail on preserveAspectRatio:** Use `"none"` because the overlay div is sized to exactly match the Syncfusion page div (which may have non-standard aspect ratios due to Electron zoom factor). The container-aware sizing gotcha from CLAUDE.md (2026-03-22) means the overlay div dimensions already account for the Electron/browser zoom factor mismatch. With `preserveAspectRatio="none"`, the SVG stretches to fill the overlay div exactly, and since the overlay div matches the actual rendered page size, coordinates map correctly.

### Pattern 2: Fabric.js JSON to SVG Transform Pipeline
**What:** Convert Fabric.js object properties to SVG attributes using a transform chain.
**When to use:** Every annotation object render.
**Key transforms:**
```
Fabric.js JSON object:
  { type, left, top, width, height, scaleX, scaleY, angle,
    path, pathOffset, stroke, fill, strokeWidth, strokeUniform,
    opacity, globalCompositeOperation, ... }

SVG rendering:
  1. Position: transform="translate(left, top)"
  2. Scale: scale(scaleX, scaleY)  -- only for paths
  3. Rotation: rotate(angle)
  4. Path offset: translate(-pathOffset.x, -pathOffset.y)  -- paths only
  5. Stroke uniform: vector-effect="non-scaling-stroke"
  6. Blend mode: style="mix-blend-mode: multiply"  -- highlights only
```

### Pattern 3: pathOffset Transform for Pen/Highlighter Strokes (CRITICAL)
**What:** Fabric.js stores path coordinates relative to the path's center point (pathOffset). To render correctly, must translate by negative pathOffset.
**When to use:** Every path-type annotation (pen strokes, highlighter strokes, erased paths).
**Why critical:** Incorrect pathOffset handling causes 50-200px positioning errors. This is called out in the success criteria.
**Example:**
```jsx
// Source: PAL lines 2920-2932, geometryHitTest.js lines 980-993
// Fabric.js path coordinate system:
//   path.left/top = position of the path's center on the canvas
//   path.pathOffset = { x: center_x_of_path_data, y: center_y_of_path_data }
//   path.path = [[cmd, ...args], ...] in local coordinates
//
// To render in SVG (page coordinates):
//   translate(left, top) -> moves to the path's center position
//   scale(scaleX, scaleY) -> applies any scaling
//   translate(-pathOffset.x, -pathOffset.y) -> shifts path data so it's centered at origin
//
// The path d="" string uses the raw path commands as-is.

const renderPath = (obj) => {
  const d = obj.path.map(seg => seg.join(' ')).join(' ');
  const pathOffsetX = obj.pathOffset?.x || 0;
  const pathOffsetY = obj.pathOffset?.y || 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const angle = obj.angle ?? 0;

  // Build transform: position -> rotate -> scale -> offset
  let transform = `translate(${left}, ${top})`;
  if (angle !== 0) transform += ` rotate(${angle})`;
  if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
  transform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;

  const isHighlight = obj.globalCompositeOperation === 'multiply';
  const isErasedOutline = obj.strokeWidth === 0 && obj.fill && obj.fill !== 'transparent';

  return (
    <path
      d={d}
      transform={transform}
      stroke={isErasedOutline ? 'none' : (obj.stroke || 'black')}
      strokeWidth={isErasedOutline ? 0 : (obj.strokeWidth || 1)}
      fill={isErasedOutline ? obj.fill : 'none'}
      opacity={obj.opacity ?? 1}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};
```

### Pattern 4: Three-Layer Visibility Filtering
**What:** Annotations have three visibility layers: base (no moduleId/regionId), middle (has moduleId), top (has regionId). Each layer has different filtering rules.
**When to use:** Applied in useMemo to filter annotation objects before rendering.
**Source:** PAL lines ~8625-8810.
**Logic summary:**
```
For each annotation object:
  1. Layer visibility check: obj.layer || 'native' -> layerVisibility[layer] !== false
  2. Three-layer survey logic:
     - isSurveyAnnotation (has moduleId): visible only when showSurveyPanel && module matches
     - isBase (no moduleId, no regionId): hidden when showSurveyPanel && selectedModuleId set
     - isRegionScoped (has regionId): passes survey check, controlled by region logic
  3. Region-scoped visibility:
     - No active space: hidden
     - Has active regions & overlay enabled: visible
     - activeRegionId set: visible only if regionId matches
  4. Background annotation lightbulb:
     - When space is active: check getRegionLightbulbState(spaceId, pageNumber)
     - When no space active: always visible
  5. Final: visible = matchesSpace && surveyVisible && regionVisible && lightbulbVisible
```

### Pattern 5: Renderer Toggle
**What:** URL parameter + keyboard shortcut controls which renderer is active.
**Implementation:**
```jsx
// In App.jsx: read URL param, maintain state
const [rendererMode, setRendererMode] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  return params.get('renderer') || 'canvas'; // default to canvas during development
});

// Keyboard shortcut (Ctrl+Shift+V suggested)
useEffect(() => {
  const handler = (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      setRendererMode(prev => prev === 'svg' ? 'canvas' : 'svg');
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);

// In render: conditionally mount PAL or SVGAnnotationLayer
// When SVG: PAL does NOT mount (saves ~44MB per visible page)
// When Canvas: SVGAnnotationLayer does NOT mount, PAL mounts normally
```

### Anti-Patterns to Avoid
- **Manual JavaScript scaling:** Never multiply coordinates by scale in SVGAnnotationLayer. viewBox handles all scaling. Coordinates should always be in unscaled PDF page space.
- **Per-annotation `<svg>` elements:** The current LightweightAnnotationOverlay creates a separate `<svg>` per path/line/arrow. Use a single root `<svg>` with all annotations as children -- fewer DOM nodes, shared viewBox.
- **Using Fabric.js toSVG():** Documented text positioning bugs. Custom JSON-to-SVG mapping is more reliable and gives full control.
- **Trusting computed scale:** The Electron/browser zoom factor mismatch means pageSize * scale does not equal actual container size. With viewBox, this is irrelevant since the SVG stretches to fill the overlay div.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Callout line geometry | Custom knee/border-point math | `calculateCalloutConnection()` from calloutGeometry.js | 590 lines of geometry edge cases already handled |
| Zoom scaling | JavaScript scale multiplication | SVG viewBox attribute | Browser-native, zero flicker, zero timers |
| Non-scaling strokes | Manual strokeWidth / scale division | `vector-effect="non-scaling-stroke"` | Browser-native, 92% support, all target browsers |
| Text word wrapping | Manual line splitting in SVG `<text>` | `<foreignObject>` with HTML div | Full CSS text layout for free |
| Eraser rendering | SVG clipPath for eraser holes | Render modified path data as-is | Eraser already modifies path commands via booleanErasePath; stored JSON has the final result |

**Key insight:** The eraser system already bakes subtraction results into the Fabric.js JSON path data. An erased pen stroke has its `path` commands rewritten to polygon outlines with `strokeWidth: 0` and `fill: originalStrokeColor`. The SVG layer simply renders these modified paths with `fill` instead of `stroke`. No separate clipPath or eraser circle logic is needed for DISP-06.

## Common Pitfalls

### Pitfall 1: pathOffset Omission
**What goes wrong:** Pen/highlighter strokes render 50-200px away from their correct position.
**Why it happens:** Fabric.js path coordinates are relative to the path's center (pathOffset). Without `translate(-pathOffset.x, -pathOffset.y)`, the path renders at the wrong position.
**How to avoid:** Always include pathOffset in the transform chain for path-type objects. Test with the existing test PDF page 6 which has pen strokes and highlights.
**Warning signs:** Annotations appear clustered in the top-left corner or shifted diagonally.

### Pitfall 2: Erased Path Rendering as Stroke Instead of Fill
**What goes wrong:** Erased pen strokes render as thin lines instead of filled polygon outlines, or disappear entirely.
**Why it happens:** After boolean eraser subtraction, the path is converted from stroke to fill (strokeWidth: 0, fill: originalColor). If the renderer always uses `stroke` + `fill="none"`, erased paths become invisible.
**How to avoid:** Check `obj.strokeWidth === 0 && obj.fill !== 'transparent'` to detect converted-to-outline erased paths. Render these with `fill` instead of `stroke`.
**Warning signs:** Annotations that were partially erased show gaps or disappear entirely.

### Pitfall 3: Missing Filtering Props
**What goes wrong:** SVGAnnotationLayer only filters by moduleId (like current overlay) but not by regionId, spaceId, or lightbulb state. Annotations that should be hidden remain visible.
**Why it happens:** LightweightAnnotationOverlay only receives selectedModuleId and showSurveyPanel. PAL receives 12+ filtering props.
**How to avoid:** SVGAnnotationLayer must receive and use: selectedSpaceId, activeSpaceId, selectedModuleId, showSurveyPanel, activeRegions, activeRegionId, getRegionLightbulbState, isRegionOverlayEnabled, layerVisibility, spaces.
**Warning signs:** Annotations from wrong regions/spaces appear when toggling spaces.

### Pitfall 4: Callout Coordinate System Mismatch
**What goes wrong:** Callout arrows and text boxes render at wrong positions.
**Why it happens:** Callouts use normalized (0-1) coordinates relative to page dimensions. Must multiply by unscaled page width/height (NOT scaled) when in viewBox mode.
**How to avoid:** In viewBox mode, callout coords become: `arrowTip.x * pageWidth`, `arrowTip.y * pageHeight`. Then pass to `calculateCalloutConnection()` which expects pixel coordinates.
**Warning signs:** Callout lines point to wrong locations or text boxes are off-page.

### Pitfall 5: preserveAspectRatio Stretching
**What goes wrong:** SVG annotations appear slightly stretched or compressed compared to Canvas.
**Why it happens:** If `preserveAspectRatio` is left as default ("xMidYMid meet"), the SVG maintains aspect ratio and may not fill the overlay div exactly, especially with Electron zoom factor.
**How to avoid:** Use `preserveAspectRatio="none"` so the SVG stretches to match the overlay div exactly. The overlay div is already sized correctly by v1.0 Phase 3 infrastructure.
**Warning signs:** Annotations appear slightly offset at non-standard zoom levels, especially at 50% PDF zoom with Electron zoom factor.

### Pitfall 6: Highlight Rect Dimensions
**What goes wrong:** Highlight rectangles render at wrong size because width/height are not multiplied by scaleX/scaleY.
**Why it happens:** Fabric.js stores base width/height separately from scaleX/scaleY. The actual rendered size is `width * scaleX` by `height * scaleY`.
**How to avoid:** For rect-type objects, compute effective dimensions: `effectiveWidth = obj.width * Math.abs(obj.scaleX || 1)`, or use SVG transform with scale.
**Warning signs:** Highlights appear too small or too large compared to Canvas rendering.

## Code Examples

### Rendering a Fabric.js Rect as SVG
```jsx
// Source: Codebase analysis of PAL shape creation (line ~6479)
// Fabric.js JSON: { type: 'rect', left, top, width, height, scaleX, scaleY, angle,
//                   stroke, strokeWidth, fill, opacity, strokeUniform }
const renderRect = (obj) => {
  const effectiveWidth = Math.abs((obj.width || 0) * (obj.scaleX || 1));
  const effectiveHeight = Math.abs((obj.height || 0) * (obj.scaleY || 1));
  const isHighlight = obj.globalCompositeOperation === 'multiply';

  return (
    <rect
      x={obj.left}
      y={obj.top}
      width={effectiveWidth}
      height={effectiveHeight}
      transform={obj.angle ? `rotate(${obj.angle}, ${obj.left}, ${obj.top})` : undefined}
      fill={obj.fill || 'transparent'}
      stroke={obj.stroke || 'transparent'}
      strokeWidth={obj.strokeWidth || 0}
      opacity={obj.opacity ?? 1}
      vectorEffect={obj.strokeUniform ? 'non-scaling-stroke' : undefined}
      style={isHighlight ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
};
```

### Rendering Text via foreignObject
```jsx
// Source: MDN foreignObject docs + Fabric.js textbox JSON structure
// Fabric.js JSON: { type: 'textbox'/'i-text', left, top, width, height, scaleX, scaleY,
//                   text, fontSize, fontFamily, fontWeight, fill, textAlign }
const renderText = (obj) => {
  const effectiveWidth = Math.abs((obj.width || 100) * (obj.scaleX || 1));
  const effectiveHeight = Math.abs((obj.height || 30) * (obj.scaleY || 1));

  return (
    <foreignObject
      x={obj.left}
      y={obj.top}
      width={effectiveWidth}
      height={effectiveHeight}
      transform={obj.angle ? `rotate(${obj.angle}, ${obj.left}, ${obj.top})` : undefined}
    >
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: '100%',
          height: '100%',
          fontSize: `${obj.fontSize || 16}px`,
          fontFamily: obj.fontFamily || 'sans-serif',
          fontWeight: obj.fontWeight || 'normal',
          color: obj.fill || '#000',
          textAlign: obj.textAlign || 'left',
          lineHeight: (obj.lineHeight || 1.16),
          overflow: 'hidden',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
          padding: '0'
        }}
      >
        {obj.text || ''}
      </div>
    </foreignObject>
  );
};
```

### Rendering a Line with Arrowhead
```jsx
// Source: Existing LightweightAnnotationOverlay lines 360-398
// Fabric.js JSON: { type: 'group', objects: [
//   { type: 'line'/'polyline'/'path', x1, y1, x2, y2 },
//   { type: 'triangle', name: 'arrowHead', ... }
// ], left, top, ... }
const renderArrow = (obj) => {
  const lineChild = obj.objects.find(o => o.type === 'line' || o.type === 'polyline' || o.type === 'path');
  const arrowHead = obj.objects.find(o => o.name === 'arrowHead' || o.type === 'triangle');
  if (!lineChild) return null;

  // Group left/top offsets child coordinates
  const x1 = (obj.left || 0) + (lineChild.x1 || 0);
  const y1 = (obj.top || 0) + (lineChild.y1 || 0);
  const x2 = (obj.left || 0) + (lineChild.x2 || 0);
  const y2 = (obj.top || 0) + (lineChild.y2 || 0);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const headSize = Math.max(6, (obj.strokeWidth || 2) * 3);

  return (
    <g opacity={obj.opacity ?? 1}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={obj.stroke || '#000'}
        strokeWidth={obj.strokeWidth || 2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {arrowHead && (
        <polygon
          points={`0,${-headSize/2} ${headSize},0 0,${headSize/2}`}
          fill={obj.stroke || '#000'}
          transform={`translate(${x2},${y2}) rotate(${angle})`}
        />
      )}
    </g>
  );
};
```

### Callout Rendering with viewBox Coordinates
```jsx
// Source: Existing LightweightAnnotationOverlay lines 441-498 + calloutGeometry.js
// Callouts use normalized (0-1) coordinates; multiply by page dimensions (not scaled)
const renderCallout = (callout, pageWidth, pageHeight) => {
  const arrowTip = {
    x: callout.arrowTip.x * pageWidth,
    y: callout.arrowTip.y * pageHeight
  };
  const knee = {
    x: callout.knee.x * pageWidth,
    y: callout.knee.y * pageHeight
  };
  const textBox = {
    x: callout.textBoxPosition.x * pageWidth,
    y: callout.textBoxPosition.y * pageHeight,
    width: Math.max(18, (callout.textBoxWidth || 0.1) * pageWidth),
    height: Math.max(18, (callout.textBoxHeight || 0.05) * pageHeight)
  };

  const connection = calculateCalloutConnection(
    textBox.x, textBox.y, textBox.width, textBox.height,
    knee, arrowTip, callout.style?.lineThickness || 2
  );

  // Render lines, circle, rect, and text using connection geometry
  // (same pattern as existing overlay)
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-annotation `<svg>` | Single root `<svg viewBox>` per page | This phase | Fewer DOM nodes, shared coordinate system, simpler code |
| JavaScript scale multiplication | viewBox auto-scaling | This phase | Zero zoom coordination, zero timers, zero flicker |
| Canvas for display + edit | SVG for display, Canvas for edit only | This phase | ~44MB memory savings per visible page, eliminates 5-timer system |
| LightweightAnnotationOverlay (approx) | SVGAnnotationLayer (exact) | This phase | Correct pathOffset, eraser support, full filtering, text rendering |

**Deprecated/outdated:**
- `LightweightAnnotationOverlay.jsx`: Will be kept but functionally replaced by SVGAnnotationLayer during toggle period. Not deleted until after v2.0 Phase 11.

## Open Questions

1. **Circle vs Ellipse handling**
   - What we know: PAL creates shapes with `new Circle({ originX: 'left', originY: 'top' })`. In Fabric.js, Circle has `radius`, not `width/height`. Ellipse would have `rx/ry`.
   - What's unclear: Whether any stored annotations use Fabric.js `ellipse` type vs all using `circle` type.
   - Recommendation: Support both -- map `circle` to SVG `<ellipse>` with `rx=ry=radius*scaleX`, and `ellipse` to `<ellipse>` with `rx` and `ry`. Test with actual data.

2. **Eraser on non-path objects (rects, shapes)**
   - What we know: The eraser code in PAL (lines 2713-2794) operates on path objects. Rect/circle erasure appears to delete entire objects rather than partial erase.
   - What's unclear: Whether partial eraser on non-path objects ever produces modified JSON that needs special SVG rendering.
   - Recommendation: Assume rects/circles are either fully present or fully deleted. If edge cases found during testing, handle as needed.

3. **Arrow arrowhead scaling behavior with non-scaling-stroke**
   - What we know: The arrowhead `<polygon>` uses a fixed pixel size based on strokeWidth. With viewBox scaling, this polygon will scale with zoom.
   - What's unclear: Whether arrowheads should also be non-scaling (constant size) or should scale with zoom.
   - Recommendation: Start with arrowheads scaling with zoom (natural viewBox behavior). If user prefers constant-size arrowheads, add inverse-scale transform on the polygon.

4. **Performance with many annotations per page**
   - What we know: MAX_PREVIEW_OBJECTS in current overlay is 420. SVG should handle this fine, but pages with 500+ annotations are possible.
   - What's unclear: Exact performance threshold for SVG DOM nodes per page.
   - Recommendation: Keep the 420 limit initially. PERF-01 (SVG virtualization) is deferred to future milestone. Monitor during testing.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (tests/*.test.mjs) + Playwright (debug/scenarios/*.spec.mjs) |
| Config file | debug/playwright.config.mjs (Playwright), none for node:test |
| Quick run command | `node --experimental-default-type=module --test tests/*.test.mjs` |
| Full suite command | `npm test && npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISP-01 | All 7 types render as SVG | manual | Visual comparison in browser with toggle | N/A -- manual |
| DISP-02 | viewBox auto-scales with zoom | manual | Toggle to SVG, zoom in/out, verify no flicker | N/A -- manual |
| DISP-03 | pathOffset positions pen strokes correctly | manual + unit | `node --test tests/svg-path-transform.test.mjs` | Wave 0 |
| DISP-04 | non-scaling-stroke on lines/shapes | manual | Zoom and verify stroke width stays constant | N/A -- manual |
| DISP-05 | Highlight blend mode multiply | manual | Visual comparison highlight color blending | N/A -- manual |
| DISP-06 | Erased paths render correctly | manual | Open page with erased annotations, compare SVG vs Canvas | N/A -- manual |
| DISP-07 | Text via foreignObject | manual | Compare text position/font/color SVG vs Canvas | N/A -- manual |
| DISP-08 | Callout geometry correct | manual + unit | `node --test tests/callout-geometry.test.mjs` (existing) | Partial |
| DISP-09 | Arrow arrowhead geometry | manual | Visual comparison arrow rendering | N/A -- manual |
| DISP-10 | Region/space filtering | manual | Toggle spaces/regions, verify annotation show/hide matches Canvas mode | N/A -- manual |
| DISP-11 | Toggle SVG/Canvas works | manual | URL param and keyboard shortcut switch correctly | N/A -- manual |

### Sampling Rate
- **Per task commit:** Manual browser verification with toggle (SVG vs Canvas side-by-side)
- **Per wave merge:** Full visual comparison across all annotation types
- **Phase gate:** All 7 types render correctly, zoom works, filtering works -- verified by user in dev server

### Wave 0 Gaps
- [ ] `tests/svg-path-transform.test.mjs` -- unit tests for pathOffset transform math (covers DISP-03)
- [ ] Test annotations with all 7 types need to be created in the test PDF (lines, arrows, callouts, shapes, text are missing)
- [ ] No automated visual regression tests -- phase relies on manual comparison via renderer toggle

*(Most validation for this phase is visual/manual because it's about rendering correctness. The renderer toggle itself IS the verification tool -- switch between SVG and Canvas to compare.)*

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/components/LightweightAnnotationOverlay.jsx` -- existing SVG rendering patterns
- Codebase analysis: `src/PageAnnotationLayer.jsx` lines 2920-2932 -- pathOffset transform math
- Codebase analysis: `src/PageAnnotationLayer.jsx` lines 8625-8810 -- three-layer visibility filtering
- Codebase analysis: `src/PageAnnotationLayer.jsx` lines 2713-2794 -- eraser boolean subtraction (modifies path data, no separate clipPath)
- Codebase analysis: `src/utils/calloutGeometry.js` -- callout connection geometry
- Codebase analysis: `src/PageAnnotationLayer.jsx` line 3613 -- toJSON custom properties list
- [MDN viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox) -- viewBox attribute behavior
- [MDN foreignObject](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/foreignObject) -- foreignObject for text rendering
- [MDN vector-effect](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect) -- non-scaling-stroke attribute

### Secondary (MEDIUM confidence)
- [Can I Use: vector-effect](https://caniuse.com/vector-effect) -- 92% browser support, all target browsers
- [Can I Use: mix-blend-mode](https://caniuse.com/css-mixblendmode) -- broad browser support for multiply blend mode
- [SVG Clipping and Masking MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Clipping_and_masking) -- clip-path with evenodd rule

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all browser-native SVG
- Architecture: HIGH -- based on detailed codebase analysis of existing overlay, PAL filtering, and annotation data structures
- Pitfalls: HIGH -- pathOffset behavior verified from multiple code paths (PAL, geometryHitTest, geometryEraser); eraser behavior confirmed from booleanErasePath implementation
- Filtering: HIGH -- three-layer logic read directly from PAL source code (lines 8625-8810)
- Eraser/clipPath: HIGH -- confirmed eraser modifies path data directly (booleanErasePath), no separate clipPath data stored in JSON

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable -- all browser APIs are mature, project architecture is well-understood)
