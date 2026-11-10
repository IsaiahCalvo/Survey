-- Page pins (Drawboard Projects build item 6, Nightly behind 'comment-pins').
-- A pin is a page thread (mark_comments root, mark_id NULL) with a spot on
-- the page: its bottom-left corner sits on (pin_x, pin_y) in page points
-- (top-left origin, unrotated page). It is a Comment, an Issue or a Task.
-- Issues and tasks carry a status and a number per document (ISS-7, TSK-1);
-- their first comment is the short summary.
--
--   add_page_pin     editors drop a pin (same checks as add_mark_comment).
--   update_page_pin  editors move a pin or change an issue / task status.
--   carry_mark_comments now copies the pin columns with the thread.

ALTER TABLE public.mark_comments
  ADD COLUMN IF NOT EXISTS pin_x double precision,
  ADD COLUMN IF NOT EXISTS pin_y double precision,
  ADD COLUMN IF NOT EXISTS pin_kind text,
  ADD COLUMN IF NOT EXISTS pin_status text,
  ADD COLUMN IF NOT EXISTS pin_number integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mark_comments_pin_shape') THEN
    ALTER TABLE public.mark_comments ADD CONSTRAINT mark_comments_pin_shape CHECK (
      (pin_kind IS NULL AND pin_x IS NULL AND pin_y IS NULL AND pin_status IS NULL AND pin_number IS NULL)
      OR (
        pin_kind IN ('comment', 'issue', 'task')
        AND thread_id IS NULL
        AND mark_id IS NULL
        AND pin_x IS NOT NULL AND pin_y IS NOT NULL
        AND pin_x BETWEEN -1 AND 100000 AND pin_y BETWEEN -1 AND 100000
        AND (
          (pin_kind = 'comment' AND pin_status IS NULL AND pin_number IS NULL)
          OR (pin_kind = 'issue' AND pin_number >= 1
              AND pin_status IN ('draft', 'open', 'pending', 'in-review', 'closed', 'approved', 'rejected'))
          OR (pin_kind = 'task' AND pin_number >= 1
              AND pin_status IN ('draft', 'open', 'pending', 'in-review', 'on-hold', 'closed'))
        )
      )
    );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS mark_comments_pin_number_idx
  ON public.mark_comments (document_id, pin_kind, pin_number)
  WHERE pin_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.add_page_pin(
  p_document_id uuid,
  p_page_number integer,
  p_x double precision,
  p_y double precision,
  p_kind text,
  p_body text,
  p_status text DEFAULT NULL,
  p_mentions uuid[] DEFAULT '{}'
)
RETURNS public.mark_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mark_comments;
  v_body text := btrim(COALESCE(p_body, ''));
  v_kind text := lower(btrim(COALESCE(p_kind, '')));
  v_status text := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
  v_number integer;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_kind NOT IN ('comment', 'issue', 'task') THEN
    RAISE EXCEPTION 'A pin is a comment, an issue or a task' USING ERRCODE = '22023';
  END IF;
  IF p_page_number IS NULL OR p_page_number < 1 THEN
    RAISE EXCEPTION 'A page is needed' USING ERRCODE = '22023';
  END IF;
  IF p_x IS NULL OR p_y IS NULL OR p_x <> p_x OR p_y <> p_y THEN
    RAISE EXCEPTION 'A spot on the page is needed' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'A comment needs 1 to 4000 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_mentions), 0) > 20 THEN
    RAISE EXCEPTION 'Too many mentions' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'comment' THEN
    v_status := NULL;
  ELSE
    v_status := COALESCE(v_status, 'draft');
    -- One number per kind per document: hold the document while counting.
    PERFORM pg_advisory_xact_lock(hashtextextended('page-pin:' || p_document_id::text || ':' || v_kind, 0));
    SELECT COALESCE(max(pin_number), 0) + 1 INTO v_number
      FROM public.mark_comments
     WHERE document_id = p_document_id AND pin_kind = v_kind;
  END IF;

  INSERT INTO public.mark_comments
    (document_id, page_number, author_id, body, mentions, pin_x, pin_y, pin_kind, pin_status, pin_number)
  VALUES (p_document_id, p_page_number, v_uid, v_body,
          public.mark_comment_clean_mentions(p_document_id, p_mentions),
          GREATEST(0, p_x), GREATEST(0, p_y), v_kind, v_status, v_number)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_page_pin(
  p_comment_id uuid,
  p_page_number integer DEFAULT NULL,
  p_x double precision DEFAULT NULL,
  p_y double precision DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS public.mark_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mark_comments;
  v_status text := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
BEGIN
  SELECT * INTO v_row FROM public.mark_comments WHERE id = p_comment_id FOR UPDATE;
  IF v_uid IS NULL OR v_row.id IS NULL OR v_row.pin_kind IS NULL OR v_row.deleted_at IS NOT NULL
     OR NOT COALESCE(public.user_can_access_document(v_row.document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Pin not found' USING ERRCODE = '42501';
  END IF;
  IF (p_x IS NULL) <> (p_y IS NULL) OR p_x <> p_x OR p_y <> p_y THEN
    RAISE EXCEPTION 'A spot needs both x and y' USING ERRCODE = '22023';
  END IF;
  IF p_page_number IS NOT NULL AND p_page_number < 1 THEN
    RAISE EXCEPTION 'A page is needed' USING ERRCODE = '22023';
  END IF;
  IF v_status IS NOT NULL AND v_row.pin_kind = 'comment' THEN
    RAISE EXCEPTION 'A comment pin has no status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.mark_comments
     SET page_number = COALESCE(p_page_number, page_number),
         -- GREATEST skips a NULL, so test for "no move" first.
         pin_x = CASE WHEN p_x IS NULL THEN pin_x ELSE GREATEST(0, p_x) END,
         pin_y = CASE WHEN p_y IS NULL THEN pin_y ELSE GREATEST(0, p_y) END,
         pin_status = COALESCE(v_status, pin_status)
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.add_page_pin(uuid, integer, double precision, double precision, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_page_pin(uuid, integer, double precision, double precision, text, text, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.update_page_pin(uuid, integer, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_page_pin(uuid, integer, double precision, double precision, text) TO authenticated;

-- A new version keeps its pins: the same copy as 20261110138000, plus the
-- pin columns on thread starts.
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
     pin_x, pin_y, pin_kind, pin_status, pin_number)
  SELECT v_to.id, NULL, c.mark_id, c.page_number, c.author_id, c.body, c.mentions,
         c.created_at, c.edited_at, c.deleted_at, COALESCE(c.mentions_notified_at, now()), c.id,
         c.pin_x, c.pin_y, c.pin_kind, c.pin_status, c.pin_number
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

-- Flag: page pins (beta, Survey Nightly only). Keep in step with
-- src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('comment-pins', 'off', 'Page pins: drop a Comment, Issue or Task pin on the page, with a Show pins filter.')
ON CONFLICT (key) DO NOTHING;
