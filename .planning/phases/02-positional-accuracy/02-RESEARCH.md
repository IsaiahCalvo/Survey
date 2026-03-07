# Phase 2: Positional Accuracy - Research

**Researched:** 2026-03-07
**Domain:** CSS transform-origin alignment, cursor-centered zoom, multi-page annotation positioning during Syncfusion PDF viewer zoom
**Confidence:** HIGH

## Summary

Phase 2 addresses the positional accuracy problem: during zoom, annotations must maintain pixel-perfect alignment with the underlying PDF page content, and the zoom must expand/contract from the cursor position (cursor-centered zoom matching Drawboard PDF / Adobe Acrobat behavior). The core technical challenge is aligning the annotation overlay's `transform-origin` with Syncfusion's page zoom anchor across all zoom methods (Ctrl+scroll, toolbar, pinch).

The codebase already contains most of the infrastructure needed. The `useZoomState` hook computes `zoomAnchor` and generates a `transformOrigin` string from it. The `setScaleWithViewportPreservation` function calculates cursor-relative anchor coordinates using the pdf.js formula (`cursorX + scrollLeft, cursorY + scrollTop`) and applies scroll adjustment (`scroll += cursor * (scaleFactor - 1)`). However, the current overlay transform sync code (`applySyncfusionOverlayTransformSync` and `handleSyncfusionZoomChange`) hardcodes `transformOrigin: 'top left'` on all overlay content nodes, which causes positional drift when zooming from any point other than the top-left corner of the page.

The key insight is that Syncfusion does NOT use CSS transforms for its page zoom -- it re-renders pages at the new size by resizing `.e-pv-page-div` containers and re-painting canvases. Therefore, there is no Syncfusion CSS transform-origin to "match." Instead, the annotation overlay must: (1) compute its own transform-origin from the cursor/zoom anchor relative to each page's coordinate space, (2) apply that origin to the CSS `scale()` transform on the overlay content node, and (3) adjust scroll position so the point under the cursor remains visually stable. The per-page transform-origin must account for the cursor's position relative to each individual page, not just the viewport.

**Primary recommendation:** Replace the hardcoded `transformOrigin: 'top left'` in both `applySyncfusionOverlayTransformSync` and `handleSyncfusionZoomChange` with a per-page cursor-relative origin. Compute the origin by projecting the global zoom anchor (cursor + scroll) into each page's local coordinate system using the page host's DOM position. For toolbar zoom (no cursor), default to viewport center. Verify scroll adjustment formula against Syncfusion's actual post-zoom scroll position.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Claude investigates Syncfusion's runtime zoom behavior to determine how it anchors zoom (cursor-based, fixed-point, or per-method)
- Claude picks whichever approach (DOM observation, independent computation, or reverse-engineering from page positions) keeps annotations aligned with zero drift
- The goal is zero positional drift between annotations and page content -- the strategy to achieve it is Claude's discretion
- If Syncfusion's anchor differs per zoom method, Claude determines how to handle each to maintain alignment
- Toolbar zoom buttons: zoom expands from viewport center
- Ctrl+scroll zoom: cursor-centered, scroll adjustment formula tuned to match Syncfusion's behavior (Claude verifies at runtime)
- Pinch zoom: Claude's discretion on whether to use gesture center or defer
- Reference behavior: Drawboard PDF is the gold standard, Adobe Acrobat secondary reference
- Scroll adjustment formula from pdf.js may need tuning -- Claude verifies against Syncfusion's actual post-zoom scroll position
- ALL visible pages must maintain perfect annotation-to-content alignment during zoom -- no tolerance for drift on distant pages
- Use overlay comparison method: add visual markers (crosshairs, bounding boxes) to both annotation layer and page content to make misalignment obvious
- Test across full zoom range (25%-400%)
- Verify alignment both mid-zoom (while CSS transform is active) AND at rest (after canvas re-render)
- Rapid successive zooms must maintain alignment throughout -- no tolerance for even brief desync
- Slight annotation overflow past page boundaries during CSS transform phase is acceptable (corrects on re-render)

