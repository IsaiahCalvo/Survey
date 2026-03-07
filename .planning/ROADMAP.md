# Roadmap: Live Zoom Annotation Rendering

## Overview

This project transforms the annotation layer's zoom behavior from "re-render on every scale change" to "CSS transform during zoom, canvas re-render after." The roadmap moves through four phases: first making annotations visible during zoom via CSS transforms, then aligning the transform origin so annotations track the page exactly, then eliminating flicker during the transform-to-canvas handoff, and finally adding a multi-scale cache so revisited zoom levels are instant.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: CSS Transform Scaling** - Wire useZoomState to annotation layer so annotations stay visible and scale smoothly during zoom
- [ ] **Phase 2: Positional Accuracy** - Align transform-origin with Syncfusion page zoom anchor so annotations track page content exactly
- [ ] **Phase 3: Flicker-Free Transitions** - Atomic CSS-transform-to-canvas-rerender handoff with no visible artifacts
- [ ] **Phase 4: Scale Caching** - Multi-scale annotation cache for instant return to previously visited zoom levels

## Phase Details

### Phase 1: CSS Transform Scaling
**Goal**: Annotations remain visible and scale smoothly with the page throughout the entire zoom operation
**Depends on**: Nothing (first phase)
**Requirements**: ZVIS-01, ZVIS-02
**Success Criteria** (what must be TRUE):
  1. User zooms in/out and annotations never disappear at any point during the zoom operation
  2. Annotations visually grow/shrink in sync with the page as zoom changes (CSS transform-based, GPU-accelerated)
  3. PageAnnotationLayer only re-renders when renderedScale changes (after zoom settles), not on every live scale change
**Plans:** 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Wire zoom visibility: show lightweight overlay during zoom, hide Fabric.js layer, CSS transform scaling
- [ ] 01-02-PLAN.md -- Enhance lightweight overlay with SVG path/line/arrow rendering for zoom preview fidelity

### Phase 2: Positional Accuracy
**Goal**: Annotations maintain pixel-perfect alignment with underlying page content during zoom, anchored from the cursor position
**Depends on**: Phase 1
**Requirements**: ZCOR-01, ZCOR-03, ZPOL-01
**Success Criteria** (what must be TRUE):
  1. User zooms on a specific annotation and it stays aligned with the PDF content beneath it throughout the zoom -- no drift or positional glitch
  2. Zoom expands/contracts from cursor position (cursor-centered zoom), matching Adobe Acrobat behavior
  3. Transform-origin of the annotation layer matches Syncfusion's page zoom anchor across all zoom methods (pinch, toolbar, Ctrl+scroll)
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Replace hardcoded transform-origin with per-page cursor-relative origin in overlay transform functions
- [ ] 02-02-PLAN.md -- Cursor-centered zoom polish: viewport-center toolbar anchor, scroll verification, debug alignment crosshairs

### Phase 3: Flicker-Free Transitions
**Goal**: The transition from CSS-transformed preview to crisp canvas re-render happens with zero visible artifacts
**Depends on**: Phase 2
**Requirements**: ZCOR-02
**Success Criteria** (what must be TRUE):
  1. User zooms and releases -- annotations never flash at a wrong scale or wrong position during the CSS-to-canvas handoff
  2. The visual transition from CSS-scaled bitmap to freshly rendered canvas is imperceptible (no pop, no jump, no momentary blank)
  3. Rapid successive zooms (zoom-zoom-zoom) do not produce accumulated flicker or positioning errors
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Scale Caching
**Goal**: Previously visited zoom levels render instantly from cache without triggering a new canvas re-render
**Depends on**: Phase 3
**Requirements**: ZPOL-02
**Success Criteria** (what must be TRUE):
  1. User zooms to 150%, then to 200%, then back to 150% -- the 150% view appears instantly without a visible re-render
  2. Cached zoom levels display at full fidelity (not CSS-scaled approximations of a different zoom level)
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CSS Transform Scaling | 0/2 | Planning complete | - |
| 2. Positional Accuracy | 0/2 | Planning complete | - |
| 3. Flicker-Free Transitions | 0/? | Not started | - |
| 4. Scale Caching | 0/? | Not started | - |
