-- tests/phase28/rls/02_origin_userId_override.sql
-- Phase 28 Wave 0 RLS test scaffold — verifies the BEFORE INSERT trigger on
-- doc_yjs_updates overrides any client-claimed origin.userId with auth.uid().
--
-- Server-authoritative attribution defends against client spoofing: a malicious
-- client could otherwise insert updates claiming to be from a different user. The
-- trigger function `doc_yjs_updates_validate_origin()` is created by Plan 28-05.
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/02_origin_userId_override.sql
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

-- Skip-guard: trigger function not yet created (Plan 28-05 owns it).
DO $$
DECLARE
  inserted_origin jsonb;
  inserted_user_id text;
  preserved_source text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'doc_yjs_updates_validate_origin') THEN
    RAISE NOTICE 'SKIP: doc_yjs_updates_validate_origin() trigger not yet created (Plan 28-05)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'doc_yjs_updates') THEN
    RAISE NOTICE 'SKIP: doc_yjs_updates not yet created (Plan 27-03)';
    RETURN;
  END IF;

  -- Fixture: test document owned by user 0001
  INSERT INTO documents (id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;

  -- Set JWT to user 0001 (authenticated)
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

  -- Test: INSERT with origin.userId='FAKE-USER' (spoofing attempt) — trigger MUST
  -- override origin.userId to the authenticated user (0001), preserving other keys.
  INSERT INTO doc_yjs_updates (document_id, client_id, seq, update, origin)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      'test-client-spoof',
      1,
      '\x00'::bytea,
      '{
        "userId":"FAKE-USER-99999999",
        "source":"local",
        "deviceId":"Isaiahs-MacBook-Pro.local",
        "sessionId":"test-session-1",
        "clientID":12345
      }'::jsonb
    );

  -- Read back the row's origin and assert userId was overwritten
  SELECT origin INTO inserted_origin FROM doc_yjs_updates
    WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid
      AND client_id = 'test-client-spoof'
      AND seq = 1;
  inserted_user_id := inserted_origin->>'userId';
  preserved_source := inserted_origin->>'source';

  IF inserted_user_id != '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: trigger did not override origin.userId. Expected 00000000-0000-0000-0000-000000000001, got %', inserted_user_id;
  END IF;
  RAISE NOTICE 'PASS: trigger overrode origin.userId to authenticated user (auth.uid())';

  -- Other origin keys must be preserved unchanged
  IF preserved_source != 'local' THEN
    RAISE EXCEPTION 'FAIL: trigger corrupted origin.source. Expected "local", got "%"', preserved_source;
  END IF;
  IF inserted_origin->>'deviceId' != 'Isaiahs-MacBook-Pro.local' THEN
    RAISE EXCEPTION 'FAIL: trigger corrupted origin.deviceId';
  END IF;
  IF inserted_origin->>'sessionId' != 'test-session-1' THEN
    RAISE EXCEPTION 'FAIL: trigger corrupted origin.sessionId';
  END IF;
  IF (inserted_origin->>'clientID')::int != 12345 THEN
    RAISE EXCEPTION 'FAIL: trigger corrupted origin.clientID';
  END IF;
  RAISE NOTICE 'PASS: all other origin keys (source, deviceId, sessionId, clientID) preserved';

  RAISE NOTICE 'origin.userId override tests COMPLETE';
END $$;

ROLLBACK;
