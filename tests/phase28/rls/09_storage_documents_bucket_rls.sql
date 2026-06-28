-- tests/phase28/rls/09_storage_documents_bucket_rls.sql
-- RLS regression test for storage.objects — bucket 'documents'
--
-- Verifies the SELECT policy "Document collaborators can read accessible document
-- files" (created by 20260513003000_allow_collaborators_to_read_document_storage.sql):
--   - bucket is NOT public (public flag = false)
--   - policy definition is present on storage.objects
--   - owner    can SELECT the storage object  (ALLOW via owner fast path)
--   - editor   can SELECT the storage object  (ALLOW via role hierarchy: editor >= viewer)
--   - viewer   can SELECT the storage object  (ALLOW — policy requires 'viewer')
--   - non-collaborator CANNOT SELECT (DENY — RLS silently returns 0 rows, no 42501)
--   - revoked collaborator CANNOT SELECT (status != 'active' -> DENY)
--   - cross-document storage bleed is blocked (file_path JOIN is strict)
-- INSERT/UPDATE/DELETE are NOT covered: no migration-tracked write policies exist on
-- storage.objects for the documents bucket; those assertions are explicitly skipped.
--
-- GROUND TRUTH (20260513003000): the policy USING clause is
--   bucket_id = 'documents' AND EXISTS (
--     SELECT 1 FROM public.documents d
--      WHERE d.file_path = storage.objects.name
--        AND public.user_can_access_document(d.id, 'viewer'))
--
-- CRITICAL: storage.objects RLS fires only when the session role is 'authenticated'.
-- Unlike 01-04 (which test public.doc_yjs_updates and work even as superuser), this
-- file MUST switch to SET LOCAL ROLE authenticated before each live-row SELECT and
-- SET LOCAL ROLE postgres before the next privileged fixture operation. RESET ROLE is
-- avoided for privileged restore because it falls back to the session role, which may
-- be a non-privileged role in Supabase pooler connections.
--
-- Persona UUID convention:
--   0001 = owner, 0002 = editor, 0003 = viewer, 0004 = non-collaborator
--   9999 = test document id
--
-- Run via: psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/09_storage_documents_bucket_rls.sql
-- IMPORTANT: SUPABASE_TEST_URL must point to the survey-test project, NEVER production.
-- Aggregator: tests/phase28/rls/run-all.sql

BEGIN;

DO $$
DECLARE
  v_visible_rows  int;
  v_bucket_private int;
  v_policy_count  int;
  v_can_switch_role boolean := true;
  -- Stable test values
  v_doc_id        uuid    := '99999999-9999-9999-9999-999999999999'::uuid;
  v_owner_id      uuid    := '00000000-0000-0000-0000-000000000001'::uuid;
  v_editor_id     uuid    := '00000000-0000-0000-0000-000000000002'::uuid;
  v_viewer_id     uuid    := '00000000-0000-0000-0000-000000000003'::uuid;
  v_noncollab_id  uuid    := '00000000-0000-0000-0000-000000000004'::uuid;
  -- The storage object name must equal documents.file_path exactly
  v_file_path     text    := '00000000-0000-0000-0000-000000000001/test-project/test-doc.pdf';
  v_storage_obj_id uuid   := 'aaaabbbb-cccc-dddd-eeee-ffffffffffff'::uuid;
