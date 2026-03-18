# Feature Landscape: PDF Annotation Canvas Overlay Zoom Handling

**Domain:** PDF viewer with interactive canvas annotation overlays (Syncfusion + Fabric.js)
**Researched:** 2026-03-17
**Mode:** Ecosystem (What zoom behaviors do PDF annotation products have?)

## Table Stakes

Features users expect from any professional PDF annotation viewer during zoom. Missing any of these and users perceive the product as broken or low-quality.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Annotations stay visible during zoom** | Adobe Acrobat, pdf.js, Nutrient/PSPDFKit, Foxit -- all keep annotations visible throughout zoom transitions. Disappearing annotations feel like data loss. | High | This is THE core problem being solved. Current portal system causes annotations to vanish/jump during zoom. The CSS-transform-then-redraw approach (used by pdf.js, described in design spec) is the industry standard pattern. |
| **Annotations stay positionally correct during zoom** | Users annotate specific locations on the PDF. If annotations drift or jump to wrong positions mid-zoom, trust is destroyed. Every commercial viewer maintains annotation-to-page-content alignment. | High | Positional stability is more important than visual crispness. Blurry-but-correct beats crisp-but-wrong. |
| **All zoom input methods work identically** | Users expect Ctrl+scroll, toolbar buttons, dropdown presets, fit-to-page, fit-to-width, and pinch-to-zoom to all produce the same annotation behavior. Inconsistency across methods is a common bug source. | Medium | The current app has 6 zoom entry points. The design spec correctly identifies that all must funnel through one code path. Syncfusion fires `onZoomChanged` for all methods, which helps. |
| **CSS-transform visual stability during transition** | pdf.js and Adobe Acrobat both show a briefly blurry-but-stable view during zoom, then re-render at full resolution. Users accept momentary blur (it matches native OS zoom behavior -- like pinch-zooming a photo). They do NOT accept content vanishing. | Medium | This is the "zoom layer" pattern from pdf.js: apply `transform: scale(ratio)` to the existing canvas immediately, then re-render at correct resolution asynchronously. The design spec describes exactly this approach. HIGH confidence this is correct -- pdf.js has shipped this for years. |
| **Post-zoom canvas re-render at correct resolution** | After zoom settles, annotations must be crisp -- not permanently blurry from the CSS transform. Commercial viewers all do a full re-render once the zoom gesture completes. | Medium | The settle timer approach (wait for zoom to stop, then re-render) is standard. pdf.js uses this. The design spec proposes 1000ms settle, which is reasonable. |
| **Rapid consecutive zoom handling** | Users scroll-zoom rapidly or press Ctrl+/- multiple times quickly. The viewer must not crash, leak timers, or enter invalid states. Each new zoom should restart the settle timer, not stack up pending re-renders. | Medium | Debouncing/timer-restart pattern. Each new zoom event cancels the previous settle timer and starts a new one. Only the final zoom level triggers the expensive re-render. This is standard and described in the design spec. |
| **Scroll position preserved across zoom** | When zooming, the content the user is looking at should stay centered (or at least visible). Zoom should not jump the user to a different page or scroll position. | Low | This is primarily a Syncfusion viewer responsibility, not the annotation layer's job. Syncfusion handles scroll position during zoom natively. The annotation layer just needs to follow the page div. |
| **Drawing tools work correctly after zoom** | After zooming, annotation drawing tools (pen, shapes, callouts, regions) must produce annotations at the correct position and scale. A click at coordinates (x, y) on the zoomed canvas must map to the correct PDF coordinates. | Medium | This depends on the Fabric.js canvas having correct dimensions and the coordinate transform being updated after zoom. The design spec handles this by re-rendering the canvas at the new resolution after zoom settles. |
| **Fit-to-page and fit-to-width modes** | Standard preset zoom levels. Every PDF viewer has these. Nutrient, Syncfusion, pdf.js, Adobe Acrobat all support them. | Low | Syncfusion provides these natively. The annotation layer just needs to handle the resulting zoom change like any other zoom event. |

## Differentiators

