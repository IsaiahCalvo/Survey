-- Delete one version (Nightly flag 'version-delete'; Drawboard Projects
-- parity DL-28 / RV-22). Drawboard can delete "only the latest revision and
-- its markup" instead of the whole drawing. Survey: any one version in the
-- Versions list. The version goes to the Archive (as Delete does) and the
-- chain closes over the gap: the copy before it now points at the copy after
-- it, or becomes current again when the latest one was removed. Undo puts it
-- back where it was, as long as the chain has not moved on since.
--
-- Who may: the version's uploader or the project's owner (the rule the app
-- shows for Delete). superseded_by is written only through these functions
-- and supersede_document (enforce_documents_superseded_by).

CREATE OR REPLACE FUNCTION public.remove_document_version(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.documents;
  v_prev uuid[];
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.documents
    WHERE id = p_document_id OR superseded_by = p_document_id
    ORDER BY id
    FOR UPDATE;
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id;
  -- Same answer for "no such row" and "not allowed": no existence oracle.
  IF v_doc.id IS NULL
     OR NOT COALESCE(public.user_can_access_document(v_doc.id, 'viewer'), false)
     OR NOT (v_doc.user_id = v_uid OR EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = v_doc.project_id AND p.user_id = v_uid)) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_doc.user_archived_at IS NOT NULL OR COALESCE(v_doc.archived, false) THEN
    RAISE EXCEPTION 'That version is already deleted' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(d.id ORDER BY d.created_at, d.id) INTO v_prev
    FROM public.documents d WHERE d.superseded_by = p_document_id;
  IF v_prev IS NULL AND v_doc.superseded_by IS NULL THEN
    RAISE EXCEPTION 'This is the only version. Delete the document instead.' USING ERRCODE = '22023';
  END IF;

  -- The copies before it point past it.
  FOREACH v_id IN ARRAY COALESCE(v_prev, ARRAY[]::uuid[]) LOOP
    PERFORM set_config('app.supersede_document_id', v_id::text, true);
    UPDATE public.documents SET superseded_by = v_doc.superseded_by, updated_at = v_now WHERE id = v_id;
  END LOOP;
  -- It leaves the chain and goes to the Archive.
  PERFORM set_config('app.supersede_document_id', p_document_id::text, true);
  UPDATE public.documents
     SET superseded_by = NULL,
         user_archived_at = v_now,
         user_archive_expires_at = v_now + public.archive_retention_interval(),
         user_archived_by = v_uid,
         archive_group_id = NULL,
         updated_at = v_now
   WHERE id = p_document_id;
  PERFORM set_config('app.supersede_document_id', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'previous', to_jsonb(COALESCE(v_prev, ARRAY[]::uuid[])),
    'next', v_doc.superseded_by,
    'current', CASE WHEN v_doc.superseded_by IS NULL THEN v_prev[array_length(v_prev, 1)] ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_document_version(p_document_id uuid, p_previous uuid[], p_next uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.documents;
  v_id uuid;
  v_now timestamptz := now();
  v_prev uuid[] := COALESCE(p_previous, ARRAY[]::uuid[]);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.documents
    WHERE id = p_document_id OR id = ANY (v_prev) OR id = p_next
    ORDER BY id
    FOR UPDATE;
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id;
  IF v_doc.id IS NULL
     OR NOT COALESCE(public.user_can_access_document(v_doc.id, 'viewer'), false)
     OR NOT (v_doc.user_id = v_uid OR EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = v_doc.project_id AND p.user_id = v_uid)) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  -- Only while nothing moved: it is still in the Archive and out of any
  -- chain, each copy before it still points where it pointed after the
  -- delete, and the copy after it is still current or in its chain.
  IF v_doc.user_archived_at IS NULL OR v_doc.superseded_by IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.superseded_by = p_document_id)
     OR (SELECT count(*) FROM public.documents d
          WHERE d.id = ANY (v_prev)
            AND d.superseded_by IS NOT DISTINCT FROM p_next
            AND d.user_archived_at IS NULL
            AND NOT COALESCE(d.archived, false)) <> cardinality(v_prev)
     OR (p_next IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.documents d WHERE d.id = p_next AND d.user_archived_at IS NULL AND NOT COALESCE(d.archived, false)))
     OR (cardinality(v_prev) = 0 AND p_next IS NULL) THEN
    RAISE EXCEPTION 'The versions changed since. Restore it from the Archive instead.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY v_prev LOOP
    PERFORM set_config('app.supersede_document_id', v_id::text, true);
    UPDATE public.documents SET superseded_by = p_document_id, updated_at = v_now WHERE id = v_id;
  END LOOP;
  PERFORM set_config('app.supersede_document_id', p_document_id::text, true);
  UPDATE public.documents
     SET superseded_by = p_next,
         user_archived_at = NULL,
         user_archive_expires_at = NULL,
         user_archived_by = NULL,
         updated_at = v_now
   WHERE id = p_document_id;
  PERFORM set_config('app.supersede_document_id', '', true);
  RETURN jsonb_build_object('ok', true, 'document_id', p_document_id);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_document_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_document_version(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_document_version(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_document_version(uuid, uuid[], uuid) TO authenticated, service_role;

-- Flag: Delete one version (beta, Survey Nightly only). Keep in step with
-- src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('version-delete', 'off', 'Delete one version: take a single version out of the Versions list (Undo), the one before becomes current')
ON CONFLICT (key) DO NOTHING;
