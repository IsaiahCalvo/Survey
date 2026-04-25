# Phase 21 — Cloud Sync for All Annotation Types — Executable Plan

**Companion to:** `CONTEXT.md` (read first)
**TDD pattern:** Each task = failing test → minimal implementation → passing test → commit. Each commit is atomic.

---

## Test runner reminders

- Full suite: `npm test`
- Single file: `node --test tests/cloudSyncAllTypes/<file>.test.mjs`
- Single test by name: `node --test --test-name-pattern="<pattern>" <file>`
- All new test files live under `tests/cloudSyncAllTypes/`. The recursive glob added in Phase 20 picks them up automatically.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `supabase/migrations/20260425XXXXXX_extend_document_annotations_for_all_types.sql` | Add `annotation_data JSONB` column; relax `annotation_type` CHECK to accept every supported tool kind. Forward + rollback. | Create |
| `src/services/documentAnnotationService.js` | Generalize the per-row sync API to serialize/deserialize any annotation type via the new JSON column. Existing highlight callers continue to work. | Modify |
| `src/services/annotationTypeSerializers.js` | One serializer/deserializer pair per annotation type. Pure functions. App-shape ⇄ DB-row. | Create |
| `src/services/cloudSyncMigration.js` | One-time push of stranded local marks to the cloud per document. Idempotent. | Create |
| `src/App.jsx` | Replace `saveAnnotationsByPage` localStorage-only path with cloud-aware persistence; replace `saveCallouts` localStorage-only path; extend document-open hydration to fetch every type from Supabase. | Modify (surgical) |
| `tests/cloudSyncAllTypes/serializers.test.mjs` | Round-trip tests for every annotation-type serializer (app-shape → DB → app-shape, byte-identical). | Create |
| `tests/cloudSyncAllTypes/serviceContract.test.mjs` | Contract tests for the generalized service: upsert, load, subscribe handle every type. | Create |
| `tests/cloudSyncAllTypes/migration.test.mjs` | Tests for the one-time local-to-cloud migration: idempotent, handles partial sync, preserves IDs. | Create |
| `tests/cloudSyncAllTypes/conflictResolution.test.mjs` | Last-write-wins simulation: simultaneous edits to the same mark resolve cleanly; simultaneous edits to different marks both persist. | Create |

---

## Task Breakdown

### Task 21.1 — Schema migration (additive, backwards-compatible)

**Goal:** Add `annotation_data JSONB` column and relax the `annotation_type` CHECK so the table can hold any tool kind. All existing highlight rows remain valid.

- [ ] **Step 1**: Write the migration file with forward + rollback sections.

```sql
-- Forward
ALTER TABLE document_annotations
  ADD COLUMN IF NOT EXISTS annotation_data JSONB DEFAULT '{}'::jsonb;

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'highlight', 'ink', 'freetext', 'square', 'circle',
    'line', 'polyline', 'polygon', 'stamp', 'sticky_note',
    'callout', 'counter', 'eraser'
  ));

CREATE INDEX IF NOT EXISTS idx_document_annotations_data
  ON document_annotations USING GIN (annotation_data);
```

```sql
-- Rollback (in a separate file or commented block)
DROP INDEX IF EXISTS idx_document_annotations_data;
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;
ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN ('highlight', 'callout', 'text', 'shape', 'stamp'));
ALTER TABLE document_annotations DROP COLUMN IF EXISTS annotation_data;
```

- [ ] **Step 2**: Apply locally via `supabase db reset` (dev) and verify existing highlight rows still load.
- [ ] **Step 3**: Commit migration SQL.

```bash
git add supabase/migrations/20260425*_extend_document_annotations_for_all_types.sql
git commit -m "feat(db): extend document_annotations for all annotation types"
```

---

### Task 21.2 — Per-type serializer/deserializer pairs

**Goal:** Pure functions converting each in-app annotation shape to/from the DB row format. No I/O. Round-trips lossless.

- [ ] **Step 1**: Write failing round-trip tests for every supported type. One test per type (highlight, ink, freetext, square, circle, line, polyline, polygon, stamp, sticky_note, callout, counter, eraser). Each test starts with a representative in-app shape, serializes to DB row, deserializes back, asserts byte-identical to the input.
- [ ] **Step 2**: Run the tests — they must FAIL (module not found).
- [ ] **Step 3**: Implement `src/services/annotationTypeSerializers.js`. One `to`/`from` pair per type, plus a registry that dispatches by `annotation_type`. Reuse coordinate-space helpers from Phase 20 (`src/utils/pdfNativeExport/coordinateSpace.js`) for any rect-bound types.
- [ ] **Step 4**: Re-run tests — all must PASS.
- [ ] **Step 5**: Commit.

