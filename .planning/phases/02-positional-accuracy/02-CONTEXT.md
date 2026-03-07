# Phase 2: Positional Accuracy - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Align the annotation layer's transform-origin with Syncfusion's page zoom anchor so annotations track page content exactly during zoom. Cursor-centered zoom matching Drawboard PDF / Adobe Acrobat behavior. All visible pages must maintain perfect annotation-to-content alignment.

</domain>

<decisions>
## Implementation Decisions

### Zoom anchor alignment
- Claude investigates Syncfusion's runtime zoom behavior to determine how it anchors zoom (cursor-based, fixed-point, or per-method)
- Claude picks whichever approach (DOM observation, independent computation, or reverse-engineering from page positions) keeps annotations aligned with zero drift
- The goal is zero positional drift between annotations and page content -- the strategy to achieve it is Claude's discretion
- If Syncfusion's anchor differs per zoom method, Claude determines how to handle each to maintain alignment

### Cursor-centered zoom
- Toolbar zoom buttons: zoom expands from viewport center
- Ctrl+scroll zoom: cursor-centered, scroll adjustment formula tuned to match Syncfusion's behavior (Claude verifies at runtime)
- Pinch zoom: Claude's discretion on whether to use gesture center or defer
- Reference behavior: Drawboard PDF is the gold standard, Adobe Acrobat secondary reference
- Scroll adjustment formula from pdf.js may need tuning -- Claude verifies against Syncfusion's actual post-zoom scroll position

### Per-page alignment
- ALL visible pages must maintain perfect annotation-to-content alignment during zoom -- no tolerance for drift on distant pages
- Overlay positioning strategy (per-page vs document-level float) is Claude's discretion based on what produces the most accurate result
- DOM observation approach (MutationObserver vs per-frame measurement) is Claude's discretion

### Alignment verification
- Use overlay comparison method: add visual markers (crosshairs, bounding boxes) to both annotation layer and page content to make misalignment obvious
- Debug mode toggle vs temporary code is Claude's discretion
- Test across full zoom range (25%-400%)
- Verify alignment both mid-zoom (while CSS transform is active) AND at rest (after canvas re-render)

### Edge cases
- Rapid successive zooms must maintain alignment throughout -- no tolerance for even brief desync
- Document boundary handling (scroll clamping at edges) is Claude's discretion -- prevent visible drift using whatever technique works
- Empty pages: Claude's discretion on whether to compute overlay positions for pages without annotations
- Slight annotation overflow past page boundaries during CSS transform phase is acceptable (corrects on re-render)

### Claude's Discretion
- Syncfusion runtime investigation and anchor matching strategy
- DOM observation vs independent computation approach
- Overlay positioning architecture (per-page vs document-level)
- Debug alignment markers: persistent toggle vs temporary
- Pinch zoom anchor handling
- Empty page optimization
- Boundary/edge handling technique

</decisions>

<specifics>
## Specific Ideas

- "Drawboard PDF has the best zoom but Adobe Acrobat is good too" -- use Drawboard as primary reference for cursor-centered zoom feel
- Alignment must hold across full 25%-400% zoom range
- Mid-zoom alignment is as important as at-rest alignment -- the CSS transform phase must track perfectly, not just the final render
- Rapid zoom sequences (in-out-in-out) must not accumulate drift

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useZoomState` hook (src/hooks/useZoomState.js): Already computes zoomAnchor, cssScale, zoomStyle with transformOrigin -- core infrastructure for Phase 2
- `setScaleWithViewportPreservation` (App.jsx ~line 20216): Already computes cursor+scroll anchor and calls setAnchor -- may need per-method refinement
- `LightweightAnnotationOverlay` (src/components/LightweightAnnotationOverlay.jsx): Zoom preview layer from Phase 1 -- needs positional accuracy improvements
- `zoomController` (src/utils/zoomController.js): Manages zoom modes and scale clamping

### Established Patterns
- Zoom anchor = cursorX + container.scrollLeft, cursorY + container.scrollTop (pdf.js formula)
- Scroll adjustment after zoom: scroll += cursor * (scaleFactor - 1)
- `syncfusionWheelZoomAnchorRef` tracks wheel zoom anchor separately
- `syncfusionInteractionPhase` state machine controls overlay show/hide
- Multiple transform-origin patterns exist in App.jsx (lines 9578-10068, 11657-11679) for various interaction states

### Integration Points
- App.jsx line ~9121: useZoomState consumption (renderedScale, cssScale, isZooming, zoomStyle, setAnchor)
- App.jsx line ~20229-20232: setAnchor call in setScaleWithViewportPreservation
- App.jsx line ~23470: LightweightAnnotationOverlay instance
- App.jsx line ~23572, ~23756: zoomStyle application to annotation containers
- Syncfusion viewer's magnificationModule.initiateMouseZoom for cursor-anchored zoom

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 02-positional-accuracy*
*Context gathered: 2026-03-07*
