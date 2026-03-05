# Phase 1: CSS Transform Scaling - Research

**Researched:** 2026-03-04
**Domain:** CSS transform-based annotation scaling during Syncfusion PDF viewer zoom
**Confidence:** HIGH

## Summary

Phase 1 solves a specific, well-understood problem: when Syncfusion zooms, it destroys and recreates page DOM elements (`.e-pv-page-div`), which detaches React portals that mount the annotation layer, causing annotations to disappear during zoom. The existing codebase already has most of the machinery needed -- `useZoomState` provides `cssScale`, `isZooming`, and `zoomStyle`; the `syncfusionInteractionPhase` state machine tracks interaction windows; and `LightweightAnnotationOverlay` provides a DOM-based annotation preview. The core implementation work is wiring these together so that the lightweight overlay becomes visible during zoom and scales via CSS transform.

The approach is to use `LightweightAnnotationOverlay` as the visible annotation representation during zoom. Since it renders DOM elements (not Fabric.js canvas), it can be positioned outside Syncfusion's page DOM container, avoiding the portal detachment problem entirely. CSS `transform: scale()` on this overlay provides GPU-accelerated smooth scaling that matches the page's visual zoom. The existing Fabric.js `PageAnnotationLayer` portals will have pointer events blocked during zoom and can remain hidden or detached while the lightweight overlay handles visual continuity.

**Primary recommendation:** Mount LightweightAnnotationOverlay in a container outside Syncfusion's page DOM (avoiding portal detachment), show it during zoom with CSS transform scaling, block pointer events on the Fabric.js layer during zoom, and enhance the lightweight overlay with SVG path rendering for freehand/ink and line/arrow annotations.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Block all pointer events on the Fabric.js annotation layer during zoom (pointerEvents: 'none' when isZooming is true)
- LightweightAnnotationOverlay is already pointerEvents: 'none' by default -- no additional blocking needed
- Re-enable pointer events immediately when isZooming becomes false (no delay after re-render)
- No visual indication of non-interactivity during zoom (no cursor change, no opacity change) -- matches Acrobat behavior
- Use LightweightAnnotationOverlay (DOM-based preview) as the visible annotation representation during zoom
- DOM elements scale crisply via CSS transform (no bitmap blur) -- better than CSS-scaling canvas bitmaps
- Lightweight fidelity is acceptable for zoom preview; try simplified approach first, iterate if the visual gap is too jarring
- Add SVG path rendering for freehand/ink annotations in the lightweight overlay (replacing bounding-box representation) -- included in Phase 1 scope
- Add SVG line and arrow rendering in the lightweight overlay -- included in Phase 1 scope
- Syncfusion is the primary (and only live) viewer -- all Phase 1 work targets the Syncfusion overlay path

### Claude's Discretion
- Syncfusion DOM investigation and architectural approach for surviving page DOM recreation
- Overlay positioning strategy during zoom (inside Syncfusion container vs floating viewport overlay)
- Zoom trigger mechanism (interaction phase extension vs separate isZooming boolean)
- Whether to match Syncfusion's zoom transform or apply independent CSS transform -- investigate Syncfusion's DOM behavior at runtime
- Any CSS transform-origin considerations (Phase 2 will address positional accuracy in detail)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ZVIS-01 | Annotations stay visible throughout the entire zoom operation -- no disappearing at any point | Lightweight overlay rendered outside Syncfusion page DOM survives portal detachment; overlay shown whenever zoom interaction is active |
| ZVIS-02 | Annotations scale smoothly with the page during zoom via CSS transform (GPU-accelerated) | `useZoomState` already computes `cssScale` and `zoomStyle` with `will-change: transform` and `backface-visibility: hidden` for GPU compositing; apply same transform to lightweight overlay container |

</phase_requirements>

