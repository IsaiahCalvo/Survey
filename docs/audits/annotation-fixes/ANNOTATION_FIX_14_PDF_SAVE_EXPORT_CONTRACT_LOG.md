# Annotation Fix 14 - PDF Save / Export Source-Of-Truth Contract Log

## Current Behavior Found Before Changes

- Local desktop upload uses Electron `dialog:openFile`, reads the original PDF bytes, returns the original `filePath`, opens an optimistic tab, then uploads the PDF binary to Supabase Storage and inserts a `documents` row with `file_path` and `file_size`.
- Existing cloud/Supabase PDFs are opened by downloading `documents.file_path` from the `documents` storage bucket into a new browser `File`; the app attaches `file.id`, `projectId`, and `supabaseFilePath`.
- Supabase stores both the original PDF binary and app annotation state:
  - PDF binary: Supabase Storage bucket `documents`.
  - App annotation rows/state: `document_annotations` rows for Fabric/callout/highlight data, plus older survey JSON backup at `{projectId}/{documentId}_data.json`.
- Normal app annotation sync already writes app annotations to Supabase first, then Y.Doc fan-out for live collaboration.
- The unsafe pre-change path was `handleSaveDocument`: Cmd/Ctrl+S on a local desktop PDF called `savePDFWithAnnotationsPdfLib(..., pdfFilePath)`, which silently wrote generated PDF bytes back to the original desktop path. That violated the product contract.
- Export already existed as `File -> Export Annotated PDF...`, but Save and Export were still behaviorally mixed because normal Save could also generate and write a PDF file.
- Imported embedded PDF annotations were imported into app state for local PDFs, skipped for cloud PDFs, and tracked through `nativeLayerPolicyByPage`. Export skipped `obj.isPdfImported` objects, which avoids duplicate native/app copies but means imported native annotations are preserved from the original PDF layer rather than flattened from app-imported copies.

## Files / Functions Inspected

- `src/electron-main.js`: `dialog:openFile`, `dialog:saveFile`, `fs:writeFile`, `fs:writeFileAtomic`.
- `src/hooks/useDatabase.js`: `useStorage.uploadDocument`, `uploadDataFile`, `downloadDocument`.
- `src/App.jsx`: `handleUploadClick`, `handleFileUpload`, `handleDocumentClick`, `handleDocumentSelect`, `loadPDF`, `saveAnnotationsByPage`, `saveSurveyDataToSupabase`, `loadSurveyDataFromSupabase`, `handleSaveDocument`, `handleExportAnnotatedPDF`.
- `src/hooks/useAnnotationCloudSync.js`: durable Supabase push and `forceFlush`.
- `src/services/annotationCloudSync.js`: `upsertAnnotationsByPage`, `upsertCallouts`, `loadAllNonHighlightAnnotations`.
- `src/services/documentAnnotationService.js`: legacy survey highlight persistence.
- `src/services/annotationTypeSerializers.js`: app annotation row serialization and imported-PDF dedupe.
- `src/utils/pdfAnnotationImporter.js`: embedded annotation import, duplicate `/NM` filtering, native-layer policy.
- `src/utils/pdfAnnotationsPdfLib.js`: PDF byte generation and prior original-path write branch.
- `src/utils/saveAnnotatedPDFFile.js`: explicit Save As/download wrapper.

## Source-Of-Truth Decision Implemented

Supabase `document_annotations` remains the durable source of truth for in-app collaboration and reload/cross-device behavior. Y.Doc remains the fast live collaboration cache. LocalStorage remains a local backup/render cache.

Normal Save is now app-state save only:
- Saves local backup.
- Flushes cloud annotation state to Supabase when cloud sync is active.
- Does not generate PDF bytes.
- Does not write a local file.
- Does not silently overwrite the uploaded desktop PDF.

Export Annotated PDF is the explicit PDF-copy action:
- Generates PDF bytes.
- Opens the desktop Save As path when available.
- Writes/downloads only the chosen/exported copy.

Imported embedded PDF annotation policy:
- Preserve the original PDF native annotation layer.
- Skip app-imported copies during export.
- This avoids duplicate Polygon/PolyLine/Ink rendering and keeps professional export behavior conservative.
- Remaining risk: if a user edits an imported native annotation as an app object, that imported edit is not flattened into export yet because imported objects are intentionally skipped to avoid duplicates.

