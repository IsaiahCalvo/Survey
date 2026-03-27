# Phase 10: Canvas Mount/Unmount (Pen + Eraser) - Research

**Researched:** 2026-03-26
**Domain:** Fabric.js Canvas lifecycle management, React conditional rendering, SVG/Canvas coordination
**Confidence:** HIGH

## Summary

Phase 10 bridges the SVG-only display architecture (Phases 8-9) with the Fabric.js edit-only model. When a user selects pen, highlighter, or eraser tools, a Fabric.js Canvas mounts as a transparent overlay (pen/highlighter) or opaque replacement (eraser) on top of the SVG layer. Each completed stroke or erase gesture immediately commits to the annotation JSON (same format as existing data), and on tool switch the Canvas unmounts leaving the SVG layer to display all committed results.

The critical technical challenges are: (1) Fabric.js 5.5.2 wraps the provided `<canvas>` element in a div and creates an upper canvas during construction, which conflicts with React's DOM ownership -- disposal must carefully unwrap before React removes the container; (2) per-stroke commit requires serializing only the new path from `path:created` and merging it into the existing annotations JSON without a full `canvas.toJSON()` roundtrip; (3) the eraser Canvas must load all page annotations via `enlivenObjects` before becoming interactive, requiring a brief loading state; (4) undo granularity at one-checkpoint-per-stroke requires calling `handleSaveAnnotations` (which internally calls `addHistoryCheckpoint`) on every `path:created` and every erase gesture completion.

**Primary recommendation:** Build two focused React components -- `FabricDrawingCanvas` (pen + highlighter, transparent overlay, SVG visible underneath) and `FabricEraserCanvas` (loads all annotations, SVG hidden, opaque background). Both mount/unmount based on `activeTool` state in App.jsx. Use React `key` props tied to tool+page to force clean mount/unmount cycles. Canvas disposal happens synchronously in useEffect cleanup.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Per-stroke commit: each completed stroke immediately commits to SVG data AND remains visible on Canvas
- Debounced Supabase sync: SVG data updates instantly (visual), Supabase persistence debounced 2-3 seconds
- Canvas accumulates strokes during the drawing session -- strokes are NOT removed from Canvas after commit
- On tool switch: Canvas unmounts, SVG layer shows all committed strokes (no visual gap since they were already committed)
- Undo granularity: one Ctrl+Z = one stroke removed from BOTH Canvas and SVG simultaneously
- Undo while pen is active removes from both layers at once -- no desync between Canvas visual and SVG data
- Brief cursor change (wait/spinner) during eraser Canvas mount while annotations load (20-200ms)
- SVG layer HIDDEN while eraser Canvas is mounted -- avoids double-rendering artifacts
- Canvas shows all page annotations during erase mode (user erases against Canvas objects)
- Per-erase-stroke commit: each completed erase gesture immediately commits modified annotations to SVG data
- Each erase action is one Ctrl+Z step
- Live multiply blend mode: Canvas uses `globalCompositeOperation: 'multiply'` during highlighter drawing
- Pen and highlighter share the SAME Canvas component -- differentiated by brush settings
- Switching pen to/from highlighter does NOT unmount Canvas -- just reconfigures brush settings
- Canvas only unmounts when switching to a non-drawing tool (select, pan, eraser, etc.)
- One shared drawing Canvas component for pen + highlighter (FabricDrawingCanvas or similar)
- Separate eraser Canvas component (different behavior: loads all annotations, SVG hidden)
- Drawing tools (pen, highlighter): Canvas transparent overlay, SVG visible underneath
- Eraser tool: Canvas opaque (shows all annotations), SVG hidden