## Standard Stack

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component framework | Already used throughout |
| Fabric.js | 5.x | Canvas-based annotation rendering | Already used in PageAnnotationLayer |
| @syncfusion/ej2-react-pdfviewer | 32.1.19 (local SDK) | PDF rendering and zoom | Already the primary viewer |

### Supporting (Already in Codebase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| useZoomState hook | custom | Computes cssScale, isZooming, zoomStyle, renderedScale | Core zoom lifecycle -- already exists at `src/hooks/useZoomState.js` |
| zoomController | custom | Manages zoom modes and scale clamping | Already wired into App.jsx |
| LightweightAnnotationOverlay | custom | DOM-based annotation preview | Will serve as zoom preview layer |

### No New Dependencies Needed
Phase 1 requires zero new npm dependencies. All functionality is achievable with existing React, CSS transforms, and the established hook/component architecture.

## Architecture Patterns

### Current Architecture (Syncfusion Path)

```
App.jsx
  |
  +-- SyncfusionPDFContainer (renders PDF pages)
  |     |
  |     +-- .e-pv-page-container
  |           |
  |           +-- .e-pv-page-div[data-page-number="1"]  <-- portal target (pageHost)
  |           |     |
  |           |     +-- createPortal() mounts:
  |           |           +-- overlay wrapper div (position:absolute, z-index:20)
  |           |                 +-- PageAnnotationLayer (Fabric.js canvas)
  |           |                 +-- LightweightAnnotationOverlay (DOM preview, conditional)
  |           |
  |           +-- .e-pv-page-div[data-page-number="2"]  <-- another portal target
  |                 +-- ... same structure
  |
  +-- useZoomState(targetScale)  --> { renderedScale, cssScale, isZooming, zoomStyle }
```

**The Problem:** When Syncfusion zooms, it destroys `.e-pv-page-div` elements and recreates them. React portals mounted into these divs are detached, causing annotations to vanish. The `handleSyncfusionPageContainersChange` callback re-discovers new page divs and updates `syncfusionPageContainers` state, but this takes time (mutation observer -> callback -> state update -> React re-render), creating a gap where annotations are invisible.

### Recommended Architecture for Phase 1

```
App.jsx
  |
  +-- SyncfusionPDFContainer (renders PDF pages)
  |     |
  |     +-- .e-pv-page-container
  |           |
  |           +-- .e-pv-page-div[data-page-number="N"]
  |                 +-- createPortal() mounts:
  |                       +-- PageAnnotationLayer (Fabric.js canvas)
  |                            pointerEvents: isZooming ? 'none' : 'auto'
  |                            (hidden/frozen during zoom -- already has freeze logic)
  |
  +-- Zoom Preview Container (OUTSIDE Syncfusion page DOM)
  |     position: absolute, covers viewport area
  |     pointerEvents: 'none' (always)
  |     visibility: isZooming ? 'visible' : 'hidden'
  |     transform: scale(cssScale) with GPU acceleration
  |     |
  |     +-- LightweightAnnotationOverlay (per visible page)
  |           Rendered at renderedScale (frozen during zoom)
  |           CSS transform scales it visually to match live zoom
  |
  +-- useZoomState(targetScale) --> { renderedScale, cssScale, isZooming, zoomStyle }
```

**Key architectural insight:** The lightweight overlay container lives OUTSIDE Syncfusion's page DOM tree. It is a sibling element to the Syncfusion viewer wrapper, not a child of `.e-pv-page-div`. This means Syncfusion's DOM destruction during zoom has zero effect on it.

### Pattern 1: Zoom Preview Layer Positioning

**What:** A floating overlay container that positions lightweight annotations to visually align with Syncfusion page positions.

**When to use:** During zoom (when `isZooming` or `syncfusionInteractionPhase !== 'idle'` for zoom-only interactions).

**Key consideration:** The overlay must be positioned so that its annotations align visually with the corresponding Syncfusion pages. Two approaches:

1. **Per-page absolute positioning** -- Position each LightweightAnnotationOverlay instance absolutely relative to the Syncfusion viewer container, measuring each page's position and applying the same offset. This is more complex but handles multi-page views correctly.

