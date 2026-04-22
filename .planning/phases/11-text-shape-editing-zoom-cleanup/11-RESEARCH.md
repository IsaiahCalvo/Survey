# Phase 11: Text/Shape Editing + Zoom Cleanup - Research

**Researched:** 2026-03-27
**Domain:** Fabric.js IText/Textbox editing lifecycle, Canvas mount/unmount for targeted annotation editing, old zoom timer system removal
**Confidence:** HIGH

## Summary

Phase 11 has two independent work streams: (1) building FabricEditCanvas -- a single component that handles text, shape, and callout editing via double-click-triggered Canvas mount, and (2) removing the old 5-timer zoom coordination system from App.jsx and PageAnnotationLayer.jsx. Both streams build on patterns thoroughly established in Phases 9-10.

The editing work stream reuses `useFabricCanvas` hook, container-aware sizing, `flushSync` dispose pattern, and `zoomGeneration` tracking from Phase 10. The key new behaviors are: loading a single annotation into Canvas via `fabric.util.enlivenObjects`, enabling Fabric.js interactive mode (not `isDrawingMode`), and committing edits back to SVG JSON on blur. Text editing uses Fabric.js `IText.enterEditing()` / `exitEditing()` with `text:editing:exited` events. The existing PAL code at lines 5110-5122 and 6422-6441 provides direct reference patterns for IText lifecycle.

The zoom cleanup stream is the largest code deletion in the project. App.jsx has ~183 references to the old system (confirmPending, freeze, settle, onScaleApplied, snapshot) and PAL has ~42 references. However, the SVG-mode guard at line 10165 already short-circuits the entire machinery -- this means the old code is already dead in SVG mode and removal is safe. The CLAUDE.md warnings about never removing these functions were written before SVG migration; in SVG mode, these functions are provably inert.

**Primary recommendation:** Build FabricEditCanvas first (editing is the user-facing feature), then do zoom cleanup as a separate wave (pure deletion with grep-verified completeness).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Double-click a text annotation triggers Canvas mount at annotation bounding box + ~20px padding
- SVG layer stays visible underneath (other annotations remain visible) for text/shape editing
- Canvas transparent background -- only the target annotation is loaded
- Click outside text Canvas commits edit, Canvas unmounts, SVG updates
- Escape key cancels edit (revert to pre-edit state), Canvas unmounts
- One undo checkpoint per completed edit (same pattern as Phase 9 move/resize, Phase 10 stroke)
- Supabase sync debounced 2-3 seconds after local commit
- New text creation: text tool active + click on empty PDF space opens Canvas with empty IText
- Text rendering via foreignObject -- positionally correct, not pixel-perfect
- Shape double-click mounts Canvas at bbox + padding, full Fabric.js interactive mode
- Callout double-click mounts full-page Canvas, SVG layer hidden (eraser pattern)
- One shared FabricEditCanvas component handles text, shape, AND callout editing via `type` prop
- Zoom during text editing: auto-commit, CSS transform, 200ms settle, remount with cursor restored
- Zoom during shape/callout: CSS transform + 200ms settle + remount (Phase 10 pattern)
- 200ms settle debounce for ALL Canvas types
- Remove old 5-timer zoom system, freeze/snapshot/confirm-pending machinery, dead props

