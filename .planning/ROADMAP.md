# Roadmap: PDF Annotation App

## Milestones

- Shipped **v1.0 Zoom Flicker Fix** - Phases 1-3 (shipped 2026-03-19), Phases 4-7 superseded/deferred
- Current **v2.0 SVG Migration** - Phases 8-11 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Zoom Flicker Fix (Phases 1-7) - Phases 1-3 SHIPPED 2026-03-19</summary>

- [x] **Phase 1: Overlay Attachment Foundation** - Persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- [x] **Phase 2: Zoom Handler** - CSS transforms on overlay divs during zoom for visual stability (completed 2026-03-18)
- [x] **Phase 3: Render Loop Rewrite** - React portals render into persistent overlay divs (completed 2026-03-19)
- [ ] ~~**Phase 4: PAL Zoom Simplification**~~ - Superseded by SVG migration (4 failed attempts)
- [ ] ~~**Phase 5: Page Container Re-attachment**~~ - Superseded by SVG migration
- [ ] ~~**Phase 6: Dead Code Removal**~~ - Superseded by SVG migration
- [ ] ~~**Phase 7: Widen Zoom Range**~~ - Deferred to future milestone

</details>

### v2.0 SVG Migration (Phases 8-11)

- [ ] **Phase 8: SVG Display Foundation** - All 7 annotation types render as SVG with viewBox auto-scaling, replacing Canvas-based display
- [ ] **Phase 9: SVG Selection and Interaction** - Click-to-select, drag-to-move, resize handles, and multi-select in SVG without Canvas
- [ ] **Phase 10: Canvas Mount/Unmount (Pen + Eraser)** - Fabric.js Canvas mounts conditionally for pen/highlighter drawing and eraser operations
- [ ] **Phase 11: Text/Shape Editing + Zoom Cleanup** - Targeted Canvas mount for text/shape editing, zoom integration, and removal of old timer machinery

## Phase Details

### Phase 8: SVG Display Foundation
**Goal**: All committed annotations render correctly as SVG elements with browser-native zoom scaling via viewBox, replacing Canvas-based display rendering
**Depends on**: v1.0 Phase 3 (overlay div foundation -- already shipped)
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06, DISP-07, DISP-08, DISP-09, DISP-10, DISP-11
**Success Criteria** (what must be TRUE):
  1. User sees all 7 annotation types (pen strokes, highlights, lines, arrows, callouts, shapes, text) rendered on the PDF at correct positions -- visually matching the previous Canvas-based rendering
  2. User can zoom in/out using any method and annotations scale smoothly with zero disappearance, zero flicker, and zero JavaScript coordination
  3. Pen and highlighter strokes appear at exactly the correct position (pathOffset handling verified) -- no 50-200px offset errors
  4. Stroke widths on lines, shapes, and arrows remain constant thickness regardless of zoom level (non-scaling-stroke)
  5. Region/space filtering still works -- toggling a space or module shows/hides the correct annotations
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md -- SVGAnnotationLayer core + renderer toggle + tier 1 types (pen, highlights, lines, arrows)
- [ ] 08-02-PLAN.md -- Tier 2 types (shapes, text, callouts) + eraser rendering + full PAL-level filtering

### Phase 9: SVG Selection and Interaction
**Goal**: Users can select, move, and resize annotations entirely in SVG without mounting a Canvas
**Depends on**: Phase 8
**Requirements**: INTR-01, INTR-02, INTR-03, INTR-04, INTR-05, INTR-06, INTR-07, INTR-08, INTR-09, INTR-10
**Success Criteria** (what must be TRUE):
  1. User can click an annotation to select it and see a visual highlight with 8 resize handles at corners and midpoints
  2. User can drag a selected annotation to move it, and the annotation stays at the new position after release
  3. User can drag resize handles to scale an annotation, and the annotation renders correctly at the new size
  4. User can select multiple annotations (shift-click), drag them as a group, and delete the group
  5. Double-clicking an annotation transitions to edit mode (the trigger point for Canvas mount in later phases)
