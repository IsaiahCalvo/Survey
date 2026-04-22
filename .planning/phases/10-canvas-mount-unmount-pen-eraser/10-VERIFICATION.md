---
phase: 10-canvas-mount-unmount-pen-eraser
verified: 2026-03-27T18:30:00Z
status: human_needed
score: 4/4 success criteria implementated; human verification required for visual/UX behaviors
re_verification: false
human_verification:
  - test: "Pen strokes render at 60fps and persist in SVG after tool switch"
    expected: "Draw 3 pen strokes, switch to select — canvas-container div is gone from DOM, all strokes visible in SVG layer"
    why_human: "60fps smoothness is a visual/runtime property; DOM disappearance requires browser DevTools inspection"
  - test: "Highlighter multiply blend mode during drawing and in SVG"
    expected: "Highlight stroke shows yellow semi-transparent overlay that darkens overlapping ink (multiply blend), persists after switching to select"
    why_human: "Visual blend mode appearance cannot be verified statically"
  - test: "Pen-to-highlighter switching has no Canvas remount flicker"
    expected: "Switch pen -> highlighter without going to select: no flicker, brush color/width changes immediately"
    why_human: "Flicker is a visual runtime phenomenon, key prop excludes activeTool so no remount, but visual confirmation required"
  - test: "Eraser shows wait cursor briefly, then circle cursor when ready"
    expected: "Select eraser tool: system 'wait' cursor for 20-200ms while enlivenObjects loads, then cursor disappears and eraser circle overlay (from App.jsx z-index 99999) appears"
    why_human: "Loading state and cursor transition are runtime behaviors"
  - test: "Eraser removes annotation segments, result persists in SVG"
    expected: "Draw erase stroke through an annotation — gap appears in the path. Switch to select — SVG shows erased result"
    why_human: "Boolean path subtraction correctness and visual result require runtime testing"
  - test: "Rapid tool switching produces zero console errors"
    expected: "Cycle pen -> select -> eraser -> select -> pen -> highlighter -> select 5+ times rapidly: zero errors in browser console, no orphaned canvas-container elements in DOM"
    why_human: "Race conditions and orphaned DOM only verifiable at runtime"
  - test: "Cursor updates immediately on tool switch without requiring mouse movement"
    expected: "Switch eraser -> select: cursor updates immediately to default/pointer without needing to move mouse"
    why_human: "Known partial issue from .continue-here.md — SVG wrapper cursor:'default' fix may have resolved it; needs runtime confirmation"
  - test: "Mid-stroke tool switch auto-commits partial stroke"
    expected: "Select pen, hold mouse down while drawing, switch to select: partial stroke appears in SVG"
    why_human: "onBeforeDisposeRef flush + flushSync synchronous re-render are runtime behaviors"
  - test: "Mid-stroke zoom auto-commits in-progress stroke (no data loss)"
    expected: "Select pen, hold mouse down while drawing, press Ctrl+Plus to zoom: stroke commits to SVG. Note: a gap/fragment between committed stroke and any continuation is documented as expected behavior."
    why_human: "zoomGeneration signal and ResizeObserver flush are runtime behaviors; gap-vs-no-gap distinction requires visual verification"
---

# Phase 10: Canvas Mount/Unmount (Pen + Eraser) Verification Report

**Phase Goal:** Fabric.js Canvas mounts only when the user activates pen, highlighter, or eraser tools, captures the work, and unmounts cleanly

**Verified:** 2026-03-27T18:30:00Z
**Status:** human_needed — all automated checks pass; 9 items require human runtime verification
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC1 | Pen/highlighter draw -> tool switch -> strokes persist in SVG, no Canvas remains | IMPLEMENTED | FabricDrawingCanvas conditionally renders via `isDrawingTool`, commits per-stroke via `path:created` -> `onStrokeCommit` -> `handleSaveAnnotations`; canvas removed from DOM when tool switches |
| SC2 | Eraser removes annotation segment -> tool switch -> erased result persists in SVG | IMPLEMENTED | FabricEraserCanvas loads all annotations via `enlivenObjects`, applies `booleanErasePath` geometry subtraction, commits entire canvas via `onEraseCommit` -> `handleSaveAnnotations` |
| SC3 | Rapid tool switching: no lost strokes, no stale Canvas, no console errors | IMPLEMENTED | `onBeforeDisposeRef` flushes in-progress work before `canvas.off()/dispose()`; `useFabricCanvas` hook synchronously disposes; React key prop ensures clean unmount. Runtime verification needed. |
| SC4 | Mid-stroke zoom auto-commits (no data loss) | IMPLEMENTED | `zoomGeneration` state incremented at top of `beginSyncfusionScaleConfirmPending`; both Canvas components watch via `useEffect([zoomGeneration])`; `ResizeObserver` also flushes before resize. Known behavior: zoom creates a gap between committed stroke and continuation — documented as expected. |