### Claude's Discretion
- Syncfusion runtime investigation and anchor matching strategy
- DOM observation vs independent computation approach
- Overlay positioning architecture (per-page vs document-level)
- Debug alignment markers: persistent toggle vs temporary
- Pinch zoom anchor handling
- Empty page optimization
- Boundary/edge handling technique
- Overlay positioning strategy (per-page vs document-level float)
- DOM observation approach (MutationObserver vs per-frame measurement)
- Document boundary handling (scroll clamping at edges)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ZCOR-01 | Annotations maintain correct position relative to page content during zoom -- no positional glitching or drift | Per-page transform-origin computation aligned to cursor position; transform ratio computed from live measured page scale vs committed base scale |
| ZCOR-03 | Transform-origin of annotation layer matches Syncfusion page zoom anchor for all zoom methods | Syncfusion re-renders pages at new size (no CSS transform-origin); overlay must independently compute correct origin per zoom method (cursor for wheel, viewport center for toolbar) |
| ZPOL-01 | Zoom expands from cursor position (cursor-centered zoom) matching Adobe Acrobat behavior | pdf.js formula (origin = cursor + scroll; scroll += cursor * (scaleFactor - 1)) already in codebase; needs to be propagated to overlay transform-origin and verified against Syncfusion scroll behavior |

</phase_requirements>

## Standard Stack

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component framework | Already used throughout |
| Fabric.js | 5.x | Canvas-based annotation rendering | Already used in PageAnnotationLayer |
| @syncfusion/ej2-react-pdfviewer | 32.1.x | PDF rendering and zoom | Already the primary viewer |

### Supporting (Already in Codebase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| useZoomState hook | custom | Computes cssScale, isZooming, zoomStyle with transformOrigin | Core zoom lifecycle at `src/hooks/useZoomState.js` |
| zoomController | custom | Manages zoom modes and scale clamping | Already wired into App.jsx |
| LightweightAnnotationOverlay | custom | DOM-based annotation preview during zoom | Zoom preview layer |

### No New Dependencies Needed
Phase 2 requires zero new npm dependencies. All functionality is achievable with existing React, CSS transforms, DOM measurement APIs, and the established hook/component architecture.

## Architecture Patterns

### Current Transform-Origin Architecture (The Problem)

```
Zoom event fires
  |
  +-- setScaleWithViewportPreservation()
  |     |-- Computes cursor anchor: { x: cursorX + scrollLeft, y: cursorY + scrollTop }
  |     |-- Calls setAnchor(anchor)  --> useZoomState stores zoomAnchor
  |     |-- useZoomState generates zoomStyle.transformOrigin = `${anchor.x}px ${anchor.y}px`
  |     +-- BUT: this zoomStyle is only applied in the non-Syncfusion render path (line 23572)
  |
  +-- handleSyncfusionZoomChange()
  |     |-- Applies CSS transform to overlay content nodes directly (bypasses React)
  |     |-- HARDCODES: node.style.transformOrigin = 'top left'   <-- THE BUG
  |     +-- All pages get same origin regardless of cursor position
  |
  +-- applySyncfusionOverlayTransformSync()
        |-- RAF-loop applies CSS transform to overlay content nodes
        |-- HARDCODES: node.style.transformOrigin = 'top left'   <-- THE BUG
        +-- Same origin for all pages regardless of cursor position
```

**The root cause:** Two code paths apply CSS transforms to overlay nodes during zoom, and both hardcode `transformOrigin: 'top left'`. The `useZoomState` hook correctly computes a cursor-relative origin, but its `zoomStyle` output is not consumed in the Syncfusion overlay path.

### Recommended Architecture for Phase 2

