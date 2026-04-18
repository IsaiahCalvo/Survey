# Phase 19: AutoCAD Window + Crossing Selection — Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the user an AutoCAD-style marquee on the live SVG selection surface. Dragging from empty space draws a box whose direction determines the mode:

- **Left → right** = **Window** selection. Box is solid blue. Only annotations **fully enclosed** by the box become selected on release.
- **Right → left** = **Crossing** selection. Box is dashed green. Any annotation the box **touches or intersects** becomes selected on release.

Delivers the visual marquee, the direction detection, the two hit-test modes, modifier-aware selection replacement/extension, and integration with the existing SVG selection state. Re-uses the existing rectangle-intersection geometry math without modifying it.

Out of scope: lasso/freehand selection, cross-page selection, selecting while the pan tool is active, Alt-to-subtract modifier behavior, mini-toolbar integration, and anything that touches the callout parallel session's edit/resize flows.

</domain>

## Acceptance Criteria

- **Given** the Select tool is active and the drag starts on empty SVG space, **when** the user drags from left to right and releases, **then** a solid blue marquee shows during the drag and only annotations fully contained inside the marquee are selected on release.
- **Given** the Select tool is active and the drag starts on empty SVG space, **when** the user drags from right to left and releases, **then** a dashed green marquee shows during the drag and every annotation whose geometry the marquee intersects is selected on release.
- **Given** an existing selection, **when** the user completes a new marquee drag without holding Shift, **then** the new result replaces the prior selection.
- **Given** an existing selection, **when** the user holds Shift and completes a new marquee drag, **then** the new hits are added to the prior selection (union).
- **Given** a marquee drag in progress, **when** the user reverses horizontal direction mid-drag, **then** the marquee color and dash switch live to match the new direction.
- **Given** a drag shorter than 5 px in both width and height, **when** the user releases, **then** the marquee is discarded and the release is treated as a normal single click (no selection change from the marquee).
- **Given** the drag starts on an existing annotation rather than empty space, **when** pointerdown fires, **then** the marquee does not appear and existing click-to-select behavior runs unchanged.
- **Given** the drag crosses into another PDF page region, **when** the user keeps dragging, **then** the marquee stays bounded to the page where the drag started and only annotations on that page are candidates.
- **Given** a callout exists on the page, **when** the marquee encloses it (window) or intersects it (crossing), **then** the callout is selected using the same rules as any other annotation.
- **Given** a marquee drag in progress, **when** the user presses Escape, **then** the marquee is cancelled and no selection change occurs.
- **Given** any tool other than Select is active, **when** the user drags on empty SVG space, **then** no marquee appears and the tool's normal drag behavior runs unchanged.

## DO NOT CHANGE

Project-wide protected files from `CLAUDE.md` that this phase may NOT modify without an explicit waiver:

