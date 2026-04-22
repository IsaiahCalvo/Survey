# Architecture Research — v2.2 Rotation Handle Polish

**Domain:** SVG annotation layer — rotation-handle integration polish
**Researched:** 2026-04-14
**Confidence:** HIGH (all claims verified against source at the cited line numbers)
**Scope:** Gap 3 (hover-intent stale ref) + Gap 4 (mtr handle clipped in edit mode) + Gap 2 (off-screen handle relocation). Subsequent-milestone polish, NOT a new feature build.

---

## TL;DR for the roadmapper

| Gap | Integration point | Files touched | LOC est. | Build order | Risk |
|-----|-------------------|---------------|----------|-------------|------|
| Gap 3 | `SVGAnnotationLayer.jsx` hover-intent `useEffect` dep array | 1 file | ~5 LOC | **First (independent)** | LOW — single effect, no new data flow |
| Gap 4 | `FabricEditCanvas.jsx` React-owned `containerStyle` + Syncfusion parent clip audit | 1–2 files | ~20–60 LOC depending on root cause | Third (needs live-DOM diagnostic before plan) | MEDIUM — container sizing interacts with zero-timer zoom invariant |
| Gap 2 | NEW util `handlePlacementMath.js` + `svgBoundingBox.js getHandlePositions` + `SVGSelectionOverlay.jsx` + `SVGAnnotationLayer.jsx` call sites | 3–4 files | ~80–120 LOC | Second (independent of Gap 3/4) | MEDIUM — pure math, unit-testable, but coordinates with connector-line render |

All three gaps are **architecturally independent** — no shared data-flow changes, no cross-gap prerequisites. Recommended serial order is by risk, not dependency.

**Boundary check:** None of the three gaps require edits to `App.jsx`, `PageAnnotationLayer.jsx`, or any file on the CLAUDE.md Always Protected list except `FabricEditCanvas.jsx` and `SVGAnnotationLayer.jsx` — both of which are on the list with the carve-out "Only touch when the phase explicitly owns …". The v2.2 phase explicitly owns rotation-handle polish, so those edits fall inside scope. The `zoomGeneration` signal contract is NOT touched by any proposed fix.

---

## Existing architecture recap (load-bearing invariants)

```
                ┌───────────────────────────────────────────┐
                │            SVGAnnotationLayer             │
                │  (per-page React component, display-only) │
                │                                            │
                │   <svg viewBox="0 0 pageW pageH">          │
                │     renderAnnotations(...)                 │
                │     <SVGSelectionOverlay>                  │
                │       <g data-rotation-handle="mtr">  <────┼── Gap 3 target element
                │     </SVGSelectionOverlay>                 │
                │   </svg>                                   │
                │   + Hover-intent useEffect (DOM listeners) │
                │   + <RotationInputField> (HTML portal)     │
                └───────────────────────────────────────────┘
                                 │
                                 │  (same overlay div, parent of <svg>)
                                 ▼
                ┌───────────────────────────────────────────┐
                │     FabricEditCanvas (mount-on-edit)       │
                │   React container div (overflow: visible   │
                │   for shape mode) → Fabric wrapperEl →     │
                │   lower-canvas + upper-canvas              │
                │   Container sized to                       │
                │   (annW + BBOX_PADDING*2) × (annH + ...)   │
                │   — tight to the shape's pre-rotation AABB │
                │   — mtr handle is at y = top - padding - 40│
                └───────────────────────────────────────────┘
```

### Load-bearing invariants (cannot break)

1. **SVG viewBox owns all zoom scaling** — `SVGAnnotationLayer.jsx:1002` sets `viewBox={`0 0 ${width} ${height}`}`; no JS coordinates scale. Any Gap 2 / Gap 4 fix must NOT reintroduce a zoom timer or JS zoom coordination.
2. **`zoomGeneration` signal** — read by `FabricEditCanvas.jsx` ~line 1907 to dismiss edit mode on zoom. Cannot be removed or renamed.
3. **Container-aware scale** — `FabricEditCanvas.jsx:890` reads `parentEl.offsetWidth / pageWidth` for `effectiveScale` (the 2026-03-22 fix). Any container resize fix for Gap 4 must preserve this measurement.
4. **RotationInputField portaled to `svgRef.current?.parentElement`** — NOT into `foreignObject` (SVGAnnotationLayer.jsx:1299-1310). Pill lives as an HTML sibling of the `<svg>`, not inside it.
5. **Full-click-cycle stopPropagation** on portaled UI (Plan 12-02 Round 7 fix) — any new cross-component pointer wiring must preserve this contract.
6. **`visualTransform.rotate` drag-wins invariant** — optimistic-paint pattern at `useSVGInteraction.js:835-855` must NOT be destabilized by off-screen relocation logic.

---

## Gap 3 — Hover-intent stale `handleEl` ref after edit→commit

### Root cause (confirmed at source)

**File:** `src/components/SVGAnnotationLayer.jsx:213-313`

