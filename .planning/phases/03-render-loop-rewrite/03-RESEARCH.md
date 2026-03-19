# Phase 3: Render Loop Rewrite - Research

**Researched:** 2026-03-18
**Domain:** React portal rendering, DOM manipulation, Syncfusion PDF viewer overlay system
**Confidence:** HIGH

## Summary

Phase 3 rewrites the render loop in App.jsx (~lines 24509-24930) to create React portals directly into the persistent overlay divs (`overlayDivsRef`) established in Phase 1, replacing the old `stablePortalHost` / `stableLiveRoot` / `snapshotRoot` portal target system. The render loop simplification has three pillars: (1) portal targets become `overlayDivsRef.current[pageNumber]` instead of going through `resolveSyncfusionOverlayPortalHost()` and `ensureSyncfusionStablePortalChildren()`, (2) `layerScale` uses the live `syncfusionViewerScale` with no freezing, and (3) page filtering reduces to `shouldShowPage(pageNumber)` plus a has-annotations check.

The old system's complexity (~250 lines of freeze/snapshot/window-set/fallback logic before the `.map()`) exists entirely because portal targets were unstable during zoom. Since Phase 1 overlay divs are persistent DOM nodes that survive Syncfusion page container recreation (they are re-attached by `attachOverlayToPageDiv`), and Phase 2 CSS transforms handle visual scaling, none of that complexity is needed. The old system code stays in the codebase but is bypassed -- removal happens in Phase 6.

**Primary recommendation:** Replace the entire render loop from the page-number filtering through `createPortal()` call with a simplified version that calls `attachOverlayToPageDiv(pageNumber)` for the portal target and uses `syncfusionViewerScale` directly as `layerScale`. Keep all child components (SearchHighlightLayer, PageAnnotationLayer, LightweightAnnotationOverlay, SpaceRegionOverlay, region selection) and their props intact.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use `overlayDivsRef.current[pageNumber]` directly as `createPortal()` targets in the render loop -- no intermediate stablePortalHost or liveRoot divs
- Keep React keys consistent (`syncfusion-overlay-${pageNumber}`) so mounted PAL instances don't unmount/remount during the transition
- Call `attachOverlayToPageDiv(pageNumber)` in the render loop to ensure overlay divs exist before portaling into them (create-once guard means this is cheap)
- The overlay div IS the portal target -- no need for `ensureSyncfusionStablePortalChildren()` or its liveRoot/snapshotRoot subdivision
- Strictly follow design spec: always use the current viewer scale, NO freezing
- Remove the `zoomFrozenBaseScale` freeze logic from the render loop -- freezing the base scale causes the snapping/flickering effect when the settle timer resolves
- Keep layerScale live: `const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1`
- CSS transforms on the overlay divs handle visual scaling during zoom transitions -- the canvas doesn't need to know about zoom state
- The complex fallback chain (committedPageScale -> measuredPageScale -> frozenPageScale) is replaced by the simple live scale
- Drastically simplify: only filter pages by whether they are visible/rendered (standard `shouldShowPage` check)
- Remove `shouldFreezePortalHost` logic entirely
- Remove `interactionWindowSet` and `syncfusionOverlayWindowPages` filtering
- The `syncfusionLastNonEmptyOverlayPagesRef` cached fallback is no longer needed since overlay divs are stable direct children
- Portal creation is still limited to pages that have annotations (no unbounded memory growth per success criteria)
- Keep old stablePortalHost, snapshot roots, presentation mode sync, and ensureSyncfusionStablePortalChildren code in place until Phase 6
- Bypass the old execution paths -- don't call them for the new overlay div targets
- `syncSyncfusionZoomPresentationPage()` calls are skipped for the new render path
- `resolveSyncfusionOverlayPortalHost()` is no longer called in the render loop but remains in the codebase
- Old refs stay declared but unused

