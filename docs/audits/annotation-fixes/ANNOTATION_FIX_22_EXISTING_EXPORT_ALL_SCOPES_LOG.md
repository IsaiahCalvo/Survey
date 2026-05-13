# Annotation Fix 22: Existing Export All Scopes Validation

Date: 2026-05-13

## Files and functions inspected

- `src/App.jsx`
  - `handleExportAnnotatedPDF`
  - `handleSaveDocument`
  - File-menu export subscription via `window.electronAPI.onExportAnnotatedPdfMenu`
  - global keyboard handler for `Cmd/Ctrl+S`
  - `summarizeAnnotationCountsForSaveExport`
- `src/utils/pdfAnnotationsPdfLib.js`
  - `buildPdfExportAnnotationPlan`
  - `savePDFWithAnnotationsPdfLib`
  - `createInkAnnotation`
  - `createSquareAnnotation`
  - `createCircleAnnotation`
  - `createHighlightAnnotation`
  - `createPolygonAnnotation`
  - `createPolyLineAnnotation`
  - `createLineAnnotation`
  - `createFreeTextAnnotation`
  - `createCalloutAnnotations`
- `src/utils/pdfAnnotationImporter.js`
  - `buildRawAnnotationMetadataById`
  - `applyRawMetadataToAnnotation`
  - `convertPdfAnnotationToFabric`
  - `convertCircleToFabricCircle`
  - `importAnnotationsFromPdf`
- `src/utils/pdfCounterMetadata.js`
  - `buildPdfCounterMetadata`
  - `serializePdfCounterMetadata`
  - `parsePdfCounterMetadata`
- `src/utils/saveAnnotatedPDFFile.js`
  - `saveAnnotatedPDFFile`
- Tests inspected:
  - `tests/pdfSaveExportContract.test.mjs`
  - `tests/pdfAnnotationImporter.test.mjs`
  - `tests/pdfAnnotationNormalization.test.mjs`
  - `tests/annotationContractRegression.test.mjs`

## Current export contract

The existing File menu Export path in `handleExportAnnotatedPDF` is the PDF-byte export path. It builds bytes through `savePDFWithAnnotationsPdfLib(..., { returnBytes: true, actionType: 'pdf-export' })` and writes them only through the Electron Save dialog result. It does not write to the original PDF path.

`buildPdfExportAnnotationPlan` exports all app-created annotations for the document, independent of current UI visibility, across these visibility scopes:

- `canvas`
- `survey`
- `region`
- `survey-region`

Imported native PDF annotations are preserved in the source PDF annotation layer. App-imported copies marked with `isPdfImported` or `pdfAnnotationId` are skipped during export with reason `imported-pdf-native-preserved`, preventing duplicated native annotations.

Normal Save / `Cmd+S` remains app-state only. `handleSaveDocument` logs `actionType: 'app-state-save'`, `pdfBytesGenerated: false`, `localFilesystemWrite: false`, and does not call the PDF byte export writer.

## Annotation types and scopes verified

Verified by existing and strengthened tests:

- Regular annotations export: `rect`, `circle`, `line`, `textbox`
- Survey annotations export
- Region annotations export
- Survey-region annotations export
- Survey highlights export as PDF `Highlight`
- Region and survey-region highlights export as PDF `Highlight`
- Callouts export as PDF `Line`, `Line`, and `FreeText`
- Counter pins export as PDF `Circle` with counter metadata
- Existing native PDF annotations are preserved
- Imported native PDF app copies are skipped and not duplicated
- Exported app-created supported annotations reimport as editable PDF-derived objects
- Exported counter pins reimport as counters, not plain circles
- Explicit export refuses original-path overwrite unless `allowOriginalOverwrite=true`
- `Cmd+S` remains app/Supabase/Y.Doc state save only

## Counter pin metadata

Counter pins export with:

- `/Subj` = `survey-counter`
- `/NM` = counter id
- `/Contents` = display number
- custom `/SurveyApp` JSON metadata

The metadata includes id, display number, page number, color, radius, position, pointer angle, series fields, group fields, and supporting data fields. `importAnnotationsFromPdf` reads this raw PDF metadata and `convertCircleToFabricCircle` rebuilds marked circles as `data.type === 'counter'`.

Test proof:

- `PDF export embeds explicit counter metadata on app-created counter pins`
- `convertPdfAnnotationToFabric rebuilds marked app counter Circle annotations as counters`
- `exported counter PDF reimports as a counter, not a generic circle`

## Native PDF annotation preservation and duplicate prevention

The export starts from the loaded PDF bytes, so existing `/Annots` remain in place. `buildPdfExportAnnotationPlan` skips any app object with `isPdfImported` or `pdfAnnotationId`, so imported app copies are not written again.

Test proof:

- `PDF export skips imported PDF-native app copies to avoid duplicate annotations`
- `PDF export preserves existing native annotations and does not duplicate imported copies`

## Export/reimport behavior

Added focused coverage in `tests/pdfAnnotationImporter.test.mjs`:

- `exported app-created PDF annotations reimport as editable supported annotation types`

This exports app-created `path`, `rect`, `circle`, `line`, `textbox`, and `highlight`, reopens the exported bytes through PDF.js, imports with `importAnnotationsFromPdf`, and verifies the app gets editable imported objects with PDF annotation types:

- `Ink`
- `Square`
- `Circle`
- `Line`
- `FreeText`
- `Highlight`

Correction: that prior conclusion was too weak. Exporting app-created callouts only as disconnected native PDF pieces is not an acceptable full lifecycle because the app cannot recover callout behavior from loose `Line`, `Line`, and `FreeText` annotations alone.

## Correction: app callout identity lifecycle

What was wrong with the prior conclusion:

- The prior validation treated "callouts export as visible native PDF pieces" as acceptable.
- That only proved visual PDF output, not app-level lifecycle identity.
- Reimporting those pieces as loose native annotations would lose the app callout model: one selectable/editable callout with shared id, text, leader geometry, box geometry, style, and survey/region scope.

How app-created callout identity is now encoded:

- Added `src/utils/pdfCalloutMetadata.js`.
- Each exported app callout piece now carries:
  - `/Subj` = `survey-callout`
  - custom `/SurveyAppCallout` JSON metadata
  - `/NM` names derived from the shared callout id and part
- Metadata includes the app callout id, page number, part (`line1`, `line2`, `text`), text, style, normalized `arrowTip`, `knee`, `textBoxPosition`, `textBoxWidth`, `textBoxHeight`, `moduleId`, `regionId`, `spaceId`, `layer`, and `groupId`.
- All pieces belonging to one app callout share the same app callout id in metadata.

How reimport reconstructs app callouts:

- `src/utils/pdfAnnotationImporter.js` parses `/SurveyAppCallout` metadata alongside existing counter metadata.
- During `importAnnotationsFromPdf`, annotations with valid `survey-callout` metadata are grouped by app callout id.
- The importer returns one app callout entry in `calloutsByPage` and does not add the underlying `Line`/`FreeText` pieces to `annotationsByPage`.
- `src/App.jsx` now merges `calloutsByPage` from `importAnnotationsFromPdf` into the existing `callouts[]` import flow, while keeping the existing external/native `FreeTextCallout` adapter path for non-app PDF callouts.

Proof that duplicate loose native pieces are not imported for app callouts:

- Added `exported app-created callout reimports as one app callout without loose Line or FreeText duplicates`.
- The test exports one app-created callout to PDF, reimports the exported bytes through PDF.js, and verifies:
  - `calloutsByPage[1]` contains exactly one callout.
  - `annotationsByPage[1]?.objects` is empty, so there are no loose duplicate `Line` or `FreeText` app-state annotations.
  - The callout retains id, text, style, normalized geometry, `moduleId`, `regionId`, and `spaceId`.

Counter lifecycle remains intact:

- Existing counter tests still pass.
- `SurveyApp` counter metadata remains unchanged.

Regular/survey/region/survey-region export coverage remains intact:

- Existing scope export tests still pass.
- App-created callout scope metadata is now also preserved in the callout metadata.

## Files changed

- `src/App.jsx`
  - Imports and merges app callouts returned directly by `importAnnotationsFromPdf`.
- `src/utils/pdfAnnotationsPdfLib.js`
  - Adds app callout metadata to each exported callout `Line`/`FreeText` PDF annotation.
- `src/utils/pdfAnnotationImporter.js`
  - Parses app callout metadata, groups callout pieces, returns one app callout, and skips loose duplicate pieces.
- `src/utils/pdfCalloutMetadata.js`
  - New metadata builder/parser for app callout PDF identity.
- `tests/pdfSaveExportContract.test.mjs`
  - Added proof that exported callout pieces carry app callout metadata.
- `tests/pdfAnnotationImporter.test.mjs`
  - Added focused export/reimport coverage for supported non-counter app-created annotation types and app-created callout lifecycle identity.

## Tests run and exact results

Command:

```bash
node --test tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs tests/pdfAnnotationNormalization.test.mjs tests/annotationContractRegression.test.mjs
```

Result:

```text
# tests 53
# suites 0
# pass 53
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 437.136042
```

Command:

```bash
npm run build
```

Result:

```text
✓ built in 28.53s
```

Build warnings observed:

- Vite CJS Node API deprecation warning.
- `pdfjs-dist/build/pdf.js` uses `eval`.
- Some dynamic imports cannot be moved into separate chunks because they are also statically imported.
- Some chunks exceed 500 kB after minification.

## Deferred

- No UI changes.
- No new Export dialog.
- No custom Print panel work.
- No imported Squiggly drag-sync work.
- Remaining lifecycle gaps: app-created callouts now round-trip as app callouts; counters already round-trip as counters. Broader app identity metadata for other app-created shapes/text/strokes beyond their native editable PDF subtype is still a possible future hardening area, especially if exact app ids/scope metadata must survive for every non-callout annotation rather than just editable behavior.

