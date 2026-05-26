# Architecture Hotspot Refactor Map

Date: 2026-05-26

Related Linear issues: KAL-76, KAL-77, KAL-78, KAL-79, KAL-80, KAL-81, KAL-82, KAL-84, KAL-85, KAL-86, KAL-87.

## Purpose

This audit maps the highest-risk architecture hotspots and the safest extraction order. It is intended for agents implementing the cleanup issues without needing extra user context.

This document does not change runtime behavior. Use `docs/ARCHITECTURE_CLEANUP_CHECKLIST.md` as the verification checklist for every implementation issue that follows.

## Current Hotspots

| Area | Main files | Size / signal | Risk |
| --- | --- | --- | --- |
| App shell and PDF viewer orchestration | `src/App.jsx` | 48,229 lines, 858 React hook calls | Highest merge-conflict and regression risk. Dashboard, template editing, PDF viewer, toolbar state, bookmark orchestration, annotation state, callouts, sync, Excel export, Spaces/Regions, and debug/perf tooling all live in one file. |
| Page annotation layer | `src/PageAnnotationLayer.jsx` | 10,092 lines | Owns Fabric page canvas lifecycle, survey marker drawing, native annotation conversion, context menus, callout integration, history hooks, and debug paths. Hard to reason about because rendering, interaction, persistence callbacks, and diagnostics are interleaved. |
| SVG annotation layer and interaction | `src/components/SVGAnnotationLayer.jsx`, `src/hooks/useSVGInteraction.js` | 5,249 + 4,426 lines | SVG rendering, selection chrome, group selection, callout hit testing, drag/resize/rotate, and diagnostic counters are split but tightly coupled through a large prop interface. |
| Fabric edit/draw canvases | `src/components/FabricEditCanvas.jsx`, `src/components/FabricDrawingCanvas.jsx`, `src/components/FabricEraserCanvas.jsx` | 3,962 + 958 + 1,162 lines | Editing behavior, mini toolbar UI, Fabric object adapters, CRDT origin handling, and callout edit adapter usage are bundled. |
| PDF import/export | `src/utils/pdfAnnotationImporter.js`, `src/utils/pdfAnnotationsPdfLib.js`, `src/utils/calloutImportAdapter.js` | 3,353 + 1,632 + small adapter | Import normalization and export flattening are separate from the runtime annotation model, so model drift is easy. |
| Annotation sync | `src/hooks/useAnnotationCloudSync.js`, `src/services/annotationCloudSync.js`, `src/services/documentAnnotationService.js`, `src/lib/collab/*` | 3,221 + 824 + 1,024 + many helpers | Local state, Supabase persistence, Yjs/CRDT bridge, dual-write queue, and callout special cases need a clearer ownership map before deeper changes. |
| Bookmark and reorder UX | `src/sidebar/BookmarksPanel.jsx`, `src/playgrounds/ReorderPlayground.jsx`, `reorder-playground.html`, `ball-in-court-reorder-playground.html` | 2,480 + 1,317 + fixtures | Bookmark tree reorder is now a known-good pattern, but other sortable surfaces use separate logic. Playground fixtures must be preserved. |
| Home/template/project surfaces | `src/home/TemplatesEditor.jsx`, `src/home/ProjectsFolderTree.jsx`, dashboard code still inside `src/App.jsx` | 1,838 + 1,029 + large App region | Reorder and editing behavior exists both in extracted home files and in App-owned legacy/dashboard code. |
| Duplicate/overlapping page layers | `src/PageAnnotationLayer.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/PDFPageItem.jsx`, `src/components/PDFPageCanvas.jsx`, `src/components/OptimizedPDFPageCanvas.jsx`, Syncfusion wrapper | Duplicate names and multiple page render paths | `src/components/PageAnnotationLayer.jsx` is a small separate component imported by `PDFPageItem`, while `src/PageAnnotationLayer.jsx` is the main Fabric layer imported by `App.jsx`. The naming is confusing and should be audited before deletion or consolidation. |
| Debug and diagnostic remnants | `src/utils/debugBridge.js`, `src/utils/pdfDebug.js`, debug blocks in App/PAL/SVG/sync | Many `debug`, `diag`, recorder, and console paths | Some are useful support tools; some are obsolete. Needs deletion batches, not drive-by cleanup. |

## Ownership Boundaries To Create

These are the recommended target ownership boundaries. They should be introduced incrementally, without changing behavior.

