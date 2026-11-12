-- Resolve a comment thread (KAL-415), as Drawboard does: a resolved thread
-- leaves the Open list and waits under Resolved, where anyone who can post
-- can reopen it. Only a thread start (thread_id IS NULL) carries the mark.
--
--   set_mark_comment_resolved  editors resolve or reopen a thread (same
--                              check as add_mark_comment).
--   carry_mark_comments        copies the resolved mark with the thread.

ALTER TABLE public.mark_comments
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mark_comments_resolved_on_root') THEN
    ALTER TABLE public.mark_comments ADD CONSTRAINT mark_comments_resolved_on_root
      CHECK (resolved_at IS NULL OR thread_id IS NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_mark_comment_resolved(p_comment_id uuid, p_resolved boolean)
RETURNS public.mark_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mark_comments;
BEGIN
  SELECT * INTO v_row FROM public.mark_comments WHERE id = p_comment_id FOR UPDATE;
  IF v_uid IS NULL OR v_row.id IS NULL
     OR NOT COALESCE(public.user_can_access_document(v_row.document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Comment not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.thread_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only a whole thread can be resolved' USING ERRCODE = '22023';
  END IF;
  -- Resolving twice keeps the first time and person.
  IF COALESCE(p_resolved, false) THEN
    IF v_row.resolved_at IS NOT NULL THEN
      RETURN v_row;
    END IF;
    UPDATE public.mark_comments SET resolved_at = now(), resolved_by = v_uid
     WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    UPDATE public.mark_comments SET resolved_at = NULL, resolved_by = NULL
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_mark_comment_resolved(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_mark_comment_resolved(uuid, boolean) TO authenticated;

-- A new version keeps resolved threads resolved: the same copy as
-- 20261110178000_comment_pins, plus resolved_at / resolved_by on thread starts.
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

  INSERT INTO public.mark_comments
    (document_id, thread_id, mark_id, page_number, author_id, body, mentions,
     created_at, edited_at, deleted_at, mentions_notified_at, carried_from,
     pin_x, pin_y, pin_kind, pin_status, pin_number, resolved_at, resolved_by)
  SELECT v_to.id, NULL, c.mark_id, c.page_number, c.author_id, c.body, c.mentions,
         c.created_at, c.edited_at, c.deleted_at, COALESCE(c.mentions_notified_at, now()), c.id,
         c.pin_x, c.pin_y, c.pin_kind, c.pin_status, c.pin_number, c.resolved_at, c.resolved_by
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

-- A reply to a resolved thread reopens it, as in Google Docs: the
-- conversation is live again, from the Comments list, a pin card or the
-- API alike. Copies made by carry_mark_comments (carried_from set) keep the
-- thread as it was.
CREATE OR REPLACE FUNCTION public.mark_comment_reply_reopens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.mark_comments
     SET resolved_at = NULL, resolved_by = NULL
   WHERE id = NEW.thread_id AND resolved_at IS NOT NULL;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_reply_reopens() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mark_comment_reply_reopens ON public.mark_comments;
CREATE TRIGGER mark_comment_reply_reopens
  AFTER INSERT ON public.mark_comments
  FOR EACH ROW
  WHEN (NEW.thread_id IS NOT NULL AND NEW.carried_from IS NULL)
  EXECUTE FUNCTION public.mark_comment_reply_reopens();