2. **Apply CSS transform to existing portal overlays** -- Instead of moving the overlay outside Syncfusion, apply `transform: scale(cssScale)` directly to the portal overlay content div. The existing `applySyncfusionOverlayTransformSync` already does this (lines 9820-9915 of App.jsx). The annotation layer overlay content already gets CSS-scaled via this mechanism during interactions.

**Recommendation:** Extend the existing overlay transform sync mechanism. The `applySyncfusionOverlayTransformSync` function already applies `transform: scale(ratio)` to overlay content nodes during interactions. For zoom, we need to:
- Ensure the lightweight overlay is shown during zoom-only interactions (currently skipped via `isZoomOnlyInteraction` check on line 23265)
- Ensure the overlay transform ratio correctly reflects the zoom scale change
- Ensure the Fabric.js layer underneath has pointer events blocked

This is the least-invasive approach and reuses the proven transform sync loop.

### Pattern 2: Interaction Phase Extension for Zoom

**What:** Extend the existing `syncfusionInteractionPhase` state machine to properly handle zoom as an interaction type.

**Current behavior (lines 23262-23268):**
```javascript
// For zoom-only interactions, skip the proxy layer swap entirely.
// The CSS transform on the overlay provides smooth visual scaling,
// and the full Fabric.js canvas stays visible (just CSS-scaled).
const shouldRenderLightweightAnnotations = useLiveStableOverlay && !isZoomOnlyInteraction && (
  (syncfusionInteractionPhase === 'interacting' && isProxyPageWhileInteracting) ||
  (syncfusionInteractionPhase === 'committing' && isProxyPageWhileCommitting)
);
```

**Problem:** When `isZoomOnlyInteraction` is true, the lightweight overlay is NOT rendered. The existing CSS transform via `applySyncfusionOverlayTransformSync` scales the Fabric.js overlay content div, but if Syncfusion destroys the page div, the portal detaches and the canvas disappears regardless.

**Solution:** For zoom-only interactions, render the lightweight overlay AND apply CSS transform scaling. Remove the `!isZoomOnlyInteraction` exclusion (or add a separate zoom-specific path).

### Pattern 3: CSS Transform for GPU-Accelerated Zoom

**What:** Use `transform: scale(cssScale)` with `will-change: transform` for smooth GPU-composited scaling during zoom.

**Already implemented in `useZoomState`:**
```javascript
zoomStyle: isZooming ? {
  transform: `scale(${cssScale})`,
  transformOrigin: getTransformOrigin(),
  willChange: 'transform',
  backfaceVisibility: 'hidden',
} : {
  willChange: 'auto',
  backfaceVisibility: 'hidden',
},
```

**For the lightweight overlay:** The same `zoomStyle` (or a derivative using the same `cssScale`) should be applied to the lightweight overlay container during zoom. Since `cssScale = targetScale / renderedScale`, this naturally provides the correct visual scaling ratio.

### Anti-Patterns to Avoid

- **Re-rendering Fabric.js canvas during zoom:** Defeats the entire optimization. The canvas should only re-render when `renderedScale` changes (after zoom settles via debounce).
- **Using CSS transitions on zoom transforms:** Creates input lag and fights user gesture input. The `useZoomState` hook explicitly avoids transitions.
- **Portalling the zoom preview into Syncfusion page DOM:** Defeats the purpose -- the whole problem is that Syncfusion destroys those DOM nodes during zoom.
- **Rendering the full Fabric.js canvas in the overlay:** Would be as expensive as re-rendering. Use the lightweight DOM preview instead.
- **Adding delays before re-enabling pointer events:** The CONTEXT.md decision specifies immediate re-enable with no delay.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zoom lifecycle management | Custom zoom start/end detection | `useZoomState` hook (already exists) | Handles debounce, cssScale computation, isZooming detection, GPU-accelerated styles |
| Overlay transform sync | Manual DOM transform application | `applySyncfusionOverlayTransformSync` (already exists) | Handles per-page transform ratio, nodeChanged detection, style reset, performance throttling |
| Interaction phase tracking | Custom zoom state machine | `syncfusionInteractionPhase` + `isZoomOnlyInteraction` (already exists) | Handles wheel zoom, pinch zoom, toolbar zoom, settle detection, commit phase |
| Annotation preview rendering | Custom canvas/SVG renderer | `LightweightAnnotationOverlay` (already exists) | Handles shape normalization, callout geometry, scale computation, memo optimization |
| Scale clamping and persistence | Manual min/max checks | `zoomController` (already exists) | Handles fit-page/fit-width modes, localStorage persistence, scale epsilon |

