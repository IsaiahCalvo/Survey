# Milestones

## v1.0 --- Zoom Flicker Fix (Direct Child Canvas)

**Goal:** Annotations stay visible and correctly positioned during all zoom operations by making annotation canvases direct children of Syncfusion page divs.

**Shipped (Phases 1-3):**
- Phase 1: Overlay Attachment Foundation --- persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- Phase 2: Zoom Handler --- CSS transforms on overlay divs during zoom for visual stability across all 6 zoom methods (completed 2026-03-18)
- Phase 3: Render Loop Rewrite --- React portals render into persistent overlay divs with correct scale computation (completed 2026-03-19)

**Superseded (Phases 4-6):**
- Phase 4: PAL Zoom Simplification --- 4 failed attempts, timer coordination proved intractable
- Phase 5: Page Container Re-attachment --- superseded by SVG migration
- Phase 6: Dead Code Removal --- superseded by SVG migration

**Deferred:**
- Phase 7: Widen Zoom Range --- deferred to future milestone

**Last phase number:** 7

**Outcome:** Phases 1-3 established the overlay div foundation. Phase 4's repeated failures (5-timer coordination system) motivated the architectural pivot to SVG display in v2.0.

## v2.0 --- SVG Migration (SVG Display + Fabric.js Edit-Only)

**Goal:** Replace Fabric.js-everywhere with SVG display + Fabric.js edit-only architecture. Annotations render via SVG viewBox with zero zoom timers. Canvas mounts only during active editing.

**Phases:**
- Phase 8: SVG Display Foundation --- all 7 annotation types render as SVG with viewBox auto-scaling (11 requirements)
- Phase 9: SVG Selection and Interaction --- click-to-select, drag, resize, multi-select in SVG (10 requirements)
- Phase 10: Canvas Mount/Unmount (Pen + Eraser) --- conditional Fabric.js Canvas for drawing and erasing (7 requirements)
- Phase 11: Text/Shape Editing + Zoom Cleanup --- targeted Canvas for text/shape editing, old timer removal (11 requirements)

**First phase number:** 8
**Last phase number:** 11

**Status:** Not started