```bash
git add src/services/annotationTypeSerializers.js tests/cloudSyncAllTypes/serializers.test.mjs
git commit -m "feat(sync): add per-type serializers for annotation cloud sync"
```

---

### Task 21.3 — Generalize documentAnnotationService

**Goal:** The service's existing `upsertAnnotations`, `loadAnnotationsFromSupabase`, and `subscribeToDocumentAnnotations` become type-agnostic. Highlights still work identically.

- [ ] **Step 1**: Write contract tests covering all types via the public service API. Tests use the serializers from 21.2 and a mocked Supabase client.
- [ ] **Step 2**: Run tests — they must FAIL where the service ignores non-highlight types.
- [ ] **Step 3**: Modify `documentAnnotationService.js`:
  - `upsertAnnotation(annotation)` accepts any `annotation_type`; dispatches through the serializer registry.
  - `loadAnnotationsFromSupabase(documentId)` returns `{ byType: { highlight: {...}, ink: {...}, ... }, error }` instead of just highlights. Keep the old `loadAnnotationsFromSupabase` signature alive as a thin wrapper for legacy call sites that only want highlights, marked deprecated.
  - `subscribeToDocumentAnnotations(documentId, callbacks)` invokes type-specific callbacks (`onHighlightInsert`, `onInkInsert`, etc., plus a generic `onAnyInsert` that all-type callers can use).
- [ ] **Step 4**: Re-run tests — all PASS.
- [ ] **Step 5**: Commit.

```bash
git add src/services/documentAnnotationService.js tests/cloudSyncAllTypes/serviceContract.test.mjs
git commit -m "feat(sync): generalize annotation service to handle every type"
```

---

### Task 21.4 — Wire App.jsx save path through the service for all types

**Goal:** Replace `saveAnnotationsByPage` localStorage-only path with cloud-aware persistence. Replace `saveCallouts` localStorage-only path. Both keep localStorage as offline fallback.

- [ ] **Step 1**: Identify every save call site for `saveAnnotationsByPage` and `saveCallouts`. There are ~5 call sites for `saveAnnotationsByPage` and similar for callouts.
- [ ] **Step 2**: Replace each with a call into a new helper `persistAnnotationsByPage(pdfId, annotationsByPage)` and `persistCallouts(pdfId, callouts)` that:
  - Writes to localStorage (offline cache).
  - Diffs against last-known-cloud state.
  - Pushes only changed marks to Supabase via the generalized service.
  - Handles Supabase unreachable by queuing for retry on reconnect.
- [ ] **Step 3**: Manual smoke test: draw every annotation type, verify it persists to localStorage + Supabase. (User-driven; cannot run live app from agent.)
- [ ] **Step 4**: Commit.

```bash
git add src/App.jsx src/services/cloudSyncQueue.js
git commit -m "feat(sync): wire all annotation types through cloud sync service"
```

---

### Task 21.5 — Wire App.jsx hydration path to load all types from cloud

**Goal:** On document open, fetch every annotation type from Supabase and merge with localStorage. Today only highlights are fetched.

- [ ] **Step 1**: Modify the document-open `useEffect` to call `loadAnnotationsFromSupabase` (the generalized version returning `byType`) and merge each type into the appropriate state slice (`setHighlightAnnotations`, `setAnnotationsByPage`, `setCallouts`).
- [ ] **Step 2**: Modify the realtime subscription effect similarly — extend the existing `subscribeToDocumentAnnotations` callback handlers to route incoming events to the right state slice.
- [ ] **Step 3**: Manual smoke test: sign in on Device B with the test account and verify every mark drawn on Device A in Task 21.4 appears.
- [ ] **Step 4**: Commit.

```bash
git add src/App.jsx
git commit -m "feat(sync): hydrate every annotation type from cloud on document open"
```

---

### Task 21.6 — One-time local-to-cloud migration

**Goal:** First time a user opens a document after this phase ships, scan localStorage for stranded marks not yet in the cloud and push them up. Idempotent.

- [ ] **Step 1**: Write tests for the migration helper:
  - All-local case: 50 marks in localStorage, none in cloud. After run, 50 in cloud.
  - Partial case: 25 in localStorage, 25 already in cloud. After run, 50 in cloud, no duplicates.
  - All-cloud case: 0 in localStorage, 50 in cloud. After run, 50 in cloud, no-op.
  - Run twice in a row: second run is a no-op.
