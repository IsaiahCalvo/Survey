# Current-Repo Audit — Line / Arrow / Text Callout

Audit date: 2026-04-11
Branch: post-v2.0/cleanup
Audited by: general-purpose subagent (read-only)

## File Map

Primary audit surface (all `src/` relative):

- `components/SVGAnnotationLayer.jsx` (1360 LOC) — SVG render layer + selection overlays + line/arrow endpoint handles + counter rotation handle. Owns the type dispatch at ~line 650.
- `components/SVGSelectionOverlay.jsx` (215 LOC) — Reusable 8-handle + rotation overlay for rect/circle/ellipse/text (NOT line/arrow, NOT callout). Padding-aware.
- `components/FabricEditCanvas.jsx` (2587 LOC) — Unified edit canvas. `editType ∈ {'text','shape','callout'}`. Shape edit is content-only (fill/stroke) — `hasControls:false, hasBorders:false`.
- `components/FabricDrawingCanvas.jsx` (~500 LOC) — **Line and arrow creation lives here** (mousedown/move/up handlers, not in SVG layer). Commits a `fabric.Line` with `tool: 'line'` or `tool: 'arrow'` JSON tag.
- `components/Callout/CalloutCanvas.jsx` (801 LOC) — Callout creation / drag / corner resize math. Owns creation state machine + dragTarget dispatch.
- `components/Callout/CalloutComponent.jsx` (1446 LOC) — Per-callout render: SVG connector path, arrowhead shapes, 4 textbox-corner handles + knee handle + arrowTip handle.
- `components/Callout/index.jsx` (127 LOC) — CalloutOverlay orchestrator (keyboard del/escape).
- `components/Callout/types.js` (225 LOC) — Data model: `Callout`, `CalloutStyle`, `ARROWHEAD_STYLES` enum (6 values), `createCallout` factory.
- `hooks/useSVGInteraction.js` (898 LOC) — Drag state machine. Modes: `move | group-move | endpoint | resize | rotate`. Line endpoint branch at ~line 302 and ~line 676.
- `utils/svgAnnotationRenderers.jsx` (592 LOC) — `renderLine` (~line 135), `renderArrow` (group form, ~line 203), `renderCallout` (~line 395), `renderText` (~line 308).
- `utils/lineGeometry.js` (192 LOC) — **Fully ported combined-tools bezier math** (getCurvedPath, getControlPoint, getCurveEndAngle, shouldSnapToLinear, getPointOnCurve). Only consumed by the legacy `PageAnnotationLayer.jsx` for old-style callout rendering. **Not wired into SVG layer, useSVGInteraction, or CalloutCanvas.**
- `utils/calloutGeometry.js` (592 LOC) — `calculateCalloutConnection` used by `renderCallout` (unused — see below).
- `utils/svgBoundingBox.js` — `getLineEndpoints` (~line 175) extracts absolute line endpoints from Fabric center-based JSON.
- `utils/svgTransformMath.js` — `snapAngleToNearest45(angle, threshold=3)` (~line 121), used ONLY for rotation handle shift-snap. Never used for line/arrow angle snap.
- `App.jsx` (~1.3MB, PROTECTED) — activeTool state; keyboard shortcuts L/A/Q at lines 22480-22503.
- `components/PageAnnotationLayer.jsx` (PROTECTED, ~9858 LOC) — Legacy Fabric.js full-canvas layer. Contains a working Fabric.js callout system + curved-line rendering. Imports lineGeometry.js (lines 53-60).

## Line Tool (current state)

### SVG render path

`svgAnnotationRenderers.jsx:renderLine` at **line 135**. Dispatched from `SVGAnnotationLayer.jsx:661` when `objectType === 'line'`. Key fields read from JSON:

- `obj.left`, `obj.top` — bounding box top-left (not endpoint)
- `obj.width`, `obj.height` — bbox size
- `obj.x1`, `obj.y1`, `obj.x2`, `obj.y2` — offsets from **bbox center**, NOT absolute coords (Fabric.js Line toJSON quirk)
- `obj.stroke`, `obj.strokeWidth`, `obj.opacity`
- `obj.tool === 'arrow'` — tag that turns the same `type: 'line'` into an arrow (branch at line 151)

Geometry formula used by both renderer and `getLineEndpoints`:
```
centerX = left + width/2
x1_abs = centerX + x1
```

