# Phase 15: Line/Arrow Curvature + Arrowhead Styles - Research

**Researched:** 2026-04-16
**Domain:** SVG annotation render pipeline + pointer-driven interaction (in-repo wiring of an already-ported math library)
**Confidence:** HIGH

## Summary

Phase 15 is a **pure wiring job, not a domain investigation**. Every piece needed already exists in the repo, just not connected:

1. **Math** is fully ported in `src/utils/lineGeometry.js` (192 LOC, 9 exports, all referenced verbatim from `combined-tools/src/lib/lineGeometry.ts`). The quadratic-bezier control-point derivation, snap-to-linear threshold, and tangent-at-t=1 helper are all correct and need no rewriting.
2. **Arrowhead enum** lives at `src/components/Callout/types.js:9-25` (`ARROWHEAD_STYLES` + label map). Phase 15 imports and consumes — must NOT modify.
3. **Arrowhead geometry for all 6 styles** is implemented as Fabric.js objects in the **legacy** file `src/PageAnnotationLayer.jsx:347-470` inside `createArrowhead(x, y, angleRad, color, sw, style)`. Phase 15 ports the geometry from Fabric primitives (`Triangle`, `Polyline`, `Circle`, `Line`) into pure SVG primitives (`<polygon>`, `<polyline>`, `<circle>`, `<line>`) inside a new helper `renderArrowhead(...)` in `src/utils/svgAnnotationRenderers.jsx`.
4. **Drag-mode invariants** are templated by Phase 14's `'callout-part'` mode and the existing `'endpoint'` mode in `src/hooks/useSVGInteraction.js:452-491` + `:781-799` + `:962-986`. The same four-place invariant (drag-state init, pointerDown dispatch, pointerMove branch, pointerUp commit + reset) applies to the new `'midpoint'` mode.
5. **Persistence is free.** `'data'` is already in `CUSTOM_PROPS` at `FabricDrawingCanvas.jsx:25-31` (and the other three Fabric canvases). `data.midpoint` and `data.arrowheadStyle` will round-trip through `toJSON(CUSTOM_PROPS)` automatically — **no FabricDrawingCanvas changes required**, confirming the CONTEXT.md fallback-renderer decision.

**Primary recommendation:** Decompose into 1-2 plans. Plan A: midpoint handle render + curved-path branch + `'midpoint'` drag mode + endpoint-preserves-midpoint extension (LINE-01..03 + ARROW-01..03). Plan B (or merged): `renderArrowhead` helper + 6-style switch + tangent swap + fallback (`arrowheadStyle ?? (tool === 'arrow' ? SOLID_TRIANGLE : NONE)`) (ARROW-04). The shared `'midpoint'` mode and `renderLine` curved branch make a single plan defensible; splitting is justified only if the arrowhead helper grows past ~100 LOC.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Midpoint curvature handle (visual + interaction)**
- Shape: same white-fill / blue-ring circle as the existing p1/p2 endpoint handles (`SVGAnnotationLayer.jsx:1783-1803`), **smaller radius**. Endpoints use `r = 7 × √(inverseScale)`; midpoint handle uses `r = 5 × √(inverseScale)` (~70% of endpoint size). Same `fill="#ffffff"`, `stroke="#4a90e2"`, `strokeWidth={1.5}`, `vectorEffect="non-scaling-stroke"`, same drop-shadow filter.
- Visibility: only when the line/arrow is selected. Hovering an unselected line does NOT reveal the midpoint handle.
- Cursor: `grab` / `grabbing`, identical to endpoint handles.
- No tether line between the straight baseline and the midpoint handle. Handle sits directly on the curve at `t=0.5`.
- Handle position at `t=0.5` on the curve, not at the geometric mean of start/end.
- Drag dispatch: new `'midpoint'` handleId via `handleHandlePointerDown` alongside `'p1'` and `'p2'`. **Four-place invariant** in `useSVGInteraction.js`: (1) `dragStateRef` shape extended, (2) `handlePointerDown` picks up the new handleId, (3) `handlePointerMove` has a `'midpoint'` branch, (4) `handlePointerUp` commits via `shouldSnapToLinear` check.

**Area 2 — Snap-to-straight threshold & feedback**
- Silent snap — no visual indicator while dragging in the 10px threshold zone. Line just straightens.
- Auto-revert to straight with recomputed geometric midpoint when an endpoint drag produces naturally collinear geometry. Clears `data.midpoint`.
- Threshold is **10px in SVG units** (page coordinates), not screen pixels.
- Drag-snap threshold (10px) and render hysteresis (1px) are **hardcoded constants inside `lineGeometry.js`** — not tunable per-annotation.
- Render hysteresis (1px): when rendering, if `distanceToLineSegment(midpoint, start, end) <= 1`, the renderer emits a plain `<line>` instead of a curved `<path>`.

**Area 3 — Arrowhead style system (data model, sizing, render dispatch)**
- `arrowheadStyle` is the single source of truth for head rendering; `tool` field stays as-drawn. A line drawn with the line tool stays `tool: 'line'` forever, but its `arrowheadStyle` field can be any of the 6 values.
- 6 styles **reused from `src/components/Callout/types.js:ARROWHEAD_STYLES`**: `NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE`. Import the enum; do not redefine.
- Head-size base formula: `headSize = max(8, strokeWidth * 3)` — same formula currently used by `renderLine` in `svgAnnotationRenderers.jsx:163`.
- New helper function: `renderArrowhead(style, tipX, tipY, angleDeg, strokeColor, strokeWidth)` in `src/utils/svgAnnotationRenderers.jsx` returning a `<g>` of SVG elements.
- Rendering defaults (fallback): renderer treats missing `arrowheadStyle` as `tool === 'arrow' ? 'SOLID_TRIANGLE' : 'NONE'`. **Phase 15 does NOT require `FabricDrawingCanvas.jsx` to tag new line/arrow JSON with `arrowheadStyle` at creation time.**
- Curved-arrow tangent swap: when `data.midpoint` is present, `renderArrowhead` is called with `angleDeg = getCurveEndAngle(start, end, midpoint)`.
- Line + path rendering branch: when `data.midpoint` is present, renderer emits `<path d="M x1 y1 Q cx cy x2 y2">` where `(cx, cy) = getControlPoint(start, end, midpoint)`.

**Area 4 — Verification strategy**
- Manual JSON edit + reload is the primary verification path for ARROW-04 (6 styles).
- Smoke Playwright coverage: one scenario per success criterion (~5 new scenarios).
- No-regression on straight lines/arrows verified via visual-regression screenshot, before vs after Phase 15.
- Cleanup of 5 null-stub Callout files is NOT included in Phase 15.

### Claude's Discretion

- **Plan decomposition.** 1-2 plans (single plan if midpoint drag + render branch + arrowhead helper decompose cleanly; two plans if arrowhead system is large enough to ride its own lane).
- **Data layout of `data.midpoint`.** Could live as `obj.midpoint = { x, y }` directly on the Fabric Line JSON, or inside `data: { midpoint: {x, y} }`. Saved coords are **absolute page coordinates** (not normalized, not relative to bbox).
- **Bounding-box recomputation for curved paths.** Recommended: analytical computation from start/end/midpoint/control-point (deterministic, works pre-mount).
- **Live-commit vs checkpoint policy for midpoint drag.** Follow endpoint pattern — `checkpointPolicy: 'skip'` live + single checkpoint on `pointerup`. Mirrors Phase 12-03 optimistic-paint.
- **Exact helper signature / naming for `renderArrowhead`.** Suggested `renderArrowhead(style, { tipX, tipY, angleDeg, strokeColor, strokeWidth })`; planner may vary.
- **Line-child position inside a `type: 'group'` arrow** (pre-unification format). Planner chooses to upgrade legacy groups at load-time or keep both render paths.