### Claude's Discretion
- Canvas component naming and internal structure
- React key prop strategy for clean mount/unmount
- Fabric.js Canvas disposal approach (async dispose() + StrictMode compatibility -- spike from STATE.md blocker)
- Brush configuration details (PencilBrush setup, stroke smoothing)
- Eraser boolean path geometry implementation (reuse existing `geometryEraser.js`)
- How annotation loading into eraser Canvas works (enlivenObjects vs manual recreation)
- Z-index layering between SVG and Canvas elements

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDIT-01 | Pen/highlighter tool mounts a transparent Fabric.js Canvas over the entire page for stroke capture at 60fps | Drawing Canvas architecture, PencilBrush configuration, transparent overlay positioning |
| EDIT-02 | Completed pen/highlighter strokes are serialized to Fabric.js JSON and committed to the SVG layer | Per-stroke commit pattern via path:created handler, JSON merge into annotationsByPage |
| EDIT-03 | Canvas stays mounted while pen/highlighter tool is active, unmounts on tool switch | React conditional rendering based on activeTool, tool category grouping |
| EDIT-04 | Eraser tool mounts Canvas and loads all page annotations for boolean path intersection/subtraction | Eraser Canvas architecture, enlivenObjects loading, geometryEraser.js reuse |
| EDIT-05 | Eraser results are serialized back to Fabric.js JSON and committed to SVG layer on tool deactivation | Per-erase-gesture commit via erasePathSegment + canvas.toJSON serialization |
| EDIT-09 | Canvas auto-commits unsaved changes before unmounting (no data loss on tool switch or zoom) | useEffect cleanup pattern, pre-unmount commit flush |
| EDIT-10 | Canvas mount/unmount lifecycle uses React state + key prop for clean Fabric.js creation/disposal | Canvas wrapper div management, synchronous dispose(), key prop strategy |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fabric | 5.5.2 | Canvas drawing (PencilBrush) + eraser object manipulation | Already in project, locked constraint |
| react | (project version) | Component lifecycle, conditional rendering, key-based remount | Already in project |
| martinez-polygon-clipping | (project version) | Boolean path ops for eraser (via geometryEraser.js) | Already imported in geometryEraser.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | Zero new dependencies constraint |

**Installation:**
No new packages needed. All dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── components/
│   ├── SVGAnnotationLayer.jsx       # Existing - display layer (Phase 8-9)
│   ├── FabricDrawingCanvas.jsx      # NEW - pen + highlighter Canvas
│   └── FabricEraserCanvas.jsx       # NEW - eraser Canvas
├── hooks/
│   ├── useSVGInteraction.js         # Existing - SVG selection/drag
│   └── useFabricCanvas.js           # NEW - shared Canvas lifecycle hook
├── utils/
│   ├── geometryEraser.js            # Existing - boolean path subtraction
│   └── svgAnnotationRenderers.jsx   # Existing - SVG rendering
```

### Pattern 1: Canvas Lifecycle via useEffect + Ref

**What:** Fabric.js Canvas is created in a useEffect, stored in a ref, and disposed in the cleanup function. The `<canvas>` element is owned by React; Fabric wraps it during construction and unwraps during disposal.

**When to use:** Every Canvas mount/unmount cycle.

**Critical detail:** Fabric.js 5.5.2 `Canvas()` constructor wraps the provided `<canvas>` element in a `<div class="canvas-container">` and adds an upper canvas for interaction events. The `dispose()` method reverses this -- it removes the upper canvas, unwraps the div, and replaces the wrapper with the original canvas element. This is SYNCHRONOUS in Fabric.js 5.5.2 (the STATE.md blocker about "async dispose()" is a false alarm -- that's a Fabric.js 6.x concern, and this project uses 5.5.2). The project also does NOT use React StrictMode, so double-mount/double-dispose is not a concern.

**Example:**
```jsx
// Source: PAL lines 5241-5268 (existing pattern) + Fabric 5.5.2 source (dispose at line 12842)
const FabricDrawingCanvas = ({ pageWidth, pageHeight, onStrokeCommit, brushConfig }) => {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);

  useEffect(() => {
    if (!canvasElRef.current) return;

    // Create Fabric Canvas -- this wraps canvasElRef.current in a div
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: containerWidth,
      height: containerHeight,
      backgroundColor: 'transparent',
      isDrawingMode: true,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
    });

    // Setup PencilBrush
    const brush = new fabric.PencilBrush(canvas);
    brush.color = brushConfig.color;
    brush.width = brushConfig.width;
    canvas.freeDrawingBrush = brush;

    // Per-stroke commit handler
    canvas.on('path:created', (e) => {
      if (e.path) {
        e.path.set({ strokeUniform: true });
        onStrokeCommit(e.path);
      }
    });

    fabricRef.current = canvas;

    return () => {
      // Synchronous disposal -- safe in Fabric 5.5.2
      canvas.off();
      try { canvas.dispose(); } catch (e) { console.error('Disposal error:', e); }
      fabricRef.current = null;
    };
  }, []); // Mount once, dispose on unmount

  return <canvas ref={canvasElRef} />;
};
```

### Pattern 2: Tool-Driven Conditional Rendering

**What:** The parent component (App.jsx portal render) conditionally renders the appropriate Canvas component based on `activeTool`. Pen/highlighter share one component; eraser gets a separate one. The SVG layer's visibility is controlled based on which Canvas is mounted.

**When to use:** Tool switching in App.jsx render.

**Example:**
```jsx
// In App.jsx portal render, alongside SVGAnnotationLayer
const isDrawingTool = activeTool === 'pen' || activeTool === 'highlighter';
const isEraserTool = activeTool === 'eraser';

