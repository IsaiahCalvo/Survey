# Project Research Summary

**Project:** SVG Migration -- SVG Display + Fabric.js Edit-Only Architecture
**Domain:** PDF annotation layer architecture migration
**Researched:** 2026-03-23
**Confidence:** HIGH

## Executive Summary

This project migrates the existing Fabric.js-Canvas-only annotation rendering system to a hybrid SVG display / Canvas edit-only model. The core insight from all four research streams is the same: the browser's native SVG viewBox mechanism solves the zoom coordination problem automatically, eliminating the need for the 5-timer/confirm-pending system and all the race conditions that come with it. The recommended architecture is straightforward -- an always-present SVG layer renders committed annotations at all zoom levels with zero code, and a conditionally-mounted Fabric.js Canvas appears only when the user is actively drawing, erasing, or editing text. React controls both layers through standard lifecycle patterns with no new dependencies required.

The recommended approach is to migrate LightweightAnnotationOverlay.jsx into a full SVGAnnotationLayer component handling all 7 annotation types with proper pathOffset correction, then wire pen/eraser/text tools to conditionally mount an EditCanvas component. The SVG coordinate system (viewBox in PDF page units) and the Fabric.js coordinate system are identical -- both work in unscaled PDF page points -- so there is no coordinate conversion anywhere in the architecture. This makes annotation data portable between the two layers without transformation.

The primary migration risk is pathOffset: Fabric.js Path objects store an internal offset that is automatically applied during Canvas rendering but must be manually applied as a negative translate when rendering paths in SVG. Missing pathOffset on pen/highlight strokes will cause immediate, visible position errors on the most-used annotation type. The second risk is avoiding the temptation to reach for SVG manipulation libraries (SVG.js, interact.js) that fight React's DOM ownership -- the v1.0 Phase 4 failure was caused by exactly this pattern. Both risks have clear, tested prevention strategies documented in the research.

## Key Findings

### Recommended Stack

Zero new runtime dependencies are needed. All capabilities required for SVG display, hit testing, selection handles, drag/resize, and Canvas mount/unmount are provided by native browser SVG APIs, React's rendering model, and the existing Fabric.js 5.5.2 installation. Adding a library like SVG.js or interact.js would introduce a second DOM manager competing with React, which is the root cause of the existing timer-coordination bugs.

**Core technologies:**
- **React 18.2.x**: SVG element rendering and DOM ownership -- React JSX renders SVG natively; all SVG attributes flow through React props/state, preventing reconciliation conflicts
- **Fabric.js 5.5.2**: Canvas editing scope reduced to pen/eraser/text edit only -- conditionally mounted per tool activation; dispose API used in useEffect cleanup
- **Syncfusion React PDF Viewer 32.1.19**: Unchanged -- SVG layer sits on top of existing Syncfusion page divs; the zoom system (beginSyncfusionScaleConfirmPending, onScaleApplied) is not modified
- **Native SVG + DOM pointer events**: Hit testing, drag, resize, selection handles -- 50-80 lines of React SVG replaces any external library for all interaction needs
- **SVGGeometryElement.isPointInFill/isPointInStroke**: Precise hit testing on thin strokes -- baseline widely available since July 2020, fully supported in Electron (Chromium)

See STACK.md for full rejection rationale for SVG.js, interact.js, and subjx.

### Expected Features

The feature set divides into two tiers: foundation rendering (SVG layer) and tool integration (Canvas mount/unmount per tool).

**Must have (table stakes):**
- All 7 annotation types render correctly in SVG -- pen/highlight paths, lines, arrows, shapes, callouts, text
- viewBox auto-scaling on zoom -- set once, browser handles all zoom levels with zero code
- pathOffset correction on all Fabric.js Path objects -- critical for correct pen/highlighter positioning
- Click-to-select with selection handles -- 8 corner/edge handles rendered as SVG rects, scale-compensated
- non-scaling-stroke on stroke-based annotations and handles -- `vector-effect="non-scaling-stroke"` keeps widths consistent
- Pen/highlighter drawing via Canvas mount -- existing PencilBrush, mounted conditionally on tool activation
- Commit pen stroke to SVG -- extract Fabric JSON, add to annotation store, unmount Canvas, SVG re-renders
- Text editing via Canvas mount -- mount over annotation bounding box, commit on deselect/blur
- Eraser tool via Canvas mount -- load all page annotations into Canvas, use Fabric eraser brush, commit

**Should have (differentiators):**
- Drag to move annotation in SVG select mode -- avoids Canvas mount for basic repositioning; pointer events + SVG coordinate conversion
- Resize via handles in SVG -- resize without Canvas mount for most annotation types
- Zero-flicker zoom -- the primary motivation for this migration; automatic with viewBox
- Cursor feedback on hover and handle hover -- CSS cursor property on SVG elements
- Correct z-order rendering -- sort annotations by creation/stacking order before SVG render