### Claude's Discretion
- How to structure the simplified render loop code (inline vs extracted helper)
- Error handling for missing overlay divs or disconnected page containers
- Whether to keep or remove the `getPageTransform` call on the outer portal div (may be redundant now that overlay divs themselves get CSS transforms)
- Exact cleanup of `syncfusionOverlayLayerRefs` and `syncfusionOverlayContentRefs` when pages leave the viewport

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ZOOM-01 | Annotations stay visible during all zoom operations (never disappear or flash out) | Portal targets are persistent overlay divs that survive zoom; `attachOverlayToPageDiv()` re-attaches if needed; no freeze/unfreeze cycle that could cause unmount |
| ZOOM-02 | Annotations stay positioned correctly during zoom (never jump to wrong location/size) | `layerScale` uses live `syncfusionViewerScale` (no frozen/stale scale values); CSS transforms on overlay divs handle visual scaling; no scale-commit snap |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | `createPortal()` for rendering into overlay divs | Already in use; portals render into any DOM node by reference |
| Syncfusion PDF Viewer | existing | Provides page containers, zoom events, page scale | Already in use; unchanged by this phase |
| Fabric.js | 5.5.2 (existing) | Canvas annotation rendering inside PAL | Already in use; unchanged by this phase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Playwright | existing | E2E tests verifying portals render into overlay divs | Phase verification tests |

No new libraries are needed for this phase. The work is entirely restructuring existing React render logic.

## Architecture Patterns

### Current Render Loop Structure (being replaced)
```
Lines 24509-24930 in App.jsx:
1. Compute syncfusionViewerScale from viewer API
2. Compute shouldFreezeOverlayScale, shouldFreezePortalHost flags
3. Build interactionWindowSet from multiple page sets
4. Build frozenPageNumbers with 4-level fallback chain
5. Build overlayWindowPageNumbers from interaction window or frozen pages
6. Build effectiveOverlayPages with lastNonEmpty cache fallback
7. Filter pages by shouldShowPage + interaction window/freeze rules
8. For each page:
   a. Call resolveSyncfusionOverlayPortalHost() -> pageHost
   b. Compute resolvedPageSize with fallback dimensions from cached rects
   c. Create stablePortalHost div, attach to pageHost
   d. Call ensureSyncfusionStablePortalChildren() -> liveRoot, snapshotRoot
   e. Call syncSyncfusionZoomPresentationPage()
   f. Compute layerScale through 20-line frozen/committed/measured chain
   g. Compute shouldRenderLightweightAnnotations
   h. createPortal(..., stableLiveRoot)
```

### Target Render Loop Structure (Phase 3)
```
Lines 24509-24930 in App.jsx (simplified):
1. Compute syncfusionViewerScale from viewer API (KEEP - line 24510-24516)
2. Get containerPageNumbers from syncfusionPageContainers (KEEP)
3. Filter pages: shouldShowPage(pageNumber) && has annotations or regions
4. For each page:
   a. Call attachOverlayToPageDiv(pageNumber) -> overlayDiv (portal target)
   b. Compute resolvedPageSize from pageSizes[pageNumber] (simpler fallback)
   c. layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1
   d. Compute shouldRenderLightweightAnnotations (KEEP existing logic)
   e. createPortal(..., overlayDiv)
```

### Pattern 1: Direct Portal into Overlay Div
**What:** Replace the multi-layer portal target chain with a direct `createPortal()` into `overlayDivsRef.current[pageNumber]`
**When to use:** Always -- this is the new standard for the entire render loop
**Example:**
```jsx
// Source: design spec Step 3 + CONTEXT.md decisions
const overlayDiv = attachOverlayToPageDiv(pageNumber);
if (!overlayDiv) return null;

const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1;

return createPortal(
  <div
    key={`syncfusion-overlay-${pageNumber}`}
    ref={(node) => {
      if (node) {
        syncfusionOverlayLayerRefs.current[pageNumber] = node;
      } else {
        delete syncfusionOverlayLayerRefs.current[pageNumber];
      }
    }}
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 20,
    }}
  >
    {/* SearchHighlightLayer, PAL, LightweightAnnotationOverlay, SpaceRegionOverlay, region selection */}
  </div>,
  overlayDiv  // <-- direct portal target, NOT stableLiveRoot
);
```

