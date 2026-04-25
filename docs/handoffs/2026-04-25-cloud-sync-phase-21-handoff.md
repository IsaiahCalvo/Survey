# HANDOFF — Phase 21 Cloud Sync (mid-phase, code complete, awaiting cloud push + manual verification)

_Created 2026-04-25, end of substantive code session. Resume from this file._

## What this milestone does (one paragraph)

A new phase was inserted in front of v3.0 Phase B (the bake-on-export pipeline). It gets every annotation type — pen strokes, rectangles, circles, lines, arrows, polygons, polylines, free-text boxes, stamps, sticky notes, callouts (with knee handles), and counter chains — backed up to the Supabase `document_annotations` table. Today's edit pipeline (Fabric.js editing, SVG render, zoom signal contract, container-aware sizing, single-name fonts, undo/redo) is byte-identical. Highlights keep their existing sync path unchanged. Once this phase closes, every annotation a user draws is portable across devices and supports concurrent multi-user editing.

## What is NOT changing

The project-wide CLAUDE.md "Always Protected" files stay protected: PageAnnotationLayer.jsx, SVGAnnotationLayer.jsx, the Fabric canvas trio (FabricDrawingCanvas / FabricEditCanvas / FabricEraserCanvas) are untouched. Only one new hook call was added to App.jsx, immediately after the existing highlight sync useEffect. supabaseClient.js got a 4-line defensive guard so Node's --test runner can import it without crashing on `import.meta.env`.

## Status at handoff

**Code complete.** 8 commits on `main`:

1. `docs(cloud-sync): scope Phase 21 — cloud sync for all annotation types` — CONTEXT.md and PLAN.md
2. `feat(db): extend document_annotations for all annotation types` — forward + rollback migration SQL
3. `feat(sync): per-type serializers for annotation cloud sync` — pure functions + 33 round-trip tests
4. `feat(sync): all-types annotation cloud sync service` — service layer + 3 contract tests
5. `feat(sync): offline queue and one-time local-to-cloud migration` — queue/migration helpers + 3 tests, supabaseClient guard
6. `feat(sync): wire cloud sync for all annotation types into App` — useAnnotationCloudSync hook + App.jsx integration
7. `test(sync): conflict resolution coverage for all-type cloud sync` — 7 merge helper tests

**Test results:** 286 pass, 3 fail (the same 3 pre-existing pdfAnnotationImporter failures that predate Phase 20). All new code clean.

**Build:** `npx vite build --mode development` ✓

**Working tree:** clean.

## Three things still needed before the phase reconciles

### 1. Apply the database migration to your live Supabase project

The forward migration is committed at `supabase/migrations/20260425121704_extend_document_annotations_for_all_types.sql`. The rollback sits next to it. Both are atomic and additive; the forward migration is safe — every existing row keeps `annotation_type='highlight'` which remains valid.

To apply:

```bash
# From the project root, with Docker NOT required (push targets remote):
supabase db push
```

If your local repo isn't linked to the remote project yet, run `supabase link --project-ref <YOUR_PROJECT_REF>` first (the project ref is in the URL at `dashboard.supabase.com`).

Alternatively, paste the contents of the forward migration SQL into the Supabase Dashboard's SQL editor and run it there.

### 2. Manual multi-device verification (Task 21.8 in the phase plan)

The end-to-end acceptance test is described in `.planning/phases/21-cloud-sync-all-annotations/PLAN.md` Task 21.8. Summary:

- On Device A, open the largest test PDF (Package 2 - Rev 4 -- IC.pdf) and draw one of every annotation type.
- Sign in on Device B, open the same document. Confirm every mark appears within 1 second.
- With both devices open, draw new marks and edit existing ones. Confirm realtime propagation.
- Unplug Device A's network. Draw a mark. Reconnect. Confirm it syncs to Device B within 5 seconds.
- Document results in `.planning/phases/21-cloud-sync-all-annotations/VERIFICATION.md`.

### 3. Reconciliation