**Key insight:** The codebase already has approximately 90% of the infrastructure needed. Phase 1 is primarily a wiring task -- connecting existing pieces that were built to support this exact use case but not yet fully connected.

## Common Pitfalls

### Pitfall 1: Portal Detachment Timing
**What goes wrong:** Annotations disappear briefly even with the lightweight overlay because of a timing gap between Syncfusion destroying the page div and the overlay becoming visible.
**Why it happens:** If the lightweight overlay visibility is tied to React state updates (e.g., `syncfusionInteractionPhase`), there can be a frame or two where neither layer is visible.
**How to avoid:** The lightweight overlay should be rendered and positioned BEFORE zoom starts, not in response to zoom starting. Show it proactively when `syncfusionInteractionPhase` transitions to 'interacting' for zoom reasons. The existing interaction detection already fires before Syncfusion processes the zoom event.
**Warning signs:** Brief flash of missing annotations when zoom starts, especially noticeable on slower devices.

### Pitfall 2: Double-Rendering Annotations
**What goes wrong:** Both the Fabric.js layer (portalled into Syncfusion) and the lightweight overlay are visible simultaneously, causing visual doubling.
**Why it happens:** Insufficient coordination between hiding the Fabric.js layer and showing the lightweight overlay.
**How to avoid:** Use `visibility: hidden` (not `display: none`) on the Fabric.js portal overlay during zoom. This preserves the DOM tree (important for React reconciliation when the portal re-attaches) while making it invisible. The existing `shouldHideFullLayer` mechanism already uses `visibility: hidden` (line 23350).
**Warning signs:** Annotations appear bolder/thicker during zoom, or borders appear doubled.

### Pitfall 3: CSS Transform-Origin Mismatch
**What goes wrong:** Annotations scale but from the wrong origin point, causing them to visually drift away from their correct page positions during zoom.
**Why it happens:** The `useZoomState` zoomStyle uses a cursor-based transform-origin, but the lightweight overlay might not share the same coordinate system.
**How to avoid:** For Phase 1, use `transform-origin: top left` on the lightweight overlay to match the overlay's absolute positioning. Phase 2 will address cursor-centered transform-origin alignment. This is explicitly noted as Claude's discretion in the CONTEXT.md.
**Warning signs:** Annotations slide/drift relative to the page during zoom, especially away from the top-left corner.

### Pitfall 4: Scale Computation Mismatch Between Layers
**What goes wrong:** The lightweight overlay scales to a different size than the Syncfusion page content, causing visual misalignment.
**Why it happens:** The overlay uses `renderedScale` for its base positioning while Syncfusion uses its own internal zoom value. These can differ during the zoom transition.
**How to avoid:** The `applySyncfusionOverlayTransformSync` function already handles this by measuring the live page host scale via `measureSyncfusionPageHostScale` and computing a ratio. Use this same mechanism for the lightweight overlay during zoom.
**Warning signs:** Annotations are slightly larger or smaller than expected relative to page content during zoom.

