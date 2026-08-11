CREATE OR REPLACE FUNCTION public.purge_archived_project(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_paths TEXT[];
    v_orphaned TEXT[] := ARRAY[]::TEXT[];
    v_deleted INTEGER;
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.projects
     WHERE id = p_project_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'orphaned_paths', v_orphaned);
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_archived');
    END IF;

    SELECT COALESCE(array_agg(DISTINCT file_path) FILTER (WHERE file_path IS NOT NULL), ARRAY[]::TEXT[])
      INTO v_paths
      FROM public.documents
     WHERE project_id = p_project_id;

    DELETE FROM public.documents WHERE project_id = p_project_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    DELETE FROM public.projects WHERE id = p_project_id;

    -- Only paths no surviving document still points at are safe to unlink.
    SELECT COALESCE(array_agg(p), ARRAY[]::TEXT[]) INTO v_orphaned
      FROM unnest(v_paths) AS p
     WHERE NOT EXISTS (SELECT 1 FROM public.documents WHERE file_path = p);

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'project_id', p_project_id,
        'document_count', v_deleted, 'orphaned_paths', v_orphaned);
END;
$function$