### Pattern 2: Simplified Page Filtering
**What:** Replace the 80-line freeze/window/fallback page filtering with a simple two-condition filter
**When to use:** The page number list generation before `.map()`
**Example:**
```jsx
// Source: CONTEXT.md locked decisions
const containerPageNumbers = Object.keys(syncfusionPageContainers)
  .map(k => Number(k))
  .filter(n => Number.isFinite(n) && n > 0);

return containerPageNumbers
  .filter(pageNumber => {
    if (!shouldShowPage(pageNumber)) return false;
    // Limit portals to pages with annotations, regions, or search highlights
    // to avoid unbounded memory growth (success criteria #3)
    const hasAnnotations = annotationsByPage[pageNumber]?.objects?.length > 0;
    const hasRegions = getPageRegions(pageNumber)?.length > 0;
    const hasSearchHighlights = searchResultsByPage[pageNumber]?.length > 0;
    return hasAnnotations || hasRegions || hasSearchHighlights;
  })
  .sort((a, b) => a - b)
  .map(pageNumber => { /* ... */ });
```

### Pattern 3: Simplified layerScale
**What:** Replace the 20-line frozen/committed/measured/fallback scale chain with a single live value
**When to use:** Every page's `layerScale` computation
**Example:**
```jsx
// Source: CONTEXT.md locked decisions
// OLD: 20 lines involving committedPageScale, measuredPageScale, frozenPageScale,
//      zoomFrozenBaseScale, shouldFreezeOverlayScale, fallbackPageScale
// NEW: single expression
const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1;
```

### Pattern 4: Simplified resolvedPageSize
**What:** Compute page dimensions from `pageSizes` state without cached rect fallbacks
**When to use:** Every page in the render loop
**Example:**
```jsx
// Source: analysis of current code
const pageSize = pageSizes[pageNumber];
if (!pageSize) return null;  // Page size not yet known -- skip this render

// No need for fallbackWidth/fallbackHeight/cachedRect/derivedPageSize chain.
// pageSizes is populated by Syncfusion document load and page change events.
// With stable overlay divs, we don't need to handle the "host is disconnected
// so dimensions are 0" case -- the overlay div dimensions come from CSS 100%.
const resolvedPageSize = pageSize;
```

### Anti-Patterns to Avoid
- **Calling old system functions in the new path:** Do NOT call `resolveSyncfusionOverlayPortalHost()`, `ensureSyncfusionStablePortalChildren()`, or `syncSyncfusionZoomPresentationPage()` from within the new render loop. They must be bypassed, not mixed in.
- **Partial freeze removal:** Do NOT keep any freeze logic "just in case." The entire freeze mechanism (`shouldFreezePortalHost`, `shouldFreezeOverlayScale`, `zoomFrozenBaseScale`, `frozenPageNumbers`) must be removed from the new render path. The old code stays in the file but is unreachable.
- **Removing child components:** ALL child components inside the portal must be preserved exactly: SearchHighlightLayer, PageAnnotationLayer (with all props except `isHidden`, `onScaleApplied`, `presentationApiRegistry`), LightweightAnnotationOverlay, SpaceRegionOverlay, and the region selection div. Missing any one would break functionality.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Portal target stability | Custom ref-tracking system for portal targets | `overlayDivsRef.current[pageNumber]` from Phase 1 | Already built, tested, and proven stable across zoom |
| CSS zoom transforms | Custom transform calculation in render loop | `applyOverlayZoomTransform()` from Phase 2 | Phase 2 handles all CSS transform logic independently |
| Page div lookup | Custom DOM queries in render loop | `attachOverlayToPageDiv(pageNumber)` from Phase 1 | Has create-once guard, handles page div lookup, idempotent |
| Scale computation | Frozen/committed/measured scale chain | Live `syncfusionViewerScale` | CSS transforms handle visual scaling; canvas just needs current scale |

