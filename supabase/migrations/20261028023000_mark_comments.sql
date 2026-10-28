-- Comments on marks (Drawboard Projects audit item 3, Nightly behind the
-- 'mark-comments' flag). A thread hangs off one mark (mark_id) or a whole
-- page (mark_id NULL); replies point at the thread's first comment.
--
-- Rows are read by anyone who can open the document and written ONLY through
-- the functions below (no insert/update/delete grants), which check access:
--   add_mark_comment     editors (owner, editor, project owner/editor) post;
--                        @mentions are kept only for people on the document.
--   edit_mark_comment    the author changes their own words.
--   delete_mark_comment  the author or the document's owner; the row stays as
--                        a "deleted" stub so replies keep their place.
-- mark_comment_people lists who can be @mentioned. The mention email is sent
-- by the notify-comment-mentions function, once per comment
-- (mentions_notified_at, set only with the service key).

CREATE TABLE IF NOT EXISTS public.mark_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.mark_comments(id) ON DELETE CASCADE,
  mark_id text CHECK (mark_id IS NULL OR char_length(mark_id) BETWEEN 1 AND 200),
  page_number integer NOT NULL CHECK (page_number >= 1),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  mentions uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  mentions_notified_at timestamptz,
  CHECK (deleted_at IS NOT NULL OR char_length(btrim(body)) >= 1)
);

CREATE INDEX IF NOT EXISTS mark_comments_document_idx ON public.mark_comments (document_id, created_at);
CREATE INDEX IF NOT EXISTS mark_comments_thread_idx ON public.mark_comments (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mark_comments_author_idx ON public.mark_comments (author_id);

ALTER TABLE public.mark_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mark_comments_select ON public.mark_comments;
CREATE POLICY mark_comments_select ON public.mark_comments
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id, 'viewer'));

REVOKE ALL ON public.mark_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mark_comments TO authenticated;
GRANT ALL ON public.mark_comments TO service_role;

-- Whether `p_user_id` can open the document (the same rules as
-- user_can_access_document, for someone other than the caller).
CREATE OR REPLACE FUNCTION public.mark_comment_member(p_document_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
     WHERE d.id = p_document_id
       AND d.user_archived_at IS NULL
       AND (
         d.user_id = p_user_id
         OR EXISTS (SELECT 1 FROM public.document_collaborators c
                     WHERE c.document_id = d.id AND c.user_id = p_user_id AND c.status = 'active')
         OR (d.project_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM public.project_collaborators pc
                       WHERE pc.project_id = d.project_id AND pc.user_id = p_user_id AND pc.status = 'active')
              OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = d.project_id AND p.user_id = p_user_id)))
       )
  );
$$;

-- People on the document, for the @mention list and author names.
CREATE OR REPLACE FUNCTION public.mark_comment_people(p_document_id uuid)
RETURNS TABLE (user_id uuid, name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_document(p_document_id, 'viewer') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH d AS (SELECT id, user_id, project_id FROM public.documents WHERE id = p_document_id),
  people AS (
    SELECT d.user_id AS uid FROM d
    UNION SELECT c.user_id FROM public.document_collaborators c, d
     WHERE c.document_id = d.id AND c.status = 'active' AND c.user_id IS NOT NULL
    UNION SELECT pc.user_id FROM public.project_collaborators pc, d
     WHERE d.project_id IS NOT NULL AND pc.project_id = d.project_id AND pc.status = 'active' AND pc.user_id IS NOT NULL
    UNION SELECT p.user_id FROM public.projects p, d WHERE d.project_id IS NOT NULL AND p.id = d.project_id
  )
  SELECT u.id,
         NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::text,
         u.email::text
    FROM people
    JOIN auth.users u ON u.id = people.uid
   ORDER BY 2 NULLS LAST, 3;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_comment_clean_mentions(p_document_id uuid, p_mentions uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT m), '{}')
    FROM unnest(COALESCE(p_mentions, '{}')) AS m
   WHERE m IS NOT NULL AND public.mark_comment_member(p_document_id, m);
$$;

CREATE OR REPLACE FUNCTION public.add_mark_comment(
  p_document_id uuid,
  p_page_number integer,
  p_body text,
  p_mark_id text DEFAULT NULL,
  p_thread_id uuid DEFAULT NULL,
  p_mentions uuid[] DEFAULT '{}'
)
RETURNS public.mark_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_root public.mark_comments;
  v_row public.mark_comments;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'A comment needs 1 to 4000 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_mentions), 0) > 20 THEN
    RAISE EXCEPTION 'Too many mentions' USING ERRCODE = '22023';
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT * INTO v_root FROM public.mark_comments WHERE id = p_thread_id;
    IF v_root.id IS NULL OR v_root.document_id <> p_document_id OR v_root.thread_id IS NOT NULL THEN
      RAISE EXCEPTION 'Thread not found' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.mark_comments (document_id, thread_id, mark_id, page_number, author_id, body, mentions)
    VALUES (p_document_id, v_root.id, v_root.mark_id, v_root.page_number, v_uid, v_body,
            public.mark_comment_clean_mentions(p_document_id, p_mentions))
    RETURNING * INTO v_row;
  ELSE
    IF p_page_number IS NULL OR p_page_number < 1 THEN
      RAISE EXCEPTION 'A page is needed' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.mark_comments (document_id, mark_id, page_number, author_id, body, mentions)
    VALUES (p_document_id, NULLIF(btrim(p_mark_id), ''), p_page_number, v_uid, v_body,
            public.mark_comment_clean_mentions(p_document_id, p_mentions))
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_mark_comment(p_comment_id uuid, p_body text, p_mentions uuid[] DEFAULT '{}')
RETURNS public.mark_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mark_comments;
  v_body text := btrim(COALESCE(p_body, ''));
BEGIN
  SELECT * INTO v_row FROM public.mark_comments WHERE id = p_comment_id FOR UPDATE;
  IF v_uid IS NULL OR v_row.id IS NULL OR v_row.author_id IS DISTINCT FROM v_uid
     OR v_row.deleted_at IS NOT NULL
     OR NOT COALESCE(public.user_can_access_document(v_row.document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Comment not found' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'A comment needs 1 to 4000 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_mentions), 0) > 20 THEN
    RAISE EXCEPTION 'Too many mentions' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mark_comments
     SET body = v_body,
         mentions = public.mark_comment_clean_mentions(v_row.document_id, p_mentions),
         edited_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_mark_comment(p_comment_id uuid)
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
     OR NOT (
       (v_row.author_id IS NOT DISTINCT FROM v_uid AND COALESCE(public.user_can_access_document(v_row.document_id, 'editor'), false))
       OR COALESCE(public.user_can_access_document(v_row.document_id, 'owner'), false)
     ) THEN
    RAISE EXCEPTION 'Comment not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  UPDATE public.mark_comments
     SET body = '', mentions = '{}', deleted_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_comment_member(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_comment_clean_mentions(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_comment_clean_mentions(uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mark_comment_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_comment_people(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_mark_comment(uuid, integer, text, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_mark_comment(uuid, integer, text, text, uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.edit_mark_comment(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_mark_comment(uuid, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_mark_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_mark_comment(uuid) TO authenticated;

-- Live: other screens see a new comment at once (Realtime applies the
-- select policy above).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mark_comments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mark_comments;
  END IF;
END;
$$;

-- Flag: Comments on marks (beta, Survey Nightly only). Keep in step with
-- src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('mark-comments', 'off', 'Comments on marks: threads, replies and @mentions with an email link.')
ON CONFLICT (key) DO NOTHING;