Features that go beyond table stakes. Not expected by users, but valued when present. These provide competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Zero-frame annotation gap** | Most viewers (including pdf.js) have a 1-2 frame gap where the old canvas is detached before the new page div appears during Syncfusion page recreation. Eliminating this entirely (truly seamless) would exceed what pdf.js achieves. | High | The design spec acknowledges a potential 1-2 frame gap when Syncfusion destroys/recreates page divs. The overlay re-attachment via `useEffect` on `syncfusionPageContainers` is the mitigation. Achieving truly zero gap would require pre-creating overlay divs for pages not yet visible -- probably not worth the complexity. |
| **Zoom-to-cursor (anchor point zoom)** | When Ctrl+scroll zooming, the zoom centers on the cursor position rather than the page center. Figma, Miro, and some PDF viewers (PDF-XChange, Nutrient) support this. Makes annotation workflows faster -- users zoom into the area they are working on. | Medium | This is a viewer-level feature (Syncfusion or custom scroll adjustment), not an annotation layer concern. Could be added as a separate enhancement. Not needed for the current refactor. |
| **Zoom-to-annotation** | Clicking an annotation in a sidebar list zooms to and highlights that annotation. Nutrient/PSPDFKit supports this. Useful for review workflows. | Medium | This is an app-level feature, not related to zoom flicker fix. Would build on top of the stable zoom infrastructure. |
| **Animated zoom transitions** | Smooth animated zoom rather than instant jump. pdf.js has implemented this (Bug 1659492). Makes the experience feel polished. | Medium | Requires interpolating between zoom levels rather than jumping. The CSS transform approach naturally supports this -- animate the transform scale over 200-300ms, then re-render. However, must respect `prefers-reduced-motion`. |
| **Zoom history / Previous view** | PDF Annotator offers "Previous View" to jump back to prior zoom level/position. Useful for annotation review workflows (zoom in to inspect detail, one-click back to overview). | Low | Simple stack of (zoom, scrollPosition) tuples. Not related to zoom flicker, but builds on stable zoom infrastructure. |
| **Annotation-aware zoom limits** | Prevent zooming so far out that annotations become invisible/unreadable, or so far in that you lose context. Syncfusion supports `minZoom`/`maxZoom` configuration. | Low | Configure Syncfusion's existing `minZoom`/`maxZoom` properties. Not an annotation layer concern. |
| **High-resolution partial rendering at extreme zoom** | At very high zoom levels (400%+), render only the visible viewport at full resolution instead of the entire page. pdf.js merged PR #19128 for this exact feature -- prevents blurry text and reduces memory usage. | High | This is a significant optimization that would only matter at extreme zoom levels. Not needed for the current refactor. Could be a future enhancement if users zoom to very high levels for detailed annotation work. |

## Anti-Features

Features to explicitly NOT build. These are tempting but harmful.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Freeze/snapshot/confirm-pending machinery** | This is the CURRENT approach and it is the root cause of the flicker bug. It creates multi-frame timing windows where annotations vanish, jump to wrong positions, or render at stale scales. It requires 14+ refs, 7+ functions, and a 3000ms confirm timer. The complexity is unmanageable. | Use the CSS-transform-then-redraw approach. One transform during zoom, one re-render after settle. Two states instead of fourteen. |
| **SVG-based annotation rendering** | Tempting because SVG has `viewBox` for natural scaling. But Fabric.js (which provides all interactive editing -- pen, shapes, selection, undo/redo) requires a canvas element. Switching to SVG means rebuilding the entire annotation editing system. | Keep Fabric.js canvas. Use CSS `transform: scale()` as the canvas equivalent of SVG `viewBox`. The design spec is correct that this is the simpler path. |
| **Continuous re-render during zoom gesture** | Re-rendering the Fabric.js canvas at every zoom increment (every mouse wheel tick) would cause severe jank. Canvas re-rendering is expensive. | Apply cheap CSS transform during gesture, re-render once after gesture completes. This is exactly what pdf.js does and what the design spec proposes. |
| **Dual-canvas swap (hot-swap rendering)** | Rendering a second canvas in the background at the new zoom level, then swapping it in. Doubles memory usage and adds complexity for marginal benefit. The react-pdf community discussed this and concluded CSS transforms are simpler and sufficient. | Single canvas with CSS transform during transition. The 100-300ms of blur is acceptable (matches Adobe Acrobat behavior). |
| **Per-page zoom (independent page zoom levels)** | Allowing different pages to be at different zoom levels. No standard PDF viewer does this. It would break spatial navigation expectations and complicate the annotation coordinate system enormously. | All pages zoom together. This is the universal standard. |
| **Drawing-during-zoom support** | Allowing users to continue drawing annotations while a zoom gesture is active. Adobe Acrobat on iPad explicitly prevents this (users must exit draw mode to zoom). The coordinate system is in flux during zoom. | Disable pointer events on annotation canvases during active zoom gesture (which the `isZooming` prop already handles). Resume drawing after zoom settles. |
| **Custom zoom animation easing** | Configurable animation curves for zoom transitions. Over-engineering for near-zero user benefit. | If animated zoom is ever added, use a simple ease-out curve. No configuration needed. |

## Feature Dependencies

```
Annotations stay visible during zoom
  --> CSS-transform visual stability during transition (required technique)
    --> Post-zoom canvas re-render at correct resolution (completes the cycle)
      --> Drawing tools work correctly after zoom (depends on correct re-render)

All zoom input methods work identically
  --> Rapid consecutive zoom handling (debounce/settle timer pattern)

Scroll position preserved across zoom
  --> (Syncfusion handles this; no dependency on annotation layer)

Zero-frame annotation gap (differentiator)
  --> Annotations stay visible during zoom (table stakes must work first)
  --> Overlay re-attachment when Syncfusion recreates page divs (Step 5 in design spec)

Zoom-to-cursor (differentiator)
  --> All zoom input methods work identically (must have stable zoom first)
  --> (Viewer-level feature, independent of annotation layer)

Zoom-to-annotation (differentiator)
  --> Drawing tools work correctly after zoom (must have correct coordinates)
  --> (App-level feature, builds on stable zoom infrastructure)
```

