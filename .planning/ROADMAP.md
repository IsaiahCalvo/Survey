# Roadmap: Zoom Flicker Fix -- Direct Child Canvas

## Overview

This refactor replaces the freeze/snapshot/confirm-pending portal system with a direct-child overlay model where annotation canvases live inside Syncfusion's page divs and scale with CSS transforms during zoom. The build follows a strict sequential order dictated by hard architectural dependencies: overlay divs must exist before anything can use them, zoom handling must work before the render loop can be rewritten, PAL simplification must precede re-attachment logic, and dead code removal must be last. Each phase delivers a testable capability, and the final result is annotations that stay visible and correctly positioned during all zoom operations.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Overlay Attachment Foundation** - Create persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- [ ] **Phase 2: Zoom Handler** - Apply CSS transforms to overlay divs during zoom for visual stability across all 6 zoom methods
- [ ] **Phase 3: Render Loop Rewrite** - Replace portal host resolution with direct portal creation into persistent overlay divs
- [ ] **Phase 4: PAL Zoom Simplification** - Simplify PageAnnotationLayer zoom handling to own the settle/redraw/transform-removal sequence
- [ ] **Phase 5: Page Container Re-attachment** - Detect Syncfusion page div recreation and re-attach overlay divs with coordinate recalculation
- [ ] **Phase 6: Dead Code Removal** - Remove freeze/snapshot/confirm-pending machinery (~30 refs, ~14 functions)

## Phase Details

### Phase 1: Overlay Attachment Foundation
**Goal**: Persistent overlay divs exist as direct children of Syncfusion page divs, ready to serve as portal targets
**Depends on**: Nothing (first phase)
**Requirements**: OVLY-01
**Success Criteria** (what must be TRUE):
  1. Each visible page has an overlay div that is a direct child of its Syncfusion `e-pv-page-div` element
  2. Overlay divs are styled `position:absolute; width:100%; height:100%; pointer-events:none; z-index:20` and visually overlay the PDF page
  3. Overlay divs are stored in `overlayDivsRef` and never recreated for the same page number (create-once guard)
  4. Existing annotation rendering still works (no regression from adding overlay divs)
**Plans:** 1/1 plans complete

Plans:
- [ ] 01-01-PLAN.md -- Add overlay divs to App.jsx and verify with Playwright e2e test

### Phase 2: Zoom Handler
**Goal**: Annotations stay visually stable (blurry but present, never disappearing or jumping) during all zoom operations
**Depends on**: Phase 1
**Requirements**: OVLY-02, ZOOM-03, ZOOM-04, ZOOM-05, ZOOM-06, ZOOM-07, ZOOM-08, ZOOM-10
**Success Criteria** (what must be TRUE):
  1. During any of the 6 zoom methods (ctrl+scroll, toolbar buttons, dropdown, fit-to-page, fit-to-width, pinch), annotations remain visible and positioned correctly relative to the PDF content (may be blurry)
  2. CSS `transform: scale(ratio)` with `transform-origin: top left` is applied to overlay divs during zoom transition
  3. Rapid consecutive zoom actions (e.g., scrolling the mouse wheel quickly through multiple zoom levels) do not leave stuck transforms or stale visual state
  4. Pointer events are disabled on annotation canvases during the active CSS transform phase (prevents coordinate corruption)
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Create Playwright E2E test suite for zoom handler CSS transforms
- [ ] 02-02-PLAN.md -- Implement overlay zoom transform system (refs, functions, wiring into 3 zoom entry points) + manual pinch verification

### Phase 3: Render Loop Rewrite
**Goal**: React portals render annotation layers into persistent overlay divs with correct scale computation
**Depends on**: Phase 2
**Requirements**: ZOOM-01, ZOOM-02
**Success Criteria** (what must be TRUE):
  1. Annotations never disappear during zoom (portal content stays mounted because portal target is stable)
  2. Annotations never jump to wrong location or size during zoom (layerScale frozen to pre-zoom value while CSS transform is active)
  3. Portal creation is limited to annotated and visible pages (no unbounded memory growth)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: PAL Zoom Simplification
**Goal**: PageAnnotationLayer owns the post-zoom sequence: canvas redraw at correct resolution, CSS transform removal, and pointer event restoration
**Depends on**: Phase 3
**Requirements**: ZOOM-09, OVLY-04, PRES-01, PRES-02, PRES-03, PRES-04, PRES-05
**Success Criteria** (what must be TRUE):
  1. After zoom settles, canvas redraws at the new resolution and annotations appear crisp (not blurry)
  2. Drawing tools (pen, shapes, callouts, regions) work correctly at the new zoom level -- strokes land where the cursor is
  3. Search highlights are visible and positioned correctly at all zoom levels
  4. Undo/redo works after zoom operations
  5. Pan/scroll proxy rendering (LightweightAnnotationOverlay) still works at all zoom levels
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Page Container Re-attachment
**Goal**: Overlay divs survive Syncfusion page div destruction/recreation cycles without losing annotation state or breaking pointer coordinates
**Depends on**: Phase 4
**Requirements**: OVLY-03, OVLY-05
**Success Criteria** (what must be TRUE):
  1. After zooming causes Syncfusion to destroy and recreate a page div, the overlay div is re-attached and annotations are visible on that page
  2. After re-attachment, annotation selection and drawing tools produce correct coordinates (Fabric.js calcOffset and setCoords called)
  3. No console errors during zoom operations that trigger page div recreation
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Dead Code Removal
**Goal**: All freeze/snapshot/confirm-pending machinery is removed, leaving a clean codebase with no orphaned references
**Depends on**: Phase 5
**Requirements**: CLEN-01, CLEN-02, CLEN-03, CLEN-04
**Success Criteria** (what must be TRUE):
  1. ~30 freeze/snapshot/confirm-pending refs are removed from App.jsx with zero remaining references to them
  2. ~14 freeze/snapshot/confirm-pending functions are removed from App.jsx with zero remaining call sites
  3. Dead props (onScaleApplied, presentationApiRegistry, isHidden) are removed from PageAnnotationLayer
  4. All 6 zoom methods still work after removal (no regression from removing old code paths)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Overlay Attachment Foundation | 1/1 | Complete   | 2026-03-18 |
| 2. Zoom Handler | 2/2 | Complete | 2026-03-18 |
| 3. Render Loop Rewrite | 0/? | Not started | - |
| 4. PAL Zoom Simplification | 0/? | Not started | - |
| 5. Page Container Re-attachment | 0/? | Not started | - |
| 6. Dead Code Removal | 0/? | Not started | - |
| 7. Widen Zoom Range | 0/? | Not started | - |

### Phase 7: Widen Zoom Range

**Goal:** Remove the 50%-500% clamp restriction from zoomController.js so all zoom methods (toolbar, trackpad pinch, dropdown, fit-to-page, fit-to-width) can zoom to Syncfusion's native range. Ensure CSS transform dimension-locking works at extreme zoom levels.
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 7 to break down)