**Defer (v2+):**
- Rotation in SVG select mode -- complex handle math; use Canvas mount for rotation instead
- Multi-annotation drag in SVG -- single-select move only for now
- Touch gesture editing -- desktop-first Electron app; touch editing is a future milestone
- Targeted Canvas mount on annotation bbox only -- start with full-page Canvas, optimize later

### Architecture Approach

The layered z-index model is the correct foundation: Syncfusion PDF page at z-10, SVG layer always present at z-20, Fabric Canvas conditionally present at z-30. Three new components handle the migration: SVGAnnotationLayer (renders committed annotations, handles selection and pointer interaction), EditCanvas (manages Fabric.js lifecycle via useEffect, fires onCommit), and AnnotationToolManager (state machine coordinating which layer is active). LightweightAnnotationOverlay is retired and its rendering code is migrated into SVGAnnotationLayer.

**Major components:**
1. `SVGAnnotationLayer` -- always-present SVG element rendering all committed annotations; handles click selection, selection handle UI, drag/resize via pointer events
2. `EditCanvas` -- conditionally-rendered Fabric.js Canvas; created on tool activation, disposed on tool deactivation or zoom start; fires `onCommit` with updated JSON
3. `AnnotationToolManager` -- React state machine deciding which layer is active and what mode each layer is in; coordinates SVG view mode vs Canvas edit mode
4. `App.jsx` (modified) -- passes annotation data and zoom state down; receives committed edits up; existing zoom system untouched

**Key data flow:** User selects pen tool -> AnnotationToolManager sets mode DRAW -> EditCanvas mounts -> user draws stroke -> zoom event fires -> auto-commit in-progress stroke -> CSS transform on Canvas for visual feedback -> settle debounce (200ms) -> Canvas remounts at new dimensions. SVG layer scales automatically throughout via viewBox.

### Critical Pitfalls

1. **Missing pathOffset on pen/highlight paths** -- Apply `translate(-(pathOffset.x), -(pathOffset.y))` as the inner transform on every Fabric.js Path element rendered in SVG. Missing this causes all freehand annotations to appear 50-200px offset from their correct position. This is the single most likely regression during migration and the known gap in the existing LightweightAnnotationOverlay code.

2. **Fabric.js dispose() is async in useEffect cleanup** -- Null the fabricRef immediately in cleanup, then call dispose() without await (the Promise resolves in background after React removes the DOM element). Guard all canvas operations with `if (!fabricRef.current) return`. Use React StrictMode during development -- it double-mounts and will surface stale-ref errors before production.

3. **Two rendering systems fighting over SVG DOM** -- Do not use SVG.js, interact.js, subjx, or any library that mutates SVG element attributes directly. React must be the sole owner of the SVG DOM tree. External mutation makes React's virtual DOM stale and causes flicker, position jumps, and lost event handlers on re-render. This is the documented v1.0 Phase 4 failure pattern.

4. **Manual scale multiplication instead of viewBox** -- Never multiply annotation coordinates by the zoom scale factor in the SVG layer. LightweightAnnotationOverlay uses `preview.left * safeScale` and that is exactly the pattern being replaced. All coordinates are stored and rendered in unscaled PDF page units; viewBox handles display scaling at the browser engine level. Any `* scale` or `* zoom` in SVG coordinate math is a bug.

5. **Pointer events blocked by SVG root** -- Set `pointer-events: none` on the SVG root element and `pointer-events: auto` only on annotation `<g>` elements. Without this, the SVG element captures all clicks before they reach either the PDF content or the individual annotation groups.

## Implications for Roadmap

The feature dependency tree and the pitfall risk surface together suggest a 4-phase structure that builds from foundation rendering up through full tool integration.

### Phase 1: SVG Display Foundation

**Rationale:** Everything else depends on SVG rendering being correct. Establishing the viewBox coordinate system, migrating all 7 annotation types, and proving pathOffset correction is working must happen before any interaction work. This phase has the clearest acceptance criterion: SVG output visually matches Canvas output for all annotation types at all zoom levels.

**Delivers:** SVGAnnotationLayer component rendering all 7 annotation types correctly with no flicker at any zoom level. Retires LightweightAnnotationOverlay.

**Addresses:** All table-stakes display features -- all 7 types render, viewBox auto-scaling, pathOffset correction, non-scaling-stroke, z-order.

**Avoids:** Pitfall 4 (manual scale multiplication -- viewBox only from day one), Pitfall 1 (pathOffset -- test every annotation type against Canvas rendering as explicit acceptance criterion).

**Research flag:** Standard patterns. viewBox, React SVG rendering, and Fabric JSON structure are well-documented. LightweightAnnotationOverlay provides 80% of the implementation. No additional research phase needed.

