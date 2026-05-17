# Annotation Lifecycle Matrix

Date: 2026-05-15

Purpose: reconcile the open export/import checklist after:

- `4f2b276a fix(search): stabilize syncfusion highlight zoom`
- `b20fcc08 Fix PDF annotation export import round trip`

This file is status documentation only. It does not cover thumbnail, team-data, or project-file persistence work, which is being handled separately.

## Current Status

| Area | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Left-rail text search highlight/jump stability | Done | `4f2b276a` updated `src/App.jsx` and `src/components/SyncfusionPDFContainer.jsx` for Syncfusion highlight zoom behavior. | Keep `KAL-17` separate unless survey-highlight item jumps were explicitly retested; left-rail search and survey-list jump are related but not identical flows. |
| Regular app annotation PDF export/reimport | Done for baseline contract | `b20fcc08` added/expanded `tests/pdfSaveExportContract.test.mjs` and `tests/pdfAnnotationImporter.test.mjs`. | Real-world PDFs still need edge-case validation. |
| Imported native PDF annotations, unedited | Done | Export skips unedited app copies and preserves the native PDF annotation. Audit: `ANNOTATION_FIX_29_IMPORTED_PDF_EDIT_EXPORT_CONTRACT_LOG.md`. | Test with more real PDFs. |
| Imported native PDF annotations, edited in app | Done | `b20fcc08` stamps `pdfImportedEditState: "edited"` and exports the edited app copy while attempting to remove the original native annotation. | Test with more native annotation producers, especially unusual `/NM` or object-ref metadata. |
| Survey highlights in explicit PDF export | Done for PDF behavior | `b20fcc08` keeps survey highlights out of the visible regular PDF annotation stream and stores them in hidden app metadata. | Product still needs to decide spreadsheet/Excel behavior separately. |
| Space/region-scoped annotations in explicit PDF export | Done for PDF behavior | `b20fcc08` embeds app-layer space/region/scoped state in hidden metadata instead of exporting it as normal visible PDF annotations. | Product still needs to decide whether users need a visible scoped-export mode later. |
| Hidden app-layer reimport | Done | `b20fcc08` restores survey highlights, scoped annotations, scoped callouts, spaces, and regions from `SurveyAppLayerState`. | Real-world regression files should be retained if failures appear. |
| Null/stale region metadata crash on reimport | Done | `b20fcc08` added null-region sanitization and `ANNOTATION_FIX_30_NULL_REGION_REIMPORT_CRASH_LOG.md`. | Retest with the original crashing PDF when available. |
| Red Syncfusion native handles after reimport | Done | `b20fcc08` hides native annotation canvas and Syncfusion adorner selection layer when native annotations were imported into the app layer. | Recheck if Syncfusion changes internal DOM names. |
| Print/export product contract | Partially done | Current code now has a clearer explicit PDF export split. | Document final product language for normal print, explicit PDF export, survey/Excel export, spaces, and regions. |
| Print artifact-first path | Not done | No dedicated temporary printable-PDF artifact path is proven yet. | Build/test artifact generation before new print UI work. |
| Custom print/export UI mockups | Not ready | Backend lifecycle is better, but print artifact behavior is still open. | Keep `KAL-8` blocked behind product contract and artifact proof. |

## Type Matrix

| Annotation/data type | App state source | Explicit PDF export behavior after `b20fcc08` | Reimport behavior after `b20fcc08` | Status |
| --- | --- | --- | --- | --- |
| Pen / path | Regular app annotation state | Visible PDF annotation with app metadata | Restores app geometry/style from `SurveyAppAnnotation` metadata | Done |
| Highlighter / regular highlight | Regular app annotation state | Visible PDF annotation with app metadata | Restores app geometry/style from metadata | Done |
| Rectangle / circle / shapes | Regular app annotation state | Visible PDF annotation with app metadata | Restores app geometry/style from metadata | Done |
| Line | Regular app annotation state | Visible PDF annotation with app metadata | Restores app geometry/style from metadata | Done |
| Arrow | Regular app annotation state | Visible PDF annotation with app metadata | Restores app `tool: "arrow"` and handle fields | Done |
| Text box | Regular app annotation state | Visible PDF annotation with app metadata | Restores as app text box metadata | Done |
| Counter | App-specific annotation metadata | Exports with app metadata so it does not degrade to a plain circle on reimport | Restores counter metadata | Done for contract tests |
| Callout | App callout state/metadata | Exports with app metadata | Restores callout metadata | Done for contract tests |
| Survey highlight | Survey highlight state | Hidden app-layer metadata, not visible normal PDF annotation | Restores to app survey layer | Done for PDF export/reimport |
| Region-scoped annotation | Region/app-layer state | Hidden app-layer metadata | Restores to app layer | Done for PDF export/reimport |
| Space-scoped annotation | Space/app-layer state | Hidden app-layer metadata | Restores to app layer | Done for PDF export/reimport |
| Imported native PDF annotation, unchanged | Imported app copy with native PDF identity | App copy skipped; original native annotation preserved | Imports into app layer and native interaction layer is hidden when appropriate | Done |
| Imported native PDF annotation, edited | Imported app copy marked `pdfImportedEditState: "edited"` | Edited app copy exported; matching original native annotation removed when possible | Imports edited app annotation | Done |
| Unsupported native PDF annotations | Native PDF annotations not fully represented by app tools | Not fully covered by this fix | Needs real-PDF validation | Open |

## Linear Cleanup Recommendation

- `KAL-6` can stay Done.
- `KAL-16` can be marked Done if its scope is left-rail Syncfusion text search highlight/jump stabilization.
- `KAL-5` should remain open but narrowed to final print/export product contract and printable artifact behavior.
- `KAL-7` should remain open but narrowed to product decisions for survey/region/space output modes beyond the now-fixed explicit PDF behavior.
- `KAL-8` should remain open and blocked until `KAL-5` and the artifact-first print path are proven.
- `KAL-9` remains open for real PDF edge cases.
- `KAL-10` remains open for two-user collaboration validation.
