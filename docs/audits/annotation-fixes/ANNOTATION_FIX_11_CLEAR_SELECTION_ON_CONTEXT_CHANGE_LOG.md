# Annotation Fix 11: Clear Selection On Context Change

Date: 2026-05-11

## Files Inspected

- `src/App.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/hooks/useSVGInteraction.js`
- `src/components/FabricEditCanvas.jsx`
- `src/components/FabricDrawingCanvas.jsx`
- `src/components/FabricEraserCanvas.jsx`
- `src/components/Callout/*`
- `src/sidebar/SpacesPanel.jsx`
- `package.json`

## Selection Systems Found

- SVG annotation selection: `useSVGInteraction` owns `selectedIds`, `hoveredId`, `visualTransform`, `deselectAll`, and renders SVG selection boxes/handles through `SVGAnnotationLayer`.
- Callout selection: `App.jsx` owns `selectedCalloutId` and `selectedCalloutIds`, passed into `SVGAnnotationLayer` for callout chrome and delete behavior.
- Fabric edit selection: `FabricEditCanvas` owns Fabric active-object state while editing. App-level `editingAnnotation` controls whether this canvas is mounted.
- Fabric drawing/eraser surfaces: `FabricDrawingCanvas` and `FabricEraserCanvas` use Fabric canvases for transient draw/erase interactions, but this fix does not delete or mutate their annotation data.
- Survey/region visibility context: `showSurveyPanel`, `selectedModuleId`, `selectedSpaceId`/`annotationSpaceId`, `activeSpaceId`, `activeRegionId`, `showRegionSelection`, `regionSelectionPage`, and region overlay toggles determine which annotations are visible.

## Code Changed

- Added `src/utils/annotationSelectionContext.js`.
  - Builds a stable annotation context key from survey, module, space, active region, and region-edit state.
  - Provides `didAnnotationSelectionContextChange` so initial mount does not clear selection.
- Updated `src/App.jsx`.
  - Added `annotationSelectionClearToken`.
  - Added `clearAnnotationSelectionForContextChange(reason)`.
  - Clears only UI state: SVG selection token, callout selected ids, edit-mode state, live edit bounds, annotation context menu/properties panel, pending SVG hover/selection, and local interaction diagnostics.
  - Does not call `handleSaveAnnotations`, does not change `annotationsByPage`, does not change `callouts`, and does not write history.
  - Runs cleanup when the normalized visible annotation context changes.
  - Also clears immediately when opening a region, closing a region, toggling region overlay visibility, and starting region creation/editing.
- Updated `src/components/SVGAnnotationLayer.jsx`.
  - Added `selectionClearToken` prop.
  - Added a layout effect that calls `deselectAll()` when the token changes.
  - Extended the existing pending selection command so `clearAll` clears the page selection.
- Added `tests/annotationSelectionContext.test.mjs`.
  - Covers survey enter/exit context changes.
  - Covers regular to region and region to region-drawing context changes.
  - Covers the initial-mount no-cleanup case.

## Why This Is Safe

- The cleanup is UI-only. It resets selection/edit state and asks mounted SVG layers to deselect.
- It does not delete annotations.
- It does not call any save/sync function.
- It does not create undo checkpoints.
- It does not bypass ownership rules; no annotation permission or mutation path is changed.
- Normal selection after the mode change is preserved because `SVGAnnotationLayer` remains mounted and `useSVGInteraction` can select again after `deselectAll()`.

## Commands Run

- `node --test tests/annotationSelectionContext.test.mjs`
  - Result: passed, 3 tests.
- `npm run build`
  - Result: passed.
  - Notes: existing Vite/pdfjs warnings about eval, dynamic imports, and large chunks.
- `npm test`
  - Result: passed.
  - Summary: 574 tests, 568 passed, 6 skipped, 0 failed.
- After fixing a helper initialization ordering issue found in the browser:
  - `node --test tests/annotationSelectionContext.test.mjs`
    - Result: passed, 3 tests.
  - `npm run build`
    - Result: passed with the same existing warnings.
  - `npm test`
    - Result: passed, 574 tests, 568 passed, 6 skipped, 0 failed.

## Manual Browser Test

- Started dev server with `npm run dev`.
  - Port `5173` was in use, Vite served at `http://localhost:5174/`.
- Opened the app in the Codex in-app browser.
- Opened existing `test.pdf`.
- First attempt hit a real app error:
  - `ReferenceError: Cannot access 'clearAnnotationSelectionForContextChange' before initialization`.
  - Fixed by moving the helper definition above callbacks that reference it.
- Reloaded and reopened `test.pdf`.
  - App loaded.
  - PDF route showed `test.pdf`.
  - Annotation DOM was present: `[data-annotation-index]` count was 113, `[data-diag-svg-wrapper]` count was 1, `[data-callout-id]` count was 2.
- Could not complete the full visual selection-mode workflow in the in-app browser:
  - A lingering context-menu dialog remained visible in the accessibility tree.
  - Attempts to select a visible annotation through browser locators did not produce observable selection markup in the DOM snapshot.
  - Browser automation timed out while inspecting controls, resetting the browser scripting session.

## Limitations / Not Verified Manually

- I did not visually confirm a regular highlight selection box disappearing after entering survey mode.
- I did not visually confirm selection cleanup after exiting survey mode.
- I did not visually confirm region open/close or region creation cleanup.
- Automated coverage and build/test verification confirm the cleanup trigger logic and that the app compiles/tests after the UI-only clear path.

## Notes

- The app already had substantial unrelated dirty work in `src/App.jsx`, `src/components/SVGAnnotationLayer.jsx`, and many other files. This fix was kept to the context-cleanup path and did not revert unrelated changes.