### Claude's Discretion
- Dead code removal strategy (gradual with safety checks vs all-at-once cleanup)
- Canvas mode toggle fate (keep as dev escape hatch or remove)
- FabricEditCanvas internal structure and lifecycle management
- Floating mini-toolbar implementation for shape color/stroke editing
- Cursor position restoration logic after zoom remount during text editing
- IText configuration details (font fallbacks, cursor behavior)
- How callout multi-part group is loaded into Canvas (enlivenObjects vs manual recreation)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDIT-06 | Text double-click mounts targeted Fabric.js Canvas sized to annotation bbox for IText editing | FabricEditCanvas with `type='text'`, bbox sizing, IText.enterEditing() pattern from PAL line 7115 |
| EDIT-07 | Text edit commits on blur (click outside) -- Canvas unmounts, SVG updates with new text content | text:editing:exited event + click-outside detection + onEditCommit callback + flushSync dispose pattern |
| EDIT-08 | Shape/callout double-click mounts targeted Canvas for property editing (color, stroke, resize) | FabricEditCanvas with `type='shape'` (bbox) or `type='callout'` (full-page), enlivenObjects loading |
| ZOOM-01 | SVG layer zoom handled entirely by viewBox -- zero JavaScript timers | Already true in SVG mode (guard at App.jsx:10165); cleanup removes dead code paths |
| ZOOM-02 | Canvas mounted during zoom gets CSS transform for visual stability | Existing ResizeObserver pattern in FabricDrawingCanvas/FabricEraserCanvas; FabricEditCanvas reuses |
| ZOOM-03 | After zoom settles (200ms debounce), Canvas remounts at new dimensions | ResizeObserver fires on container resize; 200ms debounce in FabricEditCanvas zoom handling |
| ZOOM-04 | In-progress pen stroke auto-committed on zoom start, pen resumes after settle | Already implemented in FabricDrawingCanvas via zoomGeneration; extend to text auto-commit |
| ZOOM-05 | All 6 zoom methods work | SVG viewBox handles all 6; Canvas CSS transform bridges gap during zoom |
| ZOOM-06 | Freeze/snapshot/confirm-pending machinery removed from App.jsx | ~14 functions, ~30 refs to remove; grep-verified deletion |
| ZOOM-07 | Dead props removed from PageAnnotationLayer | onScaleApplied, presentationApiRegistry, isHidden -- remove prop declarations and usages |
| ZOOM-08 | Old 5-timer zoom system fully replaced | PAL settle (300ms), App settle (1000ms), confirm-pending (3000ms), tier-2 defer (800ms), overlay safety (5000ms) all removed |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fabric | 5.5.2 | Canvas editing (IText, shape interactive mode) | Already pinned; project constraint |
| react | 18.x | Component lifecycle, state management | Already in use |
| react-dom | 18.x | flushSync for dispose pattern | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (no new deps) | -- | -- | Zero new runtime dependencies per PROJECT.md constraint |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom text editing in SVG | `contentEditable` in foreignObject | Would avoid Canvas mount, but loses Fabric.js formatting consistency |
| Mini-toolbar as separate npm package | Hand-built React component | Simpler, keeps zero-deps constraint, matches project style |

## Architecture Patterns

### Recommended Project Structure
```
src/
  components/
    FabricEditCanvas.jsx     # NEW: unified text/shape/callout edit Canvas
    FabricDrawingCanvas.jsx  # Existing: pen + highlighter
    FabricEraserCanvas.jsx   # Existing: eraser
    SVGAnnotationLayer.jsx   # Existing: display layer (no changes)
    SVGSelectionOverlay.jsx  # Existing: selection handles
  hooks/
    useFabricCanvas.js       # Existing: shared Canvas lifecycle (reused by FabricEditCanvas)
  utils/
    svgAnnotationRenderers.jsx  # Existing: JSON-to-SVG renderers (no changes)
    calloutGeometry.js          # Existing: callout line/knee calculations (reused)
```

### Pattern 1: Targeted Canvas Mount (bbox or full-page)
**What:** FabricEditCanvas mounts at the annotation's bounding box with padding (text/shape) or full-page (callout)
**When to use:** Double-click on any editable annotation in SVG layer
**Example:**
```jsx
// In App.jsx render, after SVGAnnotationLayer:
{editingAnnotation && (
  <FabricEditCanvas
    key={`edit-${editingAnnotation.pageNumber}-${editingAnnotation.index}`}
    pageNumber={editingAnnotation.pageNumber}
    pageWidth={resolvedPageSize.width}
    pageHeight={resolvedPageSize.height}
    annotationType={editingAnnotation.type}  // 'text' | 'shape' | 'callout'
    annotationData={editingAnnotation.data}
    annotationIndex={editingAnnotation.index}
    annotations={pageAnnotations}
    onEditCommit={(updatedJSON) => {
      handleSaveAnnotations(pageNumber, updatedJSON, {
        source: 'edit:commit',
        action: editingAnnotation.type,
        checkpointPolicy: 'normal',
      });
      setEditingAnnotation(null);
    }}
    onEditCancel={() => setEditingAnnotation(null)}
    zoomGeneration={zoomGeneration}
    strokeColor={strokeColor}
  />
)}
```

