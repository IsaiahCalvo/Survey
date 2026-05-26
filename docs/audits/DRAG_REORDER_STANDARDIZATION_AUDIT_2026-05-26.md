# Drag Reorder Standardization Audit - KAL-84

Date: 2026-05-26
Branch: `codex/reorder-ux-and-app-split`
Author: Agent C
Scope: docs-first audit of non-bookmark drag-to-rearrange surfaces. No runtime reorder behavior changed.

## Executive Summary

Bookmark tree reorder is the current known-good reference. The non-bookmark surfaces split into three families:

1. DnD-kit flat lists that are close to reusable: App-owned template modules, template categories, entities, and `SpacesPanel`.
2. Native HTML5 drag surfaces with local-only or partial persistence semantics: home `TemplatesEditor`, `ProjectsFolderTree`, `PagesPanel`.
3. A custom pointer reorder hook: tab reorder via `useDragToReorder`.

The shared architecture should not start by generalizing the bookmark tree code. Bookmarks need tree projection, parent/depth constraints, auto-expand, drag overlay, and collapsed-child behavior. Most other surfaces are flat lists and should get a flat-list primitive first, with a separate tree primitive reserved for bookmarks and any future page/space tree.

## Search Commands Used

```bash
git status --short --branch
rg -n "dnd-kit|DndContext|Sortable|sortable|arrayMove|useDraggable|useDroppable|draggable|dragStart|dragEnd|onDrag|onPointer|reorder|move.*item|drop" src docs App.jsx --glob '!node_modules'
rg --files src docs | rg "(BookmarksPanel|bookmarkReorderUtils|ReorderPlayground|TemplatesEditor|ProjectsFolderTree|Sidebar|Panel|Space|Page|Document|Template|Project)"
rg -n "@dnd-kit|DndContext|SortableContext|useSortable|useDroppable|arrayMove" src
rg -n "draggable=|onDragStart|onDragOver|onDragEnd|onDrop|handleDrag(Start|Over|End|Drop)|drag-to-reorder|reorder" src/App.jsx src/home src/sidebar src/components src/TabBar.jsx
rg -n "dragTpl|setDragTpl|tplEdit|reorderTemplates|dragOverTpl|setDragOverTpl|dragCat|setDragCat|reorderCat|onDragStart|onDrop" src/home/TemplatesEditor.jsx
rg -n "handleSpaceDrag|spaceSensors|onReorderSpaces|handleReorderSpaces|SpacesPanel" src/App.jsx src/sidebar/SpacesPanel.jsx
rg -n "onReorderPages|handleReorderPages|PagesPanel|PDFPageList|PDFPageTiles|PDFPageItem" src/App.jsx src/sidebar/PagesPanel.jsx src/components
```

The first broad search intentionally included false positives such as unrelated annotation pointer dragging and comments containing "drop". The classification below uses the narrower DnD/reorder searches plus local file inspection.

## Canonical Reference

### Bookmark tree reorder

Files:
- `src/sidebar/BookmarksPanel.jsx`
- `src/sidebar/bookmarkReorderUtils.js`
- `src/playgrounds/ReorderPlayground.jsx`
- `reorder-playground.html`
- `ball-in-court-reorder-playground.html`

Classification: tree reorder, actual persisted bookmark reorder, canonical behavior.

Key reusable ideas:
- DnD-kit sensors with a small pointer activation distance.
- Dedicated drag handle, not whole-row accidental dragging.
- Axis lock for list behavior.
- Real-row movement during drag plus overlay/clone behavior.
- Pure reorder utilities for projection and tree rebuild.
- Playground fixtures that demonstrate flat and tree behavior.

Non-reusable as-is for flat lists:
- Parent/depth projection.
- Folder-only nesting constraints.
- Collapsed folder auto-expand/recollapse.
- Tree rebuild from flattened rows.

Guardrail: do not push bookmark tree semantics into templates, projects, spaces, pages, tabs, or document rows unless those surfaces explicitly become trees.

## Surface Inventory

### App-owned template modules

Files:
- `src/App.jsx:4924`
- `src/App.jsx:7529`
- `src/home/TemplateReorderRows.jsx:36`
- `src/home/templateReorderUtils.js:13`

Classification: flat reorder, DnD-kit, actual local state reorder.

