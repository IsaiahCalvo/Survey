-- Local durable cleanup must follow committed deletes, not a stale pre-purge
-- child list. Live collaborator documents are detached and must keep drafts.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.purge_archived_project(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_paths TEXT[];
    v_orphaned TEXT[] := ARRAY[]::TEXT[];
    v_deleted_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.projects WHERE id=p_project_id FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok',true,'already',true,
            'orphaned_paths',v_orphaned,'deleted_document_ids',v_deleted_ids);
    END IF;
    IF v_owner IS DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object('ok',false,'reason','not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok',false,'reason','not_archived');
    END IF;

    -- Freeze each child's archive state before the detach/delete split. A
    -- concurrent restore must not slip between those statements and then be
    -- destroyed by the project's cascade. Fail fast on reverse lock order.
    PERFORM 1 FROM public.documents WHERE project_id=p_project_id
      ORDER BY id FOR UPDATE NOWAIT;

    -- Preserve the existing archive contract: live children survive detached.
    UPDATE public.documents SET project_id=NULL
      WHERE project_id=p_project_id AND user_archived_at IS NULL;

    -- Both IDs and candidate storage paths come from the rows this statement
    -- actually deletes. Never infer local cleanup from an earlier client read.
    WITH removed AS (
        DELETE FROM public.documents
          WHERE project_id=p_project_id AND user_archived_at IS NOT NULL
          RETURNING id,file_path
    )
    SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::UUID[]),
           COALESCE(array_agg(DISTINCT file_path) FILTER (WHERE file_path IS NOT NULL),ARRAY[]::TEXT[])
      INTO v_deleted_ids,v_paths FROM removed;

    DELETE FROM public.projects WHERE id=p_project_id;
    -- This is a candidate snapshot, NOT a storage deletion authorization.
    -- Storage cleanup needs its own publication fence (separate rollout).
    SELECT COALESCE(array_agg(p),ARRAY[]::TEXT[]) INTO v_orphaned
      FROM unnest(v_paths) AS p
      WHERE NOT EXISTS (SELECT 1 FROM public.documents WHERE file_path=p);

    RETURN jsonb_build_object('ok',true,'already',false,'project_id',p_project_id,
        'document_count',cardinality(v_deleted_ids),
        'deleted_document_ids',v_deleted_ids,'orphaned_paths',v_orphaned);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_archived_project(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.purge_archived_project(UUID) TO authenticated;
COMMIT;