Once the migration is applied and manual verification passes, write `21-RECONCILIATION.md` per the project template (see Phase 20's reconciliation as a reference). Update `.planning/ROADMAP.md` to slot Phase 21 in front of v3.0 Phase B. Update `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md` to note Phase 21 has landed as the cloud-sync prerequisite.

After reconciliation, you can resume v3.0 Phase B (per-type adapters for the bake-on-export pipeline) — the prerequisite that all annotations are reachable from the cloud is now satisfied.

## Architecture (for the next agent who picks this up)

The chosen approach is the "shared-pocket" architecture:

- The existing `document_annotations` table now has a new `annotation_data JSONB` column that holds tool-specific geometry and style. The existing `bounds` column stays (rectangle for fast indexing).
- The `annotation_type` CHECK was relaxed to: `highlight, ink, freetext, square, circle, line, polyline, polygon, stamp, sticky_note, callout, counter, eraser`.
- Highlights keep their existing dedicated columns (color, opacity, name, notes, etc.) and their existing sync path in `documentAnnotationService.js`.
- All other types route through the new `annotationCloudSync.js` service. They share the same table and the same realtime channel; the type column is the source of truth for which module owns which row.
- `useAnnotationCloudSync` is a single React hook that does hydrate-on-open, debounced-push-on-edit, realtime subscription, and offline queue replay. App.jsx mounts it once.

## Three things that could surprise the next agent

1. **The hook runs `useAnnotationCloudSync` even when `documentSyncEnabled` is false** — the `enabled` prop gates inside the hook, but the hook itself is always called per the React Rules of Hooks. The internal early-returns make it a no-op.
2. **The annotpdf API surface deviation from Phase 20** — annotpdf 1.0.15 ships a class-based API (`AnnotationFactory`, `AnnotationIcon`, etc.) not the standalone helpers Phase 20's plan speculated. Phase B fixture-extraction tasks must reference the real method names. This is unrelated to Phase 21 but stays as a carry-forward note for v3.0 Phase B.
3. **Migration runs on every document open until it succeeds** — if the user opens a document, the local→cloud migration runs in the hook's hydration step. If it succeeds, a localStorage flag `cloudSyncMigrated_<userId>_<documentId>` is set and subsequent opens skip the migration. If it errors (offline, RLS, etc.), the flag is NOT set and the next open will retry. This is intentional and idempotent.

## Files created or modified

Created:
- `.planning/phases/21-cloud-sync-all-annotations/CONTEXT.md`
- `.planning/phases/21-cloud-sync-all-annotations/PLAN.md`
- `supabase/migrations/20260425121704_extend_document_annotations_for_all_types.sql`
- `supabase/migrations/20260425121704_extend_document_annotations_for_all_types_rollback.sql`
- `src/services/annotationTypeSerializers.js`
- `src/services/annotationCloudSync.js`
- `src/services/cloudSyncQueue.js`
- `src/services/cloudSyncMigration.js`
- `src/hooks/useAnnotationCloudSync.js`
- `tests/cloudSyncAllTypes/serializers.test.mjs` (33 tests)
- `tests/cloudSyncAllTypes/serviceContract.test.mjs` (3 tests)
- `tests/cloudSyncAllTypes/migration.test.mjs` (3 tests)
- `tests/cloudSyncAllTypes/conflictResolution.test.mjs` (7 tests)

Modified (surgical):
- `src/App.jsx` — one import line + one hook call (~20 lines including comments)
- `src/supabaseClient.js` — 4-line defensive guard for `import.meta.env`

## Post-phase next steps

After Phase 21 closes:

1. Resume v3.0 Phase B (bake-on-export per-type adapters) per `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md`.
2. Phase B.0 fixture extraction draws sample annotations from the cloud database — now that all types are in the cloud, the fixtures will cover every annotation kind, not just highlights.
3. The bake pipeline (Phase D) reads from the cloud and produces the PDF blob — exactly the architecture the v3.0 milestone plan was built around.

## End-of-Phase-21 acceptance recap

Once the migration is applied and manual verification passes:

- Every annotation type backs up to Supabase, syncs across devices, and supports multi-user editing.
- Today's edit pipeline is byte-identical to before this phase.
- The bake-on-export work in v3.0 Phases B–G can resume against a fully cloud-backed annotation set.
- Phase reconciliation is signed off and `21-RECONCILIATION.md` exists.
