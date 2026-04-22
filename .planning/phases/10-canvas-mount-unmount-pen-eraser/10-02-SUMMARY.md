---
phase: 10-canvas-mount-unmount-pen-eraser
plan: 02
subsystem: ui
tags: [fabric.js, canvas, react, eraser, boolean-subtraction, geometry, svg]

# Dependency graph
requires:
  - phase: 10-canvas-mount-unmount-pen-eraser
    provides: useFabricCanvas hook, FabricDrawingCanvas, zoomGeneration signal, SVG visibility toggle
  - phase: 08-svg-display-layer
    provides: SVGAnnotationLayer, viewBox-based rendering, annotations JSON format
provides:
  - FabricEraserCanvas component with full-page annotation loading and boolean path subtraction
  - Eraser tool integration in App.jsx portal render (both Syncfusion and continuous scroll modes)
  - Complete pen + highlighter + eraser Canvas mount/unmount workflow
  - Mid-erase zoom flush via zoomGeneration signal
  - Pre-unmount erase commit on tool switch
affects: [11-text-shape-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [eraser-canvas-mount-unmount, boolean-path-subtraction-via-geometryEraser, enliven-objects-with-loading-state, isLoadingRef-stale-closure-avoidance, viewerScale-effectiveScale-radius-correction]

key-files:
  created:
    - src/components/FabricEraserCanvas.jsx
  modified:
    - src/App.jsx
    - src/components/FabricDrawingCanvas.jsx
    - src/hooks/useFabricCanvas.js
    - src/utils/geometryEraser.js

key-decisions:
  - "isLoadingRef mirrors isLoading state to avoid stale closure in mouse:down handler bound in useEffect([])"
  - "setPositionByOrigin for path positioning after erase (accounts for strokeWidth and scale)"
  - "booleanErasePath treats strokeWidth=0 paths as filled polygons for boolean subtraction"
  - "onBeforeDisposeRef pattern for pre-dispose cleanup flushes in-progress erase gesture"
  - "Eraser precision: viewerScale prop + adjusted radius = eraserSize * (viewerScale / effectiveScale)"
  - "Single-click erase: duplicate M point as L to create zero-length segment for geometry eraser"
  - "Mid-stroke flicker fix: flushSync during dispose forces synchronous SVG re-render before Canvas DOM removal"
  - "SVG wrapper cursor: 'default' when svgInteractive for instant cursor change on tool switch"
  - "Zoom while drawing fragment is expected behavior (ResizeObserver flush commits stroke, new stroke starts fresh)"

patterns-established:
  - "Eraser Canvas: load all annotations via enlivenObjects, boolean subtract, serialize entire canvas on commit"
  - "Loading guard: isLoadingRef.current checked in event handlers to prevent stale closure bugs"
  - "Radius correction: viewerScale/effectiveScale ratio compensates for container-aware vs viewer scaling mismatch"
  - "flushSync during dispose: forces synchronous React render so SVG layer shows stroke before Canvas DOM removal"

requirements-completed: [EDIT-04, EDIT-05]

# Metrics
duration: multi-session (3 sessions across ~17h wall time, ~2h active)
completed: 2026-03-27
---

# Phase 10 Plan 02: FabricEraserCanvas with Boolean Path Subtraction Summary

**FabricEraserCanvas loads all page annotations via enlivenObjects, performs boolean path subtraction with geometryEraser.js, and commits erased results to SVG per-gesture with zoom-flush and pre-unmount safety**

## Performance

- **Duration:** Multi-session (3 sessions, ~2h active coding/debugging)
- **Started:** 2026-03-26T21:12:00Z (Task 1 commit)
- **Completed:** 2026-03-27T18:07:00Z (cleanup commit)
- **Tasks:** 3 (create component, wire into App.jsx, verification + bug fixes)
- **Files modified:** 5 (FabricEraserCanvas.jsx, App.jsx, FabricDrawingCanvas.jsx, useFabricCanvas.js, geometryEraser.js)

## Accomplishments
- Created FabricEraserCanvas component with enlivenObjects annotation loading, boolean path subtraction via booleanErasePath, and per-gesture commit to SVG data
- Wired FabricEraserCanvas into both App.jsx portal render paths with conditional rendering when activeTool is eraser
- Fixed 10 bugs discovered during verification testing (eraser coordinates, zoom shift, single-use, single-click, precision mismatch, mid-stroke tool switch flicker, cursor update, undo keyboard shortcut, mid-stroke zoom handling, eraser radius mismatch)
- Cleaned up diagnostic console.logs after confirming eraser reliability

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FabricEraserCanvas component** - `412b629` (feat)
2. **Task 2: Wire FabricEraserCanvas into App.jsx portal render** - `9c50643` (feat)
3. **Task 3: Verification bug fixes (session 1)** - `39e3256` (wip), `c184fcb` (wip), `d00a1e1` (fix)
4. **Task 3: Verification bug fixes (session 2)** - `f9e12a8` (fix)
5. **Cleanup: Remove diagnostic console.logs** - `8025717` (chore)

## Files Created/Modified
- `src/components/FabricEraserCanvas.jsx` - Eraser Canvas with enlivenObjects loading, boolean path subtraction, per-gesture commit, zoom flush, pre-unmount commit
- `src/App.jsx` - FabricEraserCanvas import, conditional render in both portal paths, viewerScale prop, SVG wrapper cursor fix
- `src/components/FabricDrawingCanvas.jsx` - flushSync during dispose to prevent mid-stroke tool switch flicker, isDisposingRef flag
- `src/hooks/useFabricCanvas.js` - onBeforeDisposeRef pattern for pre-dispose callback (handles both drawing flush and erase flush)
- `src/utils/geometryEraser.js` - strokeWidth=0 path handling for filled polygon boolean subtraction

## Decisions Made
- **isLoadingRef pattern**: mouse:down handler bound in useEffect([]) captures stale isLoading=true state forever. Ref mirror updated simultaneously with setState avoids the stale closure.
- **setPositionByOrigin for erased paths**: After boolean subtraction changes path geometry, recalculate pathOffset and use setPositionByOrigin('center','center') to correctly position the result, accounting for strokeWidth.
- **Eraser precision correction**: Cursor overlay uses eraserSize * viewerScale for screen pixels. Canvas operates at effectiveScale (container-aware). Ratio viewerScale/effectiveScale corrects the mismatch.
- **Single-click erase**: When eraserPathData has only M point (no L), duplicate it as L to create a zero-length segment that the geometry eraser can process with its radius.
- **flushSync during dispose**: Forces synchronous SVG re-render so the committed stroke is visible in SVG before Canvas DOM is removed. Dev-mode React warning is expected and harmless.
- **Zoom while drawing fragment**: Documented as expected behavior. ResizeObserver flush commits the in-progress stroke, then canvas resizes. The user continues drawing a NEW stroke after resize, creating a gap. This is architecturally correct -- the stroke was committed to prevent data loss.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed eraser coordinate alignment**
- **Found during:** Task 3 (verification)
- **Issue:** Erased paths appeared offset from where the user drew the eraser stroke
- **Fix:** setPositionByOrigin(pathOffset, 'center', 'center') for correct coordinate space positioning
- **Files modified:** src/components/FabricEraserCanvas.jsx
- **Committed in:** 39e3256

**2. [Rule 1 - Bug] Fixed eraser zoom shift**
- **Found during:** Task 3 (verification)
- **Issue:** Eraser canvas stayed at initial dimensions after zoom, causing annotation misalignment
- **Fix:** Added ResizeObserver to keep eraser canvas sized to container after zoom changes
- **Files modified:** src/components/FabricEraserCanvas.jsx
- **Committed in:** 39e3256

**3. [Rule 1 - Bug] Fixed eraser single-use bug**
- **Found during:** Task 3 (verification)
- **Issue:** Eraser only worked once, then stopped responding to gestures
- **Fix:** geometryEraser.js treats strokeWidth=0 paths as filled polygons for boolean subtraction
- **Files modified:** src/utils/geometryEraser.js, src/components/FabricEraserCanvas.jsx
- **Committed in:** d00a1e1

**4. [Rule 1 - Bug] Fixed mid-stroke tool switch (deleted stroke)**
- **Found during:** Task 3 (verification)
- **Issue:** Switching tools mid-stroke caused the partial stroke to be lost
- **Fix:** onBeforeDisposeRef pattern: flush in-progress stroke/erase before canvas.off()/dispose()
- **Files modified:** src/hooks/useFabricCanvas.js, src/components/FabricDrawingCanvas.jsx, src/components/FabricEraserCanvas.jsx
- **Committed in:** d00a1e1

**5. [Rule 2 - Missing Critical] Added Cmd+Z/Ctrl+Z undo keyboard shortcut**
- **Found during:** Task 3 (verification)
- **Issue:** No keyboard shortcut for undo -- users expected Ctrl+Z to work
- **Fix:** handleUndoRef/handleRedoRef pattern with keydown listener
- **Files modified:** src/components/FabricDrawingCanvas.jsx
- **Committed in:** d00a1e1

**6. [Rule 1 - Bug] Fixed eraser single-click (no path created)**
- **Found during:** Task 3 (verification, session 2)
- **Issue:** Single click with eraser did nothing because path had only M point (no L)
- **Fix:** Duplicate M point as L to create zero-length segment for geometry eraser
- **Files modified:** src/components/FabricEraserCanvas.jsx
- **Committed in:** f9e12a8

**7. [Rule 1 - Bug] Fixed eraser precision (radius mismatch)**
- **Found during:** Task 3 (verification, session 2)
- **Issue:** Eraser deleted a larger area than the visual cursor circle suggested
- **Fix:** viewerScale prop + adjusted radius = eraserSize * (viewerScale / effectiveScale)
- **Files modified:** src/components/FabricEraserCanvas.jsx, src/App.jsx
- **Committed in:** f9e12a8

**8. [Rule 1 - Bug] Fixed mid-stroke tool switch flicker**
- **Found during:** Task 3 (verification, session 2)
- **Issue:** Stroke briefly disappeared when switching tools mid-stroke (Canvas removed before SVG updated)
- **Fix:** flushSync in path:created during dispose forces synchronous SVG re-render before Canvas DOM removal
- **Files modified:** src/components/FabricDrawingCanvas.jsx
- **Committed in:** f9e12a8

**9. [Rule 1 - Bug] Fixed cursor not updating on tool switch**
- **Found during:** Task 3 (verification, session 2)
- **Issue:** Cursor stayed as crosshair/eraser after switching to select tool until mouse moved
- **Fix:** SVG wrapper div gets cursor: 'default' when svgInteractive=true, overriding stale Canvas cursor
- **Files modified:** src/App.jsx
- **Committed in:** f9e12a8

---

**Total deviations:** 9 auto-fixed (7 bugs, 1 missing critical, 1 cursor UX)
**Impact on plan:** All auto-fixes necessary for correct eraser behavior and UX. No scope creep -- all fixes are within Phase 10 eraser and drawing tool scope.

## Known Limitations

1. **Zoom while drawing fragment**: When the user is mid-stroke and zoom occurs, the ResizeObserver flush commits the in-progress stroke, then the canvas resizes. If the user continues drawing, they start a NEW stroke (since the old one was committed). This creates a visual gap between the committed stroke endpoint and the new stroke startpoint. This is expected behavior -- the alternative (seamless continuation across zoom) would require significant architectural changes to bridge coordinates across different zoom levels.

## Issues Encountered
- Verification required 3 sessions across ~17h wall time due to cascading bug discovery -- each fix exposed the next issue (coordinate alignment -> zoom shift -> single-use -> precision -> flicker)
- geometryEraser.js had an edge case with strokeWidth=0 paths that caused it to return empty results, making the eraser appear to work once then stop

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete Canvas mount/unmount workflow is operational: pen, highlighter, and eraser all mount/unmount cleanly
- Phase 10 success criteria are met: strokes persist in SVG, eraser results persist in SVG, rapid tool switching is clean, mid-stroke zoom auto-commits
- Phase 11 (Text/Shape Editing + Zoom Cleanup) can proceed -- Canvas infrastructure is proven
- useFabricCanvas hook is battle-tested and ready for text/shape Canvas mounting in Phase 11

---
*Phase: 10-canvas-mount-unmount-pen-eraser*
*Completed: 2026-03-27*
