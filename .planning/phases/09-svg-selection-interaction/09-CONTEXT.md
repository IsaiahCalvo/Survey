# Phase 9: SVG Selection and Interaction - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can select, move, resize, and rotate annotations entirely in SVG without mounting a Canvas. This covers click-to-select, drag-to-move, resize handles, rotation, multi-select, and the double-click trigger for Canvas edit mode (actual Canvas mounting is Phase 10/11). Display-only SVG rendering from Phase 8 is the foundation.

</domain>

<decisions>
## Implementation Decisions

### Selection appearance
- Replicate existing Fabric.js handle design in SVG (consistency between SVG display and Canvas edit modes)
- **Bounding box:** Dashed blue outline (`#4a90e2`, `dasharray: 4,4`, 2px border scale factor) — matches current Fabric.js `borderColor` and `borderDashArray`
- **Corner handles (tl, tr, bl, br):** White filled circles, 14px, with subtle grey border (`#d1d1d1`) and drop shadow — matches `renderCornerWithShadow` in `fabricCustomization.js`
- **Mid-edge handles (mt, mb):** Horizontal pills (rounded rects), white with shadow — matches `renderPillControl`
- **Mid-edge handles (ml, mr):** Vertical pills, white with shadow — matches `renderVerticalPillControl`
- **Rotation handle (mtr):** 24px white circle with rotation icon, positioned 40px above top edge — matches `renderRotationControl`
- All handles remain constant size at all zoom levels (inverse-scale transform to compensate for viewBox scaling)
- **Hover state:** Subtle blue outline on hover (before click), plus `cursor: pointer` — signals annotation is clickable

### Drag & move behavior
- Constrain annotations to page bounds — cannot be dragged beyond page edges
- Direct movement — annotation itself moves in real-time following the cursor (no ghost/shadow at original position)
- Free movement only — no snap-to-grid, no snap-to-alignment (ADVN-02 snap-to-grid is a future requirement)
- Free resize by default, hold Shift to lock aspect ratio — matches current Fabric.js behavior

### Persistence & undo
- Changes commit to annotation JSON on drag/resize end (mouse release), not during drag
- During drag, only SVG visual position updates — no data mutation until release
- One undo checkpoint per completed move or resize operation — each completed interaction is one Ctrl+Z step
- Supabase sync debounced 2-3 seconds after local commit — reduces API calls during rapid repositioning
- Undo system unchanged — full-page snapshot approach (`undoHistory` state in App.jsx, 50-checkpoint cap)

### Claude's Discretion
- SVG event handling approach (native pointer events vs. React synthetic events)
- Transform math implementation (matrix calculations for resize, rotation)
- How to implement constant-size handles (SVG `transform` with inverse scale vs. recalculating pixel sizes)
- Multi-select implementation details (shift-click tracking, group bounding box calculation)
- Hit-testing approach for overlapping annotations (z-order, topmost wins)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SVG interaction requirements
- `.planning/REQUIREMENTS.md` — INTR-01 through INTR-10 define exact selection/interaction requirements
- `.planning/ROADMAP.md` — Phase 9 success criteria and dependency on Phase 8

### Existing handle design (must replicate in SVG)
- `src/utils/fabricCustomization.js` — Full handle styling: `configureFabricOverrides()` defines corner circles, pill controls, rotation handle with icon, selection border styling. Lines 192-283 are the critical reference.
- `src/assets/rotate-icon.svg` — Rotation handle icon asset (used by `renderRotationControl`)

### SVG display layer (Phase 8 foundation)
- `src/components/SVGAnnotationLayer.jsx` — 306-line display component with viewBox, three-layer filtering, annotation rendering. This is where selection visuals and pointer events will be added.
- `src/utils/svgAnnotationRenderers.jsx` — 435 lines of SVG rendering functions for all 7 annotation types

### Current undo system
- `src/App.jsx` — Lines ~14390-15118: `undoHistory` state, `handleUndo`, `saveAnnotationCheckpoint`. Full-page snapshot approach with 50-checkpoint cap. Phase 9 moves/resizes must create checkpoints via this existing system.

### Current annotation data flow
- `src/PageAnnotationLayer.jsx` — Lines ~5083-5092: How annotation prop changes sync to Canvas. Phase 9 needs the reverse: SVG interactions update annotation data which flows back to the parent.
- `src/services/documentAnnotationService.js` — Supabase sync functions. Phase 9 debounced sync should use existing patterns.

### Callout geometry
- `src/utils/calloutGeometry.js` — `calculateCalloutConnection()` for callout line/knee positioning. Relevant when moving/resizing callout annotations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `fabricCustomization.js`: Complete handle styling definitions — corner circle renderer, pill renderer, rotation renderer. SVG handles should visually match these Canvas renderers.
- `SVGAnnotationLayer.jsx` (306 lines): Phase 8 display component with viewBox auto-scaling, three-layer filtering. Selection overlay, hover states, and pointer event handlers will be added here.
- `svgAnnotationRenderers.jsx` (435 lines): Individual SVG rendering functions per annotation type. May need to expose bounding box data for hit-testing.
- `calloutGeometry.js`: Callout line geometry calculations — reusable when moving callout annotations.
- `undoHistory` system in App.jsx: Full-page snapshot undo with 50-checkpoint cap. Phase 9 must create checkpoints via `saveAnnotationCheckpoint` on move/resize end.

### Established Patterns
- Annotation data format: Fabric.js JSON with `objects[]` array. Each object has `left`, `top`, `width`, `height`, `scaleX`, `scaleY`, `angle`, `path`, etc. SVG interactions must update these same properties.
- Handle sizing: Fabric.js uses `cornerSize` property (12-24px depending on handle type). SVG handles need inverse-scale to stay constant size in viewBox coordinates.
- Three-layer filtering (space/module/region): Already in SVGAnnotationLayer from Phase 8. Selection must respect filtering — hidden annotations are not selectable.
- Supabase sync: Existing debounce patterns in `documentAnnotationService.js`. Phase 9 should follow same approach.

### Integration Points
- `SVGAnnotationLayer.jsx`: Primary integration point — add selection state, hover state, pointer event handlers, selection overlay rendering
- `App.jsx` undo system: Phase 9 must call into `saveAnnotationCheckpoint` when moves/resizes complete
- `App.jsx` annotation state: Moves/resizes must update `annotationsByPage` state so changes propagate to SVG layer and persistence

</code_context>

<specifics>
## Specific Ideas

- Handle design must match existing Fabric.js handles exactly (Drawboard-inspired: white circles at corners, pills at edges, rotation icon circle) — users should see consistent handles whether in SVG mode or Canvas edit mode
- Hover feedback: faint blue outline on annotation hover, cursor changes to pointer — helps discoverability on busy engineering drawings

</specifics>

<deferred>
## Deferred Ideas

- Snap-to-grid / snap-to-alignment during drag — tracked as ADVN-02 in future requirements
- Keyboard shortcuts for annotation operations (delete, copy, paste, nudge) — tracked as ADVN-01
- Annotation grouping/ungrouping — tracked as ADVN-03

</deferred>

---

*Phase: 09-svg-selection-interaction*
*Context gathered: 2026-03-24*
