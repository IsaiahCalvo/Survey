# Annotation Fix 1 — Lightweight Overlay Log

## Files Changed

- `src/utils/annotationVisibilityRules.js`
- `src/components/LightweightAnnotationOverlay.jsx`
- `src/App.jsx`
- `tests/annotationVisibilityRules.test.mjs`

## Exact Bug Found

The pan/lightweight renderer was not receiving or applying the same data and visibility contract as the full SVG renderer.

1. `buildSyncfusionProxyPayloadForPage` stripped render-critical fields from proxy annotations:
   - `path`
   - `points`
   - child `objects`
   - line endpoints
   - `moduleId`
   - `regionId`
   - `layer`
   - `data`

   That made imported paths, polygons, polylines, arrows/groups, counters, scoped annotations, and some line-like annotations render differently or not render in lightweight mode.

2. `LightweightAnnotationOverlay` duplicated its own survey-only checks and skipped `object.visible === false`.

   The full SVG renderer intentionally ignores that persisted Fabric `visible` flag because it is a transient runtime flag that can be serialized. Lightweight mode honoring it caused annotations to disappear in pan/proxy mode and then reappear when switching back to SVG-backed tools.

3. Survey highlights are rendered by the full SVG layer from `surveyHighlights`, not by the lightweight overlay. Suspending full SVG while survey highlights are present can hide those highlights.

## Exact Fix Applied

1. Added shared visibility helpers in `annotationVisibilityRules.js`:
   - `getSpaceIdForRegionFromSpaces`
   - `isAnnotationVisibleInContext`

   The helper mirrors the SVG layer's survey, region, active-space, page visibility, and layer visibility rules, while intentionally ignoring Fabric's transient `visible` flag.

2. Updated `LightweightAnnotationOverlay` to:
   - use `isAnnotationVisibleInContext`
   - receive the same visibility props as `SVGAnnotationLayer`
   - skip legacy `highlightId` objects like the SVG layer
   - support polygon/polyline previews
   - support counter display text
   - expose `data-lightweight-annotation-overlay`, `data-lightweight-object-count`, and `data-lightweight-callout-count` for verification

3. Updated `App.jsx` proxy payload generation to preserve render and visibility metadata:
   - `highlightId`, `pdfAnnotationId`
   - `moduleId`, `regionId`, `layer`, `data`
   - `x1`, `y1`, `x2`, `y2`
   - `path`, `points`, child `objects`

4. Removed the proxy payload's ad hoc survey filtering and `visible === false` filter. Lightweight now owns visibility through the shared helper.

5. Passed the visibility props from `App.jsx` into `LightweightAnnotationOverlay`.

6. Kept the full SVG layer visible when survey highlights exist because lightweight mode does not render those synthetic highlights.

## Commands Run

- `node --test tests/annotationVisibilityRules.test.mjs`
- `npm test -- --runInBand`
- `npm run build`
- `npm run dev`
- Playwright browser scripts against `http://localhost:5174/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`
- `git diff -- src/utils/annotationVisibilityRules.js src/components/LightweightAnnotationOverlay.jsx src/App.jsx tests/annotationVisibilityRules.test.mjs`

## Automated Test Results

- `node --test tests/annotationVisibilityRules.test.mjs`: pass, 19 tests.
- `npm test -- --runInBand`: pass, 518 tests, 512 pass, 6 skipped, 0 fail.
- `npm run build`: pass. Vite reported only existing chunk-size/dynamic-import warnings.

## Browser / Manual Test Steps

Used Playwright with the repo dev server and the existing sample PDF:

- Opened `Package 2 - Rev 4 -- IC.pdf` through `?testPdf=...`.
- Created annotations on page 1:
  - pen stroke
  - highlighter stroke
  - rectangle
  - arrow/line
  - textbox (`Text smoke`) in a follow-up commit check
- Switched tools:
  - select
  - pen
  - eraser
- Verified created annotations remained visible across select/pen/eraser with SVG stats showing 4 rendered annotations and 0 SVG filter drops.
- Enabled the repo's live-stable overlay flags in localStorage:
  - `syncfusion_live_stable_overlay=1`
  - `syncfusion_interaction_dual_layer_enabled=1`
- Triggered wheel/pan interaction on the sample PDF.
- Confirmed lightweight overlays mounted during interaction:
  - page 6: 409 lightweight objects
  - page 7: 146 lightweight objects
  - page 8: 393 lightweight objects
  - page 9: 420 lightweight objects
  - page 10: 330 lightweight objects
- Switched from pan/interaction back to select, pen, and eraser. No console errors and no delayed "appears only after tool switch" behavior was observed in the inspected states.

## Screenshots / Artifacts

Artifacts are under:

`test-logs/2026-05-09-lightweight-overlay/`

Useful files:

- `02-created-annotations.png`
- `03-eraser.png`
- `05-after-pan-select.png`
- `12-created-second-pass.png`
- `13-during-space-pan-lightweight.png`
- `14-after-pan-select-second-pass.png`
- `21-during-wheel-lightweight.png`
- `summary.json`
- `summary-second-pass.json`
- `summary-lightweight-forced.json`
- `console.json`
- `console-second-pass.json`
- `console-lightweight-forced.json`

## Console Log Notes

- Final forced-lightweight run: `consoleErrorCount: 0`.
- Final forced-lightweight run: `consoleWarnCount: 1`.
- The single warning was the existing `[CTXDIAG page-gated-v2-2026-04-25] installed...` diagnostic warning.
- An intermediate failed forced-lightweight run exposed my temporary `hasSurveyHighlights` scope mistake. I fixed it, reran `npm run build`, `node --test tests/annotationVisibilityRules.test.mjs`, and the browser forced-lightweight run. The final run has no console errors.

## Remaining Risk / Untested Area

- Survey-region visibility was covered by unit tests for the shared helper, but I did not create a full survey-region annotation through the UI in the browser run.
- Survey highlights are intentionally not rendered by the lightweight overlay. The fix keeps full SVG visible when survey highlights exist so they are not hidden during proxy use.
- Callout lightweight rendering is wired through the shared helper, but the browser run did not successfully create a callout through the UI. Textbox creation was verified instead for the "text or callout" requirement.