### Deferred Ideas (OUT OF SCOPE)

- Curvature-indicator pill + typeable curvature input — Phase 16 (LINE-04, ARROW-05).
- Line/arrow mini-toolbar (color / thickness / arrowhead picker) — Phase 16 (LINE-06, ARROW-07).
- Minimum-drag-length creation threshold — Phase 16 (LINE-05, ARROW-06).
- Cross-tool arrowhead visual parity (line/arrow heads sized to match callout heads) — not in v2.3 scope.
- User-configurable curvature-snap threshold — not in scope.
- Handle z-order polish for overlapping lines — not in scope.
- Cleanup of the 4 non-enum null-stub Callout files — separate cleanup lane.
- Temporary dev-only 6-style picker / keyboard shortcut — rejected.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LINE-01 | Select line + drag midpoint handle to bend into quadratic curve passing through handle position | `getCurvedPath` + `getControlPoint` (Math §1) emit `M sx,sy Q cx,cy ex,ey` with `cx = 2*mx − 0.5*sx − 0.5*ex` so `B(0.5) = midpoint` exactly. New `'midpoint'` handle render in `SVGAnnotationLayer.jsx:1763-1806` (Integration §2). New `'midpoint'` drag mode in `useSVGInteraction.js` (Integration §3). |
| LINE-02 | Drag curved midpoint back near straight baseline → auto-snap to straight (10 px drag threshold, 1 px render hysteresis) | `shouldSnapToLinear(midpoint, start, end, threshold=10)` (lineGeometry.js:88). Drag-snap clears `data.midpoint` on pointermove; render hysteresis applied in `renderLine` before choosing `<line>` vs `<path>` (Pattern §3). |
| LINE-03 | Drag endpoint of curved line → curve reshapes with midpoint held fixed in absolute page coords; auto-revert if naturally collinear | Existing `'endpoint'` drag mode at `useSVGInteraction.js:452-491` extended: do NOT translate `data.midpoint`; on commit, run `shouldSnapToLinear(midpoint, newStart, newEnd)` and clear if true (Integration §3.b). |
| ARROW-01 | Curved arrow: arrowhead rotates to curve tangent at endpoint via `getCurveEndAngle(start, end, midpoint)` | `getCurveEndAngle` returns `Math.atan2(end.y − ctrl.y, end.x − ctrl.x)` in degrees (lineGeometry.js:125-135) — verified mathematically as tangent at t=1 (Math §2). `renderLine` arrow branch swaps `Math.atan2(dy, dx)` for `getCurveEndAngle(...)` when `data.midpoint` present (Pattern §3). |
| ARROW-02 | Drag curved arrow midpoint back near straight → arrowhead returns to linear tangent | Same snap mechanism as LINE-02 — clearing `data.midpoint` re-enters straight `<line>` branch which uses `Math.atan2(dy, dx)` again. No separate code path needed. |
| ARROW-03 | Drag endpoint of curved arrow → curve reshapes with midpoint held fixed; auto-revert on collinear | Identical to LINE-03 — same `'endpoint'` branch handles both because `tool` is read inside `renderLine`, not in the drag mode. |
| ARROW-04 | 6-value `arrowheadStyle` enum (`NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE`) on lines/arrows; persists via Fabric JSON; renders correctly at every zoom | Enum imported from `Callout/types.js:9-16`. Geometry lifted from legacy `src/PageAnnotationLayer.jsx:347-470 createArrowhead()` (Geometry §2). Persistence verified — `'data'` already in `CUSTOM_PROPS` (Integration §4). Fallback `arrowheadStyle ?? (tool === 'arrow' ? SOLID_TRIANGLE : NONE)` covers legacy data without migration. |

</phase_requirements>

## Standard Stack

### Core (already in repo, no install needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Renderer for SVG primitives | Phase 14 baseline; all SVG annotations are React components |
| Fabric.js | **5.5.2** | Source of truth for line/arrow JSON (`type: 'line'`, `x1/y1/x2/y2`, `data: {}` sidecar) | LOCKED. Do NOT upgrade to 6.x — see STATE.md decision logs and CONTEXT.md DO NOT CHANGE list. |
| `src/utils/lineGeometry.js` | (in-repo) | All curvature math | Already a verbatim port of `combined-tools/src/lib/lineGeometry.ts`. CONSUME ONLY. |
| `src/components/Callout/types.js` | (in-repo) | `ARROWHEAD_STYLES` enum | CONSUME ONLY. Single source of truth shared with legacy callout system. |

### Supporting (existing helpers Phase 15 calls)

| Helper | Where | Use |
|--------|-------|-----|
| `getLineEndpoints(obj)` | `src/utils/svgBoundingBox.js:178` | Resolve absolute `(x1,y1)(x2,y2)` from Fabric Line JSON. Used in `renderLine`, `SVGAnnotationLayer` selection-handle render, and `useSVGInteraction.handleHandlePointerDown` endpoint branch. Identical center-based formula. |
| `getMidpoint(start, end)` | `src/utils/lineGeometry.js:12` | Geometric midpoint for the straight-line case (where the midpoint handle should sit when `data.midpoint` is null). |
| `getControlPoint(start, end, midpoint)` | `src/utils/lineGeometry.js:187` | Compute `(cx, cy)` for the SVG `<path d="...Q cx cy...">` and bbox math. |
| `getCurvedPath(start, end, midpoint)` | `src/utils/lineGeometry.js:105` | Returns the full `M sx,sy Q cx,cy ex,ey` string. Use directly as the `d` attribute. |
| `getCurveEndAngle(start, end, midpoint)` | `src/utils/lineGeometry.js:125` | Tangent angle in **degrees** at t=1 — drop directly into `transform="rotate(...)"`. |
| `shouldSnapToLinear(mid, start, end, threshold=10)` | `src/utils/lineGeometry.js:88` | Returns `true` if midpoint is within threshold (default 10 px) of the straight baseline. Used in midpoint-drag pointerup AND in endpoint-drag pointerup auto-revert. |
| `distanceToLineSegment(point, start, end)` | `src/utils/lineGeometry.js:27` | Used inside `renderLine` for the **1 px render hysteresis** check (per CONTEXT.md Area 2). |
| `getPointOnCurve(start, end, midpoint, t=0.5)` | `src/utils/lineGeometry.js:165` | Optional convenience — equivalent to `midpoint` directly when `t=0.5`. Useful for diagnostic logs verifying the curve passes through the handle. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Quadratic bezier passing through midpoint | Cubic bezier with two control points | Cubic has 2 free DOF — needs 2 handles or arbitrary heuristic. Quadratic is the right choice for "single midpoint handle bends the line". Combined-tools verified. |
| `<path d="M Q">` for curved branch | Two `<line>` segments through midpoint | Hard angle at midpoint, doesn't read as a curve. Path-based bezier is the only correct rendering. |
| Re-derive arrowhead geometry from scratch | Lift from legacy `createArrowhead` (PageAnnotationLayer.jsx:347-470) | Lifting saves time + matches existing visual language for the 6 styles. The Fabric→SVG primitive translation is mechanical (Triangle→`<polygon>`, Circle→`<circle>`, Polyline→`<polyline>`, Line→`<line>`). |
| `<marker>` SVG markers for arrowheads | Inline `<g>` element per arrowhead | Markers are fine for solid triangles but add complexity for V-shape and horizontal-line styles, plus marker `orient="auto"` won't honor the curve tangent (it uses the path tangent at the endpoint, but only if applied to the curved `<path>` itself — meaning straight-line + curved-path code paths would need different attachment). Inline `<g transform="translate rotate">` is cleaner and matches the existing arrow render pattern at `svgAnnotationRenderers.jsx:177-181`. |

