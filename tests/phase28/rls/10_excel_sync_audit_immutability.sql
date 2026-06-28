-- tests/phase28/rls/10_excel_sync_audit_immutability.sql
-- KAL-309 RLS regression test — excel_sync_audit append-only immutability.
--
-- FOCUS:
--   1. The immutability trigger (excel_sync_audit_no_update_delete) must reject
--      UPDATE and DELETE against any audit row unconditionally, including when the
--      caller is a privileged superuser / table-owner role.
--   2. Authenticated callers (owner, editor, viewer, non-collaborator) cannot
--      SELECT, INSERT, UPDATE, or DELETE audit rows directly — REVOKE ALL FROM
--      authenticated is the gate. Every operation raises 42501.
--   3. There is no client-INSERT path, so actor-id forgery is architecturally
--      impossible; the test confirms the 42501 on direct INSERT proves this.
--
-- GROUND TRUTH (20260625120000 + 20260626150000):
--   excel_sync_audit.actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL  (F22: NULLABLE)
--   excel_sync_audit.marker_annotation_id  TEXT (changed UUID -> TEXT in 20260626150000; nullable)
--   kal309_audit_immutable(): BEFORE UPDATE/DELETE; RAISE EXCEPTION
--     'excel_sync_audit is append-only (% blocked)' — NO explicit ERRCODE, so the
--     SQLSTATE is P0001 (condition name 'raise_exception'), NOT check_violation (23514).
--   REVOKE ALL ON excel_sync_audit FROM authenticated, anon — so every authenticated
--     SELECT/INSERT/UPDATE/DELETE raises 42501 (insufficient_privilege), not a silent
--     0-row filter.
--   IMPORTANT: actor_id MUST be NULL in fixtures — supplying a synthetic UUID that
--     does not exist in auth.users would FK-fail (23503) and abort the whole DO block.
--
-- CRITICAL CORRECTNESS: each persona block sets BOTH jwt settings and then
-- SET LOCAL ROLE authenticated so RLS + REVOKE apply. Privileged fixture work
-- runs after RESET ROLE. The immutability trigger tests run as the table owner
-- (superuser) to prove the trigger is unconditional (not role-gated).
--
-- ADVERSARIAL FIXES applied:
--   FIX-1: actor_id is NULL in every fixture INSERT (F22) — avoids the auth.users
--           FK violation that would abort the test before any assertion runs.
--   FIX-2: the immutability-trigger exception handlers catch WHEN raise_exception
--           (SQLSTATE P0001) and verify the message, NOT WHEN OTHERS — so a stray
--           42501 or unrelated error cannot produce a false PASS.
--   FIX-3: removed the spurious kal308_apply_changeset() skip guard — the test
--           issues direct SQL only and never calls that RPC; gating on it would
--           cause false SKIPs when the table+trigger exist but the RPC does not.
--   FIX-4: document_collaborators fixture includes status='active' with the named
--           ON CONFLICT (document_id, user_id) target, matching file 05.
--
-- Persona UUIDs: 0001 owner, 0002 editor, 0003 viewer, 0004 non-collaborator, 9999 doc id.
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/10_excel_sync_audit_immutability.sql
-- IMPORTANT: SUPABASE_TEST_URL must point to the survey-test project, NEVER production.
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  v_audit_id  UUID;
  v_row_count INT;
