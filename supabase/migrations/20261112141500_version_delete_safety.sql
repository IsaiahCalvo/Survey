-- Delete one version, safety pass (Nightly flag 'version-delete'). The
-- functions from 20261112140000 ship to prod with the flag off, so each is
-- safe to call directly:
--
-- 1. supersede_document refuses a deleted copy (user_archived_at set) on
--    either side. Before, an "upload as new version" that was in flight while
--    the latest copy was deleted could still attach to the archived row and
--    give the chain a second head.
-- 2. remove_document_version needs edit access (as supersede_document does),
--    not just view access.
-- 3. restore_document_version only touches copies the caller can edit in
--    the deleted copy's project. Before, p_previous was trusted as given:
--    with p_next NULL any current document anywhere matched the "nothing
--    moved" check, so a direct call could make someone else's file look
--    replaced. And Undo now works for a project owner who deleted someone
--    else's copy (an archived row is visible to its uploader only, so the
--    access check always failed for them).

CREATE OR REPLACE FUNCTION public.supersede_document(p_old_document_id uuid, p_new_document_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.documents;
  v_new public.documents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_old_document_id IS NULL OR p_new_document_id IS NULL OR p_old_document_id = p_new_document_id THEN
    RAISE EXCEPTION 'Two different documents are needed' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in a fixed order so two uploads cannot cross.
  PERFORM 1 FROM public.documents
    WHERE id IN (p_old_document_id, p_new_document_id)
    ORDER BY id
    FOR UPDATE;
  SELECT * INTO v_old FROM public.documents WHERE id = p_old_document_id;
  SELECT * INTO v_new FROM public.documents WHERE id = p_new_document_id;

  -- Same answer for "no such row" and "not allowed": no existence oracle.
  IF v_old.id IS NULL OR v_new.id IS NULL
     OR v_new.user_id IS DISTINCT FROM v_uid
     OR NOT COALESCE(public.user_can_access_document(v_old.id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_old.project_id IS DISTINCT FROM v_new.project_id THEN
    RAISE EXCEPTION 'A new version must be in the same project' USING ERRCODE = '22023';
  END IF;
  IF v_old.superseded_by IS NOT NULL THEN
    IF v_old.superseded_by = v_new.id THEN
      RETURN v_old; -- a retry after a lost response
    END IF;
    RAISE EXCEPTION 'That document already has a newer version' USING ERRCODE = '22023';
  END IF;
  IF v_new.superseded_by IS NOT NULL OR COALESCE(v_old.archived, false) OR COALESCE(v_new.archived, false)
     OR v_old.user_archived_at IS NOT NULL OR v_new.user_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only current documents can be versions of each other' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.supersede_document_id', v_old.id::text, true);
  UPDATE public.documents
     SET superseded_by = v_new.id, updated_at = now()
   WHERE id = v_old.id
  RETURNING * INTO v_old;
  PERFORM set_config('app.supersede_document_id', '', true);

  -- Whoever could open the old copy can open the new one: the same people,
  -- roles and open invites (the old owner too, when someone else uploaded),
  -- and live guest links now open the new copy. Without this a person the
  -- old copy was shared with lost the document from their lists and kept
  -- drawing on a copy nobody else would see again.
  INSERT INTO public.document_collaborators (document_id, user_id, invited_by, role, email, status)
  SELECT v_new.id, c.user_id, c.invited_by, c.role, c.email, c.status
    FROM public.document_collaborators c
   WHERE c.document_id = v_old.id
     AND c.status IN ('active', 'pending')
     AND c.user_id IS DISTINCT FROM v_new.user_id
  ON CONFLICT (document_id, user_id) DO NOTHING;
  IF v_old.user_id IS DISTINCT FROM v_new.user_id THEN
    INSERT INTO public.document_collaborators (document_id, user_id, invited_by, role, status)
    VALUES (v_new.id, v_old.user_id, v_uid, 'owner', 'active')
    ON CONFLICT (document_id, user_id) DO NOTHING;
  END IF;
  UPDATE public.document_invites
     SET document_id = v_new.id
   WHERE document_id = v_old.id AND accepted_at IS NULL AND revoked_at IS NULL;
  UPDATE public.document_guests g
     SET document_id = v_new.id
    FROM public.document_guest_links l
   WHERE g.link_id = l.id AND l.document_id = v_old.id AND l.revoked_at IS NULL;
  UPDATE public.document_guest_links
     SET document_id = v_new.id
   WHERE document_id = v_old.id AND revoked_at IS NULL;

  RETURN v_old;
END;
$$;

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
     OR NOT COALESCE(public.user_can_access_document(v_doc.id, 'editor'), false)
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
  -- The deleted copy is in the Archive, where only its uploader can see it,
  -- so the check is by person: its uploader, or the project's owner who
  -- deleted it. Same answer for "no such row" and "not allowed".
  IF v_doc.id IS NULL
     OR NOT (v_doc.user_id = v_uid OR (v_doc.user_archived_by = v_uid AND EXISTS (
       SELECT 1 FROM public.projects p WHERE p.id = v_doc.project_id AND p.user_id = v_uid))) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  -- Only while nothing moved: it is still in the Archive and out of any
  -- chain, each copy before it still points where it pointed after the
  -- delete, and the copy after it is still current or in its chain. Every
  -- copy named must be in the same project and editable by the caller, so a
  -- direct call can't reach anyone else's files.
  IF v_doc.user_archived_at IS NULL OR v_doc.superseded_by IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.superseded_by = p_document_id)
     OR (SELECT count(*) FROM public.documents d
          WHERE d.id = ANY (v_prev)
            AND d.superseded_by IS NOT DISTINCT FROM p_next
            AND d.user_archived_at IS NULL
            AND NOT COALESCE(d.archived, false)
            AND d.project_id IS NOT DISTINCT FROM v_doc.project_id
            AND COALESCE(public.user_can_access_document(d.id, 'editor'), false)) <> cardinality(v_prev)
     OR (p_next IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.documents d
           WHERE d.id = p_next
             AND d.user_archived_at IS NULL
             AND NOT COALESCE(d.archived, false)
             AND d.project_id IS NOT DISTINCT FROM v_doc.project_id
             AND COALESCE(public.user_can_access_document(d.id, 'editor'), false)))
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

REVOKE ALL ON FUNCTION public.supersede_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_document(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_document_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_document_version(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_document_version(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_document_version(uuid, uuid[], uuid) TO authenticated, service_role;