**Key insight:** The entire complexity of the old render loop existed to compensate for unstable portal targets and the need to freeze rendering during zoom. With stable overlay divs (Phase 1) and CSS transforms (Phase 2), no compensation is needed.

## Common Pitfalls

### Pitfall 1: Removing Props That PAL Still Needs
**What goes wrong:** Removing `isInteracting` or `isZooming` props from PAL, thinking they're part of the old system
**Why it happens:** These props sound zoom-related, but they serve a different purpose (deferring expensive canvas resize during scroll/drag/zoom)
**How to avoid:** Only remove the three props specified in CONTEXT.md: `isHidden`, `onScaleApplied`, `presentationApiRegistry`. Keep ALL other props exactly as-is.
**Warning signs:** PAL starts doing expensive Fabric.js redraws during every scroll/pan event

### Pitfall 2: Missing the SpaceRegionOverlay and Region Selection Components
**What goes wrong:** The simplified portal only includes SearchHighlightLayer, PAL, and LightweightAnnotationOverlay -- missing SpaceRegionOverlay and the region selection div
**Why it happens:** The design spec (Step 3) shows three components, but the actual codebase has five sibling components inside each portal
**How to avoid:** Copy ALL five sibling components from the current render loop: SearchHighlightLayer (line 24793), PAL wrapped in visibility div (line 24804), LightweightAnnotationOverlay (line 24862), SpaceRegionOverlay (line 24880), and region-selection-target div (line 24907)
**Warning signs:** Space region overlays or region selection tool stops working after the rewrite

### Pitfall 3: Breaking the shouldHideFullLayer / Proxy Rendering Logic
**What goes wrong:** Removing the `shouldHideFullLayer` / `shouldRenderLightweightAnnotations` logic thinking it's part of the freeze system
**Why it happens:** These variables use `syncfusionInteractionPhase` which sounds freeze-related
**How to avoid:** Keep the entire proxy rendering system intact -- `shouldRenderLightweightAnnotations`, `shouldHideFullLayer`, `proxyPayload`, etc. are for scroll/drag proxy rendering, NOT zoom freezing. They use the interaction phase system which stays per CONTEXT.md.
**Warning signs:** Scrolling becomes janky because LightweightAnnotationOverlay proxy rendering doesn't kick in

### Pitfall 4: Portal Target Being Null on First Render
**What goes wrong:** `attachOverlayToPageDiv(pageNumber)` returns a created-but-not-attached overlay div (page div not in DOM yet)
**Why it happens:** On first render after PDF load, Syncfusion page containers may not exist yet
**How to avoid:** The function already handles this -- it returns the overlay div even if not attached. React's `createPortal` can render into a detached DOM node (content will appear when the node is attached to the DOM). Check for null but don't check `isConnected`.
**Warning signs:** Annotations briefly missing on PDF load (should resolve within a frame or two as page containers appear)

### Pitfall 5: getPageTransform on Outer Portal Div
**What goes wrong:** Double-applying page rotation/mirror transforms -- once on the outer portal div and once on the overlay div via CSS transforms
**Why it happens:** The current render loop applies `getPageTransform(pageNumber)` on the outer wrapper div (line 24729). The overlay div already gets CSS zoom transforms from Phase 2.
**How to avoid:** This is a discretion area per CONTEXT.md. The `getPageTransform` returns rotation/mirror transforms (not zoom transforms). Since the overlay div is a child of the page div which Syncfusion already rotates/mirrors, the `getPageTransform` on the portal content wrapper is likely redundant. Test with and without it. If page rotation works correctly without it, remove it.
**Warning signs:** Annotations appear rotated or mirrored incorrectly on pages with non-default orientation

### Pitfall 6: Losing the syncfusionOverlayContentRefs Callback
**What goes wrong:** The inner content div's ref callback (lines 24734-24790) contains complex logic for transform reapplication during zoom. Removing it entirely breaks the old system's expectations.
**Why it happens:** The inner div ref callback is deeply intertwined with the old confirm-pending/presentation mode system
**How to avoid:** In the new render loop, the inner content div does not need any of the old ref callback logic. A simple ref callback for `syncfusionOverlayContentRefs` tracking (or removal of it entirely) is sufficient. The old system's refs (`syncfusionOverlayTransformRatioByPageRef`, `syncfusionOverlayTransformNodeByPageRef`) are not used by the new path.
**Warning signs:** None expected -- removing this callback is the correct action for the new path