Output: a plain `<line x1 y1 x2 y2 stroke strokeWidth strokeLinecap="round">`. No curvature. No non-scaling stroke tag on the plain-line branch — only the arrow branch gets a `vectorEffect` implicitly via the strokeWidth math.

### Edit flow

Double-click dispatches via `useSVGInteraction.handleAnnotationDoubleClick` (useSVGInteraction.js:255) → `onRequestEditMode(index, type)` → `FabricEditCanvas` mounts with `editType: 'shape'`. But `loadShapeAnnotation` (FabricEditCanvas.jsx:1571) explicitly sets `hasControls: false, hasBorders: false, opacity: 0` and comment "Phase 13 EDIT-14: no transform handles in edit mode for ANY shape." So line edit is effectively **fill/stroke-only** — no geometry editing, no endpoint drag, no curve editing.

### Creation flow

**Lives in FabricDrawingCanvas**, NOT in the SVG layer. See `FabricDrawingCanvas.jsx:287-292`:
```js
} else if (tool === 'line' || tool === 'arrow') {
  state.shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
    stroke: color, strokeWidth: sw, strokeUniform: true,
  });
}
```
- Mousedown: creates zero-length Line at pointer
- Mousemove (line 322): `state.shape.set({ x2: pointer.x, y2: pointer.y })` — drags endpoint 2 only
- Mouseup (line 340): commits if `sqrt(dx² + dy²) > 3`, tags `shapeJSON.tool = tool` (line 250)

`activeTool` state lives in `App.jsx`, keyboard shortcut **'L'** at line 22489.

### Data model

Fabric.js Line JSON (tagged):
```js
{
  type: 'line',
  tool: 'line',          // custom tag to differentiate from arrow
  left, top,             // bbox top-left
  width, height,         // bbox w/h
  x1, y1, x2, y2,        // CENTER-RELATIVE offsets
  stroke, strokeWidth,
  strokeUniform: true,
  opacity, angle
}
```

No curvature field. No midpoint. No arrowhead style field (line has none).

### Selection handles

Rendered INSIDE `SVGAnnotationLayer.jsx:1221-1264` (special-cased, NOT via `SVGSelectionOverlay`). When `obj.type === 'line'`, the overlay draws **only two endpoint circles** (p1, p2) — no dashed bbox, no 8 resize handles, no rotation handle. Handle radius is `7 * sqrt(inverseScale)` (dampened).

Drag for the endpoint handles is wired at `SVGAnnotationLayer.jsx:1249` and `:1260`, both calling `handleHandlePointerDown(e, 'p1'|'p2')`.

### Interaction / where middle handle plugs in

`useSVGInteraction.handleHandlePointerDown` at **line 662**. The line-type branch at **line 677** handles `'p1' | 'p2'` — sets drag mode to `'endpoint'`. The pointer-move `'endpoint'` branch at **line 302** recomputes bbox + center-relative offsets from both endpoints and live-commits on every move (`checkpointPolicy: 'skip'`), then commits a normal checkpoint on pointerup at **line 526**.

**Minimal insertion point for a middle curvature handle** (a "p_mid" drag mode):

1. **Data model**: extend line JSON with an optional `data.midpoint: {x, y}` field (absolute page coords).
2. **Render path**: `renderLine` at svgAnnotationRenderers.jsx:180 currently returns a plain `<line>`. Branch to `<path d="M x1,y1 Q Cx,Cy x2,y2">` when `obj.data?.midpoint` is present, using `getCurvedPath` from `lineGeometry.js:105` (already ported).
4. **Arrow tangent**: `renderLine`'s arrow branch (svgAnnotationRenderers.jsx:151) computes the arrowhead angle via `Math.atan2(dy,dx)`. For curved arrows, replace with `getCurveEndAngle(start, end, midpoint)` (lineGeometry.js:125).
5. **Selection handle**: add a third circle at `SVGAnnotationLayer.jsx:1264` rendered at the current midpoint (either the geometric midpoint when no curve, or `obj.data.midpoint` when curved). Call `handleHandlePointerDown(e, 'pmid')`.
6. **Drag mode**: add a `'midpoint'` branch in useSVGInteraction.js:302 (next to the `'endpoint'` branch) that updates `obj.data.midpoint` on every move + commits via `skip` → `normal` checkpointPolicy.
7. **Snap-to-straight reset**: `shouldSnapToLinear(midpoint, start, end, 10)` from lineGeometry.js:88 already returns true when midpoint is within 10px of the line — on pointerup, if true, clear `obj.data.midpoint` so the renderer falls back to plain `<line>`.