BEGIN

  -- ==========================================================================
  -- Skip-guards: all preconditions must be met or we report SKIP and exit.
  -- ==========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'excel_sync_audit'
  ) THEN
    RAISE NOTICE 'SKIP: excel_sync_audit not yet created (KAL-309)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'kal309_audit_immutable'
  ) THEN
    RAISE NOTICE 'SKIP: kal309_audit_immutable() trigger function not yet created (KAL-309)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'excel_sync_audit'
      AND trigger_name = 'excel_sync_audit_no_update_delete'
  ) THEN
    RAISE NOTICE 'SKIP: excel_sync_audit_no_update_delete trigger not installed';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents'
  ) THEN
    RAISE NOTICE 'SKIP: documents table not yet created';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_collaborators'
  ) THEN
    RAISE NOTICE 'SKIP: document_collaborators table not yet created';
    RETURN;
  END IF;

  -- NOTE: kal308_apply_changeset() is NOT a precondition — this test exercises
  -- direct SQL on excel_sync_audit, never calls the RPC. Guarding on it would
  -- cause false SKIPs when the table + trigger exist but the RPC is not deployed.

  -- ==========================================================================
  -- Fixture setup — privileged role (RLS does not apply here).
  -- Persona UUIDs:
  --   0001 = owner, 0002 = editor, 0003 = viewer, 0004 = non-collaborator
  --   9999...  = test document id
  -- ==========================================================================
  RESET ROLE;

  -- auth.users FK guard (mirrors 08): document_collaborators.user_id REFERENCES
  -- auth.users(id); synthetic persona UUIDs have no auth.users row in a bare test DB,
  -- so collaborator fixtures FK-fail (23503). SKIP cleanly when absent (GREEN-OR-SKIPPED);
  -- seed persona auth.users rows + apply the prod RLS schema to run these live.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003'::uuid) THEN
    RAISE NOTICE 'SKIP: persona collaborator UUIDs (0002/0003) not in auth.users — document_collaborators FK would fail here';
    RETURN;
  END IF;

  INSERT INTO public.documents (id, user_id)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    ON CONFLICT (id) DO NOTHING;

  -- status='active' is required by user_can_access_document (WHERE status='active').
  -- Named conflict target matches the pattern established in 05_documents_rls.sql.
  INSERT INTO public.document_collaborators (document_id, user_id, role, status)
    VALUES
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid, 'editor', 'active'),
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000003'::uuid, 'viewer', 'active')
    ON CONFLICT (document_id, user_id) DO NOTHING;

  -- Seed one audit row as the privileged caller (simulates what the SECURITY
  -- DEFINER apply RPC does). This row is the target for all immutability tests.
  -- actor_id is NULL: the column is UUID NULL per design anchor F22 (REFERENCES
  -- auth.users ON DELETE SET NULL). A synthetic test UUID would not exist in
  -- auth.users and would FK-fail (23503), aborting the DO block before any test.
  -- marker_annotation_id is TEXT (20260626150000), nullable.
  INSERT INTO public.excel_sync_audit (
    document_id, template_id, workbook_generation, actor_id,
    capability_tier, client_change_set_id, marker_annotation_id, row_outcome, device_hint
  ) VALUES (
    '99999999-9999-9999-9999-999999999999'::uuid,
    'tpl-test-001',
    1,
    NULL,           -- actor_id nullable (F22); test UUIDs do not exist in auth.users
    'standard',
    'cs-test-001',
    NULL,           -- change-set-level row; marker_annotation_id is TEXT, nullable
    'applied',
    'test-device'
  )
  RETURNING id INTO v_audit_id;

  RAISE NOTICE 'Fixture: seeded audit row id=%', v_audit_id;

  -- ==========================================================================
  -- BLOCK 1 — Immutability trigger: UPDATE blocked even for superuser/owner
  -- ==========================================================================
  -- The trigger is NOT SECURITY DEFINER-bypassed and the RAISE EXCEPTION is
  -- unconditional, so even the table owner cannot UPDATE a row.
  --
  -- FIX-2: catch WHEN raise_exception (P0001) instead of WHEN OTHERS. WHEN OTHERS
  -- would catch 42501 or any other error and risk a false PASS. The trigger raises
  -- RAISE EXCEPTION (P0001) 'excel_sync_audit is append-only (UPDATE blocked)'.
  RESET ROLE;  -- ensure we are running as the privileged superuser

  BEGIN
    UPDATE public.excel_sync_audit
      SET device_hint = 'tampered'
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 1a: superuser UPDATE of audit row should have been blocked by immutability trigger';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%append-only%' OR SQLERRM LIKE '%excel_sync_audit%' THEN
        RAISE NOTICE
          'PASS Test 1a: superuser UPDATE blocked by immutability trigger (%)', SQLERRM;
      ELSE
        RAISE EXCEPTION
          'FAIL Test 1a: RAISE EXCEPTION fired but message does not match trigger: %', SQLERRM;
      END IF;
  END;

  -- ==========================================================================
  -- BLOCK 2 — Immutability trigger: DELETE blocked even for superuser/owner
  -- ==========================================================================
  RESET ROLE;

  BEGIN
    DELETE FROM public.excel_sync_audit
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 1b: superuser DELETE of audit row should have been blocked by immutability trigger';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%append-only%' OR SQLERRM LIKE '%excel_sync_audit%' THEN
        RAISE NOTICE
          'PASS Test 1b: superuser DELETE blocked by immutability trigger (%)', SQLERRM;
      ELSE
        RAISE EXCEPTION
          'FAIL Test 1b: RAISE EXCEPTION fired but message does not match trigger: %', SQLERRM;
      END IF;
  END;

  -- Verify the row still exists (neither attempt above persisted a mutation).
  RESET ROLE;
  SELECT COUNT(*) INTO v_row_count
    FROM public.excel_sync_audit WHERE id = v_audit_id;
  IF v_row_count != 1 THEN
    RAISE EXCEPTION
      'FAIL Test 1c: audit row count after blocked UPDATE+DELETE = % (expected 1)', v_row_count;
  END IF;
  RAISE NOTICE 'PASS Test 1c: audit row survives blocked superuser UPDATE and DELETE (count=1)';

  -- ==========================================================================
  -- BLOCK 3 — Owner (0001) cannot SELECT (REVOKE ALL → 42501, not silent 0 rows)
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    SELECT COUNT(*) INTO v_row_count
      FROM public.excel_sync_audit
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
    RAISE EXCEPTION
      'FAIL Test 2a: owner SELECT should have raised 42501 (REVOKE ALL FROM authenticated)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 2a: owner SELECT raises 42501 (REVOKE ALL FROM authenticated confirmed)';
  END;

  -- ==========================================================================
  -- BLOCK 4 — Owner (0001) cannot INSERT directly (actor forgery path closed)
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.excel_sync_audit (
      document_id, template_id, workbook_generation, actor_id,
      capability_tier, client_change_set_id, marker_annotation_id, row_outcome
    ) VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'tpl-forge-owner',
      99,
      NULL,          -- actor_id NULL (the 42501 fires before any FK check anyway)
      'standard',
      'cs-forge-001',
      NULL,
      'applied'
    );
    RAISE EXCEPTION
      'FAIL Test 2b: owner direct INSERT should have raised 42501 (no client INSERT path — actor forgery impossible)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 2b: owner direct INSERT raises 42501 (forging actor_id via direct INSERT is impossible)';
  END;

  -- ==========================================================================
  -- BLOCK 5 — Owner (0001) cannot UPDATE directly
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE public.excel_sync_audit
      SET device_hint = 'owner-tamper'
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 2c: owner UPDATE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 2c: owner UPDATE raises 42501 (REVOKE ALL FROM authenticated)';
  END;

  -- ==========================================================================
  -- BLOCK 6 — Owner (0001) cannot DELETE directly
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM public.excel_sync_audit WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 2d: owner DELETE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 2d: owner DELETE raises 42501 (REVOKE ALL FROM authenticated)';
  END;

  -- ==========================================================================
  -- BLOCK 7 — Editor (0002): SELECT, INSERT, UPDATE, DELETE all raise 42501
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    SELECT COUNT(*) INTO v_row_count
      FROM public.excel_sync_audit
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
    RAISE EXCEPTION
      'FAIL Test 3a: editor SELECT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 3a: editor SELECT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.excel_sync_audit (
      document_id, template_id, workbook_generation,
      capability_tier, client_change_set_id, row_outcome
    ) VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'tpl-forge-editor', 2, 'standard', 'cs-forge-002', 'applied'
    );
    RAISE EXCEPTION
      'FAIL Test 3b: editor direct INSERT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 3b: editor direct INSERT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE public.excel_sync_audit
      SET device_hint = 'editor-tamper'
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 3c: editor UPDATE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 3c: editor UPDATE raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM public.excel_sync_audit WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 3d: editor DELETE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 3d: editor DELETE raises 42501';
  END;

  -- ==========================================================================
  -- BLOCK 8 — Viewer (0003): SELECT, INSERT, UPDATE, DELETE all raise 42501
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    SELECT COUNT(*) INTO v_row_count
      FROM public.excel_sync_audit
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
    RAISE EXCEPTION
      'FAIL Test 4a: viewer SELECT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 4a: viewer SELECT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.excel_sync_audit (
      document_id, template_id, workbook_generation,
      capability_tier, client_change_set_id, row_outcome
    ) VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'tpl-forge-viewer', 3, 'standard', 'cs-forge-003', 'applied'
    );
    RAISE EXCEPTION
      'FAIL Test 4b: viewer direct INSERT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 4b: viewer direct INSERT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE public.excel_sync_audit
      SET device_hint = 'viewer-tamper'
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 4c: viewer UPDATE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 4c: viewer UPDATE raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000003','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM public.excel_sync_audit WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 4d: viewer DELETE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 4d: viewer DELETE raises 42501';
  END;

  -- ==========================================================================
  -- BLOCK 9 — Non-collaborator (0004): SELECT, INSERT, UPDATE, DELETE all raise 42501
  -- ==========================================================================
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    SELECT COUNT(*) INTO v_row_count
      FROM public.excel_sync_audit
     WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
    RAISE EXCEPTION
      'FAIL Test 5a: non-collaborator SELECT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 5a: non-collaborator SELECT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.excel_sync_audit (
      document_id, template_id, workbook_generation,
      capability_tier, client_change_set_id, row_outcome
    ) VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'tpl-forge-noncollab', 4, 'standard', 'cs-forge-004', 'applied'
    );
    RAISE EXCEPTION
      'FAIL Test 5b: non-collaborator direct INSERT should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 5b: non-collaborator direct INSERT raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE public.excel_sync_audit
      SET device_hint = 'noncollab-tamper'
    WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 5c: non-collaborator UPDATE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 5c: non-collaborator UPDATE raises 42501';
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000004','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM public.excel_sync_audit WHERE id = v_audit_id;
    RAISE EXCEPTION
      'FAIL Test 5d: non-collaborator DELETE should have raised 42501';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 5d: non-collaborator DELETE raises 42501';
  END;

  -- ==========================================================================
  -- BLOCK 10 — Privileged INSERT is allowed (trigger does not block INSERT)
  -- ==========================================================================
  -- Confirm that the immutability trigger fires ONLY on UPDATE/DELETE, not on
  -- INSERT. The apply RPC's superuser-context INSERT must succeed.
  RESET ROLE;

  DECLARE
    v_second_id UUID;
  BEGIN
    INSERT INTO public.excel_sync_audit (
      document_id, template_id, workbook_generation, actor_id,
      capability_tier, client_change_set_id, marker_annotation_id, row_outcome, device_hint
    ) VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'tpl-test-002',
      2,
      NULL,           -- actor_id NULL (F22: no auth.users row in test env)
      'standard',
      'cs-test-002',
      'annotation-id-text-value',    -- TEXT column (not UUID); exercising non-NULL path
      'applied',
      'test-device-2'
    )
    RETURNING id INTO v_second_id;
    RAISE NOTICE 'PASS Test 6a: privileged INSERT succeeds (trigger does not block INSERT), id=%', v_second_id;
  END;

  -- ==========================================================================
  -- BLOCK 11 — Sanity: audit row count unchanged by all blocked client attempts
  -- ==========================================================================
  RESET ROLE;
  SELECT COUNT(*) INTO v_row_count
    FROM public.excel_sync_audit
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF v_row_count != 2 THEN
    RAISE EXCEPTION
      'FAIL Test 6b: expected 2 audit rows after all blocked client attempts, found %', v_row_count;
  END IF;
  RAISE NOTICE 'PASS Test 6b: audit row count is 2 — no spurious mutations escaped (all client attempts blocked)';

  RAISE NOTICE 'excel_sync_audit immutability tests COMPLETE';

END $$;

ROLLBACK;
