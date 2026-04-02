# Requirements: SVG Migration -- PDF Annotation App

**Defined:** 2026-03-23
**Core Value:** Annotations render correctly at all zoom levels with zero disappearance via SVG viewBox

## v2.0 Requirements

Requirements for SVG display + Fabric.js edit-only migration. Each maps to roadmap phases.

### SVG Display

- [x] **DISP-01**: All 7 annotation types (pen strokes, highlights, lines, arrows, callouts, shapes, text) render as SVG elements inside an SVGAnnotationLayer component
- [x] **DISP-02**: SVG viewBox matches PDF page dimensions (`viewBox="0 0 pageWidth pageHeight"`) and auto-scales with zoom -- no JavaScript zoom coordination needed
- [x] **DISP-03**: Fabric.js path objects render with correct pathOffset handling (`translate(-pathOffset.x, -pathOffset.y)`) so pen/highlighter strokes appear at correct positions
- [x] **DISP-04**: `strokeUniform: true` renders as SVG `vector-effect="non-scaling-stroke"` so stroke widths stay constant during zoom
- [x] **DISP-05**: Highlight annotations render with correct opacity and `mix-blend-mode: multiply` matching Canvas output
- [ ] **DISP-06**: Eraser clipPaths render correctly using `clip-rule="evenodd"` for hole subtraction
- [ ] **DISP-07**: Text annotations render via `<foreignObject>` with correct font family, size, weight, color, and word wrap
- [ ] **DISP-08**: Callout annotations render as SVG lines + rect + text (via `<foreignObject>`) with correct knee/endpoint positions
- [x] **DISP-09**: Arrow annotations render with correct arrowhead geometry (SVG `<polygon>` or `<marker>`)
- [ ] **DISP-10**: Region/space filtering works in SVG layer -- annotations show/hide based on spaceId, moduleId, regionId metadata
- [x] **DISP-11**: SVGAnnotationLayer replaces LightweightAnnotationOverlay as the primary annotation display component

### SVG Interaction

- [x] **INTR-01**: User can click an annotation in SVG to select it (visual selection highlight appears)
- [x] **INTR-02**: Selected annotation shows resize handles at corners and midpoints, rendered as SVG elements
- [x] **INTR-03**: Selection handles remain constant size during zoom (scale-compensated via `vector-effect` or inverse scale)
- [x] **INTR-04**: User can drag a selected annotation to reposition it in SVG (pointer events, no Canvas mount)
- [x] **INTR-05**: User can drag resize handles to scale an annotation in SVG
- [x] **INTR-06**: User can rotate an annotation via rotation handle in SVG
- [ ] **INTR-07**: User can select multiple annotations (shift-click or marquee) and see group selection highlight
- [ ] **INTR-08**: User can drag/delete multiple selected annotations as a group
- [x] **INTR-09**: Clicking empty space deselects all annotations
- [ ] **INTR-10**: Double-click on an annotation transitions to Canvas edit mode (mounts Fabric.js Canvas)

### Canvas Editing

- [x] **EDIT-01**: Pen/highlighter tool mounts a transparent Fabric.js Canvas over the entire page for stroke capture at 60fps
- [x] **EDIT-02**: Completed pen/highlighter strokes are serialized to Fabric.js JSON and committed to the SVG layer
- [x] **EDIT-03**: Canvas stays mounted while pen/highlighter tool is active, unmounts on tool switch
- [x] **EDIT-04**: Eraser tool mounts Canvas and loads all page annotations for boolean path intersection/subtraction
- [x] **EDIT-05**: Eraser results are serialized back to Fabric.js JSON and committed to SVG layer on tool deactivation
- [x] **EDIT-06**: Text double-click mounts a targeted Fabric.js Canvas sized to the annotation bounding box for IText editing
- [x] **EDIT-07**: Text edit commits on blur (click outside) -- Canvas unmounts, SVG updates with new text content
- [x] **EDIT-08**: Shape/callout double-click mounts a targeted Canvas for property editing (color, stroke, resize)
- [x] **EDIT-09**: Canvas auto-commits unsaved changes before unmounting (no data loss on tool switch or zoom)
- [x] **EDIT-10**: Canvas mount/unmount lifecycle uses React state + key prop for clean Fabric.js creation/disposal

### Zoom & Integration

