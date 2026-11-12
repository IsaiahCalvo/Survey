-- Sheet register (Nightly flag 'sheet-register', Drawboard Projects parity
-- item 9, DL-02..31). Drawboard's Drawings list shows each sheet's number,
-- revision and discipline, filters by discipline and by open issues or
-- tasks, edits number / name / revision in one dialog and exports the list
-- as a CSV.
--
-- The discipline is read from the sheet number's letters (A = Architectural)
-- unless someone picks one; a pick is kept on document_reviews, next to the
-- review status, so it never bumps documents.updated_at ("Last edited").
-- Number and revision stay on documents (sheet_number / sheet_revision,
-- 20261109203000), where the title-block reader writes them.

ALTER TABLE public.document_reviews
  ADD COLUMN IF NOT EXISTS discipline text;

ALTER TABLE public.document_reviews
  DROP CONSTRAINT IF EXISTS document_reviews_discipline_len,
  ADD CONSTRAINT document_reviews_discipline_len
    CHECK (discipline IS NULL OR char_length(btrim(discipline)) BETWEEN 1 AND 40);

-- A picked discipline, or NULL to go back to the one the number gives.
CREATE OR REPLACE FUNCTION public.set_document_discipline(p_document_id uuid, p_discipline text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_value text := NULLIF(btrim(COALESCE(p_discipline, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_value IS NOT NULL AND char_length(v_value) > 40 THEN
    RAISE EXCEPTION 'Discipline is too long' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.document_reviews (document_id, discipline)
  VALUES (p_document_id, v_value)
  ON CONFLICT (document_id) DO UPDATE
    SET discipline = EXCLUDED.discipline
    WHERE public.document_reviews.discipline IS DISTINCT FROM EXCLUDED.discipline;
END;
$$;

-- Edit details: sheet number and revision. Anyone who can edit the document
-- may set them (the documents table itself only lets the owner write).
CREATE OR REPLACE FUNCTION public.set_document_sheet_details(p_document_id uuid, p_sheet_number text, p_sheet_revision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_number text := NULLIF(btrim(COALESCE(p_sheet_number, '')), '');
  v_revision text := NULLIF(btrim(COALESCE(p_sheet_revision, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_number IS NOT NULL AND char_length(v_number) > 40 THEN
    RAISE EXCEPTION 'Sheet number is too long' USING ERRCODE = '22023';
  END IF;
  IF v_revision IS NOT NULL AND char_length(v_revision) > 12 THEN
    RAISE EXCEPTION 'Revision is too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.documents
     SET sheet_number = v_number, sheet_revision = v_revision
   WHERE id = p_document_id
     AND (sheet_number IS DISTINCT FROM v_number OR sheet_revision IS DISTINCT FROM v_revision);
END;
$$;

-- The register's read for the listed documents the caller can open: the
-- picked discipline, how many open issues and tasks link the drawing (only
-- items in projects the caller is on), who uploaded it and its version
-- number (1 + the older copies it replaced).
CREATE OR REPLACE FUNCTION public.list_sheet_register(p_document_ids uuid[])
RETURNS TABLE (document_id uuid, discipline text, open_items integer, uploader_name text, version integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR COALESCE(cardinality(p_document_ids), 0) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_document_ids) > 1000 THEN
    RAISE EXCEPTION 'Too many documents' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH RECURSIVE visible AS (
    SELECT d.id, d.user_id
      FROM public.documents d
     WHERE d.id = ANY (p_document_ids)
       AND public.user_can_access_document(d.id, 'viewer')
  ),
  items AS (
    SELECT (l.value ->> 'document_id')::uuid AS doc_id, count(DISTINCT i.id)::integer AS n
      FROM public.project_items i
      CROSS JOIN LATERAL jsonb_array_elements(i.links) AS l(value)
     WHERE i.archived_at IS NULL
       AND i.status IN ('open', 'pending', 'in_review', 'on_hold')
       AND jsonb_typeof(l.value) = 'object'
       AND (l.value ->> 'document_id') ~ '^[0-9a-fA-F-]{36}$'
       AND (l.value ->> 'document_id')::uuid IN (SELECT id FROM visible)
       AND public.project_item_member(i.project_id, v_uid)
     GROUP BY 1
  ),
  chain AS (
    SELECT v.id AS head, v.id AS cur, 1 AS n FROM visible v
    UNION ALL
    SELECT c.head, p.id, c.n + 1
      FROM chain c
      JOIN public.documents p ON p.superseded_by = c.cur
     WHERE c.n < 200
  ),
  versions AS (
    SELECT head, max(n)::integer AS n FROM chain GROUP BY head
  )
  SELECT v.id,
         r.discipline,
         COALESCE(it.n, 0),
         CASE WHEN u.id IS NULL THEN NULL
              ELSE COALESCE(NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), ''),
                            CASE WHEN public.is_guest_session() THEN NULL ELSE split_part(u.email::text, '@', 1) END)
         END::text,
         COALESCE(vs.n, 1)
    FROM visible v
    LEFT JOIN public.document_reviews r ON r.document_id = v.id
    LEFT JOIN items it ON it.doc_id = v.id
    LEFT JOIN versions vs ON vs.head = v.id
    LEFT JOIN auth.users u ON u.id = v.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_discipline(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_discipline(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_document_sheet_details(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_sheet_details(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.list_sheet_register(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sheet_register(uuid[]) TO authenticated;

-- Keep in step with src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('sheet-register', 'off', 'Sheet register: sheet number, revision and discipline on Home, discipline and open-items filters, Edit details, list CSV')
ON CONFLICT (key) DO NOTHING;
