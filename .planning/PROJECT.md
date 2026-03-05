# Live Zoom Annotation Rendering

## What This Is

A professional-grade zoom experience for a PDF survey annotation tool built on Syncfusion React PDF Viewer. The custom canvas-based annotation layer currently re-renders from scratch during zoom operations, causing annotations to disappear, flicker, and lag. This project replaces that behavior with seamless, real-time annotation scaling during zoom — matching the polish of Adobe Acrobat, Bluebeam, and DrawboardPDF.

## Core Value

Annotations must remain visible and smoothly scale with the page during zoom at all times — no disappearing, no flickering, no positional glitches.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Annotations stay visible throughout the entire zoom operation (no disappearing)
- [ ] Annotations scale smoothly with the page during zoom (CSS transform-based)
- [ ] High-fidelity re-render occurs after zoom settles (crisp at final zoom level)
- [ ] All annotation types supported: shapes, freehand/ink, text
- [ ] All zoom methods supported: trackpad pinch, toolbar buttons, Ctrl/Cmd+scroll
- [ ] No positional or scale glitching during zoom transitions
- [ ] No flickering of annotations at wrong positions/scales during or after zoom
- [ ] Performance remains smooth — no jank or dropped frames during zoom

### Out of Scope

- Modifying Syncfusion's internal PDF page rendering — we only control the custom annotation layer
- Adding new annotation types — this project is about zoom behavior only
- Changing how annotations render at a static zoom level — end-state rendering is already correct

## Context

- The app uses Syncfusion React PDF Viewer as the base PDF rendering engine
- Annotations are rendered on a fully custom canvas layer (`PageAnnotationLayer.jsx`) overlaid on top of Syncfusion's pages
- Syncfusion confirmed their viewer uses lazy-loading with zoom-dependent re-rendering: "During zooming, the viewer must re-render the annotation canvas because the annotation geometry depends on the active zoom level"
- The final rendered state after zoom is already correct — annotations position and scale properly once settled
- Professional PDF tools (Acrobat, Bluebeam, DrawboardPDF) solve this with a "scale during, render after" pattern: CSS transforms provide instant GPU-accelerated scaling during zoom, followed by a high-fidelity canvas re-render once zoom stabilizes
- The existing annotation layer is built with HTML Canvas 2D context

## Constraints

- **Tech stack**: Must work within Syncfusion React PDF Viewer ecosystem — cannot replace the base viewer
- **Rendering tech**: Custom annotation layer uses Canvas 2D — solution must work with canvas-based rendering
- **Quality bar**: Must match Adobe Acrobat-level polish — no visible transition artifacts acceptable
- **Backwards compatibility**: Must not break existing annotation creation, editing, or positioning logic

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CSS transform scaling during zoom | GPU-accelerated, instant, no re-render needed during transition | — Pending |
| Debounced re-render after zoom settles | Avoids expensive canvas re-draws during active zooming | — Pending |
| Willing to sacrifice fidelity during zoom if needed | User stated preference for smooth over perfect mid-zoom, but prefers highest quality | — Pending |

---
*Last updated: 2026-03-04 after initialization*
