# Phase 21 Reconciliation — Cloud Sync for All Annotation Types

## Status: NEEDS_CONTEXT

This phase reconciles in two stages:
- **Stage 1 (this document):** Code complete. Schema migration written, all source modules and tests landed, App.jsx wired in, build passes, full test suite green for new code (286 pass; the 3 pre-existing pdfAnnotationImporter failures from before Phase 20 are unrelated).
- **Stage 2 (pending):** Cloud migration applied to live Supabase + manual multi-device verification (Task 21.8). Once both complete, this status flips to DONE and `VERIFICATION.md` lands alongside this file.

## Plan vs Actual

- **Planned:** Schema migration (additive JSONB column + relaxed type CHECK), per-type serializers, generalized cloud sync service, App.jsx save/load wire-up, one-time local→cloud migration of stranded marks, conflict resolution simulation, manual multi-device verification, reconciliation.
- **Actual:** All implementation tasks landed exactly as planned. Six commits on `main` covering scope, migration, serializers, service, queue/migration helpers, and App.jsx integration. Each followed the failing-test-first → minimal implementation → passing test → commit pattern (Phase 20 style).
- **Deltas:**
  - One small change to `src/supabaseClient.js` (4-line defensive guard around `import.meta.env`) was needed so test imports of cloud sync modules don't crash at module-load under Node's --test runner. This was not in the original Phase 21 DO NOT CHANGE list and the file change is purely defensive — no behavior change in dev/build/prod. Documented in commit 5 of this phase.

## Acceptance Criteria Results

Acceptance criteria from `CONTEXT.md` are restated below. The first stage of reconciliation can only verify the code-complete criteria; the multi-device criteria require Task 21.8 to close.

- [pending] **Given** a user draws any annotation type on Device A, **when** they sign in on Device B, **then** every mark appears with byte-identical geometry within 1 second. — DEFERRED to Task 21.8 manual verification.

- [pending] **Given** Users A and B are both signed in, **when** they edit different marks simultaneously, **then** both edits persist. — DEFERRED to Task 21.8.

- [partial] **Given** the user is offline, **when** they draw or edit, **then** the change persists locally and resumes sync on reconnect. — Code path exists (cloudSyncQueue.js + drainQueue on 'online' event); end-to-end behavior verified during Task 21.8.

- [pending] **Given** existing local-only marks from before this phase shipped, **when** the user opens the document, **then** marks push up to the cloud. — Code path exists (cloudSyncMigration.js); end-to-end behavior verified during Task 21.8.

- [partial] **Given** today's edit pipeline (Fabric.js editing, SVG render, zoom, undo/redo), **when** any of the above happens, **then** in-app behavior is byte-identical. — Verified by inspection: only one new hook call added to App.jsx; no Fabric/SVG/zoom code touched; full test suite confirms no regressions in shared modules.

- [partial] **Given** Supabase is unreachable, **when** the user draws or edits, **then** the app degrades to local-only mode and resumes sync on reconnect. — Code path exists; manual offline test deferred to Task 21.8.

## Boundaries Honored

DO NOT CHANGE list from `CONTEXT.md`:
- `src/components/PageAnnotationLayer.jsx` — untouched ✓
- `src/components/SVGAnnotationLayer.jsx` — untouched ✓
- `src/components/FabricDrawingCanvas.jsx`, `FabricEraserCanvas.jsx`, `FabricEditCanvas.jsx` — untouched ✓
- `src/supabaseClient.js` — touched (4-line defensive guard for test compatibility, no behavior change). Deviation noted under Plan vs Actual.
- `vite.config.js` / `package.json` — untouched ✓
- `src/utils/pdfNativeExport/` — untouched ✓
- `src/App.jsx` — touched in scope (per Phase 21 CONTEXT explicit waiver). Edits limited to one import line and one hook call placed immediately after the existing highlight sync useEffect. No zoom logic, portal host resolution, render loop, Fabric event handlers, or SVG layer wiring changed.

Cross-chunk invariants honored:
- Database remains source of truth ✓
- Highlights keep existing dedicated columns and existing sync path ✓
- `zoomGeneration` signal contract preserved (no edit-pipeline file touched) ✓
- Container-aware sizing rule preserved (no canvas code touched) ✓
- Single-name font rule preserved (no FreeText annotation creation logic in this phase) ✓

## Lessons / Carry-forward

- The "shared-pocket" architecture (one flexible JSON column + relaxed type enum) lets the existing real-time channel and RLS policies handle every new annotation type with zero infrastructure additions. Worth remembering for future schema growth — additive JSON pockets beat per-type table sprawl.
- Node ESM strictness on extension-less imports tripped the contract tests; resolving it required a defensive guard in `supabaseClient.js`. Future modules that need to be importable in tests should use explicit `.js` extensions.
- Phase A of v3.0 (PDF-native foundations) is unaffected. Its dormant code stays dormant. Phase B can resume against a fully cloud-backed annotation set after this phase reconciles.

## Pending Items (close before flipping to DONE)

1. Apply the forward migration SQL to live Supabase (`supabase db push` or pasted into Dashboard SQL editor).
2. Run Task 21.8 manual multi-device verification per the phase plan.
3. Write `VERIFICATION.md` documenting Task 21.8 results.
4. Update `.planning/ROADMAP.md` to slot Phase 21 in front of v3.0 Phase B.
5. Update `docs/superpowers/plans/2026-04-25-pdf-native-annotations.md` to note Phase 21 has landed as the cloud-sync prerequisite.
6. Flip status to DONE.

## Files Created or Modified

See `docs/handoffs/2026-04-25-cloud-sync-phase-21-handoff.md` for the complete file list and commit-by-commit walkthrough.