**Plans**: 3 plans

Plans:
- [ ] 09-01-PLAN.md -- Utility modules + selection hook + SVGSelectionOverlay + wiring into SVGAnnotationLayer
- [ ] 09-02-PLAN.md -- Drag-to-move + resize handles + rotation handle
- [ ] 09-03-PLAN.md -- Multi-select (shift-click) + group drag/delete + double-click edit trigger

### Phase 10: Canvas Mount/Unmount (Pen + Eraser)
**Goal**: Fabric.js Canvas mounts only when the user activates pen, highlighter, or eraser tools, captures the work, and unmounts cleanly
**Depends on**: Phase 9
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-09, EDIT-10
**Success Criteria** (what must be TRUE):
  1. User selects the pen or highlighter tool, draws strokes on the page, switches to a different tool, and the strokes persist in SVG -- no Canvas remains mounted
  2. User selects the eraser tool, erases part of an existing annotation, switches tools, and the erased result persists in SVG correctly
  3. User switches tools rapidly (pen -> select -> eraser -> pen) and no strokes are lost, no stale Canvas elements remain in the DOM, and no console errors appear
  4. User is mid-stroke when zoom occurs, and the in-progress stroke is auto-committed before Canvas unmounts -- no data loss
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md -- useFabricCanvas hook + FabricDrawingCanvas (pen/highlighter) + App.jsx wiring
- [x] 10-02-PLAN.md -- FabricEraserCanvas (annotation loading + boolean path subtraction) + App.jsx wiring + full verification

### Phase 11: Text/Shape Editing + Zoom Cleanup
**Goal**: Text and shape annotations are editable via targeted Canvas mount, and all old zoom timer machinery is removed
**Depends on**: Phase 10
**Requirements**: EDIT-06, EDIT-07, EDIT-08, ZOOM-01, ZOOM-02, ZOOM-03, ZOOM-04, ZOOM-05, ZOOM-06, ZOOM-07, ZOOM-08
**Success Criteria** (what must be TRUE):
  1. User double-clicks a text annotation, edits the text content inline, clicks away, and the updated text appears in SVG -- Canvas disappears after commit
  2. User double-clicks a shape or callout, modifies its properties (color, stroke, size), and changes persist in SVG after commit
  3. User zooms while Canvas is mounted for editing, and the Canvas receives a CSS transform for visual stability then remounts at correct dimensions after settle
  4. All 6 zoom methods work with zero timer coordination -- no freeze, snapshot, confirm-pending, or settle timers remain in the codebase
  5. Dead props (onScaleApplied, presentationApiRegistry, isHidden) and the old 5-timer zoom system functions are fully removed from App.jsx and PageAnnotationLayer
**Plans**: 2 plans

Plans:
- [ ] 11-01-PLAN.md -- FabricEditCanvas component (text/shape/callout editing) + App.jsx edit mode wiring
- [ ] 11-02-PLAN.md -- Old 5-timer zoom system removal from App.jsx + dead prop cleanup from PAL + CLAUDE.md update

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Overlay Attachment Foundation | v1.0 | 1/1 | Complete | 2026-03-18 |
| 2. Zoom Handler | v1.0 | 2/2 | Complete | 2026-03-18 |
| 3. Render Loop Rewrite | v1.0 | 2/2 | Complete | 2026-03-19 |
| 4. PAL Zoom Simplification | v1.0 | - | Superseded | - |
| 5. Page Container Re-attachment | v1.0 | - | Superseded | - |
| 6. Dead Code Removal | v1.0 | - | Superseded | - |
| 7. Widen Zoom Range | v1.0 | - | Deferred | - |
| 8. SVG Display Foundation | v2.0 | 0/2 | Planning complete | - |
| 9. SVG Selection and Interaction | v2.0 | 0/3 | Planning complete | - |
| 10. Canvas Mount/Unmount (Pen + Eraser) | v2.0 | 2/2 | Complete | 2026-03-27 |
| 11. Text/Shape Editing + Zoom Cleanup | 1/2 | In Progress|  | - |