{/* SVG layer -- hidden when eraser is mounted */}
<div style={{ visibility: isEraserTool ? 'hidden' : 'visible' }}>
  <SVGAnnotationLayer ... />
</div>

{/* Drawing Canvas -- transparent overlay, SVG visible underneath */}
{isDrawingTool && (
  <FabricDrawingCanvas
    key={`draw-${pageNumber}`}
    activeTool={activeTool}
    ...
  />
)}

{/* Eraser Canvas -- opaque, SVG hidden */}
{isEraserTool && (
  <FabricEraserCanvas
    key={`erase-${pageNumber}`}
    ...
  />
)}
```

**Key insight:** The `key` prop includes `pageNumber` but NOT `activeTool` for the drawing canvas. This means switching pen-to-highlighter does NOT remount the component (just changes brush config via a useEffect). But switching from pen to select DOES unmount (the conditional `isDrawingTool` becomes false).

### Pattern 3: Per-Stroke Commit to SVG Data

**What:** On each `path:created` event, the new path object is serialized to JSON and appended to the existing `annotations.objects` array. This updated JSON is passed to `handleSaveAnnotations` which creates a history checkpoint and updates `annotationsByPage` state. The SVG layer re-renders with the new stroke included, but since the Canvas is still mounted on top, the user sees both the Canvas stroke and the SVG stroke (they overlap perfectly). On unmount, the Canvas disappears and only the SVG remains.

**When to use:** Every completed pen/highlighter stroke.

**Example:**
```jsx
// Inside FabricDrawingCanvas
const handlePathCreated = useCallback((e) => {
  if (!e.path) return;

  e.path.set({
    strokeUniform: true,
    perPixelTargetFind: true,
    uniformScaling: false,
    centeredRotation: true,
  });

  // Assign metadata
  if (selectedModuleId) e.path.set({ moduleId: selectedModuleId });
  if (activeRegionId) e.path.set({ regionId: activeRegionId });

  // Serialize just this path
  const pathJSON = e.path.toJSON([
    'strokeUniform', 'spaceId', 'moduleId', 'regionId',
    'data', 'name', 'globalCompositeOperation', 'layer'
  ]);

  // Merge into existing annotations
  const updated = {
    ...currentAnnotations,
    objects: [...(currentAnnotations?.objects || []), pathJSON]
  };

  // Commit to SVG data + undo checkpoint
  onSaveAnnotations(updated, { source: 'path:created', tool: activeTool });
}, [currentAnnotations, onSaveAnnotations, activeTool]);
```

### Pattern 4: Eraser Canvas Full-Page Load

**What:** When eraser tool activates, mount a Canvas, load ALL page annotations via `fabric.util.enlivenObjects`, apply eraser gestures against the loaded objects, then on each completed erase gesture serialize the modified Canvas back to JSON and commit.

**When to use:** Eraser tool activation.

**Example flow:**
```
1. User clicks eraser tool
2. Cursor changes to wait/spinner
3. FabricEraserCanvas mounts, SVG layer hidden
4. enlivenObjects loads all annotations from annotationsByPage[pageNumber]
5. Canvas renders all annotations (user sees same visual as SVG)
6. Cursor changes to eraser cursor
7. User draws erase stroke (mouse:down -> mouse:move -> mouse:up)
8. On mouse:up: apply boolean subtraction via geometryEraser.js
9. Serialize affected objects, commit updated JSON via onSaveAnnotations
10. Canvas re-renders with erased result
11. User switches tool -> Canvas unmounts, SVG shows with erased results
```

### Pattern 5: Pre-Unmount Commit Flush (EDIT-09)

**What:** Before the Canvas unmounts (tool switch, zoom, page change), any in-progress state is auto-committed. For pen/highlighter, strokes are already committed per-stroke so there's nothing to flush unless a stroke is literally in progress (user is mid-draw). For eraser, the last erase gesture's results need to be committed if not already.

**When to use:** useEffect cleanup, and as a response to external events (zoom start).

**Critical detail:** Fabric.js `path:created` fires AFTER the stroke is complete (mouse:up), so a truly in-progress stroke (mouse still down) won't have fired `path:created` yet. For the zoom-during-stroke case (EDIT-09 + Success Criteria #4), we need to listen for zoom events and force-complete the current stroke before unmounting.

### Anti-Patterns to Avoid

- **Permanent Canvas mount:** Do NOT keep the Canvas mounted and toggle `isDrawingMode`. The entire point of Phase 10 is Canvas mounts ONLY during drawing/erasing. Memory savings come from unmounting.

- **Full canvas.toJSON() on every stroke:** Do NOT serialize the entire canvas on each `path:created`. The drawing canvas only contains new strokes -- serialize just the new path and merge. (Exception: eraser canvas DOES use full toJSON because objects are modified in place.)

- **Letting Fabric.js manage the DOM wrapper after React unmounts:** When React removes the container div, Fabric's wrapper div becomes orphaned. Always call `dispose()` in the useEffect cleanup BEFORE React removes the DOM.

- **Using canvas.loadFromJSON for eraser:** `loadFromJSON` replaces all objects and fires a callback. Use `enlivenObjects` instead -- it gives you the objects array to add individually, with more control over the loading process.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Boolean path subtraction for eraser | Custom polygon math | `geometryEraser.js` (`booleanErasePath`, `splitPathDataByEraser`) | Already handles transform matrices, path flattening, martinez-polygon-clipping integration |
| Canvas wrapper div management | Manual DOM manipulation | Fabric.js `Canvas()` constructor + `dispose()` | Handles upper canvas, event listeners, retina scaling, wrapper div creation/removal |
| Stroke smoothing / bezier fitting | Custom bezier algorithms | `PencilBrush` built into Fabric.js | Handles mouse sampling, curve fitting, smooth path generation at 60fps |
| Undo history management | Custom undo stack | Existing `handleSaveAnnotations` + `addHistoryCheckpoint` | Full-page snapshot approach with 50-checkpoint cap, dedup by hash, interaction ID tracking |
| Supabase sync debouncing | Custom debounce timer | Existing `useEffect` in App.jsx (line ~19508) | 2-second debounce, interaction-aware deferral, error handling with auto-disable |

**Key insight:** Almost all infrastructure for this phase already exists. The PAL (PageAnnotationLayer.jsx) has working pen/highlighter/eraser logic. The task is to extract and adapt these patterns into focused mount/unmount components, not to build from scratch.

## Common Pitfalls

### Pitfall 1: Fabric.js Wrapper Div Orphaning
**What goes wrong:** React unmounts the container, but Fabric's wrapper div (created during `new Canvas()`) was inserted between the React-owned container and the canvas element. React can't find its expected DOM structure.
**Why it happens:** Fabric.js `Canvas()` calls `_initWrapperElement()` which wraps the `<canvas>` in a `<div class="canvas-container">`. React doesn't know about this wrapper.
**How to avoid:** Always call `canvas.dispose()` in the useEffect cleanup BEFORE React removes the element. `dispose()` calls `wrapper.parentNode.replaceChild(this.lowerCanvasEl, this.wrapperEl)` which unwraps the canvas back to its original state.
**Warning signs:** Console errors about "removeChild" on null parent, or orphaned `<div class="canvas-container">` elements in the DOM after tool switches.

### Pitfall 2: Canvas Sizing Mismatch (Container-Aware)
**What goes wrong:** Canvas appears smaller than the SVG layer at certain zoom levels, causing annotations to be misaligned.
**Why it happens:** Computing canvas dimensions as `pageWidth * scale` doesn't account for browser/Electron zoom factor. The CLAUDE.md explicitly warns about this.
**How to avoid:** Measure `containerEl.offsetWidth / pageWidth` to get `effectiveScale`, then set canvas dimensions to `Math.floor(pageWidth * effectiveScale) x Math.floor(pageHeight * effectiveScale)`. This is the same container-aware pattern used in PAL (lines 5227-5238).
**Warning signs:** Annotations appear offset or smaller at non-100% browser zoom levels.

### Pitfall 3: Highlighter Multiply Blend Mode Not Persisting
**What goes wrong:** Highlighter strokes look correct on Canvas (yellow with multiply blend) but render as opaque yellow rectangles in SVG after commit.
**Why it happens:** The `path:created` handler doesn't set `globalCompositeOperation: 'multiply'` on the path before serializing, so the SVG renderer doesn't apply `mix-blend-mode: multiply`.
**How to avoid:** In the `path:created` handler, when `activeTool === 'highlighter'`, set `e.path.set({ globalCompositeOperation: 'multiply' })` before serializing. The SVG renderer already handles this property (via svgAnnotationRenderers.jsx).
**Warning signs:** Highlighter strokes change appearance when switching away from pen/highlighter tool.

### Pitfall 4: Undo Desync Between Canvas and SVG
**What goes wrong:** Ctrl+Z removes a stroke from SVG but the Canvas still shows it, or vice versa.
**Why it happens:** The undo system restores `annotationsByPage` state, which the SVG layer reads. But if the Canvas has accumulated strokes locally that aren't in sync with the restored state, they diverge.
**How to avoid:** On undo (when `annotations` prop changes), the Drawing Canvas must detect the change and sync -- either by removing the last-added path from the Canvas, or by unmounting and remounting. The simplest approach: listen for `annotations` prop changes via useEffect, and if the object count decreased (undo), remove the last path from the Canvas to stay in sync.
**Warning signs:** Visual inconsistency between what's shown on Canvas vs. what appears after tool switch.

### Pitfall 5: Eraser Loading Race Condition
**What goes wrong:** User starts erasing before `enlivenObjects` finishes loading annotations into the Canvas. Erase gesture finds no objects, commits empty canvas, wiping all annotations.
**Why it happens:** `enlivenObjects` is asynchronous (callback-based). If the Canvas is interactive before loading completes, eraser gestures operate on an empty canvas.
**How to avoid:** Set `isDrawingMode: false` and `skipTargetFind: true` initially. Track a `loadingRef` flag. Only enable eraser interaction and change cursor after `enlivenObjects` callback fires and all objects are added.
**Warning signs:** Annotations disappear entirely after first erase gesture on a page.

### Pitfall 6: Rapid Tool Switching Causes Multiple Canvas Instances
**What goes wrong:** User clicks pen, then immediately eraser, then back to pen within 100ms. Multiple Canvas instances may exist simultaneously.
**Why it happens:** React batches state updates but useEffect cleanup is synchronous. If tool state changes before the previous Canvas's useEffect cleanup runs, two canvases could coexist briefly.
**How to avoid:** Use React's strict conditional rendering (`isDrawingTool && <FabricDrawingCanvas>`) rather than trying to manage mounting/unmounting imperatively. React's reconciliation handles this correctly -- the old component unmounts (cleanup runs) before the new one mounts.
**Warning signs:** Multiple `<div class="canvas-container">` elements in the DOM, or "removeChild" errors.

## Code Examples

### Canvas Sizing (Container-Aware) -- CRITICAL
```jsx
// Source: PAL lines 5227-5238, CLAUDE.md container-aware sizing rule
const measureCanvasSize = (containerEl, pageWidth, pageHeight) => {
  if (!containerEl || !pageWidth || !pageHeight) return null;
  const containerWidth = containerEl.offsetWidth;
  if (containerWidth <= 0) return null;
  const effectiveScale = containerWidth / pageWidth;
  return {
    width: Math.floor(pageWidth * effectiveScale),
    height: Math.floor(pageHeight * effectiveScale),
    effectiveScale,
  };
};
```

### PencilBrush Configuration for Pen vs Highlighter
```jsx
// Source: PAL lines 4902-4907, 5274-5277
const configureBrush = (canvas, activeTool, strokeColor, highlightColor, strokeWidth) => {
  if (!canvas.freeDrawingBrush) {
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
  }
  const brush = canvas.freeDrawingBrush;

  if (activeTool === 'highlighter') {
    brush.color = highlightColor;
    brush.width = Math.max(strokeWidth, 8); // Highlighter minimum width
  } else {
    brush.color = strokeColor;
    brush.width = strokeWidth;
  }
};
```

### Path Serialization with Custom Properties
```jsx
// Source: PAL lines 5291, 3613 -- custom properties list
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType'
];