**Installation:** None required. All dependencies in-repo.

**Version verification:** Skipped — Fabric.js 5.5.2 is locked (STATE.md). All other helpers are local files with no version concept.

## Architecture Patterns

### Recommended File Layout

```
src/
├── utils/
│   ├── lineGeometry.js              # CONSUME ONLY — all math
│   ├── svgAnnotationRenderers.jsx   # EDIT — renderLine curved branch + new renderArrowhead helper
│   └── svgBoundingBox.js            # OPTIONAL — extend getLineBBox for curved bulge if planner picks analytical bbox
├── hooks/
│   └── useSVGInteraction.js         # EDIT — new 'midpoint' drag mode (4-place invariant) + endpoint-drag auto-revert
└── components/
    ├── SVGAnnotationLayer.jsx       # EDIT — add 3rd handle in isLineType branch (line ~1780)
    └── Callout/types.js             # CONSUME ONLY — ARROWHEAD_STYLES enum
```

### Pattern 1: Four-Place Invariant for New Drag Modes (from Phase 14)

**What:** Adding a new drag mode to `useSVGInteraction.js` requires touching exactly four sites — miss one and the drag will silently break or get stuck.

**When to use:** Every new drag mode (`'midpoint'` here, `'callout-part'` in Phase 14, `'rotate'` in Phase 12).

**Sites:**
1. **`dragStateRef.current = {...}`** initial shape (and `pointerUp` reset block) — add any mode-specific fields (e.g. `originalMidpoint: null`, `originalEndpoints: null` shared with `'endpoint'` mode).
2. **`handlePointerDown` / `handleHandlePointerDown`** — accept the new `handleId` and write `dragStateRef.current = { active: true, mode: 'midpoint', ... }`.
3. **`handlePointerMove`** — add an `else if (ds.mode === 'midpoint')` branch.
4. **`handlePointerUp`** — add the matching commit branch (with snap-to-linear check + checkpoint commit).

**Reference implementation:** `'callout-part'` mode added in Plan 14-03 (`useSVGInteraction.js:624-697` pointermove, `:915-925` pointerup commit, `:935-939` reset). The `'endpoint'` mode (`:452-491` + `:781-799` + `:962-986`) is the structurally closest existing template.

### Pattern 2: Optimistic-Paint Commit (Plan 12-03)

**What:** Live JSON commits on every `pointermove` with `checkpointPolicy: 'skip'`; single checkpoint at `pointerup` with `checkpointPolicy: 'normal'`.

**When to use:** Any drag that needs immediate visual feedback (rotate, endpoint, callout-part, and now midpoint).

**Example from `'endpoint'` (`useSVGInteraction.js:484-491`):**
```javascript
// Source: src/hooks/useSVGInteraction.js:484-491
const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
const targetObj = updatedAnnotations.objects[ds.annotationIndex];
Object.assign(targetObj, endpointData);
onSaveAnnotations(updatedAnnotations, {
  source: 'object:modified',
  action: 'endpoint-move',
  checkpointPolicy: 'skip',     // live paint, no undo entry
});
```

For `'midpoint'`: live commit `targetObj.data = { ...targetObj.data, midpoint: { x, y } }` on every move; on pointerup, run `shouldSnapToLinear` — if true, clear `data.midpoint`; in either case, fire one final `checkpointPolicy: 'normal'` save.

### Pattern 3: Curved vs Straight Branch Switch in `renderLine`

**What:** A single `if (data.midpoint && distanceToLineSegment(midpoint, start, end) > 1)` discriminator at the top of `renderLine` decides between the existing `<line>` branch and the new `<path>` branch. Render hysteresis (1 px) is enforced HERE so the straight-line code path runs unchanged when `data.midpoint` is `null` OR within 1 px of the baseline.

**Reference:** existing render branch at `svgAnnotationRenderers.jsx:141-199`.

**Pseudocode:**
```javascript
// Source: src/utils/svgAnnotationRenderers.jsx (proposed Phase 15 extension)
export const renderLine = (obj, index) => {
  // ... existing endpoint resolution (lines 141-156) unchanged ...
  const midpoint = obj.data?.midpoint;
  const isCurved = midpoint &&
    distanceToLineSegment(midpoint, { x: x1, y: y1 }, { x: x2, y: y2 }) > 1;
  const arrowheadStyle = obj.data?.arrowheadStyle ??
    (isArrow ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.NONE);

  if (isCurved) {
    const d = getCurvedPath({ x: x1, y: y1 }, { x: x2, y: y2 }, midpoint);
    const angleDeg = getCurveEndAngle({ x: x1, y: y1 }, { x: x2, y: y2 }, midpoint);
    return (
      <g key={key} opacity={obj.opacity ?? 1}>
        <path d={d} stroke={strokeColor} strokeWidth={sw} fill="none" strokeLinecap="round" />
        {renderArrowhead(arrowheadStyle, x2, y2, angleDeg, strokeColor, sw)}
      </g>
    );
  }
  // existing straight branch unchanged — handles arrow head via Math.atan2 already
  // ... (lines 157-198 unchanged for legacy compat) ...
};
```

### Pattern 4: `renderArrowhead` Helper (lifted from `createArrowhead`)

**What:** Pure-function helper returning a `<g>` of SVG primitives for one of 6 styles. Centralized in `svgAnnotationRenderers.jsx` so the straight-line branch (lines 169-182) ALSO migrates to it, replacing the hardcoded `<polygon>`. This unifies both branches and gives ARROW-04 a single switch case to test.

**Style → SVG primitive mapping (lifted from `src/PageAnnotationLayer.jsx:347-470`):**

| Style | Fabric primitive (legacy) | SVG primitive (Phase 15) | Sizing |
|-------|---------------------------|--------------------------|--------|
| `NONE` | `null` | Returns `null` | n/a |
| `SOLID_TRIANGLE` | `Triangle({ width, height, fill, angle: angleDeg+90 })` | `<polygon points="${-h/3},${-h/2} ${h*2/3},0 ${-h/3},${h/2}" fill={color} transform="translate rotate" />` | `headSize = max(8, sw * 3)` |
| `V_SHAPE` | `Polyline([arm1, tip, arm2], { stroke, strokeWidth: max(2, sw) })` | `<polyline points="${arm1x},${arm1y} ${tipX},${tipY} ${arm2x},${arm2y}" fill="none" stroke={color} strokeWidth={max(2, sw)} strokeLinecap="round" strokeLinejoin="round" />` (computed in absolute coords or via translate+rotate) | armLength = headSize, armAngle = π/6 (30°) |
| `OPEN_CIRCLE` | `Circle({ radius, fill: 'transparent', stroke, strokeWidth })` | `<circle cx={tipX} cy={tipY} r={headSize/2} fill="none" stroke={color} strokeWidth={max(2, sw)} />` | radius = headSize/2 |
| `OPEN_TRIANGLE` | `Triangle({ fill: 'transparent', stroke, strokeWidth: max(2, sw) })` | Same `<polygon>` as SOLID_TRIANGLE but `fill="none" stroke={color} strokeWidth={max(2, sw)}` | `headSize = max(8, sw * 3)` |
| `HORIZONTAL_LINE` | `Line([(x±halfL*cos(perpAngle), y±halfL*sin(perpAngle))], ...)` | `<line>` rotated perpendicular to arrow direction | halfLength = headSize/2 |

