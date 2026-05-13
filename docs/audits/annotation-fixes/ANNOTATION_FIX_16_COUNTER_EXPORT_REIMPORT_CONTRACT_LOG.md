# Annotation Fix 16 - Counter Export/Reimport Identity Contract

Date: 2026-05-12

## Root Cause Found

Counter pins are stored correctly in app/Supabase state as Fabric `circle` objects with `data.type === 'counter'`.

The PDF exporter only looked at the Fabric object type, so counters took the generic Circle export path and became `/Subtype /Circle` annotations with no app-owned identity marker. On reimport, the PDF importer saw an ordinary Circle annotation and correctly rebuilt a generic circle. Nothing in the exported PDF proved the circle was originally an app counter.

Normal app Save and Supabase sync were not the problem and were not changed.

## Files And Functions Inspected

- `src/App.jsx`: counter creation in the counter overlay pointer flow; counters are Fabric circles with `data.type`, `data.id`, `displayNumber`, `pointerAngle`, `seriesId`, `seriesStart`, and color fields.
- `src/utils/svgAnnotationRenderers.jsx`: `renderCounter` renders the app counter pin from a Fabric circle plus `data.type === 'counter'`.
- `src/services/annotationTypeSerializers.js`: `fabricObjectToDbType` maps `data.type === 'counter'` to Supabase `annotation_type: 'counter'`.
- `src/utils/pdfAnnotationsPdfLib.js`: `savePDFWithAnnotationsPdfLib` and `createCircleAnnotation` were exporting counters as generic PDF Circle annotations.
- `src/utils/pdfAnnotationImporter.js`: raw PDF annotation metadata extraction and `convertCircleToFabricCircle` were importing all `/Circle` annotations as generic Fabric circles.
- `tests/pdfSaveExportContract.test.mjs` and `tests/pdfAnnotationImporter.test.mjs`: existing PDF export/import contract coverage.

## Metadata Strategy Chosen

Exported app counters stay visible to other PDF viewers as normal PDF Circle annotations, but now carry explicit app metadata:

- Private PDF key: `/SurveyApp` containing versioned JSON.
- Subject marker: `/Subj (survey-counter)`.
- Stable annotation name: `/NM` from the app counter id when available.
- Contents: `/Contents` contains the displayed counter number for basic viewer metadata/search surfaces.

The JSON payload is namespaced and versioned:

- `app: "SurveyApp"`
- `kind: "survey-counter"`
- `version: 1`
- id, page number, display number, color, radius, left/top/center position
- pointer angle and computed tip data
- series id/name/color/start
- grouping/sequence fields when present
- selected original `data` fields such as `createdAt` and `numberColor`

Import only rebuilds a counter if the explicit marker parses. A normal external `/Circle` without `/SurveyApp` metadata remains a normal circle.

## Code Changed

- Added `src/utils/pdfCounterMetadata.js`
  - Central constants for `SurveyApp` and `survey-counter`.
  - `buildPdfCounterMetadata`, `serializePdfCounterMetadata`, and `parsePdfCounterMetadata`.

- Updated `src/utils/pdfAnnotationsPdfLib.js`
  - Detects `obj.data.type === 'counter'` before generic circle export.
  - Embeds `/SurveyApp`, `/Subj`, `/NM`, and `/Contents` on exported counter Circle annotations.
  - Adds export diagnostics: counter count, marker/key list, metadata failures.
  - Leaves generic circle export behavior unchanged.

- Updated `src/utils/pdfAnnotationImporter.js`
  - Raw PDF metadata extractor now reads `/Subj` and `/SurveyApp`.
  - `convertCircleToFabricCircle` rebuilds marked Circle annotations as app counters.
  - Plain Circle annotations still use the existing circle path.
  - Adds import diagnostics: counters imported as counters, plain circles imported as circles, parse failures.

- Updated `tests/pdfSaveExportContract.test.mjs`
  - Added coverage proving PDF export embeds explicit counter metadata.

- Updated `tests/pdfAnnotationImporter.test.mjs`
  - Added coverage for marked counter Circle rehydration.
  - Added coverage for exported PDF counter reimport.
  - Added coverage proving plain external Circles remain circles.
  - Added preservation checks for number, color, series, page/position, and radius.

## Automated Test Results

- `node --test tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs`
  - Pass: 21 tests.

- `npm test`
  - Pass: 584, fail: 0, skipped: 6.

- `npm run build`
  - Pass. Vite completed successfully.
  - Existing warnings remained: pdf.js eval warning, dynamic/static import chunk warnings, and large chunk warnings.

## Manual Test Results

Artifact-level manual round trip was run with a generated one-page PDF:

1. Created a small test PDF.
2. Added one external plain PDF Circle with no app metadata.
3. Exported two app-created counter objects through `savePDFWithAnnotationsPdfLib`.
4. Reimported the exported PDF through PDF.js plus `importAnnotationsFromPdf`.
5. Confirmed two objects reimported with `data.type === 'counter'`.
6. Confirmed the imported counters are selectable/evented and carry counter data for counter editing flows.
7. Confirmed numbers, colors, series ids/names, positions, and radii were preserved.
8. Confirmed the external unmarked Circle reimported as a plain circle.

Artifacts:

- `test-logs/annotation-fix-16/source-with-plain-circle.pdf`
- `test-logs/annotation-fix-16/exported-counters.pdf`
- `test-logs/annotation-fix-16/manual-roundtrip-summary.json`

Manual summary:

- counters reimported as counters: 2
- plain circles reimported as circles: 1
- counter metadata parse failures: 0

## Before / After Behavior

Before:

- App counter export produced generic PDF Circle annotations.
- Reimport rebuilt those annotations as generic circles with white borders.
- Counter number, series, pointer, and grouping metadata were lost.

After:

- App counter export produces visible PDF Circle annotations with explicit `SurveyApp` counter metadata.
- Reimport recognizes only that marker and rebuilds app counters.
- Counter number, color, series, position, radius, and pointer angle survive the export/reimport round trip.
- External Circle annotations without app metadata still import as generic circles.

## Remaining Limitations

- The PDF annotation remains a standard Circle annotation for viewer compatibility; the app-specific pin shape and number are restored by this app from metadata on reimport.
- The app currently stores pointer angle, not a separate editable leader object. Export metadata includes pointer angle and computed tip coordinates.
- Imported counters marked `isPdfImported` continue to follow the existing exporter rule that skips imported PDF annotations to avoid duplicates unless future dirty-state handling changes that policy.
