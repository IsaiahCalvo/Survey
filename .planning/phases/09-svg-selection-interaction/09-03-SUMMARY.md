---
phase: 09-svg-selection-interaction
plan: 03
subsystem: ui
tags: [svg, multi-select, group-operations, double-click, imported-paths, interaction]

# Dependency graph
requires:
  - phase: 09-svg-selection-interaction
    plan: 01
    provides: useSVGInteraction hook, SVGSelectionOverlay, svgBoundingBox utilities
  - phase: 09-svg-selection-interaction
    plan: 02
    provides: drag-to-move, resize-by-handle, rotation
provides:
  - Multi-select via shift-click with group bounding box
  - Group drag (move all selected annotations together, original+totalDelta pattern)
  - Group delete (reverse-index splice to preserve indices)
  - Double-click fires onRequestEditMode callback (bridge to Phase 10/11)
  - Imported PDF path support for drag, resize, and scale (isImportedPath, translatePathData, scalePathData)
  - SVG transform-based resize visual for imported paths
affects: [10-canvas-edit-mode, 11-text-shape-editing]

# Tech tracking
tech-stack:
  added: []
  patterns: [imported path coordinate manipulation, SVG transform for resize visual, group-move with drift prevention]

key-files:
  modified:
    - src/hooks/useSVGInteraction.js
    - src/components/SVGAnnotationLayer.jsx
    - src/components/SVGSelectionOverlay.jsx
    - src/utils/svgBoundingBox.js
---

# 09-03 Summary: Multi-select + Group Operations + Imported Path Support

## What Was Built

### Multi-select (INTR-07)
- Shift-click toggles annotations in/out of selection set
- Individual dashed boxes shown for each selected annotation (no handles)
- Union bounding box with handles computed via `getGroupBBox()`
- Group union box rendered with `strokeOpacity={0.6}` per UI-SPEC

### Group Operations (INTR-08)
- Group drag mode (`group-move`): records all selected annotations' original positions at drag start
- Position computed as `original + totalDelta` (not `current + frameDelta`) to prevent floating-point drift
- Each annotation individually constrained to page bounds
- `deleteSelected()`: removes all selected objects (reverse-index splice), calls `onSaveAnnotations`, then `deselectAll()`

### Double-click Edit Trigger (INTR-10)
- `handleAnnotationDoubleClick` calls `onRequestEditMode(index, type)`
- App.jsx logs the request — Phase 10/11 will replace with Canvas mounting

### Imported PDF Path Support (Bug Fix)
Critical fix: imported PDF annotations (from Adobe, Bluebeam, etc.) have absolute path coordinates with NO Fabric.js positioning properties (`left`/`top`/`width`/`height`/`scaleX`/`scaleY` are all undefined).

- `isImportedPath(obj)` — detects imported paths (type=path, no left property)
- `translatePathData(path, dx, dy)` — translates all path coordinates for drag-to-move
- `scalePathData(path, scaleX, scaleY, anchorX, anchorY)` — scales coordinates around anchor for resize
- `getPathBBox()` — scans path commands (`M`/`C`/`L`/`Z`) for min/max when no Fabric.js bbox exists
- All interaction code paths (single drag, group drag, resize, handle pointer down) check `isImportedPath()` and use bbox-derived values instead of `obj.left`/`obj.top`

### Additional Bug Fixes (Pre-plan session)
- Fixed SVG wrapper div blocking pan (conditional `pointerEvents` by tool)
- Fixed Syncfusion SVGAnimatedString crash (`stopPropagation` in select mode)
- Fixed path hit rects at (0,0,0,0) for imported annotations
- Fixed CSS `pointerEvents: 'fill'` unreliability (changed to SVG attribute)
- Removed debug console.log lines

## Decisions

- Wrapper div `pointerEvents` is tool-dependent: `'auto'` + `stopPropagation` for select/text-select, `'none'` for all other tools
- Hit rect uses SVG attribute `pointerEvents="all"` instead of CSS style
- Imported paths use SVG transform for resize visual (not re-rendering with modified scaleX/scaleY)
- Center-origin bbox for standard Fabric.js paths: `left = obj.left - scaledWidth/2`

## Known Issues (Deferred)

- Selection overlay bbox slightly oversized for some annotation types (padding visible at high zoom)
- Selection overlay does not follow annotation during drag (visual transform not applied to overlay)
- Both deferred to post-Phase 11 polish pass

## Verification

All 09-03 plan checks passed:
- `group-move` in useSVGInteraction: 8 occurrences
- `deleteSelected` in useSVGInteraction: 2 occurrences
- `getGroupBBox` in SVGAnnotationLayer: 2 occurrences
- `onRequestEditMode` in useSVGInteraction: 5 occurrences
- `affectedIds` in useSVGInteraction: 1 occurrence
- `strokeOpacity` in SVGSelectionOverlay: 2 occurrences
- Build passes cleanly

## Commits

- `2eae238` feat(09-03): add multi-select group operations and double-click edit trigger
- `5c64831` wip: fix SVG pointer event blocking + path bbox for imported annotations
- `a19205e` feat(09): add imported path support for drag, resize, and scale operations