**Score:** 4/4 success criteria implemented

---

## Required Artifacts

### Plan 10-01 Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `src/hooks/useFabricCanvas.js` | VERIFIED | Exists, 57 lines, exports `useFabricCanvas`, creates `new fabric.Canvas(...)`, calls `canvas.off()` then `canvas.dispose()` in cleanup, supports `onBeforeDisposeRef` callback |
| `src/components/FabricDrawingCanvas.jsx` | VERIFIED | Exists, 327 lines, memo-wrapped, `useFabricCanvas` called, `PencilBrush` setup, `path:created` handler with per-stroke `onStrokeCommit`, container-aware sizing via `setZoom(effectiveScale)`, `zoomGeneration` flush, `flushSync` during dispose, undo sync via annotation count comparison |
| `src/App.jsx` (Plan 01 additions) | VERIFIED | `import FabricDrawingCanvas` at line 68, `zoomGeneration` state at line 11306, `setZoomGeneration(prev => prev + 1)` at line 10161 inside `beginSyncfusionScaleConfirmPending`, conditional render in both portal paths |

### Plan 10-02 Artifacts

| Artifact | Status | Evidence |
|---|---|---|
| `src/components/FabricEraserCanvas.jsx` | VERIFIED | Exists, 454 lines, memo-wrapped, `useFabricCanvas` called, `enlivenObjects` annotation loading, `isLoadingRef` stale-closure guard, `booleanErasePath`/`splitPathDataByEraser` imported, per-gesture commit via `onEraseCommit`, `zoomGeneration` flush, `onBeforeDisposeRef` pre-unmount commit, `cursor: isLoading ? 'wait' : 'none'` |
| `src/App.jsx` (Plan 02 additions) | VERIFIED | `import FabricEraserCanvas` at line 69, `isEraserTool && <FabricEraserCanvas` in both portal paths (lines 25032, 25231), `viewerScale={scale}` prop passed, `eraserSize={eraserSize}` passed |

---

## Key Link Verification

| From | To | Via | Status | Evidence |
|---|---|---|---|---|
| `App.jsx` | `FabricDrawingCanvas` | `isDrawingTool && <FabricDrawingCanvas` | WIRED | Line 25013-25028 (Syncfusion), 25212-25228 (continuous scroll) |
| `App.jsx` | `FabricEraserCanvas` | `isEraserTool && <FabricEraserCanvas` | WIRED | Line 25032-25044 (Syncfusion), 25231-25243 (continuous scroll) |
| `FabricDrawingCanvas` | `useFabricCanvas` | `useFabricCanvas(` call in component body | WIRED | Line 81 |
| `FabricEraserCanvas` | `useFabricCanvas` | `useFabricCanvas(` call in component body | WIRED | Line 89 |
| `FabricDrawingCanvas` | `handleSaveAnnotations` | `onStrokeCommit` prop -> `path:created` handler | WIRED | Line 25024 (both portal paths); `onStrokeCommitRef.current(updated)` in path:created handler |
| `FabricEraserCanvas` | `handleSaveAnnotations` | `onEraseCommit` prop -> mouse:up handler | WIRED | Line 25039 (both portal paths); `onEraseCommitRef.current(updatedJSON)` in `applyEraserAndCommit` |
| `FabricEraserCanvas` | `geometryEraser.js` | `booleanErasePath(obj, eraserPath, radius)` | WIRED | Import at line 23, call at line 144 |
| `App.jsx SVG wrapper div` | `SVGAnnotationLayer` | `visibility: isEraserTool ? 'hidden' : 'visible'` | WIRED | Line 24982 (Syncfusion), line 25183 (continuous scroll) — SVG hidden during eraser mount |
| `App.jsx zoomGeneration` | Both Canvas components | `zoomGeneration={zoomGeneration}` prop | WIRED | Line 25027, 25042 (Syncfusion); 25226, 25241 (continuous scroll) |
| `beginSyncfusionScaleConfirmPending` | `setZoomGeneration` | `setZoomGeneration(prev => prev + 1)` at top of function | WIRED | Line 10161 — fires before SVG-mode early return, so signal fires in all zoom paths |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| EDIT-01 | 10-01 | Pen/highlighter mounts transparent Fabric.js Canvas over page for 60fps stroke capture | SATISFIED | `FabricDrawingCanvas` renders via `isDrawingTool`, zIndex 101, `isDrawingMode: true`, `PencilBrush` |
| EDIT-02 | 10-01 | Completed strokes serialized to Fabric.js JSON and committed to SVG layer | SATISFIED | `path:created` -> `e.path.toJSON(CUSTOM_PROPS)` -> `onStrokeCommit` -> `handleSaveAnnotations` -> `setAnnotationsByPage` |
| EDIT-03 | 10-01 | Canvas stays mounted while pen/highlighter active, unmounts on tool switch | SATISFIED | `key={`draw-${pageNumber}`}` excludes `activeTool` — pen<->highlighter reconfigures brush only; `isDrawingTool` conditional unmounts when switching to other tools |
| EDIT-04 | 10-02 | Eraser tool mounts Canvas and loads all page annotations for boolean path subtraction | SATISFIED | `FabricEraserCanvas` renders via `isEraserTool`, `enlivenObjects` loads all `annotations.objects`, `isLoadingRef` guards interaction until load complete |
| EDIT-05 | 10-02 | Eraser results serialized to Fabric.js JSON and committed to SVG layer on gesture complete | SATISFIED | `applyEraserAndCommit` -> `booleanErasePath` per object -> serialize entire canvas via `obj.toJSON(CUSTOM_PROPS)` -> `onEraseCommit` -> `handleSaveAnnotations` |
| EDIT-09 | 10-01, 10-02 | Canvas auto-commits unsaved changes before unmounting (no data loss on tool switch or zoom) | SATISFIED | (a) `onBeforeDisposeRef` flushes mid-stroke before `canvas.off()`/`dispose()`; (b) `zoomGeneration` flush via `useEffect`; (c) `ResizeObserver` flushes before container resize; (d) `flushSync` in `path:created` during dispose prevents flicker |
| EDIT-10 | 10-01, 10-02 | Canvas mount/unmount uses React state + key prop for clean Fabric.js creation/disposal | SATISFIED | `key={`draw-${pageNumber}`}` and `key={`erase-${pageNumber}`}` — React handles lifecycle; `useFabricCanvas` hook creates/disposes in `useEffect` |

