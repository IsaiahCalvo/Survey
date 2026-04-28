-- tests/phase28/rls/04_select_gated_viewer.sql
-- Phase 28 Wave 0 RLS test scaffold — verifies SELECT on doc_yjs_updates is
-- denied for non-viewer JWTs. RLS silently filters non-matching rows, so the
-- assertion is on row count (must be zero), not on an exception.
--
-- This is important because a malicious client can attempt to enumerate other
-- users' documents by issuing SELECT queries; RLS on the SELECT policy must
-- ensure they see zero rows even if they know the document_id.
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/04_select_gated_viewer.sql
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  visible_rows int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document') THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created (Plan 28-05)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'document_collaborators') THEN
    RAISE NOTICE 'SKIP: document_collaborators not yet created (helper depends on it)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'doc_yjs_updates') THEN
    RAISE NOTICE 'SKIP: doc_yjs_updates not yet created (Plan 27-03)';
    RETURN;
  END IF;

  -- Fixture: doc owned by 0001, with 0003 as a viewer collaborator
  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO document_collaborators (document_id, user_id, role)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'viewer')
    ON CONFLICT DO NOTHING;

  -- Insert one update row as the owner so there's something to filter
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'test-client-owner',
      1,
      '\x00'::bytea,
      '{"userId":"00000000-0000-0000-0000-000000000001","source":"local"}'::jsonb
    );

  -- Switch to a non-collaborator JWT (0004) and SELECT
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  SELECT count(*) INTO visible_rows FROM doc_yjs_updates
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF visible_rows != 0 THEN
    RAISE EXCEPTION 'FAIL: non-viewer SELECT returned % rows (expected 0) — RLS leak detected', visible_rows;
  END IF;
  RAISE NOTICE 'PASS: non-viewer SELECT returned 0 rows (RLS silently filtered as expected)';

  -- Sanity check: same query as actual viewer (0003) should return 1 row
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  SELECT count(*) INTO visible_rows FROM doc_yjs_updates
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;

  IF visible_rows < 1 THEN
    RAISE EXCEPTION 'FAIL: viewer SELECT returned % rows (expected >= 1) — viewer cannot see updates they should', visible_rows;
  END IF;
  RAISE NOTICE 'PASS: viewer SELECT returned % rows (viewer sees the update they''re entitled to)', visible_rows;

  RAISE NOTICE 'SELECT-gated-by-viewer tests COMPLETE';
END $$;

ROLLBACK;
