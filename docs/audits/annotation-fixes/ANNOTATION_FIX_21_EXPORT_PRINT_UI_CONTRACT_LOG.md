# Annotation Fix 21 - Export / Print UI Contract

Date: 2026-05-12

## Scope

Audit and design the full Export / Print contract for annotation output. No Squiggly work was done.

This pass intentionally did not build a large export UI. The code shows that the current backend capabilities are uneven: one PDF export path is real, survey Excel export is real, space CSV is real but narrow, space PDF is raster-only and incomplete, and print has a separate unfinished contract. Building a broad dialog now would either hide important choices or expose fake options.

## Current Export / Save / Print Map

### File menu Export

Files:

- `src/electron-main.js`
- `src/preload.js`
- `src/App.jsx`
- `src/utils/pdfAnnotationsPdfLib.js`

Flow:

1. File menu item `Export` uses `CmdOrCtrl+Shift+E`.
2. Main process sends `menu:export-annotated-pdf`.
3. Preload exposes `onExportAnnotatedPdfMenu`.
4. `App.jsx` calls `handleExportAnnotatedPDF`.
5. The handler optionally asks Syncfusion for `saveAsBlob()` so any PDF-side state already in the viewer can be used as the source.
6. It calls `savePDFWithAnnotationsPdfLib(..., { returnBytes: true, actionType: 'pdf-export', callouts, highlightAnnotations, spaces })`.
7. Electron `saveFile` opens a native save dialog and writes the exported bytes.

What it exports today:

- regular app annotations from `annotationsByPage`
- survey annotations with `moduleId` / `spaceId`
- region-scoped annotations with `regionId`
- survey-region annotations with both survey and region scope
- survey highlights from `highlightAnnotations`
- callouts from `callouts`
- counter pins as circle annotations with Survey counter metadata
- imported PDF-native annotations are preserved in the source PDF and app-imported duplicate copies are skipped

What it does not expose:

- no export preset dialog
- no user choice for scope
- no flattened-vs-editable choice
- no page range
- no black/white output
- no region/space-specific PDF preset

### Command+S Save

Files:

- `src/App.jsx`
- `src/services/annotationCloudSync.js`
- `src/services/annotationTypeSerializers.js`
- `src/hooks/useAnnotationCloudSync.js`

Flow:

1. Keyboard save calls `handleSaveDocument`.
2. Save writes local app backup via `saveAnnotationsByPage`.
3. If cloud sync is enabled, survey data is saved and annotation sync is force-flushed.
4. It logs `actionType: 'app-state-save'`.
5. It explicitly does not generate PDF bytes and does not write a local PDF.

This is the correct contract. Command+S should save app state only: local backup, Y.Doc / Supabase state, survey data, and sync queue flush. It should not export or overwrite a PDF file.

### PDF Export Utilities

Files:

- `src/utils/pdfAnnotationsPdfLib.js`
- `src/utils/saveAnnotatedPDFFile.js`
- `src/utils/pdfNativeExport/index.js`
- `src/utils/pdfNativeExport/featureFlag.js`

Current state:

- `savePDFWithAnnotationsPdfLib` is the real export engine.
- `buildPdfExportAnnotationPlan` produces the inclusion plan and diagnostics.
- The output is native/editable PDF annotations where supported by the current writer.
- The current writer uses `pdf-lib` directly.
- `src/utils/pdfNativeExport/index.js` is only a scaffold. `bakeAnnotationsIntoPdf` throws `not-implemented yet`.
- `saveAnnotatedPDFFile` is a generic save helper, but `App.jsx` currently has its own explicit File menu export flow.

Important detail:

The implemented export is not a flattened image export. It adds PDF annotation dictionaries to the original PDF and preserves existing native PDF annotations.

### Survey Excel Export

Files:

- `src/App.jsx`
- `src/services/excelGraphService.js`
- `src/services/excelSessionService.js`
- `src/utils/excelSyncDirtyState.js`

Flow:

1. Survey panel `EXPORT` calls `handleExportSurveyToExcel`.
2. ExcelJS builds an `.xlsx` workbook with a hidden `_SurveyMetadata` sheet.
3. It creates sheets by category/module.
4. It writes item rows, checklist responses, ball-in-court, notes, validations, conditional formatting, and schema mapping metadata.
5. Desktop export opens a location choice modal for local `.xlsx` or OneDrive/cloud storage.
6. If a linked Excel file already exists, the dropdown also supports Open Excel, Push to Excel, and Pull from Excel.
7. Live sync can update workbook ranges through Microsoft Graph sessions.

What works:

- survey report data export is real
- local `.xlsx` write is real
- OneDrive upload/sync path exists
- live-sync session path exists

What is not unified:

- it lives inside the survey side panel, not the File menu Export flow
- the File menu Export cannot discover this capability

### Space / Region Export

Files:

- `src/App.jsx`
- `src/sidebar/SpacesPanel.jsx`
- `src/PDFSidebar.jsx`

Current UI:

- each space card has an Export menu with `CSV` and `PDF`

CSV path:

- `handleExportSpaceToCSV(spaceId)`
- emits rows for annotations on assigned pages
- includes space name, page, mode, region count, type, id, geometry, colors, notes, checklist count, status, attachments count
- filters by space id and by region containment when a page is region-only
- this is a real but basic data export

PDF path:

- `handleExportSpaceToPDF(spaceId)`
- uses PDF.js to rasterize assigned pages into PNG images
- applies a region mask if the space page is region-only
- writes a new image-only PDF with `pdf-lib`

Broken or misleading parts:

- space PDF does not include app SVG/Fabric annotations
- space PDF does not include survey highlights or callouts
- space PDF does not include editable PDF annotations
- region overlays are not exported as editable or inspectable PDF objects
- black/white region output is not implemented as a product choice
- this is closer to a visual page/region clipping tool than an annotation export

### Print

Files:

- `src/App.jsx`
- `src/components/PrintPanel.jsx`
- `src/components/PrintPanel.css`
- `src/components/SyncfusionPDFContainer.jsx`
- `src/electron-main.js`
- `src/preload.js`
- docs handoff `docs/handoffs/2026-04-24-print-panel.md`

Current state:

- File menu has `Print PDF...` on `CmdOrCtrl+P`.
- File menu has `Print with Markup...` on `CmdOrCtrl+Shift+P`.
- The custom print panel exists but is disabled by `PRINT_PANEL_ENABLED = false`.
- Plain print currently tries a fast blob URL print of the source PDF.
- Markup print falls into `handlePrintPanelPrint` with generated page specs and rasterizes pages through PDF.js into an HTML print document.
- The `Markups` toggle in the disabled panel controls PDF.js `annotationMode`; it hides or shows annotations embedded in the PDF itself.

Broken or misleading parts:

- print markup does not use the current PDF export writer.
- print markup does not composite app SVG/Fabric overlay annotations into the PDF.js page render.
- print output is raster/HTML, not editable PDF output.
- the disabled panel has a `Save as PDF...` destination stub, but it is not the main product path today.
- there are two print menu items, but the naming does not explain native PDF annotations vs app annotations vs flattened output.

## What Works Today

- Command+S saves app/cloud state without modal spam or PDF file output.
- File menu Export writes an annotated PDF copy through a native Save dialog.
- PDF export includes regular, survey, region, survey-region, survey highlight, callout, and counter data where the current writer supports the shape.
- PDF export skips app-imported copies of imported PDF-native annotations so the output does not duplicate the original native PDF annotations.
- Survey Excel export produces a real `.xlsx` survey report and supports local/cloud destinations.
- Space CSV export produces a real basic data table.
- Print can produce output, but its markup semantics are not the same as export.

## What Is Broken Or Misleading

- File menu `Export` is a direct PDF save, not an export workflow.
- Users cannot choose what they are exporting.
- The app has no explicit distinction between:
  - Save app state
  - Export editable annotated PDF
  - Export flattened/print-ready PDF
  - Export survey/report data
  - Print
- The phrase "with Markup" is overloaded. In print code it can mean PDF-native annotations rendered by PDF.js, not necessarily app-created annotations.
- Space PDF export sounds like a professional package export but is currently a raster page/region clip with no app annotation overlay.
- The `pdfNativeExport` folder implies a future bake pipeline, but the active PDF export is still `pdfAnnotationsPdfLib.js`.
- Flattened PDF export is not implemented as a first-class backend. The closest current paths are print HTML/PDF and space PDF rasterization.
- Editable PDF export is implemented only for the annotation types handled by `pdfAnnotationsPdfLib.js`; it is not an all-types guarantee.