**All 7 requirements claimed by Phase 10 are satisfied. No orphaned requirements.**

Requirements EDIT-06, EDIT-07, EDIT-08 are correctly assigned to Phase 11 and are not Phase 10 concerns.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `App.jsx` | 10166 | `console.log('[ConfirmPending] SKIPPED (SVG mode)')` | Info | Pre-existing zoom system diagnostic log, NOT a Phase 10 artifact. Not blocking. |
| `App.jsx` | 25006, 25205 | `console.log('[SVG p${pageNumber}] Edit mode requested...')` | Info | Placeholder for future edit mode handler (Phase 11 concern). Not blocking. |
| `.continue-here.md` | — | Documents 2 remaining bugs as open | Warning | Bug 1 (zoom fragment) is documented as accepted behavior. Bug 2 (cursor delay on eraser->select) may be resolved by SVG cursor fix added in f9e12a8. Needs human confirmation. |

No blockers found. No TODO/FIXME/placeholder comments in Phase 10 new files. No empty implementations. No return null/stubs.

---

## Human Verification Required

The following items cannot be verified programmatically and require opening the app.

### 1. Pen Drawing at 60fps + SVG Persistence

**Test:** Open http://localhost:5173/, load "Package 2 - Rev 4 -- IC.pdf", go to page 6. Select pen tool. Draw 3 strokes. Open DevTools Elements tab — confirm `<div class="canvas-container">` exists inside the portal overlay. Switch to select tool.
**Expected:** Canvas element disappears from DOM. All 3 strokes remain visible as SVG paths.
**Why human:** Rendering smoothness (60fps) is a visual property; DOM inspection requires browser DevTools.

### 2. Highlighter Multiply Blend

**Test:** Select highlighter tool. Draw a stroke over existing ink.
**Expected:** Yellow semi-transparent highlight darkens the ink underneath (multiply composite, not additive). After switching to select, the highlight persists with same multiply appearance.
**Why human:** Blend mode visual appearance cannot be verified statically.

### 3. Pen-to-Highlighter Switching (No Flicker)

**Test:** Select pen, draw a stroke. Switch to highlighter WITHOUT going through select. Draw a highlight stroke. Switch back to pen.
**Expected:** No flicker or canvas remount visible. Brush changes color/width immediately.
**Why human:** Flicker is a runtime visual phenomenon.

