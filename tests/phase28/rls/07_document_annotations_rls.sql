-- tests/phase28/rls/07_document_annotations_rls.sql
-- RLS regression test for public.document_annotations.
--
-- WHAT IS TESTED
-- ─────────────────────────────────────────────────────────────────────────────
-- Policy matrix (ground truth: 20260513010000 + KAL-49 20260522000000):
--
--   SELECT  authenticated  USING  user_can_access_document(document_id, 'viewer')
--   INSERT  authenticated  WITH CHECK  auth.uid() = user_id
--                                 AND user_can_access_document(document_id, 'editor')
--                                 AND NOT kal49_document_is_locked(document_id)
--   UPDATE  authenticated  USING/WITH CHECK
--                              (auth.uid() = user_id AND user_can_access_document(document_id, 'editor'))
--           OR user_can_access_document(document_id, 'owner')
--   DELETE  authenticated  USING
--                              (auth.uid() = user_id AND user_can_access_document(document_id, 'editor'))
--           OR user_can_access_document(document_id, 'owner')
--
-- user_can_access_document resolves owner via documents.user_id directly
-- (20260527130000), so the owner persona (0001) clears the 'owner' branch on
-- UPDATE/DELETE via the documents.user_id fast-path — no collaborator row needed.
--
-- PERSONAS
-- ─────────────────────────────────────────────────────────────────────────────
--   0001 = owner         (documents.user_id — document owner fast-path)
--   0002 = editor        (document_collaborators.role = 'editor', status = 'active')
--   0003 = viewer        (document_collaborators.role = 'viewer', status = 'active')
--   0004 = non-collab    (no row in document_collaborators, not documents.user_id)
--   9999 = test document id
--
-- CRITICAL CORRECTNESS
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS is only exercised when the session runs as the 'authenticated' database
-- role.  Each persona block:
--   1. Drops to `SET LOCAL ROLE authenticated` so policies evaluate.
--   2. Sets BOTH GUCs (request.jwt.claim.sub  AND  request.jwt.claims JSON)
--      because different Supabase/PostgREST versions read different keys.
--   3. Calls `RESET ROLE` before the next persona's privileged fixture work.
--
-- UPDATE/DELETE DENY SEMANTICS:
--   PostgreSQL RLS USING-clause filtering for UPDATE/DELETE silently affects
--   0 rows when the actor cannot see the row — it does NOT raise 42501.
--   42501 is only raised by INSERT WITH CHECK or UPDATE WITH CHECK violations.
--   The deny assertions below use GET DIAGNOSTICS ROW_COUNT and accept either
--   0 rows (USING filtered) or 42501 (WITH CHECK rejected) as PASS — matching
--   the convention in file 05 (A-4, A-5, A-7, A-8, A-10, A-11).
--
-- SELECT-deny = 0 rows returned (no 42501 — RLS silently filters).
-- INSERT-deny = EXCEPTION WHEN insufficient_privilege (SQLSTATE 42501).
--
-- NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- * annotation_id column (not highlight_id — renamed in 20260519010000).
-- * documents.user_id is the owner FK (not created_by — reverted by 20260527130000).
-- * project_id is nullable; not included in fixture INSERT.
-- * The bump triggers (trg_doc_annotations_changed_*) fire SECURITY DEFINER;
--   they have no net effect inside ROLLBACK.
-- * Commenter role was removed by KAL-31 (20260521000000); do not insert commenter fixtures.
-- * Editor UPDATE/DELETE ASYMMETRY: editors can only mutate their OWN rows.
--   An editor attempting to UPDATE another editor's/owner's row gets 0 rows
--   affected (USING clause filters the row invisible), NOT 42501.
-- * Valid annotation_type values (live CHECK after 20260602000000):
--   survey-marker, ink, freetext, square, circle, line, polyline, polygon,
--   stamp, sticky_note, callout, counter, eraser, form-field.
--   NOTE: 'highlight' is NOT valid in the current schema — this test uses
--   'freetext', which is present in every CHECK version since 20260425121704.
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/07_document_annotations_rls.sql
-- IMPORTANT: SUPABASE_TEST_URL must point to the survey-test project, NEVER production.
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  v_count       int;
  v_affected    int;
  v_ann_id      uuid;
  v_ann2_id     uuid;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- SKIP GUARDS — fire if any prerequisite is absent; suite stays GREEN
  -- ══════════════════════════════════════════════════════════════════════════
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document'
  ) THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_annotations'
  ) THEN
    RAISE NOTICE 'SKIP: document_annotations table does not exist';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_collaborators'
  ) THEN
    RAISE NOTICE 'SKIP: document_collaborators table does not exist (helper depends on it)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents'
  ) THEN
    RAISE NOTICE 'SKIP: documents table does not exist (owner FK target)';
    RETURN;
  END IF;

  -- annotation_id column is required by the fixture INSERTs (renamed from
  -- highlight_id in 20260519010000). Guard so an older schema SKIPs cleanly.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_annotations' AND column_name = 'annotation_id'
  ) THEN
    RAISE NOTICE 'SKIP: document_annotations.annotation_id column not yet created (pre-20260519010000)';
    RETURN;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PRIVILEGED FIXTURE SETUP  (runs as superuser / table owner; RLS does not
  -- apply to this role so setup can never be blocked by the policies under test)
  -- ══════════════════════════════════════════════════════════════════════════

  -- auth.users FK guard (mirrors 08): document_collaborators.user_id REFERENCES
  -- auth.users(id); synthetic persona UUIDs have no auth.users row in a bare test DB,
  -- so collaborator fixtures FK-fail (23503). SKIP cleanly when absent (GREEN-OR-SKIPPED);
  -- seed persona auth.users rows + apply the prod RLS schema to run these live.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000002'::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003'::uuid) THEN
    RAISE NOTICE 'SKIP: persona collaborator UUIDs (0002/0003) not in auth.users — document_collaborators FK would fail here';
    RETURN;
  END IF;

  -- Test document owned by persona 0001
  INSERT INTO documents (id, user_id)
    VALUES (
      '99999999-9999-9999-9999-999999999999'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
    ON CONFLICT (id) DO NOTHING;

  -- Collaborators: editor (0002) and viewer (0003)
  -- 0004 is intentionally absent — non-collaborator test persona
  INSERT INTO document_collaborators (document_id, user_id, role, status)
    VALUES
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid,
       'editor', 'active'),
      ('99999999-9999-9999-9999-999999999999'::uuid,
       '00000000-0000-0000-0000-000000000003'::uuid,
       'viewer', 'active')
    ON CONFLICT DO NOTHING;

  -- Pre-seed one annotation authored by the EDITOR (0002) so UPDATE/DELETE
  -- cross-author tests have a target row that the editor owns, and the owner
  -- can also target.
  v_ann_id := gen_random_uuid();
  INSERT INTO document_annotations
        (id, document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
    VALUES (
      v_ann_id,
      '99999999-9999-9999-9999-999999999999'::uuid,
      '00000000-0000-0000-0000-000000000002'::uuid,   -- authored by editor
      'fixture-ann-editor-01',
      'freetext',
      1,
      '{"x":0,"y":0,"width":100,"height":20}'::jsonb,
      '{"color":"yellow"}'::jsonb
    );

  -- Pre-seed a second annotation authored by the OWNER (0001) so we can
  -- verify that the editor CANNOT update/delete annotations they did not author.
  v_ann2_id := gen_random_uuid();
  INSERT INTO document_annotations
        (id, document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
    VALUES (
      v_ann2_id,
      '99999999-9999-9999-9999-999999999999'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,   -- authored by owner
      'fixture-ann-owner-01',
      'freetext',
      1,
      '{"x":0,"y":50,"width":100,"height":20}'::jsonb,
      '{"color":"blue"}'::jsonb
    );

  -- ══════════════════════════════════════════════════════════════════════════
  -- PERSONA 1: OWNER  (documents.user_id = auth.uid())
  -- Expected: SELECT ✓  INSERT ✓  UPDATE any ✓  DELETE any ✓
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',  '00000000-0000-0000-0000-000000000001',
      'role', 'authenticated'
    )::text, true);
  SET LOCAL ROLE authenticated;

  -- Test 01a: Owner SELECT — must return rows
  SELECT count(*) INTO v_count
    FROM document_annotations
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL Test 01a: owner SELECT returned % rows (expected >= 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS Test 01a: owner SELECT returned % annotation row(s)', v_count;

  -- Test 01b: Owner INSERT (inserting as themselves — auth.uid() = user_id required)
  BEGIN
    INSERT INTO document_annotations
          (document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'owner-insert-test-01',
        'freetext',
        2,
        '{"x":10,"y":10,"width":80,"height":15}'::jsonb,
        '{}'::jsonb
      );
    RAISE NOTICE 'PASS Test 01b: owner INSERT succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 01b: owner INSERT was incorrectly rejected (42501)';
  END;

  -- Test 01c: Owner UPDATE of editor's annotation (owner branch — cross-author allowed)
  BEGIN
    UPDATE document_annotations
       SET annotation_data = '{"color":"green","updated_by":"owner"}'::jsonb
     WHERE id = v_ann_id;  -- v_ann_id was authored by editor (0002)
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected != 1 THEN
      RAISE EXCEPTION 'FAIL Test 01c: owner UPDATE of editor annotation affected % rows (expected 1) — owner cross-author branch not exercised', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 01c: owner UPDATE of editor annotation succeeded (owner branch)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 01c: owner UPDATE of editor annotation incorrectly rejected (42501)';
  END;

  -- Test 01d: Owner DELETE of editor's annotation (owner branch — cross-author allowed)
  BEGIN
    DELETE FROM document_annotations WHERE id = v_ann_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected != 1 THEN
      RAISE EXCEPTION 'FAIL Test 01d: owner DELETE of editor annotation affected % rows (expected 1) — owner cross-author branch not exercised', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 01d: owner DELETE of editor annotation succeeded (owner branch)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 01d: owner DELETE of editor annotation incorrectly rejected (42501)';
  END;

  -- Back to privileged for next persona's fixture work
  RESET ROLE;

  -- Re-insert the editor annotation (deleted by 01d above) so later tests have it
  v_ann_id := gen_random_uuid();
  INSERT INTO document_annotations
        (id, document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
    VALUES (
      v_ann_id,
      '99999999-9999-9999-9999-999999999999'::uuid,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'fixture-ann-editor-02',
      'freetext',
      1,
      '{"x":0,"y":0,"width":100,"height":20}'::jsonb,
      '{"color":"yellow"}'::jsonb
    );

  -- ══════════════════════════════════════════════════════════════════════════
  -- PERSONA 2: EDITOR  (document_collaborators.role = 'editor', status = 'active')
  -- Expected: SELECT ✓  INSERT own rows ✓  UPDATE own rows ✓  DELETE own rows ✓
  --           UPDATE other's row → 0 rows affected (USING filters row invisible)
  --           DELETE other's row → 0 rows affected (USING filters row invisible)
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',  '00000000-0000-0000-0000-000000000002',
      'role', 'authenticated'
    )::text, true);
  SET LOCAL ROLE authenticated;

  -- Test 02a: Editor SELECT — must return rows (viewer access check passes for editors)
  SELECT count(*) INTO v_count
    FROM document_annotations
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL Test 02a: editor SELECT returned % rows (expected >= 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS Test 02a: editor SELECT returned % annotation row(s)', v_count;

  -- Test 02b: Editor INSERT as themselves — allowed
  -- annotation_type must be one of the valid CHECK values (see header NOTES).
  BEGIN
    INSERT INTO document_annotations
          (document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        '00000000-0000-0000-0000-000000000002'::uuid,   -- auth.uid() = user_id ✓
        'editor-insert-test-01',
        'freetext',
        3,
        '{"x":5,"y":5,"width":50,"height":10}'::jsonb,
        '{}'::jsonb
      );
    RAISE NOTICE 'PASS Test 02b: editor INSERT (own row) succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 02b: editor INSERT (own row) incorrectly rejected (42501)';
  END;

  -- Test 02c: Editor UPDATE of their OWN annotation — allowed
  -- Use only id in WHERE so RLS alone determines visibility; do not add a user_id
  -- predicate (which would mask a broken USING clause by filtering at the SQL layer).
  BEGIN
    UPDATE document_annotations
       SET annotation_data = '{"color":"orange"}'::jsonb
     WHERE id = v_ann_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected != 1 THEN
      RAISE EXCEPTION 'FAIL Test 02c: editor UPDATE of own annotation affected % rows (expected 1)', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 02c: editor UPDATE of own annotation succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 02c: editor UPDATE of own annotation incorrectly rejected (42501)';
  END;

  -- Test 02d: Editor DELETE of their OWN annotation — allowed
  BEGIN
    DELETE FROM document_annotations WHERE id = v_ann_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected != 1 THEN
      RAISE EXCEPTION 'FAIL Test 02d: editor DELETE of own annotation affected % rows (expected 1)', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 02d: editor DELETE of own annotation succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FAIL Test 02d: editor DELETE of own annotation incorrectly rejected (42501)';
  END;

  -- Test 02e: Editor UPDATE of OWNER's annotation (v_ann2_id) — MUST be blocked.
  -- The RLS USING clause filters rows the actor cannot mutate. For UPDATE this
  -- produces 0 affected rows (not 42501) when the row is invisible to the editor
  -- branch. The editor branch requires auth.uid() = user_id; v_ann2_id.user_id =
  -- 0001 ≠ 0002. The owner branch requires user_can_access_document(doc,'owner');
  -- editor does not qualify. Accept 0 rows or 42501 as PASS.
  BEGIN
    UPDATE document_annotations
       SET annotation_data = '{"color":"red","tampered_by":"editor"}'::jsonb
     WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 02e: editor UPDATE of owner annotation affected % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 02e: editor UPDATE of owner annotation blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 02e: editor UPDATE of owner annotation correctly rejected (42501)';
  END;

  -- Test 02f: Editor DELETE of OWNER's annotation (v_ann2_id) — MUST be blocked.
  -- Same USING-clause silent-filter semantics as 02e.
  BEGIN
    DELETE FROM document_annotations WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 02f: editor DELETE of owner annotation affected % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 02f: editor DELETE of owner annotation blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 02f: editor DELETE of owner annotation correctly rejected (42501)';
  END;

  -- Back to privileged for next persona's fixture work
  RESET ROLE;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PERSONA 3: VIEWER  (document_collaborators.role = 'viewer', status = 'active')
  -- Expected: SELECT ✓  INSERT → 42501  UPDATE → 0 rows  DELETE → 0 rows
  -- INSERT raises 42501 (WITH CHECK violation). UPDATE/DELETE are blocked silently
  -- via USING (0 rows): the viewer can see the row via SELECT but cannot pass the
  -- editor/owner USING predicates.
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',  '00000000-0000-0000-0000-000000000003',
      'role', 'authenticated'
    )::text, true);
  SET LOCAL ROLE authenticated;

  -- Test 03a: Viewer SELECT — must return rows (viewer policy passes)
  SELECT count(*) INTO v_count
    FROM document_annotations
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL Test 03a: viewer SELECT returned % rows (expected >= 1)', v_count;
  END IF;
  RAISE NOTICE 'PASS Test 03a: viewer SELECT returned % annotation row(s)', v_count;

  -- Test 03b: Viewer INSERT — MUST be denied (42501)
  -- user_can_access_document(doc,'editor') returns FALSE for role='viewer'.
  -- INSERT WITH CHECK violation raises 42501.
  BEGIN
    INSERT INTO document_annotations
          (document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        '00000000-0000-0000-0000-000000000003'::uuid,
        'viewer-insert-attempt-01',
        'freetext',
        1,
        '{"x":0,"y":0,"width":50,"height":10}'::jsonb,
        '{}'::jsonb
      );
    RAISE EXCEPTION 'FAIL Test 03b: viewer INSERT should have been rejected (42501) but succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 03b: viewer INSERT correctly rejected (42501)';
  END;

  -- Test 03c: Viewer UPDATE — MUST be blocked.
  -- The UPDATE USING clause requires editor or owner access; viewer satisfies neither.
  -- PostgreSQL silently produces 0 rows affected (USING filter), not 42501.
  BEGIN
    UPDATE document_annotations
       SET annotation_data = '{"tampered_by":"viewer"}'::jsonb
     WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 03c: viewer UPDATE affected % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 03c: viewer UPDATE blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 03c: viewer UPDATE correctly rejected (42501)';
  END;

  -- Test 03d: Viewer DELETE — MUST be blocked (same USING-filter semantics).
  BEGIN
    DELETE FROM document_annotations WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 03d: viewer DELETE removed % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 03d: viewer DELETE blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 03d: viewer DELETE correctly rejected (42501)';
  END;

  -- Back to privileged
  RESET ROLE;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PERSONA 4: NON-COLLABORATOR  (no row in document_collaborators; not owner)
  -- Expected: SELECT → 0 rows (silent filter, no 42501)
  --           INSERT → 42501 (WITH CHECK violation)
  --           UPDATE → 0 rows (USING filter, not 42501)
  --           DELETE → 0 rows (USING filter, not 42501)
  -- ══════════════════════════════════════════════════════════════════════════

  PERFORM set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',  '00000000-0000-0000-0000-000000000004',
      'role', 'authenticated'
    )::text, true);
  SET LOCAL ROLE authenticated;

  -- Test 04a: Non-collaborator SELECT — must return 0 rows (silent RLS filter)
  SELECT count(*) INTO v_count
    FROM document_annotations
   WHERE document_id = '99999999-9999-9999-9999-999999999999'::uuid;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'FAIL Test 04a: non-collaborator SELECT returned % rows (expected 0) — RLS SELECT leak', v_count;
  END IF;
  RAISE NOTICE 'PASS Test 04a: non-collaborator SELECT returned 0 rows (silent RLS filter)';

  -- Test 04b: Non-collaborator INSERT — MUST be denied (42501)
  -- INSERT WITH CHECK: user_can_access_document(doc,'editor') is FALSE → 42501.
  BEGIN
    INSERT INTO document_annotations
          (document_id, user_id, annotation_id, annotation_type, page_number, bounds, annotation_data)
      VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        '00000000-0000-0000-0000-000000000004'::uuid,
        'non-collab-insert-attempt-01',
        'freetext',
        1,
        '{"x":0,"y":0,"width":50,"height":10}'::jsonb,
        '{}'::jsonb
      );
    RAISE EXCEPTION 'FAIL Test 04b: non-collaborator INSERT should have been rejected (42501) but succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 04b: non-collaborator INSERT correctly rejected (42501)';
  END;

  -- Test 04c: Non-collaborator UPDATE — MUST be blocked.
  -- The non-collaborator cannot see the row at all (SELECT policy → 0 rows).
  -- UPDATE USING clause also filters it out → 0 rows affected, not 42501.
  BEGIN
    UPDATE document_annotations
       SET annotation_data = '{"tampered_by":"non-collab"}'::jsonb
     WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 04c: non-collaborator UPDATE affected % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 04c: non-collaborator UPDATE blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 04c: non-collaborator UPDATE correctly rejected (42501)';
  END;

  -- Test 04d: Non-collaborator DELETE — MUST be blocked.
  BEGIN
    DELETE FROM document_annotations WHERE id = v_ann2_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      RAISE EXCEPTION 'FAIL Test 04d: non-collaborator DELETE removed % rows (expected 0) — RLS leak', v_affected;
    END IF;
    RAISE NOTICE 'PASS Test 04d: non-collaborator DELETE blocked by RLS (0 rows affected)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS Test 04d: non-collaborator DELETE correctly rejected (42501)';
  END;

  -- Back to privileged
  RESET ROLE;

  RAISE NOTICE 'document_annotations RLS tests COMPLETE';
END $$;

ROLLBACK;
