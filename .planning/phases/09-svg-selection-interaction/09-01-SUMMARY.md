---
phase: 09-svg-selection-interaction
plan: 01
subsystem: ui
tags: [svg, selection, bounding-box, handles, pointer-events, resize-observer, react-hooks]

# Dependency graph
requires:
  - phase: 08-svg-display-foundation
    provides: SVGAnnotationLayer display component, svgAnnotationRenderers, fabricCustomization handle specs
provides:
  - svgTransformMath.js utility (screenToSVG, normalizeAngle, constrainToPage, getInverseScale, getCursorForHandle)
  - svgBoundingBox.js utility (getAnnotationBBox for all types, getGroupBBox, getHandlePositions)
  - useSVGInteraction hook (selection state, pointer event handlers, inverse scale)
  - SVGSelectionOverlay component (dashed bounding box, 8 resize handles, rotation handle)
  - SVGAnnotationLayer updated with click-to-select, hover feedback, selection overlay rendering
  - App.jsx updated to pass selection props and enable pointer events on SVG wrapper
affects: [09-02-drag-resize-rotate, 09-03-multi-select, 10-canvas-edit-mode]

# Tech tracking
tech-stack:
  added: []
  patterns: [inverse-scale SVG handles, ResizeObserver for container-aware scaling, useMemo filter + render-body wrap pattern]

key-files:
  created:
    - src/utils/svgTransformMath.js
    - src/utils/svgBoundingBox.js
    - src/hooks/useSVGInteraction.js
    - src/components/SVGSelectionOverlay.jsx
  modified:
    - src/components/SVGAnnotationLayer.jsx
    - src/App.jsx

key-decisions:
  - "useMemo refactored to filter-only (returns obj/index/element), wrapping in render body prevents re-render on selection change"
  - "inverseScale computed via ResizeObserver on SVG element -- container-aware per CLAUDE.md, not from zoom percentage"
  - "Selection clears on annotations prop identity change (new page or external edit)"

patterns-established:
  - "inverse-scale pattern: multiply SVG handle dimensions by inverseScale (1/currentScale) for constant visual pixel size"
  - "hit-area pattern: transparent rect overlaid on annotation for easier clicking, with conditional pointerEvents"
  - "isInteractive guard: drawing tools disable SVG pointer events via activeTool check"

requirements-completed: [INTR-01, INTR-02, INTR-03, INTR-09]

# Metrics
duration: 11min
completed: 2026-03-25
---

# Phase 9 Plan 01: Selection Foundation Summary

**Click-to-select SVG annotations with dashed bounding box, 8 resize handles (corners + pills), rotation handle, hover feedback, and zoom-independent handle sizing via inverse-scale ResizeObserver**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-24T23:57:11Z
- **Completed:** 2026-03-25T00:09:06Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Two utility modules providing coordinate math and bounding box computation for all annotation types
- Selection hook with click-to-select, shift-click toggle, hover, double-click edit mode, deselect-on-empty-space
- Pixel-perfect selection overlay matching Fabric.js Canvas handles (corners, pills, rotation)
- SVGAnnotationLayer upgraded from display-only to interactive with conditional pointer events
- App.jsx updated at both render sites (Syncfusion portal + continuous scroll) with new props

## Task Commits

Each task was committed atomically:

1. **Task 1: Create utility modules (svgTransformMath.js + svgBoundingBox.js)** - `80ba685` (feat)
2. **Task 2: Create useSVGInteraction hook + SVGSelectionOverlay component** - `d3e7f85` (feat)
3. **Task 3: Wire selection into SVGAnnotationLayer + update App.jsx wrapper** - `c743f70` (feat)

## Files Created/Modified
- `src/utils/svgTransformMath.js` - Coordinate conversion, angle normalization, page constraints, inverse scale, cursor mapping
- `src/utils/svgBoundingBox.js` - Bounding box computation for all annotation types, group union bbox, handle positions
- `src/hooks/useSVGInteraction.js` - Selection state management, pointer event handlers, ResizeObserver inverse scale
- `src/components/SVGSelectionOverlay.jsx` - Dashed bounding box rect, 4 corner circles, 4 pill rects, rotation handle with icon
- `src/components/SVGAnnotationLayer.jsx` - Added interaction hook, hit-area wrappers, hover outline, selection overlay rendering
- `src/App.jsx` - SVG wrapper div pointer events 'auto', new props (onSaveAnnotations, onRequestEditMode, activeTool) at both render sites

## Decisions Made
- Refactored useMemo to return `{ obj, index, element }[]` for filtering only; wrapping logic in render body prevents unnecessary re-computation on selection/hover changes
- inverseScale uses ResizeObserver on SVG element's clientWidth, not zoom percentage (per CLAUDE.md container-aware requirement)
- Selection auto-clears when annotations prop identity changes (new page loaded or external edit)
- No zoom/scale system code was touched in App.jsx (verified with git diff)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All utility APIs, hook interface, and overlay component ready for Plan 02 (drag/resize/rotate)
- handleHandlePointerDown is a stub -- Plan 02 fills in drag/resize/rotate logic
- visualTransform state is wired but unused -- Plan 02 populates during drag operations
- getGroupBBox ready for Plan 03 (multi-select group bounding box)
- Vite build verified: compiles cleanly with only pre-existing pdfjs-dist warnings

## Self-Check: PASSED

All 4 created files verified on disk. All 3 task commits (80ba685, d3e7f85, c743f70) found in git history. Vite build compiles cleanly.

---
*Phase: 09-svg-selection-interaction*
*Completed: 2026-03-25*