The math is a file copy away — `lineGeometry.js` is untouched combined-tools code.

### Hover / cursor / keyboard

- **Hover**: SVGAnnotationLayer.jsx:893-921 draws a line-shaped hover stroke (`strokeWidth = max(6, sw+4)`) when `annotationIsHovered`, and a fat invisible `strokeWidth = max(12, sw+10)` hit line with `pointerEvents='stroke'`.
- **Cursor**: `grab` on endpoint handles; `move` on the selected line wrapper (SVGAnnotationLayer.jsx:877).
- **Keyboard**: Shortcut `'L'` to enter tool (App.jsx:22489). No angle-snap modifier, no reset-to-straight shortcut, no arrow key nudging specific to line.

## Arrow Tool (current state)

### SVG render path

Two separate render functions because Fabric.js can represent the same arrow either as a tagged `fabric.Line` OR as a legacy `fabric.Group(line + triangle)`:

- **Tagged-line path** (current creation flow): `renderLine` at svgAnnotationRenderers.jsx:151. When `obj.tool === 'arrow'`, renders a `<g>` containing a `<line>` (shortened by `headSize/3` to stop at the back of the arrowhead) + a `<polygon>` arrowhead rotated via `transform={translate(x2,y2) rotate(angleDeg)}`. Arrowhead size: `max(8, strokeWidth * 3)`.
- **Legacy group path** (PDF-imported arrows): `renderArrow` at svgAnnotationRenderers.jsx:203. Walks `obj.objects[]` looking for a line child and a triangle-or-name-'arrowHead' child. Dispatched at SVGAnnotationLayer.jsx:663-673 when `objectType === 'group'` with a line child.

Both hardcode a single triangle arrowhead. **No arrowhead style variants. Hardcoded solid triangle only.**

### Edit flow

Same as line — double-click → FabricEditCanvas shape edit with `hasControls:false`. No geometry editing in edit mode. Users exit edit mode back to select to drag endpoints.

### Creation flow

Same `FabricDrawingCanvas.jsx:287-292` branch as line, with `tool = 'arrow'`. The ONLY difference from line creation is the `shapeJSON.tool = 'arrow'` tag at line 251 — geometry is identical. Shortcut **'A'** at App.jsx:22502.

### Data model

Identical to line — plain `fabric.Line` JSON with `tool: 'arrow'`. There is **no arrowhead style field**, no `arrowheadStart/End` toggle, no tail/head direction control.

### Selection handles

Same as line — SVGAnnotationLayer.jsx:1221-1264 shows two endpoint circles (p1 = tail, p2 = head/tip). Comment at line 1228-1229: "Arrow: handle at arrowhead tip (ep2) and line start (ep1)." No special visual differentiation of the tip handle vs the tail handle.

### Interaction / where middle handle plugs in

Same `'endpoint'` branch in useSVGInteraction as line (line 302, 677). A middle curvature handle would follow the exact same insertion path documented under Line. The arrow-specific adjustment is just the curve-tangent arrowhead rotation:

- svgAnnotationRenderers.jsx:155 currently computes `angleRad = Math.atan2(dy, dx)` linear-only
- Replace with: if `obj.data?.midpoint`, use `getCurveEndAngle(start, end, midpoint)` from lineGeometry.js:125; else keep linear

### Hover / cursor / keyboard

Identical to line — same hover stroke, same endpoint handles, `'A'` shortcut. No arrow-specific features.

## Text Callout (current state)

### SVG render path

**The SVG layer does NOT render callouts.** See `SVGAnnotationLayer.jsx:711-717` — `filteredCallouts` is immediately early-returned as `[]`:

```js
const filteredCallouts = useMemo(() => {
  if (!Array.isArray(callouts) || callouts.length === 0) return [];
  // CalloutOverlay (in PageAnnotationLayer) handles ALL callout rendering...
  return [];
  // ...unreachable code below...
}, [...]);
```

All callout rendering lives in `components/Callout/CalloutComponent.jsx:1091+` via absolutely-positioned HTML divs + inline `<svg>` for the connector path, scaled into container space via a CSS transform wrapper in `CalloutCanvas.jsx:719`. This is a separate rendering system from the rest of the SVG display pipeline.