## Flattened vs Editable Support

Editable:

- Supported today through `savePDFWithAnnotationsPdfLib` for the current supported app objects.
- Tested by `tests/pdfSaveExportContract.test.mjs`.
- Existing imported native PDF annotations remain native because they stay in the source PDF.

Flattened:

- Not supported as a general Export PDF option.
- Print can rasterize pages into an HTML print document.
- Space PDF can rasterize selected pages/regions into image-only PDF pages.
- There is no shared "flatten this document with all current app overlays" backend.

Recommendation: do not show a flattened/export-ready PDF choice until there is a real shared flatten backend.

## Professional UX Recommendation

### Save

Command+S should only save app state.

It should persist local backup, Y.Doc / Supabase annotation state, survey data, and pending sync. It should not open a file picker, export PDF bytes, overwrite the source PDF, or ask the user whether they meant export.

### Export

Export should be separate from Save.

File menu `Export...` should open an Export sheet/dialog. The dialog should show only wired capabilities, with unavailable future capabilities either absent or clearly disabled behind a "coming later" section during development only.

Recommended first honest export presets:

1. `Annotated PDF`
   - Output: current PDF plus editable PDF annotations where supported.
   - Includes: regular annotations, survey annotations, survey highlights, region/survey-region annotations, counters, callouts, and preserved imported PDF annotations.
   - Backend: `handleExportAnnotatedPDF` / `savePDFWithAnnotationsPdfLib`.
   - Label should say "editable where supported", not "fully editable".

2. `Survey Excel`
   - Output: `.xlsx` survey report.
   - Available only when a survey template is selected and Excel export entitlement is enabled.
   - Backend: `handleExportSurveyToExcel`.
   - This should live in the Export dialog too, while the survey panel can keep a shortcut button.

3. `Space CSV`
   - Output: basic `.csv` data for one selected space.
   - Available only when spaces exist and entitlement allows export.
   - Backend: `handleExportSpaceToCSV`.
   - Dialog must require a selected space.

Do not include in the first dialog:

- Space PDF, until it is renamed or fixed.
- Region PDF, until the scope/output contract is defined.
- Page region overlays, until there is a render/export backend.
- Flattened PDF, until there is a document-level flatten backend.
- Print-ready black/white region output, until it is implemented through Print or a flattened package export.

### Region / Space Exports

Spaces and regions need a scoped export model, not a single hidden button.

Recommended model:

- Export scope:
  - Whole document
  - Current page
  - Selected pages
  - One space
  - One region
- Content toggles:
  - Base PDF pages
  - Regular annotations
  - Survey highlights
  - Survey/report annotations
  - Region overlays
  - Callouts and counters
  - Imported PDF annotations
- Output type:
  - Editable PDF where supported
  - Flattened visual PDF
  - CSV / Excel data

Space PDF should be deferred until it can either:

- export a flattened visual package that includes app overlays and optional black/white output, or
- export editable scoped annotations into copied PDF pages.

### Flattened vs Editable

Users should eventually choose between editable and flattened, but not yet.

Recommended labels:

- `Editable PDF annotations` - keeps markups editable in Acrobat where the annotation type supports it.
- `Flattened PDF` - burns visible output into pages for printing/records, not editable.

Current app should expose only the editable PDF path because that is the real document-level export backend.

### Print

Print should remain separate from Export.

Print should focus on physical/OS concerns:

- page range
- copies
- duplex
- paper size
- orientation
- color vs black/white
- include/exclude markups
- print current view/space/region when scoped printing is implemented

Print should not be the main way to produce an archive/export file. A future `Save as flattened PDF` can reuse print composition, but it should be surfaced as export only after the backend includes app overlays and region/space scope correctly.

## Recommended Phased Plan

### Phase 1 - Honest Export Dialog

Goal: replace direct File menu Export with a small dialog that exposes only real capabilities.

Files:

- `src/App.jsx`
- optionally new `src/components/ExportDialog.jsx`
- optional CSS next to the component if extracting styles
- `tests/pdfSaveExportContract.test.mjs`

