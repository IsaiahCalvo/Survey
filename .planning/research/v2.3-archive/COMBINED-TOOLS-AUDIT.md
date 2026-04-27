# Combined-Tools Audit — Line / Arrow / Text Callout

Audit target: `/Users/isaiahcalvo/Desktop/combined-tools` (Vite + React 18.3 + TypeScript + Fabric.js 6.9.1 + Tailwind + shadcn/ui).

This is ground truth for porting the UX into another codebase. All file:line references are absolute. Code is quoted verbatim where non-trivial.

---

## File Map

| File | LOC | Purpose |
|---|---|---|
| `/Users/isaiahcalvo/Desktop/combined-tools/src/App.tsx` | 16 | Router shell — mounts `<Index />` under `<TooltipProvider>` + `<BrowserRouter>`. Zero logic. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/pages/Index.tsx` | 147 | **State owner.** `useState` holds `callouts[]`, `lines[]`, `arrows[]`, three `selectedXId`, and `activeTool`. Keyboard shortcut `useEffect`. Passes everything to `<FabricPDFCanvas>`. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/components/FabricPDFCanvas.tsx` | 4263 | **The whole engine.** Owns the `fabric.Canvas` instance, every `useEffect` that syncs React state → Fabric objects, every Fabric event handler (`mouse:down/move/up`, `object:moving/scaling/modified`, `selection:created/updated/cleared`, `mouse:over/out`, `mouse:dblclick`, `text:changed`, `text:editing:entered/exited`). |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/components/Toolbar.tsx` | 117 | shadcn tooltip toolbar. Four tool buttons (Select/Callout/Line/Arrow) + delete. Purely presentational. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/lib/lineGeometry.ts` | 134 | Pure math for lines/arrows: `getMidpoint`, `distanceToLineSegment`, `projectPointToLine`, `shouldSnapToLinear` (threshold default 10), `getCurvedPath` (quadratic bezier), `getCurveEndAngle`, `getPointOnCurve`. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/lib/calloutGeometry.ts` | 700 | Pure math for callout connector routing: `calculateCalloutConnection`, knee constraint helpers, Liang–Barsky segment/box intersection, `findClosestBorderPoint`, `constrainKneePosition`. Exports three distance constants. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/types/callout.ts` | 86 | Type definitions + `defaultCalloutStyle`, `defaultLineStyle`. |
| `/Users/isaiahcalvo/Desktop/combined-tools/src/lib/utils.ts` | ~7 | shadcn `cn` helper. Irrelevant. |

**Total audited logic: ~5230 lines.** Non-trivial files are `FabricPDFCanvas.tsx` (4263), `calloutGeometry.ts` (700), `lineGeometry.ts` (134).

**Key entry point to read first:** `FabricPDFCanvas.tsx:1318` — the giant `useEffect` that wires every Fabric event. All interaction logic lives in closures inside it.

---

## Line Tool

### Data model

From `src/types/callout.ts:63-70`:

```ts
export interface Line {
  id: string;
  start: Point;
  end: Point;
  midpoint: Point;   // <-- ABSOLUTE coordinates, not a t-parameter
  style: LineStyle;
  isSelected: boolean;
}
```

`LineStyle` = `{ color, lineThickness, opacity }`. `Point` = `{ x, y }`.

**Curvature is stored as an absolute midpoint.** If `midpoint` lies within 10 px of the straight line between `start` and `end`, the line is rendered straight. Otherwise it is rendered as a quadratic bezier that **passes through** `midpoint`. See `lineGeometry.ts:87-98`:

```ts
export function getCurvedPath(start: Point, end: Point, midpoint: Point): string {
  // For a quadratic bezier curve to pass through the midpoint at t=0.5,
  // the control point C must satisfy: midpoint = 0.25*start + 0.5*C + 0.25*end
  // Solving for C: C = 2*midpoint - 0.5*start - 0.5*end
  const controlPoint: Point = {
    x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  };
  return `M ${start.x},${start.y} Q ${controlPoint.x},${controlPoint.y} ${end.x},${end.y}`;
}
```

This is **the single most important formula in the codebase**: the visible "middle handle" is not a bezier control point — it is a point the curve is *forced to pass through* at t=0.5, and the real control point is derived from it. A naive port using the middle handle directly as the Q control point will produce a curve that only gets halfway to the handle.

### Creation flow

Exactly one click-drag-release:

1. **MouseDown** (`FabricPDFCanvas.tsx:1585`): when `activeTool === 'line' || 'arrow'` and no target. Sets `isCreatingRef.current = true`, `creationStartRef.current = { x, y }`, `creationToolTypeRef.current = activeTool`. Creates a dashed preview `fabric.Line` (`strokeDashArray: [5, 5]`, `opacity: 0.6`, `originX/Y: 'center'`) and adds it to the canvas. See `:1600-1613`.
2. **MouseMove** (`FabricPDFCanvas.tsx:1651-1687`): updates `previewDragLineRef.current` `x1/y1/x2/y2` in real time. For the arrow tool, also updates the preview arrowhead `angle` and position.
3. **MouseUp** (`FabricPDFCanvas.tsx:1818-1888`):
   - Sets `isCreatingRef.current = false` **first** (stops MouseMove closure from racing).
   - Removes preview line + preview arrowhead.
   - Generates `uuidv4()`.
   - Builds the new Line / Arrow object. `start = creationStartRef.current`, `end = pointer`, `midpoint = getMidpoint(start, end)`.
   - Calls `setLines(prev => prev.map(l => ({...l, isSelected: false})).concat(newLine))` — deselects everything else, adds new item as selected.
   - `setSelectedLineId(id)`.
   - Clears creation refs.

**No minimum-length check** — a click without drag creates a zero-length line.

### Selection / edit flow

Selection is via **three refs on the line Fabric object**: `lineId`, or (on handles) `objectId` + `handleType` + `objectType`. Set at `:722`, `:863`, `:869-871`.

- Clicking the line body (`activeTool === 'select'`) — `handleMouseDown:1407-1457`. Reads `target.lineId`, captures `lineOriginalPosRef` snapshot of `{left, top, start, end, midpoint}` (for Path, uses `getBoundingRect()` not `.left`), calls `setSelectedLineId(lineId)`, clears other selections, `canvas.setActiveObject(target)`.
- Clicking an empty area deselects (`:1500-1506`).
- Selection triggers `useEffect` at `:1216-1243` which sets `visible: isSelected, evented: isSelected` on the three handles (start/end/midpoint).

**Handles only become `evented: true` when visible.** This is deliberate — off-screen handles don't block clicks through the canvas.

### Middle curvature handle

Created at `:871`, `:1154` (for arrows). Rendered by `createHandle()` at `:634-657`:

