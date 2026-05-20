# Handoff: Survey-BetaSafeS2 codebase consistency cleanup

**Generated**: 2026-05-19 (updated)
**Branch**: `survey-marker-rename` (18 commits ahead of `main`, working tree clean)
**Status**: In Progress — rename complete; delete/panel/Excel + needs-Entity preview fixed & verified; Plan B/C + merge remain

## Goal

Make the Survey-BetaSafeS2 codebase internally consistent and professionally
documented. The big rename (Survey Highlight → Survey Marker) is done. A cluster
of testing-surfaced Survey Marker bugs is now fixed. Two planned renames and a
merge to `main` remain.

## Completed

- [x] Multi-agent codebase audit; `CONTEXT.md` rewritten as a real glossary.
- [x] **Plan A — Survey Highlight → Survey Marker rename.** Code, database, saved-PDF format. Build passes; 673/680 tests pass (1 pre-existing failure, 6 skipped).
- [x] Three live Supabase migrations (`20260518000001/2/3`).
- [x] Bug fix — Entity step was skipped (legacy `ballInCourtEntities` key).
- [x] Bug fix — entity colour did not persist.
- [x] **Orphan / delete bug fixed.** `handleSurveyMarkerDeleted` now deletes unconditionally when given an explicit `highlightId` (dropped the `!selectedModuleId`/`!selectedTemplate` early-return and module/page-match gate for the ID case; the template-dependent item cleanup is guarded). Deleting a Survey Marker now reliably removes it from the page, the panel, Supabase, and the Excel export.
- [x] **Right-click on a Survey Marker is suppressed.** No context menu of any kind appears (Survey Markers have no menu actions this release). Fix is in `src/utils/contextMenuDiagnostics.js`.
- [x] **Double-click on a Survey Marker** now expands its own panel row (showing its checklist items) and collapses every other category/marker row.
- [x] **Needs-an-Entity preview style fixed.** A Survey Marker created without an Entity now previews as a blue dashed outline with a transparent fill. Cause was not the `needsEntity` pipeline — the six name-prompt commit blocks in `src/App.jsx` hardcoded an amber fallback (`rgba(255,193,7,1.0)`) and built the preview with that color and no `needsEntity` flag. Fallback is now `null`; preview built with `needsEntity:true` when no Entity. Commit `47d5fb45`.
- [x] **Excel resurrection bug fixed.** Deleting a Survey Marker now re-exports the linked Excel (`pushToExcelWithRetry`, fired from an effect after the `surveyMarkers` delete commits). Previously the deleted marker's Excel row survived, and the next document open re-imported it and resurrected the marker location-less. **Verified by direct inspection of `Security_export.xlsx`**: after deletes the workbook held exactly the 2 surviving markers.

## Not Yet Done

- [ ] **Plan B — untangle Space vs Module.** Latent data bug: one field on a Survey Marker (`spaceId`) holds *either* a Module ID *or* a real Space ID depending on creation path (dual-meaning write ~`src/App.jsx:31469`). ~49 `moduleId || spaceId` fallbacks across `App.jsx`, `pdfAnnotationsPdfLib.js`, `pdfCalloutMetadata.js`, `pdfAppAnnotationMetadata.js`. Split into two distinct fields, migrate/backfill, remove the fallbacks.
- [ ] **Plan C — universal-ID rename.** `highlightId` (memory) / `highlight_id` (DB column) are the *universal* identity of EVERY annotation type, misnamed. Rename to `annotationId` / `annotation_id` as its own migration.
- [ ] **Merge `survey-marker-rename` into `main`** once the user signs off (see Warnings — main is currently DB-incompatible).

## Failed Approaches / Lessons (Don't Repeat)

