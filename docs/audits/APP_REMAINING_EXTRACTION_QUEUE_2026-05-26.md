# App.jsx Remaining Extraction Queue

Date: 2026-05-26

This is a coordinator-safe audit produced while bookmark reorder and non-bookmark cleanup agents are running. It does not change runtime behavior.

## Current State

`src/App.jsx` is still about 45.7k lines after these completed extractions:

- Template/module/category/entity reorder rows and helpers moved out.
- PDF top/right chrome moved out.
- Dead bottom toolbar removed.
- PDF left rail render and sidebar/bookmark API publishing moved out.

The remaining largest conflict source is the `PDFViewer` function, which starts around `src/App.jsx:9489` and owns many unrelated systems.

## Highest-Value Next Extractions

1. **Syncfusion interaction/performance controller**
   - Approximate region: `src/App.jsx:9600-11530`.
   - Owns interaction windows, overlay lag recorder, resident page/proxy logic, commit queues, wheel zoom handling, and Syncfusion page container reconciliation.
   - Why next: it is large, highly specialized, and mostly independent from bookmark reorder.
   - Suggested target: `src/hooks/useSyncfusionInteractionController.js` plus small utility helpers.
   - Guardrail: do not change zoom behavior or Syncfusion event lifecycle while extracting.

2. **Callout state and editing controller**
   - Approximate region: `src/App.jsx:12080-12398`, plus callout history/edit callbacks around `src/App.jsx:18796-19088`.
   - Owns callout style updates, text-style flags, cut/copy/paste, blank commit behavior, and edit-mode entry.
   - Why next: Linear callout unification work needs this isolated before model migration.
   - Guardrail: callouts currently have separate Bold, Italic, Underline, Strikethrough flags and a separate context menu from regular annotations. Preserve behavior until the unification issue intentionally changes it.

3. **Bookmark state/model hook**
   - Approximate region: `src/App.jsx:20106-20430`, plus `src/hooks/usePdfLeftRailApiPublisher.js`.
   - Owns PDF outline import, bookmark create/update/delete, and sidebar persistence.
   - Why next: do this only after the active bookmark reorder agent finishes, because it overlaps that work.
   - Guardrail: do not touch while bookmark reorder implementation is in flight.

4. **Excel/survey import-export controller**
   - Approximate region: `src/App.jsx:20932-23766`.
   - Owns survey export to Excel, OneDrive save, template overwrite handling, Excel import/autosync, and sync checkpoints.
   - Why next: large and business-specific; a focused hook would reduce App conflicts without touching PDF rendering.
   - Suggested target: `src/hooks/useSurveyExcelSyncController.js`.

5. **Document presence/cloud sync orchestration**
   - Approximate region: `src/App.jsx:23766-24808`, plus existing `src/hooks/useAnnotationCloudSync.js` and `src/hooks/useDocumentPresenceList.js`.
   - Owns presence failure handling, cloud sync status, document ownership, and bulk delete permission flow.
   - Why next: good candidate after callout/annotation ownership audit clarifies data boundaries.

6. **Print/export panel controller**
   - Approximate region: `src/App.jsx:33301-33714`.
   - Owns print panel page collection, thumbnail generation, rotation lookup, and print dispatch.
   - Why next: relatively self-contained, low collision risk, and easier than annotation model work.
   - Suggested target: `src/hooks/usePrintPanelController.js`.

7. **Dashboard component extraction**
   - Approximate region: `src/App.jsx:2768-6263`.
   - Owns documents/projects/templates/home selection UI.
   - Why next: still large, but some home/template work has already been extracted. This can continue separately from PDF internals.
   - Guardrail: avoid template reorder files while separate reorder architecture work is active.

## Files That Still Need Separate Audits

These remain large enough to deserve their own audit before edits:

- `src/PageAnnotationLayer.jsx` at about 10.1k lines.
- `src/components/SVGAnnotationLayer.jsx` at about 5.2k lines.
- `src/components/FabricEditCanvas.jsx` at about 4.0k lines.
- `src/components/SyncfusionPDFContainer.jsx` at about 2.8k lines.

## Parallel Work Rules

- Only one agent should own bookmark/sidebar reorder files at a time.
- Avoid `src/App.jsx` for parallel work unless the target region is disjoint and tiny.
- Callout cleanup should not run in parallel with annotation model unification unless ownership is explicit.
- Preserve reorder playgrounds until equivalent regression tests exist.
- Before committing, stage only files from the current task because the worktree may include unrelated agent/user changes.
