# SVG Migration — PDF Annotation App

## What This Is

A PDF annotation application for mechanical/electrical engineers at mid-size firms. Currently uses Fabric.js canvases for all annotation rendering, which causes a 3-second annotation disappearance during zoom due to a 5-timer coordination system. This milestone migrates to SVG display + Fabric.js edit-only, eliminating zoom bugs as a category by letting the browser handle scaling via SVG viewBox.

## Core Value

Annotations must render correctly at all zoom levels with zero disappearance, zero flicker, and zero timer coordination — the browser handles zoom scaling automatically via SVG viewBox.

## Previous Milestone: v2.0 SVG Migration ✓ COMPLETE (2026-04-10)

Phases 8-11 shipped. SVG display + Fabric.js edit-only architecture fully
landed with zero-timer zoom. All 39 v2.0 requirements met. See MILESTONES.md.

## Current Milestone: v2.1 Shape Edit Polish & Foundation Wins

**Goal:** Finish the shape editing interaction model started in the post-v2.0
cleanup branch (circle edit fixes) — add rotation precision and extend the
usable zoom range so shape editing feels complete before moving on to prop-flip
foundation wins.

**Target features (Stage 0 only):**
- Shift+rotate snaps to 45° increments during shape rotation (both SVG and Fabric edit paths)
- Zoom floor lowered from 50% to 10% so annotations remain inspectable at extreme zoom-out

Stage 1+ (prop-flip wins, QA, UX polish) remains queued in FEATURE-BACKLOG.md
for v2.2+.

## Requirements

### Validated

- ✓ PDF viewing with Syncfusion viewer — existing
- ✓ Fabric.js annotation drawing tools (pen, shapes, callouts, regions) — existing
- ✓ Annotation persistence via Supabase — existing
- ✓ Search highlights overlay — existing
- ✓ Lightweight proxy rendering during pan/scroll — existing
- ✓ Undo/redo for annotations — existing
- ✓ Overlay divs as direct children of Syncfusion page divs — v1.0 Phase 1
- ✓ CSS transform zoom handling on overlay divs — v1.0 Phase 2
- ✓ React portals render into persistent overlay divs — v1.0 Phase 3
- ✓ SVG display layer for all 7 annotation types with viewBox auto-scaling — v2.0 Phase 8
- ✓ SVG selection, drag, resize, multi-select — v2.0 Phase 9
- ✓ Fabric.js Canvas mount-on-demand for pen/eraser — v2.0 Phase 10
- ✓ Targeted Canvas for text/shape/callout editing + zero-timer zoom — v2.0 Phase 11
- ✓ Circle edit handle alignment, live scaling, clipping fixes — post-v2.0 cleanup (2026-04-12)

### Active (v2.1)

- [ ] Shape rotation snaps to 45° increments while Shift is held
- [ ] Zoom floor lowered to 10% so annotations remain editable at extreme zoom-out

### Out of Scope

- Changes to annotation data model or Supabase storage format — SVG reads same Fabric.js JSON
- Changes to Syncfusion PDF viewer configuration — viewer layer unchanged
- Real-time collaborative editing — future milestone
- Mobile/touch gesture support beyond basic pinch zoom — future milestone
- Phase 7 widen zoom range — deferred

## Context

- Reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` uses SVG overlays with viewBox, zero zoom timers
- `LightweightAnnotationOverlay.jsx` (505 lines) already renders 5 annotation types as SVG — 80% of the display layer
- Industry standard: Nutrient/PSPDFKit, PDF.js, pdf-annotate.js, Hypothesis all use SVG for annotations
- Only Apryse/PDFTron uses Canvas like current approach (full-time team maintaining custom engine)
- v1.0 Phases 1-3 established overlay div foundation (still valid, SVG layer will use these)
- v1.0 Phase 4 failed 4 times — 5-timer coordination system proved intractable
- Canvas memory: one Fabric canvas per visible page (~44MB each at retina 2x) → zero canvases during display mode

## Constraints

- **Fabric.js**: Must keep Fabric.js 5.5.2 for pen/eraser/text editing (SVG is display-only, Canvas is edit-only)
- **Data model**: Same Fabric.js JSON format — no migration needed, SVG reads it directly
- **Browser support**: SVG `vector-effect: non-scaling-stroke` supported in Chrome, Firefox 15+, Safari 5.1+, Electron
- **Estimated effort**: ~80 hours / 4 sessions across ~2 calendar weeks

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SVG display + Fabric.js edit-only (v2.0) | 5-timer system intractable after 4 failed fixes; industry standard is SVG | — Pending |
| Keep same Fabric.js JSON data model | Zero migration, SVG reads same format, undo/redo unchanged | — Pending |
| Use `<foreignObject>` for text annotations | Fabric's toSVG has text positioning bugs | — Pending |
| Mount/unmount Canvas per edit session | 5-15ms creation cost negligible, massive memory savings | — Pending |
| v1.0 overlay divs remain valid | SVG layer uses same direct-child-of-page-div pattern | ✓ Good |

---
*Last updated: 2026-04-12 after milestone v2.1 initialization*
