-- A new version keeps its sharing (Drawboard deep test, two-person run):
-- supersede_document() only pointed the old copy at the new one, so a person
-- the old copy was shared with could not open the new copy, lost the document
-- from Documents and Projects, and kept drawing on the old copy. Now the
-- supersede also carries the old copy's people and roles, the old owner (when
-- an editor uploaded), open email invites and live guest links to the new
-- copy. Same checks as before; the function body is otherwise unchanged
-- (20261028010000_document_versions.sql).

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
  IF v_new.superseded_by IS NOT NULL OR COALESCE(v_old.archived, false) OR COALESCE(v_new.archived, false) THEN
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

REVOKE ALL ON FUNCTION public.supersede_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_document(uuid, uuid) TO authenticated, service_role;
