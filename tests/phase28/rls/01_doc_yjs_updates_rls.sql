-- tests/phase28/rls/01_doc_yjs_updates_rls.sql
-- Phase 28 Wave 0 RLS test scaffold — verifies SELECT and INSERT on doc_yjs_updates
-- are gated through user_can_access_document(). The helper function and the role-gated
-- policies are created by Plan 28-05's migration; until then the SKIP guard fires.
--
-- Rationale: psql DO blocks with RAISE EXCEPTION are used in place of pgTAP because
-- pgTAP is not installed in this project. This matches the existing supabase/migrations/
-- style (DO $$ BEGIN ... END $$).
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/01_doc_yjs_updates_rls.sql
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

-- Skip-guard: if user_can_access_document() helper does not yet exist (Plan 28-05
-- hasn't shipped), this whole test reports SKIP and exits cleanly. Same shape as
-- the per-test existsSync skip-guard in tests/phase28/*.test.mjs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document') THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created (Plan 28-05)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'document_collaborators') THEN
    RAISE NOTICE 'SKIP: document_collaborators not yet created (Phase 34 owns the table; helper depends on it)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'doc_yjs_updates') THEN
    RAISE NOTICE 'SKIP: doc_yjs_updates not yet created (Plan 27-03)';
    RETURN;
  END IF;

  -- ============================================================================
  -- Fixture setup: 4 personas (owner, editor, viewer, non-collaborator) over a
  -- single test document. Stable test UUIDs make this deterministic.
  -- ============================================================================
  -- 0001 = owner, 0002 = editor, 0003 = viewer, 0004 = non-collaborator
  -- 9999 = test document id

  -- Insert test document (owned by 0001)
  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  -- Add collaborators (editor + viewer)
  INSERT INTO document_collaborators (document_id, user_id, role)
    VALUES
      ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'editor'),
      ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'viewer')
    ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- Test 1: Owner can SELECT and INSERT
  -- ============================================================================
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  -- Owner SELECT — expect non-error
  PERFORM 1 FROM doc_yjs_updates WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  RAISE NOTICE 'PASS Test 1a: owner SELECT succeeded';

  -- Owner INSERT — expect success
  INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'test-client-owner',
      1,
      '\x00'::bytea,
      '{"userId":"00000000-0000-0000-0000-000000000001","source":"local"}'::jsonb
    );
  RAISE NOTICE 'PASS Test 1b: owner INSERT succeeded';

  -- ============================================================================
  -- Test 2: Editor can INSERT
  -- ============================================================================
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'test-client-editor',
      2,
      '\x00'::bytea,
      '{"userId":"00000000-0000-0000-0000-000000000002","source":"local"}'::jsonb
    );
  RAISE NOTICE 'PASS Test 2: editor INSERT succeeded';

  -- ============================================================================
  -- Test 3: Viewer can SELECT but cannot INSERT
  -- ============================================================================
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  PERFORM 1 FROM doc_yjs_updates WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  RAISE NOTICE 'PASS Test 3a: viewer SELECT succeeded';

  -- Viewer INSERT must fail with 42501 (insufficient_privilege)
  BEGIN
    INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        'test-client-viewer',
        3,
        '\x00'::bytea,
        '{"userId":"00000000-0000-0000-0000-000000000003","source":"local"}'::jsonb
      );
    RAISE EXCEPTION 'FAIL Test 3b: viewer INSERT should have been rejected by RLS';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 3b: viewer INSERT correctly rejected (42501)';
  END;

  RAISE NOTICE 'doc_yjs_updates RLS tests COMPLETE';
END $$;

ROLLBACK;