## Code Examples

### Complete Simplified Render Loop (Recommended Implementation)

```jsx
// Source: synthesis of CONTEXT.md decisions + current codebase analysis
// Location: App.jsx ~lines 24509-24930 (inside the useSyncfusionRenderer conditional)

{numPages > 0 && (() => {
  const syncfusionViewerScale = clampScale(
    Number(
      (syncfusionViewerRef.current?.getZoomValue?.() ??
        syncfusionViewerRef.current?.zoomValue ??
        scale * 100)
    ) / 100
  );
  // KEEP: interaction state variables used by proxy rendering
  const useLiveStableOverlay = syncfusionLiveStableOverlayEnabled && syncfusionDualLayerEnabled;
  const isZoomOnlyInteraction = syncfusionInteractionIsZoomOnlyRef.current;

  // SIMPLIFIED: page list is just container pages filtered by visibility + content
  const containerPageNumbers = Object.keys(syncfusionPageContainers)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n) && n > 0);

  return containerPageNumbers
    .filter(pageNumber => {
      if (!shouldShowPage(pageNumber)) return false;
      // Limit portals to pages with content to avoid unbounded memory growth
      const hasAnnotations = annotationsByPage[pageNumber]?.objects?.length > 0;
      const hasRegions = getPageRegions(pageNumber)?.length > 0;
      const hasSearchHighlights = searchResultsByPage[pageNumber]?.length > 0;
      return hasAnnotations || hasRegions || hasSearchHighlights;
    })
    .sort((a, b) => a - b)
    .map(pageNumber => {
      const overlayDiv = attachOverlayToPageDiv(pageNumber);
      if (!overlayDiv) return null;

      const pageSize = pageSizes[pageNumber];
      if (!pageSize) return null;

      // SIMPLIFIED: live scale, no freezing
      const layerScale = syncfusionViewerScale > 0 ? syncfusionViewerScale : 1;

      // KEEP: proxy rendering logic for scroll/drag interactions
      const pageRegions = getPageRegions(pageNumber);
      const pageAnnotations = annotationsByPage[pageNumber];
      const interactionPageMode = syncfusionInteractionPageModes[pageNumber] || 'full';
      const isProxyPageWhileInteracting = interactionPageMode === 'proxy';
      const isProxyPageWhileCommitting = syncfusionCommittingProxyPages.has(pageNumber);
      const shouldRenderLightweightAnnotations = useLiveStableOverlay && !isZoomOnlyInteraction && (
        (syncfusionInteractionPhase === 'interacting' && isProxyPageWhileInteracting) ||
        (syncfusionInteractionPhase === 'committing' && isProxyPageWhileCommitting)
      );
      // ... (annotation/callout/proxy revision variables -- keep as-is)
      const shouldHideFullLayer = /* ... keep existing logic ... */;

      return createPortal(
        <div
          key={`syncfusion-overlay-${pageNumber}`}
          ref={(node) => {
            if (node) {
              syncfusionOverlayLayerRefs.current[pageNumber] = node;
            } else {
              delete syncfusionOverlayLayerRefs.current[pageNumber];
            }
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {/* ALL FIVE sibling components preserved exactly */}
          {/* 1. SearchHighlightLayer */}
          {/* 2. PAL in visibility wrapper (remove isHidden/onScaleApplied/presentationApiRegistry props) */}
          {/* 3. LightweightAnnotationOverlay */}
          {/* 4. SpaceRegionOverlay */}
          {/* 5. Region selection div */}
        </div>,
        overlayDiv  // Direct portal target -- THE key change
      );
    });
})()}
```

### What Gets Removed from Render Loop (Lines to Delete/Bypass)