The `renderCallout` function in `svgAnnotationRenderers.jsx:395` and `calloutGeometry.js:calculateCalloutConnection` are **dead code** on the SVG path — they only run via the unreachable branch.

### Edit flow

- **Select/pan tool + click on textbox** → `handleTextBoxClick` selects callout, shows corner/knee/arrowTip handles (`showResizeHandles = true` at CalloutComponent.jsx:70).
- **Double-click on textbox** → enters text editing mode (`setIsEditing(true)`), focuses a contentEditable div (CalloutComponent.jsx:199+).
- **FabricEditCanvas involvement**: `editType === 'callout'` branch exists at FabricEditCanvas.jsx:1335 (`loadCalloutAnnotation`) but is only invoked for **legacy PAL callouts** that live as Fabric.js Groups — NOT for the React callouts created in the current system.

### Creation flow

- Tool activate: keyboard **'Q'** → App.jsx:22476 → `setActiveTool('callout')`.
- `CalloutCanvas.handleMouseDown` at line 146: sets `creationState.isCreating = true`, saves `arrowTip = pos`.
- `handleMouseUp` at line 394: creates a new Callout via `createCallout()` (types.js:211) with arrowTip at click, textBoxPosition at release, knee as midpoint + 40px offset. Default box size is 120×32px (hardcoded at CalloutCanvas.jsx:420-421).
- Commits via `setCallouts(prev => [...prev, newCallout])`. Callouts are stored in a **separate top-level array** in App.jsx, NOT inside `annotations.objects[]`.

### Data model

From `types.js:52-63` and `115-130`. Normalized (0-1) coordinates relative to page:

```js
{
  id: string,
  pageNumber: number,
  arrowTip: { x: 0-1, y: 0-1 },        // normalized point
  knee: { x: 0-1, y: 0-1 },            // normalized point (the bend)
  textBoxPosition: { x: 0-1, y: 0-1 }, // top-left, normalized
  textBoxWidth: 0-1,                    // % of page width
  textBoxHeight: 0-1,                   // % of page height
  text: string,
  style: {
    borderColor: hex,
    borderOpacity: 0-1,
    lineThickness: 1-6,
    arrowheadStyle: 'none'|'solidTriangle'|'vShape'|'openCircle'|'openTriangle'|'horizontalLine',
    fillColor: hex,
    fillOpacity: 0-1,
    fontFamily: string,
    fontSize: number,
    fontColor: hex,
    bold, italic, underline, strikethrough: bool,
    textAlign: 'left'|'center'|'right',
  },
  isSelected: bool,
  moduleId?, spaceId?, regionId?     // optional scoping
}
```

### Selection handles

Four corner handles on the textbox (CalloutComponent.jsx:1287-1357) — all 12×12px white-fill blue-outline squares positioned at `{top|bottom}: -6; {left|right}: -6;`. All use `handleCornerMouseDown(e, 'nw'|'ne'|'sw'|'se')` → `onStartDrag({ type: 'textBoxCorner', ...corner }, { x: 0, y: 0 })`.

**Plus two independent point handles:**
- **Knee handle** (CalloutComponent.jsx:1362-1385): 12×12px square at `knee.x - 6, knee.y - 6`. Drag moves just the knee.
- **Arrow tip handle** (CalloutComponent.jsx:1388-1411): 12×12px square at `arrowTip.x - 6, arrowTip.y - 6`. Drag moves just the tip.

No rotation handle. No midpoint handle. No distance/collision check between knee handle and arrowTip handle.

### Interaction / where middle handle plugs in

`CalloutCanvas.handleMouseMove` at line 245 dispatches on `dragTarget.type`:
- `'arrowTip'` → line 316: `{ ...callout, arrowTip: posPercent }`
- `'knee'` → line 318: `{ ...callout, knee: posPercent }`
- `'textBox'` → line 320: moves textBoxPosition, with dragOffset math
- `'textBoxCorner'` → line 333: 4-branch corner-anchored resize math (see Gap 3 below)
- `'whole'` → line 270: moves arrowTip + knee + textBoxPosition together

A middle curvature handle for the callout's connector path would insert at CalloutComponent.jsx's SVG connector section (~line 881) — currently a two-segment polyline `M start L knee L arrowBase`. Replace with a curved middle segment if `callout.data?.connectorMidpoint` is set. But note: the callout *already* has a knee, which IS a middle handle — so the ask may actually be "curve the knee segments" vs "add a third point."

