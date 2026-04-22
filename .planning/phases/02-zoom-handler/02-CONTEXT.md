# Phase 2: Zoom Handler - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply CSS `transform: scale(ratio)` with `transform-origin: top left` to overlay divs during zoom operations across all 6 zoom methods. Annotations stay visually stable (blurry but present, never disappearing or jumping). The old portal host rendering system stays intact — CSS transforms are applied independently to the new overlay divs alongside the existing system.

</domain>

<decisions>
## Implementation Decisions

### Settle timer behavior
- Use 1000ms settle timer per design spec (not the current 3000ms confirm-pending timer)
- Standard debounce pattern: reset the timer on each new zoom action so it only fires 1000ms after zooming has completely stopped
- On settle: remove CSS transforms from overlay divs, update scale state for canvas redraw

### Coexistence with old system
- Leave old zoom code largely intact — do not remove freeze/snapshot/confirm-pending machinery yet (that's Phase 6)
- Apply new CSS transforms independently to the new overlay divs (`overlayDivsRef`)
- Both systems run in parallel without interfering — old system continues to render annotations through old portal hosts, new system applies transforms to (currently empty) overlay divs
- This means Phase 2 adds the new zoom handler logic alongside the existing code, not replacing it

### Transform scope & application
- Apply CSS transforms only to visible or currently annotated pages (not all overlay divs) for performance
- Global base-scale tracking: capture the starting scale when zoom begins, compute `ratio = newScale / baseScale`
- Pointer event coordination: disable pointer events on overlay divs while zoom is actively occurring, restore when settle timer completes
- PAL's existing pointer-event management on its own canvas element is unchanged

### Testing & verification
- Add temporary visual indicators on overlay divs (faint semi-transparent colored background or border) so CSS transforms are visible during zoom even though overlays are empty
- Add Playwright assertions on computed styles to verify transforms are applied/removed correctly
- Visual indicators removed in Phase 3 when real rendering moves into overlays

### Claude's Discretion
- Exact implementation of the debounce timer (useRef-based vs separate utility)
- How to capture base scale for ratio calculation (on first zoom event vs tracking continuously)
- Which zoom entry points need modification vs which can be left alone because they flow through `handleSyncfusionZoomChange`
- Whether keyboard/toolbar and ctrl+key handlers need separate transform logic or can rely on the main handler

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Spec
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` — Step 2 defines zoom handler simplification, which handlers to modify, what to remove from zoom paths. Steps 2a-2d cover all 4 zoom entry points.

### Phase 1 Context
- `.planning/phases/01-overlay-attachment-foundation/01-CONTEXT.md` — Phase 1 decisions, overlay div creation approach, code context for `overlayDivsRef` and `attachOverlayToPageDiv()`

### Requirements
- `.planning/REQUIREMENTS.md` — OVLY-02, ZOOM-03 through ZOOM-08, ZOOM-10 are the requirements for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `overlayDivsRef` (App.jsx ~line 9019): Per-page overlay div storage created in Phase 1
- `attachOverlayToPageDiv()` (App.jsx ~line 12028): Creates/reuses overlay divs as direct children of page divs
- `handleSyncfusionZoomChange()` (App.jsx ~line 12375): Main zoom handler — entry point for Syncfusion `onZoomChanged` events
- `zoomOverlayTransformActiveRef` (App.jsx ~line 9004): Existing ref tracking whether zoom transform is active — can be reused or adapted
- `scaleRef` (App.jsx): Holds current scale value, updated during zoom

### Established Patterns
- Debounce/settle timers using `useRef` + `setTimeout`/`clearTimeout` — used throughout App.jsx for interaction timers
- `markSyncfusionInteractionActive()` — called during zoom to signal interaction state
- `bumpOverlayLagEventTotal()` — called during zoom for metrics tracking

### Integration Points
- 4 zoom entry points per design spec: `handleSyncfusionZoomChange` (main), keyboard/toolbar handler (~line 21204), ctrl+key handler (~line 21691), finalize-idle handler (~line 10663)
- `overlayDivsRef.current[pageNumber]` provides the DOM elements to apply CSS transforms to
- Phase 3 will consume the settle timer signal to know when to update `layerScale` for canvas redraw
- Phase 4 will add post-settle canvas redraw logic (crisp rendering after zoom)

</code_context>

<specifics>
## Specific Ideas

- Debounce approach mirrors standard UX pattern: only "commit" the zoom after user stops zooming for 1 second
- Visual indicators during Phase 2 testing should be obvious enough to see transform scaling but subtle enough not to obscure PDF content (e.g., `rgba(0, 128, 255, 0.1)` background with `1px dashed blue` border)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-zoom-handler*
*Context gathered: 2026-03-17*
