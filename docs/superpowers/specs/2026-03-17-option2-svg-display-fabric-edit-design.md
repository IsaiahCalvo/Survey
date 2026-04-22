# Option 2: SVG Display + Fabric.js Editing (Fallback Plan)

## When To Use This Plan

Use this plan if Option 3 (direct child canvas) still has visible flicker after zoom. This approach eliminates flicker entirely by displaying annotations as SVG (which scales perfectly) and only switching to Fabric.js when the user actively edits.

## Problem Recap

Fabric.js canvases are pixel-based — they have a fixed resolution. During zoom, the canvas must be redrawn at a new resolution. This redraw takes time, and during that time, the canvas may flicker. Option 3 mitigates this with CSS transforms, but if the page div is destroyed/recreated during zoom, even a brief reattachment gap can cause visible flicker.

SVG overlays don't have this problem. They use a coordinate system (`viewBox`) that the browser maps to any pixel size automatically. An SVG at 100% zoom and 500% zoom uses the exact same path data — the browser just renders it at different pixel densities. No redraw, no timing window, no flicker.

## Files Touched

- **Create:** `src/components/SVGAnnotationLayer.jsx`
- **Heavily modify:** `src/App.jsx` (render loop, zoom handler, new `editingPage` state)
- **Simplify:** `src/PageAnnotationLayer.jsx` (remove zoom-related props and deferred logic)
- **Potentially modify or extend:** `src/components/LightweightAnnotationOverlay.jsx` (has existing Fabric-to-SVG conversion logic to reuse)

## Architecture

### Two Layers Per Page

```
Syncfusion Page Div
  ├── SVG Display Layer (always visible, handles zoom perfectly)
  │     └── SVG paths/shapes/text representing all annotations
  │     └── viewBox="0 0 {pageWidth} {pageHeight}"
  │     └── position: absolute; width: 100%; height: 100%
  │
  └── Fabric.js Edit Layer (hidden until user clicks to edit)
        └── Fabric.js Canvas (full drawing tools)
        └── Only shown when user is actively drawing/selecting/editing
```

### State Machine

```
                    ┌──────────────┐
                    │  SVG Display │ ← Default state (zoom works perfectly)
                    └──────┬───────┘
                           │ User selects a drawing tool
                           │ OR clicks on an annotation to edit
                           ▼
                    ┌──────────────┐
                    │ Fabric.js    │ ← Full editing capabilities
                    │ Edit Mode    │   SVG layer hidden, canvas shown
                    └──────┬───────┘
                           │ User switches to pan tool
                           │ OR clicks away from annotations
                           │ OR zooms (force exit edit mode)
                           ▼
                    ┌──────────────┐
                    │  SVG Display │ ← Canvas → SVG sync happens here
                    └──────────────┘
```

## Implementation Plan

### Step 1: Create SVG Annotation Renderer

**New file:** `src/components/SVGAnnotationLayer.jsx`

**Important:** The existing `src/components/LightweightAnnotationOverlay.jsx` already converts Fabric.js annotation objects to SVG-like display elements (paths, lines, arrows, shapes, callouts). **Start by reading LightweightAnnotationOverlay.jsx thoroughly** — it handles:
- Path rendering (lines with Bezier curves)
- Shape rendering (rectangles, ellipses, lines, arrows with arrowheads)
- Callout rendering (connection lines from annotations to text boxes via `calculateCalloutConnection`)
- Scale-aware dimensions
- Color and opacity handling

You can either:
- **Extend LightweightAnnotationOverlay** to serve as the SVG display layer (rename it, add `viewBox` support)
- **Create a new SVGAnnotationLayer** that reuses the conversion functions from LightweightAnnotationOverlay

The key difference from the existing overlay: SVGAnnotationLayer must use an SVG element with `viewBox` attribute so coordinates are in page space and the browser handles all scaling automatically.

```jsx
function SVGAnnotationLayer({ pageNumber, width, height, annotations, callouts }) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',  // See Step 6 for click-to-edit
        zIndex: 20,
      }}
      preserveAspectRatio="none"
    >
      {annotations?.objects?.map((obj, i) => renderFabricObjectAsSVG(obj, i))}
      {callouts?.map((callout, i) => renderCalloutAsSVG(callout, i))}
    </svg>
  );
}
```

**Conversion approach — two options (try in order):**

1. **Fabric.js `toSVG()` method:** Every Fabric.js object has a `toSVG()` method that returns an SVG string. You could use `object.toSVG()` for each annotation. **Caveat:** This returns raw SVG markup strings, not React elements. You'd need to inject them via `dangerouslySetInnerHTML` or parse them. The existing LightweightAnnotationOverlay builds React SVG elements directly, which integrates more cleanly with React.

2. **Build React SVG elements directly** (recommended): Use the existing conversion patterns from LightweightAnnotationOverlay. The key conversions:
   - `fabric.Path` → `<path d="...">`  (Fabric stores paths as `[["M", x, y], ["Q", cpx, cpy, x, y], ...]` — join into SVG `d` string)
   - `fabric.Rect` → `<rect>`
   - `fabric.Ellipse` → `<ellipse>`
   - `fabric.Line` → `<line>`
   - `fabric.IText` → `<text>` or `<foreignObject>` for wrapped text
   - Arrow lines → `<line>` + `<polygon>` (arrowhead)
   - Highlights → `<rect>` with semi-transparent fill
   - Callouts → `<line>` or `<polyline>` for connection, `<rect>` + `<text>` for label