### Pitfall 5: Freehand/Ink SVG Path Data Not Available
**What goes wrong:** Attempting to render SVG paths for freehand/ink annotations fails because the serialized annotation data does not include path points in an accessible format.
**Why it happens:** Fabric.js `path` type objects store path data as an array of path commands (e.g., `[['M',x,y], ['Q',cx,cy,ex,ey]]`), but the serialized JSON from `canvas.toJSON()` includes this as a `path` property. The lightweight overlay receives `annotations.objects` which is this serialized JSON.
**How to avoid:** Check the actual serialized format of path objects. Fabric.js `toJSON()` includes the `path` property for Path objects. Use this path data to construct SVG `<path>` elements with the `d` attribute.
**Warning signs:** Freehand annotations appear as empty bounding boxes in the lightweight overlay.

### Pitfall 6: Group Objects (Arrows) Need Special Handling
**What goes wrong:** Arrow annotations appear as simple bounding boxes instead of lines with arrowheads.
**Why it happens:** Arrows are Fabric.js Groups containing a Line (or Path) and a Triangle arrowhead. The lightweight overlay needs to handle group objects specially, extracting the line geometry and arrowhead position.
**How to avoid:** For groups, check if the group represents an arrow (has a line + triangle/arrowHead), and if so, extract the line coordinates and render as SVG `<line>` with an SVG arrowhead marker. For non-arrow groups, fall back to the bounding box representation.
**Warning signs:** Arrows render as filled rectangles instead of lines.

## Code Examples

### Example 1: Lightweight Overlay Zoom Visibility Logic

Current code that skips lightweight overlay during zoom (App.jsx line 23265):
```javascript
// CURRENT: Lightweight overlay NOT shown during zoom-only interactions
const shouldRenderLightweightAnnotations = useLiveStableOverlay && !isZoomOnlyInteraction && (
  (syncfusionInteractionPhase === 'interacting' && isProxyPageWhileInteracting) ||
  (syncfusionInteractionPhase === 'committing' && isProxyPageWhileCommitting)
);
```

Required change to show during zoom:
```javascript
// PHASE 1: Also show lightweight overlay during zoom-only interactions
const shouldRenderLightweightForZoom = isZoomOnlyInteraction &&
  syncfusionInteractionPhase === 'interacting';

const shouldRenderLightweightAnnotations = useLiveStableOverlay && (
  shouldRenderLightweightForZoom ||
  (!isZoomOnlyInteraction && (
    (syncfusionInteractionPhase === 'interacting' && isProxyPageWhileInteracting) ||
    (syncfusionInteractionPhase === 'committing' && isProxyPageWhileCommitting)
  ))
);
```

### Example 2: Pointer Event Blocking on Fabric.js Layer During Zoom

The PageAnnotationLayer portal wrapper (App.jsx line 23291-23311):
```javascript
// Add pointerEvents blocking based on zoom state
<div
  key={`syncfusion-overlay-${pageNumber}`}
  style={{
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: isZoomOnlyInteraction ? 'none' : 'none', // Already 'none' on wrapper
    zIndex: 20,
    transform: getPageTransform(pageNumber),
    transformOrigin: 'center center'
  }}
>
```

Note: The outer wrapper already has `pointerEvents: 'none'`. The actual interaction target is deeper in PageAnnotationLayer (the Fabric.js canvas). Need to pass `isZooming` prop to PageAnnotationLayer to disable its canvas pointer events.

### Example 3: SVG Path Rendering for Freehand Annotations

