# Requirements: Zoom Flicker Fix — Direct Child Canvas

**Defined:** 2026-03-17
**Core Value:** Annotations must stay visible and correctly positioned during all zoom operations

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Zoom Stability

- [ ] **ZOOM-01**: Annotations stay visible during all zoom operations (never disappear or flash out)
- [ ] **ZOOM-02**: Annotations stay positioned correctly during zoom (never jump to wrong location/size)
- [x] **ZOOM-03**: Ctrl+scroll wheel zoom works without annotation flicker
- [x] **ZOOM-04**: Toolbar zoom in/out buttons work without annotation flicker
- [x] **ZOOM-05**: Zoom percentage dropdown works without annotation flicker
- [x] **ZOOM-06**: Fit-to-page works without annotation flicker
- [x] **ZOOM-07**: Fit-to-width works without annotation flicker
- [ ] **ZOOM-08**: Pinch-to-zoom (trackpad) works without annotation flicker
- [ ] **ZOOM-09**: Canvas redraws at correct resolution after zoom settles (crisp, not blurry)
- [x] **ZOOM-10**: Rapid consecutive zooms handled gracefully (no stuck transforms or stale state)

### Overlay Architecture

- [x] **OVLY-01**: Canvas overlays are direct children of Syncfusion page divs (not via portal host system)
- [ ] **OVLY-02**: CSS transform: scale(ratio) applied to overlay divs during zoom transition
- [ ] **OVLY-03**: Overlay divs re-attach when Syncfusion destroys/recreates page divs
- [ ] **OVLY-04**: Fabric.js pointer events (drawing, selection) work correctly with CSS-transformed parent
- [ ] **OVLY-05**: Fabric.js calcOffset() called after every overlay div re-attachment

### Preservation

- [ ] **PRES-01**: Drawing tools (pen, shapes, callouts, regions) work correctly after zoom
- [ ] **PRES-02**: Search highlights visible and positioned correctly at all zoom levels
- [ ] **PRES-03**: Undo/redo works after zoom
- [ ] **PRES-04**: Pan/scroll proxy rendering (LightweightAnnotationOverlay) still works
- [ ] **PRES-05**: No console errors during any zoom operation

### Cleanup

- [ ] **CLEN-01**: Freeze/snapshot/confirm-pending refs removed (~30 refs)
- [ ] **CLEN-02**: Freeze/snapshot/confirm-pending functions removed (~14 functions)
- [ ] **CLEN-03**: Dead props removed from PageAnnotationLayer (onScaleApplied, presentationApiRegistry, isHidden)
- [ ] **CLEN-04**: No orphaned code referencing removed refs/functions

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Zoom UX Enhancements

- **ZUXE-01**: Zoom-to-cursor centering (zoom focuses on mouse position)
- **ZUXE-02**: Animated zoom transitions (smooth scaling animation)
- **ZUXE-03**: Zoom history/undo (return to previous zoom levels)
- **ZUXE-04**: Adaptive settle timer (shorter for discrete zoom, longer for gesture zoom)

## Out of Scope

| Feature | Reason |
|---------|--------|
| SVG-based annotation rendering | Need Fabric.js for interactive annotation editing |
| Annotation data model changes | Only overlay attachment and zoom handling change |
| Syncfusion PDF viewer config changes | Viewer itself is not the problem |
| LightweightAnnotationOverlay changes | Only re-parented, not modified |
| SearchHighlightLayer changes | Only re-parented, not modified |
| Fabric.js canvas rendering optimization | Separate concern from zoom flicker |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ZOOM-01 | Phase 3 | Pending |
| ZOOM-02 | Phase 3 | Pending |
| ZOOM-03 | Phase 2 | Complete |
| ZOOM-04 | Phase 2 | Complete |
| ZOOM-05 | Phase 2 | Complete |
| ZOOM-06 | Phase 2 | Complete |
| ZOOM-07 | Phase 2 | Complete |
| ZOOM-08 | Phase 2 | Pending |
| ZOOM-09 | Phase 4 | Pending |
| ZOOM-10 | Phase 2 | Complete |
| OVLY-01 | Phase 1 | Complete |
| OVLY-02 | Phase 2 | Pending |
| OVLY-03 | Phase 5 | Pending |
| OVLY-04 | Phase 4 | Pending |
| OVLY-05 | Phase 5 | Pending |
| PRES-01 | Phase 4 | Pending |
| PRES-02 | Phase 4 | Pending |
| PRES-03 | Phase 4 | Pending |
| PRES-04 | Phase 4 | Pending |
| PRES-05 | Phase 4 | Pending |
| CLEN-01 | Phase 6 | Pending |
| CLEN-02 | Phase 6 | Pending |
| CLEN-03 | Phase 6 | Pending |
| CLEN-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 after roadmap creation*
