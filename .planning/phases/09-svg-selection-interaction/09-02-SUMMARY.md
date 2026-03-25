---
phase: 09-svg-selection-interaction
plan: 02
subsystem: ui
tags: [svg, drag, resize, rotate, pointer-events, pointer-capture, interaction, fabric-json]

# Dependency graph
requires:
  - phase: 09-svg-selection-interaction
    plan: 01
    provides: useSVGInteraction hook (selection state, stubs), SVGAnnotationLayer (interactive), svgTransformMath, svgBoundingBox
provides:
  - Complete drag-to-move with pointer capture and cached CTM inverse
  - Resize-by-handle with anchor-point computation and Shift aspect ratio lock
  - Rotation via mtr handle with normalizeAngle (Fabric.js 0-360 convention)
  - Visual-only transforms during drag (no data mutation until pointerup)
  - onSaveAnnotations integration for move/scale/rotate persistence
  - SVGAnnotationLayer wired with onPointerMove and onPointerUp on root svg
affects: [09-03-multi-select, 10-canvas-edit-mode]

# Tech tracking
tech-stack:
  added: []
  patterns: [cached CTM inverse for drag duration, anchor-point resize, visual-only transform during drag]

key-files:
  created: []
  modified:
    - src/hooks/useSVGInteraction.js
    - src/components/SVGAnnotationLayer.jsx

key-decisions:
  - "Cached CTM inverse at drag start for entire drag duration (per RESEARCH.md Pitfall 1 -- CTM won't change during drag)"
  - "Resize updates scaleX/scaleY (not width/height) to match Fabric.js Canvas mode serialization"
  - "Anchor-point resize: opposite corner stays fixed, dragged handle determines new scale"
  - "Resize visual re-renders annotation with temporary modified props (not SVG transform)"

patterns-established:
  - "anchor-point resize: store opposite corner at drag start, compute scale from distance to anchor"
  - "rotation: normalizeAngle(atan2) with +90 offset for Fabric.js 12-o'clock convention"
  - "visual transform modes: move uses translate(), resize re-renders element, rotate uses rotate()"

requirements-completed: [INTR-04, INTR-05, INTR-06]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 9 Plan 02: Drag/Resize/Rotate Summary

**Drag-to-move with pointer capture, resize-by-handle with anchor point and Shift aspect ratio lock, rotation via normalizeAngle -- all persisting through onSaveAnnotations with undo checkpoints**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T00:12:12Z
- **Completed:** 2026-03-25T00:16:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Full drag-to-move with pointer capture lifecycle, cached CTM inverse, 2px micro-drag threshold, and page boundary constraints
- Resize via 8 handles (4 corners + 4 edges) with anchor-point computation, Shift aspect ratio lock, and 0.1 minimum scale
- Rotation via mtr handle using normalizeAngle with Fabric.js 12-o'clock convention (+90 offset from atan2)
- SVGAnnotationLayer wired with onPointerMove/onPointerUp, dynamic cursor (grabbing/crosshair), and resize visual re-rendering

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement drag-to-move in useSVGInteraction** - `41944d6` (feat)
2. **Task 2: Implement resize and rotation + wire all pointer handlers** - `c9decdb` (feat)

## Files Created/Modified
- `src/hooks/useSVGInteraction.js` - Added drag-to-move, resize, rotation logic with pointer capture, cached CTM, anchor-point resize, and normalizeAngle rotation
- `src/components/SVGAnnotationLayer.jsx` - Wired onPointerMove/onPointerUp on root svg, dynamic cursor, resize visual re-rendering with temporary modified props, rotation visual via SVG rotate() transform

## Decisions Made
- Cached CTM inverse at drag start for the entire drag duration -- per RESEARCH.md Pitfall 1, the CTM does not change during a single drag since zoom is not happening simultaneously
- Resize updates scaleX/scaleY rather than width/height to match how Fabric.js Canvas mode serializes interactive transforms (per RESEARCH.md Pitfall 4)
- Anchor-point resize stores the opposite corner at drag start; the dragged handle determines new scale from distance to anchor
- Resize visual re-renders the annotation element with temporary modified props (not a simple SVG transform) because scale changes affect rendered geometry
- Rotation visual uses SVG rotate() transform on the annotation wrapper <g> for smooth real-time feedback

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All single-annotation manipulation (select, move, resize, rotate) is complete
- Plan 03 (multi-select) can build on the existing selectedIds Set and drag infrastructure
- Group move will need to record original positions for all selected annotations (groupOriginals field already in dragStateRef)
- Vite build compiles cleanly with only pre-existing warnings

## Self-Check: PASSED

All 2 modified files verified on disk. All 2 task commits (41944d6, c9decdb) found in git history. Vite build compiles cleanly.

---
*Phase: 09-svg-selection-interaction*
*Completed: 2026-03-25*