// Serialize a single path for per-stroke commit
const serializePath = (pathObj) => {
  return pathObj.toJSON(CUSTOM_PROPS);
};
```

### Canvas Disposal (Synchronous)
```jsx
// Source: PAL lines 7826-7834, Fabric 5.5.2 dispose() at dist/fabric.js:12842
const disposeCanvas = (fabricRef) => {
  if (fabricRef.current) {
    fabricRef.current.off(); // Remove all event listeners
    try {
      fabricRef.current.dispose(); // Synchronous in 5.5.2
    } catch (e) {
      console.error('Canvas disposal error:', e);
    }
    fabricRef.current = null;
  }
};
```

### Eraser Loading with enlivenObjects
```jsx
// Source: PAL lines 4929-4982
const loadAnnotationsForEraser = (canvas, annotationsJSON) => {
  return new Promise((resolve) => {
    if (!annotationsJSON?.objects?.length) {
      resolve();
      return;
    }

    fabric.util.enlivenObjects(annotationsJSON.objects, (enlivenedObjects) => {
      enlivenedObjects.forEach((obj, index) => {
        const objData = annotationsJSON.objects[index];

        obj.set({
          strokeUniform: true,
          selectable: false,  // Eraser doesn't select, it erases
          evented: false,     // Don't fire events on annotation objects
        });

        // Preserve metadata
        if (objData.spaceId) obj.spaceId = objData.spaceId;
        if (objData.moduleId) obj.moduleId = objData.moduleId;
        if (objData.regionId) obj.regionId = objData.regionId;
        if (objData.layer) obj.layer = objData.layer;

        // Enforce multiply blend mode for highlights
        if (obj.highlightId || obj.needsBIC) {
          obj.set({ globalCompositeOperation: 'multiply' });
        }

        canvas.add(obj);
      });

      canvas.renderAll();
      resolve();
    });
  });
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Permanent Canvas mount (PAL) | Mount/unmount per tool activation | Phase 10 (now) | ~44MB memory savings per page when not editing |
| Full canvas.toJSON on save | Per-stroke JSON merge for drawing; full toJSON for eraser | Phase 10 (now) | Faster saves during drawing sessions |
| Fabric.js 6.x async dispose | Fabric.js 5.5.2 sync dispose | N/A (project uses 5.5.2) | Simpler cleanup, no async concerns |
| React StrictMode double-mount | No StrictMode in project | N/A (not used) | No double-mount/dispose handling needed |

**Deprecated/outdated concerns:**
- STATE.md blocker "Validate async dispose() + React StrictMode rapid tool switching (spike recommended)" -- RESOLVED. Fabric.js 5.5.2 `dispose()` is synchronous (verified in `node_modules/fabric/dist/fabric.js` line 12842-12858). The project does NOT use React StrictMode (grep of entire src/ confirms zero StrictMode references). No spike needed.

## Open Questions

1. **Canvas coordinate space alignment with SVG viewBox**
   - What we know: SVG uses `viewBox="0 0 pageWidth pageHeight"` in unscaled page coordinates. The Canvas uses pixel dimensions (`pageWidth * effectiveScale` x `pageHeight * effectiveScale`). Strokes drawn on Canvas are in scaled pixel space; SVG annotations are in unscaled page space.
   - What's unclear: Whether the `path:created` path coordinates need to be divided by `effectiveScale` before committing to SVG data, or whether Fabric.js PencilBrush already accounts for canvas dimensions.
   - Recommendation: PencilBrush paths are in Canvas coordinate space. Since the Canvas dimensions match the visible size (container-aware), and the SVG viewBox maps to the same visible area, the path coordinates from Fabric should map 1:1 to SVG viewBox coordinates IF the Canvas uses `setZoom(effectiveScale)` or adjusts path coordinates on commit. The existing PAL approach (which works) uses canvas dimensions = scaled size with no explicit zoom, meaning path coordinates are in scaled space. The per-stroke commit must divide path coordinates by `effectiveScale` to get unscaled page coordinates. **Alternatively**, set `canvas.setZoom(effectiveScale)` and use unscaled canvas dimensions (`pageWidth x pageHeight`) -- then paths are automatically in page space. This approach is cleaner. Research recommends the zoom approach.

2. **Eraser Canvas white/opaque background vs transparent**
   - What we know: CONTEXT.md says "Canvas opaque (shows all annotations), SVG hidden." The user should see annotations on a white background (like the PDF page).
   - What's unclear: Whether to use a white `backgroundColor` on the Canvas, or to position it behind/over the PDF page content.
   - Recommendation: Set `backgroundColor: 'white'` on the eraser Canvas. The PDF page content is already visible underneath (rendered by Syncfusion), but since the SVG layer is hidden and the Canvas sits in the overlay div, a white background ensures the eraser experience looks clean. If the user needs to see the PDF content while erasing, use `backgroundColor: 'transparent'` and only hide the SVG layer (not the PDF). This is a presentation decision for the planner.

3. **Undo interaction when Canvas is mounted**
   - What we know: Undo restores `annotationsByPage` state. The SVG layer reads this state. Per-stroke commit means each stroke IS in annotationsByPage.
   - What's unclear: When user presses Ctrl+Z while the drawing Canvas is mounted, should the Canvas also remove its last path to stay in sync? Or should it just let the `annotations` prop change flow through?
   - Recommendation: The Drawing Canvas should watch the `annotations` prop. When it detects a removal (object count decreased), remove the corresponding path from the Canvas. This keeps visual sync. The simplest implementation: track paths added during this session in an array; on undo, pop the last one and call `canvas.remove(lastPath)`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 + Node built-in test runner |
| Config file | `debug/playwright.config.mjs` (Playwright), none for unit tests |
| Quick run command | `node --experimental-default-type=module --test tests/*.test.mjs` |
| Full suite command | `npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDIT-01 | Pen/highlighter mounts transparent Canvas over page | manual (visual) | Manual: select pen, verify canvas element appears in DOM | N/A |
| EDIT-02 | Completed strokes serialize to JSON and commit to SVG | manual (visual) | Manual: draw stroke, switch to select, verify stroke persists | N/A |
| EDIT-03 | Canvas stays mounted during pen/highlighter, unmounts on tool switch | manual (DOM inspection) | Manual: check DOM for canvas-container during pen, verify removal after switch | N/A |
| EDIT-04 | Eraser mounts Canvas with all annotations loaded | manual (visual) | Manual: select eraser, verify all annotations visible on canvas | N/A |
| EDIT-05 | Eraser results commit to SVG on tool switch | manual (visual) | Manual: erase, switch tool, verify erasure persists in SVG | N/A |
| EDIT-09 | Auto-commit before unmount (no data loss) | manual (visual) | Manual: draw stroke, immediately switch tool, verify stroke saved | N/A |
| EDIT-10 | Clean mount/unmount via React key prop | manual (DOM inspection) | Manual: rapid tool switching, check for orphaned elements/console errors | N/A |

### Sampling Rate
- **Per task commit:** Manual visual verification (dev server at localhost:5173)
- **Per wave merge:** Full manual test of all 4 success criteria
- **Phase gate:** All 4 success criteria passing before `/gsd:verify-work`

### Wave 0 Gaps
- No automated tests for Canvas mount/unmount behavior -- these are inherently visual/interactive tests
- Could add a DOM structure assertion test (check for canvas-container element count) but ROI is low for this phase
- Existing Playwright debug scenarios (`pal-zoom.spec.mjs`, `render-loop.spec.mjs`) test Canvas mode, not SVG mode
- Recommendation: Rely on manual verification against the 4 success criteria. Automated Canvas lifecycle tests would require complex Playwright setup with tool switching simulation.

## Sources

### Primary (HIGH confidence)
- Fabric.js 5.5.2 source (`node_modules/fabric/dist/fabric.js`) -- Canvas constructor (line 12563+), dispose() (line 12842-12858), StaticCanvas dispose (line 10645-10675), PencilBrush, enlivenObjects
- `src/PageAnnotationLayer.jsx` -- Existing pen/eraser implementation patterns (lines 4870-4913 tool switching, 5241-5268 Canvas creation, 5274-5277 PencilBrush setup, 5462-5487 path:created handler, 6356-6390 eraser mouse:down, 7826-7834 disposal)
- `src/App.jsx` -- Tool state (line 11252), handleSaveAnnotations (line 22588), addHistoryCheckpoint (line 14866), SVGAnnotationLayer render (line 24930), portal structure
- `src/components/SVGAnnotationLayer.jsx` -- Full component (517 lines), activeTool handling, pointer events, viewBox rendering
- `src/utils/geometryEraser.js` -- Boolean path ops (booleanErasePath, splitPathDataByEraser)
- `src/hooks/useSVGInteraction.js` -- Interaction patterns, inverseScale via ResizeObserver

### Secondary (MEDIUM confidence)
- CLAUDE.md container-aware sizing rule -- verified against PAL implementation
- Phase 8/9 CONTEXT.md -- established patterns for undo, persistence, Supabase sync debounce

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, versions verified against node_modules
- Architecture: HIGH -- patterns directly ported from existing PAL implementation with verified Fabric.js 5.5.2 source behavior
- Pitfalls: HIGH -- derived from actual PAL bugs and Fabric.js source code analysis, plus CLAUDE.md documented gotchas
- Canvas lifecycle: HIGH -- Fabric.js 5.5.2 dispose() verified as synchronous, StrictMode absence verified

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable -- Fabric.js 5.5.2 is locked, no moving parts)