**Critical sizing note:** Legacy `createArrowhead` uses `baseSize = max(12, sw * 3)` (PAL.jsx:349). Existing `renderLine` uses `headSize = max(8, sw * 3)` (svgAnnotationRenderers.jsx:163). **Phase 15 must use 8, not 12,** per CONTEXT.md Area 3 — this preserves visual continuity for existing arrows. The 12px floor was a separate decision in the legacy callout-tool surface.

### Anti-Patterns to Avoid

- **Naive bezier control point** (control = midpoint). The curve will NOT pass through the midpoint at t=0.5; instead it will pass through `0.25*start + 0.5*midpoint + 0.25*end`. Always compute the control point via `getControlPoint(start, end, midpoint) = 2*mid − 0.5*start − 0.5*end`.
- **Translating `data.midpoint` with the endpoint drag** — defeats LINE-03. The midpoint must stay at its absolute page coordinate; the curve reshapes around it.
- **Putting snap threshold in screen pixels** — drag thresholds operate in SVG-page units (the same coordinate space as `getLineEndpoints`). At 200% zoom a 10 px screen threshold would be 5 px in page coords, which inverts the intent.
- **Modifying `lineGeometry.js`** — explicitly forbidden by CONTEXT.md DO NOT CHANGE. If the math is "wrong" at a call site, fix the call site.
- **Adding arrowhead styles to the existing arrow Group format (`renderArrow` at `svgAnnotationRenderers.jsx:209-258`)** — that's the legacy `type: 'group' { Line + Triangle }` path. Phase 15 targets the modern `type: 'line' + tool: 'arrow'` flat format used by `FabricDrawingCanvas` (creation site at `:287-301`). Legacy groups continue to render their hardcoded triangle until separately migrated.
- **Using SVG `<marker>` for the arrowhead** — see Alternatives table.
- **Re-rendering during zoom via JavaScript coordination** — SVG viewBox owns all zoom scaling (CLAUDE.md "CRITICAL — DO NOT BREAK"). The curve renders correctly at every zoom for free because the `<path>` lives inside the viewBox-scaled `<svg>`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quadratic bezier control point | Custom solver | `getControlPoint(start, end, midpoint)` (lineGeometry.js:187) | Already derived correctly. The formula `2*mid - 0.5*start - 0.5*end` is a closed-form solution to `B(0.5) = midpoint`. |
| Tangent at curve endpoint | Custom Math.atan2 on derivative | `getCurveEndAngle(start, end, midpoint)` (lineGeometry.js:125) | Already returns degrees, ready for SVG `transform="rotate(deg)"`. |
| Distance from point to line segment | Custom geometry | `distanceToLineSegment(point, start, end)` (lineGeometry.js:27) | Uses cross-product formula correctly handling lineLength=0 edge case. |
| Snap-to-straight detection | Manual threshold compare | `shouldSnapToLinear(midpoint, start, end, 10)` (lineGeometry.js:88) | One-liner; threshold is a default arg if Phase 16 ever wants it tunable. |
| Arrowhead geometry for 6 styles | Re-derive from scratch | Port from `createArrowhead` (`src/PageAnnotationLayer.jsx:347-470`) | All 6 cases already implemented and visually verified in the legacy callout-tool. Mechanical Fabric→SVG primitive translation. |
| `ARROWHEAD_STYLES` enum + label map | Re-define | Import from `src/components/Callout/types.js:9-25` | Single source of truth; what gets persisted across save/reload. |
| Line endpoint resolution from Fabric JSON | Re-implement center-based math | `getLineEndpoints(obj)` (svgBoundingBox.js:178) | Identical formula to `renderLine` — proven correct, used in 3 sites. |
| Persisting `data.midpoint` and `data.arrowheadStyle` through Fabric serialization | Custom CUSTOM_PROPS extension | Already covered — `'data'` is in CUSTOM_PROPS at `FabricDrawingCanvas.jsx:25-31` (and the other Fabric canvases). | Confirms CONTEXT.md fallback-renderer decision — no FabricDrawingCanvas waiver. |

**Key insight:** Phase 15 is **80% imports** of existing code. The "design" surface is genuinely small: choose `renderArrowhead`'s signature, choose between analytical-bbox vs `getBBox()` for the curved path's selection wrapper, choose data layout (`obj.midpoint` vs `obj.data.midpoint` — recommend the latter to keep CUSTOM_PROPS unchanged).

## Common Pitfalls

### Pitfall 1: Naive Bezier Control Point

**What goes wrong:** Setting the control point to `midpoint` directly produces a curve where `B(0.5) = 0.25*start + 0.5*midpoint + 0.25*end`, NOT `midpoint`. The handle visibly drifts away from the curve.

**Why it happens:** Quadratic bezier formula is `B(t) = (1-t)²P0 + 2(1-t)t·P1 + t²P2`. At t=0.5: `B(0.5) = 0.25 P0 + 0.5 P1 + 0.25 P2`. To make `B(0.5) = midpoint`, solve for `P1 = 2*midpoint − 0.5*P0 − 0.5*P2`.

**How to avoid:** Always go through `getControlPoint` / `getCurvedPath`. Never write `Q ${midpoint.x},${midpoint.y}` literally.

**Warning signs:** During testing, drop `getPointOnCurve(start, end, midpoint, 0.5)` into a console.log; it must equal `midpoint` to within 1e-9. If it equals something else, the control-point math was bypassed.

### Pitfall 2: Endpoint Drag Translates the Midpoint

**What goes wrong:** Treating the curved line as a single rigid body and translating start, end, AND midpoint by the same delta when an endpoint is dragged. Violates LINE-03 — the curve "follows" the endpoint instead of reshaping around the fixed midpoint.

**Why it happens:** Reusing the existing `'endpoint'` drag mode without a curved-line guard. The current code at `useSVGInteraction.js:452-491` only updates `x1/y1/x2/y2` — it doesn't touch `data.midpoint`, so this is **already correct by accident**. But if a planner refactors `'endpoint'` to "use the move-mode delta translation for consistency", it will silently break LINE-03.

**How to avoid:** Add an explicit comment in the `'endpoint'` branch: `// LINE-03: data.midpoint stays at its absolute page coords during endpoint drag — do NOT translate.` And in the pointerup commit, add the auto-revert call:
```javascript
const newStart = { x: ep.x1, y: ep.y1 };
const newEnd = { x: ep.x2, y: ep.y2 };
if (targetObj.data?.midpoint && shouldSnapToLinear(targetObj.data.midpoint, newStart, newEnd, 10)) {
  delete targetObj.data.midpoint;
}
```

**Warning signs:** Curved arrow's tangent angle changes during endpoint drag in a way that doesn't preserve "the bulge stays in the same world position".

### Pitfall 3: Render Hysteresis vs Drag Snap Confusion

**What goes wrong:** Conflating the 10 px drag-snap threshold with the 1 px render hysteresis. Either applying both at the same site, or applying neither.

**Why it happens:** They sound similar but serve different purposes:
- **10 px drag snap (`shouldSnapToLinear`):** runs DURING drag (in `pointerup` for midpoint mode, and in `pointerup` of endpoint mode). Clears `data.midpoint` from saved state.
- **1 px render hysteresis (`distanceToLineSegment(...) > 1`):** runs IN `renderLine` only. Doesn't mutate state — just guards against floating-point noise producing visible "1-pixel curves" when `data.midpoint` is set but mathematically collinear.

**How to avoid:** The drag snap mutates state. The render hysteresis is read-only. Both call `lineGeometry.js` helpers but at different sites and with different thresholds.

**Warning signs:** A line that "looks straight" but its JSON shows `data.midpoint` is set — that's expected, the render hysteresis is doing its job. A line that "should be straight" but shows a 1-px curve — render hysteresis was skipped.

