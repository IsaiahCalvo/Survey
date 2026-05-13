# Annotation Fix 10: Survey/Region Visibility

Date: 2026-05-11

## What Was Inspected

- `src/App.jsx`: survey highlight hydration gate, localStorage loading/saving, Supabase load/sync effects, realtime subscription handlers, survey highlight creation/deletion, undo snapshots, region assignment.
- `src/services/documentAnnotationService.js`: legacy survey highlight Supabase load/save/delete/realtime path.
- `src/utils/annotationVisibilityRules.js`: canvas, survey, region, and survey-region visibility rules.
- `src/components/SVGAnnotationLayer.jsx`: normal annotation filter and dedicated survey-highlight SVG rendering path.
- `src/components/FabricDrawingCanvas.jsx`, `FabricEditCanvas.jsx`, `FabricEraserCanvas.jsx`: survey-highlight creation routing, region metadata, owner-aware eraser/edit behavior.
- `src/hooks/useAnnotationCloudSync.js`: normal annotation cloud/Y.Doc hydration and local cache behavior.
- Existing tests around annotation hydration, visibility, local history, and sync contracts.

## What Was Wrong

- Survey highlights saved to `document_annotations` persisted `module_id` and `space_id`, but not `regionId`.
- The `document_annotations` table has no top-level `region_id` column, so survey-region highlights reloaded as plain survey highlights.
- Realtime survey highlight insert/update handling in `App.jsx` also dropped `regionId`.
- The debounced survey-highlight sync effect skipped when `highlightAnnotations` became empty, so deleting the last survey highlight could skip the delete-diff path.
- Dedicated survey-highlight SVG rendering did not expose the same detailed visible/hidden diagnostics as the main annotation SVG filter.
- Survey-highlight deletion did not explicitly enforce the current-user ownership contract before mutating local state.

## Files Changed

- `src/services/documentHighlightMapper.js`
- `src/services/documentAnnotationService.js`
- `src/App.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `tests/documentHighlightMapper.test.mjs`
- `tests/annotationVisibilityRules.test.mjs`

## Final Survey Highlight Contract

- Cloud-backed survey highlights start from `{}` and are hidden until the Supabase highlight load settles.
- Local `highlightAnnotations_*` data is not used as the first paint source for cloud-backed PDFs.
- Survey highlights persist through `document_annotations` rows with `annotation_type='highlight'`.
- Survey highlight `regionId` persists in `annotation_data.regionId`; `annotation_data.scope` records `survey` or `survey-region`.
- Survey highlights render only when survey mode is active with the matching selected module, unless they are pending local creation previews still governed by the same SVG visibility filter.
- Deleting the last survey highlight can now flow through the delete-diff sync path instead of returning early.
- Survey-highlight deletion is filtered to highlights authored by the current user when author metadata exists; legacy rows without author metadata keep legacy behavior.

## Final Region And Survey-Region Contract

- Canvas annotations: visible outside survey context unless page canvas visibility is off.
- Survey annotations: visible only in survey context for the selected module and page survey visibility.
- Region annotations: visible only when their owning space/region context is active.
- Survey-region annotations: require both matching survey context and matching region/space context.
- Page visibility controls do not hide region-scoped or survey-region-scoped annotations; region overlay state owns those.

## Intentional Exceptions

- Survey highlights still use the legacy highlight state map and Supabase `annotation_type='highlight'` path, not the normal Fabric/Y.Doc annotation row path.
- Region metadata for survey highlights is stored inside `annotation_data` because the existing table has no `region_id` column.

## Manual Test Steps And Results

- Started dev server: `npm run dev`, served at `http://localhost:5173/`.
- Opened app with Playwright.
- Enabled survey/region visibility diagnostics: `window.__DIAG_SURVEY_REGION_VISIBILITY = true`.
- Opened cloud-backed PDFs visible in the dashboard: `fix9-small.pdf` and `test.pdf`.
- Result: app opened the PDF tabs, but this Playwright run showed `0 of 1 pages rendered` for `fix9-small.pdf` and `0 of 3 pages rendered` for `test.pdf`; no SVG annotation wrappers mounted, so I could not honestly complete create/reload visual checks in-browser.
- No browser console errors were reported by Playwright during the run.

## Automated Test Commands And Results

- Red check: `node --test tests/annotationVisibilityRules.test.mjs tests/documentHighlightMapper.test.mjs`
  - Expected failure before implementation: missing `src/services/documentHighlightMapper.js`.
- Focused green check: `node --test tests/annotationVisibilityRules.test.mjs tests/documentHighlightMapper.test.mjs`
  - Result: 25 passed, 0 failed.
- Full test suite: `npm test`
  - Result: 571 tests total, 565 passed, 6 skipped, 0 failed.
- Syntax checks:
  - `node --check src/services/documentHighlightMapper.js`: pass.
  - `node --check src/services/documentAnnotationService.js`: pass.
  - `node --check src/utils/annotationVisibilityRules.js`: pass.
  - `node --check src/App.jsx` and `src/components/SVGAnnotationLayer.jsx`: Node 22 cannot check `.jsx` directly and returns `ERR_UNKNOWN_FILE_EXTENSION`.
- Build: `npm run build`
  - Result: pass. Vite reported existing bundle-size/dynamic-import warnings and a pdf.js eval warning.

## Console / Log Excerpts

Hydration path already emits:

```text
[AnnotationHydrationGate][survey] supabase highlights complete {"documentId":"...","pdfId":"...","count":N}
```

Survey highlight visibility diagnostics are now available with:

```js
window.__DIAG_SURVEY_REGION_VISIBILITY = true
window.__diagSurveyHighlightVisibilityStats
```

The diagnostic payload includes `inputCount`, `renderedCount`, mode context, and hidden buckets:

```text
[SurveyHighlightVisibility p1] {"inputCount":1,"renderedCount":0,"context":{"selectedModuleId":"module-1","showSurveyPanel":false},"dropReasons":{"surveyHidden":1}}
```

Normal annotation SVG diagnostics remain available at:

```js
window.__diagSVGFilterStats
```

## Remaining Risks / Follow-Up

- Manual visual verification was blocked by the local browser renderer not mounting pages in this session. Re-run manual steps in the desktop app or a browser session where PDF pages render.
- Existing repository worktree contained many unrelated modified/untracked files before this fix; this change avoided reverting them.
- Survey highlights remain on the legacy highlight path by design; a future unification with the normal annotation/Y.Doc path would be larger than this scoped fix.