1. **Survey Hub boundary**
   - Owns dashboard/home tab state, project/template/document listing, selection mode, and template/entity reorder UI.
   - Should not know PDF viewer internals.
   - Existing candidates: `src/home/SurveyHub.jsx`, `src/home/TemplatesEditor.jsx`, `src/home/ProjectsFolderTree.jsx`.

2. **Template model boundary**
   - Owns Template, Module, Category, Checklist Item, and Entity transformations.
   - Extract pure reorder, rename, duplicate, move/copy, and color helpers from `src/App.jsx` before UI extraction.
   - Must use domain names from `CONTEXT.md`: Template, Module, Category, Checklist Item, Entity.

3. **PDF viewer shell boundary**
   - Owns open document lifecycle, page navigation, zoom mode, toolbar composition, sidebar composition, and viewer route state.
   - Should pass annotation/bookmark/sync operations through focused hooks instead of hundreds of props.

4. **Bookmark orchestration boundary**
   - Owns bookmark state normalization, PDF outline import, create/update/delete, page assignment, and reorder persistence.
   - `src/sidebar/BookmarksPanel.jsx` should eventually become mostly presentation plus DnD interaction, with state orchestration in a hook.

5. **Annotation document model boundary**
   - Owns the canonical in-memory annotation model across regular annotations, Text Callouts, Counter Pins, imported annotations, Survey Markers, Region/Space scoped annotations, undo/redo, import/export, and sync.
   - This boundary must be audited before unifying callouts.

6. **Annotation interaction boundary**
   - Owns selection, drag, resize, rotate, marquee, grouping, context menu opening, and hit testing.
   - Should expose one interaction interface to SVG/Fabric renderers rather than separate annotation and callout paths.

7. **Annotation rendering boundary**
   - Owns SVG rendering, Fabric rendering, native PDF annotation rendering policy, lightweight overlays, and Syncfusion overlay handoff.
   - Should make duplicate page/layer rendering explicit so KAL-85 can remove or consolidate safely.

8. **Sync/import/export boundary**
   - Owns conversion between canonical app annotations and persistence formats: Supabase rows, Yjs maps, PDF annotations, printed/exported PDF objects, and imported PDF metadata.
   - Should be documented in KAL-86 before implementation changes.

## Risky Shared State

The following state clusters are risky because they are edited by multiple subsystems in `src/App.jsx` or through callback chains into page layers.

- `annotationsByPage`, `callouts`, `surveyMarkers`, `items`, `annotations`, and `pdfNativeAnnotationLayerPolicyByPage`.
- Selection state split across `selectedToolbarAnnotation`, `selectedCalloutId`, `selectedCalloutIds`, `annotationContextMenu`, `annotationPropertiesPanel`, `pendingSvgSelection`, and layer-local Fabric/SVG state.
- Callout state split from regular annotations, including separate Bold, Italic, Underline, and Strikethrough style flags and separate right-click context menu behavior.
- History state and Yjs undo/redo integration around `addHistoryCheckpoint`, local restore actions, `userUndo`, `userRedo`, and callout-specific restore logic.
- Sync state split across local storage helpers, `useAnnotationCloudSync`, `documentAnnotationService`, CRDT bridge helpers, and dual-write queues.
- Syncfusion interaction state around resident pages, proxy payloads, lightweight pages, commit queues, overlay lag recording, and wheel/zoom handlers.
- Template editing state duplicated between the App dashboard region and extracted home/template modules.
- Reorder logic split between App dashboard/template rows, `BookmarksPanel`, `ProjectsFolderTree`, `TemplatesEditor`, and playground fixtures.

## Recommended Extraction Order

### Phase 0: Keep guardrails visible

Already started by KAL-83 and KAL-87.

- Keep `docs/ARCHITECTURE_CLEANUP_CHECKLIST.md` current.
- Keep `src/playgrounds/README.md` and reorder playground fixtures until equivalent automated tests exist.
- Before code movement, check working tree status because other agents may have uncommitted work.

### Phase 1: Extract dashboard/template/entity reorder code from App

Primary Linear issue: KAL-77.

Why first:

- It is high-conflict because it currently lives in `src/App.jsx`, but lower runtime risk than PDF annotation internals.
- It creates immediate room for user work and Claude/Codex parallel work.
- It prepares KAL-84 without touching the PDF viewer.

Suggested implementation steps:

- Extract App-level Template, Module, Category, Checklist Item, and Entity reorder helpers into a focused helper module under `src/home` or `src/utils`.
- Extract `TemplateModuleSortableRow`, `TemplateCategorySortableRow`, and `EntitySortableRow` from `src/App.jsx`.
- Keep state ownership in App for the first pass unless a hook can be extracted with a small interface.
- Compare behavior with `src/home/TemplatesEditor.jsx` and avoid introducing a second divergent pattern.
- Run the reorder playground plus the production template/entity reorder surfaces.

Do not:

- Change saved template schema.
- Rename domain concepts outside the already-approved terms in `CONTEXT.md`.
- Delete playgrounds or legacy reorder files as part of this phase.

### Phase 2: Extract PDF toolbar UI from App

Primary Linear issue: KAL-78.

Why second:

- Toolbar UI is large and conflict-prone, but state ownership can stay in the PDF viewer shell.
- It gives immediate maintainability without forcing annotation model decisions.

Suggested implementation steps:

- Move presentational top toolbar and bottom toolbar code out of `src/App.jsx`.
- Keep active tool, color, stroke, fill, zoom, eraser, callout style, and selection state owned by the viewer shell for now.
- Pass a toolbar view model and event handlers into extracted components.
- Preserve callout style controls exactly, including Bold, Italic, Underline, and Strikethrough behavior.
- Verify toolbar tool selection, annotation style changes, callout style changes, and zoom controls.

Do not:

- Move annotation persistence or callout model state in this phase.
- Merge callout and annotation property panels yet.

### Phase 3: Extract PDF sidebar/bookmark orchestration

Primary Linear issues: KAL-79 and KAL-84.

Why third:

- Bookmark reorder is the desired UX pattern, and sidebar extraction is likely smaller than annotation model cleanup.
- It gives the app the shared drag-to-rearrange foundation without touching callout persistence.

Suggested implementation steps:

- Create a focused bookmark orchestration hook for bookmark state, PDF outline import, create/update/delete, and reorder commits.
- Keep `src/sidebar/BookmarksPanel.jsx` as the interaction/presentation layer.
- Preserve tree-specific behavior: nesting, un-nesting, collapsed folders, auto-expand, and auto-recollapse.
- Define a shared flat-list reorder utility for Entities, Templates, Projects, Spaces, and Pages only after bookmark behavior is safely isolated.
- Use `src/playgrounds/ReorderPlayground.jsx` as the behavior reference.

Do not:

- Force tree bookmark semantics onto flat reorder surfaces.
- Delete `ball-in-court-reorder-playground.html` until replacement coverage is explicit.

### Phase 4: Audit annotation and callout ownership

Primary Linear issue: KAL-80.

Why before unification:

- Callouts currently behave like a separate annotation family.
- They have separate style flags for Bold, Italic, Underline, and Strikethrough.
- They have different right-click context menu behavior from other annotations.
- They participate in selection, group move, undo/redo, import/export, and sync through special paths.

Suggested implementation steps:

- Produce an ownership matrix for regular annotations, Text Callouts, Counter Pins, imported annotations, Survey Markers, Region/Space annotations, undo/redo, sync, import, export, print, context menus, and style panels.
- Identify every source of truth for callout data and every adapter that converts it.
- List all fields needed for a canonical Text Callout model.
- Define what "same as other annotations" means for selection, context menu, style editing, undo/redo, save/reload, sync, import, export, and rendering.

Do not:

- Start KAL-81 until this audit is complete.
- Collapse callouts into Fabric objects without preserving SVG/rendering/edit behavior.

### Phase 5: Map sync/import/export pipeline

Primary Linear issue: KAL-86.

Why before model migration:

- A model migration can appear correct in the UI while breaking cloud sync, imported PDF fidelity, printed/exported output, or realtime collaboration.

Suggested implementation steps:

- Diagram the pipeline from local app state to Supabase/Yjs, PDF import, PDF export, print flattening, and reload.
- Identify canonical IDs, source IDs, author IDs, page IDs, region/space scope, and imported PDF metadata.
- Include local storage fallback helpers still present in `src/App.jsx`.
- Identify where unsupported native PDF annotation types are preserved, proxied, or dropped.

Do not:

- Remove legacy dual-write or debug paths until their replacement and rollback plan are clear.

### Phase 6: Unify callouts with the main annotation model

Primary Linear issue: KAL-81.

Start only after KAL-80 and KAL-86 have enough detail.

