# Annotation Fix 29 - Imported PDF Edit Export Contract

Date: 2026-05-14

## Current Behavior Found

- Export skipped any app object with `isPdfImported` or `pdfAnnotationId` in `buildPdfExportAnnotationPlan`.
- That skip was correct for unedited imported PDF-native annotations because the original PDF already contains the native annotation.
- There was no reliable edited/dirty field for imported PDF annotations. If an imported native annotation was edited in app state, export could still skip the edited app copy and preserve only the old native PDF annotation.
- Imported annotations are marked mainly with `isPdfImported`, `pdfAnnotationId`, and `pdfAnnotationType` from `src/utils/pdfAnnotationImporter.js`.
- The black rectangle/duplicate artifact had a separate root cause: explicit desktop export used Syncfusion `saveAsBlob()` as the source PDF when available. That viewer blob could already contain rendered annotation appearances in the base page, and then `pdf-lib` added our editable app annotations again.
- Follow-up logs showed export included Survey highlights/region data in the same regular PDF annotation stream. Those layers should not be visible/editable in other PDF apps as normal annotations.
- The red square handles were Syncfusion native annotation UI leaking through. Regular app annotations should be handled by our app overlay, not Syncfusion's native annotation interaction layer.
- The later red-handle repro showed the native annotation canvas was hidden, but Syncfusion's `diagramAdornerLayer` / `diagramAdorner_svg` / `SelectorElement` selection overlay was still visible and pointer-active on page 1. That was the red square handle layer in the screenshot.
- The final selection repro showed export/import was no longer duplicating, but pan-tool quick selection used a separate DOM hit-test that did not use the widened SVG path hit target. Select tool could hit the stroke; pan tool often missed it.
- GitHub log pushing was failing with HTTP 409 conflicts on the `logs` branch, not authentication failure.
- A later region toggle crash came from `SpaceRegionOverlay`: it called `useLayoutEffect` after early returns. When the overlay toggled from visible to hidden, React saw a different hook order and crashed the `PDFViewer` tree.
- The regular annotation audit found that arrows needed one more app metadata field restore. The PDF line ending exported, but the app-level `tool: "arrow"` flag and arrow handle fields also need to come back so the custom middle/end handles stay available.
- The latest import crash came from hidden app-layer space metadata restoring a null/stale region entry. The deeper cause was `pdfAppAnnotationMetadata`'s JSON-safe clone depth limit: valid region objects nested under `spaces[].assignedPages[].regions[]` were being converted to `null` during export metadata serialization.

Pre-existing unrelated working-tree changes were present before this fix:

- `.planning/STATE.md`

That was not reverted.

## Files Changed

