# Roadmap: PDF Annotation App

## Milestones

- [x] **v1.0 Zoom Flicker Fix** — Phases 1-3 (shipped 2026-03-19), Phases 4-7 superseded/deferred
- [x] **v2.0 SVG Migration** — Phases 8-11 (shipped 2026-04-10) — [archive](milestones/v2.0-ROADMAP.md)
- [x] **v2.1 Shape Edit Polish & Foundation Wins** — Phase 12 (shipped 2026-04-14, DONE_WITH_CONCERNS) — [archive](milestones/v2.1-ROADMAP.md)
- [ ] **v2.2 Rotation Handle Polish** — Phase 13 (in progress, started 2026-04-14)

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

<details>
<summary>v2.1 Shape Edit Polish & Foundation Wins (Phase 12) — SHIPPED 2026-04-14 (DONE_WITH_CONCERNS)</summary>

- [x] **Phase 12: Shape Edit Polish** — Soft Shift-snap at 45° with 3° threshold (EDIT-11), rotation degree input field for exact angles (EDIT-12, delivered with 2 polish gaps), zoom floor lowered to 10% (ZOOM-09) (completed 2026-04-14)

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for full phase details, 3-plan breakdown, decisions, issues resolved/deferred, and carry-forward lessons.

</details>

### v2.2 Rotation Handle Polish

- [ ] **Phase 13: Rotation Handle Edit-Mode Polish** — Close out the two carry-forward Phase 12 gaps: hover pill re-arms after edit-mode click-off (EDIT-13) + rotation handle (mtr) stays fully visible when a pre-rotated shape enters edit mode (EDIT-14). Both fixes are SVG-side and lane-safe (zero counter-session conflicts).

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

### Phase 12 details archived

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for Phase 12's
full goal, dependencies, requirements, success criteria, 3-plan breakdown,
key decisions, issues resolved/deferred, and technical debt.

### Phase 13: Rotation Handle Edit-Mode Polish

**Goal**: Close out the rotation interaction story by fixing the two Phase 12 carry-forward gaps so the rotation handle and its hover pill behave correctly across every edit-mode entry/exit transition. Users should never need a deselect/reselect workaround to re-arm the pill, and a pre-rotated shape should never enter edit mode with a clipped rotation handle.

**Depends on**: Phase 12 (v2.1 — RotationInputField + optimistic-paint pattern + 113/113 test baseline)

**Requirements**: EDIT-13, EDIT-14

**Why a single phase with two plans (not two phases):** Both gaps live in the same narrow interaction surface — rotation handle chrome during edit-mode transitions on shapes selected in `SVGAnnotationLayer.jsx`. They share the same UAT grid (`{angle=0, angle=30} × {edit exit via click-off / Escape / Enter-commit}`), the same lane-safety profile (SVG-side fixes only, zero counter-session WIP touched), and the same regression baseline (113/113 v2.1 tests + Plan 12-02's 7-round focus-loss scenarios). Splitting into two phases would duplicate verification overhead with no isolation benefit. A single Phase 13 with one plan per requirement keeps the milestone surgical and the reconciliation trivial.

**Success Criteria** (what must be TRUE — all four verified by human UAT at both `angle=0` AND `angle=30` shapes):

  1. **Pill re-arms after every edit-mode exit path** — User selects a shape, double-clicks into edit mode, exits edit mode via click-off / Escape / Enter-commit (all three exit paths), hovers the rotation handle, and sees the typed-degree pill appear within the existing 150ms hover-intent window — without needing to deselect and reselect first. Verified for `editType='shape'` (rect, circle, ellipse) AND `editType='text'`.

  2. **Rotation handle visible on edit-mode entry for pre-rotated shapes** — User double-clicks a shape that already has a non-zero angle (verified at `angle=30`) and sees the full rotation handle (circle + connector + icon) rendered without clipping by any container or page-div ancestor. Visual-only visibility is sufficient; the handle does not need to be draggable in edit mode (rotation interaction is already provided by select-mode drag and the typed-degree pill). Verified for rect, circle, ellipse, and text edit modes.

  3. **No regressions to v2.1 baseline** — All 113/113 v2.1 tests remain green. Plan 12-02's 7-round focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) all still pass. The optimistic-paint pattern is preserved: `console.count` on the hover-intent effect body during a 2-second drag-rotate fires ≤3 times (never at 60fps).

  4. **Counter-session lane stays untouched** — Final commit set for Phase 13 includes ZERO files from the 7-file counter-session WIP allowlist. `git status` cross-check before every commit confirms `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, and `dist/index.html` are untouched by Phase 13's diffs.

**Plans**: 2 plans

Plans:
- [ ] **13-01-PLAN.md — EDIT-13 hover pill stale-ref fix (Gap 3)** — Modify the hover-intent `useEffect` in `SVGAnnotationLayer.jsx:213-313` so the rotation pill re-arms after any edit-mode exit path. Strategy A acceptable (add `editingAnnotationIndex` to dep array + early-return gate at effect top); Strategy B preferred (event delegation on stable SVG ancestor via `e.target.closest('[data-rotation-handle="mtr"]')`). Both must gate on `editingAnnotationIndex == null`. Preserves the load-bearing `eslint-disable react-hooks/exhaustive-deps` invariant by NOT adding tick-rate values (`annotations`, `visualTransform`) to the dep array. Files in scope: `src/components/SVGAnnotationLayer.jsx` only.

- [ ] **13-02-PLAN.md — EDIT-14 mtr handle visibility fix (Gap 4)** — Make pre-rotated shapes show a fully-visible rotation handle on edit-mode entry without touching `FabricEditCanvas.jsx` (counter-session lane). **MANDATORY FIRST STEP:** Run a live-DOM diagnostic in the running app — open a pre-rotated shape, walk the ancestor chain from the FabricEditCanvas container up through the Syncfusion `e-pv-page-div`, and read `getBoundingClientRect()` + `window.getComputedStyle(el).overflow` on every link to confirm WHICH clipper actually owns the symptom (Architecture research hypothesizes a Syncfusion `e-pv-page-div` ancestor; Pitfalls research confirms the canvas pixel buffer math; both may contribute). Diagnostic resolves which. Then implement Fix A / Architecture Option C: narrow the `SVGAnnotationLayer.jsx:1050` short-circuit so it returns null only when `editIsBorderFlush && angle === 0`, and render an mtr-only stripped overlay (no bbox, no resize pills) when `editIsBorderFlush && angle !== 0`. Add a new `isEditing` prop path through `SVGSelectionOverlay.jsx` for the mtr-only render branch. SVG handle is visual-only during edit mode (the SVG root has `pointerEvents: 'none'` while `isInteractive=false`); rotation in edit mode stays out of scope per PROJECT.md line 71. Files in scope: `src/components/SVGAnnotationLayer.jsx` (narrow `:1050` condition only — never delete) + `src/components/SVGSelectionOverlay.jsx` (new `isEditing` prop, mtr-only rendering path).

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 → 13

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
| 12. Shape Edit Polish | v2.1 | 3/3 | Complete | 2026-04-14 |
| 13. Rotation Handle Edit-Mode Polish | v2.2 | 0/2 | Not started | - |

---
*Last updated: 2026-04-14 — v2.2 milestone roadmap created. Phase 13 (Rotation Handle Edit-Mode Polish) defined with 2 plans (13-01 EDIT-13 hover-intent fix + 13-02 EDIT-14 mtr visibility fix). Both lane-safe (SVG-side only). Coverage 2/2 v2.2 requirements mapped. Ready for `/gsd:plan-phase 13`.*
