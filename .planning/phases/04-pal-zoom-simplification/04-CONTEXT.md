# Phase 4: PAL Zoom Simplification - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

PageAnnotationLayer owns the post-zoom sequence: canvas redraw at correct resolution, CSS transform removal, and pointer event restoration. This phase simplifies PAL's scale useEffect by removing its independent settle timer and relying on App.jsx's zoom state as the single source of truth. Drawing tools, search highlights, and proxy rendering must all work correctly after zoom.

</domain>

<decisions>
## Implementation Decisions

### Settle timer coordination
- App.jsx owns the official zoom state with its 1000ms settle timer — single source of truth
- PAL's internal 300ms settle timer (`zoomSettleTimerRef`) is removed entirely
- PAL reacts to `isZooming` prop transitions from App.jsx — when `isZooming` goes from true to false, that is the signal to redraw
- No independent timer in PAL prevents race conditions and double-renders
- Keep `isInteracting` check that defers canvas operations during scroll/drag (separate concern from zoom)
- Keep `inZoomModeRef` latch but it is now set/cleared based on `isZooming` prop, not an independent timer

### Post-zoom redraw sequence
- Strict ordering to prevent visual glitches and coordinate bugs:
  1. **Redraw canvas at new native scale** — Fabric.js setWidth/setHeight/setZoom/renderAll so sharp pixels are ready
  2. **Remove CSS transforms** — swap the blurry CSS-scaled version for the crisp native render (no visual pop because new pixels are already painted)
  3. **Restore pointer events** — user can interact again with correct coordinates
- Center-page-first priority is kept: center page redraws immediately, visible non-center pages get delayed render, off-screen pages render when scrolled into view
- The tiered rendering approach (center → visible → off-screen) stays but uses `isZooming` transition as trigger instead of internal settle timer

### Props to remove
- `onScaleApplied` — callback to App.jsx for old confirm-pending system (lines 7914-7916, 7927-7929, 7941-7943, 8006-8008, 8014-8016). Remove from component signature (line ~3138)
- `presentationApiRegistry` — no longer needed (line ~3139)
- `isHidden` — remove prop and early return at line 7798 (line ~3135)
- Remove wrapper CSS transform logic from PAL (lines 7891-7894) — App.jsx handles this on the overlay div

### Drawing tool verification
- Detailed stroke-accuracy checks, not smoke tests
- Verify bounding boxes and stroke paths land correctly in viewer coordinate space after zoom
- Test pen, shapes, callouts, and regions at multiple zoom levels
- Confirm Fabric.js calcOffset is called after overlay transform removal so pointer coordinates are correct

### Search & proxy layers
- SearchHighlightLayer and LightweightAnnotationOverlay inherit CSS transforms from overlay divs — no zoom-specific changes needed
- Just verify their coordinate systems respect the final un-transformed state post-zoom
- These components "just work" because they render as children of the overlay divs

### Claude's Discretion
- Exact mechanism for PAL to detect `isZooming` false → true → false transition (useEffect dependency vs ref comparison)
- How to coordinate the redraw-then-remove-transform sequence with App.jsx (callback vs ref signal vs event)
- Whether center-page detection logic needs any adjustment for the new overlay div structure
- Error handling for edge cases (e.g., fabricRef.current is null when zoom settles)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Spec
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` — Step 4 defines PAL zoom simplification: what to keep (isInteracting, isZooming, settle timer, center-page priority), what to remove (wrapper CSS transform, onScaleApplied, presentationApiRegistry, isHidden)

### Prior Phase Context
- `.planning/phases/02-zoom-handler/02-CONTEXT.md` — Phase 2 decisions: 1000ms settle timer, CSS transform application, pointer event coordination
- `.planning/phases/03-render-loop-rewrite/03-CONTEXT.md` — Phase 3 decisions: portal targets are overlay divs, layerScale uses live viewer scale, simplified page filtering

### Requirements
- `.planning/REQUIREMENTS.md` — ZOOM-09 (canvas redraws crisp after zoom), OVLY-04 (Fabric.js pointer events work with CSS-transformed parent), PRES-01 through PRES-05 (drawing tools, search highlights, undo/redo, proxy rendering, no console errors)

### Key Source Files
- `src/PageAnnotationLayer.jsx` lines 7788-8028 — scale useEffect that needs simplification
- `src/App.jsx` lines 12117-12165 — overlay zoom settle timer (the authoritative settle signal)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `inZoomModeRef` (PAL): Zoom latch that prevents expensive canvas resize mid-zoom — keep but change trigger source
- `pendingScaleRef` (PAL): Stores deferred scale during zoom — still needed
- `enqueueZoomResize()` (PAL): Stagger queue for center-page-first rendering — keep as-is
- `cancelPendingPaintCommit()` / `schedulePaintCommitted()` (PAL): Paint commit lifecycle — keep
- `viewportObserverRef` (PAL): IntersectionObserver for off-screen deferred rendering — keep
- `deferredZoomScaleRef` (PAL): Stores pending scale for delayed/off-screen pages — keep

### Established Patterns
- Tiered rendering (center → visible → off-screen) with IntersectionObserver for off-screen — this is the existing priority pattern, keep it
- `isZooming` prop already flows from App.jsx to PAL — the signal path exists
- `fabricRef.current.setWidth/setHeight/setZoom/renderAll` is the standard canvas resize sequence

### Integration Points
- PAL scale useEffect (lines 7788-8028): Main code area to simplify
- App.jsx `removeOverlayZoomTransform()` (line ~12119): Called when settle timer fires — PAL needs to coordinate with this
- App.jsx `overlayZoomActiveRef` / `zoomOverlayTransformActiveRef`: Refs tracking active zoom state
- Phase 5 will add re-attachment logic that calls calcOffset after overlay div moves

</code_context>

<specifics>
## Specific Ideas

- The key insight is "redraw first, then remove transform" — this eliminates the visual pop that would occur if transforms were removed before fresh pixels were ready
- PAL becoming a "slave" to App's zoom state (rather than running its own timer) is a significant simplification — removes an entire class of race conditions
- Stroke-accuracy testing is important because the coordinate system derivation is changing — a quick smoke test could miss subtle pointer offset bugs

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-pal-zoom-simplification*
*Context gathered: 2026-03-19*