- An audit's occurrence count is a floor, not a ceiling — finish renames with an exhaustive grep against an explicit keep-list.
- `supabase db push` pushes ALL pending migrations at once.
- The user rejected a permanent legacy-name fallback (`entities || ballInCourtEntities`) — convert the data instead.
- Survey Marker rects render from the SVG layer driven by the `surveyMarkers` state — NOT from `annotationsByPage`. Right-clicking a Survey Marker resolves to `kind:'page'`; the context-menu Cut/Delete branch never targets Survey Markers. There is no cut/copy for Survey Markers (the user decided against it for this MVP).
- The linked Excel is a **two-way** source: editing or adding rows in it changes the survey panel. Any fix touching Survey Marker create/delete/sync must keep Excel and the app consistent in both directions.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| "Survey Highlight" → "Survey Marker" | Base layer has a separate highlighter pen tool. |
| `highlightId`/`highlight_id` NOT renamed in Plan A | Universal annotation ID — that is Plan C. |
| No context menu / no cut/copy for Survey Markers | User scoped it out of this MVP release. |
| Delete = destroy everywhere; Excel re-exported on delete | User: deleting must remove from page, panel, DB, AND the Excel. Excel may still legitimately *add* markers via new rows. |
| Apply migrations to live Supabase directly | User is sole user, explicitly authorized. |

## Current State

**Working & verified**: The rename. Builds clean. 673/680 tests pass (the 1 failure, `annotationInitialHydrationSource.test.mjs`, is pre-existing). Delete fully destroys a Survey Marker everywhere including the Excel; double-click expands the panel row; right-click is suppressed. All confirmed against the user's logs and the actual Excel file.

**Uncommitted Changes**: None — working tree clean (this session's work is in 2 commits: `9ff18b08`, `fbfe9ec2`).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `CONTEXT.md` | Canonical domain glossary. |
| `src/utils/surveyMarkerType.js` | `SURVEY_MARKER_TYPE`, `isSurveyMarkerType` — type helper. |
| `src/services/documentSurveyMarkerMapper.js` | Survey Marker ⇄ Supabase row mapping. |
| `src/App.jsx` | ~45.8k lines. `handleSurveyMarkerDeleted` ~31153; the delete→Excel re-export effect right after it; `handleSurveyMarkerClicked` (double-click) ~30831; merge effect computing `needsEntity` ~32074; survey panel ~40700–43000. |
| `src/components/SVGAnnotationLayer.jsx` | Renders Survey Marker rects from the `surveyMarkers` pipeline; `needsEntity` → blue dashed rect ~2334. |
| `src/utils/contextMenuDiagnostics.js` | Right-click dispatcher; survey-marker suppression guard. |
| `Security_export.xlsx` (`/Users/isaiahcalvo/Documents/`) | The user's linked Excel — two-way source. |

## Resume Instructions

1. `git checkout survey-marker-rename`; `npm install` if needed.
2. `npm run build` (expect success); `npm test` (expect 673 pass / 1 pre-existing fail / 6 skipped — any *other* failure is a regression).
3. Start **Plan B — untangle Space vs Module**. The latent bug: a Survey Marker's `spaceId` field holds *either* a Module ID *or* a real Space ID depending on creation path (dual-meaning write ~`src/App.jsx:31469`). There are ~49 `moduleId || spaceId` fallbacks across `App.jsx`, `pdfAnnotationsPdfLib.js`, `pdfCalloutMetadata.js`, `pdfAppAnnotationMetadata.js`. Plan: split into two distinct fields, migrate/backfill existing rows, then remove the fallbacks. This is a data-model change — scope it carefully before editing (consider a brainstorm/plan pass first) and it will need its own Supabase migration.

## Warnings

- **`main` is DB-incompatible.** The backfill migration converted every survey row's `annotation_type` from `highlight` to `survey-marker` and the CHECK now forbids `highlight`. Stay on `survey-marker-rename`, or merge it, before running the app.
- **Do NOT rename `highlightId` / `highlight_id`** as part of other work — that is Plan C, its own migration.
- **Do NOT touch** the Base-layer `'highlighter'` pen tool, Syncfusion text-markup, search-result highlighting, or `highlightColor`.
- High-risk files per `CLAUDE.md`: `src/App.jsx`, `src/PageAnnotationLayer.jsx`, the Fabric canvases, `src/components/SVGAnnotationLayer.jsx`. Minimum viable diffs; run `npm test` after touching them.
- Communication: the user is non-technical. Always write "Survey Marker" in full; explain in plain English. After reading a handoff, recommend the next step rather than asking the user to choose.