### Hover / cursor / keyboard

- **Hover**: No hover-preview chrome in CalloutCanvas. The textbox shows `cursor: move` when not editing and `text` when editing (line 1178).
- **Cursor**: `nw-resize`/`ne-resize`/`sw-resize`/`se-resize` on the 4 corner handles; `move` on knee + arrowTip + textbox drag; `crosshair` on canvas during callout tool mode (line 708).
- **Keyboard**: `'Q'` enters callout tool (App.jsx:22476). Delete/Backspace deletes selected callout (Callout/index.jsx:56). Escape deselects (index.jsx:70). No arrow-style nudge, no shift-constrain.

## Known Gap Details

### Gap 1 — Line/arrow middle curvature handle

**Status**: Renderer, data model, interaction hook, and selection overlay all assume straight lines with no curve field. The bezier math is fully ported in `src/utils/lineGeometry.js` but only consumed by the legacy PAL.

**Where the fix goes**:
1. **Data**: introduce optional `obj.data.midpoint: {x,y}` (page coords).
2. **Renderer**: `svgAnnotationRenderers.jsx:180` (line branch) and `:151` (arrow branch) — swap `<line>` for `<path d={getCurvedPath(start, end, midpoint)}>` when midpoint present. Arrow tangent uses `getCurveEndAngle`.
3. **Handle rendering**: add a third circle at `SVGAnnotationLayer.jsx:1263` (just below the existing p1/p2 handles) at the effective midpoint.
4. **Interaction**: new `'midpoint'` drag mode in `useSVGInteraction.js` paralleling the existing `'endpoint'` branch (line 302 for move, line 526 for commit, line 677 for the handle-down dispatch).
5. **Snap-reset**: on pointerup call `shouldSnapToLinear(midpoint, p1, p2, 10)` — if true, delete `obj.data.midpoint` so renderer falls back to straight line.

Entire fix shape: one new mode + two renderer branches + one new handle render block + two data-model fields. Zero new math (lineGeometry already has it).

### Gap 2 — Callout handle collision

**Where**: `CalloutComponent.jsx:1361-1411` renders knee and arrowTip handles as **independent absolute-positioned divs** with no distance check between them. When the user creates a callout at a near-horizontal orientation or drags the knee close to arrowTip, the 12×12 handles physically overlap.

**No constraint code exists in CalloutCanvas.handleMouseMove** at the `'knee'` (line 318) or `'arrowTip'` (line 316) branches — both just set `posPercent` directly with no minimum-distance enforcement against the other point.

**Fix location**: Add a `minSeparationPixels` check in the `'knee'` and `'arrowTip'` move branches (CalloutCanvas.jsx:316-320). Approximate form:
```js
case 'knee': {
  const arrowTipPx = toPixels(callout.arrowTip);
  const kneePx = pos; // already in pixel space
  const dist = Math.hypot(kneePx.x - arrowTipPx.x, kneePx.y - arrowTipPx.y);
  if (dist < MIN_HANDLE_SEPARATION) {
    // project knee onto circle of MIN_HANDLE_SEPARATION around arrowTip
    const ratio = MIN_HANDLE_SEPARATION / dist;
    const constrained = { x: arrowTipPx.x + (kneePx.x - arrowTipPx.x) * ratio, ... };
    return { ...callout, knee: toPercent(constrained) };
  }
  return { ...callout, knee: posPercent };
}
```
Symmetric check needed for `'arrowTip'`. Also need to enforce a knee ↔ textBox-border separation to prevent the knee from swallowing the textbox.

### Gap 3 — Callout resize

**Where**: `CalloutCanvas.handleMouseMove` textBoxCorner branch at **line 333-386**.

**Likely bugs**:

1. **dragOffset mismatch**: `handleCornerMouseDown` (CalloutComponent.jsx:420) calls `onStartDrag(..., { x: 0, y: 0 })`, hardcoding offset as zero. `CalloutCanvas.startDrag` (line 560) then divides this by `containerScaleRef` — still zero — so the corner drag uses `pos` (raw mouse in unscaled page space) as the new corner. Fine in concept.

