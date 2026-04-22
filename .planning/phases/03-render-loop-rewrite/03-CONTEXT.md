# Phase 3: Render Loop Rewrite - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current portal host resolution system in the render loop with direct portal creation into the persistent overlay divs (`overlayDivsRef`) created in Phase 1. Portals target overlay divs directly, layerScale uses the live viewer scale (no freezing), and page filtering is simplified. The old stablePortalHost system stays in the codebase but is bypassed — removal happens in Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Portal target swap
- Use `overlayDivsRef.current[pageNumber]` directly as `createPortal()` targets in the render loop — no intermediate stablePortalHost or liveRoot divs
- Keep React keys consistent (`syncfusion-overlay-${pageNumber}`) so mounted PAL instances don't unmount/remount during the transition
- Call `attachOverlayToPageDiv(pageNumber)` in the render loop to ensure overlay divs exist before portaling into them (create-once guard means this is cheap)
- The overlay div IS the portal target — no need for `ensureSyncfusionStablePortalChildren()` or its liveRoot/snapshotRoot subdivision

### layerScale during zoom
- Strictly follow design spec: always use the current viewer scale, NO freezing
- Remove the `zoomFrozenBaseScale` freeze logic from the render loop — freezing the base scale causes the snapping/flickering effect when the settle timer resolves
- Keep layerScale live: `const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1`
- CSS transforms on the overlay divs handle visual scaling during zoom transitions — the canvas doesn't need to know about zoom state
- The complex fallback chain (committedPageScale → measuredPageScale → frozenPageScale) is replaced by the simple live scale

### Page list filtering
- Drastically simplify: only filter pages by whether they are visible/rendered (standard `shouldShowPage` check)
- Remove `shouldFreezePortalHost` logic entirely — CSS transforms handle zoom state natively without needing to freeze the DOM
- Remove `interactionWindowSet` and `syncfusionOverlayWindowPages` filtering — with stable overlay divs that persist across zoom, there's no need to restrict which pages get portals during interactions
- The `syncfusionLastNonEmptyOverlayPagesRef` cached fallback is no longer needed since overlay divs are stable direct children
- Portal creation is still limited to pages that have annotations (no unbounded memory growth per success criteria)

### Old system coexistence
- Keep old stablePortalHost, snapshot roots, presentation mode sync, and ensureSyncfusionStablePortalChildren code in place until Phase 6
- Bypass the old execution paths — don't call them for the new overlay div targets
- `syncSyncfusionZoomPresentationPage()` calls are skipped for the new render path
- `resolveSyncfusionOverlayPortalHost()` is no longer called in the render loop but remains in the codebase
- Old refs (`syncfusionStablePortalHostsRef`, `syncfusionStablePortalLiveRootsRef`, `syncfusionStablePortalSnapshotHostsRef`) stay declared but unused

### Claude's Discretion
- How to structure the simplified render loop code (inline vs extracted helper)
- Error handling for missing overlay divs or disconnected page containers
- Whether to keep or remove the `getPageTransform` call on the outer portal div (may be redundant now that overlay divs themselves get CSS transforms)
- Exact cleanup of `syncfusionOverlayLayerRefs` and `syncfusionOverlayContentRefs` when pages leave the viewport

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Spec
- `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` — Step 3 defines simplified render loop. Shows exact portal structure, layerScale computation, and which components render inside overlay divs (SearchHighlightLayer, PageAnnotationLayer, LightweightAnnotationOverlay).

### Prior Phase Context
- `.planning/phases/01-overlay-attachment-foundation/01-CONTEXT.md` — Phase 1 decisions: overlay div creation, `overlayDivsRef` storage, `attachOverlayToPageDiv()` function
- `.planning/phases/02-zoom-handler/02-CONTEXT.md` — Phase 2 decisions: CSS transform application, settle timer, coexistence strategy

### Requirements
- `.planning/REQUIREMENTS.md` — ZOOM-01 (annotations stay visible during zoom), ZOOM-02 (annotations stay positioned correctly during zoom) are this phase's requirements

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `overlayDivsRef` (App.jsx ~line 9020): Per-page overlay div storage from Phase 1 — the new portal targets
- `attachOverlayToPageDiv()` (App.jsx ~line 12050): Creates/reuses overlay divs with create-once guard — call in render loop
- `applyOverlayZoomTransform()` (App.jsx ~line 12084): Phase 2's CSS transform function — continues to work independently on overlay divs
- `syncfusionViewerScale`: Live scale value — becomes the sole source for layerScale

### Established Patterns
- `createPortal(jsx, targetDiv)` pattern already used at App.jsx ~line 24711 — same structure, just different target
- React key pattern `syncfusion-overlay-${pageNumber}` — keep consistent to prevent unmount/remount
- `shouldShowPage(pageNumber)` — existing visibility filter, becomes the primary page filter

### Integration Points
- Render loop (App.jsx ~lines 24530-24740): Main code area to modify — replace stablePortalHost resolution with overlayDivsRef lookup
- `layerScale` computation (App.jsx ~lines 24668-24681): Replace frozen scale logic with live `syncfusionViewerScale`
- Page filtering (App.jsx ~lines 24586-24600): Simplify to just `shouldShowPage` + has-annotations check
- Phase 4 will add post-settle canvas redraw logic on top of this simplified render loop

</code_context>

<specifics>
## Specific Ideas

- The freeze/snap behavior was the root cause of flickering — removing layerScale freezing is essential, not optional
- CSS transforms on overlay divs handle the visual scaling during zoom; the canvas just renders at whatever the current scale is
- Keep the portal structure simple: overlay div → wrapper div → PAL + SearchHighlightLayer + LightweightAnnotationOverlay

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-render-loop-rewrite*
*Context gathered: 2026-03-18*