## Correction: general app annotation identity lifecycle

What lifecycle gap remained after the callout fix:

- The callout correction fixed app-created callouts, and counters already had `SurveyApp` counter metadata.
- Non-callout, non-counter app-created annotations still exported as editable native PDF annotations without a general app identity payload.
- Reimport could recover visual/editable PDF-native objects, but not the original app id, app type, survey/module scope, region scope, space scope, layer/source flags, or app-owned data needed to preserve app-level behavior.

General app annotation metadata contract added:

- New custom PDF metadata key: `SurveyAppAnnotation`.
- New subject marker: `/Subj = survey-app-annotation`.
- New utility: `src/utils/pdfAppAnnotationMetadata.js`.
- Metadata includes app marker/version, id, app type, Fabric type, PDF export type, page number, `moduleId`, `regionId`, `spaceId`, layer, source, flags, safe allowlisted `data`, key style fields, key geometry fields, and ownership/author fields when present.
- The metadata builder avoids unsafe full-object dumps and does not serialize arbitrary circular Fabric objects.
- Existing counter metadata (`SurveyApp`) and callout metadata (`SurveyAppCallout`) remain separate and are not replaced by the general metadata path.

Annotation types now carrying general app metadata:

- Pen/path strokes exported as `Ink`.
- Highlighter strokes when represented as path objects exported as `Ink`.
- Survey highlights exported as `Highlight`.
- Rectangles exported as `Square`.
- Circles exported as `Circle`, except counters which keep counter metadata.
- Lines exported as `Line`.
- Arrows represented as line objects exported as `Line`.
- Polygons exported as `Polygon`.
- Polylines exported as `PolyLine`.
- Text boxes exported as `FreeText`.

How import restores id/type/scope:

- `src/utils/pdfAnnotationImporter.js` now reads `SurveyAppAnnotation` from raw PDF annotation dictionaries via pdf-lib.
- `parsePdfAppAnnotationMetadata` validates the app marker, subject kind, app id, and app type.
- `convertPdfAnnotationToFabric` first converts the native PDF annotation normally, then applies app metadata only when valid `SurveyAppAnnotation` metadata exists.
- Reimported app-created objects get their original app `id`, `appAnnotationId`, `appAnnotationType`, `data.id`, `data.type`, `moduleId`, `regionId`, `spaceId`, layer, and ownership metadata where present.
- Survey highlights also restore `highlightId` from the app annotation id, plus survey/region/space scope.

Proof external/native annotations are not falsely treated as app-created:

- Plain external/native PDF annotations without `SurveyAppAnnotation` still import through the native converter path only.
- The focused Circle test verifies a native Circle without app metadata remains a normal imported circle and does not receive `appAnnotationType` or `data.appAnnotationMetadata`.
- Existing duplicate-prevention remains intact: imported native app copies are still skipped during export when marked with `isPdfImported` or `pdfAnnotationId`.

Files changed in this correction:

- `src/utils/pdfAppAnnotationMetadata.js`
  - New general metadata builder/parser/applicator.
- `src/utils/pdfAnnotationsPdfLib.js`
  - Embeds `SurveyAppAnnotation` metadata on exported app-created non-callout, non-counter PDF annotations.
  - Preserves the existing counter and callout metadata paths.
- `src/utils/pdfAnnotationImporter.js`
  - Parses raw `SurveyAppAnnotation` metadata and reapplies app id/type/scope/data to imported objects.
- `tests/pdfSaveExportContract.test.mjs`
  - Adds proof that rect/circle/line/textbox/path/polygon/polyline/survey-highlight exports carry app annotation metadata.
- `tests/pdfAnnotationImporter.test.mjs`
  - Strengthens export/reimport proof for original app ids, app types, survey/module scope, region scope, space scope, and survey highlight scope.
  - Strengthens proof that external/native annotations without app metadata are not treated as app-created.

Tests run and exact results for this correction:

Command:

```bash
node --test tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs tests/pdfAnnotationNormalization.test.mjs tests/annotationContractRegression.test.mjs
```

Result:

```text
# tests 54
# suites 0
# pass 54
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 422.02425
```

Command:

```bash
npm run build
```

Result:

```text
✓ built in 24.78s
```

Build warnings observed:

- Vite CJS Node API deprecation warning.
- `pdfjs-dist/build/pdf.js` uses `eval`.
- Some dynamic imports cannot be moved into separate chunks because they are also statically imported.
- Some chunks exceed 500 kB after minification.

Remaining export/reimport lifecycle gaps:

- The general app metadata path now covers supported app-created non-callout, non-counter annotations listed above.
- Counter and callout lifecycle metadata remain on their specialized paths and still round-trip as counters/callouts.
- Unsupported PDF-native annotation subtypes remain native-only unless a future app feature adds an app-created export path for them.
- This correction does not add UI, custom print/export dialogs, or imported Squiggly drag-sync.