## What Changed

- `src/App.jsx`
  - Added `summarizeAnnotationCountsForSaveExport`.
  - Changed `handleSaveDocument` to log `actionType:"app-state-save"` and to stop calling PDF byte generation/local write.
  - Normal Save now alerts: `Annotations saved. Use File > Export Annotated PDF to create a PDF copy.`
  - Normal Save calls `cloudSyncForceFlush()` for cloud docs so the log can prove Supabase annotation save ran.
  - `handleExportAnnotatedPDF` now logs `actionType:"pdf-export"`, document id, PDF generation/write status, output path, annotation counts, and embedded-native handling.
- `src/utils/pdfAnnotationsPdfLib.js`
  - Logs PDF generation diagnostics.
  - Counts app objects by type.
  - Logs imported app annotations skipped.
  - Refuses original-path overwrite unless `allowOriginalOverwrite:true` is explicitly passed.
- `src/utils/saveAnnotatedPDFFile.js`
  - Passes `actionType:"pdf-export"` / document id into PDF generation.
  - Logs explicit export file/download outcomes.
- `tests/pdfSaveExportContract.test.mjs`
  - Verifies export can generate bytes without writing.
  - Verifies original-path overwrite is refused by default.

## Verification

Browser/app verification:
- Opened `http://localhost:5174/`.
- Opened cloud document `New document.pdf`.
- Drew one app ink annotation.
- Pressed Cmd/Ctrl+S.
- Save diagnostic log showed:
  - `actionType:"app-state-save"`
  - `documentId:"e53f80f3-9348-4bcd-8de5-6af570b00013"`
  - `supabaseAnnotationSaveRan:true`
  - `pdfBytesGenerated:false`
  - `localFilesystemWrite:false`
  - `outputPath:null`
  - `annotationCountsByType:{"path":1}`
- Reloaded the app and reopened `New document.pdf`.
- Hydration log showed Supabase returned the saved row:
  - `totalRows:1`
  - `rowsByType:{"ink":1}`
  - `pagesWithObjects:1`
  - source-of-truth selected Supabase durable snapshot.

Diagnostic artifacts:
- `test-logs/annotation-fix-14/browser-save-reload-logs.json`
- `test-logs/annotation-fix-14/browser-reloaded-annotation.png`
- `test-logs/annotation-fix-14/pdf-save-export-contract-diagnostic.json`
- `test-logs/annotation-fix-14/New-document-exported.pdf`
- `test-logs/annotation-fix-14/SE-011-Security-Shop-Drawing-Rev2---05.06.25-exported.pdf`

Local/export PDF verification:
- Ran export diagnostics against:
  - `/Users/isaiahcalvo/Desktop/New document.pdf`
  - `/Users/isaiahcalvo/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`
- Each diagnostic export included one user app rectangle and one fake imported app annotation.
- Export logs showed `importedAppAnnotationsSkipped:1` and `pdfAnnotationsAdded:1`.
- Reopened exported bytes with `pdf-lib` and counted PDF `/Annots`.
- `New document.pdf`: original 3 annotations, exported 4, delta 1.
- `SE-011...pdf`: original 503 annotations, exported 504, delta 1.
- Both original desktop files had identical size and mtime before/after export diagnostic, proving no overwrite.

## Test Commands

- `node --test tests/pdfSaveExportContract.test.mjs` - pass.
- `npm test` - pass: 577 pass, 6 skipped, 0 failed.
- `npm run build` - pass. Warnings only: existing pdf.js eval warning, dynamic/static import chunking warnings, large bundle warning.

## Remaining Risks / Decisions Needed

- Explicit overwrite of the original PDF is now blocked at the helper level unless a future user-confirmed overwrite flow passes `allowOriginalOverwrite:true`. No such UI flow exists today.
- Imported native annotation edits are not exported as edited app copies. The current safer behavior is preserve native originals and skip imported app copies to avoid duplication.
- The in-app browser cannot trigger the Electron Save As dialog, so explicit desktop Save As UI was verified by code path, build, unit test, and artifact-level PDF export diagnostics rather than by clicking the Electron menu.