- [x] **ZOOM-01**: SVG layer zoom is handled entirely by viewBox -- zero JavaScript timers for zoom coordination
- [x] **ZOOM-02**: If Canvas is mounted during zoom, it receives CSS transform for visual stability (blurry but positioned)
- [x] **ZOOM-03**: After zoom settles (200ms debounce), Canvas remounts at new dimensions if still active
- [x] **ZOOM-04**: In-progress pen stroke is auto-committed on zoom start, pen resumes after settle
- [x] **ZOOM-05**: All 6 zoom methods work (ctrl+scroll, toolbar buttons, dropdown, fit-to-page, fit-to-width, pinch)
- [x] **ZOOM-06**: Freeze/snapshot/confirm-pending machinery is removed from App.jsx (~30 refs, ~14 functions)
- [x] **ZOOM-07**: Dead props (onScaleApplied, presentationApiRegistry, isHidden) are removed from PageAnnotationLayer
- [x] **ZOOM-08**: Old 5-timer zoom system is fully replaced -- no PAL settle, App settle, confirm-pending, tier-2 defer, or overlay safety timers remain

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Performance Optimization

- **PERF-01**: SVG virtualization for pages with 500+ annotations (render only visible elements)
- **PERF-02**: Widen zoom range beyond 50%-500% clamp (deferred from v1.0 Phase 7)

### Advanced Interaction

- **ADVN-01**: Keyboard shortcuts for annotation operations (delete, copy, paste, nudge)
- **ADVN-02**: Snap-to-grid for annotation positioning
- **ADVN-03**: Annotation grouping/ungrouping

## Out of Scope

| Feature | Reason |
|---------|--------|
| Data model migration | SVG reads same Fabric.js JSON -- no format change needed |
| Syncfusion viewer changes | Viewer layer is unchanged |
| SearchHighlightLayer changes | Already DOM-based, independent of annotation layer |
| Real-time collaborative editing | Future milestone, requires conflict resolution |
| Mobile touch gestures beyond pinch zoom | Future milestone |
| SVG.js or interact.js libraries | DOM conflict with React's reconciliation model |
| Fabric.js toSVG() for rendering | Has documented text positioning bugs, custom JSON-to-SVG is more reliable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISP-01 | Phase 8 | Complete |
| DISP-02 | Phase 8 | Complete |
| DISP-03 | Phase 8 | Complete |
| DISP-04 | Phase 8 | Complete |
| DISP-05 | Phase 8 | Complete |
| DISP-06 | Phase 8 | Pending |
| DISP-07 | Phase 8 | Pending |
| DISP-08 | Phase 8 | Pending |
| DISP-09 | Phase 8 | Complete |
| DISP-10 | Phase 8 | Pending |
| DISP-11 | Phase 8 | Complete |
| INTR-01 | Phase 9 | Complete |
| INTR-02 | Phase 9 | Complete |
| INTR-03 | Phase 9 | Complete |
| INTR-04 | Phase 9 | Complete |
| INTR-05 | Phase 9 | Complete |
| INTR-06 | Phase 9 | Complete |
| INTR-07 | Phase 9 | Pending |
| INTR-08 | Phase 9 | Pending |
| INTR-09 | Phase 9 | Complete |
| INTR-10 | Phase 9 | Pending |
| EDIT-01 | Phase 10 | Complete |
| EDIT-02 | Phase 10 | Complete |
| EDIT-03 | Phase 10 | Complete |
| EDIT-04 | Phase 10 | Complete |
| EDIT-05 | Phase 10 | Complete |
| EDIT-06 | Phase 11 | Complete |
| EDIT-07 | Phase 11 | Complete |
| EDIT-08 | Phase 11 | Complete |
| EDIT-09 | Phase 10 | Complete |
| EDIT-10 | Phase 10 | Complete |
| ZOOM-01 | Phase 11 | Complete |
| ZOOM-02 | Phase 11 | Complete |
| ZOOM-03 | Phase 11 | Complete |
| ZOOM-04 | Phase 11 | Complete |
| ZOOM-05 | Phase 11 | Complete |
| ZOOM-06 | Phase 11 | Complete |
| ZOOM-07 | Phase 11 | Complete |
| ZOOM-08 | Phase 11 | Complete |

**Coverage:**
- v2.0 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after roadmap creation -- traceability updated*