Suggested implementation steps:

- Create a canonical Text Callout representation that can round-trip through runtime rendering, edit mode, sync, import/export, undo/redo, and context menus.
- Move style flags into the same style/property system used by other text-capable annotations, while preserving Bold, Italic, Underline, and Strikethrough.
- Normalize right-click context menu behavior so callouts and other annotations share commands where appropriate, with callout-specific actions behind the same interface.
- Add migration/adapters for old persisted callout data.

Do not:

- Break existing saved documents.
- Change user-visible geometry behavior while doing model migration.

### Phase 7: Audit duplicate PDF rendering layers

Primary Linear issue: KAL-85.

Why after model/pipeline mapping:

- Rendering duplication may be intentional for Syncfusion interaction performance, lightweight overlays, native annotation policy, or import fidelity.

Suggested implementation steps:

- Map all page/layer render paths: Syncfusion viewer, PDF.js canvas, text layer, `src/PageAnnotationLayer.jsx`, `src/components/PageAnnotationLayer.jsx`, `SVGAnnotationLayer`, Fabric canvases, lightweight overlays, search highlights, Space/Region overlay, and print/export paths.
- Mark each layer as production, fallback, debug, legacy, or candidate for removal.
- Rename ambiguous modules before deleting anything. In particular, `src/components/PageAnnotationLayer.jsx` should not share a name with the main `src/PageAnnotationLayer.jsx` long-term.

### Phase 8: Dead code and debug cleanup in batches

Primary Linear issue: KAL-82.

Why late:

- Some debug tools are still useful during the refactors above.
- Some prototype/playground files are intentional fixtures.

Suggested implementation steps:

- Start with unused imports and unreachable code inside extracted modules.
- Then audit debug bridges, overlay lag recorders, diagnostic globals, and prototype HTML files.
- Delete in small batches with build and smoke checks.
- Keep reorder playgrounds unless replacement coverage is documented.

## Concrete Next Agent Starting Points

### KAL-77 first implementation prompt

Extract App-owned dashboard/template/entity reorder UI without behavior changes.

Start by reading:

- `src/App.jsx` around the sortable row definitions near the top-level helper region.
- `src/App.jsx` dashboard/template state and handlers around the Template, Module, Category, Checklist Item, and Entity editing regions.
- `src/home/TemplatesEditor.jsx` for the newer home editor patterns.
- `src/playgrounds/ReorderPlayground.jsx` for intended reorder UX.

Deliver:

- Extracted row components and pure reorder helpers.
- No saved schema changes.
- Build passes.
- Manual reorder checks reported per `docs/ARCHITECTURE_CLEANUP_CHECKLIST.md`.

### KAL-78 first implementation prompt

Extract toolbar presentation from `src/App.jsx` while keeping PDF viewer state in place.

Start by reading:

- `BottomToolbar` in `src/App.jsx`.
- Top toolbar JSX in the PDF viewer return.
- `AnnotationPropertiesPanel`, callout style patch handlers, and active tool state.

Deliver:

- Focused toolbar component files.
- Same props/state behavior.
- Explicit verification of tool selection, callout style flags, annotation style edits, and zoom.

### KAL-79 first implementation prompt

Extract bookmark orchestration from the PDF viewer shell.

Start by reading:

- Bookmark normalization/import helpers in `src/App.jsx`.
- Bookmark handlers in the PDF viewer region.
- `src/sidebar/BookmarksPanel.jsx`.
- `src/playgrounds/ReorderPlayground.jsx`.

Deliver:

- Hook or module for bookmark state operations.
- `BookmarksPanel` remains behaviorally identical.
- Playground and production bookmark reorder verified.

## Open Questions

- Should the app keep both the Syncfusion interaction layer and the PDF.js/Fabric fallback long-term, or is one intended to become the only production path?
- Which debug tools are still actively used by the team versus old investigation leftovers?
- Should reorder playgrounds become Playwright tests, Vitest interaction tests, or stay manual fixtures for now?
- Should `CONTEXT.md` gain architecture glossary terms for "PDF viewer shell", "annotation document model", and "annotation rendering layer", or is issue-level language enough?

## Done Criteria For KAL-76

KAL-76 is complete when:

- Top oversized files are identified.
- Ownership boundaries are named.
- Risky shared state clusters are listed.
- Recommended extraction order is documented.
- Follow-up Linear issues can use this map without asking the user what to do next.
