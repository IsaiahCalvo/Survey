# Feature Landscape: Smooth Zoom Annotation Rendering

**Domain:** PDF annotation layer zoom behavior
**Researched:** 2026-03-04

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Annotations stay visible during zoom | Adobe Acrobat, Bluebeam, Drawboard all show annotations throughout zoom. Disappearing annotations feels broken. | Medium | Root cause of the project. CSS transform on annotation wrapper solves this. |
| Annotations scale with page during zoom | Annotations must track page geometry exactly. If page scales but annotations don't, they appear to "float" off their anchors. | Medium | CSS transform on the annotation layer container must use the same transform-origin as Syncfusion's page scaling. |
| Crisp re-render after zoom settles | Mid-zoom CSS scaling produces bitmap interpolation artifacts (blurriness). Users expect sharp annotations at the final zoom level. | Low | Already works -- the current rendering at static zoom levels is correct. Debounced re-render restores crispness. |
| All zoom methods supported | Trackpad pinch, Ctrl/Cmd+scroll, toolbar buttons, keyboard shortcuts. Users expect consistent behavior across all. | Medium | Each method fires different events. Must ensure CSS transform path is triggered regardless of zoom source. |
| No positional glitching | Annotations must not jump to wrong positions during or after zoom transitions. | High | Requires matching transform-origin between Syncfusion page and annotation layer. Hardest part of implementation. |
| No flickering at wrong scale | After zoom settles, annotations must not briefly appear at the old scale before re-rendering at the new scale. | Medium | Must atomically remove CSS transform and apply new canvas dimensions in the same frame. |
| Smooth performance (no jank) | Zoom must maintain 60fps. Any frame drops are perceivable as "hitching." | Medium | CSS transform inherently maintains 60fps since it is GPU-composited. Risk is in the re-render phase causing a frame drop. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cursor-centered zoom | Zoom expands from cursor position rather than center of viewport. Matches Acrobat/Drawboard UX. | Medium | `useZoomState` already computes `zoomAnchor`. Must pass anchor to CSS transform-origin correctly. |
| Progressive quality during zoom | Show CSS-scaled version immediately, then progressively sharpen as zoom stabilizes. | Low | Natural behavior of the CSS transform + debounced re-render pattern. Not extra work. |
| Multi-scale cache | Keep rendered canvases at multiple zoom levels to avoid re-render when zooming back to a previously visited level. | Low | `renderQueue.js` already has `multiScaleCache` with 3-level LRU. Wire annotation layer into this. |
| Annotation interaction during zoom | Allow selecting/editing annotations even while zoom is in CSS transform state. | High | Requires converting mouse coordinates through the CSS transform matrix. Defer this -- most tools block interaction during zoom. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time Fabric.js re-render during zoom | Defeats the entire optimization. Fabric.js `renderAll()` iterates all objects per call. | Use CSS transform for visual scaling, Fabric.js only for post-zoom crisp render. |
| WebGL rendering migration | Massive scope creep. The zoom problem is not rendering speed, it is eliminating renders during zoom. | CSS transform solves the problem regardless of rendering engine. |
| Custom zoom animation curves | CSS transitions on scale create input lag and fight with user gesture input. | Apply CSS transform synchronously with no transition/animation. |
| OffscreenCanvas for annotation rendering | Adds complexity. CSS transform already eliminates main-thread rendering during zoom. Post-zoom render is fast enough on main thread. | Only revisit if annotation counts exceed 500+ per page. |
| SVG proxy during zoom | `LightweightAnnotationOverlay` exists but is a simplified approximation. CSS transform on the full canvas is more faithful and simpler. | Use CSS transform on the existing rendered canvas bitmap. SVG proxy remains useful for scroll virtualization of off-screen pages. |

## Feature Dependencies

```
CSS Transform Infrastructure --> Annotation Visibility During Zoom
CSS Transform Infrastructure --> Smooth Scaling With Page
CSS Transform Infrastructure --> Cursor-Centered Zoom
Annotation Visibility During Zoom --> No Positional Glitching (requires correct transform-origin)
No Positional Glitching --> No Flickering (must nail positioning before addressing flicker)
No Flickering --> Crisp Re-render After Zoom (flicker-free transition to re-rendered state)
All Zoom Methods Supported --> (independent, can be done in parallel)
```

## MVP Recommendation

Prioritize:
1. **CSS transform on annotation layer** -- Make annotations visible and scaling during zoom for ONE zoom method (Ctrl+scroll)
2. **Transform-origin alignment** -- Match annotation layer transform-origin with Syncfusion page zoom anchor
3. **Flicker-free re-render transition** -- Atomic CSS transform removal + canvas resize in single frame
4. **All zoom methods** -- Extend to trackpad pinch, toolbar buttons, keyboard

Defer:
- **Annotation interaction during zoom** -- Block pointer events on annotation layer during CSS transform phase. Too complex for initial implementation.
- **Multi-scale annotation cache** -- Nice optimization but the debounced re-render is fast enough for initial release.

## Sources

- Adobe Acrobat, Bluebeam, Drawboard PDF zoom behavior (observed behavior, documented in PROJECT.md)
- [pdf.js PR #19128](https://github.com/mozilla/pdf.js/pull/19128) -- CSS zoom fallback pattern
- Existing codebase: `useZoomState.js`, `layerPerformance.js`, `LightweightAnnotationOverlay.jsx`