```jsx
// These lines/blocks are REMOVED from the new render loop:
// (old code stays in file but is unreachable from the new path)

// Lines 24520-24525: shouldFreezeOverlayScale, shouldFreezePortalHost computation
// Lines 24526-24536: useInteractionWindow, interactionWindowSet building
// Lines 24541-24577: frozenPageNumbers with 4-level fallback, overlayWindowPageNumbers
// Lines 24579-24584: effectiveOverlayPages with lastNonEmpty cache
// Lines 24590-24599: Freeze/interaction-window filter predicates
// Lines 24604-24608: resolveSyncfusionOverlayPortalHost() call
// Lines 24611-24627: fallbackWidth/fallbackHeight/cachedRect/derivedPageSize chain
// Lines 24636-24654: stablePortalHost creation, attachment, ensureSyncfusionStablePortalChildren, syncSyncfusionZoomPresentationPage
// Lines 24656-24681: committedPageScale, shouldMeasureLiveScale, measuredPageScale, frozenPageScale, zoomFrozenBaseScale, layerScaleRaw chain
// Lines 24729-24730: getPageTransform on outer div (discretion -- likely remove)
// Lines 24733-24791: Inner content div with complex ref callback (transform reapplication)
// Line 24855: isHidden prop on PAL
// Line 24858: onScaleApplied prop on PAL
// Line 24859: presentationApiRegistry prop on PAL
// Line 24928: stableLiveRoot as portal target (replaced by overlayDiv)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stable portal host with live/snapshot roots | Direct portal into overlay div | Phase 3 (this phase) | Eliminates 200+ lines of freeze/presentation logic |
| Frozen layerScale during zoom | Live syncfusionViewerScale always | Phase 3 (this phase) | Eliminates scale-commit snap/flicker |
| Interaction window page filtering | shouldShowPage + has-annotations | Phase 3 (this phase) | Eliminates 60+ lines of page set logic |

**Deprecated/outdated (but kept until Phase 6):**
- `resolveSyncfusionOverlayPortalHost()`: replaced by `attachOverlayToPageDiv()`
- `ensureSyncfusionStablePortalChildren()`: no longer needed -- overlay div is the portal target directly
- `syncSyncfusionZoomPresentationPage()`: presentation mode (live/snapshot visibility toggle) eliminated
- `syncfusionStablePortalHostsRef`, `syncfusionStablePortalLiveRootsRef`, `syncfusionStablePortalSnapshotHostsRef`: replaced by `overlayDivsRef`
- `syncfusionLastNonEmptyOverlayPagesRef`, `syncfusionFrozenOverlayPagesRef`: no longer needed with stable portal targets
- `syncfusionCachedPageRectsRef`: no longer needed for dimension fallbacks
- `zoomFrozenBaseScale` in render loop: replaced by live scale
- `shouldFreezePortalHost`, `shouldFreezeOverlayScale`: eliminated entirely

## Open Questions

1. **`getPageTransform` on outer portal wrapper div**
   - What we know: Currently applies rotation/mirror transforms (line 24729). The overlay div is a child of the Syncfusion page div. Syncfusion may or may not apply rotation transforms to its page div.
   - What's unclear: Whether removing `getPageTransform` breaks page rotation rendering
   - Recommendation: Test with and without. If rotation works correctly without it (meaning Syncfusion handles rotation on the page div), remove it for simplicity. If not, keep it. This is Claude's discretion per CONTEXT.md.

2. **resolvedPageSize fallback when pageSizes is empty**
   - What we know: `pageSizes[pageNumber]` could be undefined for pages that haven't been measured yet. The old code had a complex fallback using `pageHost.clientWidth` and cached rects.
   - What's unclear: How often `pageSizes` is missing for visible pages in practice
   - Recommendation: Return `null` (skip portal for this page) when `pageSizes[pageNumber]` is undefined. The page will get a portal on the next render once its size is known. This is simpler than maintaining fallback dimension chains.

3. **syncfusionOverlayContentRefs cleanup**
   - What we know: The inner content div ref callback currently manages `syncfusionOverlayContentRefs`. The new render loop may not need this ref at all.
   - What's unclear: Whether any other code reads `syncfusionOverlayContentRefs` for non-zoom purposes
   - Recommendation: Keep a simple ref callback that tracks `syncfusionOverlayContentRefs[pageNumber]` for potential use by Phase 4 (canvas redraw after settle), but remove all the transform reapplication logic from it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (via @playwright/test) |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test debug/scenarios/render-loop.spec.mjs --reporter=list` |