```ts
const handle = new Rect({
    left: x - 6, top: y - 6, width: 12, height: 12,
    fill: '#ffffff', stroke: '#3b82f6', strokeWidth: 2,
    rx: 2, ry: 2,
    originX: 'left', originY: 'top',
    selectable: true,
    evented: false,   // set to true only when visible/selected
    hasControls: false, hasBorders: false,
    visible: false,
});
(handle as any).objectId = objectId;
(handle as any).handleType = handleType;
(handle as any).objectType = objectType;
```

All three handles (start/end/midpoint) are 12×12 white rects with 2 px blue stroke and 2 px corner radius. Identical visual to callout handles.

**Drag math for the midpoint handle** (`FabricPDFCanvas.tsx:3030-3050`, inside `handleObjectMoving` for line handles):

```ts
} else if (handleType === 'midpoint') {
    const SNAP_THRESHOLD = 10;
    const isLinear = shouldSnapToLinear(handleCenter, line.start, line.end, SNAP_THRESHOLD);

    if (isLinear) {
        // Snap to exact midpoint (straight line)
        newMidpoint = getMidpoint(line.start, line.end);
        // Update handle position to snapped location
        target.set({
            left: newMidpoint.x - 6,
            top: newMidpoint.y - 6,
        });
        target.setCoords();
    } else {
        // Curve Mode: The curve MUST pass through the handle.
        // We use the handle's center exactly.
        newMidpoint = handleCenter;
    }
}
```