- `src/App.jsx` — main file / zoom logic / portal host resolution. Out of scope.
- `src/components/PageAnnotationLayer.jsx` — Fabric canvas overlay. The dormant AutoCAD code living here is a **reference implementation only**. Do not re-enable, re-wire, or edit its selection handlers.
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx` / `FabricTextCanvas.jsx` — edit-mode canvases. Selection marquee never mounts here.
- `src/utils/geometryHitTest.js` — the hit-test math library. **Re-use as-is via an adapter. Do not modify.**
- `package.json` / `vite.config.js` — infra. No changes.

Protected files this phase **owns and may modify** (explicit waiver granted):

- `src/components/SVGAnnotationLayer.jsx` — needs a new marquee render element plus pointer wiring on the SVG root. Waiver scope: marquee render + empty-space pointer handlers + selection integration. No changes to zoom viewBox logic, imported-shape rendering, or existing pointer contracts for annotation hit zones.

New files this phase creates:

- `src/utils/svgToFabricShape.js` — thin adapter that maps an SVG-layer annotation object into a shape signature the existing `geometryHitTest.js` helpers understand. Read-only pass-through, no math.
- `src/hooks/` may grow a small marquee state helper if the SVG interaction hook becomes unwieldy; planner decides.

<decisions>
## Implementation Decisions

### Direction detection
- Pure horizontal comparison: `endX >= startX` means Window (blue), otherwise Crossing (green).
- Direction is re-evaluated on every pointermove, not just at release. If the user reverses, the marquee color and dash update live.
- Final direction at release is what picks the hit-test mode.

### Window hit-test (Left → right, blue solid)
- Use each annotation's axis-aligned bounding box. If every edge of the bounding box is inside the marquee rectangle, the annotation is selected.
- No per-geometry probing needed for Window mode. If the bounding box is fully enclosed, the geometry is by definition enclosed.

### Crossing hit-test (Right → left, green dashed)
- Fast reject: if the annotation's bounding box does not overlap the marquee, skip.
- If bounding boxes overlap, call the existing `doesRectIntersectObject` helper from the geometry library. Use its verdict as the final answer.
- Annotations pass through the new `svgToFabricShape` adapter so the helper sees a shape signature it already knows how to handle (rect, circle/ellipse, line, textbox, polyline, triangle, path, group).

### Visual treatment
- Window marquee: fill `rgba(0, 100, 255, 0.15)`, stroke `rgba(0, 100, 255, 0.8)`, 1 px solid, no dash.
- Crossing marquee: fill `rgba(0, 200, 100, 0.15)`, stroke `rgba(0, 200, 100, 0.8)`, 1 px stroke, dash pattern `[5, 5]`.
- Marquee renders as a single SVG `<rect>` on the SVG layer above annotation content but below the selection/hover overlay, with `pointer-events: none` so it never steals events from annotations under it.
- Values match the dormant reference code exactly. No visual tuning this phase.

### Modifier behavior
- Plain drag (no modifiers) → replace current selection with the marquee hits.
- Shift + drag → union the marquee hits with the current selection.
- No Cmd / Ctrl / Alt handling in this phase (deferred).
- Escape during drag cancels the marquee with no selection change.

### Tool-mode gating
- Marquee is active only when the current tool is `select`.
- Pan tool behavior is untouched — empty-space drags in pan mode continue to pan.
- Existing pan-mode quick-click selection behavior is untouched.

### Page boundary
- Marquee is captured by the page where pointerdown fired (same SVG page surface).
- The marquee rectangle is clamped to that page's viewBox coordinates while dragging.
- Only annotations on that page are candidates; cross-page marquee selection is explicitly deferred.

### Minimum drag threshold
- Drags shorter than 5 px in both width and height are treated as normal clicks.
- Threshold matches the reference implementation exactly.

### Callout participation
- Callouts are treated like any other shape. Window mode requires full enclosure of the callout's bounding box. Crossing mode uses the callout's existing geometry hit-test behavior.
- Do not port or re-create the reference implementation's special "select parent callout group" logic — the SVG layer already addresses callouts as single annotations, so no parent/child redirect is needed here.

### Selection state integration
- On marquee release, hits are turned into the existing `selectedIds` Set used by the SVG selection system. Replace or union per the modifier rules above.
- Empty result (no hits) with no modifier → clears the selection. Empty result with Shift held → leaves existing selection unchanged.
- Downstream repaint uses the existing selection-change plumbing — no new render path.

### Claude's Discretion
- Exact rendering layer z-order inside the SVG layer (kept above annotations, below hover/selection overlay).
- Whether marquee state lives inside the SVG interaction hook or in a tiny new helper — planner decides based on hook size/complexity.
- Cursor treatment during marquee drag (default vs crosshair).
- Whether to preview which annotations will be selected during the drag (e.g. hover glow on candidates) — default is "no live preview, only final selection on release" unless the planner sees a cheap way to add it.
- Specific debounce or throttling on pointermove if performance becomes an issue.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reference implementation (read-only — do not edit)
- `src/PageAnnotationLayer.jsx:7411-7854` — dormant AutoCAD marquee handlers on the Fabric canvas. Source of truth for direction detection, minimum-drag threshold, fill/stroke constants, and the replace-vs-union selection pattern. Reference only; the Fabric wiring does not apply to the SVG layer.
- `src/PageAnnotationLayer.jsx:45` — import of `doesRectIntersectObject`, showing the helper API already in use.

### Geometry math (re-use via adapter — do not edit)
- `src/utils/geometryHitTest.js` §1695-1820 — `doesRectIntersectObject` dispatcher and per-type crossing tests.
- `src/utils/geometryHitTest.js` §719-813 — rectangle-to-line-segment helper that underlies polyline, triangle, and stroked path tests.

### Target surface (this phase owns)
- `src/components/SVGAnnotationLayer.jsx` — where the new marquee element and pointer handlers go. Protected; waiver covers marquee render plus empty-space pointer wiring.
- `src/hooks/useSVGInteraction.js` — current home of the `selectedIds` Set and pointerdown/move/up contracts for SVG annotations. New marquee state attaches here (or in a small sibling helper at planner's discretion).

### Project rules
- `CLAUDE.md` → "Always Protected" — list of files this phase must respect or explicitly waive (see DO NOT CHANGE above).
- `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/*.md` — callout SVG render context, since callouts now live on the SVG layer.
- `.planning/phases/09-svg-selection-interaction/*.md` — original SVG click-to-select and multi-select design; establishes the `selectedIds` contract this phase integrates with.

No external ADRs — requirements are fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Dormant AutoCAD handlers (Fabric)** in `src/PageAnnotationLayer.jsx:7411-7854`: full direction detection, visual styling, min-drag threshold, and selection-replace logic. Read and mirror the logic; do not call from SVG.
- **`doesRectIntersectObject`** in `src/utils/geometryHitTest.js:1695`: already handles rect, circle, ellipse, line, polyline, triangle, path, textbox, and group. Re-use as-is for Crossing mode.
- **`selectedIds` Set + selection broadcast** in `src/hooks/useSVGInteraction.js`: existing multi-select state. Marquee result feeds into this, replacing or unioning per modifier.

### Established Patterns
- SVG viewBox owns all zoom scaling — coordinates for the marquee rectangle must be in SVG viewBox units (page-local), not screen px. Matches how existing annotations are positioned.
- Pointer events on the SVG layer are gated by tool mode. New empty-space handlers must respect the `tool === 'select'` check that governs current SVG click-to-select.
- React state for interaction lives in the SVG interaction hook; the SVG layer component consumes state via props. Marquee follows this shape.
- Shift-held multi-select already exists in the codebase via the `selectedIds` Set; the union math is straightforward to reuse.

### Integration Points
- **Pointerdown on SVG root** with `target === root` (empty space) and `tool === 'select'` is the entry point.
- **Marquee state** (start coords, current coords, direction, page number) lives alongside existing drag/hover state.
- **Release handler** runs hit-test via adapter → geometry helper → set `selectedIds` → clear marquee state.
- **Escape key** handler on window during marquee-active cancels the drag.

</code_context>

<specifics>
## Specific Ideas

- User built both this app and Survey-Experimental. Survey-Experimental has the working AutoCAD selection; Survey-BetaSafeS2 has the same code but it went dormant when the app moved to SVG display. The request is explicitly "port the feature" — match the existing behavior, don't reinvent it.
- "Either has to fully enclose or encompass an annotation for it to be selected, or it just has to cross it or come in contact with it." Exact AutoCAD semantics.
- Visual colors: blue for window, green for crossing. User reinforced both the visual and the behavior changes need to match.
- Shift + drag to add to selection was user-specified as a refinement beyond the original dormant code.

</specifics>

<deferred>
## Deferred Ideas

- Cross-page marquee — selecting annotations across multiple PDF pages in one drag. Non-trivial because each page is its own SVG with its own viewBox. Revisit after base marquee lands.
- Alt + drag to subtract from selection. Common AutoCAD modifier; skipped to keep this phase narrow.
- Cmd / Ctrl + drag semantics. No behavior specified; leave alone.
- Live selection preview during drag (hover glow on candidates before release). Claude's discretion flagged this; defer unless cheap.
- Deleting the dormant Fabric-layer AutoCAD handlers in `PageAnnotationLayer.jsx`. Dead code cleanup belongs in its own cleanup phase once the SVG version is proven.
- Marquee behavior while a shape is in edit mode. Edit mode is a single-shape focus; dragging empty space during edit probably shouldn't marquee. Planner will sanity-check, but the explicit rule is deferred.
- Audit of other features left behind by the v2.0 migration (eraser wiring check, keyboard shortcut audit). User explicitly deferred this audit — track separately, not in this phase.

</deferred>

---

*Phase: 19-autocad-window-crossing-selection*
*Context gathered: 2026-04-17*