- `src/App.jsx`
- `src/electron-main.js`
- `src/SpaceRegionOverlay.jsx`
- `src/utils/annotationHitTest.js`
- `src/utils/pdfAnnotationImporter.js`
- `src/utils/pdfAnnotationsPdfLib.js`
- `src/utils/pdfAppAnnotationMetadata.js`
- `src/utils/annotationVisibilityRules.js`
- `src/components/SaveLogBanner.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `tests/annotationHitTest.test.mjs`
- `tests/annotationVisibilityRules.test.mjs`
- `tests/pdfAnnotationImporter.test.mjs`
- `tests/pdfSaveExportContract.test.mjs`
- `docs/audits/annotation-fixes/ANNOTATION_FIX_29_IMPORTED_PDF_EDIT_EXPORT_CONTRACT_LOG.md`

## Exact Export Rule Implemented

- Explicit PDF export uses the original `pdfFile` bytes as the source PDF. It does not use `syncfusionViewerRef.current.saveAsBlob()`.
- Regular viewer annotations export as real PDF annotations.
- Survey/module, space, and region scoped annotations do not export as normal visible PDF annotations.
- Survey highlights from `highlightAnnotations` are not exported as normal visible PDF annotations.
- Survey/module, space, region, scoped callouts, and app layer state are embedded in hidden app metadata under `SurveyAppLayerState`.
- Hidden app metadata preserves nested space/page/region records instead of truncating valid region objects to `null`.
- Hidden app metadata drops null region entries defensively before export and again when restored on import.
- When the exported PDF comes back into this app, that hidden app metadata restores those app layers separately from the regular PDF annotation layer.
- Other PDF apps should only see/interact with the regular viewer annotations.
- App-created regular annotations also restore their original app geometry/style from `SurveyAppAnnotation` metadata on reimport, so a pen stroke comes back as the same app stroke instead of a PDF-derived bounding box.
- Unedited imported PDF-native app copies are skipped during export with reason `imported-pdf-native-preserved`.
- Edited imported PDF-native app copies are exported from app state when `pdfImportedEditState === "edited"` on the object or its `data`.
- When exporting an edited imported copy, the exporter attempts to remove the matching original native PDF annotation first.
- Matching is by pdf.js-style object ref id such as `8R` and by native annotation `/NM` when available.
- If no matching native annotation can be removed, export still writes the edited app copy and logs a removal miss.
- On reimport, if all renderable native PDF annotations were imported into our app layer, the Syncfusion native annotation layer and selection chrome are hidden so the user does not get duplicate interaction boxes or red native handles.
- The hide rule now includes Syncfusion's diagram adorner selection layer as well as the native annotation canvas.

## Edit Marker Added

`App.jsx` now stamps imported objects with:

- `pdfImportedEditState: "edited"`
- `pdfImportedEditedAt`
- `pdfImportedEditedBy`
- `pdfImportedEditSource`
- `data.pdfImportedEditState: "edited"`

The marker is added only when a local annotation save changes an imported object compared with the previous page state. Import, hydration, and sync sources are ignored so freshly imported native annotations stay unedited.

## Diagnostics Added

Stable prefixes: `[PDFImportedEditExport]`, `[PDFSaveExport]`, and `[PDFAppLayerStateImport]`.

Logs now include:

- `edit marker stamped`: page, source, and count of imported copies marked edited.
- `[PDFImportedEditExport] summary`: imported native copies skipped, edited imported copies exported, native copies removed, and removal misses.
- `[PDFSaveExport] source PDF selection`: confirms explicit PDF export used `original-pdf-bytes` and skipped the viewer save blob.
- `[PDFSaveExport] pdf bytes generated`: export scope, skipped reasons, app layer metadata summary, counters, and imported edit counts.
- `[PDFAppLayerStateImport] summary`: whether hidden app layer metadata was found and how many scoped pages/callouts/highlights/spaces were present.
- `[PDFAppLayerStateImport] restored`: hidden app layer objects restored into app state.
- `[PDFImport] native layer policy`: for both cloud-backed and regular imported PDFs, shows `hideNativeLayer`, native renderable counts, imported copy count, and why Syncfusion's native annotation/selection layers should be hidden.
- Save-log GitHub push failures now write a local `save-log-github-push-failure` snapshot with the full non-truncated push error.
- `[HitTest pan-svg-fallback]`, behind `window.__DIAG_HIT_TEST`, shows how many SVG wrappers and path hit targets the pan hit-test inspected and what annotation/callout/counter it resolved.
- GitHub log push now retries branch-conflict HTTP 409s with unique retry filenames before surfacing failure.
- Region overlay toggle no longer changes React hook order when hiding/showing the overlay.
- Hidden app-layer space metadata is sanitized on export and import so null/stale region entries cannot crash `SVGAnnotationLayer`.

## Tests Run

- `node --test tests/annotationVisibilityRules.test.mjs tests/annotationHitTest.test.mjs tests/pdfSaveExportContract.test.mjs tests/pdfAnnotationImporter.test.mjs`
  - Pass: 75 tests.
- `node --test tests/annotationContractRegression.test.mjs tests/pdfAnnotationNormalization.test.mjs tests/pdfNativeExport/index.test.mjs tests/pdfNativeExport/coordinateSpace.test.mjs`
  - Pass: 29 tests.
- `node --check src/electron-main.js`
  - Pass.
- `node --check src/SpaceRegionOverlay.jsx`
  - Not applicable: Node's syntax checker rejects `.jsx` extension in this repo before parsing. React syntax was covered by `npm run build`.
- `npm run build`
  - Pass. Vite emitted existing-style warnings about pdf.js eval, static plus dynamic imports, and large chunks.

## Manual / Browser Testing

- Checked `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-14_18-20-47/console.log`.
- Checked `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/Logs/2026-05-14_19-03-50/console.log`.
- The old bad export path showed one regular `path` plus two Survey `highlight` objects considered for export. Those Survey highlights matched the unwanted rectangles from the screenshot.
- The latest log showed `/Users/isaiahcalvo/Desktop/1.pdf` exported with one regular `path`, two Survey highlights skipped from visible PDF export, and app-layer metadata embedded.
- The latest saved log captured the GitHub push failure. The failure was a GitHub contents API conflict: `gh` expected one blob SHA while the remote file was already at another SHA, and the fallback fetch/update hit another HTTP 409. This is not an auth failure; it is a stale remote-file update conflict.
- Created a temporary browser fixture PDF for the round-trip check.
- Opened it in the Codex internal browser at the dev test route.
- Drew a red pen stroke in the app.
- Exported from browser state through `savePDFWithAnnotationsPdfLib`, using the same backend export helper and original PDF bytes.
- Wrote the exported bytes to a temporary browser fixture and reloaded that fixture.
- Reimported that exported PDF in the Codex internal browser.
- Verified app state after reimport:
  - exactly one object on page 1
  - `type: "path"`
  - `pdfAnnotationType: "Ink"`
  - `isPdfImported: true`
  - `selectable: true`
  - `evented: true`
- Verified the Syncfusion native annotation canvas and adorner selection layer were hidden:
  - `visibility: hidden`
  - `pointerEvents: none`
- Verified suspicious red native handle/resize elements were not visible or interactive.
- Copied the user's exported `/Users/isaiahcalvo/Desktop/1.pdf` into a temporary dev fixture and loaded it in the Codex internal browser.
- Verified the imported page had exactly one app stroke, with `selectable: true`, `evented: true`, and the native Syncfusion annotation canvas hidden with pointer events disabled.
- Reopened the user's exported `/Users/isaiahcalvo/Desktop/1.pdf` through the Codex internal browser after the adorner fix and verified page 1 now reports:
  - `data-native-pdf-annotation-layer-hidden="true"`
  - `diagramAdornerLayer`: `visibility: hidden`, `pointerEvents: none`
  - `diagramAdorner_svg`: `visibility: hidden`, `pointerEvents: none`
  - `SelectorElement`: `visibility: hidden`, `pointerEvents: none`
  - native annotation canvas: `visibility: hidden`, `pointerEvents: none`
- Captured a browser screenshot during verification and removed the temporary scratch artifacts afterward.
- After the pan hit-test fix, copied `/Users/isaiahcalvo/Desktop/1.pdf` into a temporary dev fixture and opened it in the Codex internal browser.
- Verified the imported pen stroke has one SVG path hit target with widened stroke hit area.
- Simulated a pan-tool quick click on the stroke while the SVG path had `pointer-events: none`.
- Verified the pan click selected the app stroke and rendered our custom selection handles: white circular corner handles, side pill handles, and rotation handle.
- Removed the temporary fixture afterward.
- Browser-tested `SpaceRegionOverlay` directly by rendering with a valid region, re-rendering with no regions, then rendering the valid region again. No hook-order crash or console error occurred.
- Reviewed the saved crash log from `Logs/2026-05-14_21-41-07`. The export wrote one regular PDF annotation and embedded Survey/space/region state as app metadata, but the hidden original cloud tab was still mounted and began cloud hydration while the imported PDF tab restored app-layer state. Cloud annotation sync is now gated to the active PDF tab, and annotation selection is cleared when a PDF tab becomes inactive or changes document context.
- Reviewed the saved crash log from `Logs/2026-05-14_22-13-47`. The import restored app-layer metadata, then `SVGAnnotationLayer` crashed with `Cannot read properties of null (reading 'regionId')`. The null came from truncated nested region metadata. Export now preserves nested regions, import sanitizes restored spaces, and the renderer uses null-safe region lookup.
- ErrorBoundary and console log serialization now record error `name`, `message`, `stack`, and `cause` instead of saving React errors as `{}`.
- The automated export/import contract now covers regular path/pen, arrow, regular highlight, rectangle, circle, line, polygon, polyline, text box, counter pin metadata, and callout metadata.
- The hidden app-layer contract covers survey highlights, scoped annotations, scoped callouts, spaces, and regions as app metadata instead of normal visible PDF annotations.
- Added a regression where hidden app-layer `spaces[].assignedPages[].regions[]` contains `[null, { regionId }]`; export metadata now writes only the valid region and import visibility normalization drops null entries.

## Manual Test Steps For User

1. Open a clean PDF.
2. Draw a regular pen stroke in the normal viewer.
3. Export the PDF.
4. Reopen the exported PDF in the app.
5. Confirm there is one visible pen stroke, no black rectangles, and no red Syncfusion-native handles.
6. Capture logs with the existing save-log shortcut if anything looks wrong.

For hidden app layers:

1. Create or load Survey highlights, spaces, regions, or scoped callouts.
2. Export the PDF.
3. Open it in another PDF app and confirm only regular viewer annotations are visible/editable.
4. Reopen it in this app and confirm Survey/space/region data restores as app state.

For imported native annotations:

1. Open a PDF that already contains native PDF annotations.
2. Edit one imported annotation in the app.
3. Export the PDF.
4. Reopen the exported PDF.
5. Search the captured logs for `[PDFImportedEditExport]`, `[PDFSaveExport]`, and `[PDFAppLayerStateImport]`.

## How To Read The Logs

- `[PDFSaveExport] source PDF selection` with `source: "original-pdf-bytes"` and `skippedViewerSaveAsBlob: true` means export avoided the path that baked duplicate annotation appearances into the base page.
- `exportContract.defaultScope: "regular-viewer-annotations-only"` means normal PDF export is not exporting Survey/space/region layers as regular annotations.
- `annotationSkippedByReason.survey-highlight-export-excluded` means Survey highlights were intentionally excluded from normal PDF annotation export.
- `annotationSkippedByReason.scoped-annotation-export-excluded` means module, space, or region scoped annotations were intentionally excluded from normal PDF annotation export.
- `appLayerStateEmbedded: true` means hidden app metadata was written.
- `appLayerStateSummary` shows how many hidden app-layer items were embedded.
- Hidden app-layer `spaces[].assignedPages[].regions[]` should contain real region objects with `regionId`, not `null`. If `null` appears there in a saved log, the running app is older than this fix or the PDF was exported by the older broken build.
- Regular app arrows should have `SurveyAppAnnotation` metadata with `appType: "arrow"`, `flags.tool: "arrow"`, and `lineEnding2`, so reimport keeps the app's arrow interaction model.
- `[PDFAppLayerStateImport] summary` with `found: true` means the app found hidden app metadata on import.
- `[PDFAppLayerStateImport] restored` shows what was restored into app state.
- `importedNativeCopiesSkipped > 0` means unedited imported native annotations were preserved from the original PDF and not duplicated.
- `editedImportedCopiesExported > 0` means at least one edited imported annotation was exported from app state.
- `editedImportedNativeCopiesRemoved > 0` means the old matching native annotation was removed before writing the edited app version.
- `editedImportedNativeCopiesRemoveMisses > 0` means the old native annotation could not be identified for removal. In that case the edited app copy is still exported, but the old native copy may remain too.
- In importer diagnostics, `hideNativeLayer: true` with `nativeOnlyAnnotationIds: []` means our app imported all renderable native annotations and the native Syncfusion layer should not draw duplicate/placeholder annotations.
- In `[PDFImport] native layer policy`, `hideNativeLayer: true` on a page means both the native annotation canvas and Syncfusion's red-handle adorner selection layer should be hidden for that page.
- If `window.__DIAG_HIT_TEST = true` is enabled, `[HitTest pan-svg-fallback]` should resolve the clicked stroke to `annotation:<index>` when pan quick-click selection succeeds.
- `[CloudSync][hook] hydrate skipped` with `hydrateEnabled: false` on an inactive tab is expected. Hidden PDF tabs should not hydrate or replace annotation state while another PDF is being imported.
- `ErrorBoundary caught an error` should now include `message` and `stack`; `{}` means the running app has not picked up this logging patch yet.
- GitHub push conflict retries show as `gh conflict retry` or `fetch fallback conflict retry`. A final GitHub push failure after those retries means the remote `logs` branch is still rejecting updates.

## Remaining Risks

- PDFs already exported through the bad `saveAsBlob()` source path can have artifacts baked into page content. This fix prevents new exports from creating that artifact; it cannot clean page pixels already baked into an existing exported PDF.
- PDFs already exported while the metadata clone depth bug was present may contain `null` region entries in hidden metadata. Import now tolerates that, but the clean metadata is only produced by new exports.
- Native removal depends on matching `pdfAnnotationId` to a PDF object ref like `8R` or a matching `/NM`. PDFs with unusual ids may log a removal miss.
- Existing imported annotations that were edited before this marker existed may not be recognized as edited unless they are modified again.
- Hidden app-layer PDF metadata can travel with exported files, but a database-backed PDF ID strategy may still be useful later for large/shared projects and conflict handling.
- No new print or export UI was added.
