# Architecture Cleanup Checklist

This checklist is the baseline for refactors, dead-code cleanup, and shared UX rewrites. It exists so future agents can move quickly without losing known-good behavior.

Related Linear issues: KAL-83, KAL-87.

## Required Report Format

Every cleanup or refactor PR should report each relevant check as one of:

- Checked: include what was exercised.
- Skipped: include the reason and residual risk.
- Failed: include the failing behavior and where the follow-up is tracked.

Do not mark work complete with silent skipped checks.

## Always Check

- `npm run build` or the current documented build command.
- App loads at the local dev URL.
- No unrelated user or agent work was reverted.
- Any touched route or tab still renders.
- Any moved code keeps behavior unchanged unless the issue explicitly asks for behavior changes.

## PDF Viewer Checks

Use these when touching viewer orchestration, toolbar code, sidebars, bookmarks, page rendering, annotation layers, Fabric canvases, import/export, sync hooks, or shared viewer state.

- Open a PDF in the viewer.
- Switch sidebar modes that the touched code affects.
- Use the top and bottom toolbar controls affected by the change.
- Save and reload if persistence state was touched.
- Confirm no duplicate visible page, text, annotation, or canvas layers were introduced.

## Annotation And Callout Checks

Use these when touching annotations, callouts, imported annotations, region or space marks, undo/redo, style controls, context menus, sync, import, export, print, or flattening.

- Create, select, edit, move, and delete a regular annotation.
- Create, select, edit, move, and delete a callout.
- Verify undo and redo for both regular annotations and callouts.
- Verify right-click context menu behavior for both regular annotations and callouts.
- Verify text styling flags for callouts, including Bold, Italic, Underline, and Strikethrough.
- Save, reload, and confirm both annotation types persist correctly.
- If import/export was touched, verify PDF import and PDF export/print flattening.
- If sync was touched, verify cloud/realtime sync or document why it could not be checked locally.

## Drag-To-Rearrange Checks

Use these when touching bookmarks, templates, projects, spaces, pages, Ball in Court entities, or shared sortable list behavior.

- Test the target production surface, not only a helper function.
- Test the matching playground fixture listed below.
- Verify drag preview, row movement, drop position, and final saved order.
- For tree reorder surfaces, verify nesting, un-nesting, min/max depth, collapsed folders, auto-expand, and auto-recollapse.
- For flat reorder surfaces, verify no accidental grouping, nesting, or indentation state is introduced.
- Verify reorder behavior remains usable without debug panels or event logging enabled.

## Reorder Playground Fixtures

These files are intentional regression fixtures. They are not dead code.

- `src/playgrounds/ReorderPlayground.jsx`: canonical React fixture for the current reorder behavior. It covers Ball in Court flat reorder behavior and PDF bookmark tree reorder behavior, including projection, nesting, collapse/expand, auto-expand/recollapse, drag overlays, and real-row movement.
- `reorder-playground.html`: route/entry wrapper used to open the React reorder playground directly.
- `ball-in-court-reorder-playground.html`: legacy standalone fixture for the earlier flat-list reorder prototype. Keep it until the React fixture or automated tests fully replace its coverage.

Do not delete or move these playgrounds during cleanup unless the replacement regression coverage is documented and the cleanup issue explicitly calls out the deletion.

## Dead-Code Cleanup Rule

Before deleting any component, hook, utility, playground, prototype, or debug path:

- Prove it is unused by imports, routes, build config, dev-only entry points, docs, and known manual QA workflows.
- Check whether it is referenced by an active Linear issue as a fixture or migration aid.
- Prefer deletion batches that are small enough to review and revert independently.
- Keep playgrounds that document fragile UX until equivalent automated tests exist.

## Minimum Acceptance Checklist

For every refactor issue, include the relevant subset of this list in the final report:

- Build.
- App load.
- Viewer smoke test.
- Annotation create/edit/delete.
- Callout create/edit/delete.
- Callout context menu.
- Callout Bold, Italic, Underline, Strikethrough flags.
- Save/reload.
- Import/export.
- Reorder playground.
- Production reorder surface.
- Skipped checks with reasons.