```javascript
// In LightweightAnnotationOverlay, detect path-type objects and render SVG
const isPathObject = objectType === 'path';
const hasPathData = Array.isArray(object.path) && object.path.length > 0;

if (isPathObject && hasPathData) {
  // Convert Fabric.js path array to SVG path d attribute
  const d = object.path.map(segment => segment.join(' ')).join(' ');

  // Render as SVG path element
  return (
    <svg
      key={preview.key}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: overlayWidth,
        height: overlayHeight,
        pointerEvents: 'none',
        overflow: 'visible'
      }}
    >
      <path
        d={d}
        stroke={preview.stroke}
        strokeWidth={preview.strokeWidth}
        fill="none"
        opacity={preview.opacity}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${preview.left}, ${preview.top}) scale(${safeScale})`}
      />
    </svg>
  );
}
```

### Example 4: SVG Line/Arrow Rendering

```javascript
// Detect line objects within groups (arrows)
const isGroupObject = objectType === 'group';
const groupObjects = Array.isArray(object.objects) ? object.objects : [];
const lineChild = groupObjects.find(o =>
  o.type === 'line' || o.type === 'polyline' || o.type === 'path'
);
const arrowHeadChild = groupObjects.find(o =>
  o.name === 'arrowHead' || o.type === 'triangle'
);

