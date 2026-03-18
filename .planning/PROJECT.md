# Zoom Flicker Fix — Direct Child Canvas

## What This Is

A refactor of the annotation overlay system in the BetaSafe PDF annotation app. Currently, annotations flicker during zoom — appearing at wrong sizes and positions before settling — because the canvas attachment uses a complex freeze/snapshot/confirm-pending portal system. This project replaces that with a simpler approach where annotation canvases are direct children of Syncfusion's page divs, scaling naturally with CSS transforms during zoom.

## Core Value

Annotations must stay visible and correctly positioned during all zoom operations. They may look briefly blurry (like zooming into a photo) but must never disappear, jump, or render at the wrong size/position.

## Requirements

### Validated

- ✓ PDF viewing with Syncfusion viewer — existing
- ✓ Fabric.js annotation drawing tools (pen, shapes, callouts, regions) — existing
- ✓ Annotation persistence via Supabase — existing
- ✓ Search highlights overlay — existing
- ✓ Lightweight proxy rendering during pan/scroll — existing
- ✓ Undo/redo for annotations — existing

### Active

- [ ] Annotation canvases are direct children of Syncfusion page divs (not via complex portal host system)
- [ ] All 6 zoom methods work without annotation flicker (ctrl+scroll, toolbar buttons, dropdown, fit-to-page, fit-to-width, pinch)
- [ ] CSS transform scaling during zoom transition (blurry but stable)
- [ ] Canvas redraws at correct resolution after zoom settles
- [ ] Rapid consecutive zooms handled gracefully
- [ ] Overlay re-attachment when Syncfusion recreates page divs
- [ ] Dead code removal (freeze/snapshot/confirm-pending machinery)

### Out of Scope

- SVG-based annotation rendering — we need Fabric.js for interactive annotation editing
- Changes to the annotation data model or drawing tools
- Changes to Syncfusion PDF viewer configuration
- Changes to LightweightAnnotationOverlay or SearchHighlightLayer (beyond re-parenting)
- Performance optimization of Fabric.js canvas rendering itself

## Context

- Reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` avoids flicker by making SVG overlays direct children of page divs with `width: 100%; height: 100%` and a viewBox. We adapt this for Fabric.js canvas using CSS transforms instead of viewBox.
- Design spec: `docs/superpowers/specs/2026-03-17-option3-direct-child-canvas-design.md`
- Fallback spec (if this doesn't work): `docs/superpowers/specs/2026-03-17-option2-svg-display-fabric-edit-design.md`
- App.jsx is ~25,000+ lines — the main orchestrator with zoom logic, render loop, and refs
- PageAnnotationLayer.jsx is ~9,750 lines — the per-page Fabric.js annotation component

## Constraints

- **Branch**: Work on new branch `option3-direct-child-canvas` — keep `Layer-Revamp` intact
- **Incremental**: Get Steps 1-3 working before Steps 4-6. Verify after each step.
- **Fabric.js**: Must keep Fabric.js 5.5.2 canvas for annotation editing (SVG is display-only)
- **Compatibility**: All 6 zoom methods must work. Drawing tools must work after zoom.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Direct child canvas (Option 3) over SVG display (Option 2) | Simpler refactor, preserves existing Fabric.js system entirely | — Pending |
| New feature branch | Preserve current working state on Layer-Revamp as safety net | — Pending |
| Study reference app | Understand exactly how the flicker-free approach works before implementing | — Pending |
| CSS transform during zoom | Fabric.js can't use SVG viewBox; CSS transform achieves similar visual stability | — Pending |

---
*Last updated: 2026-03-17 after initialization*
