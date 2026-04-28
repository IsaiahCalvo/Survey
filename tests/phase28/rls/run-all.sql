-- tests/phase28/rls/run-all.sql
-- Phase 28 RLS test suite aggregator. Plan 28-05's migration must apply before this
-- runs cleanly; until then each test prints `SKIP: <reason>` per its own guard.
--
-- Run via:
--   psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql
--
-- Expected output: zero ERROR lines, several PASS NOTICEs, final "Phase 28 RLS suite PASSED" echo.
-- Each individual test wraps its own BEGIN/ROLLBACK so failures in one don't block others.

\echo Running Phase 28 RLS test suite...

\i tests/phase28/rls/01_doc_yjs_updates_rls.sql
\i tests/phase28/rls/02_origin_userId_override.sql
\i tests/phase28/rls/03_non_collaborator_insert_rejected.sql
\i tests/phase28/rls/04_select_gated_viewer.sql

\echo Phase 28 RLS suite PASSED