**All coordinates must be in page space (unscaled).** The `viewBox` handles the scaling. Fabric.js objects store coordinates in the canvas coordinate system (which includes `left`, `top`, `scaleX`, `scaleY`, `angle`). Apply these transforms when generating SVG attributes.

### Step 2: Create Edit Mode Manager

**File:** `src/App.jsx`

Add state to track which page (if any) is in edit mode:

```jsx
const [editingPage, setEditingPage] = useState(null);
```

**Tools that trigger edit mode** (enter edit when `activeTool` changes to one of these):
- `'pen'`, `'highlighter'` — freehand drawing
- `'rect'`, `'ellipse'`, `'line'`, `'arrow'` — shape tools
- `'text'`, `'note'` — text tools
- `'eraser'` — eraser tool
- `'select'` — selection/move tool (allows clicking and moving annotations)
- `'underline'`, `'strikeout'`, `'squiggly'` — text markup tools

**Tools that do NOT trigger edit mode:**
- `'pan'` — panning (no annotation interaction)
- `'callout'` — callouts have their own overlay system separate from the Fabric canvas

**Enter edit mode:** When a drawing tool is selected, set `editingPage` to the page number the user clicks on. If the user selects a drawing tool but hasn't clicked a page yet, edit mode starts on click.

**Exit edit mode** (`setEditingPage(null)`) when:
- User switches to `'pan'` tool
- User starts zooming (force exit — see Step 4)
- User clicks outside any annotation while in `'select'` mode (deselect all)

**Only one page can be edited at a time.** All other pages show SVG. Clicking an annotation on a different page exits edit mode on the current page and enters it on the new page.

### Step 3: Modify the Render Loop

**File:** `src/App.jsx` — portal render section (lines ~24330-24700)

For each page, render the appropriate layer:

```jsx
const overlayDiv = attachOverlayToPageDiv(pageNumber);
if (!overlayDiv) return null;

return createPortal(
  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
    {/* Search highlights — always rendered */}
    {searchResultsByPage[pageNumber]?.length > 0 && (
      <SearchHighlightLayer
        pageNumber={pageNumber}
        width={resolvedPageSize.width}
        height={resolvedPageSize.height}
        scale={layerScale}
        highlights={searchResultsByPage[pageNumber]}
        activeMatchId={currentMatch?.id}
        isActiveMatchOnThisPage={currentMatch?.pageNumber === pageNumber}
      />
    )}

    {/* SVG layer: shown when NOT editing this page */}
    {editingPage !== pageNumber && (
      <SVGAnnotationLayer
        pageNumber={pageNumber}
        width={resolvedPageSize.width}
        height={resolvedPageSize.height}
        annotations={pageAnnotations}
        callouts={pageCallouts}
      />
    )}

    {/* Fabric.js layer: only mounted when editing this page */}
    {editingPage === pageNumber && (
      <PageAnnotationLayer
        pageNumber={pageNumber}
        width={resolvedPageSize.width}
        height={resolvedPageSize.height}
        scale={layerScale}
        // ... all other existing props
      />
    )}
  </div>,
  overlayDiv
);
```

