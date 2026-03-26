# Phase 10: Canvas Mount/Unmount (Pen + Eraser) - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Fabric.js Canvas mounts only when the user activates pen, highlighter, or eraser tools, captures the work, and unmounts cleanly. This bridges SVG-only display (Phase 8-9) and the edit-only Canvas architecture. Text/shape editing Canvas mount is Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Stroke commit & undo (pen/highlighter)
- Per-stroke commit: each completed stroke immediately commits to SVG data AND remains visible on Canvas
- Debounced Supabase sync: SVG data updates instantly (visual), Supabase persistence debounced 2-3 seconds
- Canvas accumulates strokes during the drawing session — strokes are NOT removed from Canvas after commit
- On tool switch: Canvas unmounts, SVG layer shows all committed strokes (no visual gap since they were already committed)
- Undo granularity: one Ctrl+Z = one stroke removed from BOTH Canvas and SVG simultaneously
- Undo while pen is active removes from both layers at once — no desync between Canvas visual and SVG data

### Eraser UX & commit
- Brief cursor change (wait/spinner) during Canvas mount while annotations load (20-200ms)
- Switch to eraser cursor once Canvas is ready and all annotations are loaded
- SVG layer HIDDEN while eraser Canvas is mounted — avoids double-rendering artifacts
- Canvas shows all page annotations during erase mode (user erases against Canvas objects)
- Per-erase-stroke commit: each completed erase gesture immediately commits modified annotation(s) to SVG data
- Each erase action is one Ctrl+Z step — matches pen undo granularity
- On tool switch: Canvas unmounts, SVG layer shows (with erased results already committed)

### Highlighter specifics
- Live multiply blend mode: Canvas uses `globalCompositeOperation: 'multiply'` during highlighter drawing — user sees actual highlight effect in real-time
- Pen and highlighter share the SAME Canvas component — differentiated by brush settings (color, width, opacity, blend mode)
- Switching pen↔highlighter does NOT unmount Canvas — just reconfigures the brush settings (instant switch, zero overhead)
- Canvas only unmounts when switching to a non-drawing tool (select, pan, eraser, etc.)

### Canvas component architecture (from decisions above)
- One shared drawing Canvas component for pen + highlighter (FabricDrawingCanvas or similar)
- Separate eraser Canvas component (different behavior: loads all annotations, SVG hidden)
- Drawing tools (pen, highlighter): Canvas transparent overlay, SVG visible underneath
- Eraser tool: Canvas opaque (shows all annotations), SVG hidden

### Claude's Discretion
- Canvas component naming and internal structure
- React key prop strategy for clean mount/unmount
- Fabric.js Canvas disposal approach (async dispose() + StrictMode compatibility — spike from STATE.md blocker)
- Brush configuration details (PencilBrush setup, stroke smoothing)
- Eraser boolean path geometry implementation (reuse existing `geometryEraser.js`)
- How annotation loading into eraser Canvas works (enlivenObjects vs manual recreation)
- Z-index layering between SVG and Canvas elements

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 10 requirements
- `.planning/REQUIREMENTS.md` — EDIT-01 through EDIT-05, EDIT-09, EDIT-10 define Canvas editing requirements
- `.planning/ROADMAP.md` — Phase 10 success criteria and dependency on Phase 9

### Architecture decisions
- `.planning/PROJECT.md` — Core constraints: Fabric.js 5.5.2, zero new deps, same JSON format
- `.planning/STATE.md` — Blocker: "Validate async dispose() + React StrictMode rapid tool switching (spike recommended)"

### Prior phase context
- `.planning/phases/08-svg-display-foundation/08-CONTEXT.md` — SVG display decisions, renderer toggle, visual fidelity standards
- `.planning/phases/09-svg-selection-interaction/09-CONTEXT.md` — Selection handles, persistence & undo patterns, Supabase sync debounce (2-3s)

### SVG layer (Phase 8-9 foundation)
- `src/components/SVGAnnotationLayer.jsx` — Display component with `activeTool` prop, `onSaveAnnotations` callback, `onRequestEditMode` callback. Canvas overlay will sit above this.
- `src/hooks/useSVGInteraction.js` — Interaction hook with tool-dependent pointer events. Must coordinate with Canvas mount.
- `src/utils/svgAnnotationRenderers.jsx` — SVG rendering functions for all 7 types

### Current pen/eraser implementation (reference for porting)
- `src/PageAnnotationLayer.jsx` — Lines ~4874-4906: tool switching + brush setup. Lines ~5274-5277: PencilBrush creation. Lines ~5483: path:created save handler. Lines ~2352-2714: eraser logic (clipPath, boolean path ops)
- `src/utils/geometryEraser.js` — `splitPathDataByEraser()`, `booleanErasePath()` — boolean path intersection/subtraction for eraser

### Current tool state management
- `src/App.jsx` — Line ~11252: `activeTool` state. Line ~11434-11450: tool category tracking (lastDrawTool, lastShapeTool). Already passes `activeTool` to SVGAnnotationLayer.

### Canvas lifecycle reference
- `src/utils/debugBridge.js` — Has `fabricCanvas` references for Canvas disposal patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `geometryEraser.js`: Boolean path intersection/subtraction logic — reuse directly for eraser Canvas operations
- `SVGAnnotationLayer.jsx`: Already accepts `activeTool` prop and `onSaveAnnotations` callback — the integration points for Canvas mount/unmount are plumbed
- `useSVGInteraction.js`: Tool-dependent `pointerEvents` on wrapper div — 'none' for drawing tools means Canvas receives all pointer events
- PAL pen brush setup (lines ~5274-5277): PencilBrush configuration to port to new drawing Canvas
- PAL path:created handler (line ~5483): Stroke serialization pattern to port for per-stroke commit

### Established Patterns
- Undo system: Full-page snapshot via `saveAnnotationCheckpoint` in App.jsx (50-checkpoint cap). Per-stroke undo means each `path:created` creates one checkpoint.
- Supabase sync: Debounced 2-3 seconds after local commit (decided in Phase 9, maintain consistency)
- Tool switching: `activeTool` state in App.jsx, tracked via `activeToolRef` for event handlers
- Canvas disposal: Must handle async `dispose()` — existing PAL cleanup patterns are reference

### Integration Points
- `SVGAnnotationLayer.jsx`: Canvas overlay mounts as a sibling (or child) of the SVG layer, conditionally based on `activeTool`
- `App.jsx` tool state: `activeTool` drives Canvas mount/unmount — drawing tools mount, others unmount
- `App.jsx` undo system: `saveAnnotationCheckpoint` called on each stroke commit AND each erase commit
- `App.jsx` annotation data: `onSaveAnnotations` callback updates `annotationsByPage` state for SVG re-render

</code_context>

<specifics>
## Specific Ideas

- Pen↔highlighter switching should be seamless — just a brush config change, no Canvas lifecycle disruption
- Eraser loading indicator is a brief cursor change (wait → eraser cursor), not a modal spinner
- Stroke commit is per-stroke to SVG (immediate visual) + debounced Supabase sync — same pattern as Phase 9 drag/resize

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-canvas-mount-unmount-pen-eraser*
*Context gathered: 2026-03-26*
