# Phase 11: Text/Shape Editing + Zoom Cleanup - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Text and shape annotations become editable via targeted Canvas mount (double-click triggers Fabric.js Canvas), and all old zoom timer machinery is removed from the codebase. This is the final phase of the v2.0 SVG Migration milestone. After this phase, the app runs entirely on SVG display + Canvas edit-only with zero old timer coordination.

Two work streams:
1. **Editing** (EDIT-06, EDIT-07, EDIT-08): text/shape/callout double-click → Canvas → edit → commit → SVG
2. **Zoom cleanup** (ZOOM-01 through ZOOM-08): remove old 5-timer system, dead props, freeze/snapshot/confirm-pending machinery

</domain>

<decisions>
## Implementation Decisions

### Text editing trigger & Canvas sizing
- Double-click a text annotation → Canvas mounts at annotation bounding box + ~20px padding
- SVG layer stays visible underneath (other annotations remain visible)
- Canvas transparent background — only the text annotation is loaded into Canvas
- If text content grows beyond original bounds during editing, Canvas auto-expands to fit

### Text edit commit behavior
- Click outside the text Canvas → edit commits, Canvas unmounts, SVG updates with new text
- Escape key → cancel edit (revert to pre-edit state), Canvas unmounts
- One undo checkpoint per completed edit (same pattern as Phase 9 move/resize, Phase 10 stroke)
- Supabase sync debounced 2-3 seconds after local commit (consistent with Phase 9/10)

### New text creation
- Text tool active + click on empty PDF space → Canvas mounts at click position with empty IText
- User types new text, clicks away to commit to SVG
- Standard text tool behavior — creates new annotation on click-to-place

### Text rendering fidelity (foreignObject in SVG)
- Positionally correct: same font, size, color, position as Fabric.js IText
- Minor word-wrap or line-break differences from Fabric IText are acceptable
- Matches Phase 8 visual fidelity standard — NOT pixel-perfect, focus on correctness

### Shape editing (rect, circle, ellipse)
- Double-click a shape → Canvas mounts at annotation bbox + padding
- Full Fabric.js interactive mode: user can drag corners to resize, use floating mini-toolbar for color/stroke/width
- Same editing feel as pre-SVG-migration Canvas mode
- Click away to commit → Canvas unmounts, SVG updates

### Callout editing
- Double-click a callout → full-page Canvas mounts (callout has leader line + knee + arrowhead spanning large area)
- SVG layer hidden during callout edit (like eraser pattern — avoids double-rendering)
- Full interactive mode: drag text box, drag knee control point, drag arrowhead endpoint
- Click away to commit → Canvas unmounts, SVG shows updated callout

### Canvas component architecture
- One shared `FabricEditCanvas` component handles text, shape, AND callout editing
- Props: `{ type, annotation, pageSize, ... }` — internally configures Fabric.js mode based on annotation type
- `type='text'` → bbox Canvas + IText editing
- `type='shape'` → bbox Canvas + interactive handles
- `type='callout'` → full-page Canvas + multi-part group editing
- Follows Phase 10 pattern (FabricDrawingCanvas handles both pen + highlighter via config)

### Zoom during text editing
- Zoom detected → current text state commits immediately → Canvas gets CSS transform for visual stability
- After 200ms settle → Canvas remounts at new dimensions → IText re-enters edit mode automatically → cursor position restored
- User barely notices the interruption — continuous editing experience across zoom

### Zoom during shape/callout editing
- Canvas gets CSS transform for visual stability during zoom (blurry but positioned)
- After 200ms settle → Canvas remounts at new dimensions → shape/callout re-loaded in edit mode with handles restored
- Same CSS transform + remount pattern as pen tool (Phase 10)

### Settle debounce timing
- 200ms for ALL Canvas types: pen, eraser, text, shape, callout
- One consistent timing — matches ZOOM-03 spec

### Dead code removal (Claude's discretion)
- Remove old 5-timer zoom system: PAL settle debounce (300ms), App zoom settle (1000ms), confirm-pending safety (3000ms), tier-2 page defer (800ms), overlay safety (5000ms)
- Remove freeze/snapshot/confirm-pending machinery from App.jsx (~30 refs, ~14 functions)
- Remove dead props from PageAnnotationLayer: onScaleApplied, presentationApiRegistry, isHidden
- Remove beginSyncfusionScaleConfirmPending and related coordination functions
- Canvas mode toggle (Ctrl+Shift+V) removal strategy: Claude's discretion (may keep as fallback or remove with v2.0 completion)

### Claude's Discretion
- Dead code removal strategy (gradual with safety checks vs all-at-once cleanup)
- Canvas mode toggle fate (keep as dev escape hatch or remove)
- FabricEditCanvas internal structure and lifecycle management
- Floating mini-toolbar implementation for shape color/stroke editing
- Cursor position restoration logic after zoom remount during text editing
- IText configuration details (font fallbacks, cursor behavior)
- How callout multi-part group is loaded into Canvas (enlivenObjects vs manual recreation)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 11 requirements
- `.planning/REQUIREMENTS.md` — EDIT-06, EDIT-07, EDIT-08 (text/shape/callout editing), ZOOM-01 through ZOOM-08 (zoom cleanup)
- `.planning/ROADMAP.md` — Phase 11 success criteria and dependency on Phase 10