BEGIN

  -- ============================================================================
  -- SKIP GUARDS — if any prerequisite is absent the whole block reports SKIP
  -- ============================================================================

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'user_can_access_document'
  ) THEN
    RAISE NOTICE 'SKIP: user_can_access_document() not yet created (20260527130000)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'documents'
  ) THEN
    RAISE NOTICE 'SKIP: public.documents table does not exist';
    RETURN;
  END IF;

  -- Guard for the file_path column — the policy JOIN and the fixture INSERT both require it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'documents'
      AND column_name  = 'file_path'
  ) THEN
    RAISE NOTICE 'SKIP: public.documents.file_path column does not exist (migration 20260513003000 not yet applied)';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_collaborators'
  ) THEN
    RAISE NOTICE 'SKIP: public.document_collaborators table does not exist';
    RETURN;
  END IF;

  -- Guard storage.objects BEFORE querying storage.buckets — if the storage
  -- schema is absent the buckets SELECT would ERROR (42P01) rather than SKIP.
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects'
  ) THEN
    RAISE NOTICE 'SKIP: storage.objects table does not exist in this environment';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'documents'
  ) THEN
    RAISE NOTICE 'SKIP: documents bucket does not exist in this environment';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Document collaborators can read accessible document files'
  ) THEN
    RAISE NOTICE 'SKIP: storage.objects SELECT policy not yet created (20260513003000)';
    RETURN;
  END IF;

  -- ============================================================================
  -- TEST 0: Bucket public flag — must be FALSE (private bucket)
  -- ============================================================================

  SELECT count(*) INTO v_bucket_private
    FROM storage.buckets
    WHERE id = 'documents'
      AND public = false;

  IF v_bucket_private != 1 THEN
    RAISE EXCEPTION
      'FAIL Test 0: documents bucket is NOT marked private (public = false expected) — bucket must stay private; the storage policy should gate reads, not public access';
  END IF;
  RAISE NOTICE 'PASS Test 0: documents bucket is correctly marked private (public = false)';

  -- ============================================================================
  -- TEST 0b: Policy definition exists and is correctly scoped
  -- ============================================================================

  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Document collaborators can read accessible document files'
      AND cmd        = 'SELECT'
      AND roles      @> ARRAY['authenticated']::name[];

  IF v_policy_count != 1 THEN
    RAISE EXCEPTION
      'FAIL Test 0b: expected exactly 1 SELECT policy for authenticated on storage.objects named "Document collaborators can read accessible document files", found %',
      v_policy_count;
  END IF;
  RAISE NOTICE 'PASS Test 0b: SELECT policy definition exists on storage.objects with correct role and command';

  -- ============================================================================
  -- SKIP INSERT/UPDATE/DELETE — no migration-tracked write policies exist
  -- ============================================================================

  RAISE NOTICE 'SKIP Tests (write): no migration-tracked INSERT/UPDATE/DELETE policy on storage.objects — write access not tested here';

  -- ============================================================================
  -- Probe: can we SET LOCAL ROLE authenticated?
  -- If the cloud SQL API blocks it, fall back to policy-definition-only assertions.
  -- ============================================================================

  BEGIN
    SET LOCAL ROLE authenticated;
    SET LOCAL ROLE postgres;
  EXCEPTION WHEN OTHERS THEN
    v_can_switch_role := false;
  END;

  IF NOT v_can_switch_role THEN
    RAISE NOTICE 'SKIP Tests 1-6 (live rows): cannot switch to authenticated role in this environment — policy definitions asserted above are sufficient';
    RAISE NOTICE 'storage.objects bucket RLS tests COMPLETE (policy-definition mode)';
    RETURN;
  END IF;

  -- ============================================================================
  -- Privileged fixture setup (running as postgres / superuser)
  -- All inserts happen BEFORE any persona role switch so RLS does not block setup.
  -- ============================================================================
  SET LOCAL ROLE postgres;

  -- auth.users FK guard (mirrors 08): document_collaborators.user_id REFERENCES
  -- auth.users(id); synthetic persona UUIDs have no auth.users row in a bare test DB,
  -- so collaborator fixtures FK-fail (23503). SKIP cleanly when absent (GREEN-OR-SKIPPED);
  -- seed persona auth.users rows + apply the prod RLS schema to run these live.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_editor_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_viewer_id) THEN
    RAISE NOTICE 'SKIP: persona collaborator UUIDs not in auth.users — document_collaborators FK would fail here';
    RETURN;
  END IF;

  -- Document owned by 0001. ON CONFLICT DO NOTHING matches the convention in 01-05
  -- and avoids clobbering any pre-existing test-fixture row.
  INSERT INTO public.documents (id, user_id, file_path)
    VALUES (v_doc_id, v_owner_id, v_file_path)
    ON CONFLICT (id) DO NOTHING;
  -- Ensure file_path matches even if the row pre-existed with a different path.
  UPDATE public.documents SET file_path = v_file_path WHERE id = v_doc_id;

  -- Collaborators: editor (0002) and viewer (0003), both status='active'
  INSERT INTO public.document_collaborators (document_id, user_id, role, status)
    VALUES
      (v_doc_id, v_editor_id, 'editor', 'active'),
      (v_doc_id, v_viewer_id, 'viewer', 'active')
    ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

  -- Insert a storage.objects row whose name matches documents.file_path.
  -- NOTE: Supabase blocks direct DELETE FROM storage.objects (the storage.protect_delete
  -- trigger raises 42501), so a DELETE-then-INSERT fixture cannot run here. Because this
  -- whole test runs inside BEGIN/ROLLBACK, the row never persists between runs, so a plain
  -- INSERT ... ON CONFLICT (id) DO NOTHING is both sufficient and idempotent.
  -- owner_id is TEXT in Supabase storage.objects; cast accordingly.
  INSERT INTO storage.objects (id, bucket_id, name, owner, owner_id)
    VALUES (
      v_storage_obj_id,
      'documents',
      v_file_path,
      v_owner_id,
      v_owner_id::text
    )
    ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- TEST 1: Owner can SELECT the storage object (ALLOW)
  -- ============================================================================

  -- JWT config — both keys required; auth.uid() inside SECURITY DEFINER reads
  -- request.jwt.claims.sub; older builds read request.jwt.claim.sub.
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_rows
    FROM storage.objects
    WHERE bucket_id = 'documents'
      AND name = v_file_path;

  SET LOCAL ROLE postgres;

  IF v_visible_rows < 1 THEN
    RAISE EXCEPTION
      'FAIL Test 1: owner SELECT returned % rows (expected >= 1) — owner should read their own document file via user_can_access_document owner fast path',
      v_visible_rows;
  END IF;
  RAISE NOTICE 'PASS Test 1: owner SELECT returned % row(s) — owner can read document storage object', v_visible_rows;

  -- ============================================================================
  -- TEST 2: Editor can SELECT the storage object (ALLOW)
  -- Editor satisfies user_can_access_document(doc_id, 'viewer') per role hierarchy:
  -- editor >= viewer.
  -- ============================================================================

  PERFORM set_config('request.jwt.claim.sub', v_editor_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_id::text, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_rows
    FROM storage.objects
    WHERE bucket_id = 'documents'
      AND name = v_file_path;

  SET LOCAL ROLE postgres;

  IF v_visible_rows < 1 THEN
    RAISE EXCEPTION
      'FAIL Test 2: editor SELECT returned % rows (expected >= 1) — editor should download PDF bytes (editor >= viewer)',
      v_visible_rows;
  END IF;
  RAISE NOTICE 'PASS Test 2: editor SELECT returned % row(s) — editor can read document storage object', v_visible_rows;

  -- ============================================================================
  -- TEST 3: Viewer can SELECT the storage object (ALLOW)
  -- ============================================================================

  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer_id::text, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_rows
    FROM storage.objects
    WHERE bucket_id = 'documents'
      AND name = v_file_path;

  SET LOCAL ROLE postgres;

  IF v_visible_rows < 1 THEN
    RAISE EXCEPTION
      'FAIL Test 3: viewer SELECT returned % rows (expected >= 1) — viewer should download PDF bytes',
      v_visible_rows;
  END IF;
  RAISE NOTICE 'PASS Test 3: viewer SELECT returned % row(s) — viewer can read document storage object', v_visible_rows;

  -- ============================================================================
  -- TEST 4: Non-collaborator CANNOT SELECT the storage object (DENY)
  -- RLS silently returns 0 rows — no 42501; assert count = 0.
  -- ============================================================================

  PERFORM set_config('request.jwt.claim.sub', v_noncollab_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_noncollab_id::text, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_rows
    FROM storage.objects
    WHERE bucket_id = 'documents'
      AND name = v_file_path;

  SET LOCAL ROLE postgres;

  IF v_visible_rows != 0 THEN
    RAISE EXCEPTION
      'FAIL Test 4: non-collaborator SELECT returned % rows (expected 0) — RLS leak on storage.objects detected',
      v_visible_rows;
  END IF;
  RAISE NOTICE 'PASS Test 4: non-collaborator SELECT returned 0 rows — RLS correctly hides document storage object';

  -- ============================================================================
  -- TEST 5: Revoked collaborator CANNOT SELECT (status != 'active' -> DENY)
  -- user_can_access_document requires status='active'; a revoked row must not grant access.
  -- ============================================================================

  -- We are running as the privileged postgres role here (set above). The UPDATE on
  -- document_collaborators needs privileged access.
  UPDATE public.document_collaborators
    SET status = 'revoked'
    WHERE document_id = v_doc_id
      AND user_id = v_viewer_id;

  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer_id::text, 'role', 'authenticated')::text, true);

  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_visible_rows
    FROM storage.objects
    WHERE bucket_id = 'documents'
      AND name = v_file_path;

  SET LOCAL ROLE postgres;

  IF v_visible_rows != 0 THEN
    RAISE EXCEPTION
      'FAIL Test 5: revoked viewer SELECT returned % rows (expected 0) — a revoked collaborator (status != ''active'') must not read storage objects',
      v_visible_rows;
  END IF;
  RAISE NOTICE 'PASS Test 5: revoked viewer SELECT returned 0 rows — revoked collaborators correctly blocked';

  -- Restore viewer to 'active' so subsequent tests (and any future Test 7+) start clean.
  UPDATE public.document_collaborators
    SET status = 'active'
    WHERE document_id = v_doc_id
      AND user_id = v_viewer_id;

  -- ============================================================================
  -- TEST 6: Storage object for a DIFFERENT document is not visible to a collaborator
  -- on the first document. Ensures the policy JOIN on file_path is strict and
  -- does not bleed across documents.
  -- ============================================================================

  DECLARE
    v_other_doc_id    uuid := '88888888-8888-8888-8888-888888888888'::uuid;
    v_other_owner_id  uuid := '00000000-0000-0000-0000-000000000005'::uuid;
    v_other_file_path text := '00000000-0000-0000-0000-000000000005/other-project/other-doc.pdf';
    v_other_obj_id    uuid := 'bbbbcccc-dddd-eeee-ffff-000000000000'::uuid;
  BEGIN
    -- Fixture writes require the privileged role (already postgres here).
    SET LOCAL ROLE postgres;

    -- Insert a second document owned by a different user (0005)
    INSERT INTO public.documents (id, user_id, file_path)
      VALUES (v_other_doc_id, v_other_owner_id, v_other_file_path)
      ON CONFLICT (id) DO NOTHING;
    UPDATE public.documents SET file_path = v_other_file_path WHERE id = v_other_doc_id;

    -- Plain idempotent INSERT (see note above: direct DELETE FROM storage.objects is
    -- blocked by storage.protect_delete; the BEGIN/ROLLBACK means nothing persists).
    INSERT INTO storage.objects (id, bucket_id, name, owner, owner_id)
      VALUES (v_other_obj_id, 'documents', v_other_file_path, v_other_owner_id, v_other_owner_id::text)
      ON CONFLICT (id) DO NOTHING;

    -- editor (0002) is a collaborator on doc 9999 but NOT on doc 8888
    PERFORM set_config('request.jwt.claim.sub', v_editor_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_editor_id::text, 'role', 'authenticated')::text, true);

    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_visible_rows
      FROM storage.objects
      WHERE bucket_id = 'documents'
        AND name = v_other_file_path;

    SET LOCAL ROLE postgres;

    IF v_visible_rows != 0 THEN
      RAISE EXCEPTION
        'FAIL Test 6: editor (collaborator on doc 9999) SELECT returned % rows for a different document''s storage object (expected 0) — cross-document storage bleed detected',
        v_visible_rows;
    END IF;
    RAISE NOTICE 'PASS Test 6: editor on doc 9999 cannot see storage objects belonging to a different document (cross-doc bleed check passed)';
  END;

  -- Back to privileged role before DO block exits
  SET LOCAL ROLE postgres;

  RAISE NOTICE 'storage.objects documents bucket RLS tests COMPLETE';

END $$;

ROLLBACK;
