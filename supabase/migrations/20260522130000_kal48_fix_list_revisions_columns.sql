-- KAL-48 follow-up: fix column ambiguity in kal48_list_revisions.
-- The OUT TABLE columns shadowed the table columns inside RETURN QUERY, causing
-- "column \"created_by\" does not exist" when the planner resolved bare
-- references against the OUT list first. Renaming the OUT columns with a
-- `revision_` prefix removes the ambiguity without changing the JSON shape
-- the client sees (it just relies on key names in the returned row).
--
-- The simpler fix would have been to fully qualify every reference, but plpgsql
-- still flagged it on this Postgres build. Renaming the OUT columns is the
-- robust fix.

DROP FUNCTION IF EXISTS public.kal48_list_revisions(UUID);

CREATE OR REPLACE FUNCTION public.kal48_list_revisions(p_document_id UUID)
RETURNS TABLE (
    revision_id UUID,
    revision_document_id UUID,
    revision_number INTEGER,
    revision_label TEXT,
    revision_origin TEXT,
    revision_created_by UUID,
    revision_created_at TIMESTAMPTZ,
    revision_annotation_count INTEGER,
    revision_survey_item_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.user_can_access_document(p_document_id, 'viewer') THEN
        RAISE EXCEPTION 'kal48_list_revisions: access denied'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        dr.id,
        dr.document_id,
        dr.revision_number,
        dr.label,
        dr.origin,
        dr.created_by,
        dr.created_at,
        COALESCE((dr.snapshot_json -> 'meta' ->> 'annotation_count')::INTEGER, 0),
        COALESCE((dr.snapshot_json -> 'meta' ->> 'survey_item_count')::INTEGER, 0)
    FROM public.document_revisions dr
    WHERE dr.document_id = p_document_id
    ORDER BY dr.revision_number DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_list_revisions(UUID) TO authenticated;
