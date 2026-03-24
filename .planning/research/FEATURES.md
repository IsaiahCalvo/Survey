# Feature Landscape

**Domain:** SVG annotation display + Canvas edit-only architecture
**Researched:** 2026-03-23

## Table Stakes

Features users expect. Missing = annotations break or are unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| All annotation types render in SVG | Users see all their existing annotations | Medium | 7 types: pen/highlight paths, lines, arrows, shapes, callouts, text. LightweightAnnotationOverlay already handles 5. |
| viewBox auto-scaling on zoom | Annotations stay positioned correctly at all zoom levels | Low | Set `viewBox="0 0 pageW pageH"` and `width/height: 100%`. Browser handles everything. |
| Click to select annotation | Users must be able to interact with annotations | Medium | Pointer events on `<g>` elements. Need hit testing for unfilled paths (strokes). |
| Selection visual feedback | Users need to see which annotation is selected | Low | Bounding box rect + 8 corner/edge handles rendered as SVG rects. |
| Pen/highlighter drawing | Core annotation creation tool | Low | Existing Fabric.js PencilBrush -- just mount Canvas when pen tool is active. |
| Commit pen stroke to SVG | After drawing, stroke appears in SVG layer | Medium | Extract Fabric JSON from Canvas, add to annotation store, unmount Canvas, SVG re-renders. |
| Text editing | Users edit text annotations | Medium | Mount Fabric Canvas over annotation bounding box, load text object, user edits, commit on deselect/blur. |
| Eraser tool | Users erase parts of annotations | Medium | Mount Canvas with all page annotations loaded, use Fabric eraser brush, commit modified JSON. |
| pathOffset correction | Pen/highlight paths render at correct position | Medium | Apply `translate(-pathOffset.x, -pathOffset.y)` inside path group transform. Critical for accuracy. |
| non-scaling-stroke | Stroke widths stay visually consistent across zoom | Low | `vector-effect="non-scaling-stroke"` CSS/SVG attribute. Widely supported. |

## Differentiators

Features that improve UX beyond basic functionality. Not strictly required but high value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Drag to move annotation (in SVG) | Move annotations without entering Canvas edit mode | Medium | Pointer event drag with SVG coordinate conversion. Updates annotation position in store. |
| Resize via handles (in SVG) | Resize without Canvas mount | Medium | 8 handles, pointer event tracking, update width/height/scaleX/scaleY in store. |
| Zero-flicker zoom | Annotations never disappear during zoom (eliminates 3-second gap) | Low | Automatic with SVG viewBox -- the entire reason for this migration. |
| Canvas mount for targeted edit | Only mount Canvas over the specific annotation being edited | High | Requires calculating annotation bounding box, positioning Canvas overlay precisely. |
| Memory reduction | From ~44MB per visible page to 0 during display mode | Low | Automatic when Canvas is not mounted. Only cost is SVG DOM nodes (~negligible). |
| Cursor feedback | Show grab cursor on hover, resize cursors on handles | Low | CSS `cursor` property on SVG elements. |
| Annotation z-order in SVG | Annotations render in correct front-to-back order | Low | SVG paints in DOM order. Render annotations in their stored order. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full rotation in SVG select mode | Complex math for rotated handle positioning, interaction with scaled viewBox | Use Fabric Canvas for rotation: click annotation, mount Canvas, rotate there, commit back. |
| Multi-annotation drag in SVG | Complex state management for group transforms | Single-select move only. Multi-select editing mounts Canvas with all selected annotations. |
| Real-time collaborative SVG | CRDT/OT for SVG element mutations is an entirely separate architecture | Keep existing single-user model. Collaboration is a future milestone. |
| Touch gesture editing in SVG | Pinch-zoom conflicts with annotation resize; two-finger rotate conflicts with page scroll | Touch users get view-only SVG. Editing on touch is future milestone. |
| Custom SVG animation on select | Fancy selection animations (pulse, glow) add complexity for minimal value | Instant selection box + handles. Simple, fast, debuggable. |
| SVG layer for search highlights | SearchHighlightLayer is already DOM-based and working | Leave SearchHighlightLayer unchanged. |
| Undo/redo changes | Undo system uses full-page JSON snapshots -- format unchanged | No changes to undo/redo system. |

## Feature Dependencies

```
SVG Display Layer (renders all types)
  --> Hit Testing (click on annotations)
    --> Selection Handles (visual selection UI)
      --> Drag/Move in SVG (move selected annotation)
      --> Resize in SVG (resize via handles)
  --> Canvas Mount/Unmount (conditional rendering)
    --> Pen Tool Integration (mount Canvas for drawing)
    --> Text Edit Integration (mount Canvas over annotation)
    --> Eraser Integration (mount Canvas with all annotations)
    --> Commit Flow (Canvas data --> SVG re-render)
      --> Zoom During Active Tool (CSS transform + remount)
```

## MVP Recommendation

Prioritize:
1. SVG display of all 7 annotation types with pathOffset correction (table stakes, foundation)
2. Click-to-select with selection handles (table stakes, enables all interaction)
3. Pen tool with Canvas mount/unmount + commit to SVG (table stakes, core creation tool)
4. Zero-flicker zoom via viewBox (differentiator, primary migration motivation)

Defer:
- Drag/resize in SVG: Can use Canvas edit mode as fallback (select -> double-click -> Canvas mounts)
- Targeted Canvas mount on bbox only: Start with full-page Canvas mount, optimize later
- Touch gesture editing: Desktop-first, Electron app

## Sources

- Existing `LightweightAnnotationOverlay.jsx` analysis -- 5 annotation types already rendering
- Obsidian vault `CC-SVG Migration Research.md` -- annotation type mapping
- Obsidian vault `CC-Architecture Overview.md` -- tool behavior matrix
- PROJECT.md -- active requirements and constraints