2. **`cornerResizeInitialStateRef` capture timing**: `startDrag` captures the initial state (line 574) from the `callouts` array AFTER the `setDragTarget(target)` call, using `callouts.find(...)` **but `callouts` is a captured closure dependency** that only updates after React re-renders. If the callout was just selected and its state is in-flight, the ref will hold stale values. The dep array at line 597 depends on `callouts` — okay, but inside the callback itself the value may still be one render behind.

3. **Min dimensions in wrong unit**: line 351-352 defines `const minWidth = 80; const minHeight = 32;` in **pixels**, but these are applied against `initialPixels` which is `callout.textBox * pageSize`. At low zoom this minimum may be reached before the user intends; at high zoom the minimum may become invisibly small (since CSS transform scales it down anyway). Should be defined in normalized space OR in screen-space consistently.

4. **Corner math is correct for NW/SE but awkward for NE/SW**: inspect line 361-372 — the NE case sets `newY = fixedBottomY - newHeight` which is right IF newHeight grew/shrank symmetrically, but the user only drags the Y-axis on one direction and `newY` will jitter if pointer crosses the anchor. Plus there's **no flip support** — if the user drags past the anchor, newWidth/newHeight are clamped to `minWidth/minHeight` (line 357, etc) via `Math.max`, meaning the corner snaps instead of flipping. Fabric-style resize should support flipping through the anchor.

5. **No container-scale division on pos coordinates for corner handles**: `getMousePosition` at CalloutCanvas.jsx:97 already divides clientX/Y by `containerScaleRef`, returning unscaled page-space. Initial state is captured in percentage space → converted to pixels (line 339). So pos and initialPixels are in the same space (unscaled page pixels). **This part is correct.** The issues above (2, 3, 4) are the real bugs.

The user's observation "resize is broken in some unclear way" most likely lands on one of: (3) min-size clamping at extreme zooms, (4) lack of flip + corner math jitter near the anchor, or (2) stale-ref on rapidly re-selected callouts.

## Gap Map (combined-tools features vs current state)

- **Line middle bezier handle**: MISSING — no `data.midpoint` field; `svgAnnotationRenderers.jsx:180` renders straight `<line>` only; `useSVGInteraction.js:302` endpoint branch has no midpoint mode. (Math exists in `utils/lineGeometry.js:105` but unused.)
- **Line snap-to-angle (create)**: MISSING — `FabricDrawingCanvas.jsx:322` sets x2/y2 directly to pointer on every mousemove with no Shift-key handling.
- **Line snap-to-angle (edit)**: MISSING — `useSVGInteraction.js:302` endpoint branch directly writes new coords with no angle constraint. `snapAngleToNearest45` exists in svgTransformMath.js:121 but is only used on the rotation handle.
- **Line snap-curve-to-straight reset**: MISSING — no midpoint field to clear. `shouldSnapToLinear` exists at lineGeometry.js:88 but unused in SVG layer / interaction hook.
- **Arrow middle bezier handle**: MISSING — same story as line. `svgAnnotationRenderers.jsx:151` arrow branch uses `Math.atan2(dy,dx)` linear-only tangent.
- **Arrow snap-to-angle (create)**: MISSING — shares `FabricDrawingCanvas.jsx:287-292` with line, no constraint.
- **Arrow snap-to-angle (edit)**: MISSING — shares `useSVGInteraction.js:302` endpoint branch with line.
- **Arrow snap-curve-to-straight reset**: MISSING.
- **Arrow arrowhead style options**: MISSING for line/arrow tool — the `fabric.Line + tool:'arrow'` data model has no arrowhead style field at all. `svgAnnotationRenderers.jsx:163-176` hardcodes a single solid triangle. **HOWEVER**: the callout system already has 6 styles defined at `src/components/Callout/types.js:9-16` (`NONE, SOLID_TRIANGLE, V_SHAPE, OPEN_CIRCLE, OPEN_TRIANGLE, HORIZONTAL_LINE`) rendered at `CalloutComponent.jsx:951-1089`. That enum + render switch can be lifted.
- **Callout handle distance / collision constraints**: MISSING — `CalloutCanvas.jsx:316-320` knee/arrowTip move branches write positions directly with no inter-handle min-distance check.
- **Callout resize math correctness**: EXISTS (broken) — `CalloutCanvas.jsx:333-386` textBoxCorner branch. See Gap 3 above for the four likely issues.
- **Callout tail shape variants**: MISSING for the combined-tools "multiple tail shapes" concept. The callout only has arrowhead style variants (6 options, see above). Tail = the line origin on the textbox border, currently computed by `getClosestBorderPoint` at CalloutComponent.jsx:~781 (approximate line) with no shape variation.
- **Callout knee handles**: EXISTS — `CalloutComponent.jsx:1362-1385` renders a single knee handle. Only one knee per callout (not multi-segment). Combined-tools may have multiple knees — that would be a new feature.
- **Per-tool hover state**: PARTIAL — line hover exists at `SVGAnnotationLayer.jsx:898-908` (line-shaped stroke glow); rect/circle/text hover exists at `SVGAnnotationLayer.jsx:989-1003`; **callout has no hover state at all** (no hover branch in CalloutComponent.jsx render).
- **Per-tool cursor treatment**: PARTIAL — line/arrow use generic `grab` on endpoint handles and `move` on the selected wrapper (SVGAnnotationLayer.jsx:877). Callout has corner-specific `nw-resize`/etc and `move` on knee/tip. No `crosshair` cursor on the svg layer for active line/arrow tool mode — drawing tools flow through `FabricDrawingCanvas` which is a separate layer.
- **Per-tool keyboard shortcut**: EXISTS — `'L'` line at `App.jsx:22489`, `'A'` arrow at `:22502`, `'Q'` callout at `:22476`. No keybind to toggle curve-reset, no shift-constrain handling documented for drawing modes, no arrow-key nudge on selected line/arrow.