```
Zoom event fires
  |
  +-- Capture global zoom anchor (varies by zoom method):
  |     Ctrl+scroll: cursorX + scrollLeft, cursorY + scrollTop (already in syncfusionWheelZoomAnchorRef)
  |     Toolbar:     viewportCenter.x + scrollLeft, viewportCenter.y + scrollTop
  |     Pinch:       gestureMidpoint + scroll (if supported)
  |
  +-- Store global anchor in ref (e.g., zoomAnchorRef or syncfusionWheelZoomAnchorRef)
  |
  +-- For each page with an overlay content node:
  |     |
  |     +-- Project global anchor to page-local coordinates:
  |     |     pageRect = pageHost.getBoundingClientRect()
  |     |     containerRect = viewerContainer.getBoundingClientRect()
  |     |     localX = globalAnchorX - (pageRect.left - containerRect.left + viewerContainer.scrollLeft)
  |     |     localY = globalAnchorY - (pageRect.top - containerRect.top + viewerContainer.scrollTop)
  |     |
  |     +-- Set per-page transform-origin:
  |     |     node.style.transformOrigin = `${localX}px ${localY}px`
  |     |
  |     +-- Apply scale transform (unchanged):
  |           node.style.transform = `scale(${ratio})`
  |
  +-- Scroll adjustment (for Ctrl+scroll zoom):
        viewerContainer.scrollLeft += cursorX * (scaleFactor - 1)
        viewerContainer.scrollTop += cursorY * (scaleFactor - 1)
        (Verify against Syncfusion's actual post-zoom scroll position)
```

### Pattern 1: Per-Page Transform-Origin Projection

**What:** Convert a global zoom anchor (cursor position in document coordinates) to a per-page local anchor for each overlay content node's `transformOrigin`.

**When to use:** Every time a CSS transform is applied to an overlay content node during zoom.

**Why needed:** Each page's overlay is positioned at `(0,0)` relative to its page host. When zooming, the CSS `scale()` transform expands outward from the `transformOrigin`. If origin is `top left`, all content moves down-right during zoom-in. If origin matches the cursor's position relative to the page, the point under the cursor stays fixed.

**Key formula:**
```javascript
// Global anchor (stored when zoom starts)
const globalAnchorX = cursorX + container.scrollLeft;
const globalAnchorY = cursorY + container.scrollTop;

// For each page:
const pageHostRect = pageHost.getBoundingClientRect();
const containerRect = container.getBoundingClientRect();

// Page's position in document coordinates
const pageDocX = pageHostRect.left - containerRect.left + container.scrollLeft;
const pageDocY = pageHostRect.top - containerRect.top + container.scrollTop;

// Local anchor within the page
const localAnchorX = globalAnchorX - pageDocX;
const localAnchorY = globalAnchorY - pageDocY;

// For pages where cursor is outside, clamp or use page center
node.style.transformOrigin = `${localAnchorX}px ${localAnchorY}px`;
```

**Important:** The local anchor can be outside the page bounds (negative or > page dimensions) for off-screen pages. This is mathematically correct -- CSS transform-origin works with any coordinate, even outside the element. The content will shift proportionally, matching how Syncfusion's own page re-rendering shifts content relative to the cursor.

### Pattern 2: Zoom Method-Specific Anchor Capture

**What:** Capture the zoom anchor at the point where the zoom gesture starts, varying by zoom method.

**When to use:** At the start of each zoom interaction.

**Implementation:**

```javascript
// Ctrl+scroll / trackpad zoom (already captured):
// syncfusionWheelZoomAnchorRef.current = {
//   x: pointerX + viewerContainer.scrollLeft,
//   y: pointerY + viewerContainer.scrollTop
// };

// Toolbar zoom buttons (needs to be added):
// When zoomTo is called without an anchor:
const containerRect = container.getBoundingClientRect();
const anchor = {
  x: containerRect.width / 2 + container.scrollLeft,
  y: containerRect.height / 2 + container.scrollTop
};

// Pinch zoom:
// Use gesture midpoint (similar to Ctrl+scroll)
// The existing wheel handler already captures this for Ctrl+wheel
```

### Pattern 3: Scroll Adjustment Verification

**What:** After Syncfusion processes a zoom, verify that the app's scroll adjustment matches Syncfusion's actual post-zoom scroll position.

**When to use:** During development/debugging to validate the scroll formula.