## MVP Recommendation

### Must ship (table stakes -- the refactor goal):

1. **Annotations stay visible during zoom** -- THE reason this refactor exists. Users currently see annotations disappear and jump during zoom. This is the #1 priority.
2. **CSS-transform visual stability** -- The implementation technique. Apply `transform: scale(ratio)` during zoom so annotations are blurry-but-stable rather than absent.
3. **Post-zoom re-render at correct resolution** -- Complete the zoom cycle. After zoom settles (1000ms timer), redraw canvas at full resolution and remove CSS transform.
4. **All 6 zoom methods work identically** -- Ensure Ctrl+scroll, toolbar buttons, dropdown, fit-to-page, fit-to-width, and pinch all produce the same stable behavior.
5. **Rapid consecutive zoom handling** -- Debounce with timer restart. Users will scroll-zoom rapidly.
6. **Drawing tools work after zoom** -- Verify coordinate mapping is correct after the canvas re-renders at new resolution.

### Defer:

- **Zero-frame annotation gap**: Accept the 1-2 frame gap during Syncfusion page div recreation. The design spec's re-attachment logic mitigates this. Polish later if users notice.
- **Zoom-to-cursor**: Not related to the flicker fix. Enhancement for a future milestone.
- **Zoom-to-annotation**: App-level feature. Build after zoom infrastructure is stable.
- **Animated zoom transitions**: Nice polish, but not needed. The CSS transform already provides visual continuity.
- **Zoom history**: Separate feature entirely. Low priority.
- **High-res partial rendering**: Only relevant at extreme zoom levels. Future optimization.

### Explicitly remove:

- **Freeze/snapshot/confirm-pending machinery**: ~14 refs, ~7 functions, 3000ms timer. This IS the bug. The design spec's Step 6 (dead code removal) is essential, not optional.

## Confidence Assessment

| Finding | Confidence | Source |
|---------|------------|--------|
| CSS-transform-then-redraw is the industry standard approach | HIGH | pdf.js implementation (Bug 1659492, PR #19128), design spec analysis, react-pdf community discussion |
| Blurry-but-stable is acceptable during zoom transitions | HIGH | Adobe Acrobat behavior, pdf.js behavior, design spec references this explicitly |
| 1000ms settle timer is reasonable | MEDIUM | pdf.js uses similar approach, but exact timing is implementation-specific. May need tuning. |
| Drawing-during-zoom should be prevented | MEDIUM | Adobe Acrobat iPad explicitly prevents this. Web viewers generally disable interaction during zoom. |
| Zero-frame gap is difficult to achieve with Syncfusion page recreation | MEDIUM | Design spec acknowledges this. Depends on Syncfusion internal behavior. |
| Zoom-to-cursor is a differentiator not table stakes | HIGH | Only some PDF viewers support it. Users don't expect it in all viewers. |

## Sources

- [pdf.js smooth zoom implementation (Bug 1659492)](https://bugzilla.mozilla.org/show_bug.cgi?id=1659492)
- [pdf.js high-res partial rendering at zoom (PR #19128)](https://github.com/mozilla/pdf.js/pull/19128)
- [react-pdf flickering during zoom (Issue #875)](https://github.com/wojtekmaj/react-pdf/issues/875)
- [react-pdf flickering when scaling (Issue #1760)](https://github.com/wojtekmaj/react-pdf/issues/1760)
- [Nutrient/PSPDFKit zoom documentation](https://www.nutrient.io/guides/web/viewer/zooming/)
- [PDF Annotator zoom manual](https://www.pdfannotator.com/en/help/viewzoom)
- [Syncfusion React PDF Viewer magnification docs](https://help.syncfusion.com/document-processing/pdf/pdf-viewer/react/magnification)
- [Syncfusion minZoom/maxZoom configuration](https://help.syncfusion.com/document-processing/pdf/pdf-viewer/react/how-to/min-max-zoom)
- [pdf.js CSS zoom and annotation sync (Issue #6463)](https://github.com/mozilla/pdf.js/issues/6463)
- [pdf.js annotation scaling during zoom (Issue #15571)](https://github.com/mozilla/pdf.js/issues/15571)
- [Adobe Acrobat zoom-while-drawing limitation](https://community.adobe.com/questions-15/acrobat-on-ipad-pan-or-zoom-while-drawing-3013)
- [Figma zoom and view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options)
- [prefers-reduced-motion accessibility guidance](https://web.dev/articles/prefers-reduced-motion)
