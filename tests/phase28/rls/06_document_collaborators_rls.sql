-- tests/phase28/rls/06_document_collaborators_rls.sql
-- RLS regression test for the document_collaborators table.
--
-- FOCUS: Only the document owner (documents.user_id = auth.uid()) OR a collaborator
-- with role='owner' can INSERT/UPDATE/DELETE collaborator rows. Editors and viewers are
-- blocked (INSERT → 42501; UPDATE/DELETE → 0 rows or 42501). Non-collaborators see zero
-- rows on SELECT (silent RLS filter). The kal31_guard_last_owner_trg prevents
-- demoting/deleting the last owner (check_violation, 23514).
--
-- GROUND TRUTH (verified against live migrations):
--   document_collaborators SELECT : user_can_access_document(document_id,'viewer')
--   document_collaborators INSERT/UPDATE/DELETE : user_can_access_document(document_id,'owner')
--   user_can_access_document resolves owner via documents.user_id DIRECTLY
--     (20260527130000). 0001 (documents.user_id) clears RLS for the owner-gated
--     write policies WITHOUT needing a collaborator row and WITHOUT any projects JOIN.
--   kal31_guard_last_owner (20260521000000): fires only when an existing role='owner'
--     COLLABORATOR row is demoted/deleted and no OTHER active owner-role row remains.
--     0001 is documents.user_id (NOT a collaborator row), so the SOLE owner-collaborator
--     row is 0005 — demoting/deleting it trips the guard.
--
-- CRITICAL CORRECTNESS: Each persona block drops to SET LOCAL ROLE authenticated so that
-- RLS policies actually fire against auth.uid() (which reads the JWT sub claim). Fixture
-- work is done as the superuser (RESET ROLE) so RLS does not block setup. Both JWT GUCs
-- are set (request.jwt.claim.sub AND request.jwt.claims) to cover both reading paths.
--
-- Persona UUID convention (matches existing files 01-04):
--   0001 = document owner (documents.user_id; NO collaborator row — only the doc owner)
--   0002 = editor collaborator
--   0003 = viewer collaborator
--   0004 = non-collaborator (authenticated but no row for this doc)
--   0005 = second-owner collaborator (needed for last-owner guard tests)
--   9999...9 = test document id
--
-- The kal31 trigger guard is scoped only to blocks O-Q below — blocks A-N are pure RLS
-- tests that run regardless of the trigger's presence.
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/06_document_collaborators_rls.sql
-- IMPORTANT: SUPABASE_TEST_URL must point to the survey-test project, NEVER production.
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  v_count   int;
BEGIN

  -- ============================================================================
  -- Skip-guards: abort cleanly if prerequisites are absent in this environment.
  -- NOTE: the kal31 trigger guard is scoped only to blocks O-Q below.
  -- ============================================================================

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document') THEN
    RAISE NOTICE 'SKIP: user_can_access_document() helper missing';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_collaborators') THEN
    RAISE NOTICE 'SKIP: document_collaborators table missing';
    RETURN;
  END IF;

  -- Guard: status column required by this test's fixture INSERTs.
  -- Without this guard, a schema that predates the status column would hard-fail
  -- with an unhandled ERROR instead of a clean SKIP.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'document_collaborators'
       AND column_name  = 'status'
  ) THEN
    RAISE NOTICE 'SKIP: document_collaborators.status column missing (schema older than this test)';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents') THEN
    RAISE NOTICE 'SKIP: documents table missing';
    RETURN;
  END IF;

  -- ============================================================================
  -- Fixture setup — run as superuser (RESET ROLE), RLS does not apply here.
  -- Insert the test document owned by 0001, then add collaborator rows for
  -- editor (0002), viewer (0003), and second-owner (0005).
  --
  -- 0001 is intentionally NOT inserted as a collaborator row — only as
  -- documents.user_id. This is the fixture invariant block O relies on: the SOLE
  -- owner-collaborator row is 0005, so demoting/deleting 0005 trips kal31.
  --
  -- Use ON CONFLICT DO NOTHING + explicit UPDATE (portable: does not require a
  -- named unique constraint, unlike ON CONFLICT (col, col) DO UPDATE).
  -- ============================================================================

  RESET ROLE;

  -- auth.users FK guard (mirrors 08): document_collaborators.user_id REFERENCES
  -- auth.users(id); synthetic persona UUIDs have no auth.users row in a bare test DB,
  -- so collaborator fixtures FK-fail (23503). SKIP cleanly when absent (GREEN-OR-SKIPPED);
  -- seed persona auth.users rows + apply the prod RLS schema to run these live.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003'::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000005'::uuid) THEN
    RAISE NOTICE 'SKIP: persona collaborator UUIDs (0002/0003/0005) not in auth.users — document_collaborators FK would fail here';
    RETURN;
  END IF;

  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  -- editor collaborator
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000002'::uuid,
            'editor', 'active')
    ON CONFLICT DO NOTHING;
  UPDATE document_collaborators
     SET role = 'editor', status = 'active'
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000002'::uuid;

  -- viewer collaborator
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000003'::uuid,
            'viewer', 'active')
    ON CONFLICT DO NOTHING;
  UPDATE document_collaborators
     SET role = 'viewer', status = 'active'
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000003'::uuid;

  -- second-owner collaborator (used to safely test last-owner guard without
  -- locking out 0001, and to test owner-collaborator write access).
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000005'::uuid,
            'owner', 'active')
    ON CONFLICT DO NOTHING;
  UPDATE document_collaborators
     SET role = 'owner', status = 'active'
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000005'::uuid;

  -- ============================================================================
  -- TEST BLOCK A: Non-collaborator (0004) SELECT — must see 0 rows (silent RLS)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000004',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count
    FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL A: non-collaborator SELECT returned % row(s) (expected 0) — RLS leak on document_collaborators', v_count;
  END IF;
  RAISE NOTICE 'PASS A: non-collaborator SELECT returned 0 rows (RLS silently filtered)';

  -- ============================================================================
  -- TEST BLOCK B: Non-collaborator (0004) INSERT — must be denied (42501)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000004',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000004'::uuid,
              'editor', 'active');
    RAISE EXCEPTION 'FAIL B: non-collaborator INSERT should have been rejected (42501)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS B: non-collaborator INSERT correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK B2: Non-collaborator (0004) UPDATE — must affect 0 rows (silent RLS)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000004',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE document_collaborators
       SET role = 'owner'
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000002'::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL B2: non-collaborator UPDATE modified % row(s) — RLS leak on UPDATE', v_count;
    END IF;
    RAISE NOTICE 'PASS B2: non-collaborator UPDATE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS B2: non-collaborator UPDATE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK B3: Non-collaborator (0004) DELETE — must affect 0 rows (silent RLS)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000004',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM document_collaborators
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000002'::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL B3: non-collaborator DELETE removed % row(s) — RLS leak on DELETE', v_count;
    END IF;
    RAISE NOTICE 'PASS B3: non-collaborator DELETE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS B3: non-collaborator DELETE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK C: Editor (0002) SELECT — must see collaborator rows (ALLOW)
  -- SELECT policy: user_can_access_document(document_id, 'viewer') — editor qualifies.
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000002',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count
    FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL C: editor SELECT returned % rows (expected >= 1) — editor cannot see collaborator list they are entitled to', v_count;
  END IF;
  RAISE NOTICE 'PASS C: editor SELECT returned % row(s) (ALLOW as expected)', v_count;

  -- ============================================================================
  -- TEST BLOCK C2: Viewer (0003) SELECT — must see collaborator rows (ALLOW)
  -- SELECT policy: user_can_access_document(document_id, 'viewer') — viewer qualifies.
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000003',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count
    FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL C2: viewer SELECT returned % rows (expected >= 1) — viewer cannot see collaborator list they are entitled to', v_count;
  END IF;
  RAISE NOTICE 'PASS C2: viewer SELECT returned % row(s) (ALLOW as expected)', v_count;

  -- ============================================================================
  -- TEST BLOCK D: Editor (0002) INSERT — must be denied (42501)
  -- INSERT policy: user_can_access_document(document_id, 'owner') — editor is not owner.
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000002',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000006'::uuid,
              'viewer', 'active');
    RAISE EXCEPTION 'FAIL D: editor INSERT should have been rejected (42501)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS D: editor INSERT correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK E: Editor (0002) UPDATE — must be denied (42501 or 0 rows)
  -- UPDATE policy: user_can_access_document(document_id, 'owner') — editor not owner.
  -- RLS on UPDATE may raise 42501 or silently match 0 rows; both are DENY.
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000002',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE document_collaborators
       SET role = 'owner'
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000002'::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL E: editor self-escalation UPDATE modified % row(s) — RLS on UPDATE failed', v_count;
    END IF;
    RAISE NOTICE 'PASS E: editor UPDATE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS E: editor UPDATE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK F: Editor (0002) DELETE — must be denied (42501 or 0 rows)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000002',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM document_collaborators
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000003'::uuid; -- viewer row
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL F: editor DELETE removed % row(s) — RLS on DELETE failed', v_count;
    END IF;
    RAISE NOTICE 'PASS F: editor DELETE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS F: editor DELETE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK G: Viewer (0003) INSERT — must be denied (42501)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000003',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000006'::uuid,
              'viewer', 'active');
    RAISE EXCEPTION 'FAIL G: viewer INSERT should have been rejected (42501)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS G: viewer INSERT correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK H: Viewer (0003) UPDATE — must be denied (42501 or 0 rows)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000003',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE document_collaborators
       SET role = 'editor'
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000003'::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL H: viewer self-escalation UPDATE modified % row(s) — RLS on UPDATE failed', v_count;
    END IF;
    RAISE NOTICE 'PASS H: viewer UPDATE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS H: viewer UPDATE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK I: Viewer (0003) DELETE — must be denied (42501 or 0 rows)
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000003',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM document_collaborators
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000002'::uuid; -- editor row
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'FAIL I: viewer DELETE removed % row(s) — RLS on DELETE failed', v_count;
    END IF;
    RAISE NOTICE 'PASS I: viewer DELETE returned 0 rows affected (RLS silently blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS I: viewer DELETE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- TEST BLOCK J: Owner-via-documents (0001) SELECT — must see all rows (ALLOW)
  -- 0001 has documents.user_id ownership (no collaborator row). user_can_access_document
  -- returns TRUE via the documents.user_id fast-path.
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count
    FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL J: document owner SELECT returned % rows (expected >= 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS J: document owner SELECT returned % row(s) (ALLOW as expected)', v_count;

  -- ============================================================================
  -- TEST BLOCK K: Owner-via-documents (0001) can INSERT a new collaborator
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Insert a fresh collaborator row (non-collaborator 0004 becomes a viewer)
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000004'::uuid,
            'viewer', 'active');
  RAISE NOTICE 'PASS K: document owner INSERT of new collaborator succeeded';

  -- ============================================================================
  -- TEST BLOCK L: Owner-via-documents (0001) can UPDATE a collaborator's role
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Promote 0004 (just inserted as viewer in K) to editor — a real role change
  UPDATE document_collaborators
     SET role = 'editor'
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000004'::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL L: document owner UPDATE modified % row(s) (expected 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS L: document owner UPDATE (viewer→editor) succeeded';

  -- ============================================================================
  -- TEST BLOCK M: Owner-via-documents (0001) can DELETE a collaborator
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Remove the 0004 row that was added in block K/L
  DELETE FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000004'::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL M: document owner DELETE removed % row(s) (expected 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS M: document owner DELETE (remove collaborator) succeeded';

  -- ============================================================================
  -- TEST BLOCK N: Owner-collaborator (0005, role=owner) can INSERT/UPDATE/DELETE
  -- Verifies the collaborator-owner branch of user_can_access_document('owner').
  -- ============================================================================

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-000000000005', true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub','00000000-0000-0000-0000-000000000005',
                                       'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- N1: INSERT — second-owner adds user 0004 as viewer
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000004'::uuid,
            'viewer', 'active');
  RAISE NOTICE 'PASS N1: owner-collaborator (0005) INSERT succeeded';

  -- N2: UPDATE — promote 0004 from viewer to editor (a real change, not a no-op)
  UPDATE document_collaborators
     SET role = 'editor'
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000004'::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL N2: owner-collaborator UPDATE modified % row(s) (expected 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS N2: owner-collaborator (0005) UPDATE (viewer→editor) succeeded';

  -- N3: DELETE — remove the 0004 row
  DELETE FROM document_collaborators
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
     AND user_id     = '00000000-0000-0000-0000-000000000004'::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL N3: owner-collaborator DELETE removed % row(s) (expected 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS N3: owner-collaborator (0005) DELETE succeeded';

  -- ============================================================================
  -- kal31_guard_last_owner tests (O, P, Q)
  -- Only run if the trigger function is present — skip gracefully if not.
  -- RLS tests A-N above run regardless of trigger presence.
  -- ============================================================================

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'kal31_guard_last_owner') THEN
    RAISE NOTICE 'SKIP O-Q: kal31_guard_last_owner() trigger fn missing (KAL-31 not applied)';
  ELSE

    -- ============================================================================
    -- TEST BLOCK O: kal31_guard_last_owner — cannot demote the last owner (UPDATE)
    --
    -- Fixture invariant: 0001 has NO document_collaborators row — only
    -- documents.user_id ownership. Therefore 0005 is the SOLE owner-collaborator
    -- row. 0001 acting as JWT passes RLS via the documents.user_id fast-path, so
    -- the statement reaches the trigger; kal31_guard_last_owner counts OTHER
    -- active owner-role rows = 0 and raises check_violation (23514).
    -- ============================================================================

    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub',
                       '00000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                         'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      -- Attempt to demote 0005 (the sole owner *collaborator* row) to editor.
      UPDATE document_collaborators
         SET role = 'editor'
       WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
         AND user_id     = '00000000-0000-0000-0000-000000000005'::uuid;
      RAISE EXCEPTION 'FAIL O: demoting last owner-collaborator should have raised check_violation (23514)';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'PASS O: kal31_guard_last_owner raised check_violation (23514) on last-owner demotion';
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL O: got 42501 — RLS blocked before trigger could fire; 0001 should clear RLS via documents.user_id fast-path';
    END;

    -- ============================================================================
    -- TEST BLOCK P: kal31_guard_last_owner — cannot delete the last owner (DELETE)
    -- ============================================================================

    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub',
                       '00000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                         'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      -- Attempt to delete 0005 (the sole owner-collaborator row).
      DELETE FROM document_collaborators
       WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
         AND user_id     = '00000000-0000-0000-0000-000000000005'::uuid;
      RAISE EXCEPTION 'FAIL P: deleting last owner-collaborator should have raised check_violation (23514)';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'PASS P: kal31_guard_last_owner raised check_violation (23514) on last-owner deletion';
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL P: got 42501 — RLS blocked before trigger could fire; check owner access for 0001';
    END;

    -- ============================================================================
    -- TEST BLOCK Q: kal31 allows deletion when a second owner remains
    -- Add 0004 as owner (so two owner rows exist: 0004 and 0005), then delete 0005.
    -- Guard must NOT fire because at least one owner row will remain.
    -- ============================================================================

    RESET ROLE;
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000004'::uuid,
              'owner', 'active')
      ON CONFLICT DO NOTHING;
    UPDATE document_collaborators
       SET role = 'owner', status = 'active'
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000004'::uuid;

    PERFORM set_config('request.jwt.claim.sub',
                       '00000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub','00000000-0000-0000-0000-000000000001',
                                         'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    DELETE FROM document_collaborators
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
       AND user_id     = '00000000-0000-0000-0000-000000000005'::uuid;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'FAIL Q: owner DELETE of non-last owner-collaborator removed % row(s) (expected 1) — kal31 guard fired when it should not have', v_count;
    END IF;
    RAISE NOTICE 'PASS Q: owner DELETE succeeded when a second owner-collaborator remains (kal31 guard correctly silent)';

  END IF; -- end kal31 guard section

  RESET ROLE;

  RAISE NOTICE 'document_collaborators RLS tests COMPLETE';

END $$;

ROLLBACK;
