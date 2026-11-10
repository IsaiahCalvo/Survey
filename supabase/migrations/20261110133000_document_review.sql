-- Document review status (Nightly, flag 'document-review'; Drawboard
-- Projects round 2, 2026-11-10). Drawboard shows each drawing's review
-- status, who owns the review and how many markups it has, with filters.
--
-- Kept in its own table, not on public.documents: a status change or a new
-- markup count must not bump documents.updated_at ("Last edited") or run the
-- documents triggers. Read by anyone who can open the document; written only
-- through the two functions below, by people who can edit it.

CREATE TABLE IF NOT EXISTS public.document_reviews (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  status text CHECK (status IS NULL OR status IN ('needs-review', 'in-progress', 'reviewed', 'revise-resubmit', 'approved')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  markup_count integer CHECK (markup_count IS NULL OR markup_count >= 0),
  status_updated_at timestamptz,
  status_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counted_at timestamptz
);

ALTER TABLE public.document_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_reviews_select ON public.document_reviews;
CREATE POLICY document_reviews_select ON public.document_reviews
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id, 'viewer'));

REVOKE ALL ON public.document_reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.document_reviews FROM authenticated;
GRANT SELECT ON public.document_reviews TO authenticated;

-- Status and review owner. The owner must be someone on the document.
CREATE OR REPLACE FUNCTION public.set_document_review(p_document_id uuid, p_status text, p_owner_id uuid DEFAULT NULL)
RETURNS public.document_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.document_reviews;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('needs-review', 'in-progress', 'reviewed', 'revise-resubmit', 'approved') THEN
    RAISE EXCEPTION 'Unknown review status' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NOT NULL AND NOT public.mark_comment_member(p_document_id, p_owner_id) THEN
    RAISE EXCEPTION 'That person is not on this document' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.document_reviews (document_id, status, owner_id, status_updated_at, status_updated_by)
  VALUES (p_document_id, p_status, p_owner_id, now(), v_uid)
  ON CONFLICT (document_id) DO UPDATE
    SET status = EXCLUDED.status,
        owner_id = EXCLUDED.owner_id,
        status_updated_at = EXCLUDED.status_updated_at,
        status_updated_by = EXCLUDED.status_updated_by
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- How many markups the document has, sent by the viewer after its marks
-- change. Anyone who can edit may send it; a same count changes nothing.
CREATE OR REPLACE FUNCTION public.set_document_markup_count(p_document_id uuid, p_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF p_count IS NULL OR p_count < 0 OR p_count > 1000000 THEN
    RAISE EXCEPTION 'Bad markup count' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.document_reviews (document_id, markup_count, counted_at)
  VALUES (p_document_id, p_count, now())
  ON CONFLICT (document_id) DO UPDATE
    SET markup_count = EXCLUDED.markup_count, counted_at = EXCLUDED.counted_at
    WHERE public.document_reviews.markup_count IS DISTINCT FROM EXCLUDED.markup_count;
END;
$$;

-- The list's read: the rows of the documents the caller can open, with the
-- review owner's name (the table alone has only an id).
CREATE OR REPLACE FUNCTION public.list_document_reviews(p_document_ids uuid[])
RETURNS TABLE (document_id uuid, status text, owner_id uuid, owner_name text, markup_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR COALESCE(cardinality(p_document_ids), 0) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_document_ids) > 1000 THEN
    RAISE EXCEPTION 'Too many documents' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT r.document_id, r.status, r.owner_id,
         CASE WHEN u.id IS NULL THEN NULL
              ELSE COALESCE(NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), ''),
                            CASE WHEN public.is_guest_session() THEN NULL ELSE split_part(u.email::text, '@', 1) END)
         END::text,
         r.markup_count
    FROM public.document_reviews r
    LEFT JOIN auth.users u ON u.id = r.owner_id
   WHERE r.document_id = ANY (p_document_ids)
     AND public.user_can_access_document(r.document_id, 'viewer');
END;
$$;

REVOKE ALL ON FUNCTION public.list_document_reviews(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_document_reviews(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.set_document_review(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_review(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_document_markup_count(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_markup_count(uuid, integer) TO authenticated;

-- Flag: a beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('document-review', 'off', 'Document review: status, owner and markup count per document, with filters.')
ON CONFLICT (key) DO NOTHING;