### Pattern 2: Single Annotation Loading via enlivenObjects
**What:** Load ONE annotation from JSON into Canvas for interactive editing
**When to use:** Text/shape editing (bbox Canvas)
**Example:**
```jsx
// Inside FabricEditCanvas init effect:
const annotationJSON = annotationData;
fabric.util.enlivenObjects([annotationJSON], (enlivenedObjects) => {
  if (!mountedRef.current) return;
  const obj = enlivenedObjects[0];
  if (!obj) return;

  // Position relative to bbox origin
  obj.set({
    left: padding,  // offset by padding within bbox Canvas
    top: padding,
    selectable: true,
    evented: true,
  });

  // For text: enter editing mode immediately
  if (obj.type === 'textbox' || obj.type === 'i-text') {
    canvas.add(obj);
    canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.selectAll();
  } else {
    canvas.add(obj);
    canvas.setActiveObject(obj);
  }
  canvas.renderAll();
});
```

### Pattern 3: Edit State Management in App.jsx
**What:** New state `editingAnnotation` tracks which annotation is being edited, which page, and what type
**When to use:** When `onRequestEditMode` fires from SVG layer
**Example:**
```jsx
// In App.jsx:
const [editingAnnotation, setEditingAnnotation] = useState(null);
// { pageNumber, index, type, data }

// In SVGAnnotationLayer callback:
onRequestEditMode={(annotationIndex, annotationType) => {
  const annotationData = pageAnnotations?.objects?.[annotationIndex];
  if (!annotationData) return;
  setEditingAnnotation({
    pageNumber,
    index: annotationIndex,
    type: annotationType,  // 'textbox', 'i-text', 'rect', 'ellipse', etc.
    data: annotationData,
  });
}}
```

### Pattern 4: Zoom During Edit (CSS Transform + Remount)
**What:** On zoom, apply CSS transform to edit Canvas container for visual stability, then remount at new dimensions after 200ms settle
**When to use:** Any Canvas is mounted during zoom
**Example:**
```jsx
// FabricEditCanvas handles zoom via:
// 1. zoomGeneration prop change -> auto-commit current edit state
// 2. ResizeObserver on container detects size change -> resize Canvas
// 3. For text: re-enter editing mode + restore cursor position

useEffect(() => {
  if (zoomGeneration === initialZoomGenRef.current) return;
  // Auto-commit current state before zoom resize
  commitCurrentState();
  // Store cursor position for restoration
  if (editTypeRef.current === 'text') {
    cursorPositionRef.current = fabricRef.current?.getActiveObject()?.selectionStart;
  }
}, [zoomGeneration]);
```

### Anti-Patterns to Avoid
- **Mounting multiple Canvas components simultaneously for the same page:** Only ONE editing Canvas should exist per page at any time. Edit Canvas replaces drawing/eraser Canvas.
- **Using isDrawingMode for edit Canvas:** isDrawingMode is for pen/highlighter strokes. Edit Canvas uses `isDrawingMode: false` with selectable/evented objects.
- **Storing edit state in the Canvas component:** Edit state (which annotation, cursor position) belongs in App.jsx state so it survives Canvas remount during zoom.
- **Creating new Fabric objects instead of loading from JSON:** Always use `enlivenObjects` to recreate the exact annotation from its serialized form, preserving all custom properties.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canvas lifecycle | Custom create/dispose | `useFabricCanvas` hook | Already handles mount/unmount, onBeforeDispose cleanup |
| Container-aware sizing | `pageSize * scale` | `containerEl.offsetWidth / pageWidth` for effectiveScale | CLAUDE.md enforced rule; Electron zoom factor creates mismatch |
| Click-outside detection | Custom document click listener | Fabric.js `deselecting` / `selection:cleared` event + `text:editing:exited` | Fabric handles click-outside natively for IText |
| Annotation serialization | Manual JSON construction | `obj.toJSON(CUSTOM_PROPS)` | Preserves all custom properties, consistent with FabricDrawingCanvas pattern |
| Callout geometry | Custom line/knee calculations | `calculateCalloutConnection()` from `calloutGeometry.js` | Already handles all edge cases (inside box, stacking, min distances) |
| Path coordinate normalization | Manual left/top zeroing | `pathJSON.left = 0; pathJSON.top = 0;` pattern from FabricDrawingCanvas | SVG renderer expects left=0 with absolute path data |

