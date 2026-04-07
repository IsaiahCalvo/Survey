# Text Tool → SVG-Native Textbox Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-app text tool create Fabric.js `textbox` annotations (like imported text) instead of `textOnly` callouts, so text boxes render through SVGAnnotationLayer and get SVGSelectionOverlay with rotation handles.

**Architecture:** When text tool is active, a transparent overlay div captures clicks/drags. On click-to-place (or drag-to-create), it sets `editingAnnotation` with `isNewText: true`, which mounts FabricEditCanvas. FabricEditCanvas already handles new text creation (Textbox object, type-then-commit). On commit, the textbox annotation is pushed into the annotations array and rendered by SVGAnnotationLayer's existing `renderText()`. Selection, resize, rotation, and double-click-to-edit all come for free from the existing SVG interaction system.

**Tech Stack:** React, Fabric.js 5.5.2, SVG foreignObject

**Key files (read before starting):**
- `src/App.jsx` — main wiring, render loop with per-page overlays
- `src/components/FabricEditCanvas.jsx` — already has `isNewText` + `clickPosition` prop handling
- `src/components/Callout/CalloutCanvas.jsx` — currently handles text tool (will be cleaned up)
- `src/components/Callout/index.jsx` — CalloutOverlay, passes `isTextToolActive`
- `src/components/SVGAnnotationLayer.jsx` — renders text via `renderText()` (no changes needed)
- `src/components/SVGSelectionOverlay.jsx` — renders rotation handle (no changes needed)

---

## Chunk 1: Core Wiring

### Task 1: Add text tool click overlay to App.jsx

The text tool needs a transparent div overlay to capture clicks when no FabricEditCanvas is mounted. This follows the same pattern as FabricDrawingCanvas — a conditional overlay rendered per page.

**Files:**
- Modify: `src/App.jsx`

**Context:** There are 3 render locations in App.jsx where per-page overlays are rendered (around lines 24657, 24885, 25236). Each has FabricDrawingCanvas, FabricEditCanvas, and CalloutOverlay. The text tool overlay must be added in all locations where FabricEditCanvas is rendered.

- [ ] **Step 1: Read the 3 render locations in App.jsx**

Read lines around 24570-24720, 24880-25020, and 25230-25390 in `src/App.jsx` to understand all 3 per-page render blocks. Identify exactly where FabricEditCanvas and FabricDrawingCanvas are conditionally rendered in each block.

- [ ] **Step 2: Add text tool overlay div in the first render location**

Find the first FabricEditCanvas render block (around line 24691). Add the text tool overlay div immediately before it:

```jsx
{/* Text tool click-to-place overlay */}
{activeTool === 'text' && !(editingAnnotation?.pageNumber === pageNumber) && (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      cursor: 'text',
      zIndex: 102,
      pointerEvents: 'auto',
    }}
    onPointerDown={(e) => {
      // Cooldown: prevent re-creating text within 300ms of dismissal
      if (Date.now() - editModeCooldownRef.current < 300) return;
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const effectiveScale = rect.width / resolvedPageSize.width;
      const x = (e.clientX - rect.left) / effectiveScale;
      const y = (e.clientY - rect.top) / effectiveScale;
      setEditingAnnotation({
        pageNumber,
        index: null,
        type: 'textbox',
        editType: 'text',
        data: null,
        isNewText: true,
        clickPosition: { x, y },
      });
    }}
  />
)}
```

**Why `onPointerDown` instead of `onClick`:** We want the FabricEditCanvas to mount immediately on mousedown so the user can start typing right away, without waiting for the click event.

- [ ] **Step 3: Replicate the text tool overlay in the other render locations**

Add the same text tool overlay div in the 2nd and 3rd render blocks (around lines 24885 and 25236), using the same pattern but with the correct local variables for each block (pageNumber, resolvedPageSize, etc.).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build` (or let Vite HMR pick it up)
Expected: No compilation errors.

---

### Task 2: Pass `isNewText` and `clickPosition` to FabricEditCanvas

FabricEditCanvas already accepts `isNewText` and `clickPosition` props (see lines 299-300 in FabricEditCanvas.jsx) but App.jsx doesn't currently pass them.

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add isNewText and clickPosition props to all FabricEditCanvas render instances**

Find each `<FabricEditCanvas` render in App.jsx (3 locations). Add these two props:

```jsx
<FabricEditCanvas
  key={`edit-${pageNumber}-${editingAnnotation?.index ?? 'new'}`}
  pageNumber={pageNumber}
  pageWidth={resolvedPageSize.width}
  pageHeight={resolvedPageSize.height}
  editType={editingAnnotation.editType}
  annotationData={editingAnnotation.data}
  annotationIndex={editingAnnotation.index}
  annotations={pageAnnotations}
  isNewText={editingAnnotation.isNewText || false}        // ADD THIS
  clickPosition={editingAnnotation.clickPosition || null}  // ADD THIS
  onEditCommit={...}
  onEditCancel={...}
  strokeColor={strokeColor}
  zoomGeneration={zoomGeneration}
  viewerScale={scale}
