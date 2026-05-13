# Annotation Fix 15 - Save Feedback Cleanup and Export Menu Label Log

Date: 2026-05-12

## Scope

Fix 15 keeps the Fix 14 Save/Export split intact:
- Normal Save is app-state/cloud persistence only.
- Export is the explicit PDF-copy action.
- This task does not change the export architecture.
- This task does not fix counter pin export/import.

## Research Findings

`handleSaveDocument` call sites:
- `src/App.jsx`: auto-save interval calls `handleSaveDocument(true)`.
- `src/App.jsx`: before-quit handler calls `handleSaveDocument(true)`.
- `src/App.jsx`: keyboard handler calls `handleSaveDocument()` for Cmd/Ctrl+S.

Save feedback before this fix:
- `handleSaveDocument(false)` completed app-state save diagnostics, then showed a blocking browser alert:
  - `Annotations saved. Use File > Export Annotated PDF to create a PDF copy.`
- Auto-save and before-quit paths passed `silent=true`, so they already skipped that alert.

Save/Export feedback surfaces found:
- `src/components/SyncStatusChip.jsx`: existing non-blocking sync status pill.
- `src/components/SaveLogBanner.jsx`: existing Save Log banner/toast surface for diagnostic log submission.
- `src/components/collab/UndoToast.jsx`: existing delete undo toast surface.
- `src/components/collab/StorageFailureBanner.jsx`: existing storage/sync warning banner.
- Export still uses the existing Electron Save As dialog and alert-based error handling. Successful normal Save no longer uses a blocking alert.

Electron menu label location:
- `src/electron-main.js`, `createAppMenu()`, File submenu export item.

## Files And Functions Changed

- `src/App.jsx`
  - `handleSaveDocument`: removed the successful manual Save `alert(...)`.
  - `handleSaveDocument`: kept the existing app-state save diagnostics and persistence path.
  - `handleExportAnnotatedPDF`: changed the desktop-unavailable message and Save As dialog title from "Export Annotated PDF" wording to "Export" wording.
  - `handleExportAnnotatedPDF`: removed the blocking successful Export alert; the explicit Save As flow and `[PDFSaveExport] action complete` output path diagnostic provide non-blocking confirmation.
  - Updated nearby comments to describe File > Export.
- `src/electron-main.js`
  - `createAppMenu`: changed File menu item label from `Export Annotated PDF...` to `Export`.
  - Kept accelerator `CmdOrCtrl+Shift+E` and IPC event `menu:export-annotated-pdf`.
- `tests/pdfSaveExportContract.test.mjs`
  - Added a static contract test that successful normal Save does not contain the old blocking `Annotations saved` alert.
  - Added a static contract test that the Electron File menu labels the PDF output item `Export` and still sends the export IPC event.
  - Added a static contract test that successful explicit Export does not show the old blocking `Exported to ...` alert.

## Save Behavior Now

Normal Save still runs the Fix 14 app-state save path:
- Saves local annotation backup through `saveAnnotationsByPage`.
- Clears unsaved annotation state.
- Saves survey data to Supabase storage when cloud sync is enabled.
- Calls `cloudSyncForceFlush()` for cloud-backed documents so Supabase/Y.Doc annotation persistence can flush.
- Logs `[PDFSaveExport] action start` and `[PDFSaveExport] action complete`.

Successful normal Save now shows no blocking modal or alert. Feedback is non-blocking:
- The existing tab unsaved marker clears.
- The existing sync status/sync warning surfaces remain responsible for visible save/sync state.
- The console diagnostics remain available for Save Log/debugging.

## Proof Save Still Syncs To Supabase/App State

Runtime smoke check in the local Vite app at `http://127.0.0.1:5173/`:
- Opened existing cloud document `New document.pdf`.
- Pressed `Cmd+S`.
- Console showed:
  - `[PDFSaveExport] action start` with `actionType:"app-state-save"`.
  - `[CloudSync][push] upsertAnnotationsByPage ok`.
  - `[Phase31 UAT] save:fan-out done`.
  - `[PDFSaveExport] action complete` with `supabaseAnnotationSaveRan:true`.
- Reloaded the app and reopened `New document.pdf`.
- Console showed cloud/Y.Doc/app-state rehydration with:
  - `materializedTotal:1`
  - `yMapByType:{"path":1}`
  - `byPageByType:{"path":1}`

## Proof Save Does Not Generate PDF Bytes Or Write Local Files

Runtime `Cmd+S` diagnostic log showed:
- `actionType:"app-state-save"`
- `pdfBytesGenerated:false`
- `localFilesystemWrite:false`
- `outputPath:null`
- `embeddedPdfNativeAnnotationHandling:"not-applicable-app-state-only"`

The implementation still does not call `savePDFWithAnnotationsPdfLib` from `handleSaveDocument`.

## Proof Successful Save Does Not Block

Runtime `Cmd+S` in the local browser smoke check produced no blocking browser alert/dialog.

Automated contract:
- `tests/pdfSaveExportContract.test.mjs` asserts `src/App.jsx` no longer contains `alert('Annotations saved.`.

## Proof Export Menu Label Changed

Code:
- `src/electron-main.js` File menu export item now uses `label: 'Export'`.

Automated contract:
- `tests/pdfSaveExportContract.test.mjs` asserts the Electron main source contains `label: 'Export'`.
- The same test asserts the old `label: 'Export Annotated PDF` menu label is absent.
- The same test asserts the export IPC event `menu:export-annotated-pdf` is still present.

Export remains explicit:
- `handleExportAnnotatedPDF` still runs only from the export menu IPC subscription.
- Export still calls `savePDFWithAnnotationsPdfLib(..., { returnBytes: true, actionType: 'pdf-export' })`.
- Export still opens the Save As path through `window.electronAPI.saveFile`.
- Export still logs `actionType:"pdf-export"`, PDF generation info, local filesystem write status, and output path.
- Successful Export no longer shows a blocking success alert. Export failure paths still use stronger alert feedback.

## Test Results

- `node --test tests/pdfSaveExportContract.test.mjs`
  - Pass: 5 tests, 0 failures.
- `npm test`
  - Pass: 580 tests, 6 skipped, 0 failures.
- `npm run build`
  - Pass.
  - Existing warnings only:
    - Vite CJS Node API deprecation warning.
    - pdf.js eval warning.
    - Large chunk warnings.
    - Existing dynamic/static import chunking warnings.

## Manual / Runtime Checks

Local browser smoke check:
- Started Vite at `http://127.0.0.1:5173/`.
- Opened `New document.pdf`.
- Pressed `Cmd+S`.
- Confirmed no blocking alert/dialog appeared.
- Confirmed Save diagnostics showed app-state save, no PDF bytes, no local filesystem write.
- Reloaded and reopened the same document.
- Confirmed the annotation rehydrated from cloud/Y.Doc/app state via console counts.

Electron native menu visual check:
- Not directly clicked in this browser smoke check because the Electron native menu is outside the web runner.
- Covered by `src/electron-main.js` code inspection and the static menu contract test.

Export trigger check:
- Native Save As export was not triggered in the browser smoke check because `window.electronAPI.saveFile` is only available in the Electron shell.
- Covered by the existing export helper test, unchanged export code path, build, and static menu contract.

## Known Later Issue

Counter pins export/reimport currently round-trip as generic PDF circles. They need a separate export metadata/import contract fix so counter identity, numbering, pointer metadata, and rendering semantics survive PDF export and reimport.