`handleCenter` is `(target.left + 6, target.top + 6)` (the 12×12 rect's geometric center). This is the value stored in `line.midpoint` and passed straight into `getCurvedPath()`. The quadratic control point is computed every render from this — see the curve formula above.

### Start/end handle drag during curve mode

Very clever edge case at `:2998-3029`:

```ts
if (handleType === 'start') {
    newStart = handleCenter;
    const SNAP_THRESHOLD = 10;
    const isLinear = shouldSnapToLinear(line.midpoint, line.start, line.end, SNAP_THRESHOLD);

    if (isLinear) {
        // Linear Mode: Recalculate midpoint to remain centered
        newMidpoint = getMidpoint(newStart, newEnd);
    } else {
        // Arc Mode: Keep midpoint fixed at absolute coordinates
        newMidpoint = line.midpoint;
        // Auto-Reversion: Check if new path overlaps with fixed midpoint
        if (shouldSnapToLinear(newMidpoint, newStart, newEnd, SNAP_THRESHOLD)) {
            newMidpoint = getMidpoint(newStart, newEnd);
        }
    }
}
```

Rule: while dragging a start/end handle, **if the line was curved, the midpoint stays at its absolute coordinate** — it does not translate with the endpoint. This means dragging one endpoint of a curved line reshapes the curve; it does not rigid-move it. EXCEPT if the new start+end+old-midpoint alignment happens to become straight, in which case it auto-reverts to a recomputed geometric midpoint. Call this **auto-reversion**.

### Snap-to-angle

**Does not exist.** No multiples of 15°, 45°, or 90°. No `shiftKey` handling anywhere in the codebase (verified via grep: zero results for `shiftKey`, `nudge`, `ArrowLeft`).

The only "snap" is `shouldSnapToLinear` — snapping a curved midpoint back to a straight line when the midpoint falls within the 10 px perpendicular tolerance of the endpoints-line.

### Snap-curve-to-straight reset

Implemented in `lineGeometry.ts:69-77`:

```ts
export function shouldSnapToLinear(
  midpoint: Point, start: Point, end: Point,
  threshold: number = 10
): boolean {
  const distance = distanceToLineSegment(midpoint, start, end);
  return distance <= threshold;
}
```

**Applied in two places with different thresholds:**

- **During handle drag:** `SNAP_THRESHOLD = 10` px (`FabricPDFCanvas.tsx:3000`, `3016`, `3033`, `3215`, `3231`, `3248`). While the user is dragging the midpoint handle and comes within 10 px of the straight line, the midpoint snaps to exact center and the handle visually jumps to the snapped position.
- **During render:** `threshold = 1` px (`FabricPDFCanvas.tsx:673`, `901`, `3078`, `3292`). This is the hysteresis: once snapped, the line stays straight unless the midpoint moves >1 px off center.

There is **no double-click reset, no button reset** — straightening is purely proximity-based.

The shape switches Fabric object type at the same time: straight = `fabric.Line`, curved = `fabric.Path`. Type-mismatch branches (lines 760-785 etc.) handle converting between them by `canvas.remove(existing)` + `canvas.add(new)`, preserving the z-index via `insertAt(currentIndex, ...)` when possible.

### Hover / cursor / keyboard

**Hover:** Cursor changes are driven by Fabric's `hoverCursor` option (set on individual objects). Line body has `hoverCursor: 'move'` when `activeTool === 'select'`. No visual color change on hover for lines — only handles show on selection.

**Cursor states** (`FabricPDFCanvas.tsx:1246-1260`):

```ts
if (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout') {
    canvas.selection = false;
    canvas.defaultCursor = 'crosshair';
    canvas.hoverCursor = 'crosshair';
} else {
    canvas.selection = true;
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'move';
}
```

`hoverCursor: 'move'` on line1/line2 at `:260`, `:276`.

**Keyboard shortcuts** (`Index.tsx:52-107`):

- `V` → select tool
- `Q` → callout tool
- `L` → line tool
- `A` → arrow tool
- `Delete` / `Backspace` → delete selected (any of callout/line/arrow)
- `Escape` → deselect all + switch to select tool
- **No arrow-key nudging. No modifier-key snap. No copy/paste.**

Shortcuts are suppressed when `isUserTyping()` returns true (focused input/textarea/contentEditable — see `:31-49`).

---

## Arrow Tool

### Data model

From `src/types/callout.ts:72-79`:

```ts
export interface Arrow {
  id: string;
  start: Point;
  end: Point;
  midpoint: Point;
  style: LineStyle;
  isSelected: boolean;
}
```

**Identical shape to `Line`.** The only functional difference is that the arrow renders a `fabric.Triangle` arrowhead at `end`. Same `defaultLineStyle`, same `getCurvedPath` math, same `shouldSnapToLinear` snap-to-straight behavior, same handle logic, same drag behavior.

### Creation flow

Same code path as Line (`FabricPDFCanvas.tsx:1585-1637`). The only difference is the MouseDown branch at `:1620-1637`, which additionally creates a preview arrowhead `Triangle`:

```ts
if (activeTool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const arrowHead = new Triangle({
        left: end.x, top: end.y,
        originX: 'center', originY: 'center',
        width: 10, height: 7,
        fill: style.color,
        angle: angle + 90,
        selectable: false, evented: false,
        opacity: 0.6,
    });
    previewArrowHeadRef.current = arrowHead;
    canvas.add(arrowHead);
}
```

Note the `angle: angle + 90` — Fabric's `Triangle` points up by default, so the computed direction angle needs +90° to rotate the tip into the line direction.

### Selection / edit flow

Same as Line but uses `arrowId`, `arrowHandleObjectsRef`, `draggingArrowHandleRef`, `draggingArrowIdRef`. Stored at `:947`, `:975`, `:1000`, `:1124`. Selection code path at `:1459-1497`.

### Middle curvature handle

Same code as Line. See lines `:3245-3266` for the arrow-specific midpoint handler — byte-for-byte identical logic:

```ts
} else if (handleType === 'midpoint') {
    const SNAP_THRESHOLD = 10;
    const isLinear = shouldSnapToLinear(handleCenter, arrow.start, arrow.end, SNAP_THRESHOLD);
    if (isLinear) {
        newMidpoint = getMidpoint(arrow.start, arrow.end);
        target.set({ left: newMidpoint.x - 6, top: newMidpoint.y - 6 });
        target.setCoords();
    } else {
        newMidpoint = handleCenter;
    }
}
```

### Snap-to-angle

**Does not exist** (same as Line).

### Snap-curve-to-straight reset

Same as Line.

### Arrowhead rendering and style options

**Style options: zero.** There is exactly one arrowhead style: a Fabric.js `Triangle` with `width: 10, height: 7` at the `end` point. See `FabricPDFCanvas.tsx:1133-1147`:

```ts
const arrowHead = new Triangle({
    left: arrow.end.x, top: arrow.end.y,
    originX: 'center', originY: 'center',
    width: 10, height: 7,
    fill: arrow.style.color,
    angle: angle + 90,
    selectable: false, evented: false,
    opacity: arrow.style.opacity,
    visible: true,
    objectCaching: false,
});
```

Callout arrowhead at `:286-298` uses `width: 14, height: 18` — the **only** other arrowhead variant, and only because callouts use a visually larger tip. There is no:
- Filled vs open
- Triangle vs diamond
- None / no-head option
- Barbed / swept / hollow

The arrowhead is a **separate canvas object**, stored in `arrowHeadObjectsRef` (a `Map<string, Triangle>`). It is NOT grouped with the line — if you move the line body you also have to manually reposition the arrowhead. See `:3423-3439`:

```ts
const arrowHead = arrowHeadObjectsRef.current.get(objectId);
if (arrowHead) {
    const isLinear = shouldSnapToLinear(newMidpoint, newStart, newEnd, 1);
    const angle = isLinear
        ? Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * (180 / Math.PI)
        : getCurveEndAngle(newStart, newEnd, newMidpoint);
    arrowHead.set({
        left: newEnd.x, top: newEnd.y,
        angle: angle + 90,
        objectCaching: false,
    });
    arrowHead.setCoords();
}
```

**Key angle math:** for curved arrows, the arrowhead angle is the **tangent at t=1** of the bezier, computed in `lineGeometry.ts:105-115`:

```ts
export function getCurveEndAngle(start: Point, end: Point, midpoint: Point): number {
  const controlPoint: Point = {
    x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  };
  // The tangent at t=1 for a quadratic bezier is the direction from control to end
  const angle = Math.atan2(end.y - controlPoint.y, end.x - controlPoint.x);
  return angle * (180 / Math.PI);
}
```

The derivative of a quadratic bezier at `t=1` simplifies to `2 * (P2 - P1)`, which is parallel to `end - controlPoint`. So the tangent direction is exactly `atan2(end.y - control.y, end.x - control.x)`.

### Hover / cursor / keyboard

Same as Line.

---

## Text Callout Tool

### Data model

From `src/types/callout.ts:5-28`:

```ts
export interface CalloutStyle {
  borderColor: string;
  lineThickness: number;
  fillColor: string;
  opacity: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
}

export interface Callout {
  id: string;
  arrowTip: Point;         // <-- the sharp end of the arrow (user-drawn)
  knee: Point;             // <-- the bend point between textbox and arrow
  textBoxPosition: Point;  // <-- top-left of the textbox content area
  textBoxWidth: number;    // <-- content width, EXCLUDING border
  textBoxHeight: number;   // <-- content height, EXCLUDING border
  text: string;
  style: CalloutStyle;
  isSelected: boolean;
}
```

Default style (`types/callout.ts:44-54`): `borderColor: '#1e293b'` (slate-800), `lineThickness: 2`, `fillColor: 'transparent'`, `fontFamily: 'Inter'`, `fontSize: 14`.

Note: `textBoxWidth/Height` are **content** dimensions; the geometry routines add `borderWidth` internally (see `calloutGeometry.ts:239-242`). The visible box is `textBoxPosition.x` to `textBoxPosition.x + borderWidth + textBoxWidth + borderWidth`.

### Creation flow

`FabricPDFCanvas.tsx:1511-1582` (MouseDown) → `:1689-1758` (MouseMove) → `:1891-1944` (MouseUp):

1. **MouseDown with callout tool, no target, not editing:**
   - Sets `isCreatingRef = true`, `creationStartRef = pointer` (this will be the **arrowTip**).
   - Creates four preview objects: dashed `Rect` textbox (120×40, stroke dash `[5,5]`), two dashed `Line`s (line1 + line2), a preview `Triangle` arrowhead. All at 0.6 opacity.
2. **MouseMove:** the textbox follows the mouse pointer. `knee` is computed as:

   ```ts
   const knee: Point = {
     x: (currentCreationStart.x + pointer.x) / 2,
     y: currentCreationStart.y - 40,
   };
   ```

   ...i.e. **horizontal midpoint of mouse+arrowtip, 40 px above the arrow tip**. Then `calculateCalloutConnection` is called every frame to compute `line1Start`, `line2Start`, `effectiveKnee`, `shouldHideLine1`.
3. **MouseUp:** removes all four preview objects, generates uuid, creates:

   ```ts
   const newCallout: Callout = {
       id,
       arrowTip: currentCreationStart,
       knee,                                           // the 40-px-up formula above
       textBoxPosition: { x: pointer.x, y: pointer.y },
       textBoxWidth: 120,
       textBoxHeight: 40,
       text: '',
       style: { ...defaultCalloutStyle },
       isSelected: true,
   };
   setCallouts(prev => [...prev, newCallout]);
   setSelectedCalloutId(id);
   newCalloutIdRef.current = id;  // triggers auto-edit
   ```

   `newCalloutIdRef.current` is watched by a separate `useEffect` at `:1263-1315` that auto-enters text editing on the new callout after a 50 ms `setTimeout`, registers validation listeners, and **removes the callout on `editing:exited` if the text is still empty** (empty-text self-destruct).

### Selection / edit flow

Selection is delegated to Fabric's `selection:created` / `selection:updated` events. `handleSelection` at `:2407-2494`:

- Unwraps ActiveSelection groups (multi-select) by finding the `textBoxBg` of the first callout in the group and replacing the active object with just the `textBoxBg`.
- Reads `calloutPart.calloutId` from the active object.
- Sets `selectedCalloutId` state.
- For most part types (text, textBoxBg), forces the `textBoxBg` to be the active object (via `setTimeout(0)`) so that resize handles always appear. Line1, line2, arrowHead were **explicitly excluded** from this force so that they can be dragged directly without fabric stealing the drag. See `:2478-2491`.
- For arrowTip and knee parts, leaves the handle as-is so it can be dragged.

**Two-click edit (delayed from double-click):** `handleMouseDown:1371-1400`. If the target is `text` or `textBoxBg` of an already-selected callout, sets `pendingEditRef.current = calloutId` and starts a 300 ms `doubleClickTimeoutRef`. On MouseUp, if `pendingEditRef` is still set (no drag cancelled it), a 50 ms `setTimeout` checks `pendingEditRef` one more time — if a double-click event has already fired in the meantime it will have cleared the ref; otherwise enter-edit fires. This is a manual debounce racing against Fabric's native `mouse:dblclick`.

**Double-click edit** (`handleMouseDblClick:4177-4213`): clears `doubleClickTimeoutRef`, clears `pendingEditRef`, selects the callout, `textObj.enterEditing(); textObj.selectAll();`.

### Composite structure

The callout is **NOT a Fabric.js Group** — it is **seven separate Fabric objects** stored together in `calloutObjectsRef.current` (a `Map<string, FabricObject[]>`). Each object carries `calloutId` and `partType`. See `createCalloutObjects` at `:238-416`:

```ts
return [line1, line2, arrowHead, textBoxBg, textObj, arrowTipHandle, kneeHandle];
```

1. **`line1`** — `fabric.Line` from `line1Start` (on textbox border) to `effectiveKnee`. `stroke = borderColor`, `hoverCursor: 'move'`, `perPixelTargetFind: true`, `targetFindTolerance: 15`. `hasControls: false`, `hasBorders: false`. Selectable and evented.
2. **`line2`** — `fabric.Line` from `line2Start` (the knee) to `arrowTip`. Same settings as line1.
3. **`arrowHead`** — `fabric.Triangle`, `width: 14`, `height: 18`, centered at `arrowTip` with `originX/Y: 'center'`. Angle = `atan2(arrowTip.y - effectiveKnee.y, arrowTip.x - effectiveKnee.x) * 180/π + 90`. `selectable: false, evented: true`.
4. **`textBoxBg`** — `fabric.Rect`, has corner-only controls (`ml/mr/mt/mb/mtr` hidden via `setControlsVisibility`). `strokeUniform: true`, `objectCaching: false`, `uniformScaling: false`, `lockRotation: true`. `cornerColor: '#ffffff'`, `cornerStrokeColor: '#3b82f6'`, `cornerSize: 12`, `transparentCorners: false`. `rx: 2, ry: 2`. Fill is `rgba(255,255,255,0.01)` when transparent (to keep it hit-testable).
5. **`textObj`** — `fabric.Textbox`, positioned at `textBoxPosition.x + 8, textBoxPosition.y + 4` (8/4 px padding), `width: textBoxWidth - 16`, `splitByGrapheme: true`, `editable: true`, `hasControls: false, hasBorders: false`.
6. **`arrowTipHandle`** — `fabric.Rect`, 12×12, white fill, blue stroke (1 px), rx/ry 2, centered on `arrowTip` (so `left = arrowTip.x - 6`). `opacity` toggles 0↔1 for show/hide; the object stays `visible: true` for hit testing.
7. **`kneeHandle`** — identical rect, centered on `effectiveKnee`.

**Important:** the seven objects are NOT grouped. When the user Ctrl/Cmd-drags the callout, the code in `handleObjectMoving` manually applies a delta to every other part (`:2573-2603`):

```ts
if (isWholeMove) {
    const currentX = target.left ?? 0;
    const currentY = target.top ?? 0;
    if (!lastDragPosRef.current) {
        lastDragPosRef.current = { x: currentX, y: currentY };
        return;
    }
    const dx = currentX - lastDragPosRef.current.x;
    const dy = currentY - lastDragPosRef.current.y;
    if (textBoxBg && target.partType !== 'textBoxBg') textBoxBg.set({ left: (textBoxBg.left ?? 0) + dx, top: (textBoxBg.top ?? 0) + dy });
    if (textObj && target.partType !== 'text')       textObj.set({ left: (textObj.left ?? 0) + dx, top: (textObj.top ?? 0) + dy });
    if (arrowTipHandle && target.partType !== 'arrowTip') arrowTipHandle.set({ left: (arrowTipHandle.left ?? 0) + dx, top: (arrowTipHandle.top ?? 0) + dy });
    if (kneeHandle && target.partType !== 'knee')    kneeHandle.set({ left: (kneeHandle.left ?? 0) + dx, top: (kneeHandle.top ?? 0) + dy });
    if (arrowHead && target.partType !== 'arrowHead') arrowHead.set({ left: (arrowHead.left ?? 0) + dx, top: (arrowHead.top ?? 0) + dy });
    if (line1 && target.partType !== 'line1') {
        line1.set({ x1: (line1.x1 ?? 0) + dx, y1: (line1.y1 ?? 0) + dy, x2: (line1.x2 ?? 0) + dx, y2: (line1.y2 ?? 0) + dy });
    }
    if (line2 && target.partType !== 'line2') {
        line2.set({ x1: (line2.x1 ?? 0) + dx, y1: (line2.y1 ?? 0) + dy, x2: (line2.x2 ?? 0) + dx, y2: (line2.y2 ?? 0) + dy });
    }
    lastDragPosRef.current = { x: currentX, y: currentY };
}
```

`isWholeMove` is true if **(a) Ctrl/Cmd is held** OR **(b) the user is dragging `line1` or `line2` directly** (`:2569-2571`). Dragging a line body moves the whole callout — there is no way to drag a line segment independently.

### Handle distance / collision prevention

**During drag** (`handleObjectMoving`, enforced per-part as hard geometric constraints):

`MIN_HANDLE_DISTANCE = 30` (`FabricPDFCanvas.tsx:19`) is the core distance threshold. It applies between any two "handle-like" objects.

**Rule 1: Arrow tip must stay ≥30 px from knee.** Enforced at `:2729-2749` (arrowTip drag) and `:2757-2794` (arrowHead drag — identical math):

```ts
if (target.partType === 'arrowTip') {
    let tipX = (target.left ?? 0) + 6;
    let tipY = (target.top ?? 0) + 6;
    if (kneeHandle) {
        const kneeX = (kneeHandle.left ?? 0) + 6;
        const kneeY = (kneeHandle.top ?? 0) + 6;
        const dist = Math.sqrt(Math.pow(tipX - kneeX, 2) + Math.pow(tipY - kneeY, 2));
        if (dist < MIN_HANDLE_DISTANCE) {
            const angle = Math.atan2(tipY - kneeY, tipX - kneeX);
            tipX = kneeX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
            tipY = kneeY + Math.sin(angle) * MIN_HANDLE_DISTANCE;
            target.left = tipX - 6;
            target.top = tipY - 6;
        }
    }
    line2.set({ x2: tipX, y2: tipY });
    updateLine1StartFromBox();
}
```

**Rule 2: Knee must stay ≥30 px from arrow tip.** (`:2796-2821`). Mirror of Rule 1.

**Rule 3: Knee must stay ≥30 px from closest point on textbox.** (`:2823-2869`):

```ts
const clampedX = Math.max(boxLeft, Math.min(kneeX, boxLeft + width));
const clampedY = Math.max(boxTop, Math.min(kneeY, boxTop + height));
const dist = Math.sqrt(Math.pow(kneeX - clampedX, 2) + Math.pow(kneeY - clampedY, 2));

if (dist < MIN_HANDLE_DISTANCE) {
    let angle = Math.atan2(kneeY - clampedY, kneeX - clampedX);

    // Edge case: if literally inside center (dist=0) or extremely close (overlap), pop out to nearest edge
    if (dist < 0.1) {
        const dLeft = Math.abs(kneeX - boxLeft);
        const dRight = Math.abs(kneeX - (boxLeft + width));
        const dTop = Math.abs(kneeY - boxTop);
        const dBottom = Math.abs(kneeY - (boxTop + height));
        const minD = Math.min(dLeft, dRight, dTop, dBottom);

        if (minD === dLeft)      { kneeX = boxLeft - MIN_HANDLE_DISTANCE; kneeY = clampedY; }
        else if (minD === dRight){ kneeX = boxLeft + width + MIN_HANDLE_DISTANCE; kneeY = clampedY; }
        else if (minD === dTop)  { kneeX = clampedX; kneeY = boxTop - MIN_HANDLE_DISTANCE; }
        else                     { kneeX = clampedX; kneeY = boxTop + height + MIN_HANDLE_DISTANCE; }
    } else {
        kneeX = clampedX + Math.cos(angle) * MIN_HANDLE_DISTANCE;
        kneeY = clampedY + Math.sin(angle) * MIN_HANDLE_DISTANCE;
    }
}
```

**Rule 4: Moving the textbox must not push it into the knee.** (`:2660-2706`). If dragging `textBoxBg` or `text` would bring the box within 30 px of the knee, the textbox is "popped out" in the direction away from the knee:

```ts
if (dist < MIN_HANDLE_DISTANCE) {
    if (dist < 0.1) {
        // Pop-out to nearest edge
        const dLeft = Math.abs(kneeX - newBoxLeft);
        const dRight = Math.abs(kneeX - (newBoxLeft + width));
        const dTop = Math.abs(kneeY - newBoxTop);
        const dBottom = Math.abs(kneeY - (newBoxTop + height));
        const minD = Math.min(dLeft, dRight, dTop, dBottom);
        if (minD === dLeft) newBoxLeft += (MIN_HANDLE_DISTANCE + 1);
        else if (minD === dRight) newBoxLeft -= (MIN_HANDLE_DISTANCE + 1);
        else if (minD === dTop) newBoxTop += (MIN_HANDLE_DISTANCE + 1);
        else newBoxTop -= (MIN_HANDLE_DISTANCE + 1);
    } else {
        const pushDist = MIN_HANDLE_DISTANCE - dist + 1;
        const angle = Math.atan2(clampedY - kneeY, clampedX - kneeX);
        newBoxLeft += Math.cos(angle) * pushDist;
        newBoxTop += Math.sin(angle) * pushDist;
    }
}
```

**Secondary safety constants** in `calloutGeometry.ts:16-21`:

```ts
export const MIN_KNEE_TO_ARROW_DISTANCE = 15;   // used inside calculateCalloutConnection
export const MIN_KNEE_TO_BOX_EDGE_DISTANCE = 10;
export const MIN_SEGMENT_LENGTH = 10;
export const MIN_TEXTBOX_TO_ARROW_DISTANCE = MIN_KNEE_TO_BOX_EDGE_DISTANCE + MIN_KNEE_TO_ARROW_DISTANCE; // = 25
```

**Two different distance systems:** `MIN_HANDLE_DISTANCE = 30` is enforced by `handleObjectMoving` as a hard UI constraint; the `MIN_*` constants from `calloutGeometry.ts` are used inside `calculateCalloutConnection` as a softer constraint when routing `effectiveKnee` between the box and the arrow.

**On-drop rollback** (`handleMouseUp:1980-2379`): if after the drag the configuration violates the collision checks `isColliding()` (arrow-tip inside textbox + buffer) OR `isKneeTouchingArrow()` (knee within 24 px of arrow handle), the **entire callout snaps back to the positions saved in `lastSafeObjectPosRef` at drag-start** (captured in `handleObjectMoving` at `:2552-2562` on first move). All four positions (textBoxBg, text, arrowTipHandle, kneeHandle) are restored together. Line intersections (`c4`) and knee-inside-box (`c3`) are **logged but ignored** — the live constraint math already prevents them, so they do not trigger rollback.

### Resize math

Corner handles only — edge handles are hidden via `setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, mtr: false })` at `:329-336`.

During resize (`handleObjectScaling:3549-3661`):

- `strokeUniform: true` is re-asserted every frame and `strokeWidth` is locked to `callout.style.lineThickness` so the stroke never visually scales.
- Text object position is updated live: `textObj.set({ left: boxLeft + 8, top: boxTop + 4, width: Math.max(width - 16, 20), scaleX: 1, scaleY: 1 })`. Text does NOT scale with the box.
- `calculateCalloutConnection` is called every frame with the current scaled dims to re-route line1/line2 and update the knee handle position.

On scaling finish (`handleObjectModified:4047-4089`), the scale is baked into width/height and reset to 1:

```ts
const widthBefore = textBoxBg.width ?? 0;
const heightBefore = textBoxBg.height ?? 0;
const finalWidth = widthBefore * Math.abs(scaleXBefore);
const finalHeight = heightBefore * Math.abs(scaleYBefore);
textBoxBg.set({
    width: finalWidth, height: finalHeight,
    scaleX: 1, scaleY: 1,
    flipX: false, flipY: false,
});
```

Then the callout state is synced from the Fabric objects (`:4092-4120`):

```ts
setCallouts(prev => prev.map(c => {
    if (c.id !== calloutId) return c;
    return {
        ...c,
        arrowTip: arrowTipHandle ? { x: arrowTipHandle.left + 6, y: arrowTipHandle.top + 6 } : c.arrowTip,
        knee:     kneeHandle    ? { x: kneeHandle.left + 6, y: kneeHandle.top + 6 }       : c.knee,
        textBoxPosition: textBoxBg ? { x: textBoxBg.left, y: textBoxBg.top } : c.textBoxPosition,
        textBoxWidth: wasScaled ? textBoxBg.width ?? c.textBoxWidth : c.textBoxWidth,
        textBoxHeight: wasScaled ? textBoxBg.height ?? c.textBoxHeight : c.textBoxHeight,
    };
}));
```

`wasScaled` guards so that a pure move doesn't accidentally overwrite width/height.

**Uniform scaling is disabled** (`uniformScaling: false` at `:162`, `:321`, `:487`) — the user can resize width and height independently from each corner. Flipping is NOT locked, so the user can drag past the opposite edge to mirror the box, and the scale-baking code uses `Math.abs(scaleXBefore)` and resets `flipX: false, flipY: false`.

### Tail shape variants

**Do not exist.** There is one tail style only: line1 (straight segment from textbox border to knee) + line2 (straight segment from knee to arrowTip) + Triangle arrowhead. No rounded, no leader line, no pointer, no curved, no multi-segment. The "knee" is the only bend.

### Knee handles

There is exactly one knee per callout (see the type definition — `knee: Point`). Dragging the knee handle bends the connector. Math at `:2796-2879` (already shown above).

Note the clever auto-routing: when you drag the knee handle **away from** its anchor, the connector becomes a classic two-segment elbow line. When you drag the knee **toward** the textbox, it gets clamped to stay 30 px outside. When you drag it toward the arrow tip, it gets clamped to stay 30 px away. The knee cannot cross into the "forbidden zone" near either anchor.

The **effective** knee position is whatever `calculateCalloutConnection` returns — it may be different from the user-set `knee` if the constraint math has to clamp it. The `kneeHandle` position is updated to the `effectiveKnee` so the handle visually matches the bend point. `knee` in state is what the user dragged; `effectiveKnee` is what gets rendered.

### Connector routing (`calculateCalloutConnection`)

Signature at `calloutGeometry.ts:224-232`:

```ts
export const calculateCalloutConnection = (
    boxLeft: number, boxTop: number,
    boxW: number, boxH: number,
    knee: Point,
    arrowTip?: Point,
    borderWidth: number = 0
): ConnectionResult => { ... }
```

Returns `{ line1Start, shouldHideLine1, line2Start, effectiveKnee }`.

**Algorithm in order:**

1. Adjust box coordinates by `borderWidth` (`:239-242`) so the connector attaches to the **center** of the border stroke, not the content edge.
2. Initial guess: `line1Start = clampToBox(knee)` — the projection of knee onto the nearest box edge.
3. **"Knee overlap" check** (`:266-369`): if knee is inside the box, on the border (within 2 px), or stacked with arrowTip, find `closestBorderPoint` relative to the **arrow** (not the knee!) and place the knee at the halfway point between the border and the arrow — but clamped so segment1 ≥ `MIN_SEGMENT_LENGTH` (10) and segment2 ≥ `MIN_KNEE_TO_ARROW_DISTANCE` (15). Uses `constrainKneePosition` helper (`:138-220`) which projects the knee onto the border-to-arrow line and clamps.
4. **Line-2-intersects-box check** (`:371-599`): uses **Liang-Barsky clipping** to detect if the knee→arrow segment crosses the textbox. If it does (i.e. the arrow is on the wrong side of the textbox from where the knee is routing), recompute the knee halfway between the closest border point to the arrow and the arrow itself, with the same clamping.
5. **Final safety net** (`:617-697`): if after all the above the `effectiveKnee` is still inside the textbox or within `MIN_KNEE_TO_BOX_EDGE_DISTANCE` of an edge, find the closest border point to the arrow and push the knee out along that direction. If there's no room for both minimums, set `shouldHideLine1 = true` so line1 visually disappears (only line2 + arrowhead shown, the tail looks like a pure arrow from the border).

This is the subtle routing magic that makes the callout "just work" as you drag the textbox around on top of the arrow — the knee auto-reroutes. It's ~500 lines of case analysis and the case-splits matter.

The Liang-Barsky clipping (`:376-396`) is standard:

```ts
const p = [-dx, dx, -dy, dy];
const q = [p1.x - adjustedBoxLeft, boxRight - p1.x, p1.y - adjustedBoxTop, boxBottom - p1.y];
let intersects = true;
for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
        if (q[i] < 0) { intersects = false; break; }
    } else {
        const r = q[i] / p[i];
        if (p[i] < 0) {
            if (r > t1) { intersects = false; break; }
            if (r > t0) t0 = r;
        } else {
            if (r < t0) { intersects = false; break; }
            if (r < t1) t1 = r;
        }
    }
}
```

### Hover / cursor / keyboard

**Hover** (`handleMouseOver:4143-4156`, `handleMouseOut:4158-4175`): hovering `arrowTip`, `knee`, or `textBoxBg` parts sets `hoveredHandleCalloutId` state, which triggers `:510-521` to show the `arrowTip` and `knee` handles (opacity 0→1) even when not selected. This is a "preview the handles on hover" affordance. `mouseOut` clears it with a **50 ms timeout** to prevent flickering when the mouse moves between handles.

**Cursor:** `hoverCursor: 'move'` on line1/line2 (`:260`, `:276`). Standard Fabric cursors on textbox corner controls. `defaultCursor: 'crosshair'` while callout tool is active.

**Keyboard:** same as Line/Arrow. `Delete`/`Backspace` deletes, `Escape` deselects. In-text editing is handled by Fabric's `Textbox.enterEditing()`. While editing, `isEditingTextRef.current = true` and shortcut handling is suppressed via `isUserTyping()`.

---

## Shared State & Events

### State management

**All state is React `useState` in `Index.tsx:6-13`.** No Zustand, no Context, no Redux. State is prop-drilled into `FabricPDFCanvas`:

```ts
const [callouts, setCallouts] = useState<Callout[]>([]);
const [lines, setLines] = useState<Line[]>([]);
const [arrows, setArrows] = useState<Arrow[]>([]);
const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null);
const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
const [activeTool, setActiveTool] = useState<ToolType>('select');
```

Inside `FabricPDFCanvas`, there are **dozens of refs** (`useRef`) that mirror state and track drag/create/hover/interaction flags — see `:68-140`. Examples:

- `fabricCanvasRef` — the Fabric Canvas instance
- `calloutObjectsRef: Map<string, FabricObject[]>` — per-callout parts
- `lineObjectsRef`, `arrowObjectsRef`, `arrowHeadObjectsRef` — per-line/arrow Fabric objects
- `lineHandleObjectsRef`, `arrowHandleObjectsRef` — per-line/arrow handle rects
- `linesRef`, `arrowsRef` — **shadow refs** of React state, synced via `useEffect`, used inside Fabric event handlers to avoid stale-closure bugs
- `creationStartRef`, `creationToolTypeRef`, `isCreatingRef` — drag-to-create state
- `draggingLineBodyRef`, `draggingArrowIdRef`, `draggingLineHandleRef`, `draggingArrowHandleRef` — which thing is mid-drag (used to skip the state-sync `useEffect`)
- `lineOriginalPosRef: Map<string, { left, top, start, end, midpoint }>` — drag-start snapshot for delta-based line updates
- `lastSafeObjectPosRef: Map<string, { left, top }>` — pre-drag positions for callout collision rollback
- `isEditingTextRef` — true while `text:editing:entered` fired and not yet `exited`
- `isMouseUpRef` — workaround flag for the race where Fabric queues `mouse:move` events that fire after `mouse:up`
- `isProcessingArrowModifiedRef`, `isProcessingLineModifiedRef` — re-entry guards for `object:modified` handlers (because `canvas.discardActiveObject()` inside the handler can re-fire the event)
- `pendingEditRef`, `doubleClickTimeoutRef`, `wasSelectedRef`, `hoverTimeoutRef` — UX debounce/timeout tracking
- `lastDragPosRef` — for whole-callout Ctrl+drag delta calculation
- `newCalloutIdRef` — handshake between "create" and "auto-enter-edit" effect

### Fabric events wired

All wired inside the mega `useEffect` at `FabricPDFCanvas.tsx:1318-4254`. Registration block `:4215-4229`:

```ts
canvas.on('mouse:down', handleMouseDown);
canvas.on('mouse:move', handleMouseMove);
canvas.on('mouse:up', handleMouseUp);
canvas.on('mouse:dblclick', handleMouseDblClick);
canvas.on('mouse:over', handleMouseOver);
canvas.on('mouse:out', handleMouseOut);
canvas.on('selection:created', handleSelection);
canvas.on('selection:updated', handleSelection);
canvas.on('selection:cleared', handleSelectionCleared);
canvas.on('object:moving', handleObjectMoving);
canvas.on('object:scaling', handleObjectScaling);
canvas.on('object:modified', handleObjectModified);
canvas.on('text:changed', handleTextChanged);
canvas.on('text:editing:entered', handleTextEditingEntered);
canvas.on('text:editing:exited', handleTextEditingExited);
```

Matching cleanup in the `return () => { ... }` block `:4231-4253`.

Event responsibilities:

- **`mouse:down`** — branch on `activeTool`: create preview (line/arrow/callout), handle callout-part clicks (two-click edit detection), handle line/arrow selection, deselect on empty canvas.
- **`mouse:move`** — ONLY handles creation preview updates. Drag-movement of existing objects is handled by Fabric's native `object:moving`.
- **`mouse:up`** — finalize creation (commit new object to React state), handle two-click edit trigger (via `setTimeout(50)`), run collision check + rollback for callout parts, UX fix "switch back to textBoxBg selection after dragging line1/line2/arrowHead".
- **`mouse:dblclick`** — enter text edit mode on callout text/textBoxBg.
- **`mouse:over` / `mouse:out`** — show/hide callout handles on hover with 50 ms debounce.
- **`selection:created` / `selection:updated`** — sync Fabric's active object to `selectedCalloutId` state; force `textBoxBg` as the active object when any callout part is selected (except line1/line2/arrowHead which stay selected for dragging); unwrap multi-selection ActiveSelection into single callout selection.
- **`selection:cleared`** — clear `selectedCalloutId` IF in select tool AND not currently transforming AND not editing text AND click target is empty.
- **`object:moving`** — the giant handler. Branches: (1) callout part with `partType` → enforce distance constraints, update other parts; (2) line/arrow handle with `objectId` → rebuild path, update all handles live, update `setLines`/`setArrows`; (3) line/arrow body being dragged → compute delta, translate start/end/midpoint, update handles, update arrowhead.
- **`object:scaling`** — callout textbox resize: re-route connector every frame, keep text un-scaled, re-assert `strokeUniform` and `strokeWidth`.
- **`object:modified`** — the commit. For lines/arrows: compute final delta from `lineOriginalPosRef`, update `setLines`/`setArrows`, refresh handle positions, update arrowhead. For callouts: bake scale into width/height if scaled, sync all positions from Fabric objects to `setCallouts`. Uses `isProcessingXModifiedRef` flags to guard re-entry.
- **`text:changed`** — write `target.text` into the callout state.
- **`text:editing:entered` / `text:editing:exited`** — flip `isEditingTextRef.current`.

### Keyboard shortcut map

Global listener in `Index.tsx:52-107`, bound to `window`:

| Key | Action |
|---|---|
| `V` / `v` | Select tool |
| `Q` / `q` | Text Callout tool |
| `L` / `l` | Line tool |
| `A` / `a` | Arrow tool |
| `Delete` / `Backspace` | Delete selected callout/line/arrow |
| `Escape` | Deselect all + switch to Select tool |

Suppressed when `isUserTyping()` is true — meaning focused `<input>` (text/email/password/search/tel/url/number), `<textarea>`, or contentEditable element. The Fabric.js `Textbox.isEditing` state is NOT checked directly, but when it's editing the underlying Fabric hidden textarea has focus so `document.activeElement.tagName === 'textarea'` and the check passes.

**Missing shortcuts:** no arrow-key nudge, no Ctrl+Z undo, no Ctrl+C/V copy/paste, no Shift-modifier, no Tab-cycle selection. The tool is pure point-and-click.

---

## Surprising Mechanisms

### 1. Midpoint = curve *waypoint*, not bezier control point

The single most important thing to port correctly. The user-visible middle handle is a point the curve is *forced to pass through at t=0.5*, NOT the bezier Q control point. The control point is derived algebraically:

> `C = 2 * midpoint - 0.5 * start - 0.5 * end`

(`lineGeometry.ts:91-94`). A naive port that uses the middle handle as the Q control point will produce a curve that only reaches halfway to where the user dragged.

### 2. Snap-to-straight uses two different thresholds

- During user drag (in `handleObjectMoving`): **10 px** — the user gets "pulled" onto straight as they drag the midpoint near the line.
- During render (in sync `useEffect`): **1 px** — once the state has a straight line, any change of >1 px re-enters curve mode.

This hysteresis avoids the jitter that would happen if both checks used the same threshold. `FabricPDFCanvas.tsx:3000` (drag) vs `:673` (render).

### 3. Straight line and curved line are **different Fabric object types**

Straight = `fabric.Line`, curved = `fabric.Path`. The code handles conversion in both directions by `canvas.remove(existing) + canvas.add(new)` with `canvas.insertAt(currentIndex, ...)` to preserve z-index. See `:760-785`, `:3094-3168`. This happens **mid-drag** when the user crosses the snap threshold. A port that uses a single Path object for both cases is simpler, but the current code does type-switching for performance reasons (Fabric.js real-time updates are faster on `Line` than on `Path`, per the code comments at `:99-102` and `:825`).

### 4. Callout is NOT a Group — it's 7 separate objects manually synced

The callout uses **seven independent Fabric objects** (`line1`, `line2`, `arrowHead`, `textBoxBg`, `text`, `arrowTipHandle`, `kneeHandle`) each tagged with `calloutId` + `partType`. The connection is maintained manually via delta math in `handleObjectMoving` when Ctrl+drag or line-drag triggers `isWholeMove`. Using a Fabric Group would have broken independent dragging of knee/arrowTip/corner handles.

### 5. Dragging line1 or line2 moves the WHOLE callout

Not just the line segment. This is because:

```ts
const isWholeMove = (Ctrl/Cmd held) || target.partType === 'line1' || target.partType === 'line2';
```

(`:2569-2571`). The tail cannot be re-articulated without the knee handle — dragging a line always grabs the whole callout. This is an intentional UX choice but it means there's no way to "fine-tune" just the tail shape.

### 6. Re-entry guards for `object:modified`

`isProcessingArrowModifiedRef` / `isProcessingLineModifiedRef` exist because `canvas.discardActiveObject()` inside the `object:modified` handler can **re-fire the same event**, causing infinite recursion. Flags are set at the top and cleared at every exit path. Port this carefully — it's not obvious until it explodes.

### 7. `isMouseUpRef` with 100 ms cooldown to drop queued mouse-move events

```ts
isMouseUpRef.current = true;
// ...later:
setTimeout(() => { isMouseUpRef.current = false; }, 100);
```

(`:1763`, `:1809-1811`). Fabric queues `mouse:move` events that arrive after `mouse:up` has fired — the handler ignores them via this flag. 100 ms is empirical.

### 8. Two-click edit vs double-click edit — a debounce race

Two separate code paths try to enter text editing: the "two-click" flow (`pendingEditRef` + 50 ms delay on mouse-up) and the "double-click" flow (Fabric's native `mouse:dblclick`). They race deliberately: whichever fires first wins, and each clears the other's flag. `:1371-1400` + `:1949-1968` + `:4177-4213`. Get the timeouts wrong and you'll get double-fires or missed edits.

### 9. `knee` vs `effectiveKnee` — stored vs rendered

The callout state stores `knee` (what the user dragged) but the renderer uses `effectiveKnee` from `calculateCalloutConnection` — the result of clamping `knee` to be outside the textbox + outside the arrow's minimum-distance zone + re-routed via the intersection checks. **Only the knee handle's visual position is updated to `effectiveKnee`**; the React state keeps the user's last-dragged `knee` value. This means if you later move the textbox such that the original `knee` becomes valid again, the callout snaps back to that "preferred" position. Subtle but important — losing this behavior breaks the "callout remembers its shape" feel.

### 10. Liang-Barsky for segment-vs-box intersection

`calloutGeometry.ts:376-396` uses textbook Liang-Barsky clipping (not Cohen-Sutherland, not ray-cast) to detect if the knee→arrow segment crosses the textbox. Parametric clipping on `t0 ∈ [0,1], t1 ∈ [0,1]`. Fast and numerically stable. Anyone porting should copy this verbatim rather than re-implementing.

### 11. Border-width adjustment inside geometry routing

`calloutGeometry.ts:239-242` adjusts `boxLeft/boxTop/boxRight/boxBottom` by `borderWidth` so the connector attaches to the **center of the border stroke**, not the content rectangle. The callout's `textBoxWidth/Height` are **content** dimensions, so without this adjustment the line would appear to undershoot the visible edge by half the stroke width. Invisible unless you have a thick border.

### 12. Auto-delete empty callouts

When a newly-created callout is auto-focused for editing, a listener is registered on `editing:exited`: if `textObj.text` is still empty on exit, the callout is deleted from state (`FabricPDFCanvas.tsx:1285-1289`). This means clicking-and-pressing-escape cancels callout creation. Users don't know this; it just "feels right."

### 13. `hoveredHandleCalloutId` shows handles on hover even when not selected

`FabricPDFCanvas.tsx:111`, `:510-521`, `:4143-4175`. Hovering the `textBoxBg` or either handle of an unselected callout reveals the arrowTip + knee handles at opacity 1. This creates a "handles peek" affordance that makes editing feel responsive. The 50 ms `hoverTimeoutRef` debounce prevents flicker between handles.

### 14. Type-mismatch recreation during handle drag

When dragging a line's midpoint handle across the snap threshold mid-drag, the object switches from `fabric.Path` to `fabric.Line` (or vice versa) by removing and re-adding the object. This happens in `handleObjectMoving` at `:3084-3168`. The `z-index preservation` via `canvas.insertAt(currentIndex, newLine)` avoids "line jumps to top of stack mid-drag".

### 15. `originX/Y: 'center'` on the arrowhead but NOT on the handles

Callout arrowhead uses `originX/Y: 'center'` so `left/top` = the tip position directly. Callout handles (arrowTipHandle, kneeHandle) use default `originX/Y: 'left'/'top'`, so their `left/top` is the top-left and the center is `+6`. This inconsistency requires `+6` math in every handle-related calculation. The knee handle drag code `(target.left ?? 0) + 6` appears ~20 times — a candidate for a helper, but it's inlined everywhere.

### 16. Disable `objectCaching` on everything that moves

`objectCaching: false` is set on every moving Fabric object (lines, arrows, arrowheads, text box bg). Without this, Fabric caches rendered object contents and `strokeUniform` can produce visual artifacts or disappearance during rapid updates. See `:323`, `:700`, `:719`, `:747`, `:839`, `:858`, `:925`, `:1102`, `:1146`, `:1154`, `:3154`, `:3371`, `:3436`. Easy to miss on a port; causes mystery bugs.

### 17. `targetFindTolerance: 15` + `perPixelTargetFind: true` on lines

`:260-263`, `:276-279`. Lines are hard to click without hit tolerance. 15 px tolerance + per-pixel target find = the click area is a 15-px-wide "hot zone" around the line. Without these, users cannot reliably click thin lines.