**About the code to remove:** With this approach, you can remove all of the zoom freeze/snapshot/confirm-pending infrastructure listed in the Option 3 spec (see that document's Step 6 for the full list). The same refs, functions, and state variables become unnecessary.

**The dual-layer proxy system** (`syncfusionInteractionPhase` idle/interacting/committing, `LightweightAnnotationOverlay`, proxy payloads) can also be simplified or removed. With SVG display as the default, you don't need a separate lightweight proxy for scroll/drag — SVG is already lightweight. However, the proxy system may still be useful for smooth scroll on pages that are in edit mode. Decision: remove it initially, add back only if scroll performance degrades.

### Step 4: Force-Exit Edit Mode on Zoom

**File:** `src/App.jsx` — `handleSyncfusionZoomChange` and all other zoom entry points

At the start of every zoom handler:
```jsx
if (editingPage !== null) {
  // Save current canvas state (handled automatically by onAnnotationsChange callback)
  setEditingPage(null);
}
```

This means: during zoom, only SVG is showing on all pages. SVG scales perfectly via `viewBox`. Zero flicker by design.

After zoom completes, the user can click back into edit mode if they want to continue drawing.

**About annotation saving:** The existing `onAnnotationsChange` callback (passed as `onSaveAnnotations` prop to PageAnnotationLayer, line ~24628) fires on every canvas modification (object added, modified, removed). So annotations are already saved to state before edit mode exits. No additional "flush on exit" mechanism is needed. When the SVG layer mounts for that page, it reads the same annotation data and renders it.

### Step 5: Simplify PageAnnotationLayer

Since PAL is only active during editing (not during zoom), the zoom complexity can be removed:

**Props to remove from component signature (line ~3081-3140):**
- `onScaleApplied` (line ~3138) — no confirm-pending system
- `presentationApiRegistry` (line ~3139) — no presentation mode
- `isHidden` (line ~3135) — handled by mount/unmount via `editingPage`

**Props to keep:**
- `isInteracting` — still useful to defer canvas resize during rapid scroll/drag while editing
- `isZooming` — user may scroll-zoom slightly while editing before the force-exit kicks in; this prop prevents an expensive canvas resize for that brief moment
- `scale` — the canvas still needs to render at the correct zoom level

**Scale useEffect simplification (lines ~7788-8028):**
- The deferred zoom resize logic can be significantly simplified since PAL will be unmounted whenever zoom occurs (Step 4 force-exits edit mode)
- The center-page-first priority and off-screen deferral are no longer needed since only one page (the editing page) has a canvas
- Simplify to: apply scale immediately via `canvas.setWidth()`, `canvas.setHeight()`, `canvas.setZoom()`, `canvas.renderAll()`

### Step 6: Handle Click-to-Edit on SVG Layer

The SVG layer has `pointerEvents: 'none'` so annotation clicks pass through. We need a way for users to click annotations to enter edit mode.

**Two options:**

**Option A (simpler):** Change SVG layer to `pointerEvents: 'auto'` on interactive SVG elements only. Add `onClick` handlers to each SVG annotation element that call `setEditingPage(pageNumber)`.

**Option B (cleaner):** Add a transparent hit-test div over the SVG layer with `pointerEvents: 'auto'`. On click, check if the click coordinates intersect any annotation bounds. If so, enter edit mode.

**Recommended:** Option A — add click handlers directly to SVG elements. When clicked:
1. Set `editingPage = pageNumber`
2. Set `activeTool = 'select'`
3. After Fabric.js canvas mounts, programmatically select the clicked object

## What Changes vs Option 3

| Aspect | Option 3 | Option 2 |
|--------|----------|----------|
| Display during zoom | Fabric.js canvas with CSS transform (may look blurry) | SVG (pixel-perfect at any zoom) |
| Editing | Always via Fabric.js canvas (all pages) | Fabric.js canvas, only on the page being edited |
| Zoom experience | Canvas stays visible, blurry during transition | SVG stays visible, always crisp |
| Complexity | Simpler than current, still has some timing logic | More code upfront (SVG renderer), but simpler runtime |
| Memory | Canvas always in memory per visible page | Canvas only in memory for one page at a time |
| Flicker risk | Low (CSS transform bridge) | Zero (SVG is flicker-free by design) |

## What Stays The Same

- **Annotation data model** — unchanged
- **Drawing tools** — pen, highlighter, shapes, text, eraser all work the same in Fabric.js
- **Undo/redo** — works the same (only active during edit mode)
- **Syncfusion PDF viewer** — no configuration changes
- **Zoom controls** — all 6 methods work the same
- **Page container tracking** — MutationObserver still detects page div changes

## Testing Plan

1. **SVG display correctness:** Open a PDF with many annotation types (freehand, rectangles, ellipses, lines, arrows, text, highlights, callouts). Verify all render correctly as SVG at multiple zoom levels.
2. **Edit mode entry:** Select pen tool → click on page → verify Fabric.js canvas appears. Verify annotations are editable (movable, selectable, deletable).
3. **Edit mode exit:** Switch to pan tool → verify SVG appears with correct annotations. Verify no visual jump between canvas and SVG (positions should match exactly).
4. **Zoom during display:** Zoom in/out while in SVG mode. Verify zero flicker, perfect scaling at all levels.
5. **Zoom during edit:** Start drawing on a page, then zoom. Verify: edit mode auto-exits, SVG appears, no flicker during zoom.
6. **Annotation round-trip:** Draw something → exit edit mode → verify SVG shows it → re-enter edit mode → verify it's editable → modify it → exit → verify SVG updated.
7. **All annotation types:** Test paths, rectangles, ellipses, lines, arrows, text, highlights, callouts in both SVG display and Fabric.js edit mode.
8. **Multi-page:** Scroll through document with annotations on many pages. Verify SVG renders on all visible pages. Click annotation on different page → verify edit mode switches.
9. **Search highlights:** Verify search results highlight layer works correctly alongside SVG annotations.
10. **Performance:** Open a page with 100+ annotations. Verify SVG renders quickly and scrolling is smooth.

## Risk Assessment

**Medium risk on visual fidelity:** The Fabric.js-to-SVG conversion must be pixel-perfect. If SVG annotations look slightly different from Fabric.js annotations (different line thickness, offset positions, different text rendering), users will see a visual jump when entering/exiting edit mode. **Mitigation:** Use the existing conversion code from `LightweightAnnotationOverlay.jsx` which has already been tested for visual accuracy, and test thoroughly with real annotation data.

**Low risk on zoom:** SVG scaling is guaranteed by browser standards. Zero zoom flicker by design.

**Low risk on data integrity:** Annotation data is saved on every modification via the existing `onAnnotationsChange` callback. No data loss when switching between SVG display and Fabric.js editing.
