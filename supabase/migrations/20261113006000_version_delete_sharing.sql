-- Delete one version, follow-up (Nightly flag 'version-delete'):
--
-- 1. Sharing follows the latest copy. supersede_document moves people,
--    pending invites and live guest links onto the new copy; deleting the
--    latest version left them on the archived row, so the copy that became
--    current again lost them. remove_document_version now moves them to that
--    copy, and Undo moves them back.
-- 2. A deleted copy is never "current" in document_versions. It sits in the
--    Archive with no chain, so its uploader's other open tab rechecked it as
--    the newest copy and stayed writable.

-- Moves what supersede_document carries from one copy to another: active
-- and pending collaborators (copied, as supersede does), the old copy's
-- owner, open invites and live guest links with their guests. Only the
-- version functions call it.
CREATE OR REPLACE FUNCTION public.move_document_sharing(p_from uuid, p_to uuid, p_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from public.documents;
  v_to public.documents;
BEGIN
  SELECT * INTO v_from FROM public.documents WHERE id = p_from;
  SELECT * INTO v_to FROM public.documents WHERE id = p_to;
  IF v_from.id IS NULL OR v_to.id IS NULL OR v_from.id = v_to.id THEN
    RETURN;
  END IF;
  INSERT INTO public.document_collaborators (document_id, user_id, invited_by, role, email, status)
  SELECT v_to.id, c.user_id, c.invited_by, c.role, c.email, c.status
    FROM public.document_collaborators c
   WHERE c.document_id = v_from.id
     AND c.status IN ('active', 'pending')
     AND c.user_id IS DISTINCT FROM v_to.user_id
  ON CONFLICT (document_id, user_id) DO NOTHING;
  IF v_from.user_id IS DISTINCT FROM v_to.user_id THEN
    INSERT INTO public.document_collaborators (document_id, user_id, invited_by, role, status)
    VALUES (v_to.id, v_from.user_id, p_by, 'owner', 'active')
    ON CONFLICT (document_id, user_id) DO NOTHING;
  END IF;
  UPDATE public.document_invites
     SET document_id = v_to.id
   WHERE document_id = v_from.id AND accepted_at IS NULL AND revoked_at IS NULL;
  UPDATE public.document_guests g
     SET document_id = v_to.id
    FROM public.document_guest_links l
   WHERE g.link_id = l.id AND l.document_id = v_from.id AND l.revoked_at IS NULL;
  UPDATE public.document_guest_links
     SET document_id = v_to.id
   WHERE document_id = v_from.id AND revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.move_document_sharing(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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
  -- The latest copy carried the sharing: the copy that is current again
  -- takes it over.
  IF v_doc.superseded_by IS NULL AND v_prev IS NOT NULL THEN
    PERFORM public.move_document_sharing(p_document_id, v_prev[array_length(v_prev, 1)], v_uid);
  END IF;
  -- What Undo puts back, kept here and never taken from the caller.
  INSERT INTO public.document_version_removals (document_id, previous, next, removed_by, removed_at)
  VALUES (p_document_id, COALESCE(v_prev, ARRAY[]::uuid[]), v_doc.superseded_by, v_uid, v_now)
  ON CONFLICT (document_id) DO UPDATE
    SET previous = EXCLUDED.previous, next = EXCLUDED.next,
        removed_by = EXCLUDED.removed_by, removed_at = EXCLUDED.removed_at;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'previous', to_jsonb(COALESCE(v_prev, ARRAY[]::uuid[])),
    'next', v_doc.superseded_by,
    'current', CASE WHEN v_doc.superseded_by IS NULL THEN v_prev[array_length(v_prev, 1)] ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_document_version(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.documents;
  v_rec public.document_version_removals;
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rec FROM public.document_version_removals WHERE document_id = p_document_id FOR UPDATE;
  PERFORM 1 FROM public.documents
    WHERE id = p_document_id OR id = ANY (COALESCE(v_rec.previous, ARRAY[]::uuid[])) OR id = v_rec.next
    ORDER BY id
    FOR UPDATE;
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id;
  -- Only the person who deleted it, or its uploader. The deleted copy is in
  -- the Archive, where only its uploader can see it, so the check is by
  -- person. Same answer for "no such row" and "not allowed".
  IF v_doc.id IS NULL OR v_rec.document_id IS NULL
     OR NOT (v_rec.removed_by = v_uid OR v_doc.user_id = v_uid) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  -- Only while nothing moved: it is still in the Archive from that same
  -- delete and out of any chain, each copy before it still points where it
  -- pointed after the delete, and the copy after it is still live.
  IF v_doc.user_archived_at IS DISTINCT FROM v_rec.removed_at OR v_doc.superseded_by IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.documents d WHERE d.superseded_by = p_document_id)
     OR (SELECT count(*) FROM public.documents d
          WHERE d.id = ANY (v_rec.previous)
            AND d.superseded_by IS NOT DISTINCT FROM v_rec.next
            AND d.user_archived_at IS NULL
            AND NOT COALESCE(d.archived, false)) <> cardinality(v_rec.previous)
     OR (v_rec.next IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.documents d
           WHERE d.id = v_rec.next AND d.user_archived_at IS NULL AND NOT COALESCE(d.archived, false)))
     OR (cardinality(v_rec.previous) = 0 AND v_rec.next IS NULL) THEN
    RAISE EXCEPTION 'The versions changed since. Restore it from the Archive instead.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY v_rec.previous LOOP
    PERFORM set_config('app.supersede_document_id', v_id::text, true);
    UPDATE public.documents SET superseded_by = p_document_id, updated_at = v_now WHERE id = v_id;
  END LOOP;
  PERFORM set_config('app.supersede_document_id', p_document_id::text, true);
  UPDATE public.documents
     SET superseded_by = v_rec.next,
         user_archived_at = NULL,
         user_archive_expires_at = NULL,
         user_archived_by = NULL,
         updated_at = v_now
   WHERE id = p_document_id;
  PERFORM set_config('app.supersede_document_id', '', true);
  -- Back as the latest copy: the sharing comes back with it.
  IF v_rec.next IS NULL AND cardinality(v_rec.previous) > 0 THEN
    PERFORM public.move_document_sharing(v_rec.previous[cardinality(v_rec.previous)], p_document_id, v_uid);
  END IF;
  DELETE FROM public.document_version_removals WHERE document_id = p_document_id;
  RETURN jsonb_build_object('ok', true, 'document_id', p_document_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.document_versions(p_document_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  created_at timestamptz,
  page_count integer,
  version_number integer,
  is_current boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_head uuid := p_document_id;
  v_next uuid;
  v_steps integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'viewer'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  -- Walk forward to the newest copy (bounded, so a bad loop cannot spin).
  LOOP
    SELECT d.superseded_by INTO v_next FROM public.documents d WHERE d.id = v_head;
    EXIT WHEN v_next IS NULL OR v_steps >= 500;
    v_head := v_next;
    v_steps := v_steps + 1;
  END LOOP;

  RETURN QUERY
  WITH RECURSIVE chain AS (
    SELECT d.id, d.name, d.created_at, d.page_count, 0 AS depth,
           (d.user_archived_at IS NULL AND NOT COALESCE(d.archived, false)) AS live
      FROM public.documents d
     WHERE d.id = v_head
    UNION ALL
    SELECT d.id, d.name, d.created_at, d.page_count, c.depth + 1, true
      FROM public.documents d
      JOIN chain c ON d.superseded_by = c.id
     WHERE c.depth < 500
  ),
  numbered AS (
    SELECT c.*, (count(*) OVER () - c.depth)::integer AS version_number
      FROM chain c
  )
  SELECT n.id, n.name::text, n.created_at, n.page_count, n.version_number, n.depth = 0 AND n.live
    FROM numbered n
   WHERE COALESCE(public.user_can_access_document(n.id, 'viewer'), false)
   ORDER BY n.version_number;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_document_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_document_version(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_document_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_document_version(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_versions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_versions(uuid) TO authenticated, service_role;