### Pitfall 4: Arrowhead Sizing Mismatch with Legacy Arrows

**What goes wrong:** Using `baseSize = max(12, sw*3)` from the legacy `createArrowhead` — existing arrows visually shrink/grow after Phase 15 ships.

**Why it happens:** The legacy callout `createArrowhead` was 12 px floor; `renderLine`'s arrow branch is 8 px floor. Both formulas are visible in the same codebase (PAL.jsx:349 vs svgAnnotationRenderers.jsx:163).

**How to avoid:** **Always use `headSize = max(8, sw * 3)`** in the new `renderArrowhead` helper, per CONTEXT.md Area 3 explicit decision. Verify by snapshot-comparing existing straight arrows before/after Phase 15.

**Warning signs:** Existing committed arrows on Page 6 of `Package 2 - Rev 4 -- IC.pdf` change visual size in the regression screenshot.

### Pitfall 5: SVG Path `fill="none"` Forgotten

**What goes wrong:** `<path>` defaults to `fill="black"`. A curved line without `fill="none"` renders a black-filled crescent shape between the curve and an implicit closing chord.

**Why it happens:** SVG default; intuitive for closed shapes, surprising for open paths.

**How to avoid:** Always set `fill="none"` on the curved `<path>`. (The hardcoded `<polygon>` for SOLID_TRIANGLE legitimately uses `fill={color}` — that's intentional.)

**Warning signs:** First curved line draws a giant filled lens shape instead of an outline.

### Pitfall 6: Selection Bbox Doesn't Account for Curve Bulge

**What goes wrong:** The line's bbox at `getLineBBox` (svgBoundingBox.js:270-296) is computed from `(x1, y1)(x2, y2)` only. A curved line's visual extent extends beyond this bbox by the bulge magnitude. If the selection wrapper / hit area uses the line bbox, the curved line's visible bulge will be UNCLICKABLE outside the straight bbox.

**Why it happens:** Line bbox math was designed for straight lines pre-Phase 15.

**How to avoid:** Either:
- (a) Extend `getLineBBox` to take `data.midpoint` into account when present, growing the bbox to cover `(x1, y1, x2, y2, midpoint.x, midpoint.y)`. Analytical, deterministic.
- (b) For the curved selection wrapper specifically, compute the bbox from the rendered `<path>` element via `pathRef.current.getBBox()`.

CONTEXT.md "Claude's Discretion" recommends (b) analytical, working pre-mount. **Recommendation:** add an internal `getLineBBoxIncludingCurve(obj)` in `svgBoundingBox.js` that returns `getLineBBox(obj)` for straight lines and `union(straightBbox, midpointBbox)` for curved. Use it in the line-type selection wrapper at `SVGAnnotationLayer.jsx:1763-1806` and in the line hit-area at `:1355-1391`.

**Warning signs:** Curved line is selectable when clicked on the straight baseline but NOT when clicked on the bulge. Hover glow stops short of the bulge.

### Pitfall 7: Legacy Arrow Group Format (`type: 'group'`)

**What goes wrong:** Some saved annotations may be in the legacy `type: 'group' { objects: [Line, Triangle] }` format (handled by `renderArrow` at `svgAnnotationRenderers.jsx:209-258`). Phase 15's `renderLine` extension only fires for `type: 'line'`. A user with a legacy group-format arrow will see no curvature handle and no style picker effect.

**Why it happens:** Format unification was deferred. The current `FabricDrawingCanvas.jsx:287-301` always creates new arrows as `type: 'line' + tool: 'arrow'` (the modern format), so this only affects pre-existing data.

**How to avoid:** Per CONTEXT.md "Claude's Discretion": planner picks (a) upgrade-on-load (one-shot migration in `loadAnnotations`) or (b) extend `renderArrow` to also handle `data.midpoint` and `data.arrowheadStyle`. **Recommendation:** (a) one-shot upgrade — converting at load is a 10-line transform and unifies all downstream code paths. Mark migrated objects with `data.migratedFromGroup: true` for audit.

**Warning signs:** Some saved arrows ignore the new midpoint handle while newly created ones work.

## Code Examples

### Example 1: Curved Path Rendering

```jsx
// Source: PROPOSED extension to src/utils/svgAnnotationRenderers.jsx renderLine
import {
  getCurvedPath,
  getCurveEndAngle,
  distanceToLineSegment,
} from './lineGeometry.js';
import { ARROWHEAD_STYLES } from '../components/Callout/types.js';

const start = { x: x1, y: y1 };
const end = { x: x2, y: y2 };
const mid = obj.data?.midpoint;
const isCurved = mid && distanceToLineSegment(mid, start, end) > 1;

if (isCurved) {
  const d = getCurvedPath(start, end, mid);
  const angleDeg = getCurveEndAngle(start, end, mid);
  return (
    <g key={key} opacity={obj.opacity ?? 1}>
      <path
        d={d}
        stroke={strokeColor}
        strokeWidth={sw}
        fill="none"
        strokeLinecap="round"
      />
      {renderArrowhead(arrowheadStyle, x2, y2, angleDeg, strokeColor, sw)}
    </g>
  );
}
```

### Example 2: Midpoint Handle in `SVGAnnotationLayer.jsx`

```jsx
// Source: PROPOSED extension at SVGAnnotationLayer.jsx:1763-1806
// Inside the existing isLineType branch, add a third <circle> alongside p1/p2.
import { getMidpoint } from '../utils/lineGeometry';

const ep = getLineEndpoints(obj);
const start = { x: ep.x1 + dx, y: ep.y1 + dy };
const end = { x: ep.x2 + dx, y: ep.y2 + dy };
const midpointPos = obj.data?.midpoint
  ? { x: obj.data.midpoint.x + dx, y: obj.data.midpoint.y + dy }
  : getMidpoint(start, end);

// UX: Midpoint handle is r=5 (vs endpoints r=7) — secondary control cue
// per CONTEXT.md Area 1. Same fill/stroke/filter as endpoints to read as
// "same primitive family". cursor: 'grab' shared so the whole line behaves
// as a grabbable primitive.
const midpointR = 5 * handleIs;

return (
  <g key={`selection-wrapper-${selectedIndex}`}>
    {/* p1 endpoint handle — existing, unchanged */}
    <circle ... />
    {/* p2 endpoint handle — existing, unchanged */}
    <circle ... />
    {/* NEW: midpoint curvature handle */}
    <circle
      data-handle="midpoint"
      cx={midpointPos.x}
      cy={midpointPos.y}
      r={midpointR}
      fill="#ffffff"
      stroke="#4a90e2"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      style={handleStyle}
      onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'midpoint'); }}
    />
  </g>
);
```

### Example 3: `'midpoint'` Drag Mode in `useSVGInteraction.js`

```javascript
// Source: PROPOSED four-place addition to src/hooks/useSVGInteraction.js

// 1. handleHandlePointerDown extension (~line 962):
if (handleId === 'midpoint') {
  const ep = getLineEndpoints(obj);
  const start = { x: ep.x1, y: ep.y1 };
  const end = { x: ep.x2, y: ep.y2 };
  dragStateRef.current = {
    active: true,
    mode: 'midpoint',
    handleId: 'midpoint',
    startSVGPoint: svgPoint,
    originalEndpoints: ep,
    originalMidpoint: obj.data?.midpoint || getMidpoint(start, end),
    annotationIndex: selectedIndex,
    ctmInverse,
  };
  return;
}

// 2. handlePointerMove branch (~line 491, after 'endpoint'):
} else if (ds.mode === 'midpoint') {
  const newMidpoint = {
    x: ds.originalMidpoint.x + (svgPoint.x - ds.startSVGPoint.x),
    y: ds.originalMidpoint.y + (svgPoint.y - ds.startSVGPoint.y),
  };
  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
  const targetObj = updatedAnnotations.objects[ds.annotationIndex];
  targetObj.data = { ...(targetObj.data || {}), midpoint: newMidpoint };
  onSaveAnnotations(updatedAnnotations, {
    source: 'object:modified',
    action: 'midpoint-move',
    checkpointPolicy: 'skip',
  });
  ds.currentMidpoint = newMidpoint;
  setInteractionState('dragging');
}

// 3. handlePointerUp branch (~line 799, after 'endpoint'):
} else if (ds.mode === 'midpoint' && ds.currentMidpoint) {
  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
  const targetObj = updatedAnnotations.objects[ds.annotationIndex];
  const ep = ds.originalEndpoints;
  const start = { x: ep.x1, y: ep.y1 };
  const end = { x: ep.x2, y: ep.y2 };
  // 10 px drag-snap: clear midpoint if user dragged it back near baseline
  if (shouldSnapToLinear(ds.currentMidpoint, start, end, 10)) {
    if (targetObj.data) delete targetObj.data.midpoint;
  } else {
    targetObj.data = { ...(targetObj.data || {}), midpoint: ds.currentMidpoint };
  }
  onSaveAnnotations(updatedAnnotations, {
    source: 'object:modified',
    action: 'midpoint-move',
    checkpointPolicy: 'normal',
  });
}

// 4. dragStateRef reset (~line 928): include the new fields
dragStateRef.current = {
  ...existing,
  originalMidpoint: null, currentMidpoint: null,
};
```

### Example 4: `renderArrowhead` Helper

```jsx
// Source: PROPOSED new helper in src/utils/svgAnnotationRenderers.jsx
// Geometry lifted from src/PageAnnotationLayer.jsx:347-470 (createArrowhead).
import { ARROWHEAD_STYLES } from '../components/Callout/types.js';

export const renderArrowhead = (style, tipX, tipY, angleDeg, color, sw) => {
  if (style === ARROWHEAD_STYLES.NONE) return null;
  const headSize = Math.max(8, sw * 3);  // PRESERVE existing renderLine sizing
  const angleRad = (angleDeg * Math.PI) / 180;

  switch (style) {
    case ARROWHEAD_STYLES.SOLID_TRIANGLE:
      return (
        <polygon
          points={`${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`}
          fill={color}
          transform={`translate(${tipX},${tipY}) rotate(${angleDeg})`}
        />
      );
    case ARROWHEAD_STYLES.OPEN_TRIANGLE:
      return (
        <polygon
          points={`${-headSize / 3},${-headSize / 2} ${headSize * 2 / 3},0 ${-headSize / 3},${headSize / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(2, sw)}
          transform={`translate(${tipX},${tipY}) rotate(${angleDeg})`}
        />
      );
    case ARROWHEAD_STYLES.OPEN_CIRCLE:
      return (
        <circle
          cx={tipX} cy={tipY}
          r={headSize / 2}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(2, sw)}
        />
      );
    case ARROWHEAD_STYLES.V_SHAPE: {
      // Compute V arms in absolute coords (legacy createArrowhead pattern)
      const armLength = headSize;
      const armSpread = Math.PI / 6; // 30° spread
      const arm1X = tipX - armLength * Math.cos(angleRad - armSpread);
      const arm1Y = tipY - armLength * Math.sin(angleRad - armSpread);
      const arm2X = tipX - armLength * Math.cos(angleRad + armSpread);
      const arm2Y = tipY - armLength * Math.sin(angleRad + armSpread);
      return (
        <polyline
          points={`${arm1X},${arm1Y} ${tipX},${tipY} ${arm2X},${arm2Y}`}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(2, sw)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    case ARROWHEAD_STYLES.HORIZONTAL_LINE: {
      const halfL = headSize / 2;
      const perp = angleRad + Math.PI / 2;
      const lx1 = tipX + halfL * Math.cos(perp);
      const ly1 = tipY + halfL * Math.sin(perp);
      const lx2 = tipX - halfL * Math.cos(perp);
      const ly2 = tipY - halfL * Math.sin(perp);
      return (
        <line
          x1={lx1} y1={ly1} x2={lx2} y2={ly2}
          stroke={color}
          strokeWidth={Math.max(2, sw)}
          strokeLinecap="round"
        />
      );
    }
    default:
      return null;
  }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Always-mounted Fabric canvas (combined-tools) | SVG display + Fabric edit-on-demand | v2.0 (2026-04-10) | Phase 15 ports the math but renders through SVG, not a Fabric canvas. Tangent / curve / arrowhead all become SVG primitives. |
| Hardcoded `<polygon>` arrowhead in `renderLine` | `renderArrowhead` helper switching on `arrowheadStyle` | Phase 15 (this) | Replaces 5 lines (svgAnnotationRenderers.jsx:177-181) with a dispatch to the helper. Straight-line code path migrates too — uniformity. |
| `<line>` only for line/arrow rendering | `<line>` (straight) + `<path d="M Q">` (curved) branch in `renderLine` | Phase 15 (this) | New curved branch active only when `data.midpoint` is set AND >1 px from baseline. Straight branch byte-identical to v2.2. |
| Legacy arrow `type: 'group' { Line + Triangle }` (renderArrow at :209) | `type: 'line' + tool: 'arrow'` flat format (created by FabricDrawingCanvas:287-301) | Pre-v2.0 | Both formats coexist in saved data. Phase 15 modernizes via load-time upgrade per recommendation in Pitfall 7, OR continues to render legacy groups via the existing `renderArrow` (no curvature support for legacy data). |

**Deprecated/outdated:**
- Combined-tools curve interaction logic (TypeScript) — the `lineGeometry.ts` file. Already ported to `lineGeometry.js`; no further reference needed.
- Combined-tools `<canvas>`-based arrowhead rendering (`createArrowhead` returning Fabric objects). Replaced by the proposed `renderArrowhead` returning React/SVG.

## Open Questions

1. **Should the planner include the load-time upgrade for legacy `type: 'group'` arrows?**
   - What we know: Modern format is `type: 'line' + tool: 'arrow'` (FabricDrawingCanvas:287-301); legacy `renderArrow` at svgAnnotationRenderers.jsx:209 handles `type: 'group'`. Both exist in saved data (older annotations may use group format).
   - What's unclear: How much real-world saved data uses the group format. STATE.md doesn't enumerate.
   - Recommendation: Include a one-shot upgrade in the load adapter (`upgradeArrowGroupToFlatLine`). 10-line transform; mark with `data.migratedFromGroup: true` for audit. Defer if Plan A grows past task budget — fall back to keeping `renderArrow` unchanged and having Phase 15 features unavailable on legacy groups (acceptable per "Phase 15 only needs new arrows to support styles" reading of ARROW-04).

2. **`obj.midpoint` vs `obj.data.midpoint` — should the planner pick now?**
   - What we know: `'data'` is in CUSTOM_PROPS, so `obj.data.midpoint = {x, y}` round-trips for free. `obj.midpoint` would require adding `'midpoint'` to all 4 CUSTOM_PROPS arrays (FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, FabricTextCanvas). Same for `obj.arrowheadStyle` vs `obj.data.arrowheadStyle`.
   - What's unclear: Which sub-key the legacy `data.type === 'arrow'` and `data.arrowheadStyle` from PAL.jsx already use — `obj.data.arrowheadStyle` (per PAL.jsx:1190 + :4404 + :4522). Already established.
   - Recommendation: Use `obj.data.midpoint` and `obj.data.arrowheadStyle` to (a) avoid touching CUSTOM_PROPS in 4 files, (b) match the established PAL convention, (c) honor the CONTEXT.md "no FabricDrawingCanvas waiver" decision. **This question is essentially closed.**

3. **Should `renderLine`'s straight-arrow branch ALSO migrate to the new `renderArrowhead` helper, or stay hardcoded?**
   - What we know: Migrating unifies the 6 styles across straight + curved. Keeping hardcoded preserves byte-identical output for the existing SOLID_TRIANGLE case (no rasterizer surprises).
   - What's unclear: Whether snapshot-diffing will catch any sub-pixel rasterizer drift if the hardcoded `<polygon>` is replaced with the helper's `<polygon>` (same points formula, but emitted from a different function — should be byte-identical, verifiable via DOM snapshot test).
   - Recommendation: Migrate (DRY principle, single switch case). Verify via DOM-string snapshot in `tests/svgLineRenderer.test.mjs` — if any difference appears, that's a real bug to fix. Adds confidence that the dispatch helper works for the default style before Phase 16 ships the picker.

4. **Curved-path bbox: analytical vs `getBBox()`?**
   - What we know: Analytical bbox = `union(start, end, midpoint)` — cheap, deterministic, works pre-mount. `getBBox()` returns the tight bezier bbox including the bulge — more accurate but requires a rendered DOM element.
   - What's unclear: The visual difference. For most curves the difference is < 5 px (the bulge extends past the start/end/midpoint triangle by bezier curvature, which is mild for a quadratic).
   - Recommendation: Analytical (`union(start, end, midpoint)`). Good enough for hit-area + selection wrapper; skipping `getBBox()` avoids a DOM measurement. If UAT shows the bulge being unclickable past the analytical bbox, revisit — but a quadratic bezier through three points has a bbox extending at most `√2 / 2 * bulge_distance` beyond the triangle, which is small.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js native test runner (`node --test`) for pure unit tests; Playwright (debug/playwright.config.mjs) for interaction smoke tests; manual UAT for visual regressions |
| Config file | None for unit (`tests/*.test.mjs` glob); `debug/playwright.config.mjs` for Playwright; `package.json` test script |
| Quick run command | `npm test` (Node native, ~2-5s for unit baseline) |
| Full suite command | `npm test && npm run test:debug` (unit + Playwright) |
| Existing tests | `tests/calloutRenderer.test.mjs`, `tests/rotationInputHelpers.test.mjs`, `tests/svgTransformMath.test.mjs`, `tests/zoomController.test.mjs`, `tests/svgKeyboardHandlers.test.mjs`, `tests/calloutEditAdapter.test.mjs`, `tests/annotationVisibilityRules.test.mjs`, `tests/pdfAnnotationImporter.test.mjs` (1 pre-existing failure, out of scope per Phase 14) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINE-01 | Quadratic curve passes through midpoint at t=0.5 | unit | `node --test tests/lineGeometry.test.mjs --grep "passes through midpoint"` | NEW (Wave 0) |
| LINE-01 | `getCurvedPath` emits `M sx,sy Q cx,cy ex,ey` with correct control point | unit | `node --test tests/lineGeometry.test.mjs --grep "getCurvedPath format"` | NEW (Wave 0) |
| LINE-01 | `renderLine` emits `<path>` when `data.midpoint` set, `<line>` when absent | unit (DOM string) | `node --test tests/svgLineRenderer.test.mjs --grep "curved branch"` | NEW (Wave 0) |
| LINE-01 | Midpoint drag interaction creates curve via `useSVGInteraction` `'midpoint'` mode | smoke (Playwright) | `npm run debug:scenario "phase15-line-curve"` | NEW (Wave 1) |
| LINE-02 | `shouldSnapToLinear(midpoint, start, end, 10)` returns true within 10 px, false outside | unit | `node --test tests/lineGeometry.test.mjs --grep "snap threshold"` | NEW (Wave 0) |
| LINE-02 | Drag-back-to-near-straight clears `data.midpoint` on pointerup | smoke | `npm run debug:scenario "phase15-snap-to-straight"` | NEW (Wave 1) |
| LINE-02 | 1 px render hysteresis: `data.midpoint` set but `distance ≤ 1` renders `<line>` | unit | `node --test tests/svgLineRenderer.test.mjs --grep "render hysteresis"` | NEW (Wave 0) |
| LINE-03 | Endpoint drag preserves `data.midpoint` in absolute coords | unit | `node --test tests/useSVGInteraction-endpoint.test.mjs --grep "preserves midpoint"` (or pure helper extracted) | NEW (Wave 0) |
| LINE-03 | Endpoint drag triggers auto-revert when new geometry naturally collinear within 10 px | smoke | `npm run debug:scenario "phase15-endpoint-auto-revert"` | NEW (Wave 1) |
| ARROW-01 | `getCurveEndAngle` returns tangent direction at t=1 in degrees | unit | `node --test tests/lineGeometry.test.mjs --grep "tangent at t=1"` | NEW (Wave 0) |
| ARROW-01 | Curved arrow `<path>` + arrowhead rotated by `getCurveEndAngle` (DOM transform inspection) | unit (DOM string) | `node --test tests/svgLineRenderer.test.mjs --grep "curved arrow tangent"` | NEW (Wave 0) |
| ARROW-02 | Snap-to-straight returns arrowhead to linear `Math.atan2(dy, dx)` angle | unit (DOM string) | `node --test tests/svgLineRenderer.test.mjs --grep "snap returns linear tangent"` | NEW (Wave 0) |
| ARROW-03 | Arrow endpoint drag preserves midpoint AND auto-reverts on collinear (combo of LINE-03 + ARROW-01) | smoke | `npm run debug:scenario "phase15-arrow-endpoint-auto-revert"` | NEW (Wave 1) |
| ARROW-04 | All 6 `arrowheadStyle` enum values dispatch to correct SVG primitive | unit (DOM string per style) | `node --test tests/renderArrowhead.test.mjs` | NEW (Wave 0) |
| ARROW-04 | Fallback: missing `arrowheadStyle` → `tool === 'arrow' ? SOLID_TRIANGLE : NONE` | unit | `node --test tests/svgLineRenderer.test.mjs --grep "fallback style"` | NEW (Wave 0) |
| ARROW-04 | Persistence: `data.arrowheadStyle` survives Fabric `toJSON(CUSTOM_PROPS)` round-trip | unit | `node --test tests/lineArrowPersistence.test.mjs --grep "arrowheadStyle round-trip"` | NEW (Wave 0) |
| ARROW-04 | Six style visual rendering at multiple zoom levels (manual JSON edit + reload, screenshot) | manual UAT | Test PDF: `Package 2 - Rev 4 -- IC.pdf` Page 6 — write 6 curved arrows with each style in JSON, reload, screenshot at 50% / 100% / 200% zoom | manual |
| All | 113-test baseline + ~5 new Phase 15 smoke tests = 118 green | regression | `npm test && npm run test:debug` | EXISTS — Phase 14 baseline |
| All | Visual no-regression on existing straight lines/arrows (before/after Phase 15 screenshots diff) | manual UAT | Test PDF: `Package 2 - Rev 4 -- IC.pdf` Page 6 — capture screenshot at 50% / 100% / 200% BEFORE Phase 15 starts; re-capture after Phase 15 ships and pixel-diff | manual |

### Sampling Rate

- **Per task commit:** `npm test` (~2-5s, Node unit baseline + new Phase 15 unit tests)
- **Per wave merge:** `npm test && npm run test:debug` (full unit + Playwright suite)
- **Phase gate:** Full suite green + manual UAT visual snapshot diff (no straight-line regression) + manual JSON edit verifying all 6 arrowhead styles render at 50%/100%/200% zoom on Page 6

### Wave 0 Gaps

Files to create as part of Wave 0 BEFORE implementation:

- [ ] `tests/lineGeometry.test.mjs` — covers LINE-01, LINE-02, ARROW-01, ARROW-02. Tests:
  - `getCurvedPath` returns string starting with `M ${start.x},${start.y} Q `
  - `getPointOnCurve(start, end, midpoint, 0.5)` equals `midpoint` to 1e-9
  - `getControlPoint` returns `2*mid − 0.5*start − 0.5*end`
  - `getCurveEndAngle` returns expected angle for known input (e.g. `start=(0,0), end=(100,0), midpoint=(50,50)` → tangent at end pointing up-right at known angle)
  - `shouldSnapToLinear` returns true within 10 px, false at 11 px, configurable threshold
  - `distanceToLineSegment` returns 0 for point on line, returns perpendicular distance otherwise
  - Edge case: `start === end` (zero-length line)
- [ ] `tests/svgLineRenderer.test.mjs` — covers LINE-01, LINE-02, ARROW-01, ARROW-02, ARROW-04 fallback. Tests render output via React's `renderToStaticMarkup`:
  - Straight line (no `data.midpoint`) renders `<line>` element with no `<path>`
  - Curved line (`data.midpoint` set, distance > 1) renders `<path d="M Q">` with no `<line>`
  - Curved arrow renders `<path>` + arrowhead transform contains the curve-tangent angle string
  - Render hysteresis: `data.midpoint` set but distance ≤ 1 renders `<line>`, not `<path>`
  - Fallback style: `tool: 'arrow'` with no `arrowheadStyle` field renders SOLID_TRIANGLE polygon
  - Fallback style: `tool: 'line'` with no `arrowheadStyle` field renders no arrowhead
- [ ] `tests/renderArrowhead.test.mjs` — covers ARROW-04 (6 styles). Tests:
  - `NONE` returns null
  - `SOLID_TRIANGLE` returns `<polygon fill={color}>` with correct points + transform
  - `OPEN_TRIANGLE` returns `<polygon fill="none" stroke={color}>` same points
  - `OPEN_CIRCLE` returns `<circle r={headSize/2}>` at tip
  - `V_SHAPE` returns `<polyline>` with 3 points (arm1, tip, arm2)
  - `HORIZONTAL_LINE` returns `<line>` perpendicular to arrow direction
  - `headSize = max(8, sw * 3)` formula (NOT 12 — verify regression)
- [ ] `tests/lineArrowPersistence.test.mjs` — covers ARROW-04 round-trip. Test:
  - Create Fabric Line with `data: { midpoint: {x,y}, arrowheadStyle: 'vShape' }`
  - Call `.toJSON(CUSTOM_PROPS)` (CUSTOM_PROPS imported from FabricDrawingCanvas constants OR replicated)
  - Verify `data.midpoint` and `data.arrowheadStyle` present and correct in serialized output
  - Verify deep-clone via `JSON.parse(JSON.stringify(...))` preserves both fields (the same path the Phase 15 drag commit uses)
- [ ] Optional: extract pure helper(s) from `useSVGInteraction.js`'s endpoint/midpoint commit logic into `src/utils/lineDragMath.js` (deriving new `data.midpoint` from drag delta, deciding snap-revert) so the LINE-03 / endpoint-preserves-midpoint behavior is unit-testable without DOM. **Recommendation:** include — matches the Phase 14 pattern of pure data-spec helpers (`buildCalloutRenderSpec`).
- [ ] Playwright debug scenarios: 5 new scenarios under `debug/scenarios/phase15-*.mjs`. The Phase 14 Playwright debug pattern (per package.json `test:debug` script) is the model.
- [ ] BEFORE Phase 15 work begins: capture baseline screenshots of Page 6 of `Package 2 - Rev 4 -- IC.pdf` at 50% / 100% / 200% zoom showing existing straight lines and arrows. Store as `debug/baselines/phase15-pre/`. After Phase 15 ships, capture matching `debug/baselines/phase15-post/` and pixel-diff. Any non-zero diff on straight-line regions is a regression bug.

## Sources

### Primary (HIGH confidence — in-repo)

- `src/utils/lineGeometry.js` (192 LOC, all 9 exports) — math is pre-ported, verified against combined-tools.
- `src/components/Callout/types.js:9-25` — `ARROWHEAD_STYLES` enum + label map.
- `src/PageAnnotationLayer.jsx:347-470` — `createArrowhead` for all 6 styles in Fabric primitives.
- `src/utils/svgAnnotationRenderers.jsx:141-258` — existing `renderLine` + `renderArrow` (legacy group format).
- `src/components/SVGAnnotationLayer.jsx:1763-1806` — existing line-type endpoint handle render.
- `src/hooks/useSVGInteraction.js:452-491, :781-799, :962-986` — existing `'endpoint'` drag mode (template for `'midpoint'`).
- `src/hooks/useSVGInteraction.js:624-697, :915-925` — Phase 14 `'callout-part'` drag mode (most recent example of the four-place invariant).
- `src/components/FabricDrawingCanvas.jsx:25-31` — `CUSTOM_PROPS` includes `'data'` (confirms persistence is free).
- `src/components/FabricDrawingCanvas.jsx:243-263` — `commitShape` currently tags `tool` but not `arrowheadStyle` — confirms CONTEXT.md no-tag decision.
- `src/utils/svgBoundingBox.js:178-187, :270-296` — `getLineEndpoints` + `getLineBBox` (referenced for curved-bbox extension).
- `.planning/phases/15-line-arrow-curvature-arrowhead-styles/15-CONTEXT.md` — locked decisions.
- `.planning/REQUIREMENTS.md` LINE-01..03 + ARROW-01..04.
- `.planning/ROADMAP.md` Phase 15 section (lines 205-235).
- `CLAUDE.md` Always-Protected list + CRITICAL rules.

### Secondary (MEDIUM confidence)

- `tests/calloutRenderer.test.mjs` — Wave 0 test pattern reference (Phase 14 establishes testing through pure data-spec helpers due to `node --test` not loading `.jsx`).
- `tests/svgTransformMath.test.mjs` — pure-helper unit-test pattern for `lineGeometry.js` tests.
- `package.json:scripts.test` — `node --test tests/*.test.mjs` confirms framework choice.
- `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/14-CONTEXT.md` — four-place invariant pattern (referenced by Phase 15 CONTEXT).

### Tertiary (LOW confidence — flagged for validation)

- Combined-tools repo location: appears to have been moved to `/Users/isaiahcalvo/.Trash/combined-tools` (no longer at `~/Desktop/combined-tools`). Math is already ported, so this is informational only — Phase 15 does not need to re-read combined-tools sources. Flagged here in case the planner needs to confirm a corner case in the original TypeScript.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every dependency is in-repo and inspected.
- Architecture: **HIGH** — patterns templated by 3+ existing precedents (Phase 12 endpoint, Phase 14 callout-part, Phase 12 rotation).
- Pitfalls: **HIGH** — bezier-control-point pitfall is a textbook trap with the prevention already encoded in `getControlPoint`. Other pitfalls are derived from concrete file inspection.
- Geometry of 6 styles: **HIGH** — verbatim port from existing Fabric implementation; only the primitive language changes.
- Validation Architecture: **HIGH** — test framework + sampling rate + Wave 0 gap list grounded in actual `tests/` directory inspection.

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days — codebase is stable, Phase 14 just shipped, no active concurrent refactors expected on `lineGeometry.js`, `Callout/types.js`, or the line-type SVG render branch)