### Phase 2: SVG Selection and Interaction

**Rationale:** Once rendering is correct, add interactivity. Selection must precede drag/resize because those operations require a selected annotation. Establishing the pointer event architecture at this phase also locks in the correct `pointer-events: none` on root / `auto` on groups pattern before tool integration adds layers of complexity.

**Delivers:** Click-to-select with selection handles at scale-compensated sizes, drag-to-move, resize via corner/edge handles, cursor feedback on hover.

**Addresses:** Click-to-select, selection visual feedback, drag/move, resize, cursor feedback (all from must-have and should-have lists).

**Avoids:** Pitfall 5 (pointer events blocked -- root none, group auto), Pitfall 6 (handle sizing at extreme zoom -- divide by currentScale, use non-scaling-stroke), Pitfall 3 (two systems fighting -- no external drag libraries).

**Research flag:** Standard patterns. Pointer events + SVG coordinate conversion is well-documented. Scale-compensated handle sizing is straightforward math provided in ARCHITECTURE.md.

### Phase 3: Canvas Mount/Unmount -- Pen and Eraser

**Rationale:** Pen tool is the most-used annotation creation tool. Implementing it first validates the Canvas mount/unmount lifecycle with the simplest case (drawing from scratch, no pre-existing annotation to load into Canvas). Eraser is bundled here because it also uses a full-page Canvas mount and the same commit flow.

**Delivers:** EditCanvas component with React-managed Fabric.js lifecycle, pen tool integration (mount -> draw -> commit -> unmount), eraser integration, auto-commit on zoom start.

**Addresses:** Pen/highlighter drawing, commit pen stroke to SVG, eraser tool (all table stakes).

**Avoids:** Pitfall 2 (async dispose -- null ref immediately, guard all operations), Pitfall 8 (rapid tool switching -- key-based remounting or 50ms debounce), Pitfall 9 (stroke loss during zoom -- commit on zoom start before applying CSS transform).