### 4. Eraser Loading State + Circle Cursor

**Test:** Select eraser tool.
**Expected:** System 'wait' cursor appears briefly (20-200ms while annotations load). Then cursor disappears and the eraser circle overlay (from App.jsx) becomes visible and tracks the pointer.
**Why human:** Loading state transition is a runtime behavior.

### 5. Eraser Boolean Subtraction + SVG Persistence

**Test:** With existing strokes on the page, select eraser. Draw erase stroke through an annotation.
**Expected:** The annotation has a gap where the eraser passed. Switch to select tool — SVG shows the erased result correctly. The gap should match the visual eraser circle size.
**Why human:** Geometric correctness of boolean path subtraction requires visual inspection.

### 6. Rapid Tool Switching — No Console Errors, No Orphaned DOM

**Test:** Switch rapidly: pen -> select -> eraser -> select -> pen -> highlighter -> select (repeat 5 cycles). Check browser console.
**Expected:** Zero JavaScript errors in console. No `<div class="canvas-container">` elements remaining in DOM after returning to select.
**Why human:** Race conditions and orphaned DOM only manifest at runtime.

### 7. Cursor Update on Tool Switch (Known Potential Issue)

**Test:** Select eraser tool (confirm eraser circle cursor appears). Switch to select/pan tool WITHOUT moving the mouse.
**Expected:** Cursor updates immediately to the default pointer. If cursor still shows wrong style, move mouse — it should snap to correct cursor.
**Why human:** This was a known bug from .continue-here.md; the SVG wrapper `cursor: 'default'` fix (commit f9e12a8) may have resolved it. Human confirmation needed.

### 8. Mid-Stroke Tool Switch Auto-Commit

**Test:** Select pen. Hold left mouse button down and start drawing. While still holding, switch to select tool (keyboard shortcut).
**Expected:** The partial stroke is committed and visible in SVG (no data loss). No flicker.
**Why human:** `onBeforeDisposeRef` flush + `flushSync` synchronous re-render are runtime behaviors.

### 9. Mid-Stroke Zoom Auto-Commit (Accepted Gap Behavior)

**Test:** Select pen. Hold left mouse button down and start drawing. While still holding, press Ctrl+Plus to zoom.
**Expected:** The in-progress stroke is auto-committed to SVG before the zoom resize. If the user continues drawing after zoom settles, a new stroke starts (there will be a visual gap between the committed stroke endpoint and the new stroke start — this is documented as accepted behavior, not a bug).
**Why human:** `zoomGeneration` signal and `ResizeObserver` flush are runtime behaviors; the "gap is acceptable" judgment requires user confirmation.

---

## Notes on Plan Acceptance Criteria Deviation

**`calcTransformMatrix` in FabricEraserCanvas:** The 10-02 plan acceptance criteria listed `calcTransformMatrix` as required. The actual implementation does not call `calcTransformMatrix` directly — instead, `booleanErasePath` takes the Fabric.js path object directly, and `geometryEraser.js` handles coordinate transforms internally (via `transformPointInverse` using the object's matrix). This is architecturally equivalent and more correct — the geometry is handled within the eraser utility rather than inline in the component. This is not a gap.

**Undo via Ctrl+Z:** The 10-01 plan's `must_haves.truths` included "Ctrl+Z while pen active removes last stroke." This is implemented globally in App.jsx (line 11256-11274) via `handleUndoRef`/`handleRedoRef` bound to `window` keydown. FabricDrawingCanvas has a `useEffect([annotations])` that detects annotation count decreases and removes the corresponding session path from the Canvas. The undo flow: Ctrl+Z -> App.jsx `handleUndo` -> history revert -> `annotationsByPage` decreases -> `annotations` prop to FabricDrawingCanvas decreases -> Canvas removes last session path + rerenders. This is fully wired.

---

## Known Limitations (Not Gaps)

1. **Zoom-while-drawing fragment:** When zoom occurs mid-stroke, the `ResizeObserver` flushes the commit, canvas resizes, and if the user continues drawing they start a fresh stroke. This creates a visual gap between the two strokes. Documented in 10-02-SUMMARY.md as expected/accepted behavior. The alternative (seamless continuation across zoom) would require significant architectural changes.

2. **`[ConfirmPending] SKIPPED (SVG mode)` log in App.jsx:** This is a pre-existing zoom system diagnostic from `beginSyncfusionScaleConfirmPending`. It is not a Phase 10 artifact and MUST NOT be removed without explicit user approval per CLAUDE.md restrictions on zoom system modifications.

---

_Verified: 2026-03-27T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
