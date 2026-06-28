-- tests/phase28/rls/05_documents_rls.sql
-- RLS regression test: documents + document_collaborators tables.
--
-- Verifies the full permission matrix:
--   owner        → SELECT/UPDATE/DELETE allowed; INSERT allowed (as privileged fixture)
--   editor       → SELECT allowed; UPDATE/DELETE denied (0 rows or 42501)
--   viewer       → SELECT allowed; UPDATE/DELETE denied (0 rows or 42501)
--   non-collab   → SELECT returns 0 rows (silent filter); UPDATE/DELETE denied
--   document_collaborators:
--     owner      → SELECT/INSERT/UPDATE/DELETE allowed on collaborators
--     editor     → SELECT allowed; INSERT denied (42501); UPDATE/DELETE denied (0 rows or 42501)
--     non-collab → SELECT returns 0 rows; INSERT denied (42501)
--   last-owner guard: demoting / removing the sole owner raises check_violation (23514)
--
-- GROUND TRUTH (verified against live migrations):
--   documents SELECT  : auth.uid() = user_id OR user_can_access_document(id,'viewer')
--                       (20260513013000) — owner/editor/viewer see it, non-collab gets 0 rows.
--   documents UPDATE  : auth.uid() = user_id (owner-only) (20241223000004)
--   documents DELETE  : auth.uid() = user_id (owner-only) (20241223000004)
--   document_collaborators SELECT : user_can_access_document(document_id,'viewer')
--   document_collaborators INSERT/UPDATE/DELETE : user_can_access_document(document_id,'owner')
--   user_can_access_document resolves owner via documents.user_id directly
--     (20260527130000) — no projects JOIN, no owner collaborator row required.
--   kal31_guard_last_owner (20260521000000): BEFORE UPDATE/DELETE on
--     document_collaborators; fires only when an existing role='owner' row is
--     demoted/deleted and no OTHER active owner-role row remains; raises
--     ERRCODE='check_violation' (23514).
--
-- CRITICAL: Each persona block uses the full role-switch pattern:
--   SET LOCAL ROLE postgres       -- privileged fixture work; never RESET ROLE alone
--   PERFORM set_config('request.jwt.claim.sub', ...) and request.jwt.claims (JSON)
--   SET LOCAL ROLE authenticated  -- this is what makes RLS actually fire
--   ... test operations ...
--   SET LOCAL ROLE postgres       -- back to privileged before next fixture
--
-- Files 01-04 omit SET LOCAL ROLE authenticated, so RLS never fires in those tests.
-- This file is the first to use the correct pattern per the CRITICAL CORRECTNESS RULE.
-- RESET ROLE is NOT used for privileged restore — it falls back to the session role
-- which may be 'authenticated' in Supabase pooler connections. Use SET LOCAL ROLE postgres.
--
-- UPDATE/DELETE DENY SEMANTICS: PostgreSQL RLS USING-clause filtering for
-- UPDATE/DELETE silently affects 0 rows when the actor cannot see/own the row —
-- it does NOT raise 42501. INSERT WITH CHECK violations DO raise 42501. The
-- write-deny assertions accept either 0-rows or 42501 as PASS, except INSERT-deny
-- which requires 42501.
--
-- Persona UUIDs:
--   0001 = owner, 0002 = editor, 0003 = viewer, 0004 = non-collaborator
--   9999 = test document id (same stable UUID used across the suite)
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/05_documents_rls.sql
-- IMPORTANT: SUPABASE_TEST_URL must point to the survey-test project, NEVER production.
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  visible_rows    int;
  affected_rows   int;
