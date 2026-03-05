# Research Summary: Live Zoom Annotation Rendering

**Domain:** PDF annotation layer smooth zoom behavior
**Researched:** 2026-03-04
**Overall confidence:** HIGH

## Executive Summary

The standard approach for smooth annotation scaling during PDF zoom in web-based viewers is the "Scale-During, Render-After" pattern, used by Mozilla pdf.js, Adobe Acrobat, Bluebeam, and DrawboardPDF. CSS `transform: scale()` provides instant GPU-accelerated visual scaling of the annotation layer during active zoom, while an expensive canvas re-render (Fabric.js `renderAll()`) is deferred via debounce until zoom input stops. This eliminates all main-thread rendering work during zoom, guaranteeing 60fps regardless of annotation count.

The existing codebase already implements the core infrastructure for this pattern. The `useZoomState` hook correctly computes `cssScale = targetScale / renderedScale`, provides a debounced `renderedScale`, and generates the CSS `zoomStyle` with `will-change: transform` and `backfaceVisibility: hidden`. However, this infrastructure is not fully wired into the annotation layer rendering lifecycle. The `PageAnnotationLayer` component currently receives the live `scale` and re-renders (or unmounts/remounts) on every scale change, causing annotations to disappear during zoom.

The fix is architectural integration, not new technology. No new libraries are needed. The solution requires: (1) wrapping the annotation layer in a CSS transform container that receives the `zoomStyle` from `useZoomState`, (2) passing `renderedScale` instead of `scale` to `PageAnnotationLayer` so it only re-renders after zoom settles, (3) ensuring the CSS transform-origin matches Syncfusion's page zoom anchor so annotations track the page content exactly, and (4) atomically transitioning from CSS transform to canvas re-render to prevent flicker.

The hardest challenge is transform-origin alignment between Syncfusion's page scaling and the annotation layer's CSS transform. This requires inspecting how Syncfusion positions its page containers during zoom and replicating the same anchor point for the annotation wrapper. The second hardest challenge is flicker prevention during the CSS-transform-to-canvas-rerender transition, which requires batching the transform removal and canvas resize into a single browser paint frame.

## Key Findings

**Stack:** No new libraries needed. CSS `transform: scale()` + existing `useZoomState` hook + existing Fabric.js rendering. The solution is pure architectural wiring.

**Architecture:** Insert a "Zoom Transform Wrapper" div between Syncfusion's page container and the Fabric.js canvases. This wrapper receives CSS `transform: scale(cssScale)` during zoom. The Fabric.js canvases stay at `renderedScale` dimensions and only re-render when `renderedScale` changes (after zoom settles).

**Critical pitfall:** Transform-origin mismatch between page and annotation layer causes annotations to drift during zoom. This is the hardest problem and must be solved first.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: CSS Transform Infrastructure** - Wire `useZoomState.zoomStyle` to annotation layer wrappers
   - Addresses: Annotation visibility during zoom, smooth scaling with page
   - Avoids: Premature Fabric.js re-rendering optimization (not the bottleneck)
   - Key risk: Transform-origin alignment with Syncfusion pages

2. **Phase 2: Transform-Origin Alignment** - Match annotation layer zoom anchor with Syncfusion page zoom anchor
   - Addresses: Positional glitching, cursor-centered zoom
   - Avoids: Modifying Syncfusion internals (observe and match, don't modify)
   - Key risk: Syncfusion's zoom anchor behavior may vary by zoom method

3. **Phase 3: Flicker-Free Transition** - Atomic CSS transform removal + canvas re-render
   - Addresses: No flickering at wrong scale, crisp re-render after zoom
   - Avoids: Over-engineering -- React 18 state batching may handle this naturally
   - Key risk: Fabric.js `renderAll()` may take > 1 frame for complex pages

4. **Phase 4: All Zoom Methods + Edge Cases** - Trackpad pinch, toolbar, keyboard; high-DPI; callout overlay
   - Addresses: All zoom methods supported, callout scaling, Retina display correctness
   - Avoids: Scope creep into annotation interaction during zoom (defer)

**Phase ordering rationale:**
- Phase 1 must come first because CSS transform infrastructure is the foundation for all other phases
- Phase 2 before Phase 3 because there is no point making the transition flicker-free if annotations are at the wrong position
- Phase 3 before Phase 4 because the transition quality must be right before extending to all zoom methods
- Phase 4 is polish -- each zoom method can be tested independently

**Research flags for phases:**
- Phase 1: Standard patterns, unlikely to need research
- Phase 2: Likely needs investigation into Syncfusion's DOM behavior during zoom. How does Syncfusion position/scale its page containers? What CSS transforms or scroll adjustments does it apply? This may require runtime inspection using Chrome DevTools.
- Phase 3: Standard patterns, unlikely to need research
- Phase 4: Minor research may be needed for trackpad pinch event handling specifics in Electron

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | CSS transform + debounced re-render is the universally accepted pattern. Verified via pdf.js PR #19128, MDN canvas optimization docs, Fabric.js community discussions. No new libraries needed. |
| Features | HIGH | Table stakes are clear from professional PDF tool behavior. Feature dependencies are straightforward. |
| Architecture | HIGH | The "Zoom Transform Wrapper" pattern is well-established. The existing `useZoomState` hook already implements the core logic. The gap is wiring, not design. |
| Pitfalls | HIGH | Transform-origin mismatch and flicker during transition are the two known hard problems. Both have clear detection and prevention strategies. The `willReadFrequently` GPU concern is documented with specific DevTools verification steps. |

## Gaps to Address

- **Syncfusion zoom anchor behavior:** Need to inspect at runtime how Syncfusion positions page containers during zoom. This cannot be determined from documentation alone -- requires Chrome DevTools Layers panel and DOM inspection during zoom operations.
- **Fabric.js 5 vs 6 migration:** Fabric.js 6 was released in 2024 with breaking API changes. The project uses v5.5.2. If migration to v6 is planned, verify that `setDimensions()`, `renderAll()`, and object caching APIs are unchanged. This is NOT needed for the zoom project but flagged for awareness.
- **Electron-specific pinch-zoom events:** Electron may handle trackpad pinch events differently from Chrome browser. Need to verify during Phase 4 implementation.