if (isGroupObject && lineChild) {
  // Extract line coordinates, accounting for group transform
  const x1 = (lineChild.x1 || 0) * safeScale;
  const y1 = (lineChild.y1 || 0) * safeScale;
  const x2 = (lineChild.x2 || 0) * safeScale;
  const y2 = (lineChild.y2 || 0) * safeScale;

  return (
    <svg key={preview.key} /* ... positioning styles ... */>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={preview.stroke}
        strokeWidth={preview.strokeWidth}
        strokeLinecap="round"
      />
      {arrowHeadChild && (
        <polygon
          points="..."
          fill={preview.stroke}
          transform={`translate(${x2},${y2}) rotate(${arrowAngle})`}
        />
      )}
    </svg>
  );
}
```

### Example 5: CSS Transform Scale on Lightweight Overlay

The `applySyncfusionOverlayTransformSync` already applies transform (App.jsx lines 9890-9894):
```javascript
ratioByPage[pageNumber] = ratio;
node.style.transform = `scale(${ratio})`;
node.style.transformOrigin = 'top left';
node.style.willChange = 'transform';
node.style.backfaceVisibility = 'hidden';
```

This same mechanism will scale the lightweight overlay during zoom. The `ratio` is computed as `liveScale / pageBaseScale` which gives the correct visual scaling factor.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Re-render Fabric.js on every zoom change | CSS transform during zoom, canvas re-render after settle | This project | Eliminates main-thread work during zoom gesture |
| All annotations via Fabric.js canvas | Lightweight DOM overlay for preview during interactions | Already implemented | Enables portal-independent rendering during zoom |
| Zoom-only interactions skip proxy swap | Zoom-only interactions need lightweight overlay for visibility | Phase 1 change | Fixes annotation disappearance during zoom |

**Key existing infrastructure:**
- `useZoomState` hook: Fully implemented with debounced render, cssScale computation, GPU-accelerated styles
- `syncfusionInteractionPhase` state machine: Fully implemented with zoom-only detection, settle check, commit phase
- `applySyncfusionOverlayTransformSync`: Fully implemented with per-page transform ratio computation
- `LightweightAnnotationOverlay`: Fully implemented for shapes, text, and callouts (needs freehand/line SVG additions)
- `freezeContainerIdentity`: Already preserves portal host references during interactions

## Open Questions

1. **Overlay positioning accuracy during zoom**
   - What we know: The `applySyncfusionOverlayTransformSync` measures live page host dimensions and computes a transform ratio. This works for scroll/pan interactions.
   - What's unclear: Whether this same ratio computation produces correct visual alignment during zoom transitions, or if there are sub-pixel discrepancies specific to zoom.
   - Recommendation: Implement with existing mechanism first, test visually, adjust if needed. Phase 2 will address precise positional accuracy.

2. **Fabric.js path serialization format**
   - What we know: `canvas.toJSON()` includes custom properties like `data`, `name`, `highlightId` etc. Path objects have a `path` property with command arrays.
   - What's unclear: The exact format of the `path` property after serialization (whether it's still an array of arrays or gets stringified), and whether `left`/`top` coordinates need group transform adjustment.
   - Recommendation: Inspect the actual serialized JSON at runtime during development. The path data should be `[['M',x,y], ['Q',cx,cy,ex,ey], ...]` format.

3. **Timing of lightweight overlay visibility relative to Syncfusion DOM destruction**
   - What we know: The interaction phase transitions to 'interacting' when zoom events fire, which happens before Syncfusion processes the zoom internally.
   - What's unclear: Whether there is always at least one React render cycle between the interaction phase change and Syncfusion's DOM destruction.
   - Recommendation: Use refs and synchronous DOM style manipulation (like `applySyncfusionOverlayTransformSync` already does) to minimize timing gaps. If a gap is detected during testing, add a preemptive show of the lightweight overlay before zoom events propagate to Syncfusion.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (node:test) |
| Config file | none -- uses `--experimental-default-type=module --test` flags |
| Quick run command | `node --experimental-default-type=module --test tests/*.test.mjs` |
| Full suite command | `node --experimental-default-type=module --test tests/*.test.mjs` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZVIS-01 | Annotations never disappear during zoom -- lightweight overlay visible when isZooming | manual-only | Visual inspection in running app with Chrome DevTools | N/A |
| ZVIS-02 | Annotations scale smoothly via CSS transform (GPU-accelerated) | manual-only | Visual inspection + Chrome Performance tab for compositor-only frames | N/A |

**Manual-only justification:** Both requirements describe visual rendering behavior that depends on Syncfusion's PDF viewer DOM lifecycle, Fabric.js canvas rendering, and CSS compositor behavior. These cannot be meaningfully tested without a running browser environment with Syncfusion initialized. The existing test framework (Node.js `node:test`) runs headless without a DOM. The codebase has no browser-based test infrastructure (no Playwright, Cypress, or JSDOM-based component tests). Adding browser-based testing infrastructure is out of Phase 1 scope.

### Sampling Rate
- **Per task commit:** Manual visual verification: open app, load PDF, zoom in/out, verify annotations stay visible and scale smoothly
- **Per wave merge:** Full manual test: zoom in/out via trackpad pinch, toolbar buttons, Ctrl+scroll; verify across multiple pages
- **Phase gate:** Complete manual verification checklist before `/gsd:verify-work`

### Wave 0 Gaps
None -- phase requirements are manual-only verification. No test files needed.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** -- `src/hooks/useZoomState.js` (111 lines), `src/components/LightweightAnnotationOverlay.jsx` (343 lines), `src/utils/zoomController.js` (236 lines), `src/components/SyncfusionPDFContainer.jsx` (1489 lines)
- **Codebase inspection** -- `src/App.jsx` lines 9058-9177 (zoom state and interaction phase setup), lines 9820-9915 (overlay transform sync), lines 10244-10391 (interaction session management), lines 23150-23475 (Syncfusion overlay rendering with portal creation)
- **Codebase inspection** -- `src/PageAnnotationLayer.jsx` lines 1-100 (imports, Fabric.js setup), lines 3439-3443 (serialization format with toJSON custom properties)

### Secondary (MEDIUM confidence)
- CSS `transform: scale()` with `will-change: transform` for GPU compositing -- well-established web platform feature, verified by existing `useZoomState` implementation
- React `createPortal` detachment behavior when host element is removed from DOM -- well-documented React behavior, confirmed by CONTEXT.md root cause analysis

### Tertiary (LOW confidence)
- Exact timing of Syncfusion's DOM destruction relative to zoom event callbacks -- needs runtime verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase, no new dependencies
- Architecture: HIGH -- existing code already implements 90% of the required infrastructure; pattern is clear from codebase analysis
- Pitfalls: HIGH -- root cause (portal detachment) well understood; existing overlay transform mechanism proves the CSS transform approach works
- SVG freehand/line rendering: MEDIUM -- path data format needs runtime verification; code examples are based on Fabric.js serialization knowledge but not verified against actual saved annotations in this app

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no external dependency changes expected)