- [ ] **Step 2**: Run tests — FAIL (module missing).
- [ ] **Step 3**: Implement `src/services/cloudSyncMigration.js`:
  - `migrateLocalAnnotationsToCloud(pdfId, userId)` — reads localStorage, fetches cloud state, computes diff, pushes the delta. Marks per-user/per-document migration complete via a localStorage flag `cloudSyncMigrated_${userId}_${pdfId}`.
- [ ] **Step 4**: Run tests — PASS.
- [ ] **Step 5**: Wire it into the document-open path in `App.jsx`. Surface a brief "syncing your annotations" indicator while it runs.
- [ ] **Step 6**: Commit.

```bash
git add src/services/cloudSyncMigration.js tests/cloudSyncAllTypes/migration.test.mjs src/App.jsx
git commit -m "feat(sync): one-time local-to-cloud migration for stranded annotations"
```

---

### Task 21.7 — Conflict resolution simulation tests

**Goal:** Verify that simultaneous edits to the same mark resolve via last-write-wins, and that simultaneous edits to different marks both persist.

- [ ] **Step 1**: Write simulation tests:
  - User A and User B both push an update to mark X with different `version` values. Higher `version` wins.
  - User A pushes mark X update; User B pushes mark Y update (different marks, same page, same time). Both persist.
  - User A pushes mark X update; User B subscribes and receives it via the realtime channel.
- [ ] **Step 2**: Implementation should already work because the `version`-based path already exists for highlights — these tests verify it generalizes correctly.
- [ ] **Step 3**: If any test fails, fix the service. Likely already passes since the existing highlight path uses the same fields.
- [ ] **Step 4**: Commit.

```bash
git add tests/cloudSyncAllTypes/conflictResolution.test.mjs
git commit -m "test(sync): conflict resolution coverage for all-type sync"
```

---

### Task 21.8 — End-to-end multi-device verification

**Goal:** Real-world acceptance check. User-driven; cannot run from agent.

- [ ] **Step 1**: Open the largest test PDF on Device A. Draw every annotation type (one of each: highlight, pen, rectangle, circle, line, arrow, polygon, polyline, free text, stamp, sticky note, callout, counter chain).
- [ ] **Step 2**: Sign in on Device B. Open the same document. Confirm every mark appears within 1 second.
- [ ] **Step 3**: With both devices open, draw a new mark of any type on Device A. Confirm it appears on Device B in real-time.
- [ ] **Step 4**: With both devices open, edit a different mark on each device simultaneously. Confirm both edits persist.
- [ ] **Step 5**: Unplug Device A's network. Draw a new mark. Reconnect. Confirm the mark syncs to Device B within 5 seconds.
- [ ] **Step 6**: Document results in `VERIFICATION.md`.

---

### Task 21.9 — Reconciliation and roadmap update

- [ ] **Step 1**: Run full test suite: `npm test`. All pass (modulo the 3 pre-existing failures in `pdfAnnotationImporter` from before Phase 20).
- [ ] **Step 2**: Write `21-RECONCILIATION.md` per the project template (Plan vs Actual, Acceptance Criteria Results, Boundaries Honored, Lessons, Status).
- [ ] **Step 3**: Update `.planning/ROADMAP.md` to slot this phase in front of v3.0 Phase B.
- [ ] **Step 4**: Update `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md` to note the cloud-sync prerequisite has landed.
- [ ] **Step 5**: Commit.

```bash
git add .planning/phases/21-cloud-sync-all-annotations/21-RECONCILIATION.md \
        .planning/phases/21-cloud-sync-all-annotations/VERIFICATION.md \
        .planning/ROADMAP.md \
        docs/superpowers/plans/2026-04-25-pdf-native-annotations.md
git commit -m "docs(sync): close Phase 21 with reconciliation and roadmap update"
```

---

## Plan Status

- [ ] Task 21.1 — Schema migration
- [ ] Task 21.2 — Per-type serializers
- [ ] Task 21.3 — Generalize documentAnnotationService
- [ ] Task 21.4 — Wire App save path
- [ ] Task 21.5 — Wire App hydration path
- [ ] Task 21.6 — One-time local-to-cloud migration
- [ ] Task 21.7 — Conflict resolution tests
- [ ] Task 21.8 — End-to-end multi-device verification
- [ ] Task 21.9 — Reconciliation and roadmap update

---

*Plan written 2026-04-25. Ready for execution. Start with Task 21.1.*
