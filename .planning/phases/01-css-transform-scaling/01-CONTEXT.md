# Phase 1: CSS Transform Scaling - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire useZoomState to the annotation layer so annotations stay visible and scale smoothly during zoom via CSS transforms. Annotations must never disappear during zoom. Only the Syncfusion viewer path is live in production -- custom viewer paths are experimental/unused.

</domain>

<decisions>
## Implementation Decisions

### Syncfusion overlay handling
- Claude's discretion on whether to match Syncfusion's zoom transform or apply independent CSS transform -- investigate Syncfusion's DOM behavior at runtime
- Syncfusion is the primary (and only live) viewer -- all Phase 1 work targets the Syncfusion overlay path
- Root cause: Syncfusion destroys and recreates page DOM during zoom, detaching our portalled annotation layers -- annotations disappear because their mount point is gone
- Syncfusion's own PDF page content stays visible during zoom -- only our annotation layer disappears
- Claude's discretion on architectural approach: whether to move annotation container outside Syncfusion during zoom, use a floating layer, or re-attach portals after rebuild

### Pointer event blocking
- Block all pointer events on the Fabric.js annotation layer during zoom (pointerEvents: 'none' when isZooming is true)
- LightweightAnnotationOverlay is already pointerEvents: 'none' by default -- no additional blocking needed
- Re-enable pointer events immediately when isZooming becomes false (no delay after re-render)
- No visual indication of non-interactivity during zoom (no cursor change, no opacity change) -- matches Acrobat behavior

### Lightweight overlay as zoom preview
- Use LightweightAnnotationOverlay (DOM-based preview) as the visible annotation representation during zoom
- DOM elements scale crisply via CSS transform (no bitmap blur) -- better than CSS-scaling canvas bitmaps
- Lightweight fidelity is acceptable for zoom preview; try simplified approach first, iterate if the visual gap is too jarring
- Claude's discretion on overlay positioning (inside Syncfusion container vs floating viewport overlay)
- Claude's discretion on zoom trigger mechanism (extend interaction phase system vs separate isZooming boolean)

### Visual fidelity improvements
- Add SVG path rendering for freehand/ink annotations in the lightweight overlay (replacing bounding-box representation) -- included in Phase 1 scope
- Add SVG line and arrow rendering in the lightweight overlay -- included in Phase 1 scope
- These improvements directly affect zoom preview quality

### Claude's Discretion
- Syncfusion DOM investigation and architectural approach for surviving page DOM recreation
- Overlay positioning strategy during zoom
- Zoom trigger mechanism (interaction phase extension vs separate trigger)
- Any CSS transform-origin considerations (Phase 2 will address positional accuracy in detail)

</decisions>

<specifics>
## Specific Ideas

- "Syncfusion keeps pages visible during zoom while our annotation layer disappears" -- this is the core problem to solve
- Syncfusion confirmed it destroys/recreates page DOM during zoom -- portal detachment is the root cause
- Professional PDF apps (Acrobat, Bluebeam) block pointer events during zoom with no visual indication
- The lightweight overlay approach avoids the portal detachment problem entirely since it can be rendered outside Syncfusion's page DOM

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useZoomState` hook (src/hooks/useZoomState.js): Already computes renderedScale, cssScale, isZooming, zoomStyle -- core zoom lifecycle logic is ready
- `LightweightAnnotationOverlay` (src/components/LightweightAnnotationOverlay.jsx): DOM-based annotation preview with shape divs and callout SVGs -- will serve as zoom preview layer
- `zoomController` (src/utils/zoomController.js): Manages zoom modes (fit-page, fit-width, manual) and scale clamping

### Established Patterns
- Syncfusion interaction phases: Existing `syncfusionInteractionPhase` state machine controls when lightweight overlay shows/hides
- Portal-based rendering: Annotations are portalled into Syncfusion's page DOM via createPortal -- this is what breaks during zoom
- `layerScale` freezing: The Syncfusion path freezes annotation scale during interactions to prevent flashing

### Integration Points
- App.jsx line ~23351: Syncfusion overlay PageAnnotationLayer instance (primary target)
- App.jsx line ~23407: LightweightAnnotationOverlay instance (will be enhanced for zoom)
- App.jsx line ~9117: useZoomState hook consumption (renderedScale, zoomStyle, setAnchor)
- App.jsx line ~9058: isZoomingRef for zoom state tracking
- App.jsx line ~23253: layerScale computation for Syncfusion path

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 01-css-transform-scaling*
*Context gathered: 2026-03-04*
