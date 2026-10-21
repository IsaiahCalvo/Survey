-- Opening a drawing reads its markups 1000 rows at a time. Through the table,
-- the SELECT policy runs user_can_access_document(document_id, 'viewer') once
-- per row: same document, same answer, several lookups each time. This
-- function checks access once for the page and then reads the rows directly,
-- with the same keyset cursor and the same filters the app sends.
--
-- Access rule is unchanged: user_can_access_document() is the function the
-- table's SELECT policy uses, so whoever can read the rows through the table
-- gets the same rows here, and nobody else gets any.
--
-- p_types / p_fabric_types mirror the app's "owned rows" filter:
--   annotation_type = ANY(p_types)
--   OR (annotation_type = ANY(p_fabric_types) AND annotation_data->'fabricObject' IS NOT NULL)
-- Both null means every row.

CREATE OR REPLACE FUNCTION public.get_document_annotation_page(
  p_document_id uuid,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_types text[] DEFAULT NULL,
  p_fabric_types text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  annotation_id text,
  annotation_type text,
  page_number integer,
  annotation_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_document_id IS NULL OR NOT public.user_can_access_document(p_document_id, 'viewer') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT a.id, a.user_id, a.annotation_id, a.annotation_type, a.page_number,
           a.annotation_data, a.created_at, a.updated_at
      FROM public.document_annotations a
     WHERE a.document_id = p_document_id
       AND (p_after_id IS NULL OR a.id > p_after_id)
       AND (
         (p_types IS NULL AND p_fabric_types IS NULL)
         OR a.annotation_type = ANY (p_types)
         OR (a.annotation_type = ANY (p_fabric_types) AND (a.annotation_data -> 'fabricObject') IS NOT NULL)
       )
     ORDER BY a.id
     LIMIT least(greatest(coalesce(p_limit, 1000), 1), 1000);
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_annotation_page(uuid, uuid, integer, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_annotation_page(uuid, uuid, integer, text[], text[]) TO authenticated;