The hover-intent `useEffect` has dependency array `[selectedIds, setRotInputVisibleDbg]` (line 313, deliberately excludes `rotInputVisible` for Issue 4 flicker fix).

The effect body at line 232 does:

```js
const handleEl = svgRef.current?.querySelector('[data-rotation-handle="mtr"]');
```

Then attaches `pointerenter` / `pointerleave` listeners to that element, and captures `handleEl` in the cleanup closure (lines 301-302).

**The DOM node it finds becomes stale during edit-mode transitions** because:

1. `editingAnnotationIndex` flips non-null on double-click → edit.
2. SVGAnnotationLayer.jsx:1049 computes `isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex`.
3. SVGAnnotationLayer.jsx:1234 passes `isGroupSelection={isBeingEditedNow}` to the `SVGSelectionOverlay`.
4. SVGSelectionOverlay.jsx:86 gates the handles block on `{!isGroupSelection && ...}` — so all 8 handles AND the `<g data-rotation-handle="mtr">` element **unmount from the DOM** during edit mode.
5. On click-off, `editingAnnotationIndex` returns to null. React reconciles; a **new** `<g data-rotation-handle="mtr">` node is created.
6. `selectedIds` did NOT change across that transition (the selection set survives edit mode). The effect's dep array saw no change. **The effect never re-ran**, so the old closure still references the unmounted node. No listeners on the new node.

The log evidence in `1.log` (referenced in `FEATURE-BACKLOG.md`) matches: "hover-intent effect RUN selectedIds.size=1 → attaching listeners to handleEl, but NO subsequent pointerenter on mtr fires on hover until after the deselect/reselect cycle."

### Options analysis