Behavior:
- Uses `DndContext`, `SortableContext`, `verticalListSortingStrategy`, `closestCenter`, and axis lock.
- Drag is disabled unless module edit mode is active.
- Commits with `reorderItemsByActiveOver`.

Gap from bookmark/playground quality:
- No shared drag overlay.
- No common active-drag styling contract.
- No shared tests around invalid active/over ids, disabled drag, or stable selection after reorder.

### App-owned template categories

Files:
- `src/App.jsx:5181`
- `src/App.jsx:7732`
- `src/home/TemplateReorderRows.jsx:129`
- `src/home/templateReorderUtils.js:24`

Classification: flat reorder within selected parent module, DnD-kit, actual local state reorder.

Behavior:
- Same DnD-kit pattern as modules.
- Commits by mapping the selected module and moving only its category slice.

Gap:
- This is a good candidate for a scoped flat-list helper because it needs parent-scoped reorder, not tree projection.

### App-owned entities

Files:
- `src/App.jsx:2880`
- `src/App.jsx:7956`
- `src/home/TemplateReorderRows.jsx:219`
- `src/home/templateReorderUtils.js:13`

Classification: flat reorder, DnD-kit, actual local state reorder.

Behavior:
- Always sortable when rendered.
- Adds body class while dragging to suppress delete affordances.
- Commits with `reorderItemsByActiveOver`.

Gap:
- Uses the same move primitive as modules but owns extra drag-state side effects locally.
- Should migrate after modules/categories so the shared component supports per-surface active-drag hooks.

### Home `TemplatesEditor` template rows

File:
- `src/home/TemplatesEditor.jsx:1039`

Classification: visual-only drag affordance / incomplete reorder.

Behavior:
- Template rows are marked `draggable={tplEdit}` and the handle title says "Drag to reorder".
- No matching `onDragStart`, `onDragOver`, `onDrop`, `dragTpl`, or `reorderTemplates` logic exists in this file.

Gap:
- The UI advertises reorder but does not implement it.
- This should not be migrated mechanically until product decides whether template list order should be persisted, local-only, or removed as an affordance.

### Home `TemplatesEditor` module tabs

Files:
- `src/home/TemplatesEditor.jsx:687`
- `src/home/TemplatesEditor.jsx:1148`

Classification: flat reorder, native HTML5 drag, actual local working-state reorder.

Behavior:
- Reorders module tabs with `dragMod`, `dragOverMod`, `draggable`, and `onDrop`.
- Adjusts `openMod` after moving.
- Mutates the local rich template state via `mutateTpl`.

Gap:
- Native HTML5 drag differs from DnD-kit surfaces and bookmark behavior.
- No drag overlay, no sensor abstraction, no common invalid-drop handling.
- Horizontal tab layout means it should use a flat axis-aware primitive, not the vertical list default.

### Home `TemplatesEditor` category rows

File:
- `src/home/TemplatesEditor.jsx:1273`

Classification: visual-only drag affordance / not implemented.

Behavior:
- Category rows show a "Drag to reorder" handle.
- Search found no category drag state or category drop handler in `TemplatesEditor.jsx`.

Gap:
- This is a UX mismatch. Either implement real flat reorder later or remove/disable the affordance.

### Projects list

Files:
- `src/home/ProjectsFolderTree.jsx:217`
- `src/home/ProjectsFolderTree.jsx:376`
- `src/home/ProjectsFolderTree.jsx:592`

Classification: flat reorder, native HTML5 drag, local-only reorder.

Behavior:
- Only draggable in project edit/select mode.
- Reorders by filtered-row indices but maps back to actual project ids before mutating `localProjects`.
- Pinned projects sort to the top separately from the underlying local order.

Gap:
- Native drag gives only target-highlight movement, not the real-row DnD-kit behavior.
- Pinned sorting is a surface-specific ordering layer. A shared helper must let this surface define a visible-id list and commit back to a source list by id.
- No persistence hook is obvious in this component; reorder appears local-only.

### Project document/file rows

Files:
- `src/home/ProjectsFolderTree.jsx:460`
- `src/home/ProjectsFolderTree.jsx:812`

Classification: flat reorder within one project, native HTML5 drag, local-only reorder.

Behavior:
- Only draggable in file select mode.
- Reorders the open project's slice and stitches it back with other documents.

