# KB-1 Part 1 — eraser policy verify

- Date: 2026-08-20
- Status: **restored** (was missing in this worktree)
- IDs: **KB-1 Part 1** (policy + engines). Part 2 canvas planner was already landed and was not edited.

## Verdict

**Restored, not intact.** On arrival, `getEraserOperation` still returned `'entire'` for partial + non-ink. `pageSpaceEraser` mapped that fallback to `'full'` (whole-delete) for ineligible paths and always whole-deleted touched non-paths. `surveyMarkerEraser` had no mode/policy gate. The live canvas `canErase` filter from Part 2 was covering the default SVG path; policy/engine did not match.

`getEraserOperation(annotation, 'partial')` now returns **`'skip'`** for non-ink.

## Files changed (Part 1 only)

- `src/utils/eraserPolicy.js` — partial + non-ink → `'skip'`
- `src/utils/pageSpaceEraser.js` — skip ineligible paths; do not whole-delete non-paths in partial
- `src/utils/surveyMarkerEraser.js` — `getEraserOperation(...) === 'skip'` drops marker hits
- Tests updated to the skip contract: `tests/eraserPolicy.test.mjs`, `tests/pageSpaceEraser.test.mjs`, `tests/eraserAtomicWholeDelete.test.mjs`, `tests/surveyMarkerEraser.test.mjs`
- Added `tests/eraserInkOnlyPartial.test.mjs` (was missing)

Did **not** edit: `FabricEraserCanvas.jsx` (Part 2), `PageAnnotationLayer.jsx`, `PDFViewer.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, inventory/matrix/FIX-LOG. No commit.

## What was restored

1. **Policy.** Partial eligible ink → `'partial'`. Partial everything else → `'skip'`. Entire / unknown mode still → `'entire'`.
2. **pageSpaceEraser.** In partial, `operation === 'skip'` returns before carve/delete. Non-path whole-delete only runs when `requestedMode === 'full'` (`entire`/`full`).
3. **surveyMarkerEraser.** Projected rects are never partial-eligible, so `mode: 'partial'` returns no hit ids. Entire / omitted mode still reports permitted hits (existing callers).

## Test command + result

```
node --test \
  tests/eraserPolicy.test.mjs \
  tests/eraserInkOnlyPartial.test.mjs \
  tests/eraserAtomicWholeDelete.test.mjs \
  tests/surveyMarkerEraser.test.mjs \
  tests/pageSpaceEraser.test.mjs \
  tests/eraserPreviewPlan.test.mjs \
  tests/fabricEraserCanvasPreview.test.mjs
```

**119/119 pass.** `getEraserOperation` skip contract holds; engines leave shapes/text/markers in partial; entire mode still whole-deletes; Part 2 preview/commit planner tests still pass.

## Remaining risk

- **Legacy PAL leftover (expected).** `PageAnnotationLayer.jsx` still whole-deletes when `getEraserOperation(...) !== 'partial'`. `'skip'` falls into the else-remove branch. Legacy / `?renderer=canvas` only. Serialized worker owns that file; not edited here.
- A caller that bypasses the canvas and invokes `erasePageAnnotations({ mode: 'entire' })` is still all-hits (Part 2 topmost lives in the canvas planner). Partial-mode engine callers are now skip-correct even without `canErase`.