## Risk Areas

- **`src/App.jsx`** (~1.3MB, PROTECTED by CLAUDE.md): owns `activeTool` state, keyboard shortcuts L/A/Q, the callouts state array, and the `handleSaveAnnotations` pipeline. Any new tool shortcut, new per-tool cursor handling, or new data-model field that needs App-level save-integration risks touching this file. Port work SHOULD stay read-only here. If required, flag for user approval first.
- **`src/components/PageAnnotationLayer.jsx`** (~9858 LOC, PROTECTED): the ONLY live consumer of `src/utils/lineGeometry.js`. It has a working curved-line render + curved-arrow tangent via `getCurveEndAngle` at PAL:2141. **Biggest risk**: tempting to delete lineGeometry.js thinking it's dead code (it's NOT — PAL still uses it). Also tempting to copy PAL's curved-line logic into the SVG layer, but that would entangle the two paths. Better: consume `lineGeometry.js` directly from SVG renderers + useSVGInteraction, leave PAL alone.
- **`src/components/SVGAnnotationLayer.jsx`** (1360 LOC): hosts the line/arrow endpoint handle branch AND the counter rotation handle branch AND the [COUNTER WIP — DO NOT TOUCH] blocks at lines 1072-1194. A curvature handle will land right next to the [COUNTER WIP] zone — carefully scope edits to `isLineType` branch at line 1221-1264 only.
- **`src/components/FabricEditCanvas.jsx`** (2587 LOC): shape edit mode explicitly disables `hasControls/hasBorders` (Phase 13 EDIT-14 decision). DO NOT "fix" this by re-enabling — edit mode is content-only by design. Geometry lives in select-mode endpoint handles. If the port adds curvature editing to shape edit mode, that's a behavior reversal and needs user approval.
- **`src/utils/svgAnnotationRenderers.jsx`**: the `renderLine` function handles BOTH line and arrow via the `obj.tool === 'arrow'` check. Keeping the linear path working while adding a curved branch means branching on `obj.data?.midpoint` presence BEFORE the arrow/line branching. Order matters.
- **`src/components/Callout/CalloutCanvas.jsx`**: resize math (the Gap 3 target) also handles whole-move, knee, arrowTip, textBox drag — shares the same `handleMouseMove` at line 245 via a giant switch. Corner-resize fixes touch the same callback as knee/tip collision fixes. Scope carefully to avoid regressing the other cases.
- **`src/components/Callout/CalloutComponent.jsx`** (1446 LOC): handles corner-down, knee-down, arrowTip-down, context menu, edit modal, text editing lifecycle, touch events. Any new handle render (e.g., midpoint curvature for the connector path) will share the same SVG tree as the arrowhead render switch — watch z-order.
- **`src/hooks/useSVGInteraction.js`** (898 LOC): a new `'midpoint'` drag mode adds a branch in four places: handlePointerDown (line 662), handlePointerMove (line 302), handlePointerUp (line 526), and the dragStateRef shape (line 44). Miss one of the four and you get stuck drag state or missing commit.
