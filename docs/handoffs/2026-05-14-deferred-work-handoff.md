# Deferred Work Handoff - 2026-05-14

## Current State

The annotation stabilization and cleanup pass is complete and committed on branch `codex/lightweight-overlay-fix`.

Recent commits:

- `681d90a9` - Stabilize annotation lifecycle and collaboration sync
- `c6988699` - Organize annotation audit logs
- `dccc65cd` - Organize project assets
- `fdd4e02a` - Remove local runtime clutter

The git working tree was clean after the cleanup pass. `npm run build` passed. Existing Vite/pdf bundle warnings were not introduced by the cleanup.

## Work Already Completed

- Annotation lifecycle fixes for save/reload/sync behavior.
- Callout save/reload contract fixes.
- Eraser/delete/history/sync contract fixes.
- Initial hydration/source-of-truth fixes between local state, Y.Doc, and Supabase.
- Sync status UI reliability fixes.
- Survey/region visibility and selection clearing fixes.
- Phantom marquee/callout delete investigation and fixes.
- PDF import/export backend improvements, including counters and imported PDF annotation fidelity.
- Supabase shared-document/RLS collaboration fixes.
- Audit logs moved to `docs/audits/annotation-fixes/`.
- Asset/icon layout documented and cleaned.
- Local runtime clutter removed from repo tracking.

## Deferred Work To Tackle Next

1. Print/export correctness
   - Native print preview was unreliable.
   - Need a clear plan for regular app annotations printing/exporting correctly.
   - Survey annotations and region/space annotations should not be printed by the current basic print path unless explicitly supported later.

2. Export/import full lifecycle
   - Anything created in the app should export and reimport with the same meaning.
   - This includes counters, callouts, arrows, lines, shapes, text, pen/highlighter, and imported PDF annotations.
   - Counters are app-specific and need special care so they do not come back as plain circles.

3. Spaces/regions/survey export scope
   - Decide how users export regular annotations, survey annotations, region annotations, and space/region page overlays.
   - This likely needs product/UI design before implementation.

4. Custom print/export UI
   - Intentionally deferred.
   - Needs mockups before coding.
   - Should probably include export choices for flattened PDF, editable PDF annotations, surveys/Excel, spaces, and regions.

5. Imported PDF annotation edge cases
   - Squiggle/polygon/polyline rendering improved, but should still be tested with real PDFs.
   - Do not treat pen strokes as special imported "squiggles" unless the PDF import path proves they are native PDF ink annotations.

6. Final multi-user validation
   - Backend/RLS/collaboration fixes were added.
   - Still needs real two-user or scripted validation before calling the collaboration flow fully done.

## Cleanup/Refactor Work Still Worth Doing

1. Split `src/App.jsx`
   - This is the biggest remaining code organization issue.
   - Do not rush it before product work unless it blocks the next fix.

2. Organize `src/utils/`
   - It has many annotation, PDF, sync, geometry, and debug utilities in one flat folder.
   - Later split into folders such as `annotations/`, `pdf/`, `sync/`, and `geometry/`.

3. Review duplicate-looking components
   - Examples: page layers, text layers, PDF page components.
   - Some duplication may be valid, but it should be reviewed carefully before deleting anything.

4. Bundle-size cleanup
   - Build passes, but Vite warns that chunks are large.
   - This is not urgent, but later code-splitting would help.

## Recommended Next Prompt

Use this in a fresh session:

```text
Please read docs/handoffs/2026-05-14-deferred-work-handoff.md and inspect the current repo state. Then give me the next safest plan for tackling the deferred annotation print/export/import lifecycle work. Do not start coding yet. I want the plan first, in plain English, and I want you to identify what should be fixed before any new UI mockups.
```