Changes:

- Add `showExportDialog` state in `PDFViewer`.
- Change `onExportAnnotatedPdfMenu` to open the dialog instead of immediately exporting.
- Keep `handleExportAnnotatedPDF` unchanged as the action behind `Annotated PDF`.
- Add `Survey Excel` action that calls `handleExportSurveyToExcel` when `selectedTemplate` exists.
- Add `Space CSV` action with a required space selector when `spaces.length > 0`.
- Do not show flattened PDF, Space PDF, or editable/flattened toggles yet.
- Keep Command+S unchanged.

Acceptance:

- File menu Export opens one dialog.
- Annotated PDF button runs the existing Save dialog and export path.
- Survey Excel button runs the existing Excel location modal.
- Space CSV button requires a selected space and runs the existing CSV path.
- No fake options appear.

### Phase 2 - Extract Shared Export Contract

Goal: move export capability detection out of the huge `App.jsx`.

Files:

- new `src/utils/exportCapabilities.js`
- tests for capability detection
- `src/App.jsx`
- `src/components/ExportDialog.jsx`

Changes:

- compute available presets from real app state
- centralize labels, descriptions, and disabled reasons
- use this in dialog and later in menus/toolbars

### Phase 3 - Real Flatten Backend

Goal: create a document-level flattened PDF backend that includes app overlays.

Files:

- new `src/utils/pdfFlattenExport.js`
- `src/utils/svgAnnotationRenderers.jsx` or a shared render adapter
- `src/components/SVGAnnotationLayer.jsx` only if a reusable renderer contract is needed
- tests for visible inclusion/exclusion

Changes:

- render base PDF pages
- composite regular annotations, survey highlights, callouts, counters, region overlays, and imported PDF annotations according to the chosen scope
- support black/white output
- output image-backed PDF pages or true flattened PDF content streams

### Phase 4 - Scoped Space / Region PDF Export

Goal: replace current misleading space PDF with a scoped export preset.

Files:

- `src/App.jsx`
- `src/sidebar/SpacesPanel.jsx`
- `src/utils/pdfFlattenExport.js`
- `src/utils/pdfAnnotationsPdfLib.js` if editable scoped output is added

Changes:

- rename or remove the current Space PDF menu item until fixed
- add scoped export from the central Export dialog
- support whole space, selected region, current page in space
- include app overlays and survey highlights according to scope toggles

### Phase 5 - Print Contract Cleanup

Goal: make print behavior match user expectations.

Files:

- `src/App.jsx`
- `src/components/PrintPanel.jsx`
- `src/electron-main.js`
- `src/preload.js`

Changes:

- decide whether custom print panel is enabled again
- use clear labels: `Print` and optional `Print current PDF annotations` / `Print with app markups`
- route print-with-app-markups through the real flatten backend once it exists
- remove or wire `Save as PDF...` in the print destination list

## Implementation Done

No production code changes were made in this pass.

Reason: the correct product fix is not just a button rename. The app needs an Export dialog, but only after agreeing that Phase 1 should expose `Annotated PDF`, `Survey Excel`, and `Space CSV` while deferring flattened, Space PDF, and Print-ready region output.

## Files Changed

- `ANNOTATION_FIX_21_EXPORT_PRINT_UI_CONTRACT_LOG.md`

## Test Results

No production code changed. Focused contract tests were run anyway:

```bash
node --test \
  tests/pdfSaveExportContract.test.mjs \
  tests/annotationVisibilityRules.test.mjs \
  tests/annotationContractRegression.test.mjs
```

Result: passed. 41 tests passed, 0 failed.

Notes:

- Node emitted the existing `MODULE_TYPELESS_PACKAGE_JSON` warning for ES module parsing.
- `pdfSaveExportContract.test.mjs` intentionally logs the refused overwrite error while asserting that original-path overwrite is blocked without `allowOriginalOverwrite=true`.

Recommended verification before Phase 1 implementation:

```bash
npm run build
```

## Remaining Phases

1. Build the honest Export dialog with current real capabilities only.
2. Extract export capability detection and labels.
3. Build a shared flattened PDF backend.
4. Replace or remove the current misleading Space PDF export.
5. Clean up Print labels and route app-markup print through the flatten backend.
