# KB-1 Part 2 — preview parity + entire-mode topmost

- Date: 2026-08-20
- Status: **closed for the live eraser** (default SVG / pdf.js path)
- IDs closed this slice: **KB-1 Part 2 + preview parity**
- KB-1 overall: **live path closed**. Legacy PAL leftover remains (see Remaining risk).

## Files changed

- `src/components/FabricEraserCanvas.jsx` — shared `planCanvasEraserHits` planner; preview + commit both use it
- Tests: `tests/eraserPreviewPlan.test.mjs` (preview≡commit for skip/carve/empty/locked), **added** `tests/fabricEraserCanvasPreview.test.mjs`, `tests/eraserPresentation.test.mjs` (commit helpers now pass `mode`)

Did **not** edit: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `eraserPolicy.js`, `pageSpaceEraser.js`, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`. `zoomGeneration` not removed/renamed. Canvas sizing still uses `preview.width / pageWidth` (container-measured), never `pageSize * scale`. No commit.

## What landed

1. **Preview matches commit on `skip`.** `classifyEraserSegment` / `ghostAtomicHits` no longer treat non-ink as atomic in partial mode. Shapes under ink stay visible mid-drag and stay after release.
2. **Survey-marker + callout lanes pass gesture `mode`.** Partial returns `[]` (ink-only). Entire still whole-deletes permitted overlay hits, ranked above `objects[]`.
3. **Entire mode is topmost-only.** Per eraser sample, one permitted winner: callouts outrank markers (SVG paint order), overlays outrank `objects[]`, objects rank by array index. Appearance composites rank/delete as one unit. Locked/foreign top objects do not shield an erasable one below. A long drag unions the top of each stack it crosses and never drills through a single stack.
4. **Commit uses the same planner.** `canErase` in entire mode is restricted to planner winners, so `erasePageAnnotations` cannot delete a shape the preview left.

## Intended behavior confirmed

- Partial: mid-stroke ink carve → `partialIds` only; `atomicIds` / overlay ids empty; `planPageEraserPreview` ≡ `erasePageAnnotations`
- Shape-under-ink: disk hits rect + pen → ink carves; rect not ghosted and not deleted
- Entire: stacked rects → only the upper object deletes

## Break / adversarial attempts

- Unrestricted `erasePageAnnotations({ mode: 'entire' })` still deletes both stacked rects (engine is all-hits). The canvas now filters `canErase` to topmost winners, so the live commit does not.
- Overlay `hitsSample: true` in partial mode still produces no callout/marker/atomic ids
- Entire mode without the planner would still over-delete; the break test keeps that contrast

## Edges covered

| Case | Result |
|---|---|
| Intended use — mid-stroke bite on pen | preview `partialIds` === commit `changedIds`; no delete |
| Shape-under-ink | no atomic ghost; rect reference unchanged |
| Overlapping ink | both intersecting strokes carve; far stroke identity-preserved |
| Empty stroke / locked (`objectAllowed` false) | no-op; preview `shouldPreview` false |
| Entire stacked rects | top only |
| Locked top object | next permitted object below wins |
| Long drag across two stacks | union of each stack's top; bottoms remain |
| Callout / marker over a rect | overlay wins; rect left |
| Callout + marker at same sample | callout wins |
| Imported appearance composite | all members of the winning group delete |
| Partial + overlay candidates | overlays ignored |

## Leftover (do not edit PAL here)

`PageAnnotationLayer.jsx:6668` still whole-deletes on `getEraserOperation(...) !== 'partial'`. `'skip'` falls into the else-remove branch. Legacy / `?renderer=canvas` only. Another worker owns that file.

## Test command + result

Focused:

```
node --test \
  tests/eraserPreviewPlan.test.mjs \
  tests/fabricEraserCanvasPreview.test.mjs \
  tests/eraserPresentation.test.mjs \
  tests/eraserSurveyScopeGate.test.mjs \
  tests/eraserInkOnlyPartial.test.mjs \
  tests/eraserPolicy.test.mjs \
  tests/pageSpaceEraser.test.mjs \
  tests/eraserAtomicWholeDelete.test.mjs \
  tests/surveyMarkerEraser.test.mjs
```

**164/164 pass** (exit 0) on the first focused batch; after the long-drag fixture fix, the preview/presentation subset is **67/67 pass**.

Full suite after touching `FabricEraserCanvas.jsx`: `node scripts/run-node-tests.mjs` — see worker return.

## Remaining risk

- **Legacy PAL** (`?renderer=canvas`) still whole-deletes skip targets and is not topmost. Live default path is the SVG eraser.
- `erasePageAnnotations` itself is still all-hits in entire mode. Topmost lives in the canvas `canErase` filter. A future caller that bypasses the canvas will over-delete.
- Mid-carve (`previewHasPartial`) overlay ghosting still lists every permitted overlay on the segment. Entire mode does not take that path (no ink carve).
- Concurrent remote insert between preview and commit is re-resolved at pointer-up against `annotationsRef`.

`zoomGeneration` and container-aware canvas sizing were not touched.