**Research flag:** The async dispose() + React StrictMode double-mount interaction during rapid tool switching should be validated with a targeted spike. The general pattern is documented (Fabric.js issue #8899) but edge cases in the rapid-switch scenario need real test coverage before the phase is considered complete.

### Phase 4: Text Editing and Polish

**Rationale:** Text editing via Canvas mount is the most complex tool integration because it requires positioning the Canvas precisely over an existing annotation's bounding box. Deferring it allows the mount/unmount lifecycle to be fully validated in Phase 3 first. Polish items (foreignObject text rendering, z-order edge cases, thin stroke hit testing) are consolidated here.

**Delivers:** Text annotation editing via Canvas mount over annotation bounding box, foreignObject text rendering in SVG display, final cross-zoom and cross-tool edge case validation.

**Addresses:** Text editing (table stake), foreignObject text rendering, z-order correctness, thin stroke hit testing.

**Avoids:** Pitfall 7 (foreignObject inconsistencies -- match CSS to Fabric text props, accept cosmetic differences), Pitfall 10 (preserveAspectRatio -- use "none"), Pitfall 11 (Firefox sub-pixel rounding -- integer viewBox values), Pitfall 12 (z-order -- sort by creation order), Pitfall 13 (thin stroke hit testing -- invisible hit-area path with expanded strokeWidth behind visible path).

**Research flag:** foreignObject text rendering differences between HTML layout and Fabric.js Canvas text are a known gap. A spike comparing actual font output side-by-side is recommended before Phase 4 planning. The acceptable pixel tolerance needs a product decision (exact match vs cosmetically close) before implementation begins.

### Phase Ordering Rationale

- Phases 1 and 2 must come in strict order: interaction requires correct rendering.
- Phase 3 before Phase 4: full-page Canvas mount for pen/eraser is simpler than targeted bbox-positioned Canvas mount for text editing. Validates the lifecycle pattern before adding positioning complexity.
- The existing zoom system in App.jsx (beginSyncfusionScaleConfirmPending, onScaleApplied, 300ms settle timer, container-aware sizing) is explicitly not changed in any phase. SVG viewBox eliminates the zoom coordination problem for the SVG layer without touching the existing zoom infrastructure. The only zoom interaction is the Canvas remount debounce in Phase 3, which is additive and does not replace existing behavior.
- Canvas is never kept permanently mounted and hidden -- this anti-pattern is prevented by only introducing Canvas in Phase 3 after SVG display is proven, removing the motivation to fall back to a hidden Canvas approach.

### Research Flags

Phases needing spikes or deeper research during planning:
- **Phase 3 (Canvas Mount/Unmount):** Validate async dispose() + React StrictMode rapid tool switching. Spike recommended before implementation.
- **Phase 4 (Text Editing):** foreignObject text rendering pixel tolerance vs Fabric.js Canvas text. Run font comparison with actual application fonts; get product decision on acceptable difference.

Phases with standard patterns (skip research-phase):
- **Phase 1 (SVG Display):** React SVG, viewBox, Fabric JSON structure all well-documented. LightweightAnnotationOverlay + Syncfusion-PDF-App reference provide 80% of the implementation.
- **Phase 2 (Selection/Interaction):** Pointer events + SVG coordinate conversion is a known pattern; reference code is already in ARCHITECTURE.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies; validated against LightweightAnnotationOverlay.jsx (existing, working) and Syncfusion-PDF-App reference. SVG.js/interact.js/subjx rejections each backed by specific GitHub issues showing the failure mode. |
| Features | HIGH | Feature list derived from existing tool behavior matrix (Obsidian vault) and LightweightAnnotationOverlay which already handles 5 of 7 annotation types. Gaps (arrows, callouts) are known and explicit. |
| Architecture | HIGH | Three-layer z-index model validated by multiple industry references (Nutrient, PDF.js, pdf-annotate.js, Hypothesis all use SVG overlays). viewBox coordinate system eliminates entire class of coordinate conversion bugs. |
| Pitfalls | HIGH | Each pitfall traced to either a documented GitHub issue, an existing bug in this codebase (container-aware sizing gotcha, 5-timer failure), or a specific browser API limitation. No speculative pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

- **LightweightAnnotationOverlay coverage:** Handles 5 of 7 annotation types. Before Phase 1 planning, inspect the existing `renderAnnotation` function to confirm which 2 types (likely arrows with arrowheads and callouts) need to be written from scratch vs migrated.

- **foreignObject text pixel tolerance:** Acceptable difference between Canvas text rendering and HTML text rendering in foreignObject is not formally decided. Needs a product decision before Phase 4 begins.

- **Eraser Canvas load time at scale:** PITFALLS.md estimates 100ms for 300 annotations loaded into Canvas for eraser mode. Whether this requires a loading indicator or progressive approach is a UX decision for Phase 3 planning.

- **Zoom system interaction during Canvas edit:** The existing 3000ms freeze window (beginSyncfusionScaleConfirmPending) and the new 200ms Canvas-remount debounce must be explicitly mapped against each other during Phase 3 planning to confirm no new timing conflict is introduced.

## Sources

### Primary (HIGH confidence)

- `LightweightAnnotationOverlay.jsx` (existing component in codebase) -- proves SVG overlay + viewBox pattern works with Syncfusion; provides 80% of Phase 1 implementation
- `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` (reference app) -- validates SVG layer + Syncfusion page div integration at production fidelity
- Obsidian vault `CC-SVG Migration Research.md` -- performance benchmarks, browser gotchas, annotation type mapping
- Obsidian vault `CC-Architecture Overview.md` -- z-index layer diagram, tool behavior matrix, 5-timer failure history
- [MDN isPointInFill](https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/isPointInFill) -- browser compat baseline July 2020
- [MDN isPointInStroke](https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/isPointInStroke) -- browser compat baseline July 2020
- [MDN vector-effect](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect) -- non-scaling-stroke browser support matrix
- [Fabric.js pathOffset PR #5668](https://github.com/fabricjs/fabric.js/pull/5668/files) -- pathOffset coordinate handling in Path objects

### Secondary (MEDIUM confidence)

- [Fabric.js dispose issue #8899](https://github.com/fabricjs/fabric.js/issues/8899) -- async dispose pattern in React; community consensus, needs local validation
- [Fabric.js dispose error #10482](https://github.com/fabricjs/fabric.js/issues/10482) -- unmount error patterns from async dispose
- [SVG.js plugin compat issue #1031](https://github.com/svgdotjs/svg.js/issues/1031) -- concrete evidence of two-system DOM conflict
- [interact.js SVG resize bug #202](https://github.com/taye/interact.js/issues/202) -- coordinate transform failure with scaled SVG viewBox
- [Scaling SVGs without scaling strokes (2025)](https://wildfirestudios.ca/blog/scaling-svgs-without-scaling-their-strokes-2025-edition/) -- practical non-scaling-stroke guide
- [SVG viewBox zoom mechanics](https://thecompetentdev.com/weeklyjstips/tips/47_svg_viewbox_zoom/) -- viewBox coordinate mapping explanation
- [Peter Collingridge SVG drag tutorial](https://www.petercollingridge.co.uk/tutorials/svg/interactive/dragging/) -- native SVG drag with pointer events pattern

### Tertiary (LOW confidence)

- Scalability estimates (50/300/1000 annotations per page render times) -- theoretical projections based on SVG DOM node count, not measured benchmarks against this application's actual annotation data. Validate during Phase 1.

---
*Research completed: 2026-03-23*
*Ready for roadmap: yes*
