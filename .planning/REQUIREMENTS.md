# Requirements: Live Zoom Annotation Rendering

**Defined:** 2026-03-04
**Core Value:** Annotations must remain visible and smoothly scale with the page during zoom at all times

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Zoom Visibility

- [ ] **ZVIS-01**: Annotations stay visible throughout the entire zoom operation — no disappearing at any point
- [ ] **ZVIS-02**: Annotations scale smoothly with the page during zoom via CSS transform (GPU-accelerated)

### Zoom Correctness

- [ ] **ZCOR-01**: Annotations maintain correct position relative to page content during zoom — no positional glitching or drift
- [ ] **ZCOR-02**: Annotations do not flicker at wrong scale or wrong position during or after zoom transitions
- [ ] **ZCOR-03**: Transform-origin of annotation layer matches Syncfusion page zoom anchor for all zoom methods

### Zoom Polish

- [ ] **ZPOL-01**: Zoom expands from cursor position (cursor-centered zoom) matching Adobe Acrobat behavior
- [ ] **ZPOL-02**: Multi-scale annotation cache avoids re-render when returning to previously visited zoom levels

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Performance & Methods

- **PERF-01**: Crisp high-fidelity re-render after zoom settles (canvas re-draw at final zoom level)
- **PERF-02**: 60fps smooth performance with no jank or dropped frames during zoom
- **PERF-03**: All zoom methods supported — trackpad pinch, toolbar buttons, Ctrl/Cmd+scroll
- **PERF-04**: Progressive quality during zoom (CSS-scaled immediately, sharpens as zoom stabilizes)

### Interaction

- **INTR-01**: Annotation interaction (select, edit) during active zoom gesture

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time Fabric.js re-render during zoom | Defeats the optimization — CSS transform is the correct approach |
| WebGL rendering migration | Massive scope creep — zoom problem is eliminating renders, not rendering speed |
| CSS transition animations on scale | Creates input lag and fights user gesture input |
| OffscreenCanvas for annotation rendering | Unnecessary complexity — CSS transform eliminates main-thread work during zoom |
| SVG proxy swap during zoom | CSS transform on existing canvas bitmap is more faithful and simpler |
| Modifying Syncfusion internal PDF rendering | Out of our control — observe and match, don't modify |
| New annotation types | This project is about zoom behavior only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ZVIS-01 | Phase ? | Pending |
| ZVIS-02 | Phase ? | Pending |
| ZCOR-01 | Phase ? | Pending |
| ZCOR-02 | Phase ? | Pending |
| ZCOR-03 | Phase ? | Pending |
| ZPOL-01 | Phase ? | Pending |
| ZPOL-02 | Phase ? | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 0
- Unmapped: 7

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after initial definition*