Gap:
- Needs a scoped flat-list reorder helper with an explicit `scopeId` or `filterByParent` adapter.
- Should not share tree semantics with bookmarks.

### Spaces panel

Files:
- `src/sidebar/SpacesPanel.jsx:1058`
- `src/sidebar/SpacesPanel.jsx:1231`
- `src/sidebar/SpacesPanel.jsx:1360`
- `src/App.jsx:20862`

Classification: flat reorder, DnD-kit, actual app state reorder.

Behavior:
- Uses DnD-kit with `PointerSensor`, `closestCenter`, vertical strategy, and axis lock.
- Commits `fromIndex`/`toIndex` to `onReorderSpaces`.
- App updates `spaces` with `arrayMove`.

Gap:
- Very close to App-owned template/module/category flat DnD behavior but repeats sensor and handler setup.
- Should be an early migration candidate after pure helper tests.

### Pages thumbnail panel

Files:
- `src/sidebar/PagesPanel.jsx:663`
- `src/sidebar/PagesPanel.jsx:771`
- `src/App.jsx:19940`

Classification: native HTML5 drag, page-thumbnail reorder intent, partial/non-real PDF reorder.

Behavior:
- Uses dataTransfer keys for both internal page reorder and external page-to-tab drag.
- Internal drop calls `onReorderPages(sourcePageNumber, targetPageNumber)`.
- App handler only swaps page names and selected page context; the comment says actual PDF reordering would require PDF manipulation.

Gap:
- This should not be treated as persisted reorder until the PDF manipulation path exists.
- The external page-to-tab drag must be preserved if this surface later moves to DnD-kit or a shared hook.

### Tab bar

Files:
- `src/TabBar.jsx:23`
- `src/TabBar.jsx:162`
- `src/utils/useDragToReorder.js`

Classification: flat reorder, custom pointer hook, actual tab state reorder.

Behavior:
- Home tab is excluded from reorder.
- Custom hook creates a DOM ghost, locks movement to Y despite a horizontal tab layout, calculates midpoint collisions, then calls `onTabReorder`.
- Same tab row also accepts page drops from `PagesPanel`.

Gap:
- This predates the DnD-kit standard and is specialized.
- Because tab layout is horizontal, a future architecture should not blindly reuse vertical row assumptions.
- Page drop behavior must remain independent from tab reorder behavior.

### Annotation/object dragging and z-order reorder

Files include:
- `src/hooks/useSVGInteraction.js`
- `src/components/FabricEditCanvas.jsx`
- `src/components/SVGAnnotationLayer.jsx`
- `src/App.jsx:30737`

Classification: not relevant to KAL-84 list reorder, except z-order commands are reorder-like domain actions.

Behavior:
- Pointer dragging moves annotations, selection handles, counters, and objects.
- Z-order changes reorder annotation stacking but are command/menu behavior, not drag-to-rearrange list UX.

Guardrail: exclude annotation pointer dragging from shared list reorder work.

## Shared Architecture Proposal

### 1. Pure flat-list reorder utilities

Create `src/reorder/flatReorderUtils.js`.

Exports:
- `moveItem(items, fromIndex, toIndex)`
- `moveItemById(items, activeId, overId, getId = item => item.id)`
- `moveVisibleItemById(sourceItems, visibleIds, activeId, overId, getId)`
- `moveScopedItem(sourceItems, scopePredicate, activeId, overId, getId)`
- `getActiveOverIndices(items, activeId, overId, getId)`

Initial tests:
- `tests/reorder/flatReorderUtils.test.mjs`
- invalid indices return original array reference or documented no-op
- active/over not found no-op
- visible subset reorder maps back to source list without disturbing hidden rows
- scoped reorder moves only matching parent/project rows

This can absorb the logic currently in `src/home/templateReorderUtils.js` without forcing any runtime migration in the first step.

### 2. DnD-kit flat sortable adapter

Create `src/reorder/SortableFlatList.jsx` or `src/reorder/useSortableFlatList.js`.

Responsibilities:
- Standard `PointerSensor` activation distance.
- Axis option: `vertical`, `horizontal`, or `both`.
- Collision strategy defaulting to `closestCenter`.
- Optional modifiers per axis.
- `onReorder({ activeId, overId, fromIndex, toIndex })`.
- Optional `onDragStart`, `onDragCancel`, `onDragEnd` callbacks for surface side effects.

