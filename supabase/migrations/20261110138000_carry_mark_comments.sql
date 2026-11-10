-- Comment threads follow a new version (Drawboard deep test, Nightly behind
-- 'document-versions' + 'mark-comments'). "Upload as new version" copied the
-- old copy's marks to the new one (documentVersionMarks.js) but left every
-- comment thread behind on the old copy, which then leaves the lists.
--
-- carry_mark_comments copies the old copy's threads onto the new one: same
-- mark ids (the marks keep their ids when they are copied), pages, authors,
-- times and edits. The old copy keeps its own threads as a record.
--   - Only someone who can edit both copies, both in the same project, and
--     only onto the copy that replaced it (or before the link is set).
--   - Each copied row remembers its source (carried_from), so a retry after a
--     lost answer copies nothing twice.
--   - mentions_notified_at is set on every copy, so nobody gets a second
--     @mention email for an old comment.
--   - A deleted comment is left behind, except a deleted thread start that
--     still has live replies (it stays a "deleted" stub so they keep a place).

ALTER TABLE public.mark_comments
  ADD COLUMN IF NOT EXISTS carried_from uuid;

CREATE UNIQUE INDEX IF NOT EXISTS mark_comments_carried_from_idx
  ON public.mark_comments (document_id, carried_from)
  WHERE carried_from IS NOT NULL;

CREATE OR REPLACE FUNCTION public.carry_mark_comments(p_from_document_id uuid, p_to_document_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_from public.documents;
  v_to public.documents;
  v_threads integer := 0;
  v_replies integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_from_document_id IS NULL OR p_to_document_id IS NULL OR p_from_document_id = p_to_document_id THEN
    RAISE EXCEPTION 'Two different documents are needed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_from FROM public.documents WHERE id = p_from_document_id;
  SELECT * INTO v_to FROM public.documents WHERE id = p_to_document_id;
  -- Same answer for "no such row" and "not allowed": no existence oracle.
  IF v_from.id IS NULL OR v_to.id IS NULL
     OR NOT COALESCE(public.user_can_access_document(v_from.id, 'editor'), false)
     OR NOT COALESCE(public.user_can_access_document(v_to.id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_from.project_id IS DISTINCT FROM v_to.project_id THEN
    RAISE EXCEPTION 'A new version must be in the same project' USING ERRCODE = '22023';
  END IF;
  IF v_from.superseded_by IS NOT NULL AND v_from.superseded_by <> v_to.id THEN
    RAISE EXCEPTION 'That document already has a newer version' USING ERRCODE = '22023';
  END IF;

  -- Thread starts first, so replies can point at their copies.
  INSERT INTO public.mark_comments
    (document_id, thread_id, mark_id, page_number, author_id, body, mentions,
     created_at, edited_at, deleted_at, mentions_notified_at, carried_from)
  SELECT v_to.id, NULL, c.mark_id, c.page_number, c.author_id, c.body, c.mentions,
         c.created_at, c.edited_at, c.deleted_at, COALESCE(c.mentions_notified_at, now()), c.id
    FROM public.mark_comments c
   WHERE c.document_id = v_from.id
     AND c.thread_id IS NULL
     AND (c.deleted_at IS NULL OR EXISTS (
           SELECT 1 FROM public.mark_comments r
            WHERE r.thread_id = c.id AND r.deleted_at IS NULL))
   ORDER BY c.created_at
  ON CONFLICT (document_id, carried_from) WHERE carried_from IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_threads = ROW_COUNT;

  INSERT INTO public.mark_comments
    (document_id, thread_id, mark_id, page_number, author_id, body, mentions,
     created_at, edited_at, deleted_at, mentions_notified_at, carried_from)
  SELECT v_to.id, root.id, root.mark_id, root.page_number, c.author_id, c.body, c.mentions,
         c.created_at, c.edited_at, NULL, COALESCE(c.mentions_notified_at, now()), c.id
    FROM public.mark_comments c
    JOIN public.mark_comments root
      ON root.document_id = v_to.id AND root.carried_from = c.thread_id
   WHERE c.document_id = v_from.id
     AND c.thread_id IS NOT NULL
     AND c.deleted_at IS NULL
   ORDER BY c.created_at
  ON CONFLICT (document_id, carried_from) WHERE carried_from IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_replies = ROW_COUNT;

  RETURN v_threads + v_replies;
END;
$$;

REVOKE ALL ON FUNCTION public.carry_mark_comments(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carry_mark_comments(uuid, uuid) TO authenticated, service_role;