### Architecture decisions
- `.planning/PROJECT.md` — Core constraints: Fabric.js 5.5.2, zero new deps, same JSON format
- `.planning/STATE.md` — Accumulated decisions from Phases 8-10, pending todos, blockers

### Prior phase context (patterns to follow)
- `.planning/phases/10-canvas-mount-unmount-pen-eraser/10-CONTEXT.md` — Canvas mount/unmount patterns, useFabricCanvas hook, per-stroke commit, eraser SVG-hidden pattern
- `.planning/phases/09-svg-selection-interaction/09-CONTEXT.md` — Selection handles, persistence & undo patterns, Supabase sync debounce (2-3s), double-click edit trigger
- `.planning/phases/08-svg-display-foundation/08-CONTEXT.md` — SVG display decisions, renderer toggle, visual fidelity standard (positionally correct, not pixel-perfect)

### Canvas lifecycle (reuse from Phase 10)
- `src/hooks/useFabricCanvas.js` — Shared Canvas lifecycle hook with onBeforeDispose cleanup pattern
- `src/components/FabricDrawingCanvas.jsx` — Reference for bbox-style Canvas mount (pen/highlighter)
- `src/components/FabricEraserCanvas.jsx` — Reference for full-page Canvas mount with SVG-hidden pattern

### SVG layer (edit trigger already plumbed)
- `src/components/SVGAnnotationLayer.jsx` — Has `onRequestEditMode(annotationIndex, annotationType)` callback from Phase 9
- `src/hooks/useSVGInteraction.js` — Double-click handler fires `onRequestEditMode` at line ~245

### Old zoom system (removal targets)
- `src/App.jsx` — ~18 occurrences of confirmPending/freeze/settle/onScaleApplied refs
- `src/PageAnnotationLayer.jsx` — ~23 occurrences of confirmPending/freeze/settle/onScaleApplied/isHidden refs

### Text/callout editing reference (from PAL)
- `src/PageAnnotationLayer.jsx` — IText editing patterns, callout group structure
- `src/components/Callout/CalloutCanvas.jsx` — Callout Canvas editing component
- `src/utils/calloutGeometry.js` — `calculateCalloutConnection()` for callout line/knee positioning

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useFabricCanvas.js` (56 lines): Shared Canvas lifecycle hook — reuse directly for FabricEditCanvas. Has onBeforeDispose pattern for commit-before-unmount.
- `FabricDrawingCanvas.jsx` (326 lines): Reference for bbox-sized Canvas mount pattern, container-aware sizing via effectiveScale, zoom generation tracking
- `FabricEraserCanvas.jsx` (453 lines): Reference for full-page Canvas mount with SVG-hidden pattern (via `svgInteractive=false`), annotation loading via `fabric.util.enlivenObjects`
- `SVGAnnotationLayer.jsx` (516 lines): Already has `onRequestEditMode` prop and `activeTool` prop. Double-click trigger is wired.
- `useSVGInteraction.js`: Double-click handler at line ~245 fires `onRequestEditMode(index, type)` — the entry point for Phase 11 Canvas mounting
- `calloutGeometry.js`: Callout line/knee positioning calculations — reuse for callout Canvas editing
- `CalloutCanvas.jsx` and `CalloutComponent.jsx`: Existing callout editing UI — reference for interaction patterns

### Established Patterns
- Canvas key prop: `pageNumber` only (not tool-dependent) — from Phase 10 decision. FabricEditCanvas may need annotation ID in key to force remount on different annotation double-click.
- Container-aware sizing: `containerEl.offsetWidth / pageSize.width` for effectiveScale — mandatory per CLAUDE.md
- Zoom generation tracking: `setZoomGeneration` incremented on zoom start, Canvas checks if generation changed to decide remount — from Phase 10
- flushSync during dispose: forces synchronous SVG re-render before Canvas DOM removal — prevents flicker (Phase 10 decision)
- Per-action undo: `saveAnnotationCheckpoint` called on each commit (stroke, erase, edit completion)
- Supabase sync: debounced 2-3 seconds after local commit

### Integration Points
- `SVGAnnotationLayer.jsx` `onRequestEditMode` callback → App.jsx state → FabricEditCanvas conditional render
- `App.jsx` activeTool state drives Canvas component selection: pen/highlighter → FabricDrawingCanvas, eraser → FabricEraserCanvas, text tool → FabricEditCanvas (new text), any tool + double-click → FabricEditCanvas (edit existing)
- `App.jsx` undo system: `saveAnnotationCheckpoint` on edit commit
- `App.jsx` annotation state: `onSaveAnnotations` callback updates `annotationsByPage` for SVG re-render

</code_context>

<specifics>
## Specific Ideas

- Text editing should feel seamless during zoom — auto-commit + remount with cursor position restored, so user barely notices the interruption
- Callout editing uses full-page Canvas with SVG hidden (mirrors eraser pattern from Phase 10) because callout parts can span large areas
- One `FabricEditCanvas` component for all edit types, configured via `type` prop — follows the Phase 10 precedent of `FabricDrawingCanvas` handling both pen and highlighter via brush config
- New text creation via click-to-place when text tool is active — standard text tool behavior

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-text-shape-editing-zoom-cleanup*
*Context gathered: 2026-03-27*
