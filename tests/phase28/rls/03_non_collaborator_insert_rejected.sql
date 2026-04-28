-- tests/phase28/rls/03_non_collaborator_insert_rejected.sql
-- Phase 28 Wave 0 RLS test scaffold — verifies a non-collaborator JWT cannot
-- INSERT into doc_yjs_updates. The RLS WITH CHECK clause on the INSERT policy
-- runs user_can_access_document(doc_id, 'editor') and rejects non-collaborators
-- with Postgres error code 42501 (insufficient_privilege).
--
-- This is the "kicked-out collaborator" path: when the owner revokes a user
-- from document_collaborators, that user's JWT no longer satisfies the policy
-- and any subsequent CRDT update insert is hard-blocked at write-time. The
-- application layer then catches the 42501 and emits the `update_rejected`
-- event over the live channel (kick UX banner).
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/03_non_collaborator_insert_rejected.sql
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document') THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created (Plan 28-05)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'doc_yjs_updates') THEN
    RAISE NOTICE 'SKIP: doc_yjs_updates not yet created (Plan 27-03)';
    RETURN;
  END IF;

  -- Fixture: test document owned by user 0001 (no collaborators)
  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  -- Switch JWT to user 0004 (NOT a collaborator on this doc)
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

  -- Attempt INSERT — must be rejected with 42501
  BEGIN
    INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        'test-client-non-collab',
        1,
        '\x00'::bytea,
        '{"userId":"00000000-0000-0000-0000-000000000004","source":"local"}'::jsonb
      );
    RAISE EXCEPTION 'FAIL: non-collaborator INSERT should have been rejected by RLS — kick UX path is broken';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: non-collaborator INSERT correctly rejected (42501) — kick UX path verified';
  END;

  RAISE NOTICE 'non-collaborator INSERT rejection tests COMPLETE';
END $$;

ROLLBACK;