| Option | Cleanness | Risk | Survives future selection-overlay refactors? |
|--------|-----------|------|-----------------------------------------------|
| **A. Add `editingAnnotationIndex` to dep array** | Best (minimal diff) | LOW | Yes — React-level reconciliation trigger, declarative |
| B. Read `handleEl` fresh on each `pointerenter` via delegated listener | Cleaner but larger refactor | MEDIUM (pointerenter doesn't bubble — would need pointerover with boundary math) | Yes |
| C. MutationObserver on overlay root | Over-engineered for one use case | MEDIUM (MO on active DOM during 60fps drag) | Yes but with perf cost |
| D. Event delegation from `<svg>` root using `e.target.closest('[data-rotation-handle="mtr"]')` | Cleaner long-term | MEDIUM (need to migrate the pointerenter→pointerover contract, pointer-cancel edge cases) | Yes |

### Recommendation: **Option A + a subtle guard**

```js
// Current (line 313):
}, [selectedIds, setRotInputVisibleDbg]);

// Proposed:
}, [selectedIds, editingAnnotationIndex, setRotInputVisibleDbg]);
```

Plus one extra guard inside the effect body: if `editingAnnotationIndex != null`, early-return and clear timers. The handles don't exist during edit mode, so trying to attach to a non-existent element is wasted work AND the effect would log "handleEl NOT FOUND" which is noise.

**Why this is cleanest given the existing architecture:**

- Keeps the effect **declarative**: React already knows when edit state changes, use that signal.
- Preserves the Issue 4 flicker fix (rotInputVisible still NOT in deps — the ref pattern stays).
- Zero new surface area, zero new data flow, zero interaction with `useSVGInteraction`.
- The `setRotInputVisibleDbg` stable-callback contract is untouched.
- Does NOT touch `svgRef.current.querySelector` — so it's NOT at risk of the imperative DOM-reading pitfall that caused the Round 7 focus-loss hunt.

**Why NOT Option D (event delegation):** The current per-handle listener contract is scoped. Event delegation from `<svg>` would cross the interactive-vs-non-interactive boundary (line 140 `isInteractive`), which is load-bearing for FabricEditCanvas pointer routing. Any delegation change would need to re-validate against the `isInteractive` gate, and the payoff isn't large enough to justify the audit.

### Integration point

- **File:** `src/components/SVGAnnotationLayer.jsx`
- **Function/Hook:** the `useEffect` at line 213 with the `eslint-disable-next-line react-hooks/exhaustive-deps` comment
- **Existing helper to absorb logic:** none — this IS the logic
- **New components:** none
- **Data-flow changes:** none

### Acceptance test (for plan-phase)

**Given** a shape is selected and double-click enters edit mode,
**When** the user clicks off the shape to dismiss edit mode,
**Then** on hover over the rotation handle the pill appears within 150ms (the existing hover-intent delay), without requiring deselect + reselect.

### DO NOT CHANGE boundary (Gap 3)

- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx`
- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEraserCanvas.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/components/SVGSelectionOverlay.jsx`
- `src/hooks/useSVGInteraction.js`
- `src/components/RotationInputField.jsx` (load-bearing focus contract)
- `src/utils/zoomController.js`
- `vite.config.js` / `package.json`

Only `SVGAnnotationLayer.jsx` is in scope for Gap 3.

---

## Gap 4 — mtr handle clipped when pre-rotated shape enters edit mode

### Current state (confirmed at source)

**File:** `src/components/FabricEditCanvas.jsx`

Multiple layers of overflow handling already exist:

1. **React container** (lines 942-968): `overflow: editType === 'shape' ? 'visible' : undefined`. Shape mode explicitly sets `overflow: visible`.
2. **Fabric wrapperEl** (line 1661-1662): `wrapperEl.style.overflow = 'visible'` at the end of `loadShapeAnnotation`. "Allow handles to extend past the canvas during scaling" comment.
3. **BBOX_PADDING = 32** page units (line 83). Intended to give "full handle plus a safety margin" at the worst case zoom. Comment at lines 75-82 explicitly says 32 page-units gives ~42 CSS px at Electron normal. Rotation handle sits 40 page units above the bbox top (`svgBoundingBox.js:105`: `mtr: { x: left + width / 2, y: top - padding - 40 }`).

So a 32-unit padding ring + a 40-unit handle offset = handle center sits **8 page units above the React container's top edge** even at 0° rotation. With `overflow: visible` that works because the handle renders outside the container rect.

### Why Gap 4 fails at non-zero angles

The gap report explicitly says **"Does NOT happen at 0° rotation — only when shape is pre-rotated."** That's the key signal. Looking at the rotated-shape branch (lines 934-955):

```js
if (annAngle) {
  // Page-space CSS transform: replicates SVG's transformation chain
  style = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: annWidth + BBOX_PADDING * 2,
    height: annHeight + BBOX_PADDING * 2,
    zIndex: 101,
    pointerEvents: 'auto',
    overflow: editType === 'shape' ? 'visible' : undefined,
    transformOrigin: '0 0',
    transform: buildBboxTransform(sx, sy, annLeft, annTop, annWidth, annHeight, annAngle),
    visibility: 'hidden',
  };
  pageSpaceModeRef.current = true;
}
```

The container is `(annWidth + 64) × (annHeight + 64)` page units, then CSS-transformed into position via `buildBboxTransform` which applies `scale(sx, sy) × translate × rotate`. The rotation handle (in Fabric canvas-local coordinates) sits above the shape's bbox top — i.e. above the container's top edge.

**With `overflow: visible`** the browser SHOULD render the handle outside the rotated container. And within the container itself it does. **But the Syncfusion page-div ancestor has `overflow: hidden`** — PAL is a sibling and FabricEditCanvas's container gets portaled into the overlay div, which sits inside `e-pv-page-div`. At 0° rotation the `BBOX_PADDING*2` ring provides enough slack INSIDE the container for the handle to live; since the container itself is inside the page div without protruding, no ancestor clips it.

At non-zero rotation, the **rotated** container is still the same page-unit size, but the rotation handle — originally 40 page units ABOVE the shape's local top, inside the padding ring — gets rotated along with the container. For a shape near the top edge of the page, the rotated handle can project past the Syncfusion page-div top edge even though it remains inside the container's `overflow: visible` region. The ancestor `e-pv-page-div` clips it.

**Alternative root cause** (also worth investigating before committing to a fix): the Fabric wrapperEl's `position: absolute` + `top: 0 / left: 0` might place the handle in canvas-local coordinates that, under the CSS rotation transform, end up outside the PRE-transform container rect. If the browser applies `overflow: visible` in pre-transform space, the rotated handle could land outside the transformed outline which the CSS transform's new bounding rect covers.

### Options analysis

| Option | Respects zero-timer? | Risk | Notes |
|--------|---------------------|------|-------|
| **A. Expand `BBOX_PADDING`** from 32 to cover worst-case rotation AABB | YES | LOW-MED | The container becomes larger in both width AND height. Need to expand enough to cover a handle at any rotation, which means the padding must be ≥ 40 (the handle offset) + handle radius + safety margin ≈ 60 page units. Costs: (a) bigger click-through dead zone in the `mouse:down → commitAndClose` path at line 1864-1883 (comment at 1848-1855 flags this is ALREADY proportionally huge for tiny counter shapes); (b) bigger transform box affects the mini-toolbar's `toolbarPos` calculation. |
| **B. Audit + fix ancestor clip** (Syncfusion page div → overlay div → container) | YES | MED | Cleanest conceptually, but requires touching Syncfusion overlay-div CSS, potentially in App.jsx/PAL which are DO-NOT-CHANGE-heavy. Not recommended unless Option A + C fail. |
| **C. Keep SVG rotation handle VISIBLE behind Fabric** during edit mode instead of hiding it | YES | LOW | Currently SVGSelectionOverlay HIDES handles when `isGroupSelection=true` (= `isBeingEditedNow`). Flip that to "hide resize handles but keep mtr visible" and use the SVG handle as the grab target. The Fabric mtr control becomes a visual-only decoration (or gets hidden). |
| D. Portal Fabric canvas to document.body | NO-ish | HIGH | Breaks the container-aware sizing contract (`parentEl.offsetWidth / pageWidth` at line 890). Would need an entirely new portal-host resolution. Rejected. |
| E. Remove `overflow: hidden` from ancestor(s) | YES | HIGH | Syncfusion's page div is managed by the viewer, not our code. High-risk infrastructure touch. Rejected. |

### Recommendation: **Option C with Option A as fallback**

**Option C — "Keep SVG rotation handle visible during edit mode"**

Change SVGSelectionOverlay to accept a new prop `hideResizeHandlesOnly: boolean` (or refactor `isGroupSelection` into two separate booleans: `isGroupSelection` vs `isEditing`). When `isEditing=true`:

- Hide the 8 resize handles (they belong to Fabric during edit)
- KEEP the mtr rotation handle visible
- Users grab the SVG-rendered rotation handle, which lives inside the `<svg>` element that covers the full page and is NOT clipped by the tight FabricEditCanvas container.

**Why this is the best fix:**

- The root cause in Gap 4 is that **Fabric's rotation handle is inside a container that's tight to the shape's AABB**. The SVG rotation handle is NOT — it sits inside the page-wide `<svg>` element which covers the entire Syncfusion page div.
- Reuses existing code paths: SVGSelectionOverlay already renders the mtr handle exactly where it needs to go, and `useSVGInteraction`'s `handleHandlePointerDown` with `handleId === 'mtr'` already knows how to route it into the rotate branch (`useSVGInteraction.js:702`).
- Avoids growing `BBOX_PADDING` — which would bloat the click-through dead zone that's already proportionally huge for small shapes (comment at line 1848 flags this).
- **Bonus**: this also fixes an unreported inconsistency. Today, during shape edit mode, the user sees Fabric-rendered corner handles AND mini-toolbar. Rotation via Fabric's native mtr handle is separate from SVG's rotate branch — they look identical but the rotation commit path differs. Routing rotation through the SVG handle even during edit mode unifies the commit path.
- BUT this needs explicit hand-off design: during edit mode, the rotation drag should NOT trigger `editingAnnotationIndex → null` (exit edit mode). It should rotate the shape AND the FabricEditCanvas container's CSS transform needs to update to follow. The `useSVGInteraction` rotate branch already sets `visualTransform.rotate`, so the Fabric container's `buildBboxTransform` math needs to read that signal. This is not a trivial wire-up.

**Fallback: Option A if Option C's wire-up proves expensive.** Grow `BBOX_PADDING` from 32 to ~72. Accept the larger click-through dead zone. Update the `mouse:down → commitAndClose` empty-click heuristic at line 1864 to only dismiss when the click lands in the OUTER ring (beyond the old 32-unit boundary), preserving the old dismissal UX inside the original ring.

### Integration point

- **Option C:** `SVGSelectionOverlay.jsx` (accept `isEditing` prop) + `SVGAnnotationLayer.jsx` (pass prop when `isBeingEditedNow=true`) + verify `handleHandlePointerDown` works while `editingAnnotationIndex != null` + decide whether the rotation commit exits edit mode or updates the FabricEditCanvas's rotation transform live.
- **Option A (fallback):** `FabricEditCanvas.jsx:83` (BBOX_PADDING constant) + line 1864 dismissal heuristic.

### Pre-commit verification step for plan-phase

**Before touching any code, run a one-shot diagnostic in the running app:**

1. Select a pre-rotated shape near the top edge of the page.
2. Inspect the DOM element at the shape → find the ancestor chain up to `e-pv-page-div`.
3. For each ancestor, read `getBoundingClientRect()` and `window.getComputedStyle(el).overflow`.
4. Identify which ancestor's rect the handle visually gets clipped by.

This tells us definitively whether the clip is (a) the FabricEditCanvas container itself, (b) the overlay div, (c) `e-pv-page-div`, or (d) something farther up. **Option selection depends on this diagnostic** — the architecture research can identify candidates but the specific clipper needs live DOM inspection.

### Acceptance test (for plan-phase)

**Given** a shape that has been pre-rotated (e.g. 30°) and placed near the top-left edge of the page,
**When** the user double-clicks to enter edit mode,
**Then** the full rotation handle (circle + icon) is visible and grabbable, the mini-toolbar renders unclipped, and rotating via the handle updates both the shape angle and the edit-mode chrome together (or, if Option A, dismisses edit first).

### DO NOT CHANGE boundary (Gap 4)

- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx`
- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEraserCanvas.jsx`
- `src/hooks/useSVGInteraction.js` (Option A only; Option C needs the rotate-during-edit wire-up, which is a scope expansion)
- `src/utils/zoomController.js`
- `vite.config.js` / `package.json`

In scope for Gap 4: `FabricEditCanvas.jsx` (owned by rotation polish phase), `SVGSelectionOverlay.jsx` (Option C only), `SVGAnnotationLayer.jsx` (Option C only).

---

## Gap 2 — Rotation handle relocates to opposite side when off-screen

### Current state (confirmed at source)

**Handle placement formula:** `src/utils/svgBoundingBox.js:93-107` — `getHandlePositions(bbox, padding)` is a **pure function** that returns a static map of 9 handle positions computed from the unrotated bbox. `mtr` is hardcoded at `{ x: left + width / 2, y: top - padding - 40 }` — always 40 page units above the bbox top.

**Rotation application:** `src/components/SVGSelectionOverlay.jsx:65` — `transform={angle ? `rotate(${angle}, ${cx}, ${cy})` : undefined}` wraps the entire overlay group. So the mtr handle is rotated ALONG WITH the bbox around the shape center. For a shape near the page edge, after 90° rotation the mtr handle that was originally above the shape now projects beyond the page edge.

**Pill clamping:** `src/utils/rotationInputHelpers.js:159-166` — the pill already clamps to the host div with `EDGE_MARGIN = 4`. So when the handle goes off-screen, the pill stays visible but gets disconnected from the handle. The user can see the pill but can't grab the handle.

### Who knows "off-screen"?

- **SVGSelectionOverlay** knows: bbox in viewBox coords, rotation angle, handle offset math.
- **SVGAnnotationLayer** knows: viewBox (`0 0 pageWidth pageHeight`) which defines the visible page bounds.
- **RotationInputField** knows: host div bounding rect (screen space) — it's the only component that currently does edge-clamping against a real viewport rect.

**Key observation:** "off-screen" in the Gap 2 user story means "outside the Syncfusion page viewport", not "outside the viewBox of the currently-visible page." For a shape at page-bottom-left, the mtr handle in its natural position might be inside the page viewBox but outside what the user can see (e.g. clipped by the Syncfusion scroll container). However, the simplest and most-correct-by-default interpretation is "outside the page's own viewBox" — because that's what SVGSelectionOverlay can compute without touching scroll/viewport state.

**Recommendation:** Make the fix viewBox-relative, not viewport-relative. "Off-screen" = "the mtr handle point, after rotation, falls outside `[0, pageWidth] × [0, pageHeight]`." This keeps the function pure and testable, and for a rotated shape whose handle crosses the viewBox boundary, the user will see the relocated handle on the opposite edge regardless of scroll position.

### Architecture decision

Put the "flip to opposite side" logic into a **new pure utility module**: `src/utils/handlePlacementMath.js`.

```js
/**
 * Compute mtr handle position in viewBox coordinates, flipping to the
 * opposite side of the shape when the default position would land
 * outside the page viewBox.
 *
 * Pure function — no DOM, no React, unit-testable in isolation.
 *
 * @param {{left, top, width, height, angle}} bbox — shape bbox in viewBox coords
 * @param {number} pageWidth, pageHeight — viewBox dimensions
 * @param {number} [padding=2] — selection overlay padding
 * @returns {{ x: number, y: number, side: 'top'|'bottom'|'left'|'right' }}
 *   Handle position in UNROTATED viewBox coords (before the overlay's
 *   rotate() wrapper applies). `side` is the chosen anchor side.
 */
export function computeMtrHandlePosition(bbox, pageWidth, pageHeight, padding = 2) { /* ... */ }
```

### Integration flow

```
 SVGAnnotationLayer.jsx (owns pageWidth, pageHeight — already passed as props)
        │
        ▼
 SVGSelectionOverlay.jsx (accept new prop `pageWidth`, `pageHeight`)
        │
        ▼
 Replaces call at svgBoundingBox.js:105 with computeMtrHandlePosition(bbox, pageWidth, pageHeight)
 (getHandlePositions still owns the 8 resize handles — unchanged)
        │
        ▼
 Returns {x, y, side} instead of just {x, y}
        │
        ▼
 SVGSelectionOverlay renders:
   - connector line from the nearest side midpoint TO the handle
     (currently hardcoded to `handles.mt → handles.mtr`; generalize to
      `handles[side] → handles.mtr`)
   - circle + icon at new (x, y)
        │
        ▼
 RotationInputField pill placement — ALREADY works automatically because
 computeInputPosition reads the handle's screen rect via DOM query-selector
 (line 233) and computes the radial direction from shapeCenter → handle.
 No pill changes needed — relocation follows the handle automatically.
```

### Why this placement

- **Keeps `getHandlePositions` simple** — the 8 resize handles have no relocation story; only mtr does. Don't pollute `svgBoundingBox.js` with page-dimension awareness.
- **New utility is pure** — unit-testable in isolation (no React, no DOM). Wave-0 testable, same pattern as `snapAngleToNearest45` and `rotationInputHelpers.computeInputPosition`.
- **Zero cross-component state** — SVGSelectionOverlay receives `pageWidth`/`pageHeight` from SVGAnnotationLayer (which already has them). RotationInputField needs ZERO changes because it computes pill placement radially from the handle's actual screen rect, which naturally follows the relocated handle.
- **Preserves the rotation wrapper** — SVGSelectionOverlay's `transform={angle ? `rotate(...)` : undefined}` stays. The relocation is computed in the **pre-rotation** frame. The utility must account for the angle when deciding which side is "off-screen" because the handle's POST-rotation position is what actually gets clipped.

### Algorithm sketch

```
1. Compute the 4 candidate mtr positions (top, bottom, left, right)
   each offset 40 page units from the matching side midpoint.
2. For each candidate, apply the shape's rotation transform (rotate(angle, cx, cy))
   to get the post-rotation position in viewBox coords.
3. Pick the first candidate whose post-rotation position falls INSIDE
   [0, pageWidth] × [0, pageHeight] (plus a margin for the handle radius).
4. Prefer the natural "top" side when all 4 candidates are valid
   (no behavior change for non-edge shapes).
5. Return the candidate in UNROTATED frame, plus the `side` label so
   the connector-line renderer can draw from the matching midpoint handle.
```

### Edge cases for plan-phase to specify

- **All 4 sides off-screen** — shape larger than page viewBox. Fallback: use the top side anyway (current behavior). Document in CONTEXT.md.
- **Multi-select / group selection** — group union bbox has `angle: 0`, so relocation only matters for individual selection. Current fallback ("natural top") works.
- **Border-flush types** (rect, text, textbox, i-text) — `padding=0`. Algorithm works the same; handle offset is still 40 units from the bbox.
- **Angle mid-drag** — `visualTransform.rotate.angle` during drag is NOT persisted yet. SVGSelectionOverlay reads `bbox.angle` which is the live angle via `useSVGInteraction.js`'s `visualTransform` propagation. The relocation will shift side mid-drag, which could feel jittery. **Mitigation:** compute the side at drag-start (captured in `dragStateRef.current`) and hold it constant during the drag. Switch at drag-end.

### Integration point

- **NEW file:** `src/utils/handlePlacementMath.js` with `computeMtrHandlePosition(bbox, pageW, pageH, padding)` and its unit tests `handlePlacementMath.test.js`.
- **Modified files:**
  - `src/utils/svgBoundingBox.js` — minor: either add a new export alongside `getHandlePositions`, or leave unchanged and have SVGSelectionOverlay call the new util separately for mtr. Recommendation: leave `getHandlePositions` unchanged, keep mtr split into its own call site.
  - `src/components/SVGSelectionOverlay.jsx` — accept `pageWidth`, `pageHeight` props, call `computeMtrHandlePosition`, generalize the connector-line source from hardcoded `handles.mt` to `handles[side]`.
  - `src/components/SVGAnnotationLayer.jsx` — pass `pageWidth={width}`, `pageHeight={height}` to all 3 `<SVGSelectionOverlay>` call sites (lines 1229, 1255, 1279).

### Existing utility or hook that should absorb new logic

- `rotationInputHelpers.js` is NOT the right home — it's scoped to pill placement.
- `svgBoundingBox.js` is NOT the right home — it's scoped to bbox computation, and its public contract is "geometry, no page awareness".
- **Create a new pure module.** This matches the v2.1 precedent (`snapAngleToNearest45` in the svg-interaction helpers file, `computeInputPosition` in `rotationInputHelpers.js`) — small pure utilities colocated by feature, unit-testable without React.

### Suggested build order within Gap 2

1. Write `handlePlacementMath.js` + tests (Wave 0 — pure function, no React).
2. Wire into `SVGSelectionOverlay` (Wave 1 — changes render output only).
3. Pass props from `SVGAnnotationLayer` (Wave 1).
4. Manual UAT: rotate a shape near each of the 4 edges, verify the handle flips to the nearest visible side.

### Acceptance test (for plan-phase)

**Given** a rectangle placed at the top-left corner of the page with 0° rotation,
**When** the user rotates the shape until the mtr handle's post-rotation position would fall above the page top edge,
**Then** the mtr handle relocates to the bottom side of the shape (opposite the rotation direction's clipped side) and the pill follows to the new anchor — without the user having to move the shape.

**Given** a rectangle whose all 4 candidate handle positions fall inside the viewBox,
**When** the user selects it,
**Then** the mtr handle appears at the natural "top" position (no behavior change vs v2.1).

### DO NOT CHANGE boundary (Gap 2)

- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx`
- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEraserCanvas.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/hooks/useSVGInteraction.js` (pointer-event contract; rotation branch stays intact)
- `src/components/RotationInputField.jsx` (pill works automatically via radial-from-handle math — DO NOT modify)
- `src/utils/rotationInputHelpers.js` (pill placement is decoupled by design)
- `src/utils/zoomController.js`
- `vite.config.js` / `package.json`

In scope for Gap 2: `SVGSelectionOverlay.jsx`, `SVGAnnotationLayer.jsx`, `svgBoundingBox.js` (minimal), and the NEW `handlePlacementMath.js` + its test file.

---

## Build order with rationale

### Recommended: Gap 3 → Gap 2 → Gap 4

| Step | Gap | Rationale |
|------|-----|-----------|
| 1 | **Gap 3** | Tiny (~5 LOC dep-array fix + early-return guard). Gets a polish gap closed fast, restores user confidence that the rotation polish story is being finished. Zero risk to other gaps. |
| 2 | **Gap 2** | Independent from Gaps 3 and 4. New pure module + 3 file mods. Unit-testable at the boundary. Unblocks the most user-facing v2.2 feature (off-screen relocation). Touches SVGSelectionOverlay/SVGAnnotationLayer at the handle-placement seam — a surface that Gap 4 Option C would later want to touch too. Landing Gap 2 first clarifies what SVGSelectionOverlay's prop surface looks like, making Gap 4 Option C's prop additions consistent. |
| 3 | **Gap 4** | Highest risk. Needs the live-DOM diagnostic first to identify the actual clipper. Option C's wire-up is non-trivial and benefits from having Gap 2's SVGSelectionOverlay refactor already in place (same prop-surface conventions). Option A is the safe fallback if Option C proves expensive. |

**Alternative: Gap 3 → Gap 4 (Option A) → Gap 2** if the roadmapper wants to close all three CLAUDE.md "Always Protected" carve-outs (FabricEditCanvas) in a single surge before doing pure-utility work.

**Do NOT attempt parallel:** all three gaps touch SVGAnnotationLayer or SVGSelectionOverlay. Serialize to avoid merge conflicts in the rotation-polish surface.

---

## Cross-cutting architectural notes for plan-phase

### Test strategy (matches v2.1 precedent)

- **Wave 0 unit tests** for pure helpers:
  - Gap 2: `handlePlacementMath.test.js` — test each edge (top, bottom, left, right) at 0° / 45° / 90° / 135° / 180° / 225° / 270° / 315°. Test degenerate cases (shape at corner, shape larger than page).
  - Gap 3 and Gap 4 have no Wave 0 surface — they're integration fixes against DOM and rendered output.
- **Wave 1 integration**: manual UAT script in `12-*-UAT.md` style.
  - Gap 3: the exact sequence in `1.log` (select shape → double-click → click off → hover → expect pill).
  - Gap 4: pre-rotated shape at each edge orientation.
  - Gap 2: shape at each of 4 corners + 4 edges, rotate through full 360°.

### Session-moment discipline

Per `CLAUDE.md` project rules, any deliberate architectural choice during the plan-phase for v2.2 should be logged as a `DECISION` in the session-moments file. Specific items likely to produce session moments:

- Gap 4 Option selection (C vs A) after the live-DOM diagnostic.
- Gap 2 algorithm tie-breaker decisions (all 4 candidates invalid → fallback behavior).
- Any scope expansion from "3 gaps" to "gaps + related polish".

### RECONCILIATION.md requirement

Per CLAUDE.md: write `v2.2-phase/<phase>-RECONCILIATION.md` at phase close with "Acceptance Criteria Results", "Boundaries Honored", "Status: DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED". Phase 12 shipped DONE_WITH_CONCERNS due to Gaps 3/4 deferral — v2.2 closes the concerns.

---

## Integration summary for gsd-roadmapper

### New components

| Component | Purpose | Lines est. |
|-----------|---------|------------|
| `src/utils/handlePlacementMath.js` | Pure utility — compute mtr handle position with off-screen relocation | ~60 |
| `src/utils/__tests__/handlePlacementMath.test.js` | Unit tests — 8 rotation angles × 4 edges + degenerate cases | ~150 |

### Modified components

| File | Gap | Nature of change | Lines est. |
|------|-----|------------------|------------|
| `src/components/SVGAnnotationLayer.jsx` | Gap 3 | Add `editingAnnotationIndex` to hover-intent effect dep array + early-return guard | ~5 |
| `src/components/SVGAnnotationLayer.jsx` | Gap 2 | Pass `pageWidth`/`pageHeight` to 3 SVGSelectionOverlay call sites | ~3 |
| `src/components/SVGSelectionOverlay.jsx` | Gap 2 | Accept `pageWidth`/`pageHeight` props; call `computeMtrHandlePosition`; generalize connector-line source | ~15 |
| `src/components/SVGSelectionOverlay.jsx` | Gap 4 Option C | Accept `isEditing` prop OR split `isGroupSelection`; conditionally render mtr during edit mode | ~10 |
| `src/components/FabricEditCanvas.jsx` | Gap 4 Option A (fallback) | Grow `BBOX_PADDING` + adjust empty-click heuristic | ~15 |
| `src/components/FabricEditCanvas.jsx` | Gap 4 Option C | Suppress Fabric's native mtr control during edit OR coordinate with SVG rotation | ~30 |
| `src/utils/svgBoundingBox.js` | Gap 2 | Optional: minor refactor if mtr is split out of `getHandlePositions` | ~5 |

### Data flow changes

**None.** All three gaps are local fixes. No new cross-component state, no new reducers, no new context. The existing prop surface (`pageWidth`, `pageHeight`, `editingAnnotationIndex`, `selectedIds`, `bbox`, `angle`) covers everything Gap 2/3/4 need.

### CLAUDE.md Always Protected boundary check

| File | Gap 3 | Gap 4 | Gap 2 | Waiver needed? |
|------|-------|-------|-------|----------------|
| `src/App.jsx` | — | — | — | No — no proposed edits |
| `src/components/PageAnnotationLayer.jsx` | — | — | — | No |
| `src/components/FabricDrawingCanvas.jsx` | — | — | — | No |
| `src/components/FabricEraserCanvas.jsx` | — | — | — | No |
| `src/components/FabricEditCanvas.jsx` | — | YES | — | No — phase explicitly owns rotation-handle polish in edit mode |
| `src/components/SVGAnnotationLayer.jsx` | YES | maybe (Option C) | YES | No — phase explicitly owns rotation chrome |
| `src/utils/zoomController.js` | — | — | — | No — zoomGeneration signal untouched |
| `vite.config.js` / `package.json` | — | — | — | No |

**No protected-list waivers required.** v2.2 phase scope = "rotation handle polish", which is precisely the carve-out on the Always Protected list for `FabricEditCanvas.jsx` and `SVGAnnotationLayer.jsx`.

### Load-bearing contracts NOT touched by any fix

- `zoomGeneration` signal — untouched across all 3 gaps
- Container-aware scale measurement (`parentEl.offsetWidth / pageWidth`) — untouched
- SVG viewBox as the sole zoom mechanism — untouched (Gap 2's relocation computes in viewBox space without introducing JS zoom math)
- Full-click-cycle stopPropagation on RotationInputField — untouched (no pill changes for any gap)
- Optimistic-paint pattern (`visualTransform.rotate` + `applyOptimisticRotation`) — untouched
- v2.0 Phase 11 rasterizer delta (NOT fixable in JS) — irrelevant; no rendering changes

---

## Confidence assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Gap 3 root cause | **HIGH** | Confirmed at SVGAnnotationLayer.jsx line 232 + 313 + dep array analysis + SVGSelectionOverlay.jsx line 86 gate + log evidence in 1.log |
| Gap 3 recommended fix | **HIGH** | Single dep-array addition; zero new data flow; declarative React pattern |
| Gap 4 suspected clipper | **MEDIUM** | Strong hypothesis (Syncfusion ancestor clip OR browser overflow-in-transform quirk) but needs live-DOM diagnostic to confirm before choosing Option A vs C. WebFetch of React/Fabric.js docs would not resolve this — it's a layout-math question, not an API question. |
| Gap 4 Option C preference | **MEDIUM** | Architecturally cleaner but has a non-trivial wire-up (coordinated rotation during edit mode). Plan-phase should time-box Option C exploration before falling back to Option A. |
| Gap 2 algorithm | **HIGH** | Pure math, unit-testable, matches the v2.1 precedent for helper-module placement |
| Gap 2 integration seam | **HIGH** | SVGSelectionOverlay already receives bbox + inverseScale; adding pageW/pageH is a minimal prop-surface expansion |
| Build order | **HIGH** | Gap 3 is independent, Gap 2 unblocks Gap 4 Option C's refactor surface, Gap 4 risk-boxed last |
| DO NOT CHANGE boundary | **HIGH** | Explicit grep through CLAUDE.md Always Protected list; only in-scope files touched |

---

## Open questions for discuss-phase

1. **Gap 4 Option C scope** — does the user want rotation during edit mode to (a) exit edit first then rotate (simple), (b) rotate in place with the FabricEditCanvas container following via CSS transform (complex), or (c) rotate the shape but keep edit mode active only if the rotation stays inside the visible region? This is a UX decision, not a code decision.
2. **Gap 2 side-preference tiebreaker** — when two sides (e.g. top and left) are both valid post-rotation candidates, prefer the one closer to "above the shape in world space" (rotation-aware) or the one closest to the original top-side position (rotation-agnostic)? The former is more natural but slightly more complex math.
3. **Gap 2 viewport vs viewBox** — confirmed recommendation is viewBox-relative (pure math, testable). If the user reports "handle still off-screen when the page is partially scrolled out of view", that's a separate scroll-clamping issue — NOT the v2.2 scope, NOT a regression of Gap 2.
4. **Gap 4 diagnostic gate** — should plan-phase be blocked on a pre-plan DOM diagnostic run (10 minutes of live app inspection) before committing to Option A vs C? Recommended yes — it's cheap insurance.

---

*Architecture research for: v2.2 Rotation Handle Polish — subsequent-milestone polish integration*
*Researched: 2026-04-14*
*Downstream consumers: gsd-roadmapper, /gsd:plan-phase for v2.2*
