# Annotation Fix 17 - Export Scope Contract

## Root Cause

The PDF exporter did not have a real scope contract. It walked only `annotationsByPage[page].objects`, skipped any object with `moduleId` or `highlightId`, and never received `callouts`, `highlightAnnotations`, or `spaces`.

That made export depend on accidental visibility/storage details:
- regular Fabric annotations exported
- survey-scoped Fabric annotations were silently skipped by `moduleId`
- legacy survey highlight Fabric rects were skipped by `highlightId`, but the real survey highlight state was not exported
- region and survey-region annotations could export only when they did not also carry survey metadata
- callouts were counted in App diagnostics but not exported by the PDF writer
- imported PDF-native annotations were skipped, which is correct, but the reason was not part of a broader contract

## Current Behavior Found

Storage model found:
- regular, survey, region, and survey-region Fabric annotations live in `annotationsByPage[page].objects`
- Fabric scope is represented by `moduleId`/legacy `spaceId` and `regionId`
- survey highlights live in `highlightAnnotations` and are rendered through `newHighlightsByPage`, not as normal Fabric objects
- callouts live in the separate `callouts` array
- spaces map regions to `space.id` through `spaces[].assignedPages[].regions[]`
- imported PDF-native app copies carry `isPdfImported` and/or `pdfAnnotationId`

Visibility model found:
- `src/utils/annotationVisibilityRules.js` defines `canvas`, `survey`, `region`, and `survey-region`
- `SVGAnnotationLayer` uses those rules to decide current UI visibility
- current UI visibility is not the export contract; export should not silently omit hidden but valid app annotations

Latest runtime log evidence from `Logs/2026-05-12_13-49-21/console.log` before this fix:
- action start counted `circle:112`, `path:3`, `callout:1`
- PDF bytes generated added only `115` PDF annotations and had type counts `counter:112`, `path:3`
- action complete still reported the callout in App-side counts
- reimport showed `counterAnnotationsImported:112`, `plainCirclesImported:0`, `counterMetadataParseFailures:0`

That proves Fix 16 held, but also proves export counts and actual exported objects were not aligned for all scopes/types.

## Final Export Contract Chosen

Default export includes all app-created annotations for the document, independent of current UI visibility:
- regular annotations
- survey annotations
- region annotations
- survey-region annotations
- survey highlights from `highlightAnnotations`
- callouts
- counters, text, ink, highlights, shapes, lines, arrows, polygons, and polylines where represented by supported Fabric/PDF-native types

Imported PDF-native annotations are preserved in the source PDF native annotation layer. Their imported app copies are skipped during export to avoid duplication.

Legacy Fabric survey-highlight rects with `highlightId` are intentionally skipped because survey highlight state is exported from `highlightAnnotations`.

Callouts export as standard PDF annotations: two `/Line` annotations plus one `/FreeText` annotation.

## Files Changed

- `src/utils/pdfAnnotationsPdfLib.js`
  - Added `buildPdfExportAnnotationPlan`.
  - Added explicit export contract diagnostics.
  - Included `callouts`, `highlightAnnotations`, and `spaces` via export options.
  - Removed the old `moduleId` skip.
  - Kept imported PDF-native dedupe skip with an explicit reason.
  - Added survey highlight export.
  - Added callout export.
  - Added polyline export.
- `src/App.jsx`
  - Passes `callouts`, `highlightAnnotations`, and `spaces` into explicit PDF export.
  - Normal Save remains app-state/Supabase/Y.Doc only.
- `tests/pdfSaveExportContract.test.mjs`
  - Added export contract plan coverage.
  - Added regular/survey/region/survey-region export coverage.
  - Added survey highlight, region highlight, survey-region highlight, and callout export coverage.
  - Added imported PDF-native dedupe coverage.

## Tests Run

- `node --test tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs`
  - 26 passed
- `npm test`
  - 589 passed, 6 skipped, 0 failed
- `npm run build`
  - passed
  - existing warnings: Vite CJS API deprecation, pdf.js eval warning, dynamic/static import chunking warnings, large chunk warning

## Manual Verification Steps

Artifact-level manual round trip was run with a generated one-page PDF:

1. Created `test-logs/annotation-fix-17/source.pdf`.
2. Exported a mixed annotation set through `savePDFWithAnnotationsPdfLib`.
3. Wrote `test-logs/annotation-fix-17/exported.pdf`.
4. Reimported the exported PDF through PDF.js and `importAnnotationsFromPdf`.
5. Wrote `test-logs/annotation-fix-17/manual-roundtrip-summary.json`.

Manual summary:
- total objects considered: 11
- objects exported: 10
- objects skipped: 1
- skipped reason: `imported-pdf-native-preserved`
- counts by scope: `canvas:4`, `survey:2`, `region:2`, `survey-region:3`
- counts by type: `path:1`, `rect:1`, `circle:2`, `line:1`, `textbox:1`, `counter:1`, `highlight:3`, `callout:1`
- PDF subtypes exported: `Ink:1`, `Square:1`, `Circle:2`, `Line:3`, `FreeText:2`, `Highlight:3`
- reimport object count: 12
- counter round trip: true
- imported copy skipped: true

## Latest Runtime Log Evidence

From `Logs/2026-05-12_13-49-21/console.log`:
- `[PDFSaveExport] action start` counted `circle:112`, `path:3`, `callout:1`
- `[PDFSaveExport] pdf bytes generated` added `115` PDF annotations, with `counter:112`, `path:3`
- `[PDFSaveExport] action complete` wrote `/Users/isaiahcalvo/Desktop/5.pdf`
- `[PDFCounterImport] summary` later reported `counterAnnotationsImported:112`, `plainCirclesImported:0`, `counterMetadataParseFailures:0`

The new exporter diagnostics are richer than those runtime logs and were verified by focused tests plus `test-logs/annotation-fix-17/manual-roundtrip-summary.json`.

## Remaining Risks

- Callout export is intentionally native-PDF-compatible, not an app-private callout identity round trip. Reimport sees its PDF pieces, while the visual export is present.
- Imported PDF-native annotations are still skipped even if edited after import because the app does not yet have a dirty-state contract for imported copies.
- Survey highlight export depends on usable `bounds`; invalid bounds are skipped with `invalid-highlight-bounds`.