| Full suite command | `npx playwright test debug/scenarios/ --reporter=list` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZOOM-01 | Annotations stay visible during ctrl+scroll zoom | e2e | `npx playwright test debug/scenarios/render-loop.spec.mjs -g "annotations stay visible during zoom" --reporter=list` | No - Wave 0 |
| ZOOM-01 | Annotations stay visible during toolbar zoom | e2e | `npx playwright test debug/scenarios/render-loop.spec.mjs -g "annotations stay visible during toolbar zoom" --reporter=list` | No - Wave 0 |
| ZOOM-02 | Annotations positioned correctly (no jump/snap) | e2e | `npx playwright test debug/scenarios/render-loop.spec.mjs -g "annotations positioned correctly" --reporter=list` | No - Wave 0 |
| ZOOM-02 | layerScale uses live viewer scale (no frozen value) | e2e | `npx playwright test debug/scenarios/render-loop.spec.mjs -g "layerScale uses live scale" --reporter=list` | No - Wave 0 |
| SC-3 | Portal creation limited to annotated/visible pages | e2e | `npx playwright test debug/scenarios/render-loop.spec.mjs -g "portals only for annotated pages" --reporter=list` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test debug/scenarios/render-loop.spec.mjs --reporter=list`
- **Per wave merge:** `npx playwright test debug/scenarios/ --reporter=list`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `debug/scenarios/render-loop.spec.mjs` -- covers ZOOM-01, ZOOM-02, and portal filtering (success criteria #3)
- [ ] Reuse `setupPage()` helper pattern from existing `zoom-handler.spec.mjs` and `overlay-attachment.spec.mjs`
- [ ] Tests should verify: portals target `[data-overlay-page]` divs (not `[data-stable-live-root]`), annotations visible before/during/after zoom, no stale scale values

## Sources

### Primary (HIGH confidence)
- **Design spec:** `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md` -- Step 3 defines the simplified render loop
- **CONTEXT.md:** `.planning/phases/03-render-loop-rewrite/03-CONTEXT.md` -- All locked decisions
- **Phase 1 CONTEXT:** `.planning/phases/01-overlay-attachment-foundation/01-CONTEXT.md` -- overlayDivsRef, attachOverlayToPageDiv
- **Phase 2 CONTEXT:** `.planning/phases/02-zoom-handler/02-CONTEXT.md` -- CSS transform system, settle timer

### Secondary (HIGH confidence - direct code analysis)
- **App.jsx render loop:** Lines 24509-24930 -- current implementation analyzed line-by-line
- **App.jsx refs:** Lines 9000-9040 -- old and new ref declarations
- **attachOverlayToPageDiv:** Lines 12043-12081 -- Phase 1 function
- **applyOverlayZoomTransform:** Lines 12083-12113 -- Phase 2 CSS transform function
- **startOverlayZoomSettleTimer:** Lines 12115-12176 -- Phase 2 settle timer

### Tertiary (MEDIUM confidence)
- **React createPortal behavior with detached nodes:** Based on React 18 documentation -- React renders into the target DOM node by reference; content appears when node is attached to the document. This is standard React behavior but should be verified in practice.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, using existing codebase components
- Architecture: HIGH - direct code analysis of all 400+ lines being modified, locked decisions from CONTEXT.md
- Pitfalls: HIGH - identified from line-by-line analysis of current render loop and understanding of component dependencies
- Validation: MEDIUM - test patterns follow established project convention but tests don't exist yet

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable -- no external dependencies changing)