/>
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: No compilation errors.

- [ ] **Step 3: Manual test — click-to-place text creation**

1. Open dev server (http://localhost:5173/)
2. Open a PDF, navigate to a page
3. Select the text tool from the toolbar
4. Click on an empty area of the page
5. Expected: FabricEditCanvas mounts with a blinking cursor. Type some text.
6. Click outside the text box
7. Expected: Text appears as an SVG foreignObject annotation (rendered by SVGAnnotationLayer)
8. Click the text annotation with the select tool
9. Expected: SVGSelectionOverlay appears with 8 white pill handles + rotation handle
10. Double-click the text annotation
11. Expected: FabricEditCanvas mounts for editing (existing flow)

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wire text tool to FabricEditCanvas for SVG-native textbox creation

Text tool now creates Fabric.js textbox annotations via FabricEditCanvas
instead of textOnly callouts. Text annotations render through
SVGAnnotationLayer and get SVGSelectionOverlay with rotation handles."
```

---

### Task 3: Remove text tool handling from CalloutCanvas

Now that text tool is handled by the new overlay + FabricEditCanvas path, remove the text tool code from CalloutCanvas and CalloutOverlay.

**Files:**
- Modify: `src/components/Callout/CalloutCanvas.jsx`
- Modify: `src/components/Callout/index.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Read CalloutCanvas.jsx fully**

Read `src/components/Callout/CalloutCanvas.jsx` to understand all places where `isTextToolActive` is used. Key areas:
- Props destructuring (line ~25)
- Pointer events logic (line ~693)
- Mouse handler creation flow (line ~431 — the `textOnly` flag)
- Cursor styling (line ~709)

- [ ] **Step 2: Remove isTextToolActive from CalloutCanvas**

In `src/components/Callout/CalloutCanvas.jsx`:

1. Remove `isTextToolActive` from the props destructuring
2. Remove `isTextToolActive` from the `pointerEventsValue` check (line ~693). Change:
   ```js
   const pointerEventsValue = isCalloutToolActive || isTextToolActive || ...
   ```
   to:
   ```js
   const pointerEventsValue = isCalloutToolActive || ...
   ```
3. Remove the `isTextToolActive ? 'text' :` from the cursor styling (line ~709). Change:
   ```js
   cursor: isCalloutToolActive ? 'crosshair' : isTextToolActive ? 'text' : 'default',
   ```
   to:
   ```js
   cursor: isCalloutToolActive ? 'crosshair' : 'default',
   ```
4. In the `handleMouseUp` creation flow (line ~431), remove the `isTextToolActive ? { textOnly: true } : {}` ternary. Change:
   ```js
   isTextToolActive ? { textOnly: true } : {}
   ```
   to:
   ```js
   {}
   ```

- [ ] **Step 3: Remove isTextToolActive from CalloutOverlay (index.jsx)**

In `src/components/Callout/index.jsx`:
1. Remove `isTextToolActive` from the props destructuring
2. Remove `isTextToolActive` from the `<CalloutCanvas>` render

- [ ] **Step 4: Remove isTextToolActive prop from all CalloutOverlay renders in App.jsx**

Find all `<CalloutOverlay` renders in `src/App.jsx` (3 locations, lines ~24723, ~25025, ~25378). Remove the `isTextToolActive={activeTool === 'text'}` prop from each.

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: No compilation errors, no unused variable warnings for isTextToolActive.

- [ ] **Step 6: Manual test — verify callout tool still works**

1. Select the callout tool
2. Click to place arrow tip, drag to position text box
3. Expected: Callout created with line, knee handle, arrow tip handle (same as before)
4. Select the text tool
5. Click on empty area
6. Expected: Text box created via FabricEditCanvas (not callout)
7. Verify no `textOnly` callouts are created anymore

- [ ] **Step 7: Commit**

```bash
git add src/components/Callout/CalloutCanvas.jsx src/components/Callout/index.jsx src/App.jsx
git commit -m "refactor: remove text tool handling from CalloutCanvas

Text tool no longer creates textOnly callouts. CalloutCanvas now only
handles callout tool. Cleans up isTextToolActive prop from CalloutCanvas,
CalloutOverlay, and all App.jsx render locations."
```

---

## Chunk 2: Drag-to-Create Enhancement

### Task 4: Add drag-to-create for text tool

When the user drags instead of clicking, the text box should be created at the drag size. This requires tracking pointer movement and passing dimensions to FabricEditCanvas.

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/FabricEditCanvas.jsx`

- [ ] **Step 1: Read FabricEditCanvas loadTextAnnotation (lines 660-700)**

Understand how the default textbox width is set. Currently it uses `width: 160 * es` (160px scaled). We need to accept an optional custom width from drag-to-create.

- [ ] **Step 2: Add `textBoxWidth` prop to FabricEditCanvas**

In `src/components/FabricEditCanvas.jsx`, add `textBoxWidth` to the props destructuring (around line 290). Then in `loadTextAnnotation` (around line 680), use it if provided:

```js
// In loadTextAnnotation, replace the fixed width:
const initialWidth = textBoxWidth
  ? textBoxWidth * es   // textBoxWidth is in page-space, convert to pixel-space
  : 160 * es;           // default 160px
  
const textObj = new fabric.Textbox('', {
  ...
  width: initialWidth,
  ...
});
```

- [ ] **Step 3: Convert text tool overlay from simple click to drag-aware**

In `src/App.jsx`, replace the simple `onPointerDown` handler on the text tool overlay with drag tracking. Add state or refs near `editingAnnotation` state:

```js
const textToolDragRef = useRef(null); // { startX, startY, pageNumber, rect, effectiveScale }
```

Replace the overlay's event handlers in all 3 render locations:

```jsx
{activeTool === 'text' && !(editingAnnotation?.pageNumber === pageNumber) && (
  <div
    style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      cursor: 'text',
      zIndex: 102,
      pointerEvents: 'auto',
    }}
    onPointerDown={(e) => {
      if (Date.now() - editModeCooldownRef.current < 300) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const effectiveScale = rect.width / resolvedPageSize.width;
      textToolDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        rect,
        effectiveScale,
        pageNumber,
      };
    }}
    onPointerUp={(e) => {
      const drag = textToolDragRef.current;
      if (!drag || drag.pageNumber !== pageNumber) return;
      textToolDragRef.current = null;

      const { rect, effectiveScale, startX, startY } = drag;
      const endX = e.clientX;
      const endY = e.clientY;
      const dx = Math.abs(endX - startX);
      const dy = Math.abs(endY - startY);

      // Convert to page-space
      const x = (Math.min(startX, endX) - rect.left) / effectiveScale;
      const y = (Math.min(startY, endY) - rect.top) / effectiveScale;

      // If drag was significant (>10px), use drag dimensions
      const isDrag = dx > 10 || dy > 10;
      const textBoxWidth = isDrag ? dx / effectiveScale : undefined;

      setEditingAnnotation({
        pageNumber,
        index: null,
        type: 'textbox',
        editType: 'text',
        data: null,
        isNewText: true,
        clickPosition: { x, y },
        textBoxWidth,
      });
    }}
  />
)}
```

- [ ] **Step 4: Pass textBoxWidth to FabricEditCanvas in all render locations**

Add `textBoxWidth={editingAnnotation.textBoxWidth}` to all 3 `<FabricEditCanvas>` renders.

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 6: Manual test — drag-to-create**

1. Select text tool
2. Click on empty area (no drag) → text box with default width appears, can type
3. Click and drag horizontally → text box at the dragged width appears
4. Type text → wraps at the custom width
5. Commit both, verify they render correctly in SVG
6. Select each with select tool → both have rotation handles

- [ ] **Step 7: Manual test — rotation works**

1. Create a text box via click-to-place
2. Type some text, click away to commit
3. Select the text annotation
4. Grab the rotation handle (circle above bbox)
5. Drag to rotate
6. Release → text renders at rotated angle in SVG
7. Double-click to edit → FabricEditCanvas mounts, can edit text
8. Commit → rotation preserved

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/FabricEditCanvas.jsx
git commit -m "feat: add drag-to-create for text tool

Users can now drag to define text box width. Click without drag uses
default 160px width. Drag dimensions passed to FabricEditCanvas via
textBoxWidth prop."
```

---

## Summary

| Task | What | Files | Complexity |
|------|------|-------|------------|
| 1 | Text tool click overlay in App.jsx | App.jsx | Low |
| 2 | Pass isNewText + clickPosition to FabricEditCanvas | App.jsx | Low |
| 3 | Remove text tool from CalloutCanvas | CalloutCanvas.jsx, index.jsx, App.jsx | Low |
| 4 | Drag-to-create enhancement | App.jsx, FabricEditCanvas.jsx | Medium |

**What we get for free (no code needed):**
- SVG rendering via `renderText()` in SVGAnnotationLayer
- Selection overlay with 8 handles + rotation via SVGSelectionOverlay
- Drag-to-move and resize via useSVGInteraction
- Double-click-to-edit via existing FabricEditCanvas text path
- Rotation persistence via Fabric.js `angle` property
- Text wrapping via Fabric.js `Textbox` type