Keep row rendering surface-owned:
- The shared adapter should not own card styling, selection UI, inline rename fields, color pickers, page thumbnails, or tab chrome.
- It should provide sortable props/listeners and active state.

### 3. Tree reorder stays separate

Create `src/reorder/treeReorderUtils.js` only when bookmark code is intentionally extracted from `src/sidebar/bookmarkReorderUtils.js`.

Responsibilities:
- Flatten/build tree.
- Projection.
- Valid parent/depth constraints.
- Auto-expand target detection.
- Tree-specific overlay metadata.

Do not import this from flat surfaces.

### 4. Shared visual tokens, not shared row components

Create `src/reorder/reorderVisuals.js` or colocated constants:
- activation distances
- axis-lock modifiers
- drag opacity/z-index defaults
- handle aria-label/title helpers

Avoid a universal row component. The row layouts are too different: entity color picker rows, space cards, page thumbnails, module tabs, projects, and tabs each have distinct controls.

## Migration Order

1. Add pure `flatReorderUtils` and tests. No UI behavior changes.
2. Point `src/home/templateReorderUtils.js` at the new pure utilities or replace it after tests cover compatibility.
3. Migrate App-owned module/category/entity DnD handlers to the shared flat utility. This is lowest-risk because they already use DnD-kit and `reorderItemsByActiveOver`.
4. Migrate `SpacesPanel` to the same DnD-kit flat adapter. It already has matching DnD-kit behavior and commits `fromIndex`/`toIndex`.
5. Decide product semantics for `TemplatesEditor` template rows and category rows. Implement actual reorder or remove the misleading handles.
6. Migrate `ProjectsFolderTree` projects and files with visible/scoped reorder helpers. Preserve pinned-project ordering behavior.
7. Treat `PagesPanel` separately because it combines internal thumbnail reorder with external page-to-tab drag and currently only swaps names.
8. Treat `TabBar` separately because it is horizontal and shares the row with page-drop targets.
9. Extract bookmark tree reorder utilities last, only after flat-list primitives are stable and the playgrounds remain intact.

## Test Plan

Unit tests:
- `flatReorderUtils` edge cases.
- scoped project document reorder.
- visible subset project reorder with pinned/filtering.
- compatibility tests mirroring current `templateReorderUtils`.

Component/interaction tests:
- App module reorder in edit mode only.
- App category reorder within selected module only.
- Entity reorder with delete controls suppressed while dragging.
- Spaces reorder commits by id and preserves expanded/active state.
- Projects reorder under search filter and with pinned projects.
- Files reorder only within the open project.
- Pages thumbnail drag keeps page-to-tab dataTransfer behavior intact.
- Tab reorder excludes home tab and preserves page drop targets.

Manual/playground verification:
- Keep `src/playgrounds/ReorderPlayground.jsx`.
- Keep `reorder-playground.html`.
- Keep `ball-in-court-reorder-playground.html` until equivalent automated coverage exists.
- Add any new flat-list fixtures beside the existing playground rather than replacing it.

## Guardrails

- Preserve all reorder playgrounds.
- Do not edit `App.jsx`, `BookmarksPanel.jsx`, `bookmarkReorderUtils.js`, or playground files during this docs-first phase.
- Do not force tree semantics onto flat lists.
- Avoid broad `App.jsx` runtime changes while other agents are active; migrate via new modules and narrow adapters first.
- Keep row rendering surface-owned; share mechanics, not visual structure.
- Do not convert `PagesPanel` without preserving external page-to-tab dragging.
- Do not convert `ProjectsFolderTree` without preserving pinned-project ordering and filtered-list reorder semantics.
- Do not claim page reorder is persisted PDF reorder until the PDF bytes are actually rewritten.

## Recommended First Implementation Slice

Small, isolated, low-conflict slice for a future agent:

1. Add `src/reorder/flatReorderUtils.js`.
2. Add `tests/reorder/flatReorderUtils.test.mjs`.
3. Keep `src/home/templateReorderUtils.js` behavior unchanged or re-export through the new helper with compatibility tests.
4. Do not touch `App.jsx` in that slice unless coordination confirms it is free.

This gives KAL-84 a safe foundation without disturbing bookmark reorder or other active work.
