# Annotation Fix 5: Eraser Hit Test

## Files Changed

- `src/components/FabricEraserCanvas.jsx`
- `src/utils/eraserHitTest.js`
- `tests/eraserHitTest.test.mjs`
- `src/App.jsx`

## Root Cause Found

`FabricEraserCanvas` admitted annotations into eraser commits using expanded Fabric bounding boxes. For non-path objects and whole-object path deletes, a point only had to fall inside `getBoundingRect() +/- eraserSize`; it did not have to touch the rendered annotation geometry.

That meant nearby objects, broad path-shaped imports, or objects sharing a large Fabric batch could be removed or rewritten even when the eraser stroke missed them. The downstream history and sync code then correctly persisted the oversized result it received, which matched the logs where `objectDelta` was smaller than `changedObjectsCount`.

## Exact Fix Made

- Added `src/utils/eraserHitTest.js` with shared eraser helpers:
  - samples the full eraser stroke, including segments between pointer events
  - tests sampled points against actual Fabric geometry through `isPointOnObject`
  - reports stroke bounds, final delete sets, `objectDelta`, and `changedObjectsCount`
- Updated `FabricEraserCanvas` so every Fabric object must pass geometry hit testing before it can be removed or partially erased.
- Removed the expanded-bounding-box delete gate for non-path objects and path-shaped whole-object deletes.
- Kept existing permission and space-scope checks before geometry checks.
- Preserved partial erasing for pen/highlighter path strokes after the precise touch gate.
- Passed eraser diagnostics into `handleSaveAnnotations` save context and emitted `[EraserHitTest]` console logs with:
  - eraser gesture id
  - pointer/stroke bounds
  - candidate annotation IDs
  - rejected annotation IDs with reason
  - touched annotation IDs
  - final deleted annotation IDs
  - `objectDelta`
  - `changedObjectsCount`

## Tests Run

- `node --test tests/eraserHitTest.test.mjs tests/annotationLocalHistory.test.mjs`
  - Pass: 10 tests passed.
- `npm test`
  - Pass: 529 passed, 6 skipped, 0 failed.
- `node --test tests/eraserHitTest.test.mjs`
  - Pass: 5 tests passed after the sampling-step cleanup.
- `npm run build`
  - First run: Pass.
  - Final run: Pass.

Build warnings were existing Vite/pdfjs chunk/eval warnings; no eraser-related compile failure.

## Manual Verification

No browser manual verification was performed. This fix was verified with targeted geometry/history tests, the full Node test suite, and production build.

## Remaining Risk Or Follow-Up

- `PageAnnotationLayer.jsx` still contains an older inline eraser path with similar-looking bbox-adjacent logic. The active Syncfusion/SVG eraser path fixed here uses `FabricEraserCanvas`; if the legacy PAL eraser surface is still reachable in a separate mode, it should receive the same shared `eraserHitTest` helper.
- Text boxes use rectangular hit geometry, not per-glyph hit testing. That matches current whole-object textbox erasing behavior.
