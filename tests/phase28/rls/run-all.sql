-- tests/phase28/rls/run-all.sql
-- Phase 28 RLS regression suite aggregator.
--
-- This suite is the RLS safety net: it verifies who-can-see/edit-what across the
-- core shared-document tables (RLS is the app's SOLE permission layer — no app-layer
-- fallback). Files 01-04 cover doc_yjs_updates; 05-10 cover the other RLS-gated
-- tables and the append-only audit trigger.
--
-- Each test wraps its own BEGIN/ROLLBACK, so fixtures never persist and a failure
-- in one file does not block the others. Each test starts with skip-guards: if a
-- required table/helper/policy/trigger does not exist in the target environment,
-- it prints `SKIP: <reason>` and exits cleanly. The suite is therefore
-- GREEN-OR-SKIPPED in any environment.
--
-- Run via:
--   psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql
--
-- IMPORTANT: SUPABASE_TEST_URL must point to the dedicated cloud TEST project
-- (survey-test), NEVER production. The suite runs everything inside ROLLBACK, but
-- the convention is to never aim destructive-looking fixtures at the prod project.
--
-- Expected output: zero ERROR lines; a mix of PASS and SKIP NOTICEs; final
-- "Phase 28 RLS suite PASSED" echo. Any FAIL surfaces as an ERROR and aborts the
-- offending file (the others still run).

\echo Running Phase 28 RLS test suite...

\i tests/phase28/rls/01_doc_yjs_updates_rls.sql
\i tests/phase28/rls/02_origin_userId_override.sql
\i tests/phase28/rls/03_non_collaborator_insert_rejected.sql
\i tests/phase28/rls/04_select_gated_viewer.sql
\i tests/phase28/rls/05_documents_rls.sql
\i tests/phase28/rls/06_document_collaborators_rls.sql
\i tests/phase28/rls/07_document_annotations_rls.sql
\i tests/phase28/rls/08_document_invites_rls.sql
\i tests/phase28/rls/09_storage_documents_bucket_rls.sql
\i tests/phase28/rls/10_excel_sync_audit_immutability.sql

\echo Phase 28 RLS suite PASSED