**Key insight:** Phase 10 already solved all the hard Canvas lifecycle problems. Phase 11 is primarily about loading/configuring annotations for interactive editing rather than drawing -- the infrastructure (sizing, zoom, commit, dispose) is identical.

## Common Pitfalls

### Pitfall 1: IText exitEditing() Must Fire Before Canvas Dispose
**What goes wrong:** Canvas is disposed while IText is still in editing mode, causing Fabric.js internal state corruption
**Why it happens:** Unmounting the React component while user is mid-edit
**How to avoid:** `onBeforeDisposeRef` callback must call `textObj.exitEditing()` before `canvas.off()` / `canvas.dispose()`. This is the exact pattern from PAL lines 5131-5136.
**Warning signs:** Console errors about "Cannot read properties of null" from Fabric.js text editing code

### Pitfall 2: Text Annotation Coordinates Are Absolute, Not Relative to Canvas
**What goes wrong:** Text appears at wrong position when loaded into bbox Canvas
**Why it happens:** Fabric.js JSON stores `left` and `top` in absolute page coordinates. When loading into a bbox-sized Canvas, the object needs repositioning relative to the Canvas origin.
**How to avoid:** After enlivenObjects, compute the offset: `obj.set({ left: padding, top: padding })` where padding is the bbox expansion. On commit, reverse the offset: `json.left = originalBBoxLeft + (obj.left - padding)`.
**Warning signs:** Text annotation appears in top-left corner of Canvas instead of centered

### Pitfall 3: flushSync Warning in Development
**What goes wrong:** React dev mode warns "flushSync was called from inside a lifecycle method"
**Why it happens:** onBeforeDispose runs during useEffect cleanup (a lifecycle method) and calls flushSync to force SVG re-render
**How to avoid:** This is a known harmless warning (no-op in production). FabricDrawingCanvas already has this pattern at line 180-183 with a comment explaining it. Do not try to "fix" this warning.
**Warning signs:** Yellow console warning during tool switch or zoom -- expected behavior, not a bug

### Pitfall 4: Shape scaleX/scaleY vs Width/Height Confusion
**What goes wrong:** Shape appears wrong size after edit commit
**Why it happens:** Fabric.js uses scaleX/scaleY for resize (not width/height). Phase 9 Plan 02 decision: "Resize updates scaleX/scaleY (not width/height) to match Fabric.js Canvas mode serialization."
**How to avoid:** When committing shape edits, serialize with toJSON() which includes scaleX/scaleY naturally. Do NOT manually recalculate width/height.
**Warning signs:** Shape jumps to different size when editing completes

### Pitfall 5: Callout Uses Percentage Coordinates, Not Page Coordinates
**What goes wrong:** Callout renders at wrong position in edit Canvas
**Why it happens:** Callout data stores arrowTip, knee, textBoxPosition as normalized (0-1) percentages. The existing CalloutCanvas.jsx converts via `toPercent`/`toPixels`. The SVG renderer converts via `callout.arrowTip.x * pageWidth`.
**How to avoid:** When loading callout into Canvas, convert from normalized coords to page coords first, then let Canvas setZoom(effectiveScale) handle scaling. On commit, convert back to normalized.
**Warning signs:** Callout parts appear at fraction-of-a-pixel positions or way off-screen

