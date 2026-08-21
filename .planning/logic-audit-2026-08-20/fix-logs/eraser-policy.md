# KB-1 Part 1 — ink-only partial eraser

- Date: 2026-08-20
- Status: **partial** (Part 1 closed; Part 2 / `eraser-preview` still open)
- IDs closed this slice: **KB-1 Part 1 only** (ink-only `skip` policy + commit-path honor)
- KB-1 overall: still open until preview/topmost (`FabricEraserCanvas.jsx`) lands

## Files changed

- `src/utils/eraserPolicy.js` — `getEraserOperation(..., 'partial')` returns `'skip'` for non-ink (was `'entire'`)
- `src/utils/pageSpaceEraser.js` — skip-operation paths are not pushed into `pathGroups.full`; non-path whole-delete loop runs only when `mode` is `full`/`entire`
- `src/utils/surveyMarkerEraser.js` — `getSurveyMarkerEraserHitIds` takes `mode` (default `'entire'`) and skips when policy is `'skip'`
- `src/utils/eraserHitTest.js` — **unchanged** (geometry hit-test stays independent of policy)
- Tests: `tests/eraserPolicy.test.mjs`, `tests/pageSpaceEraser.test.mjs`, `tests/eraserAtomicWholeDelete.test.mjs`, `tests/surveyMarkerEraser.test.mjs`, **added** `tests/eraserInkOnlyPartial.test.mjs`

Did **not** edit: `FabricEraserCanvas.jsx`, `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`. No `zoomGeneration` / canvas-sizing / CORS changes. No commit.

## Intended behavior confirmed

Partial/pixel eraser is ink-only, matching Bluebeam/Acrobat/GoodNotes:

- Pen / highlighter / imported `/Ink` / tagged `paperInkGeometry: 'v1'` / legacy PencilBrush fingerprint → `'partial'` carve
- Every other annotation (rect, ellipse, line/arrow, text, stamp, cloud/shape paths, survey-marker rects) → `'skip'`
- Entire/full mode still returns `'entire'` and still whole-deletes on touch

`erasePageAnnotations({ mode: 'partial' })` over a stack of ink + a rectangle carves the ink and leaves the rectangle.

## Break / adversarial attempts

- Old tests that asserted “partial mode whole-deletes atomics” were inverted; entire/full counterparts still delete
- Atomic path-typed non-ink (`tool: 'rect'|'line'|…`, PDF `Line`/`FreeText`/`Highlight`) no longer promote to `pathGroups.full` in partial
- Survey-marker helper defaults to `'entire'` so existing callers that omit `mode` (live `FabricEraserCanvas`) do not silently lose entire-mode marker delete
- `canErase: () => false` still fail-closes; empty page / empty stroke is a no-op identity return

## Edges covered

| Case | Result |
|---|---|
| Intended use — mid-stroke bite on pen | geometry change, no delete |
| Overlapping ink — two stacked pens + far neighbor | both intersecting strokes carve; far stroke identity-preserved |
| Shape-under-ink — filled rect + pen, disk hits both | ink carved; rect reference unchanged; `deletedIds` empty |
| Empty points / empty page | `didChange: false`, page identity preserved |
| Locked (`canErase` false) | no-op; mixed lock carves only the permitted ink |
| Survey marker `mode: 'partial'` | `[]` |
| Survey marker empty list / `canErase` false | `[]` |
| Entire/full mode shapes + atomic paths | still whole-delete |

## Test command + result

```
node --test \
  tests/eraserPolicy.test.mjs \
  tests/eraserInkOnlyPartial.test.mjs \
  tests/eraserAtomicWholeDelete.test.mjs \
  tests/surveyMarkerEraser.test.mjs \
  tests/pageSpaceEraser.test.mjs \
  tests/eraserPreviewPlan.test.mjs
```

**101/101 pass** (exit 0). Full `npm test` not run.

## Remaining risk

Part 1 closes the **commit engine** (`erasePageAnnotations`) and the **policy function**. The live UI can still disagree until Part 2:

1. **Preview ghosts still treat `'skip'` as atomic.** `FabricEraserCanvas` `ghostAtomicHits` / `classifyEraserSegment` only special-case `=== 'partial'`; `'skip'` falls into `atomicIds` and still ghosts/hides shapes mid-drag even though commit now leaves them. Preview≠commit until those lanes early-return on `'skip'` / stop collecting atomics in partial mode.
2. **Survey-marker + callout delete lanes in `FabricEraserCanvas` do not pass `mode: 'partial'`.** Default `'entire'` keeps current live marker-delete in both modes. Helper is ready; caller must pass gesture mode.
3. **Legacy canvas path (`PageAnnotationLayer.jsx:6668`) still whole-deletes on `!== 'partial'`.** `'skip'` lands in the else-remove branch. Legacy/`?renderer=canvas` only.
4. **KB-1 Part 2 (topmost-only in entire mode) is not done.** Entire mode still deletes every touched object in a stack.

`zoomGeneration` and container-aware canvas sizing were not touched.