**The pdf.js formula (already in codebase):**
```javascript
container.scrollLeft += cursorX * (scaleFactor - 1);
container.scrollTop += cursorY * (scaleFactor - 1);
```

**Key concern:** Syncfusion's `magnificationModule.zoomTo()` may also adjust scroll position internally. If both our code AND Syncfusion adjust scroll, we get double-adjustment. The current code calls `zoomTo()` and lets Syncfusion handle scroll. For Ctrl+scroll zoom, the anchor is set and Syncfusion's own scroll behavior handles positioning.

**Verification approach:** Log `container.scrollLeft/scrollTop` before and after Syncfusion's zoom completes. Compare expected (formula) vs actual. Adjust or skip our manual scroll adjustment if Syncfusion handles it correctly.

### Pattern 4: Debug Alignment Markers

**What:** Visual crosshair/marker overlay to make annotation-to-content misalignment obvious during development.

**When to use:** Toggle during development to verify alignment accuracy.

**Implementation approach (Claude's discretion -- recommend persistent toggle):**
```javascript
// Debug overlay component that renders crosshairs at known content positions
// Compare against annotation layer's crosshairs at the same logical positions
// Any misalignment is immediately visible as diverging crosshairs

// Toggle via console: window.__DEBUG_ALIGNMENT = true
// Or via keyboard shortcut
```

### Anti-Patterns to Avoid

- **Hardcoding `transformOrigin: 'top left'`:** The current bug. Causes annotations to drift away from their correct positions during zoom from any non-top-left origin.
- **Single global transform-origin for all pages:** Each page needs its own local transform-origin derived from the global zoom anchor. A single origin applied to a document-level container would only be correct for single-page view.
- **Manually adjusting scroll when Syncfusion already does it:** Double-adjustment causes scroll jumping. Verify Syncfusion's behavior first.
- **Using viewport-relative coordinates for transform-origin:** Transform-origin must be relative to the element being transformed (the overlay content node), not the viewport.
- **Ignoring the timing gap between CSS transform and Syncfusion re-render:** During zoom, Syncfusion is re-rendering pages at the new size. The overlay CSS transform must hold steady until PAL's `onScaleApplied` confirms the canvas is painted at the final scale.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zoom lifecycle management | Custom zoom start/end detection | `useZoomState` hook + `syncfusionInteractionPhase` state machine | Already handles debounce, cssScale, isZooming, settle detection |
| Overlay transform application | New transform application loop | Modify existing `applySyncfusionOverlayTransformSync` and `handleSyncfusionZoomChange` | Already handles per-page node lookup, ratio computation, performance throttling |
| Scale measurement | Custom page size tracking | `measureSyncfusionPageHostScale` + `normalizeInteractionMeasuredScale` | Already handles Syncfusion DOM measurement, transient width guards |
| Wheel zoom anchor capture | New event handler | Existing `onWheel` handler in interaction listener setup (App.jsx ~11022) | Already captures cursor position + scroll offset into `syncfusionWheelZoomAnchorRef` |
| Transform cleanup after zoom | Custom cleanup logic | `handlePALScaleApplied` + `finalizeSyncfusionInteractionIdle` | Already handles per-page and global transform removal with safety timers |

**Key insight:** The main work is modifying two existing functions (`applySyncfusionOverlayTransformSync` and `handleSyncfusionZoomChange`) to use cursor-relative transform-origin instead of hardcoded `'top left'`, plus adding anchor capture for toolbar zoom. The infrastructure for everything else already exists.

## Common Pitfalls

### Pitfall 1: Transform-Origin Coordinate System Mismatch
**What goes wrong:** Transform-origin is set using global/viewport coordinates instead of element-local coordinates, causing the zoom to anchor at the wrong position.
**Why it happens:** The zoom anchor is captured in document coordinates (cursor + scroll) but transform-origin needs to be relative to the overlay content node's top-left corner.
**How to avoid:** Always project the global anchor to page-local coordinates by subtracting the page host's document position. Use `getBoundingClientRect()` + `scrollLeft/scrollTop` to compute the page's document position.
**Warning signs:** Annotations zoom from a point that is offset from the cursor by the page's position in the document.

### Pitfall 2: Double Scroll Adjustment
**What goes wrong:** After zoom, the scroll position jumps dramatically because both the app code and Syncfusion independently adjust scroll.
**Why it happens:** Syncfusion's `zoomTo()` and `initiateMouseZoom()` adjust scroll internally. If the app also applies `scroll += cursor * (scaleFactor - 1)`, the adjustment is doubled.
**How to avoid:** For the Syncfusion path, let Syncfusion handle scroll adjustment via `initiateMouseZoom()` (which takes x,y cursor coordinates). Only apply manual scroll adjustment if Syncfusion's behavior doesn't match the desired cursor-centered behavior. Verify by comparing actual scroll positions with expected values.
**Warning signs:** Document jumps/snaps to a wrong position after zoom completes; the page under the cursor shifts dramatically.

### Pitfall 3: Stale Anchor During Rapid Zooms
**What goes wrong:** During rapid successive zoom gestures, the transform-origin uses an anchor from a previous gesture, causing brief misalignment.
**Why it happens:** The anchor capture happens in the wheel event handler, but the transform-origin computation happens in the RAF loop. If a new zoom starts before the previous one settles, the anchor might not be updated.
**How to avoid:** Always use the most recent anchor from `syncfusionWheelZoomAnchorRef.current`. The wheel handler already updates this ref synchronously on every Ctrl+wheel event. The RAF loop should read from this ref every tick, not cache it.
**Warning signs:** Annotations briefly zoom from an old cursor position before snapping to the new one.

### Pitfall 4: Page Host Rect Measurement During Layout Transition
**What goes wrong:** `getBoundingClientRect()` on page hosts returns stale values during Syncfusion's page re-rendering, causing computed transform-origins to be wrong.
**Why it happens:** Syncfusion resizes page divs during zoom. If the overlay transform sync measures page positions mid-resize, the rect can be from the old or intermediate state.
**How to avoid:** Use the committed page scale and known page sizes to compute expected positions analytically, rather than measuring live DOM positions during zoom. Fall back to DOM measurement only when committed values are unavailable.
**Warning signs:** Transform-origin jitters during zoom, especially on pages far from the cursor.

### Pitfall 5: Off-Page Anchor Causing Content Shift
**What goes wrong:** For pages far from the cursor, the local anchor is far outside the page bounds (e.g., `(-500px, -300px)`). The CSS transform correctly scales from that origin, but the visual result looks wrong because the page content shifts dramatically.
**Why it happens:** This is actually mathematically correct -- all pages in a document must scale around the same global point for the document to maintain spatial coherence. Pages far from the cursor SHOULD shift their content, matching how Syncfusion shifts them.
**How to avoid:** This is not actually a problem. The visual "shift" is correct and matches what Syncfusion does. If testing suggests otherwise, verify by comparing the annotation position against the actual PDF page content position.
**Warning signs:** (False alarm) Developer sees annotations "moving" on distant pages during zoom, but this matches the PDF page content movement.

### Pitfall 6: Toolbar Zoom Without Cursor Position
**What goes wrong:** Toolbar zoom buttons don't have an associated cursor position. If the last wheel-zoom anchor is reused, annotations zoom from the wrong point.
**Why it happens:** `syncfusionWheelZoomAnchorRef` retains its last value even when zoom is triggered from the toolbar.
**How to avoid:** Detect toolbar-initiated zoom (no recent wheel event, or `syncfusionZoomSourceRef` indicates toolbar). For toolbar zoom, use viewport center as the anchor: `{ x: containerWidth/2 + scrollLeft, y: containerHeight/2 + scrollTop }`.
**Warning signs:** Toolbar zoom-in anchors at the last cursor position instead of viewport center.

## Code Examples

### Example 1: Per-Page Transform-Origin Computation

Modify `applySyncfusionOverlayTransformSync` (App.jsx ~line 9824) to compute per-page origin:

```javascript
// Source: Codebase analysis + pdf.js anchor formula
const computePageLocalAnchor = (pageNumber, pageContainers, containerElement, globalAnchor) => {
  if (!globalAnchor || !containerElement) {
    return null; // Falls back to 'top left'
  }

  const pageHost = pageContainers[pageNumber];
  if (!pageHost || !pageHost.isConnected) {
    return null;
  }

  const containerRect = containerElement.getBoundingClientRect();
  const pageRect = pageHost.getBoundingClientRect();

  // Page position in document coordinates
  const pageDocX = pageRect.left - containerRect.left + containerElement.scrollLeft;
  const pageDocY = pageRect.top - containerRect.top + containerElement.scrollTop;

  // Project global anchor to page-local coordinates
  return {
    x: globalAnchor.x - pageDocX,
    y: globalAnchor.y - pageDocY
  };
};
```

### Example 2: Modified Overlay Transform with Cursor-Relative Origin

Replace the hardcoded `'top left'` in the overlay transform application:

```javascript
// Source: Modification of existing applySyncfusionOverlayTransformSync
// BEFORE (current code, line 9896):
node.style.transformOrigin = 'top left';

// AFTER:
const anchor = computePageLocalAnchor(
  pageNumber,
  pageContainers,
  viewerContainerRef.current,
  syncfusionWheelZoomAnchorRef.current  // or unified zoom anchor ref
);
if (anchor) {
  node.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
} else {
  node.style.transformOrigin = 'top left'; // fallback
}
```

### Example 3: Toolbar Zoom Anchor Capture

Add viewport-center anchor capture for toolbar-initiated zoom:

```javascript
// Source: Modification of setScaleWithViewportPreservation (App.jsx ~20216)
// In the Syncfusion path, when no anchor is provided:
if (container) {
  const rect = container.getBoundingClientRect();
  const anchor = options.anchor || {};
  const cursorX = typeof anchor.x === 'number' ? anchor.x : rect.width / 2;
  const cursorY = typeof anchor.y === 'number' ? anchor.y : rect.height / 2;

  // Store as global zoom anchor for overlay transform-origin computation
  const globalAnchor = {
    x: cursorX + container.scrollLeft,
    y: cursorY + container.scrollTop
  };
  setAnchor(globalAnchor);
  // Also update the wheel zoom anchor ref so overlay transform sync uses it
  syncfusionWheelZoomAnchorRef.current = globalAnchor;
}
```

### Example 4: Synchronous Transform-Origin in handleSyncfusionZoomChange

Replace the hardcoded origin in the synchronous zoom handler:

```javascript
// Source: Modification of handleSyncfusionZoomChange (App.jsx ~11638)
// BEFORE (current code, lines 11649-11658):
const overlayRefs = syncfusionOverlayContentRefs.current;
if (overlayRefs) {
  const keys = Object.keys(overlayRefs);
  for (let i = 0; i < keys.length; i++) {
    const node = overlayRefs[keys[i]];
    if (node && node.isConnected) {
      node.style.transform = `scale(${ratio})`;
      node.style.transformOrigin = 'top left';  // <-- HARDCODED
    }
  }
}

// AFTER:
const overlayRefs = syncfusionOverlayContentRefs.current;
const zoomAnchor = syncfusionWheelZoomAnchorRef.current;
const viewerContainer = syncfusionViewerContainerRef.current; // or equivalent
if (overlayRefs) {
  const keys = Object.keys(overlayRefs);
  for (let i = 0; i < keys.length; i++) {
    const pageNumber = Number(keys[i]);
    const node = overlayRefs[keys[i]];
    if (node && node.isConnected) {
      node.style.transform = `scale(${ratio})`;
      const localAnchor = computePageLocalAnchor(
        pageNumber,
        syncfusionPageContainersStateRef.current,
        viewerContainer,
        zoomAnchor
      );
      node.style.transformOrigin = localAnchor
        ? `${localAnchor.x}px ${localAnchor.y}px`
        : 'top left';
    }
  }
}
```

### Example 5: Debug Alignment Crosshair

```javascript
// Source: Design pattern for visual debugging
// Add to overlay content div, toggled via window.__DEBUG_ALIGNMENT
{window.__DEBUG_ALIGNMENT && zoomAnchor && (() => {
  const localAnchor = computePageLocalAnchor(pageNumber, ...);
  if (!localAnchor) return null;
  return (
    <div style={{
      position: 'absolute',
      left: localAnchor.x - 10,
      top: localAnchor.y - 10,
      width: 20,
      height: 20,
      border: '2px solid red',
      borderRadius: '50%',
      pointerEvents: 'none',
      zIndex: 9999
    }}>
      <div style={{
        position: 'absolute',
        left: 9, top: -10, width: 2, height: 40,
        background: 'red'
      }} />
      <div style={{
        position: 'absolute',
        top: 9, left: -10, height: 2, width: 40,
        background: 'red'
      }} />
    </div>
  );
})()}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `transformOrigin: 'top left'` | Per-page cursor-relative transform-origin | Phase 2 change | Eliminates positional drift during zoom |
| No anchor differentiation by zoom method | Method-specific anchor capture (cursor for wheel, center for toolbar) | Phase 2 change | Correct zoom behavior per interaction type |
| Transform-origin only in `useZoomState` (non-Syncfusion path) | Transform-origin propagated to Syncfusion overlay transform sync | Phase 2 change | Cursor-centered zoom works with Syncfusion viewer |

**Key understanding of Syncfusion's zoom behavior:**
- Syncfusion does NOT use CSS transforms for page zoom -- it resizes page div elements and re-paints canvases at the new size
- `magnificationModule.zoomTo(percent)` resizes pages to the new zoom level (no anchor)
- `magnificationModule.initiateMouseZoom(x, y, percent)` zooms with cursor position context (internal undocumented method)
- Syncfusion handles its own scroll adjustment internally during zoom
- The page div (`e-pv-page-div`) gets new dimensions after zoom completes; page canvases (`e-pv-page-canvas`) are re-rendered
- Between zoom request and completion, there is a re-rendering gap where page DOM may be in a transitional state

## Open Questions

1. **Syncfusion's scroll adjustment behavior per zoom method**
   - What we know: Syncfusion internally adjusts scroll during `zoomTo()` and `initiateMouseZoom()`. The app's `setScaleWithViewportPreservation` also has scroll adjustment code for the non-Syncfusion path.
   - What's unclear: Whether the current Syncfusion path applies any scroll adjustment (the code calls `setAnchor` but does not manually adjust scroll for the Syncfusion path -- lines 20216-20247).
   - Recommendation: Runtime verify by logging scroll values before and after Syncfusion zoom. If Syncfusion handles it correctly for cursor-centered zoom, no additional scroll adjustment is needed. If not, add it.

2. **`initiateMouseZoom` vs `zoomTo` behavior differences**
   - What we know: The code uses `initiateMouseZoom(x, y, zoomPercent)` when an anchor is available, `zoomTo(zoomPercent)` otherwise. `initiateMouseZoom` is an undocumented Syncfusion internal method.
   - What's unclear: Whether `initiateMouseZoom` produces correct cursor-centered scroll behavior, or just scales from a specific point.
   - Recommendation: Test both methods at runtime. Verify that `initiateMouseZoom` produces the expected scroll position after zoom. If it does, the overlay transform-origin just needs to match.

3. **Performance impact of `getBoundingClientRect` per page per frame**
   - What we know: The RAF loop in `applySyncfusionOverlayTransformSync` already runs per-page per frame during interactions.
   - What's unclear: Whether adding `getBoundingClientRect()` calls for each page will cause layout thrashing.
   - Recommendation: Compute page positions once at the start of each zoom gesture (when anchor is captured) and cache them. Only re-measure if the container resizes or pages are added/removed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual visual verification (no browser test infra in project) |
| Config file | none |
| Quick run command | `npm run dev` then manually zoom, verify alignment |
| Full suite command | `npm run dev` then full manual checklist below |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZCOR-01 | Annotations maintain correct position relative to page content during zoom | manual | Visual: zoom on annotation, verify no drift from page content | N/A |
| ZCOR-03 | Transform-origin matches Syncfusion page zoom anchor across zoom methods | manual | Visual: zoom via Ctrl+scroll, toolbar, verify annotation zoom matches page zoom | N/A |
| ZPOL-01 | Zoom expands from cursor position (cursor-centered zoom) | manual | Visual: hover over annotation, Ctrl+scroll zoom, verify point under cursor stays fixed | N/A |

**Manual-only justification:** All three requirements describe visual rendering alignment behavior dependent on Syncfusion's live PDF viewer DOM, CSS compositor, and sub-pixel positioning. Meaningful testing requires a running browser with Syncfusion initialized and a loaded PDF with annotations. The codebase has no browser-based test infrastructure (no Playwright, Cypress, or JSDOM component tests). The debug alignment crosshair overlay provides visual verification tooling.

### Sampling Rate
- **Per task commit:** Manual visual verification: enable debug crosshairs, zoom at annotation, verify crosshair stays on content landmark
- **Per wave merge:** Full manual test: zoom via all three methods (Ctrl+scroll, toolbar, pinch if supported) across 25%-400% range; verify on multi-page document with annotations on different pages
- **Phase gate:** Complete alignment verification checklist before `/gsd:verify-work`

### Wave 0 Gaps
None -- phase requirements are manual-only verification. Debug alignment markers are part of implementation (not test infrastructure).

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** -- `src/hooks/useZoomState.js` (110 lines): `getTransformOrigin()` computes origin from `zoomAnchor`, but output is only used in non-Syncfusion render path
- **Codebase inspection** -- `src/App.jsx` lines 9824-9913 (`applySyncfusionOverlayTransformSync`): Per-page transform with hardcoded `transformOrigin: 'top left'`
- **Codebase inspection** -- `src/App.jsx` lines 11604-11692 (`handleSyncfusionZoomChange`): Synchronous zoom handler with hardcoded `transformOrigin: 'top left'`
- **Codebase inspection** -- `src/App.jsx` lines 11022-11072 (wheel handler): Captures cursor anchor into `syncfusionWheelZoomAnchorRef`
- **Codebase inspection** -- `src/App.jsx` lines 20206-20311 (`setScaleWithViewportPreservation`): pdf.js cursor-centered zoom formula
- **Codebase inspection** -- `src/App.jsx` lines 10053-10093 (`handlePALScaleApplied`): Transform cleanup after canvas re-render
- **PDF.js pinch zoom gist** -- [GitHub Gist](https://gist.github.com/larsneo/bb75616e9426ae589f50e8c8411020f6): Verifies the `origin = cursor + scroll; scrollAdjust = cursor * (scaleFactor - 1)` formula

### Secondary (MEDIUM confidence)
- **Syncfusion Magnification API docs** -- [ej2.syncfusion.com](https://ej2.syncfusion.com/documentation/api/pdfviewer/magnification/): Documents `zoomTo()`, `fitToPage()`, `fitToWidth()`; `initiateMouseZoom` is NOT in public docs (internal method discovered in codebase)
- **CSS transform-origin** -- [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/transform-origin): Confirms transform-origin accepts any coordinate (including outside element bounds)

### Tertiary (LOW confidence)
- **Syncfusion's internal scroll adjustment behavior** -- Not documented; needs runtime verification during implementation
- **`initiateMouseZoom` behavior** -- Internal Syncfusion method, behavior inferred from usage patterns in codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase, no new dependencies
- Architecture: HIGH -- root cause clearly identified (hardcoded `'top left'` origin), solution is well-defined (project global anchor to per-page local coordinates)
- Pitfalls: HIGH -- based on direct codebase analysis and understanding of CSS transform-origin mechanics
- Scroll adjustment: MEDIUM -- needs runtime verification of Syncfusion's internal scroll behavior
- `initiateMouseZoom` behavior: LOW -- undocumented internal Syncfusion method, needs testing

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- no external dependency changes expected)