### Pitfall 6: Dead Code Removal Breaks Canvas Mode Fallback
**What goes wrong:** Removing old zoom system breaks the Canvas renderer mode (Ctrl+Shift+V toggle)
**Why it happens:** The old zoom system is load-bearing for Canvas mode, even though it's inert in SVG mode
**How to avoid:** Two strategies: (a) remove Canvas mode toggle entirely (it's a pre-SVG fallback), or (b) keep Canvas mode but accept it doesn't have working zoom (same as Phase 8 decision "Canvas mode zoom not worth fixing")
**Warning signs:** Switching to Canvas mode via Ctrl+Shift+V causes crashes

### Pitfall 7: ResizeObserver During Edit Commits Partial State
**What goes wrong:** User is mid-text-edit, zoom triggers ResizeObserver, which resizes Canvas while text cursor is active
**Why it happens:** ResizeObserver is synchronous and fires before React state updates
**How to avoid:** The zoomGeneration effect should auto-commit the text edit first (via exitEditing), THEN let ResizeObserver handle resize. Store cursor position BEFORE exitEditing for restoration after remount.
**Warning signs:** Text cursor position lost after zoom, or text appears duplicated

## Code Examples

### Loading a Text Annotation for Editing
```jsx
// Source: Adapted from FabricEraserCanvas lines 267-321 + PAL lines 6422-6441 + 7115-7117
const loadTextForEditing = (canvas, annotationJSON, bboxPadding) => {
  fabric.util.enlivenObjects([annotationJSON], (objects) => {
    if (!mountedRef.current || objects.length === 0) return;
    const textObj = objects[0];

    // Reposition relative to bbox Canvas origin
    textObj.set({
      left: bboxPadding,
      top: bboxPadding,
      editable: true,
      selectable: true,
      evented: true,
    });

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    canvas.renderAll();

    // Enter editing mode
    textObj.enterEditing();
    textObj.selectAll();

    setIsLoading(false);
  });
};
```

### Committing Text Edit Back to SVG JSON
```jsx
// Source: Pattern from FabricDrawingCanvas path:created handler + PAL saveCanvas
const commitTextEdit = (canvas, originalAnnotation, annotationIndex, bboxOrigin, bboxPadding) => {
  const textObj = canvas.getActiveObject();
  if (!textObj) return null;

  // Exit editing mode cleanly
  if (textObj.isEditing) {
    textObj.exitEditing();
  }

  // Serialize with custom properties
  const json = textObj.toJSON(CUSTOM_PROPS);

  // Convert position back to absolute page coordinates
  json.left = bboxOrigin.left + (json.left - bboxPadding);
  json.top = bboxOrigin.top + (json.top - bboxPadding);

  // Build updated annotations array
  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
  updatedAnnotations.objects[annotationIndex] = json;

  return updatedAnnotations;
};
```

### FabricEditCanvas Container Sizing (bbox mode)
```jsx
// Source: Container-aware sizing from FabricDrawingCanvas lines 100-107 + CLAUDE.md rule
const bboxToContainerStyle = (annotationBBox, pageWidth, pageHeight, containerEl, padding = 20) => {
  // BBox in page coordinates
  const { left, top, width, height } = annotationBBox;

  // Effective scale from container measurement
  const containerWidth = containerEl.offsetWidth;
  const effectiveScale = containerWidth / pageWidth;

  // Canvas area in screen pixels
  return {
    position: 'absolute',
    left: (left - padding) * effectiveScale,
    top: (top - padding) * effectiveScale,
    width: (width + padding * 2) * effectiveScale,
    height: (height + padding * 2) * effectiveScale,
    pointerEvents: 'auto',
    zIndex: 101,
  };
};
```

### onRequestEditMode Handler in App.jsx
```jsx
// Source: Current stub at App.jsx:25044, expanded to manage editingAnnotation state
onRequestEditMode={(annotationIndex, annotationType) => {
  const annotationData = pageAnnotations?.objects?.[annotationIndex];
  if (!annotationData) return;

  // Map Fabric.js type to edit type
  const editType =
    (annotationType === 'textbox' || annotationType === 'i-text' || annotationType === 'text')
      ? 'text'
      : (annotationType === 'rect' || annotationType === 'circle' || annotationType === 'ellipse')
        ? 'shape'
        : null; // callout handled separately via callout system

  if (!editType) return;

  setEditingAnnotation({
    pageNumber,
    index: annotationIndex,
    type: editType,
    data: annotationData,
  });
}}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Permanent Fabric.js Canvas per page | SVG display + Canvas edit-only | Phase 8 (v2.0) | 44MB/page memory savings, zero zoom timers |
| 5-timer zoom coordination | SVG viewBox auto-scaling | Phase 8 (v2.0) | Zero annotation disappearance during zoom |
| Canvas mode as primary renderer | SVG mode as default | Phase 8 Plan 02 | Canvas mode available via Ctrl+Shift+V fallback |
| Full-page Canvas for all editing | Targeted bbox Canvas per annotation | Phase 10 (pen) + Phase 11 (text/shape) | Less memory, focused interaction area |

**Deprecated/outdated:**
- `beginSyncfusionScaleConfirmPending`: Already short-circuited in SVG mode (line 10165). Removal target.
- `handlePALScaleApplied`: Only called from PAL Canvas mode. Removal target.
- `onScaleApplied` prop: Dead prop on PageAnnotationLayer. Removal target.
- `presentationApiRegistry` prop: Dead prop. Removal target.
- `isHidden` prop: Dead prop. Removal target.
- Old PAL settle timer (300ms): Was at PAL:~5192. Only runs in Canvas mode.
- App zoom settle timer (1000ms): Only fires in Canvas mode after confirm-pending guard.
- Confirm-pending safety timer (3000ms): Only fires in Canvas mode.
- Tier-2 page defer (800ms): Only fires in Canvas mode.
- Overlay safety timer (5000ms): Only fires in Canvas mode.

## Open Questions

1. **Canvas mode toggle (Ctrl+Shift+V) fate**
   - What we know: Canvas mode was the pre-SVG fallback. After Phase 11, SVG mode handles everything.
   - What's unclear: Whether to keep as emergency escape hatch or remove entirely
   - Recommendation: Remove. Canvas mode zoom is intentionally broken (Phase 8 decision). After Phase 11, there's no scenario where Canvas mode is needed. Keeping dead code increases maintenance burden and confuses future developers. If removal feels too aggressive, keep the toggle but log a deprecation warning.

2. **Callout editing: FabricEditCanvas vs existing CalloutCanvas.jsx**
   - What we know: CalloutCanvas.jsx is a DOM-based callout editor (not Fabric.js). It uses percentage coordinates and handles mouse events directly. The CONTEXT.md says callout double-click mounts full-page Canvas with SVG hidden.
   - What's unclear: Whether to reuse CalloutCanvas.jsx as-is (it's already a working editor) or build a new Fabric.js-based callout editor in FabricEditCanvas
   - Recommendation: Reuse CalloutCanvas.jsx for callout editing. It already works, handles all drag/resize/text-edit interactions, and is well-tested. The CONTEXT.md's "full-page Canvas" language could mean either Fabric.js Canvas or the existing DOM-based callout Canvas. The DOM approach is simpler and already exists. FabricEditCanvas would handle text and shape; callout editing would delegate to the existing system. This avoids reimplementing 700+ lines of callout interaction code.

3. **CLAUDE.md zoom rules vs Phase 11 cleanup**
   - What we know: CLAUDE.md says "NEVER remove beginSyncfusionScaleConfirmPending, onScaleApplied..." These rules were written before SVG migration.
   - What's unclear: Whether CLAUDE.md should be updated as part of Phase 11
   - Recommendation: Update CLAUDE.md as the final task of zoom cleanup. The rules were protective during v1.0; after Phase 11 removes the old system entirely, these warnings are misleading and should be replaced with "zoom is handled by SVG viewBox."

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.x |
| Config file | `debug/playwright.config.mjs` |
| Quick run command | `npx playwright test debug/scenarios/ --project=chromium --headed` |
| Full suite command | `npx playwright test debug/scenarios/ --project=chromium` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDIT-06 | Text double-click opens edit Canvas with IText | manual + e2e | Manual: double-click text in SVG, verify Canvas mounts | -- Wave 0 |
| EDIT-07 | Click outside commits text edit to SVG | manual + e2e | Manual: edit text, click away, verify SVG updates | -- Wave 0 |
| EDIT-08 | Shape double-click opens edit Canvas | manual + e2e | Manual: double-click shape, verify Canvas mounts | -- Wave 0 |
| ZOOM-01 | SVG zoom has zero JS timers | grep verification | `grep -r 'confirmPending\|freeze\|settle\|onScaleApplied' src/App.jsx src/PageAnnotationLayer.jsx` | -- Wave 0 |
| ZOOM-02 | Canvas CSS transform during zoom | manual | Manual: zoom while editing, verify no jump | -- |
| ZOOM-03 | 200ms settle remount | manual | Manual: zoom, wait, verify Canvas re-sizes | -- |
| ZOOM-04 | Pen stroke auto-committed on zoom | existing | FabricDrawingCanvas zoomGeneration effect | Already works |
| ZOOM-05 | All 6 zoom methods work | e2e | `npx playwright test debug/scenarios/pal-zoom.spec.mjs` | Exists (may need update) |
| ZOOM-06 | Freeze/snapshot/confirm-pending removed | grep verification | Zero matches for old function names in src/ | -- Wave 0 |
| ZOOM-07 | Dead props removed from PAL | grep verification | Zero matches for onScaleApplied/presentationApiRegistry/isHidden in PAL | -- Wave 0 |
| ZOOM-08 | Old 5-timer system fully removed | grep verification + e2e | Combined grep + manual zoom test across all methods | -- Wave 0 |

### Sampling Rate
- **Per task commit:** Manual browser verification (double-click edit, zoom test)
- **Per wave merge:** Full Playwright suite + manual verification of all 6 zoom methods
- **Phase gate:** All grep verifications pass (zero old timer refs) + manual editing workflow test

### Wave 0 Gaps
- [ ] `debug/scenarios/text-edit.spec.mjs` -- covers EDIT-06, EDIT-07 (text double-click, edit, commit)
- [ ] `debug/scenarios/shape-edit.spec.mjs` -- covers EDIT-08 (shape double-click, edit, commit)
- [ ] Grep verification script for ZOOM-06/07/08 -- zero-match validation for removed code

*(Note: Wave 0 test creation may be deferred given the manual-heavy nature of these UI interactions. The existing pal-zoom.spec.mjs provides zoom method coverage.)*

## Sources

### Primary (HIGH confidence)
- **Project source code** -- FabricDrawingCanvas.jsx, FabricEraserCanvas.jsx, useFabricCanvas.js, SVGAnnotationLayer.jsx, useSVGInteraction.js, CalloutCanvas.jsx, calloutGeometry.js, svgAnnotationRenderers.jsx (all read directly)
- **App.jsx** -- handleSaveAnnotations (line 22678), beginSyncfusionScaleConfirmPending (line 10158), SVG rendering section (lines 25000-25090), zoomGeneration (line 11321)
- **PageAnnotationLayer.jsx** -- IText patterns (lines 5110-5122, 6391-6442, 7115-7188), text:editing:exited handler (line 5270)
- **CONTEXT.md** -- Phase 11 locked decisions and discretion areas
- **STATE.md** -- Accumulated decisions from Phases 8-10
- **PROJECT.md** -- Core constraints (Fabric.js 5.5.2, zero new deps, same JSON format)

### Secondary (MEDIUM confidence)
- **Fabric.js 5.5.2 IText/Textbox API** -- enterEditing(), exitEditing(), text:editing:exited event, selectionStart/selectionEnd, isEditing property. Verified via existing usage in PAL codebase.
- **fabric.util.enlivenObjects** -- Async deserialization of JSON objects into Fabric instances. Verified via FabricEraserCanvas.jsx line 268.

### Tertiary (LOW confidence)
- **Cursor position restoration after zoom remount** -- IText's `selectionStart` property should persist through serialize/deserialize cycle, but this needs runtime validation. The property is a simple integer index, likely reliable.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all patterns established in prior phases
- Architecture: HIGH -- FabricEditCanvas follows exact same pattern as FabricDrawingCanvas/FabricEraserCanvas
- Pitfalls: HIGH -- all identified from actual code patterns and prior phase lessons
- Zoom cleanup: HIGH -- SVG guard at line 10165 proves old system is inert; removal is safe deletion
- Callout editing approach: MEDIUM -- open question about Fabric.js Canvas vs existing DOM-based CalloutCanvas.jsx

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable -- Fabric.js 5.5.2 pinned, no external API changes)
