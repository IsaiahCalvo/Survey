# Roadmap: PDF Annotation App

## Milestones

- Shipped **v1.0 Zoom Flicker Fix** - Phases 1-3 (shipped 2026-03-19), Phases 4-7 superseded/deferred
- Shipped **v2.0 SVG Migration** - Phases 8-11 (shipped 2026-04-10)
- Current **v2.1 Shape Edit Polish & Foundation Wins** - Phase 12 (planning)

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

<details>
<summary>v2.0 SVG Migration (Phases 8-11) - SHIPPED 2026-04-10</summary>

- [x] **Phase 8: SVG Display Foundation** - All 7 annotation types render as SVG with viewBox auto-scaling, replacing Canvas-based display
- [x] **Phase 9: SVG Selection and Interaction** - Click-to-select, drag-to-move, resize handles, and multi-select in SVG without Canvas
- [x] **Phase 10: Canvas Mount/Unmount (Pen + Eraser)** - Fabric.js Canvas mounts conditionally for pen/highlighter drawing and eraser operations (completed 2026-03-27)
- [x] **Phase 11: Text/Shape Editing + Zoom Cleanup** - Targeted Canvas mount for text/shape editing, zoom integration, and removal of old timer machinery (completed 2026-04-02)

</details>

### v2.1 Shape Edit Polish & Foundation Wins (Phase 12)

**Milestone Goal:** Finish the shape editing interaction model started in the post-v2.0 cleanup branch — add rotation precision (soft Shift-snap + exact degree input) and extend the usable zoom range to 10% so shape editing feels complete before moving on to future foundation wins.

- [ ] **Phase 12: Shape Edit Polish** - Soft Shift-snap at 45° with 3° threshold, rotation degree input field for exact angles, zoom floor lowered to 10%

## Phase Details

<details>
<summary>v1.0 + v2.0 phase details (collapsed — shipped)</summary>

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
- [x] 08-01-PLAN.md -- SVGAnnotationLayer core + renderer toggle + tier 1 types (pen, highlights, lines, arrows)
- [x] 08-02-PLAN.md -- Tier 2 types (shapes, text, callouts) + eraser rendering + full PAL-level filtering

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
- [x] 09-01-PLAN.md -- Utility modules + selection hook + SVGSelectionOverlay + wiring into SVGAnnotationLayer
- [x] 09-02-PLAN.md -- Drag-to-move + resize handles + rotation handle
- [x] 09-03-PLAN.md -- Multi-select (shift-click) + group drag/delete + double-click edit trigger

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
- [x] 11-01-PLAN.md -- FabricEditCanvas component (text/shape/callout editing) + App.jsx edit mode wiring
- [x] 11-02-PLAN.md -- Old 5-timer zoom system removal from App.jsx + dead prop cleanup from PAL + CLAUDE.md update

</details>

### Phase 12: Shape Edit Polish
**Goal**: Shape rotation feels precise and predictable (soft Shift-snap to 45° when the user is near an increment, exact-value input for typed angles) and the usable zoom range extends down to 10% for whole-page inspection of mechanical/electrical drawings
**Depends on**: Phase 11 (SVG selection + `useSVGInteraction` rotation path, `FabricEditCanvas` edit infrastructure, zero-timer zoom system)
**Requirements**: EDIT-11, EDIT-12, ZOOM-09
**Success Criteria** (what must be TRUE):
  1. User can drag the SVG rotation handle on a selected shape with Shift held and the live angle soft-snaps to the nearest 45° increment (0°/45°/90°/135°/180°/225°/270°/315°) only when within 3° of that increment — Shift-at-41° stays free at 41°, Shift-at-44° snaps to 45°, Shift-at-23° stays free at 23°, and releasing Shift always returns to free rotation
  2. User sees an inline numeric degree input near the rotation handle while rotating a selected shape (and/or hovering the rotation handle), can type an exact angle, commits with Enter or blur to apply the rotation atomically, cancels with Escape, and typed values are normalized to [0, 360) before persisting
  3. User can zoom the PDF all the way down to 10% via every zoom entry point (toolbar buttons, keyboard shortcuts, scroll wheel, typed value in the zoom input box, fit-to-page, fit-to-width, pinch) without the app silently re-clamping the floor to 50%
  4. At zoom levels below 25% the selection/rotation handles remain visible but become hard to target — this is accepted table-stakes behavior (matches Illustrator/Photoshop); the user is expected to zoom back in to edit and no defect is recorded
  5. No existing behavior regresses: free rotation (Shift not held) still produces float angles, Shift+resize aspect-lock still works, every zoom method still funnels through `clampScale`, and the `zoomGeneration` signal contract is preserved
**Plans**: 2 plans

Plans:
- [ ] 12-01-PLAN.md — EDIT-11 soft Shift-snap (3° threshold) via new `snapAngleToNearest45` helper wired into `useSVGInteraction.js:391-408` + ZOOM-09 zoom floor 10% atomic bundle (`zoomController.js:15` MIN_SCALE 0.5→0.1 AND `App.jsx:21999` pre-clamp 50→10 in the SAME commit) + Wave 0 unit tests (snapAngleToNearest45 + clampScale boundary). 4 tasks, Wave 1, autonomous=false (1 user verify checkpoint), low risk.
- [ ] 12-02-PLAN.md — EDIT-12 rotation degree input field via new `RotationInputField` HTML portal component (locked architecture from CONTEXT/UI-SPEC: createPortal into the existing SVGAnnotationLayer-hosting overlay div, hover-intent + drag-override visibility state machine, integer-only typed values, Enter/Escape/blur commit semantics, Arrow-key nudging) + Wave 0 `rotationInputHelpers` module + parent wiring in SVGAnnotationLayer.jsx. 5 tasks, Wave 2 (depends on 12-01 for wave ordering and to keep regression baseline clean), autonomous=false (1 user verify checkpoint), moderate risk.

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Overlay Attachment Foundation | v1.0 | 1/1 | Complete | 2026-03-18 |
| 2. Zoom Handler | v1.0 | 2/2 | Complete | 2026-03-18 |
| 3. Render Loop Rewrite | v1.0 | 2/2 | Complete | 2026-03-19 |
| 4. PAL Zoom Simplification | v1.0 | - | Superseded | - |
| 5. Page Container Re-attachment | v1.0 | - | Superseded | - |
| 6. Dead Code Removal | v1.0 | - | Superseded | - |
| 7. Widen Zoom Range | v1.0 | - | Deferred | - |
| 8. SVG Display Foundation | v2.0 | 2/2 | Complete | 2026-04-10 |
| 9. SVG Selection and Interaction | v2.0 | 3/3 | Complete | 2026-04-10 |
| 10. Canvas Mount/Unmount (Pen + Eraser) | v2.0 | 2/2 | Complete | 2026-03-27 |
| 11. Text/Shape Editing + Zoom Cleanup | v2.0 | 2/2 | Complete | 2026-04-02 |
| 12. Shape Edit Polish | v2.1 | 0/2 | Not started | - |

---
*Last updated: 2026-04-13 — Phase 12 plans 12-01 and 12-02 finalized via /gsd:plan-phase 12*