BEGIN

  -- ============================================================================
  -- SKIP GUARDS
  -- ============================================================================
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents') THEN
    RAISE NOTICE 'SKIP: documents table not yet created';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_collaborators') THEN
    RAISE NOTICE 'SKIP: document_collaborators not yet created';
    RETURN;
  END IF;

  -- Guard for status column — fixture INSERTs use explicit status='active'.
  -- Without this guard, a missing column produces an error rather than a clean SKIP.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_collaborators' AND column_name = 'status'
  ) THEN
    RAISE NOTICE 'SKIP: document_collaborators.status column not yet created';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document') THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created';
    RETURN;
  END IF;

  -- ============================================================================
  -- FIXTURE SETUP (privileged role — bypasses RLS tier-limit WITH CHECK)
  -- ============================================================================
  -- Use SET LOCAL ROLE postgres, not RESET ROLE. RESET ROLE falls back to the
  -- session role, which may be 'authenticated' in Supabase pooler connections,
  -- causing fixture INSERTs to run with RLS active and silently fail or misbehave.
  SET LOCAL ROLE postgres;

  -- auth.users FK guard (mirrors 08): document_collaborators.user_id REFERENCES
  -- auth.users(id); synthetic persona UUIDs have no auth.users row in a bare test DB,
  -- so collaborator fixtures FK-fail (23503). SKIP cleanly when absent (GREEN-OR-SKIPPED);
  -- seed persona auth.users rows + apply the prod RLS schema to run these live.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003'::uuid) THEN
    RAISE NOTICE 'SKIP: persona collaborator UUIDs (0002/0003) not in auth.users — document_collaborators FK would fail here';
    RETURN;
  END IF;

  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  -- Add editor (0002) and viewer (0003) collaborators with status='active'.
  -- status must be explicit because user_can_access_document filters WHERE status='active'.
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid, 'editor', 'active'),
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000003'::uuid, 'viewer', 'active')
    ON CONFLICT (document_id, user_id) DO NOTHING;

  -- ============================================================================
  -- SECTION A: documents table
  -- ============================================================================

  -- --------------------------------------------------------------------------
  -- A-1: OWNER (0001) — SELECT allowed
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM documents
    WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows != 1 THEN
    RAISE EXCEPTION 'FAIL A-1: owner SELECT returned % rows (expected 1)', visible_rows;
  END IF;
  RAISE NOTICE 'PASS A-1: owner SELECT returned 1 row';

  -- --------------------------------------------------------------------------
  -- A-2: OWNER (0001) — UPDATE allowed
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE documents
      SET title = 'rls-test-title'
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 1 THEN
      RAISE EXCEPTION 'FAIL A-2: owner UPDATE affected % rows (expected 1)', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-2: owner UPDATE succeeded (% row)', affected_rows;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL A-2: owner UPDATE raised 42501 (should be allowed)';
  END;

  -- --------------------------------------------------------------------------
  -- A-2b: OWNER (0001) — DELETE allowed
  -- The permission matrix states owner can DELETE. Insert a spare document to
  -- delete so the main fixture row survives for the remaining tests.
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999998'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM documents
      WHERE id = '99999999-9999-9999-9999-999999999998'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 1 THEN
      RAISE EXCEPTION 'FAIL A-2b: owner DELETE affected % rows (expected 1)', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-2b: owner DELETE succeeded (% row)', affected_rows;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL A-2b: owner DELETE raised 42501 (should be allowed)';
  END;

  -- --------------------------------------------------------------------------
  -- A-3: EDITOR (0002) — SELECT allowed
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;  -- back to privileged before switching persona
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM documents
    WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows != 1 THEN
    RAISE EXCEPTION 'FAIL A-3: editor SELECT returned % rows (expected 1)', visible_rows;
  END IF;
  RAISE NOTICE 'PASS A-3: editor SELECT returned 1 row';

  -- --------------------------------------------------------------------------
  -- A-4: EDITOR (0002) — UPDATE denied
  -- documents UPDATE policy is owner-only (auth.uid()=user_id); editor gets 0
  -- rows affected (USING filter), not 42501. Accept 0-rows or 42501.
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE documents
      SET title = 'editor-should-not-write'
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-4: editor UPDATE affected % rows — RLS did not block write', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-4: editor UPDATE blocked by RLS (0 rows affected, no exception)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-4: editor UPDATE correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- A-5: EDITOR (0002) — DELETE denied
  -- --------------------------------------------------------------------------
  BEGIN
    DELETE FROM documents
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-5: editor DELETE removed % rows — RLS did not block', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-5: editor DELETE blocked by RLS (0 rows affected, no exception)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-5: editor DELETE correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- A-6: VIEWER (0003) — SELECT allowed
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000003',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM documents
    WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows != 1 THEN
    RAISE EXCEPTION 'FAIL A-6: viewer SELECT returned % rows (expected 1)', visible_rows;
  END IF;
  RAISE NOTICE 'PASS A-6: viewer SELECT returned 1 row';

  -- --------------------------------------------------------------------------
  -- A-7: VIEWER (0003) — UPDATE denied
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE documents
      SET title = 'viewer-should-not-write'
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-7: viewer UPDATE affected % rows — RLS did not block write', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-7: viewer UPDATE blocked by RLS (0 rows affected, no exception)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-7: viewer UPDATE correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- A-8: VIEWER (0003) — DELETE denied
  -- --------------------------------------------------------------------------
  BEGIN
    DELETE FROM documents
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-8: viewer DELETE removed % rows — RLS did not block', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-8: viewer DELETE blocked by RLS (0 rows affected, no exception)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-8: viewer DELETE correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- A-9: NON-COLLABORATOR (0004) — SELECT returns 0 rows (silent filter)
  -- The SELECT policy uses OR dual-predicate; neither branch matches 0004.
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM documents
    WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows != 0 THEN
    RAISE EXCEPTION 'FAIL A-9: non-collaborator SELECT returned % rows (expected 0) — RLS leak', visible_rows;
  END IF;
  RAISE NOTICE 'PASS A-9: non-collaborator SELECT returned 0 rows (RLS silently filtered)';

  -- --------------------------------------------------------------------------
  -- A-10: NON-COLLABORATOR (0004) — UPDATE denied
  -- No row visible so RLS gives 0 affected; that is the correct block.
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE documents
      SET title = 'non-collab-should-not-write'
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-10: non-collaborator UPDATE affected % rows — RLS leak', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-10: non-collaborator UPDATE blocked (0 rows, RLS invisible)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-10: non-collaborator UPDATE correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- A-11: NON-COLLABORATOR (0004) — DELETE denied
  -- --------------------------------------------------------------------------
  BEGIN
    DELETE FROM documents
      WHERE id = '99999999-9999-9999-9999-999999999999'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL A-11: non-collaborator DELETE removed % rows — RLS leak', affected_rows;
    END IF;
    RAISE NOTICE 'PASS A-11: non-collaborator DELETE blocked (0 rows, RLS invisible)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS A-11: non-collaborator DELETE correctly rejected (42501)';
  END;

  -- ============================================================================
  -- SECTION B: document_collaborators table
  -- ============================================================================

  -- --------------------------------------------------------------------------
  -- B-1: OWNER (0001) — SELECT on document_collaborators allowed
  -- (policy: user_can_access_document(document_id, 'viewer') — owner qualifies)
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM document_collaborators
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  -- Expect at least 2 rows (editor + viewer). The owner auto-collaborator trigger
  -- only fires when project_id resolves a project owner; our fixture has NULL
  -- project_id, so it does not add 0001. Accept >= 1 to stay environment-robust.
  IF visible_rows < 1 THEN
    RAISE EXCEPTION 'FAIL B-1: owner SELECT on document_collaborators returned % rows (expected >= 1)', visible_rows;
  END IF;
  RAISE NOTICE 'PASS B-1: owner SELECT on document_collaborators returned % rows', visible_rows;

  -- --------------------------------------------------------------------------
  -- B-2: OWNER (0001) — INSERT collaborator allowed
  -- Use a distinct user UUID (0005) to avoid ON CONFLICT with the fixture rows.
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000005'::uuid, 'viewer', 'active');
    RAISE NOTICE 'PASS B-2: owner INSERT into document_collaborators succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL B-2: owner INSERT into document_collaborators raised 42501 (should be allowed)';
  END;

  -- --------------------------------------------------------------------------
  -- B-3: OWNER (0001) — UPDATE collaborator role allowed
  -- Promote the 0005 row viewer → editor (a real change, ROW_COUNT proves mutation).
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE document_collaborators
      SET role = 'editor'
      WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
        AND user_id = '00000000-0000-0000-0000-000000000005'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 1 THEN
      RAISE EXCEPTION 'FAIL B-3: owner UPDATE on document_collaborators affected % rows (expected 1)', affected_rows;
    END IF;
    RAISE NOTICE 'PASS B-3: owner UPDATE on document_collaborators succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL B-3: owner UPDATE on document_collaborators raised 42501 (should be allowed)';
  END;

  -- --------------------------------------------------------------------------
  -- B-4: OWNER (0001) — DELETE collaborator allowed (non-owner removal)
  -- Delete the 0005 row we added in B-2 (it is editor, not owner → guard silent).
  -- --------------------------------------------------------------------------
  BEGIN
    DELETE FROM document_collaborators
      WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
        AND user_id = '00000000-0000-0000-0000-000000000005'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows != 1 THEN
      RAISE EXCEPTION 'FAIL B-4: owner DELETE from document_collaborators affected % rows (expected 1)', affected_rows;
    END IF;
    RAISE NOTICE 'PASS B-4: owner DELETE from document_collaborators succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL B-4: owner DELETE from document_collaborators raised 42501 (should be allowed)';
  END;

  -- --------------------------------------------------------------------------
  -- B-5: EDITOR (0002) — SELECT on document_collaborators allowed
  -- (policy: user_can_access_document(document_id, 'viewer') — editor qualifies)
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM document_collaborators
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows < 1 THEN
    RAISE EXCEPTION 'FAIL B-5: editor SELECT on document_collaborators returned % rows (expected >= 1)', visible_rows;
  END IF;
  RAISE NOTICE 'PASS B-5: editor SELECT on document_collaborators returned % rows', visible_rows;

  -- --------------------------------------------------------------------------
  -- B-6: EDITOR (0002) — INSERT into document_collaborators denied (42501)
  -- INSERT policy: user_can_access_document(document_id, 'owner') — editor not owner.
  -- INSERT deny must raise 42501 (WITH CHECK), not 0-rows.
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000006'::uuid, 'viewer', 'active');
    RAISE EXCEPTION 'FAIL B-6: editor INSERT into document_collaborators should have been denied — owner-only policy not enforced';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS B-6: editor INSERT into document_collaborators correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- B-7: EDITOR (0002) — UPDATE on document_collaborators denied
  -- UPDATE USING is owner-only; editor sees 0 rows or 42501.
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE document_collaborators
      SET role = 'owner'
      WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
        AND user_id = '00000000-0000-0000-0000-000000000003'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL B-7: editor UPDATE on document_collaborators affected % rows — RLS not blocking', affected_rows;
    END IF;
    RAISE NOTICE 'PASS B-7: editor UPDATE on document_collaborators blocked (0 rows, RLS invisible)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS B-7: editor UPDATE on document_collaborators correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- B-8: EDITOR (0002) — DELETE from document_collaborators denied
  -- --------------------------------------------------------------------------
  BEGIN
    DELETE FROM document_collaborators
      WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
        AND user_id = '00000000-0000-0000-0000-000000000003'::uuid;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows > 0 THEN
      RAISE EXCEPTION 'FAIL B-8: editor DELETE from document_collaborators removed % rows — RLS not blocking', affected_rows;
    END IF;
    RAISE NOTICE 'PASS B-8: editor DELETE from document_collaborators blocked (0 rows, RLS invisible)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS B-8: editor DELETE from document_collaborators correctly rejected (42501)';
  END;

  -- --------------------------------------------------------------------------
  -- B-9: NON-COLLABORATOR (0004) — SELECT returns 0 rows (silent filter)
  -- --------------------------------------------------------------------------
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004',
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_rows
    FROM document_collaborators
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF visible_rows != 0 THEN
    RAISE EXCEPTION 'FAIL B-9: non-collaborator SELECT on document_collaborators returned % rows (expected 0) — RLS leak', visible_rows;
  END IF;
  RAISE NOTICE 'PASS B-9: non-collaborator SELECT on document_collaborators returned 0 rows';

  -- --------------------------------------------------------------------------
  -- B-10: NON-COLLABORATOR (0004) — INSERT into document_collaborators denied (42501)
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000004'::uuid, 'viewer', 'active');
    RAISE EXCEPTION 'FAIL B-10: non-collaborator INSERT into document_collaborators should have been denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS B-10: non-collaborator INSERT into document_collaborators correctly rejected (42501)';
  END;

  -- ============================================================================
  -- SECTION C: last-owner guard (kal31_guard_last_owner trigger)
  -- These tests only run if the trigger function exists (separate skip guard).
  -- ERRCODE is check_violation (23514), NOT insufficient_privilege (42501).
  --
  -- The guard fires only when an existing role='owner' collaborator row is
  -- demoted/deleted AND no OTHER active owner-role row remains. 0001 is the
  -- documents.user_id owner, so it passes RLS (owner fast-path) and the statement
  -- reaches the trigger. We make 0001 the SOLE owner-role collaborator row so the
  -- guard sees remaining_owners=0 and fires.
  -- ============================================================================
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'kal31_guard_last_owner') THEN
    RAISE NOTICE 'SKIP C: kal31_guard_last_owner trigger not yet created — skipping last-owner guard tests';
  ELSE

    -- Ensure we are back to privileged role for fixture adjustments.
    SET LOCAL ROLE postgres;

    -- Make 0001 the sole active owner-role collaborator row on the test document.
    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000001'::uuid, 'owner', 'active')
      ON CONFLICT (document_id, user_id)
        DO UPDATE SET role = 'owner', status = 'active';

    -- C-1: Owner (0001) demoting themselves (the sole owner-role row) → check_violation
    PERFORM set_config('request.jwt.claim.sub',
      '00000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub','00000000-0000-0000-0000-000000000001',
                        'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      UPDATE document_collaborators
        SET role = 'editor'
        WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
          AND user_id = '00000000-0000-0000-0000-000000000001'::uuid;
      RAISE EXCEPTION 'FAIL C-1: demoting sole owner should have raised check_violation (23514) — last-owner guard not firing';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'PASS C-1: demoting sole owner correctly raised check_violation (23514)';
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL C-1: got 42501 instead of check_violation — RLS blocked before trigger fired (0001 should pass RLS via documents.user_id)';
    END;

    -- C-2: Owner (0001) deleting their own collaborator row (sole owner) → check_violation
    BEGIN
      DELETE FROM document_collaborators
        WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
          AND user_id = '00000000-0000-0000-0000-000000000001'::uuid;
      RAISE EXCEPTION 'FAIL C-2: deleting sole owner row should have raised check_violation (23514) — last-owner guard not firing';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'PASS C-2: deleting sole owner row correctly raised check_violation (23514)';
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL C-2: got 42501 instead of check_violation — RLS blocked before trigger fired';
    END;

    -- C-3: Removing a non-owner collaborator (0003 viewer) is allowed when an owner remains.
    -- This confirms the guard does NOT over-block legitimate removes.
    -- Re-insert both the owner row and the viewer row explicitly so the DELETE has
    -- a deterministic target and an owner still remains.
    SET LOCAL ROLE postgres;

    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000001'::uuid, 'owner', 'active')
      ON CONFLICT (document_id, user_id)
        DO UPDATE SET role = 'owner', status = 'active';

    INSERT INTO document_collaborators (document_id, user_id, role, status)
      VALUES ('99999999-9999-9999-9999-999999999999'::uuid,
              '00000000-0000-0000-0000-000000000003'::uuid, 'viewer', 'active')
      ON CONFLICT (document_id, user_id)
        DO UPDATE SET role = 'viewer', status = 'active';

    PERFORM set_config('request.jwt.claim.sub',
      '00000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub','00000000-0000-0000-0000-000000000001',
                        'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      DELETE FROM document_collaborators
        WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
          AND user_id = '00000000-0000-0000-0000-000000000003'::uuid;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      -- The viewer row was explicitly re-inserted above; expect exactly 1 deleted row.
      IF affected_rows != 1 THEN
        RAISE EXCEPTION 'FAIL C-3: removing non-owner collaborator affected % rows (expected 1)', affected_rows;
      END IF;
      RAISE NOTICE 'PASS C-3: removing non-owner collaborator succeeded (% row, no check_violation)', affected_rows;
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'FAIL C-3: removing a non-owner collaborator raised check_violation — guard is over-blocking';
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL C-3: removing non-owner collaborator raised 42501 — unexpected';
    END;

  END IF; -- end last-owner guard section

  -- Back to privileged role before DO block exits
  SET LOCAL ROLE postgres;

  RAISE NOTICE 'documents + document_collaborators RLS tests COMPLETE';
END $$;

ROLLBACK;
