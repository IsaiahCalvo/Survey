# Annotation Fix 30 - Null Region Reimport Crash

Date: 2026-05-14

## Exact Crash Cause

The saved log `Logs/2026-05-14_22-26-04/console.log` showed an old crash after hidden PDF app metadata restored:

- `PDFAppLayerStateImport restored`
- then `ErrorBoundary caught an error`
- `TypeError: Cannot read properties of null (reading 'regionId')`
- inside `SVGAnnotationLayer`

The PDF app metadata could contain `regions: [null, validRegion]`. Some paths were already fixed, but other app visibility and render paths still accepted raw `page.regions` arrays and could let a null region survive into rendering or page visibility code.

## Files Changed

- `src/App.jsx`
- `src/utils/annotationVisibilityRules.js`
- `tests/annotationVisibilityRules.test.mjs`

## Fix

- Page visibility now ignores null region entries before reading visibility flags.
- Shared annotation visibility now treats `activeRegions: [null]` as no active valid regions.
- App region mask export, CSV filtering, page annotation visibility updates, and active page region lookup now normalize region arrays before use.
- `getPageRegions()` now returns only normalized valid regions.

## Tests Run

- `node --test tests/annotationVisibilityRules.test.mjs tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs`
  - Pass: 76 tests.
- `node --test tests/annotationHitTest.test.mjs`
  - Pass: 1 test.
- `npm run build`
  - Pass. Existing Vite warnings only.

## What The User Should Retest

1. Open the PDF that previously crashed.
2. Export it.
3. Reimport the exported PDF.
4. Save logs.
5. Confirm the newest `Logs/YYYY-MM-DD_*` folder has no React error boundary crash.

## Log Lines That Prove Success

Success means the fresh log has:

- `[PDFAppLayerStateImport] summary {"found":true,...}`
- `[PDFAppLayerStateImport] restored ...`
- no `ErrorBoundary caught an error`
- no `Cannot read properties of null`
- no `TypeError` from `SVGAnnotationLayer`

